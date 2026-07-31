Use this skill to get connected before running any other SKU.io skill. It answers three
questions: *what URL do I call, how do I authenticate, and what am I allowed to do?*

## What you need

1. **A tenant prefix.** Your account URL is `https://{tenant}.sku.io`, where `{tenant}` is
   **everything before `.sku.io`**. Every API path lives under `/api`.

   Don't assume it's a single label. Ask the user for the URL they log in at and take the whole
   prefix verbatim, dots included:

   | Prefix in their login URL | `SKU_TENANT` |
   | --- | --- |
   | `acme` (i.e. `https://acme.sku.io`) | `acme` |
   | `beta.acme` | `beta.acme` |
   | `demo.acme` | `demo.acme` |

   Beta, demo, and sandbox accounts are the multi-label case. Keeping the dots means
   `https://$SKU_TENANT.sku.io/...` composes correctly either way.

   > **`*.sku.io` is wildcard DNS, so a wrong prefix fails silently.** Stripping a two-label
   > prefix back to its last label does *not* produce a DNS error or a `404` — the shortened
   > host still resolves, still serves the API, and answers an unauthenticated call with exactly
   > the same `401 {"message":"Unauthenticated."}` as the real one. You cannot tell a wrong
   > prefix from a bad token by probing. **Take the prefix verbatim from the user's login URL;
   > never guess it, shorten it, or "correct" it.**
2. **A Personal Access Token (PAT).** Mint one at
   **`https://{tenant}.sku.io/v2/settings/developer/personal-access-tokens`** → **Create Token**.
   Grant it only the scopes your task needs (`{resource}:read` / `{resource}:write`). The token
   value is shown once — store it as a secret, e.g. `SKU_PAT`.

   **Always hand the user the full, substituted URL** — `https://acme.sku.io/v2/settings/developer/personal-access-tokens`,
   not the `{tenant}` placeholder and not a menu path. If you don't know their subdomain yet, ask
   for it first, then give them the finished link. It is a one-click destination; making them
   navigate Settings → Developer by hand is the wrong hand-off.

There is no separate API key or OAuth handshake for first-party access — the PAT *is* your
credential.

## Steps

1. **Set your base URL and token.**

   ```bash
   export SKU_TENANT="acme"           # multi-label on beta/demo, e.g. "beta.acme"
   export SKU_PAT="105|A1b2C3d4e5…"   # keep the quotes — see below
   ```

   > **Always quote the token.** A PAT is `<id>|<secret>`, and that `|` is a pipe to the shell.
   > Unquoted, `export SKU_PAT=105|A1b2…` is parsed as a two-stage pipeline: the `export` runs in
   > a subshell and is discarded, so `SKU_PAT` ends up **empty**, and the secret half is run as a
   > command. Verified in both bash and zsh. You then send `Authorization: Bearer ` and get a
   > `401` — which reads as a bad token when the token was fine all along. Keep the double quotes
   > on the `export` and on every `-H "Authorization: Bearer $SKU_PAT"`.

2. **Verify the token** with `GET /api/me` — the one identity call a PAT can make:

   ```bash
   curl -sS "https://$SKU_TENANT.sku.io/api/me" \
     -H "Authorization: Bearer $SKU_PAT" \
     -H "Accept: application/json"
   ```

   ```json
   { "data": { "id": 1, "name": "Administrator", "email": "…", "role": "Admin" },
     "tenant_id": "acme", "tenant_name": "acme",
     "token": { "id": 105, "name": "stock-take agent", "type": "pat",
                "scopes": ["inventory:read", "inventory:write"],
                "expires_at": null, "is_expired": false } }
   ```

   This is the right probe for four reasons: it **requires no scopes**, so it works with any
   token whatever you granted it; a `200` can only come from the correct host; it returns
   **`tenant_id`**, which is the account confirmation; and it echoes back the **`token`** you
   presented, including its scopes — see step 3.

   > **Don't reach for `/api/auth/profile`.** It's the intuitive guess and it does not work —
   > `/api/auth/*` is session-only and answers every PAT with
   > `403 {"message":"This endpoint is not available to API tokens."}`. Use `/api/me`, which
   > exists precisely as the lightweight "who am I" check.

   **Read `tenant_id` back and confirm it is the account the user meant.** That is the check that
   catches a wrong prefix — and the only one that does, since a `200` alone just means *some*
   real tenant answered.

   - `401` → **two possible causes, and they look identical.** Either the token is
     missing/wrong/expired, *or* `SKU_TENANT` is wrong. Before concluding the token is bad,
     re-read the user's login URL and confirm the prefix matches it character for character —
     a dropped label on a beta/demo account (`acme` for `beta.acme`) lands on a live host that
     returns this same `401`.
   - `403 "This endpoint is not available to API tokens."` → you hit a session-only route, not a
     token problem. **It's actually positive evidence:** authentication runs *before* that check,
     so a bad token or wrong prefix would have returned `401` and never reached it. The token and
     host are good — just call a PAT-reachable route instead.
   - `403` with a `required_scope` field → connected, but the token lacks that scope. See step 3.
   - `404` on *every* path → the path prefix is wrong; every API route lives under `/api`.
   - A redirect or HTML instead of JSON → you're missing `Accept: application/json`, or hitting
     a non-API route.

3. **Confirm the token can do the job — read `token.scopes` from the step-2 response.**

   A token can introspect itself. The `token` block you already have lists exactly what the
   bearer is carrying, so check the scopes your task needs *before* you start, not halfway
   through a multi-step operation with the first half already committed:

   ```bash
   curl -sS "https://$SKU_TENANT.sku.io/api/me" \
     -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json" \
     | jq -r '.token.scopes[]?'
   ```

   Scopes are enforced per verb: `read` covers `GET`, `write` covers
   `POST`/`PUT`/`PATCH`/`DELETE`. For the full catalogue of what exists — every resource and
   what each scope permits — call `GET /api/developer/scopes`, which a PAT may read.

   If a needed scope is missing, say so up front rather than attempting the work: name the scope
   and hand the user the direct link,
   `https://$SKU_TENANT.sku.io/v2/settings/developer/personal-access-tokens`. Scopes are fixed at
   creation, so this means minting a replacement token.

   > **If the response has no `token` key at all**, the account is on a build predating token
   > introspection. Fall back to the old method: ask the user what they ticked when minting, and
   > treat any `403` carrying a `required_scope` field as the authoritative answer for that call.
   > An empty `scopes` array is a different thing entirely — that is a real answer, meaning the
   > token can call nothing scoped.

   Note what is still **session-only**: `/api/developer/personal-access-tokens`. A token may
   describe *itself*, but it cannot enumerate its siblings or mint new ones.

   Before a first write, a cheap scoped read doubles as a scope check and a sanity check on the
   account — e.g. `GET /api/v2/warehouses?per_page=5` (`warehouses:read`). Recognisable warehouse
   names alongside a matching `tenant_id` is about as certain as connection gets.

## Then hand off

Once `GET /api/me` returns `200` and its `tenant_id` is the account the user meant, you are
connected. Proceed to the domain skill for your task (e.g. **find-product**,
**create-sales-order**, **adjust-inventory**), reusing the same base URL and `Authorization`
header.

See [`shared/authentication.md`](../../../shared/authentication.md) and
[`shared/api-overview.md`](../../../shared/api-overview.md) for the full picture.

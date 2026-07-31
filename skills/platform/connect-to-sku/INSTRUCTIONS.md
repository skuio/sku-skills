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
   export SKU_TENANT="acme"          # multi-label on beta/demo, e.g. "beta.acme"
   export SKU_PAT="sku_pat_xxxxxxxx"
   ```

2. **Verify the token** with a cheap identity call. A `200` with your user/account means the
   token is valid and reachable:

   ```bash
   curl -sS "https://$SKU_TENANT.sku.io/api/auth/profile" \
     -H "Authorization: Bearer $SKU_PAT" \
     -H "Accept: application/json"
   ```

   A `200` is the only real proof of connection: it confirms the token *and* the host, because a
   wrong host can never return one. **Read the account in the response body and confirm it is the
   account the user meant** — that is the check that catches a wrong prefix.

   - `401` → **two possible causes, and they look identical.** Either the token is
     missing/wrong/expired, *or* `SKU_TENANT` is wrong. Before concluding the token is bad,
     re-read the user's login URL and confirm the prefix matches it character for character —
     a dropped label on a beta/demo account (`acme` for `beta.acme`) lands on a live host that
     returns this same `401`.
   - `404` on *every* path → the path prefix is wrong; every API route lives under `/api`.
   - A redirect or HTML instead of JSON → you're missing `Accept: application/json`, or hitting
     a non-API route.

3. **Confirm scopes.** List the account's tokens to see which scopes each holds, so you can tell
   whether the current token can perform your intended task:

   ```bash
   curl -sS "https://$SKU_TENANT.sku.io/api/personal-access-tokens" \
     -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
   ```

   If a later call returns `403` with a `required_scope` field, the token lacks that scope — the
   user must mint a new one that includes it. Name the missing scope and give them the direct
   link: `https://$SKU_TENANT.sku.io/v2/settings/developer/personal-access-tokens`. Scopes are
   enforced per verb: `read` for `GET`, `write` for `POST`/`PUT`/`PATCH`/`DELETE`.

## Then hand off

Once `GET /api/auth/profile` returns `200`, you are connected. Proceed to the domain skill for
your task (e.g. **find-product**, **create-sales-order**, **adjust-inventory**), reusing the same
base URL and `Authorization` header.

See [`shared/authentication.md`](../../../shared/authentication.md) and
[`shared/api-overview.md`](../../../shared/api-overview.md) for the full picture.

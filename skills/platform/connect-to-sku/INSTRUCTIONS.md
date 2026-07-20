Use this skill to get connected before running any other SKU.io skill. It answers three
questions, in order: *which tenant, how do I authenticate, and what am I allowed to do?* You
cannot do anything — not one API call — until you know the tenant, so that is always step one.

## Step 1 — Establish the tenant (do this first, before anything else)

Every SKU.io account lives at `https://{tenant}.sku.io`, where `{tenant}` is the company's
subdomain (e.g. `acme`), and every API path lives under `/api`. Without the tenant there is no
base URL and nothing else can run.

**If the operator hasn't given you their tenant, ask for it before doing anything else — this is
the first question of any SKU.io session:**

> *What's your SKU.io tenant? It's the `{tenant}` in your account URL `https://{tenant}.sku.io` —
> e.g. if you sign in at `https://acme.sku.io`, your tenant is `acme`.*

Then set it:

```bash
export SKU_TENANT="acme"
```

## Step 2 — Get a Personal Access Token

A PAT *is* your credential — there is no separate API key or OAuth handshake for first-party
access. Now that you know the tenant, send the operator **straight to the page** with a direct
link (don't just describe a menu path) — this URL is clickable in a terminal, and only resolves
because you established the tenant in Step 1:

**`https://{SKU_TENANT}.sku.io/v2/settings/developer/personal-access-tokens`**

For example, `https://acme.sku.io/v2/settings/developer/personal-access-tokens`. On that page they
**Create token**, grant only the scopes the task needs (`{resource}:read` / `{resource}:write` —
see Step 4), and copy the value. **It is shown only once.** Store it as a secret and load it:

```bash
export SKU_PAT="sku_pat_xxxxxxxx"   # quote it — a PAT can contain a | that the shell would treat as a pipe
```

## Step 3 — Verify the token

Verify with one cheap identity call: `GET /api/me` returns the authenticated user **and** the
tenant the request resolved to, so a single call confirms both that the token works and that you
are pointed at the right account.

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/me" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Accept: application/json"
```

A `200` whose `tenant_id` / `tenant_name` matches `$SKU_TENANT` means you are connected.
Otherwise:

- `401` → the token is missing, wrong, or expired.
- `404` on *every* path → the `{tenant}` subdomain is wrong.
- HTML, or a `403` "access denied" that mentions Cloudflare, instead of JSON → your HTTP client's
  User-Agent is being blocked as a bot. Send an ordinary User-Agent (curl's default is fine)
  rather than a bare library default like `python-urllib`.

## Step 4 — Know your scopes

A token only calls endpoints its scopes cover; a missing scope returns `403` with a
`required_scope` field. There is **no endpoint that lists a token's scopes**, so you can't
enumerate them up front — you discover a gap when a call is refused. Scopes are enforced **per
verb**: `read` for `GET`/`HEAD`, `write` for `POST`/`PUT`/`PATCH`/`DELETE`. When a call returns
`403` with a `required_scope`, mint a fresh token that adds that scope (back to Step 2) and retry.
Grant least privilege: a product-lookup task needs only `products:read`; an order-creation task
needs `orders:write` (plus `products:read` to resolve line items).

## Then hand off

Once `GET /api/me` returns `200`, you are connected. Proceed to the domain skill for your task
(e.g. **find-product**, **create-sales-order**, **adjust-inventory**), reusing the same base URL
and `Authorization` header.

See [`shared/authentication.md`](../../../shared/authentication.md) and
[`shared/api-overview.md`](../../../shared/api-overview.md) for the full picture.

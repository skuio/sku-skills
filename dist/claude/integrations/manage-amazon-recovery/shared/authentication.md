# Authenticating with the SKU.io API

Every SKU.io API request is authenticated with a **Personal Access Token (PAT)** sent as a
Bearer token. There are no API keys or OAuth client flows for first-party access — a PAT is
the unit of programmatic access.

## 1. Mint a token

Send the user straight to the page — don't describe the menu path:

```
https://{tenant}.sku.io/v2/settings/developer/personal-access-tokens
```

Substitute `{tenant}` for their prefix (`acme`, or `beta.acme` on a beta/demo account) and give
them the finished URL, then have them click
**Create Token** (top right). In the app this page is **Settings → Developer → Personal Access
Tokens**, titled *Access Tokens*.

When creating a token you choose:

- **Scopes** — one `read` and/or `write` capability per business domain (see below). A token can
  only call endpoints covered by its scopes; a missing scope returns `403` with a
  `required_scope` field in the body.
- **Restrictions** (optional) — IP allow-lists, expiry, etc.

Tokens are shown **once** at creation. Store the value in a secret manager or environment
variable — never commit it.

A PAT has the shape `<id>|<secret>` (e.g. `105|A1b2C3d4e5…`). **Always quote it** — that `|` is a
pipe to the shell, so `export SKU_PAT=105|A1b2…` is parsed as a pipeline: the `export` runs in a
subshell and is thrown away, leaving `SKU_PAT` **empty**, while the secret half is run as a
command. The resulting `Authorization: Bearer ` returns `401`, which looks like a rejected token
rather than one that was never set.

## 2. Send the token

```http
GET /api/products/search?query=widget HTTP/1.1
Host: {tenant}.sku.io
Authorization: Bearer <YOUR_SKU_PAT>
Accept: application/json
```

- **Base URL:** `https://{tenant}.sku.io` — `{tenant}` is **everything before `.sku.io`** in the
  URL the user logs in at. Usually a single label (`acme` → `https://acme.sku.io`), but beta,
  demo, and sandbox accounts carry extra labels, making the prefix itself contain a dot (e.g.
  `beta.acme`). Take the whole prefix verbatim — don't strip it back to the last label.
- All API paths are prefixed with `/api`.

```bash
export SKU_TENANT="acme"          # or "beta.acme" for a beta/demo account
export SKU_PAT="sku_pat_xxxxxxxx"

curl -sS "https://$SKU_TENANT.sku.io/api/products/search?query=widget" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Accept: application/json"
```

## 3. Scopes

Scopes are `{resource}:{read|write}`. `read` covers `GET`/`HEAD`; `write` covers
`POST`/`PUT`/`PATCH`/`DELETE`. Available resources:

`accounting`, `customers`, `integrations`, `inventory`, `manufacturing`, `orders`,
`products`, `purchase-orders`, `reports`, `returns`, `settings`, `subscriptions`,
`suppliers`, `warehouses`.

Grant a token the **least privilege** it needs. A product-lookup agent needs only
`products:read`; an order-creation agent needs `orders:write` (and usually `products:read`
to resolve line items).

`GET /api/developer/scopes` returns this catalogue with a description per scope, and
`GET /api/me` reports which of them the current token actually holds (see §4).

## 4. Verifying a connection

Use **`GET /api/me`**. It requires no scopes, so it works with any token, and it answers both
*who you are* and *what you may do*:

```json
{ "data": { "id": 1, "name": "Administrator", "role": "Admin" },
  "tenant_id": "acme", "tenant_name": "acme",
  "token": { "id": 105, "name": "stock-take agent", "type": "pat",
             "scopes": ["inventory:read", "inventory:write"],
             "expires_at": null, "is_expired": false } }
```

Check `tenant_id` against the account the user meant — a `200` alone only proves *some* real
tenant answered, so this is what catches a wrong prefix.

Read `token.scopes` to confirm the token carries what your task needs **before** starting, rather
than discovering the gap from a `403` partway through. Session-authenticated callers (the SPA)
carry no token and get `"token": null`. If the key is absent entirely, the account predates token
introspection — fall back to asking the user what they granted and treating a `403` carrying
`required_scope` as the authoritative answer for that call.

`GET /api/developer/scopes` is also readable by a token: it is the static catalogue of every
scope and what each permits, useful for naming precisely what is missing.

**Not `/api/auth/profile`.** That's the intuitive guess and it fails: `/api/auth/*` is session-only,
as is `/api/developer/personal-access-tokens` — a token may describe *itself*, but it **cannot
enumerate its siblings or mint new ones**.

Those return `403 {"message":"This endpoint is not available to API tokens."}` — which is
**positive evidence about the token**: authentication runs before that check, so a bad token or a
wrong tenant prefix returns `401` and never reaches it.

## Common auth failures

| Status | Meaning | Fix |
| --- | --- | --- |
| `401 Unauthenticated` | Missing/invalid/expired token | Re-check the `Authorization` header and token validity |
| `403 Token is missing the required scope` | Token lacks the scope for this verb+resource | Recreate the token with the scope named in `required_scope` |
| `403 This endpoint is not available to API tokens.` | Session-only endpoint, not a token fault | Confirms the token *and* host are correct — auth runs before this check, so a bad token or wrong prefix returns `401` instead. Call a domain resource instead; see §4 for what stays session-only |
| `401` on every path, token looks fine | Possibly a **wrong tenant prefix**, not a bad token | `*.sku.io` is wildcard DNS: a wrong prefix resolves and returns the same `401`. Confirm `{tenant}` matches everything before `.sku.io` in the user's login URL — including extra labels on beta/demo accounts (`beta.acme`, not `acme`) |
| `401`, and `$SKU_PAT` is empty | The token was assigned **unquoted** | A PAT contains a `|`, so the shell split the assignment into a pipeline and discarded it. Re-export it in double quotes (see §1) and `echo "${SKU_PAT:?unset}"` to confirm it stuck |
| `404` on every path | Wrong path prefix | All API routes live under `/api` |

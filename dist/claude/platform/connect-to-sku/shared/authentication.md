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

## Common auth failures

| Status | Meaning | Fix |
| --- | --- | --- |
| `401 Unauthenticated` | Missing/invalid/expired token | Re-check the `Authorization` header and token validity |
| `403 Token is missing the required scope` | Token lacks the scope for this verb+resource | Recreate the token with the scope named in `required_scope` |
| `401` on every path, token looks fine | Possibly a **wrong tenant prefix**, not a bad token | `*.sku.io` is wildcard DNS: a wrong prefix resolves and returns the same `401`. Confirm `{tenant}` matches everything before `.sku.io` in the user's login URL — including extra labels on beta/demo accounts (`beta.acme`, not `acme`) |
| `404` on every path | Wrong path prefix | All API routes live under `/api` |

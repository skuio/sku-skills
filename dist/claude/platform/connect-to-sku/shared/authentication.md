# Authenticating with the SKU.io API

Every SKU.io API request is authenticated with a **Personal Access Token (PAT)** sent as a
Bearer token. There are no API keys or OAuth client flows for first-party access — a PAT is
the unit of programmatic access.

## 1. Mint a token

In the SKU.io web app, go straight to the Personal Access Tokens page and **Create token** — the
direct link (once you know your tenant) is:

```
https://{tenant}.sku.io/v2/settings/developer/personal-access-tokens
```

(equivalently, **Settings → Developer → Personal Access Tokens → Create token**).

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

- **Base URL:** `https://{tenant}.sku.io` — replace `{tenant}` with your account subdomain
  (e.g. `app`, or your company's subdomain).
- All API paths are prefixed with `/api`.

```bash
export SKU_TENANT="acme"
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
| `404` on every path | Wrong tenant subdomain | Confirm the `{tenant}` in the base URL |
| `403` "access denied" / HTML from Cloudflare | Your HTTP client's User-Agent is blocked as a bot | Send an ordinary User-Agent (curl's default is fine), not a bare library default like `python-urllib` |

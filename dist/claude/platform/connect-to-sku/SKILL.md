---
name: connect-to-sku
description: "The entry point for any SKU.io task. Establish an authenticated connection: point at the correct tenant base URL, send a Personal Access Token as a Bearer token, verify it works with a cheap identity call, and inspect the token's scopes so you know what you are allowed to do. Use this first whenever you are about to call the SKU.io API."
license: MIT
---

# Connect to SKU.io

Use this skill to get connected before running any other SKU.io skill. It answers three
questions: *what URL do I call, how do I authenticate, and what am I allowed to do?*

## What you need

1. **A tenant subdomain.** Your account URL is `https://{tenant}.sku.io` — the `{tenant}` is your
   company's subdomain (e.g. `acme`). Every API path lives under `/api`.
2. **A Personal Access Token (PAT).** Mint one in the web app under
   **Settings → Developer → Personal Access Tokens**. Grant it only the scopes your task needs
   (`{resource}:read` / `{resource}:write`). The token value is shown once — store it as a secret,
   e.g. `SKU_PAT`.

There is no separate API key or OAuth handshake for first-party access — the PAT *is* your
credential.

## Steps

1. **Set your base URL and token.**

   ```bash
   export SKU_TENANT="acme"
   export SKU_PAT="sku_pat_xxxxxxxx"
   ```

2. **Verify the token** with a cheap identity call. A `200` with your user/account means the
   token is valid and reachable:

   ```bash
   curl -sS "https://$SKU_TENANT.sku.io/api/auth/profile" \
     -H "Authorization: Bearer $SKU_PAT" \
     -H "Accept: application/json"
   ```

   - `401` → the token is missing, wrong, or expired.
   - `404` on *every* path → the `{tenant}` subdomain is wrong.

3. **Confirm scopes.** List the account's tokens to see which scopes each holds, so you can tell
   whether the current token can perform your intended task:

   ```bash
   curl -sS "https://$SKU_TENANT.sku.io/api/personal-access-tokens" \
     -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
   ```

   If a later call returns `403` with a `required_scope` field, the token lacks that scope —
   mint a new token that includes it. Scopes are enforced per verb: `read` for `GET`, `write`
   for `POST`/`PUT`/`PATCH`/`DELETE`.

## Then hand off

Once `GET /api/auth/profile` returns `200`, you are connected. Proceed to the domain skill for
your task (e.g. **find-product**, **create-sales-order**, **adjust-inventory**), reusing the same
base URL and `Authorization` header.

See [`shared/authentication.md`](shared/authentication.md) and
[`shared/api-overview.md`](shared/api-overview.md) for the full picture.

## API operations

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/auth/profile` | Return the authenticated user and account. Cheapest way to verify a token works. |
| `GET` | `/api/personal-access-tokens` | List the account's Personal Access Tokens and the scopes granted to each. |

## Authentication

Every request authenticates with a SKU.io **Personal Access Token** sent as a Bearer token:

```http
Authorization: Bearer <YOUR_SKU_PAT>
```

- **Base URL:** `https://{tenant}.sku.io` (replace `{tenant}` with your account subdomain)
- **Required scopes:** `settings:read`

Mint a token under **Settings → Developer → Personal Access Tokens** in the SKU.io web app.
See [`shared/authentication.md`](shared/authentication.md) for the full flow.

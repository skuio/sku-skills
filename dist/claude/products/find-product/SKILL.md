---
name: find-product
description: "Look up a product in the SKU.io catalog by SKU, barcode, or a free-text search over name and SKU. Use this whenever you need to resolve a product reference to its SKU.io product record and id — for example before adding it to a sales order, checking stock, or reporting on it."
license: MIT
---

# Find a Product

Use this skill to turn "the blue widget" or a scanned barcode into a concrete SKU.io product —
its `id`, `sku`, name, and details — so downstream skills have an unambiguous reference.

## Step 0 — Connect first

Every call below authenticates as a SKU.io **Personal Access Token** against one specific
tenant, so two things have to be true before Step 1: `$SKU_TENANT` and `$SKU_PAT` are set, and
that token actually carries `products:read`.

If you cannot confirm both, **run the `connect-to-sku` skill first** rather than trying a call
to see what happens. It mints the token, confirms the tenant is the one the user meant, and reads
the scopes back off the token — so a missing scope surfaces now, in one exchange with the user,
instead of as a `403` midway through with half the work already committed. If that skill is not
installed alongside this one, its instructions are at <https://github.com/skuio/sku-skills/tree/main/skills/platform/connect-to-sku>.

Never invent a tenant or a token, and never quietly fall back to a different tenant than the one
the user named. Writing to the wrong account is the one mistake here the API cannot undo for you.

## Pick the right lookup

| You have… | Call | Why |
| --- | --- | --- |
| An exact SKU | `GET /api/products/by-sku?sku=WIDGET-BLUE-01` | Direct, single result |
| A scanned barcode (UPC/EAN/GTIN) | `GET /api/products/barcode-lookup?code=0123456789012` | Resolves the barcode to its product (param is `code`) |
| A partial name or SKU | `GET /api/products/search?query=blue widget` | Fuzzy, may return several matches |
| A numeric product id | `GET /api/products/{id}` | Full record when you already have the id |

Always prefer the **most specific** lookup you can. Use `search` only when you don't have an
exact SKU or barcode — it can return multiple candidates that you must disambiguate.

## Steps

1. Choose the lookup above based on what you were given.
2. Send the request with your Bearer token (scope `products:read`):

   ```bash
   curl -sS "https://$SKU_TENANT.sku.io/api/products/by-sku?sku=WIDGET-BLUE-01" \
     -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
   ```

3. **Handle the result:**
   - **Exactly one match** → capture its `id` and `sku`; you're done.
   - **Search returned several** → narrow by matching the exact `sku`, or surface the top
     candidates (name + sku) to the user and ask which one. Do **not** silently pick the first.
   - **No match** → the product may not exist or may be archived. Report that rather than
     inventing an id. Consider a broader `search` query before giving up.

## Notes

- `search` is paginated — see [`shared/pagination.md`](shared/pagination.md). The best
  matches are on the first page; you rarely need to page for a lookup.
- Product `id` is the stable key other skills expect (e.g. `product_id` on a sales-order line).
  Prefer passing `id` downstream over re-resolving by SKU each time.

## API operations

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/products/search` | Fuzzy search products by name or SKU fragment. |
| `GET` | `/api/products/by-sku` | Fetch a single product by its exact SKU. |
| `GET` | `/api/products/barcode-lookup` | Resolve a scanned barcode (UPC/EAN/GTIN) to a product. |
| `GET` | `/api/products/{id}` | Fetch the full product record by its numeric id. |

## Authentication

Every request authenticates with a SKU.io **Personal Access Token** sent as a Bearer token:

```http
Authorization: Bearer <YOUR_SKU_PAT>
```

- **Base URL:** `https://{tenant}.sku.io` — replace `{tenant}` with your account subdomain.
  The subdomain may itself contain a dot (beta and staging accounts often do), so take
  **everything** before `.sku.io` in the URL you sign in at, not just the first label.
- **Required scopes:** `products:read`

Mint a token under **Settings → Developer → Personal Access Tokens** in the SKU.io web app.
See [`shared/authentication.md`](shared/authentication.md) for the full flow.

---

## Improve this skill

Did this skill fall short—an unclear step, a wrong endpoint, or something it couldn't finish? Don't
just work around it: capture what was off and open a pull request so the next agent does better.

- Repo: <https://github.com/skuio/sku-skills>
- Edit the **canonical** skill under `skills/<domain>/<name>/` (not this generated file), then run
  `npm run build` and open a PR. External contributors: fork the repo and PR from the fork.
- The full agent workflow is in [`AGENTS.md`](https://github.com/skuio/sku-skills/blob/main/AGENTS.md).

Your agent can do this end to end. The library gets better every time someone sends a fix.

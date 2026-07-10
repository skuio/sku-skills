# Find a Product

_Look up a product in the SKU.io catalog by SKU, barcode, or a free-text search over name and SKU. Use this whenever you need to resolve a product reference to its SKU.io product record and id — for example before adding it to a sales order, checking stock, or reporting on it._

Use this skill to turn "the blue widget" or a scanned barcode into a concrete SKU.io product —
its `id`, `sku`, name, and details — so downstream skills have an unambiguous reference.

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

- `search` is paginated — see [`shared/pagination.md`](https://github.com/skuio/sku-skills/blob/main/shared/pagination.md). The best
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

- **Base URL:** `https://{tenant}.sku.io` (replace `{tenant}` with your account subdomain)
- **Required scopes:** `products:read`

Mint a token under **Settings → Developer → Personal Access Tokens** in the SKU.io web app.
See [`shared/authentication.md`](https://github.com/skuio/sku-skills/blob/main/shared/authentication.md) for the full flow.

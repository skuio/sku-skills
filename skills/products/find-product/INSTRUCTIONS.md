Use this skill to turn "the blue widget" or a scanned barcode into a concrete SKU.io product —
its `id`, `sku`, name, and details — so downstream skills have an unambiguous reference.

## Pick the right lookup

| You have… | Call | Why |
| --- | --- | --- |
| An exact SKU | `GET /api/products/by-sku?sku=WIDGET-BLUE-01` | Direct, single result |
| A scanned barcode (UPC/EAN/GTIN) | `GET /api/products/barcode-lookup?code=0123456789012` | Resolves the barcode to its product (param is `code`) |
| A partial name or SKU | `GET /api/products/search?q=blue+widget` | Fuzzy, may return several matches. The param is **`q`** — see the warning below |
| A numeric product id | `GET /api/products/{id}` | Full record when you already have the id |

Always prefer the **most specific** lookup you can. Use `search` only when you don't have an
exact SKU or barcode — it can return multiple candidates that you must disambiguate.

> **⚠ The search parameter is `q`, not `query`.** `query` and `search` are not read by the API and
> are silently ignored. Because `q` is optional, passing the wrong name still returns `200` — with
> an unfiltered page of the most recent active products, which looks exactly like a successful
> search. If results seem unrelated to what you asked for, check the parameter name first.
> Minimum 2 characters.

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

- **`search` is not paginated.** Unlike list endpoints it takes no `page` / `per_page` and returns
  no pagination envelope — see [`shared/pagination.md`](../../../shared/pagination.md) for the
  endpoints that *are* paginated. Size the result with `limit` instead (1-50, default 10). The best
  matches come first, so the default is usually enough for a lookup.
- Product `id` is the stable key other skills expect (e.g. `product_id` on a sales-order line).
  Prefer passing `id` downstream over re-resolving by SKU each time.

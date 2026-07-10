Use this skill to take product information from **any** source and land it as products in SKU.io.
The source is whatever the user has — a spreadsheet or CSV, a Google Sheet, a supplier price
list, a PDF or email attachment, a website/product page, or pasted text. Your job is to turn that
into clean SKU.io products without duplicates or invented data.

The source varies; the destination is always the same. So the pipeline is:

```
Extract → Map → De-duplicate → Validate → Load → Verify → Report
```

Work through it in order. Don't skip de-duplication or validation — they're what keep the catalog
clean.

## Step 1 — Extract: get to a normalized rows table

Get the raw product data out of the source using **your own tools** (file readers, a browser, a
Sheets/Drive integration, PDF/vision) — the SKU.io API is not involved yet. The goal is a single
in-memory table where **one row = one product** (or one variant — see the matrix note) with
consistent columns.

Source-specific tips:

- **CSV / Excel (.xlsx)** — read the file; the first row is usually headers. Watch for merged
  cells, multiple sheets, subtotal/blank rows, and thousands separators in numbers.
- **Google Sheet** — export/read it as CSV (or use a Sheets tool). Confirm which tab holds the data.
- **Email attachment / PDF** — extract the attachment first, then parse it as the file type it is
  (spreadsheet, PDF table, etc.). For a scanned/PDF table, use vision/OCR and re-check numbers.
- **Website / product page** — fetch the page(s) and pull out name, SKU, price, images, specs. Be
  precise about which price (retail vs sale) and capture image URLs.
- **Pasted text / freeform** — structure it into the same columns before continuing.

Deliverable of this step: a normalized table plus a note of what each source column appears to mean.

## Step 2 — Map source columns onto SKU.io fields

Map your normalized columns to the create-product body. Fields:

| SKU.io field | Required? | Notes |
| --- | --- | --- |
| `sku` | **Yes** | Unique. If the source has no SKU, derive a stable one (e.g. from brand+name+variant) and tell the user how you generated it. |
| `type` | **Yes** | Usually `standard`. Others: `bundle`, `kit`, `matrix` (variants), `blemished`, `manufactured`. |
| `name` | Recommended | Product title. |
| `barcode` | Optional | UPC/EAN/GTIN. |
| `brand_name` | Optional | SKU.io links or creates the brand by name. |
| `unit_cost` | Optional | Cost of goods (what you pay). |
| `default_price` | Optional | Selling price. |
| `default_supplier_price` | Optional | Supplier's price. |
| `weight` + `weight_unit` | Optional | `weight_unit` ∈ {lb, g, kg, oz}. |
| `length`/`width`/`height` + `dimension_unit` | Optional | `dimension_unit` ∈ {in, cm, mm}. |
| `images[]` | Optional | Each `{ url, name?, sort_order?, is_primary?, download? }`. Set `download: true` to have SKU.io host the image from the URL. |
| `suppliers[]` | Optional | Each `{ supplier_id or supplier_name, is_default?, supplier_sku?, leadtime?, minimum_order_quantity? }`. |
| `pricing[]` | Optional | Tiered pricing: `{ product_pricing_tier_id or product_pricing_tier_name, price }`. |

> **Note on `default_price`:** it seeds the account's **default pricing tier** (often named
> "Retail") as that tier's price. The value is stored as a tier price, so it may come back `null`
> in the `default_price` field of a `by-sku` response even though it saved correctly — verify via
> the product's pricing if you need to confirm. `unit_cost` is a direct column and echoes back.

Mapping rules:

- **Clean numbers.** Strip currency symbols, thousands separators, and units before sending
  numeric fields (`"$1,299.00"` → `1299.00`; `"12 oz"` → `weight: 12, weight_unit: oz`).
- **Cost vs price.** `unit_cost` is what you pay; `default_price` is what you sell for. Don't
  conflate them — if the source only gives one, map it to the correct field and leave the other blank.
- **Don't invent data.** If a barcode, price, or weight isn't in the source, leave the field out.
  Never fabricate a barcode or guess a price.
- **Units.** Coerce weight/dimension units to the allowed values; if the source uses something
  else (e.g. `lbs`, `inches`), normalize to `lb` / `in`.

## Step 3 — De-duplicate against the existing catalog

Before creating anything, check what's already there so a re-run doesn't create duplicates:

- For each mapped `sku`: `GET /api/products/by-sku?sku=...` → a `200` match means it already exists.
- If the row has a barcode: `GET /api/products/barcode-lookup?code=...` (the query param is `code`).

Decide per row: **create** (no match) or **skip** (already exists). Updating existing products is
out of scope for this skill — report skips so the user can decide. (For richer lookups, the
`find-product` skill covers search by name.)

## Step 4 — Validate before the write

1. `GET /api/products/constants` to fetch the live valid `product_types`, `weight_units`, and
   `dimension_units`, and check every mapped row against them.
2. Confirm every row has the two required fields (`sku`, `type`) and no duplicate SKUs within the
   batch itself.
3. **Canary:** create **one** representative product first (Step 5 for a single row). If it returns
   `201`, your mapping is right; proceed to the rest. If it `422`s, fix the mapping and retry that
   one before touching the batch.
4. **Confirm with the user** before a bulk write: show the count, a sample of 2–3 fully-mapped
   rows, and how many will be skipped as duplicates.

## Step 5 — Load: create the products

Create one product per row:

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/products" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{
    "sku": "WIDGET-BLUE-01",
    "type": "standard",
    "name": "Blue Widget",
    "brand_name": "Acme",
    "barcode": "0123456789012",
    "unit_cost": 4.20,
    "default_price": 12.50,
    "weight": 0.5, "weight_unit": "lb",
    "images": [{ "url": "https://example.com/blue-widget.jpg", "is_primary": true, "download": true }]
  }'
```

See [`examples/create-product.json`](./examples/create-product.json) for a fuller body.

Loop rules:

- Go **sequentially** (or in small batches) so you can attribute each result to its row. Don't
  fire hundreds of concurrent requests.
- **On `422`**, read the `errors` map, record the row + reason, and **keep going** — one bad row
  shouldn't stop the import. See [`shared/errors.md`](../../../shared/errors.md).
- **On `403`**, the token lacks `products:write` — stop and fix the token.
- **On `429`/`5xx`**, back off and retry that row.

## Step 6 — Verify and report

- Re-fetch a couple of created SKUs with `GET /api/products/by-sku` to confirm they landed.
- Give the user a summary: **created**, **skipped (duplicate)**, and **failed** (with the row and
  the reason for each failure). Surface anything you had to derive (generated SKUs, normalized
  units) so they can sanity-check.

## Guardrails

- **De-dupe first, always.** `POST /api/products` is not idempotent and `sku` is unique — a
  second run without the Step 3 check will 422 on every existing SKU (harmless but noisy) or, worse,
  create dupes if you generated new SKUs. Resolve existing products up front.
- **Confirm before bulk writes.** Never mass-create without showing the user the plan first.
- **Don't invent data.** Blank beats wrong. Flag anything you inferred.
- **Variants / matrix products.** If the source has variants (size/color of one product), that's a
  `matrix` parent with variant children carrying attributes — more involved than a flat import.
  For a first pass, either create them as separate `standard` products (if that's acceptable) or
  surface the variant structure to the user and confirm the approach before proceeding. Don't
  silently flatten variants into unrelated products.
- **Large catalogs.** For very large files, SKU.io also has a UI-oriented bulk CSV import
  (`POST /api/products/import/preview` then `POST /api/products/import`, permission
  `products.import`) that uploads a file and a column mapping. The per-product API path above is
  the recommended approach for agents because it gives per-row validation and control; reach for
  the bulk importer only when a human will drive the mapping wizard.

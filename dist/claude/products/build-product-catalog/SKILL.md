---
name: build-product-catalog
description: "Turn product information from any source — a spreadsheet or CSV, a Google Sheet, a supplier price list, a website or product page, or pasted text — into products in SKU.io. Extract the raw rows, map them onto SKU.io's product fields, de-duplicate against the existing catalog, then create the products. Use this to onboard a new catalog, import a supplier's range, or bulk-load products from an external system."
license: MIT
---

# Build a Product Catalog from Any Source

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

- **CSV / Excel (.xlsx)** — a real-world spreadsheet is rarely clean. Before trusting it:
  - **Find the real header row.** Data often starts well below row 1, under a logo, a title block,
    or an "ORDER SUMMARY" section. Locate the row whose cells are the column labels (code, name,
    price, …) and treat everything above it as noise.
  - **Pick the right sheet.** Workbooks usually have several tabs — a summary tab, a blank
    `Sheet1`, and the product tab. Enumerate them and choose the one holding the line items.
  - **Skip non-product rows** — section headers ("SWIM DIAPERS"), sub-totals, and the grand-total
    row at the bottom. A row with a name but no code/price (or a total with no name) is not a product.
  - **Ignore phantom width & junk cells.** Reported dimensions can be huge (hundreds of empty
    columns); embedded image/formula cells read as `#VALUE!` or binary blobs. Read only the
    columns that have real labels.
  - **Normalize as you read** — trim leading/trailing and repeated spaces in names, and coerce
    mixed types (a code may be `150` in one row and `"150"` in the next).
- **Google Sheet** — read/export the right tab as CSV; confirm which tab holds the data.
- **Email attachment / PDF** — get the attachment first (it may arrive base64-encoded — decode it),
  then parse it as the file type it actually is (spreadsheet, PDF table, …). For a scanned/PDF
  table use vision/OCR and re-check every number.
- **Website / product page** — fetch the page(s); pull name, SKU, price, images, specs. Be precise
  about which price (retail vs sale) and capture image URLs.
- **Pasted text / freeform** — structure it into the same columns first.

**Order forms, POs, and quotes are product lists too.** A purchase/order form doubles as a catalog
source — but it mixes **product** columns (code, barcode, name, unit cost, MSRP, pack) with
**order-specific** columns (quantity ordered, line total, order date, ship terms). Map the product
columns; **ignore the order-specific ones** — a "Qty" of 48 is how many were ordered, not a product
attribute.

Deliverable of this step: a normalized table plus a note of what each source column appears to mean
(and which columns you're deliberately ignoring).

## Step 2 — Map source columns onto SKU.io fields

Map your normalized columns to the create-product body. Fields:

| SKU.io field | Required? | Notes |
| --- | --- | --- |
| `sku` | **Yes** | Unique. If the source has no SKU, derive a stable one (e.g. from brand+name+variant) and tell the user how you generated it. |
| `type` | **Yes** | Usually `standard`. Others: `bundle`, `kit`, `matrix` (variants), `blemished`, `manufactured`. |
| `name` | Recommended | Product title. |
| `barcode` | Optional | UPC/EAN/GTIN. |
| `brand_name` | Optional | SKU.io links or creates the brand by name. |
| `unit_cost` | Optional | Cost of goods (COGS) on the product. Set from the vendor's unit cost when importing a supplier list. |
| `default_price` | Optional | Selling price (MSRP/retail). Seeds the default pricing tier. |
| `default_supplier_price` | **Priority** | Supplier **wholesale** price — what you pay the supplier. Fills the supplier's default price tier; needs a `suppliers[]` entry. Fill this whenever the source gives a supplier/vendor cost. |
| `weight` + `weight_unit` | Optional | `weight_unit` ∈ {lb, g, kg, oz}. |
| `length`/`width`/`height` + `dimension_unit` | Optional | `dimension_unit` ∈ {in, cm, mm}. |
| `images[]` | Optional | Each `{ url, name?, sort_order?, is_primary?, download? }`. Set `download: true` to have SKU.io host the image from the URL. |
| `suppliers[]` | Optional | Each `{ supplier_id or supplier_name, is_default?, supplier_sku?, leadtime?, minimum_order_quantity? }`. `supplier_name` must already exist. |
| `attributes[]` | Optional | Custom attributes: each `{ name, value }`. Capture any source info that has no standard field of its own here. Unknown attribute names are auto-created. |
| `pricing[]` | Optional | Tiered pricing: `{ product_pricing_tier_id or product_pricing_tier_name, price }`. |

> **Note on `default_price`:** it seeds the account's **default pricing tier** (often named
> "Retail") as that tier's price. The value is stored as a tier price, so it may come back `null`
> in the `default_price` field of a `by-sku` response even though it saved correctly — verify via
> the product's pricing if you need to confirm. `unit_cost` is a direct column and echoes back.

Mapping rules:

- **A supplier's code is not the product's SKU.** Vendor and supplier order forms usually show the
  *supplier's* item code prominently (often a short number like `150`, `151`, …). That is the
  **supplier SKU** — map it to `suppliers[].supplier_sku`, not to `sku`. The product's own SKU is
  usually the identifier the business owns or the GTIN/EAN/UPC — frequently the barcode column
  sitting right next to the supplier code. When in doubt which column is the real SKU, ask;
  don't assume the most prominent number is it.
- **Clean numbers.** Strip currency symbols, thousands separators, and units before sending
  numeric fields (`"$1,299.00"` → `1299.00`; `"12 oz"` → `weight: 12, weight_unit: oz`).
- **Cost vs price — three distinct fields.** A supplier/vendor price list's "unit cost" is the
  **supplier wholesale price** (what you pay the supplier) → `default_supplier_price` (with that
  supplier in `suppliers[]`), and mirror it to `unit_cost` (COGS) too. A "retail"/"MSRP" column is
  the **sell price** → `default_price`. Prioritise the supplier wholesale price — it's the field
  most often forgotten. Don't collapse all three into one.
- **Capture leftover source columns as attributes — this is the obvious, primary case.** Any column
  the source *explicitly provides* that has no standard field of its own (carton/case pack, cubic
  feet, material, country of origin, care notes, remarks, …) becomes an `attributes[]` entry
  `{ name, value }` under the column's own name — don't drop it just because it's unusual. Explicit
  values like these always become attributes; the name-derivation below is an *additional* fallback,
  only for dimensions the source doesn't already give as their own column.
- **Derive variant attributes from the names — but first read the whole catalog to sense what
  products vary by.** Products in a range share a naming template and differ along a few dimensions.
  Before parsing individual rows, **scan the full set of names together** to infer those dimensions.
  Commonly **size**, **color**, and **style/design**, but also — depending on the catalog —
  **scent**, **flavor**, **material**, **capacity/volume**, **pack count**, **format**, or **finish**.
  Then, for each product, extract its value on each detected dimension into a consistently-named
  attribute (`Size` / `Color` / `Style` / `Scent` / `Pack` / …). Rules:
  - **Assess holistically, extract per row.** The axes come from looking across all the names; the
    values come from each individual name.
  - **Prefer explicit source fields.** Only parse a dimension out of the name when the source doesn't
    already give it as its own column.
  - **Name each dimension consistently** across the whole catalog, so products line up and stay
    filterable (don't call it `Colour` on one row and `Color` on the next).
  - **`Style` in lieu of `Color`** when the differentiator is a named design rather than a colorway —
    many variants have a style but no color.
  - **Keep the brand out of it** (that's `brand_name`, not an attribute), be conservative, and never
    invent a value that isn't in the name.
- **Don't invent data.** If a barcode, price, or weight isn't in the source, leave the field out.
  Never fabricate a barcode or guess a price.
- **Units.** Coerce weight/dimension units to the allowed values; if the source uses something
  else (e.g. `lbs`, `inches`), normalize to `lb` / `in`.
- **Referenced suppliers must already exist.** `brand_name` auto-creates a brand, but a
  `suppliers[].supplier_name` must already be a supplier in SKU.io or the create returns `422`.
  If you're recording a supplier (with its supplier SKU and wholesale price), create that supplier
  first — via Suppliers settings or the suppliers API (needs the `suppliers:write` scope) — then
  reference it by name.
- **Hold out rows you can't complete.** If a row is missing a required field — no real `sku`/
  identifier — don't fabricate one. Set it aside and list it in the final report for the user to
  resolve, and create everything else.

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
  shouldn't stop the import. See [`shared/errors.md`](shared/errors.md).
- **On `403`**, the token lacks `products:write` — stop and fix the token.
- **On `429`/`5xx`**, back off and retry that row.

## Step 6 — Verify and report

- Re-fetch a couple of created SKUs with `GET /api/products/by-sku` to confirm they landed.
- Give the user a summary: **created**, **skipped (duplicate)**, and **failed** (with the row and
  the reason for each failure). Surface anything you had to derive (generated SKUs, normalized
  units) so they can sanity-check.

## Step 7 — Leave a favorited view of what you imported (recommended)

Make the import easy to eyeball: create a **favorited saved view** on the Products table scoped to
the products you just created — the `create-saved-view` skill does exactly this. Isolate the import
(`sortBy: "-created_at"`, or `search`/`filters` on the brand you set) and set `is_user_favorite:
true` so it lands on the favorites bar.

**The view must show every field the import wrote — drop nothing.** Put `id` first, then a column
for each populated field: `sku`, `name`, `brand_name`, `barcode`, `default_supplier_sku`, the
supplier wholesale price `default_supplier_price`, the cost `unit_cost`, the sell price
`default_price`, `created_at`, **and every attribute you set** — each is a real, selectable column
keyed `attribute_<attributeId>` (resolve the attribute ids first). The supplier wholesale price and
the attribute columns default to hidden, so they're the ones most often missed — name them
explicitly.

Then **output the direct link to the view** so the user can click straight into it:
`https://{tenant}.sku.io/v2/products?view=<hash>`, where `<hash>` is the `hash` returned by the
create-saved-view call. Always end the import by giving the user this URL (and the view name).

## Guardrails

- **De-dupe first, always.** `POST /api/products` is not idempotent and `sku` is unique — a
  second run without the Step 3 check will 422 on every existing SKU (harmless but noisy) or, worse,
  create dupes if you generated new SKUs. Resolve existing products up front.
- **Confirm before bulk writes.** Never mass-create without showing the user the plan first.
- **Don't invent data.** Blank beats wrong. Flag anything you inferred.
- **Variants / matrix products.** If the source lists variants (size/colour of one product), you
  have two workable options: (a) import each variant as its own `standard` product and record the
  differentiator (size, colour) as an `attributes[]` entry — clean and fast when every variant
  already has its own SKU/barcode, as most order forms do; or (b) build a `matrix` parent with
  variant children carrying attributes — richer but more involved. Default to (a); use (b) only
  when the user wants a single parent product. Either way, don't silently flatten variants into
  unrelated products.
- **Large catalogs.** For very large files, SKU.io also has a UI-oriented bulk CSV import
  (`POST /api/products/import/preview` then `POST /api/products/import`, permission
  `products.import`) that uploads a file and a column mapping. The per-product API path above is
  the recommended approach for agents because it gives per-row validation and control; reach for
  the bulk importer only when a human will drive the mapping wizard.

## API operations

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/products/constants` | Fetch valid product types and weight/dimension units to validate your mapping against. |
| `GET` | `/api/products/by-sku` | Check whether a SKU already exists (de-duplication) before creating it. |
| `GET` | `/api/products/barcode-lookup` | Check whether a barcode (UPC/EAN/GTIN) already maps to a product. |
| `POST` | `/api/products` | Create one product in the SKU.io catalog. |

## Authentication

Every request authenticates with a SKU.io **Personal Access Token** sent as a Bearer token:

```http
Authorization: Bearer <YOUR_SKU_PAT>
```

- **Base URL:** `https://{tenant}.sku.io` (replace `{tenant}` with your account subdomain)
- **Required scopes:** `products:write`, `products:read`

Mint a token under **Settings → Developer → Personal Access Tokens** in the SKU.io web app.
See [`shared/authentication.md`](shared/authentication.md) for the full flow.

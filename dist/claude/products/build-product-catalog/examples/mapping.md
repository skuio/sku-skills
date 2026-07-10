# Example: mapping `source-sample.csv` → SKU.io products

How the messy source columns map onto the create-product body, applying the Step 2 rules.

| Source column | SKU.io field | Transform applied |
| --- | --- | --- |
| `Item Code` | `sku` | Used as-is (already unique per row) |
| `Product Title` | `name` | Trim |
| `Brand` | `brand_name` | Trim |
| `UPC` | `barcode` | Trim; **leave out when blank** (row `GW-07`) — don't fabricate |
| `Cost` | `unit_cost` | Strip `$` and commas → number (`"$4.20"` → `4.20`) |
| `Retail Price` | `default_price` | Strip `$` and commas → number |
| `Weight` | `weight` + `weight_unit` | Split value + unit; normalize (`8 oz` → `8`,`oz`; `1.2 lb` → `1.2`,`lb`; `150 g` → `150`,`g`) |
| `Case Qty` | `case_quantity` | Number |
| _(none)_ | `type` | Not in source → default to `standard` |

Notes:

- `type` isn't in the source, so every row defaults to `standard`.
- `GW-07` has no UPC — the `barcode` field is omitted for that row rather than guessed.
- No image column here, so `images` is omitted. If the source had image URLs, each would become
  `{ "url": "…", "is_primary": true, "download": true }`.
- All three SKUs would be checked with `GET /api/products/by-sku?sku=…` before creating.

The resulting body for the first row is in [`create-product.json`](./create-product.json).

---

## Real-world example: a supplier order form

A common source is a supplier's **order form / PO spreadsheet** — messier than the CSV above, and
the mapping has traps. This is the exact shape that produced
[`create-product.json`](./create-product.json).

The sheet had a title block and an "ORDER SUMMARY" tab; the real header row was ~row 12 of a
`…Swim Diapers` tab, with section headers and a grand-total row mixed in. Columns:

| Source column | SKU.io field | Why |
| --- | --- | --- |
| `Product Code` (e.g. `150`) | `suppliers[].supplier_sku` | It's the **supplier's** code, **not** the product SKU |
| `EAN Code` (e.g. `4897…502`) | `sku` **and** `barcode` | The real product identifier (GTIN), sitting next to the supplier code |
| `Product Name` | `name` | Trim/collapse spaces |
| `Unit Cost (USD)` | `default_supplier_price` **and** `unit_cost` | Supplier **wholesale** price (priority) + COGS |
| `MSRP (USD)` | `default_price` | Sell price → default pricing tier |
| `Carton pack` (`2 inner 2x 24`) | `attributes[].Carton Pack` | No standard field → attribute |
| `Case pack qty/Cu.ft` (`48/2.278`) | `case_quantity` (`48`) + `attributes[].Case Cu.ft` (`2.278`) | Split; the cu.ft has no field → attribute |
| size + color in the name (`…Classic Orange - S`) | `attributes[].Size`, `attributes[].Color` | Parsed from the name **because there are no separate size/color columns**; skip if the source has them |
| `Qty (unit)`, `Total (USD)` | — **ignored** | Order-specific, not product data |
| _(none)_ | `brand_name` | Inferred from the collection/sender; confirmed with the user |

Traps this example encodes: supplier code ≠ SKU; fill the supplier **wholesale** price, not only
`unit_cost`; keep leftover info as **attributes**; parse **size and color out of the product name**
into attributes (only because the source has no separate size/color columns); ignore order-quantity
columns; create the supplier before referencing it; and **hold out** rows with no EAN (no real SKU)
for the user to resolve rather than inventing one.

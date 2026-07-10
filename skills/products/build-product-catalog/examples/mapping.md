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

Use this skill to make sure SKU.io knows **what the business pays** for the products it reorders.
A product with no supplier cost can't be put on a purchase order at the right price, shows a
meaningless margin, and leaves reorder suggestions guessing. This skill fills those gaps.

It is the agent lane for the Launch Roadmap step **Supplier costs**. SKU.io marks that step done on
its own when **at least 95% of active reorderable products have a non-zero supplier price** on any
of their supplier links. "Reorderable" means product types `standard`, `kit`, `manufactured` and
`blemished`, not archived. Bundles are excluded: they're costed from their components. Nothing you
say makes the step done; the data does.

This skill fills **missing** costs. When a supplier sends a *new* price file for products that
already have costs, that's `update-catalog-pricing` (match, diff, reprice). The two share the same
write.

The pipeline:

```
Measure → Find the gaps → Gather costs (price lists first, past POs second) → Match
  → Propose → Approve → Write (≤25 per batch) → Verify → Report
```

## Step 1 — Measure

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/product-data-health/metrics" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
# → { "products_with_supplier": 812, "products_without_supplier": 96,
#     "products_with_non_zero_supplier_price": 640, "products_with_zero_supplier_price": 172,
#     "default_supplier_pricing_tier_name": "Wholesale", ... }
```

Keep `default_supplier_pricing_tier_name`. It's the tier to use for a brand-new supplier link
(Step 6). Tell the user roughly where they stand, and how many products separate them from 95%.
Often the last few percent are discontinued items that should be archived rather than costed; say
so, and let the user archive them in the app.

## Step 2 — Find the products without a supplier cost

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/v2/products?filter[type]=standard,kit,manufactured,blemished&filter[supplier_price.is_empty]=1&per_page=100&page=1" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

Iterate `page` to `last_page`, and drop rows with `archived_at` set. The filter looks at the
**default** supplier only, so treat the result as candidates:

- `default_supplier_id` is null → the product has **no default supplier**. It may still have a
  non-default link; check with `GET /api/products/{productId}/suppliers`.
- `default_supplier_id` is set, `default_supplier_price` empty → the link exists with no price.
- A product whose only price is **0** isn't in this list, and doesn't count toward the 95% either.
  Pull those with a plain listing and look for `default_supplier_price` of `0`.

For any product you're about to propose a cost for, read its links once:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/products/45/suppliers" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
# → data[]: { supplier_id, supplier: {...}, supplier_sku, is_default,
#             pricing: [ { id: 2, name: "Wholesale", value: 0, currency: "USD", is_default: true } ] }
```

If **any** link already has a price above zero, the product already counts. Skip it.

## Step 3 — Gather costs: price lists first

Ask the user for their suppliers' **price lists, quotes or invoices**: spreadsheets in Drive,
email attachments, PDFs, the supplier portal export. Read them with your own tools and normalize to
`supplier, supplier item code, description, unit cost, currency, pack size, effective date`. The
extraction rules in `update-catalog-pricing` (Step 1) apply in full: pick the column that is
*your* net cost, not List/MSRP; compute net from a stated discount and say so; treat blank-price and
"USE <other item>" rows as discontinued, never as zero.

Resolve each supplier: `GET /api/v2/suppliers?search=Acme`. If a supplier on the list doesn't
exist in SKU.io, stop for that supplier and tell the user to create it (Suppliers in the app):
this skill doesn't create suppliers.

## Step 4 — …then past purchase orders

For gap products no price list covers, the business has often bought them before:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/products/45/last-purchase-price" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
# → { "data": { "amount": 4.2, "purchase_order_id": 3120, "purchase_order_date": "2026-06-02" } }
#   or { "data": null } when it has never been on a non-draft PO
```

That answer doesn't say **who** it was bought from or in what currency. Read the PO before you
use it:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/purchase-orders/3120" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

Mark these rows **"from PO-… dated …"** in the proposal. A price paid fourteen months ago, or in
another currency, is a weak guess. Flag it, and let the user decide whether it stands.

Never use the product's `unit_cost` or average cost as the supplier price. Those are what stock
cost after freight and duty, not what the supplier charges.

## Step 5 — Match and propose

Match price-list rows to gap products by: product `sku` = item code → the link's `supplier_sku` =
item code → `mpn` → `barcode`. Exact matches only; a near match (`GSS342` vs `GSS342G3`) goes to the
user as a question. When a list is in **case or pack** units and the product is stocked in
eaches, divide, and show the arithmetic.

Show the plan before any write:

| # | Product | Supplier | Tier | Cost | Source | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | WIDGET-BLUE-01 | Acme Wholesale | Wholesale | 4.20 | Acme price list 2026-09.xlsx, row 88 | |
| 2 | GIZMO-RED | Acme Wholesale | Wholesale | 11.50 | PO-3120, 2026-06-02 | **from a past PO** |
| 3 | BOLT-M6 | Fastener Co | Wholesale | 0.11 | Fastener quote.pdf | **new supplier link**: no supplier yet |

Then: products **still without a source** (the user's to answer), discontinued rows, near matches,
the projected coverage ("this takes you from 79% to 96%"), and the number of batches. Get an
explicit yes. Rows from past POs and new supplier links each need to be visible in what the user
approves, not buried.

## Step 6 — Write (≤25 per batch)

One `PUT /api/products/{id}` per product, sending **only** `suppliers[]`:

```bash
curl -sS -X PUT "https://$SKU_TENANT.sku.io/api/products/45" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{
    "suppliers": [{
      "supplier_id": 7,
      "operation": "updateOrCreate",
      "pricing": [{ "supplier_pricing_tier_name": "Wholesale", "price": 4.20 }]
    }]
  }'
```

Rules for the write:

- **`operation: "updateOrCreate"` on every `suppliers[]` entry, every time.** Without it, the API
  treats the array as the complete supplier list and **unlinks every supplier you didn't mention**.
- **Use a tier name you read from the data.** For an existing link, take the name from that link's
  `pricing[]`; for a new link, use `default_supplier_pricing_tier_name` from Step 1. An unrecognized
  name doesn't fail: it **creates a new pricing tier**, so a typo leaves the account with a junk
  tier and the cost on the wrong one.
- **New supplier link** (the product has none for that supplier): the same call creates it. Add
  `supplier_sku` when the list gives the item code. Add `"is_default": true` only when the product
  has no default supplier at all and the user agreed.
- `price` is numeric, `>= 0` and `< 100000`. Keep the precision the list gives (sub-cent costs
  are real); strip currency symbols and thousands separators. Never send `0` or `null` to mean
  "unknown".
- After each batch of ≤25, post a progress line (written / failed / remaining). On `422` read the
  `errors` map, record the row, carry on. On `403` stop: the token lacks `products:write`. On
  `429`/`5xx` back off and retry that row; the write is idempotent.

## Step 7 — Verify and report

- Re-read 2–3 products with `GET /api/products/{productId}/suppliers` and confirm the price sits on
  the intended supplier and tier.
- Re-run the Step 1 metrics and show coverage before → after against the 95% target.
- Report: **costed** (product, supplier, cost, source), **from past POs** (listed separately),
  **new supplier links**, **still missing** (with what would close each), **failed** (with the API
  message).

Working a Launch Roadmap step? Hand this summary to `follow-launch-roadmap` to post as the step's
progress comment.

## Connected through the SKU.io MCP server?

The reads work through `api_read`. For the write, use the server's **`update_product_pricing`**
tool: it wraps the same `PUT /api/products/{id}`. Pass `suppliers` exactly as in Step 6, with
`operation: "updateOrCreate"` on every entry (the server refuses a list without it). It needs the
connection's products write access; if the server says that's missing, tell the user to reconnect
and grant it.

## Guardrails

- **Propose before writing.** No cost lands until the user has approved the Step 5 table.
- **Fill gaps only.** Don't overwrite a non-zero cost here. A changed price on a product that
  already has one is `update-catalog-pricing`'s diff-and-confirm job.
- **Never unlink, never delete.** No `operation: "delete"`, no supplier list without
  `updateOrCreate`, no tier removal.
- **Blank beats wrong.** No cost from `unit_cost`, average cost, a sell price, or a guess. A product
  you can't source stays on the "still missing" list.
- **Don't create suppliers or tiers on purpose, or by typo.** Resolve suppliers by search; use tier
  names read from the account.
- **Batch ≤25, report each batch**, and finish with exactly what changed.

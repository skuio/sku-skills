# Map Supplier Costs onto Reorderable Products

_Fill in what the business pays its suppliers for every product it reorders, until at least 95% of active reorderable products (standard, kit, manufactured, blemished) carry a non-zero supplier price. Finds the products with no supplier pricing, sources each cost from the user's supplier price lists (files in their Drive or email) or, failing that, from the last price paid on a past purchase order, proposes a cost table for approval, then writes the supplier tier prices in batches of at most 25 and reports what changed. Use it for the Launch Roadmap's "Supplier costs" step or when the Product Data Health report shows products without supplier pricing. It fills gaps; it never unlinks suppliers or deletes prices. To apply a supplier's new price file to products that already have costs, use update-catalog-pricing._

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

## Step 0 — Connect first

Every call below authenticates as a SKU.io **Personal Access Token** against one specific
tenant, so two things have to be true before Step 1: `$SKU_TENANT` and `$SKU_PAT` are set, and
that token actually carries `products:read`, `products:write`, `suppliers:read`, `purchase-orders:read`.

If you cannot confirm both, **run the `connect-to-sku` skill first** rather than trying a call
to see what happens. It mints the token, confirms the tenant is the one the user meant, and reads
the scopes back off the token — so a missing scope surfaces now, in one exchange with the user,
instead of as a `403` midway through with half the work already committed. If that skill is not
installed alongside this one, its instructions are at <https://github.com/skuio/sku-skills/tree/main/skills/platform/connect-to-sku>.

Never invent a tenant or a token, and never quietly fall back to a different tenant than the one
the user named. Writing to the wrong account is the one mistake here the API cannot undo for you.

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

## API operations

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/product-data-health/metrics` | Catalog health counts, including products_with_supplier, products_without_supplier, products_with_non_zero_supplier_price and products_with_zero_supplier_price. |
| `GET` | `/api/v2/products` | Bulk-read the catalog. Rows include sku, name, type, archived_at, unit_cost, default_supplier_id, default_supplier_name, default_supplier_sku and default_supplier_price. filter[supplier_price.is_empty]=1 narrows to products whose default supplier link has no price (or that have no default supplier at all). |
| `GET` | `/api/products/{productId}/suppliers` | A product's supplier links, each with supplier_sku, is_default and its pricing tiers (tier name and price). This is where the account's real tier name comes from, and it shows prices on non-default suppliers that the list filter can't see. |
| `GET` | `/api/v2/suppliers` | Resolve a supplier named on a price list to its supplier id. |
| `GET` | `/api/products/{product}/last-purchase-price` | The most recent non-draft purchase order line for the product with a price above zero: { amount, purchase_order_id, purchase_order_date }, or data null when it was never bought. |
| `GET` | `/api/purchase-orders/{purchase_order}` | Read the purchase order behind a last purchase price, to learn which supplier it was bought from and in what currency before proposing it as that supplier's cost. |
| `PUT` | `/api/products/{id}` | Write a supplier cost onto one product. Send only suppliers[], with operation "updateOrCreate" on every entry so no other supplier link is touched. Creates the supplier link when the product has none for that supplier. |

## Authentication

Every request authenticates with a SKU.io **Personal Access Token** sent as a Bearer token:

```http
Authorization: Bearer <YOUR_SKU_PAT>
```

- **Base URL:** `https://{tenant}.sku.io` — replace `{tenant}` with your account subdomain.
  The subdomain may itself contain a dot (beta and staging accounts often do), so take
  **everything** before `.sku.io` in the URL you sign in at, not just the first label.
- **Required scopes:** `products:read`, `products:write`, `suppliers:read`, `purchase-orders:read`

Mint a token under **Settings → Developer → Personal Access Tokens** in the SKU.io web app.
See [`shared/authentication.md`](https://github.com/skuio/sku-skills/blob/main/shared/authentication.md) for the full flow.

---

## Improve this skill

Did this skill fall short—an unclear step, a wrong endpoint, or something it couldn't finish? Don't
just work around it: capture what was off and open a pull request so the next agent does better.

- Repo: <https://github.com/skuio/sku-skills>
- Edit the **canonical** skill under `skills/<domain>/<name>/` (not this generated file), then run
  `npm run build` and open a PR. External contributors: fork the repo and PR from the fork.
- The full agent workflow is in [`AGENTS.md`](https://github.com/skuio/sku-skills/blob/main/AGENTS.md).

Your agent can do this end to end. The library gets better every time someone sends a fix.

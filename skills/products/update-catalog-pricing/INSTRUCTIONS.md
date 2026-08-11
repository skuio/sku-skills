Use this skill when new pricing arrives for products that **already exist** in SKU.io — most
commonly a supplier's "new price file effective &lt;date&gt;" email, but also an internal reprice of
sell prices. The job is to land the new numbers on the right products, visibly and reversibly:
match, diff, confirm, apply, report. This skill never creates products — rows with no matching
product are reported, not imported (that's `build-product-catalog`).

The pipeline:

```
Extract → Match → Diff → Confirm → Apply → Verify → Report
```

## Cost side vs sell side — decide up front

A price file touches one or both of two very different things:

- **Supplier pricing tiers** — what **you pay**. Lives on the product↔supplier link
  (`suppliers[].pricing[]`). A supplier's price file updates **this**.
- **Product pricing tiers** — what **you charge** (`pricing[]`, e.g. a "Retail"/"Default" tier).
  Only touch these when the user explicitly wants sell prices synced (e.g. adopting the file's
  MSRP column).

A supplier cost file alone must not silently change sell prices — repricing what customers pay is
a separate business decision. Note that neither of these rewrites `unit_cost`/`average_cost` on
existing stock: actual costs flow from purchase receipts (FIFO layers). The supplier tier is the
*forward-looking* cost used for new POs and margin planning.

## Step 1 — Extract the price rows

Get the file (email attachment, spreadsheet, PDF) into one normalized table with your own tools.
The usual spreadsheet hazards apply — header row buried under a title block, multiple tabs, junk
columns (see `build-product-catalog` for the full extraction checklist). Price-file specifics:

- **Identify which column is *your* cost.** Distributor files carry a whole price ladder — List,
  Retail, Jobber, WD (warehouse distributor), and often a customer-specific net column (e.g.
  "&lt;Your company&gt; Cost"). The customer-named net column is your cost; if there is only a gross
  column plus a stated discount ("less 15%"), compute the net and say so in the report.
- **Capture the effective date** from the file or email — it goes in the report and the
  confirmation prompt.
- **Keep the supplier's item number *and* any "customer item number"** column — both are match
  keys.
- **Blank-price rows are signal, not noise.** A row whose price columns are empty, or whose
  description says "USE &lt;other item&gt;", is a **discontinued/superseded** item. Never write a
  zero or null price from such a row — flag it (see Step 3).

## Step 2 — Match rows to existing products

Resolve the supplier first (`GET /api/v2/suppliers?search=...`) — you need its id both for
matching and for the write.

Bulk-pull the catalog once (`GET /api/v2/products?per_page=500`, iterate `page` to `last_page`)
rather than probing row by row; the rows carry every match key. Match each price-file item against
products by this ladder, normalizing case and whitespace:

1. **Product `sku`** equals the item number (or customer item number).
2. **`default_supplier_sku`** (or any supplier link's `supplier_sku` via
   `GET /api/products/{productId}/suppliers`) equals the item number.
3. **`mpn`**, then **`barcode`**.

Rules:

- **Exact matches only get auto-applied.** A near match — same stem with a new suffix (the
  classic case: a manufacturer supersedes `GSS342` with `GSS342G3`) — is a *candidate successor*,
  not a match. Put it in the review list with both part numbers and the price; let the user
  decide whether the catalog product should now track the successor item.
- One product per row and one row per product. If two rows hit the same product (item number and
  customer item number both present and different), prefer the customer item number and note it.
- Products **linked to this supplier** that match *no* row in the new file are themselves a
  finding — the supplier may have dropped them. List them; don't touch their prices.

## Step 3 — Diff before anything writes

Build the change set and show it. For each matched product, read the current supplier tier from
the bulk pull (`default_supplier_price`) or `GET /api/products/{productId}/suppliers` — the
`pricing` array on the link gives the **tier name** and current value.

> **Read the tier name from the data — do not assume it.** Accounts name their supplier tier
> differently ("Wholesale", "Default", …). Use the name that's already on the link; only fall
> back to the supplier's default tier when a link has no tier yet.

The diff to present:

| Bucket | What to show |
| --- | --- |
| **Updates** | product, old → new price, % change. Call out big movers (>±10%). |
| **Unchanged** | count only. |
| **Discontinued rows** | file rows with blank prices / "USE &lt;x&gt;" — with the pointed-to successor if stated. |
| **Successor candidates** | near matches (`GSS342` → `GSS342G3`) awaiting a human call. |
| **Unmatched file rows** | items you don't stock (usually most of a distributor's full file — a count and a sample is fine). |
| **Supplier-linked products absent from the file** | possibly dropped by the supplier. |

## Step 4 — Confirm

Pricing is money-adjacent: **never bulk-write without the user seeing the diff** — the update
count, the big movers, and the effective date. Small runs (a handful of SKUs the user already
enumerated) can proceed directly.

## Step 5 — Apply

One `PUT /api/products/{id}` per product. Cost side:

```bash
curl -sS -X PUT "https://$SKU_TENANT.sku.io/api/products/45" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{
    "suppliers": [{
      "supplier_id": 1,
      "operation": "updateOrCreate",
      "pricing": [{ "supplier_pricing_tier_name": "Wholesale", "price": 81.82 }]
    }]
  }'
```

Sell side (only when in scope): add `"pricing": [{ "product_pricing_tier_name": "Retail",
"price": 129.99 }]`.

Hard rules for the write:

- **Set `operation: "updateOrCreate"` on every `suppliers[]` entry.** When no entry carries an
  `operation`, the API treats the array as the *complete* supplier list and **unlinks every
  supplier you didn't mention** — a pricing update must never change supplier links.
- Tier `price` is required on each `pricing[]` entry, numeric, `>= 0` and `< 100000`;
  `price: null` is a 422. Round to the currency's precision; strip symbols and separators.
- Send **only** the fields you mean to change — everything on PUT is optional, and omitted
  fields are left alone.
- Go sequentially (or small batches). On `422` read the `errors` map, record the row, keep
  going. On `403` stop — the token lacks `products:write`. On `429`/`5xx` back off and retry.
  See [`shared/errors.md`](../../../shared/errors.md).

## Step 6 — Verify and report

- Re-read 2–3 updated products (`GET /api/products/{productId}/suppliers`) and confirm the tier
  now shows the new value.
- Report: **updated** (with old → new), **skipped** (unchanged), **flagged** (discontinued rows,
  successor candidates, unmatched, supplier-linked-but-absent), **failed** (row + reason).
- Optional but recommended: leave a favorited saved view (the `create-saved-view` skill) on the
  Products table pinned to **exactly the products you updated**. The only filter channel the
  Products page reliably loads from a saved view is `filterGroups` — a base64 advanced-filter
  tree. Pin by SKU (numeric `id` is not a registered tree column):
  `base64({"conjunction":"and","children":[{"type":"condition","condition":{"column":"sku",
  "operator":"is_one_of","value":"<comma-joined SKUs>"}}]})`. Do NOT use `filters` keys like
  `ids` or `default_supplier_id` — they save fine and are silently dropped on load. Verify with
  `GET /api/v2/products?filter_groups=<base64>` (expect exactly your rows), show
  `default_supplier_price`, and give the user the direct
  `https://{tenant}.sku.io/v2/products?view=<hash>` link.

## Guardrails

- **Never create products here.** Unmatched rows are a report line, not an import queue.
- **Never delete or unlink** — no `operation: "delete"` in a pricing run, ever.
- **Blank beats wrong.** A discontinued row's empty price is information; writing 0 would poison
  POs and margin math.
- **Bundles/kits don't roll up automatically.** A bundle's supplier tier stores its own number;
  updating component prices does not recompute it. After a component reprice, list the affected
  bundles/kits and their stored prices so the user can decide whether to restate them.
- **Idempotent by design** — re-running the same file yields "unchanged" rows, not double
  changes. Safe to resume after a partial failure.

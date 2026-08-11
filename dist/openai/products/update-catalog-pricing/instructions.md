# Update Catalog Pricing from a Price File

_Apply a new price file to products that already exist in SKU.io — a supplier's updated wholesale/cost list, a new MSRP sheet, or any repriced list. Match each row to an existing product (SKU, supplier SKU, MPN, or barcode), diff old vs new prices, get the user's confirmation, then update supplier pricing tiers (what you pay) and/or product pricing tiers (what you charge). Use this when a supplier sends "new pricing effective <date>" or the business reprices a range; it never creates products (that is build-product-catalog)._

Use this skill when new pricing arrives for products that **already exist** in SKU.io — most
commonly a supplier's "new price file effective &lt;date&gt;" email, but also an internal reprice of
sell prices. The job is to land the new numbers on the right products, visibly and reversibly:
match, diff, confirm, apply, report. This skill never creates products — rows with no matching
product are reported, not imported (that's `build-product-catalog`).

The pipeline:

```
Extract → Match → Diff → Confirm → Apply → Verify → Report
```

## Step 0 — Connect first

Every call below authenticates as a SKU.io **Personal Access Token** against one specific
tenant, so two things have to be true before Step 1: `$SKU_TENANT` and `$SKU_PAT` are set, and
that token actually carries `products:read`, `products:write`, `suppliers:read`.

If you cannot confirm both, **run the `connect-to-sku` skill first** rather than trying a call
to see what happens. It mints the token, confirms the tenant is the one the user meant, and reads
the scopes back off the token — so a missing scope surfaces now, in one exchange with the user,
instead of as a `403` midway through with half the work already committed. If that skill is not
installed alongside this one, its instructions are at <https://github.com/skuio/sku-skills/tree/main/skills/platform/connect-to-sku>.

Never invent a tenant or a token, and never quietly fall back to a different tenant than the one
the user named. Writing to the wrong account is the one mistake here the API cannot undo for you.

## Cost side vs sell side — decide up front

A price file touches one or both of two very different things:

- **Supplier pricing tiers** — what **you pay**. Lives on the product↔supplier link
  (`suppliers[].pricing[]`). A supplier's price file updates **this**.
- **Product pricing tiers** — what **you charge** (`pricing[]`, e.g. a "Retail"/"Default" tier).
  Only touch these when the user explicitly wants sell prices synced (e.g. adopting the file's
  MSRP column).

A supplier cost file alone must not silently change sell prices — repricing what customers pay is
a separate business decision. Note that neither of these rewrites `average_cost` or the FIFO
layers on existing stock: actual costs flow from purchase receipts. The supplier tier is the
*forward-looking* cost used for new POs and margin planning.

`unit_cost` (the product's "default cost") is a separate, directly-writable field on
`PUT /api/products/{id}` (accepted on update even where docs omit it). Some accounts keep
`unit_cost` = current wholesale — read the existing rows to see if they track the supplier tier,
and ask the user whether to align `unit_cost` alongside the tier. When yes, set it in the same
PUT for every product you reprice (standards and combos alike). Watch for cross-contaminated
values while aligning: a genuine part whose `unit_cost` was copied from a cheap generic
equivalent will show a huge jump — verify against the file row and report it rather than
assuming the file is wrong.

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
- **When the user approves a successor, write it into `supplier_sku` in the same PUT** that
  applies the price (`suppliers[].supplier_sku` alongside `pricing[]`). The product's own SKU
  stays put (listings and history keep their identity); the supplier link carries the
  supplier's current part number — which is exactly the key Step 2 matches on, so the next
  price file matches automatically instead of re-flagging the same drift. Backfill
  `supplier_sku` with the file's item number on any matched link that has none, for the same
  reason.
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
  See [`shared/errors.md`](https://github.com/skuio/sku-skills/blob/main/shared/errors.md).

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
- **Bundles/kits don't roll up automatically — restate them only with approval, and by this
  procedure.** A combo's supplier tier stores its own number; updating component prices does not
  recompute it. When the user wants combos restated: new value = Σ(component price × quantity)
  from the product's `components[]`, where each component contributes **its own supplier's**
  current price (house combos often mix the repriced supplier's parts with cheap hardware from a
  different supplier — use each component's `default_supplier_price`, falling back to its
  `unit_cost` only when it has no supplier tier, and flag that row). Write the sum to the combo's
  supplier tier and — if the account's convention is unit_cost = wholesale, which you can read
  off the existing rows — to `unit_cost` in the same PUT.
- **A product that itself matched a price-file row is NEVER a roll-up candidate.** Suppliers
  sell some assemblies as catalog items (they're `kit`/`bundle` typed in SKU.io *and* have their
  own file row); the supplier's own price for the assembly wins over any sum of parts. Partition
  first — file-priced products take the file price, only the leftovers roll up — or the roll-up
  pass will silently overwrite correct file prices with component-sum estimates.
- **Blemished offshoots don't roll up either.** With approval, scale the blemished product's
  tier by its historical discount ratio against the original product's old price, and say so in
  the report.
- **Idempotent by design** — re-running the same file yields "unchanged" rows, not double
  changes. Safe to resume after a partial failure.

## API operations

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/v2/suppliers` | Resolve the supplier named on the price file to its supplier id. |
| `GET` | `/api/v2/products` | Bulk-fetch the current catalog for matching and diffing. Rows include sku, mpn, barcode, default_supplier_id, default_supplier_sku, default_supplier_price, unit_cost, and type. |
| `GET` | `/api/products/by-sku` | Targeted existence check for a single row when a bulk pull is overkill. |
| `GET` | `/api/products/{productId}/suppliers` | Read a product's supplier links, including each link's supplier pricing tiers — this is where the account's actual tier name (e.g. "Wholesale") and current price come from. |
| `PUT` | `/api/products/{id}` | Write the new prices. Cost side goes in suppliers[].pricing[] (tier name + price, with operation "updateOrCreate" on EVERY entry so omitted suppliers are not unlinked); sell side goes in pricing[] (product_pricing_tier_name + price). All fields optional. |

## Authentication

Every request authenticates with a SKU.io **Personal Access Token** sent as a Bearer token:

```http
Authorization: Bearer <YOUR_SKU_PAT>
```

- **Base URL:** `https://{tenant}.sku.io` — replace `{tenant}` with your account subdomain.
  The subdomain may itself contain a dot (beta and staging accounts often do), so take
  **everything** before `.sku.io` in the URL you sign in at, not just the first label.
- **Required scopes:** `products:read`, `products:write`, `suppliers:read`

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

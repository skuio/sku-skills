# Set Initial Inventory

_Load opening stock into SKU.io as an initial (first-ever) count for one or more warehouses, dated to the account's inventory start date. Use this when going live on SKU.io, onboarding a new warehouse or 3PL, or importing an opening count sheet: it settles the inventory start date (taking it from an explicit date in the source data, or asking the user outright — the value configured in settings is often a stale placeholder and is treated as a default to confirm, never as authority), turns the count sheet into one initial stock take per warehouse, and drives each through draft → open → closed so the opening quantities and their cost layers land. An initial count can only happen once per warehouse and cannot be re-dated afterwards, so the date and the unit costs must be right before you finalize. For routine cycle counts, recounts, or one-off corrections use adjust-inventory instead._

Use this skill to load a business's **opening stock** into SKU.io — the first-ever count for one or
more warehouses — and to get it dated to the account's **inventory start date**. This is the go-live
step: it seeds every product's on-hand quantity and creates the cost layers everything downstream
(COGS, valuation, margin, the accounting opening balance) is built on.

It is **not** for routine counting. A quarterly cycle count, a recount, or a one-off correction is
`adjust-inventory` or a plain non-initial stock take.

Three facts shape everything below:

- **An initial count happens once per warehouse** (per `condition`), and the API enforces it.
- **An initial count cannot be re-dated after it is finalized.** Ordinary stock takes can be moved;
  initial ones cannot. So the date has to be right *before* you finalize, not after.
- **The date configured in settings is frequently wrong**, and reading it back is not confirmation.
  The date must come from the source data or from the user — see Step 1. Combined with the point
  above, an unconfirmed date is a permanent error.

The pipeline, per warehouse:

```
Settle the start date → Resolve warehouse → Check uniqueness → Build lines → Price them
  → Create draft → Initiate (snapshot) → Confirm → Finalize → Verify
```

## Step 1 — Settle the inventory start date

The inventory start date is an account-level setting: the line in the sand before which SKU.io
doesn't track inventory. Orders before it are excluded from fulfillment, integrations sync from it,
and the accounting opening balance is anchored to it. **Initial counts are dated to it** — in the
SKU.io UI the count-date field for an initial count is read-only and filled from this setting.

Read what's configured:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/stock-takes/inventory-start-date" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
# → {"inventory_start_date":"2026-01-01"}   (null / absent = not configured)
```

In parallel, work out what the **source data implies**, in this order of strength:

1. An explicit "as at" / "as of" / "stock on hand at" date in the count sheet header or file
   metadata — the strongest signal, this is the moment the stock was physically true.
2. A date the user states directly ("we go live on the 1st", "this is the count from month-end").
3. A date in the filename or tab name ("Opening Stock 2026-01.xlsx") — weak; treat as a suggestion
   to confirm, not a fact.

> **A configured start date is not evidence.** In practice it is very often wrong — a placeholder
> dropped in during account setup, or a trial-era date nobody revisited. Reading a value back from
> settings tells you what the account *says*, not when the stock was actually true. Treat it as a
> default to confirm, never as authority.

So the date must come from one of exactly two places:

1. **An explicit date in the source data** — an "as at" / "as of" header, or the user stating it
   directly. This is real evidence.
2. **The user, asked outright.** If the source doesn't carry one, ask. Always.

Then reconcile against what's configured:

| Configured | Source data | Do this |
| --- | --- | --- |
| Set | Explicit date, same day | Proceed. Echo the date back in your plan. |
| Set | Explicit date, different day | **Stop and ask.** One of them is wrong. Show both and let the user say which is real — don't pick, and don't average. |
| Set | Nothing explicit | **Ask the user to confirm the actual date.** Show them what's configured, but as a value to verify, not one to proceed on. A silent "the setting said so" is how a whole account ends up counted on the wrong day. |
| Not set | Explicit date | Propose it, get an explicit yes, then write it (below). |
| Not set | Nothing | **Ask the user for the date.** Never default to today. |

**If the confirmed date differs from the configured one, stop before creating anything.** The
setting is what the count is dated to, and it also drives order import, integration sync windows,
and the accounting opening balance — so a mismatch is not a local problem you can route around by
passing a different `date_count`. Surface the discrepancy, explain that the setting itself needs
correcting first, and let the user decide (see the constraints on rewriting it below).

When it isn't configured, write it once the user has confirmed the exact date:

```bash
curl -sS -X PUT "https://$SKU_TENANT.sku.io/api/v2/settings/inventory" \
  -H "Authorization: Bearer $SKU_PAT" -H "Content-Type: application/json" \
  -d '{"inventory_start_date":"2026-01-01"}'
# → the updated inventory settings group
```

- Requires the `settings:write` scope **and** the token owner's `settings.update` permission — a
  `403` here means one of the two is missing, not that the date is wrong.
- **Send only `inventory_start_date`.** The endpoint writes whatever properties the body carries, so
  a wider payload silently rewrites unrelated inventory settings.
- **Only write it when it is unset.** Changing an already-configured start date moves the line in the
  sand for order import, integration sync windows, and the effective accounting start date. If it is
  set and the user has confirmed a different day, do **not** quietly overwrite it. Say plainly what
  is configured, what they confirmed, and what else moves if it changes — then let them decide. If
  they explicitly authorise the correction, make it in the same narrow way (only
  `inventory_start_date`), read it back, and confirm the new value before creating any take. An
  unconfirmed rewrite of this field is never in scope.
- Read it back before creating anything, and confirm you got the day you asked for.

Date-only values are interpreted in the account's timezone, so `"2026-01-01"` means that calendar day
for the tenant. `date_count` must be **today or earlier** — a future date is rejected with `422`.

## Step 2 — Resolve the warehouses

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/v2/warehouses" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

- A stock take's warehouse must be a **standard (non-virtual)** warehouse — creating against a
  virtual one is rejected. Skip anything with a non-null `archived_at`.
- Match the user's wording to `name` / `display_name`. If a name is ambiguous or absent, **ask** —
  counting the wrong warehouse creates stock in the wrong place and is painful to unwind.
- **Multiple warehouses:** one initial stock take **per warehouse**. Never merge warehouses into one
  take. Split the source rows by their warehouse column first; if the sheet has no warehouse column
  and covers more than one site, ask which rows belong where rather than guessing.

Before a multi-warehouse run, see what's already been done in one call:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/stock-takes/list?filter[is_initial_count]=1&per_page=100" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

## Step 3 — Check the warehouse hasn't already been counted

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/stock-takes/check-initial-uniqueness" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"warehouse_id": 2, "condition": null}'
# → {"exists": true, "stock_take_id": 10}
```

`exists: true` → **stop for that warehouse** and report the existing stock take id. Do not create a
second initial count, and do not "work around it" with a regular count unless the user explicitly
asks for a correction (that's a normal stock take or `adjust-inventory`).

`condition` is an optional label (e.g. `"new"`, `"used"`) and is **part of the uniqueness key** — a
warehouse can legitimately have one initial count for its default stock and another for a distinct
condition. Only use it if the user's data actually separates stock by condition.

## Step 4 — Build the lines from the source

Get the count sheet into a table of `sku` (or barcode), `qty_counted`, and — where available —
`unit_cost` and `warehouse`. See `build-product-catalog` for the messy-spreadsheet handling
(finding the real header row, skipping totals, normalizing numbers); the same rules apply here.

Resolve identifiers to product ids in bulk — this matches both SKU **and** barcode columns:

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/stock-takes/resolve-skus" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"skus": ["PROD-001", "PROD-002", "123456789"]}'
# → {"found": [...], "not_found": ["PROD-999"], "skipped": []}
```

Max 5000 identifiers per request — chunk a larger sheet. Then:

- **`not_found`** — the product doesn't exist in SKU.io yet. **Do not invent it.** Either create the
  catalog first (`build-product-catalog`) and re-resolve, or hold those rows out and list them in
  your report. Counting a partial catalog and back-filling later is worse than pausing.
- **`skipped`** — wrong product type. Stock takes cover standard and kit products only; bundles and
  matrix parents are excluded by design. Report them, don't force them.
- **Duplicate rows for the same SKU** — sum them before sending; one line per product per take.
- `qty_counted` must be `>= 0`. A product with a genuine zero count can be included with `0`, or
  simply left out — both leave it at zero.

## Step 5 — Get the unit costs right

This is the step most worth slowing down for. An initial count starts from a zero (or near-zero)
snapshot, so nearly every line is a **positive variance**, and each one creates a **FIFO cost layer
at that line's `unit_cost`**. Those layers are the opening valuation and the cost basis for the COGS
of everything sold afterwards. A wrong cost here propagates into margin reporting for months.

- Use the **real landed/purchase cost** from the source when it has one.
- Where the source has no cost, check what SKU.io would use:
  `GET /api/stock-takes/product-cost-options?product_id=55&warehouse_id=2` → `best_available_cogs`
  (derived from FIFO history) and the product's default `unit_cost`, both to 4 decimals. For a full
  count, cost is captured at **initiation** from the product's best-available cost when a line
  carries none — so a product with no cost anywhere will open a zero-value layer. Flag those rather
  than letting them through silently.
- An explicit `unit_cost` of `0` is **kept as zero** — it does not fall back to the product's cost.
  Only send `0` when you mean it.
- Costs are per stock unit; products stocked in small units (g, ml, oz) routinely sit below $0.01, so
  don't round to 2 decimals.

## Step 6 — Create the draft

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/stock-takes" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{
    "warehouse_id": 2,
    "is_initial_count": true,
    "mode": "full_count",
    "date_count": "2026-01-01",
    "status": "draft",
    "notes": "Opening stock — imported from opening-count-2026-01.xlsx",
    "items": [
      { "product_id": 55, "qty_counted": 240, "unit_cost": 12.5 },
      { "product_id": 56, "qty_counted": 18,  "unit_cost": 4.75 }
    ]
  }'
```

See [`examples/create-initial-stock-take.json`](./examples/create-initial-stock-take.json) for a
fuller body, and [`examples/source-sample.csv`](./examples/source-sample.csv) for the shape of a
typical opening count sheet.

Notes:

- `is_initial_count: true` with `mode: "full_count"` is the combination that makes this an opening
  count. (`bulk-insert` also accepts `is_initial_count` and forces `full_count`, but it takes product
  ids without quantities — you'd then set every quantity via `PUT`. Prefer creating with `items`.)
- Keep it a **draft**. Don't try to shortcut the draft → open → closed path.
- For a very large sheet, create the take with a first batch and add the rest with
  `PUT /api/stock-takes/{stock_take}` (`items[]`, `to_delete` to remove a line) before initiating.
- Always set `notes` naming the source file/sheet — an initial count is the most-audited record in
  the account.

## Step 7 — Initiate (take the snapshot)

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/stock-takes/42/initiate" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"date_count": "2026-01-01"}'
```

This moves draft → open and snapshots current inventory for every line. Pass `date_count` again
here: it is the date the resulting inventory movements, FIFO layers, and accounting journal carry.
For a fresh warehouse the snapshot is zeros, so counted quantity == variance.

- `422` — `date_count` is in the future.
- `400` — the date falls in a locked accounting period, all items were excluded, or the take is in
  adjustment mode (an initial count shouldn't be).

## Step 8 — Review, confirm, then finalize

**Confirm with the user before finalizing.** Show: warehouse, count date (and where it came from),
line count, total units, total opening value, how many lines had no cost, and anything held out
(`not_found` / `skipped`). Finalizing is the point of no return in practice — it can only be reversed
while its cost layers are untouched.

If the warehouse already holds stock or has orders in flight, check for conflicts first:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/stock-takes/42/reconciliation-preview" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

Then finalize:

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/stock-takes/42/finalize" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
# → {"data":{"id":42,"status":"closed","value_change":12480.0,"variance_direction":"positive"}}
```

## Step 9 — Verify and report

- `GET /api/stock-takes/{stock_take}` → confirm `status: "closed"`, and that `value_change` matches
  the opening value you showed the user.
- Spot-check two or three products' on-hand at that warehouse.
- Report per warehouse: stock take id, count date, lines counted, units, opening value, and the
  rows you held out with the reason. For a multi-warehouse run, give one row per warehouse plus the
  totals.

## Multiple warehouses

Run the per-warehouse pipeline **sequentially**, not concurrently — each warehouse gets its own
uniqueness check, its own draft, and its own confirmation. Share the inventory start date across all
of them (it's account-level, so it's the same date for every warehouse).

If one warehouse fails (already counted, unresolvable SKUs, missing costs), **finish the others** and
report the failure — don't abandon the run. Never batch the confirmations into one blanket "finalize
everything"; each finalize is its own irreversible write.

## Lot-tracked products

If `resolve-skus` returns `is_lot_tracked: true` for a product, its opening stock needs lot rows —
each becomes its own FIFO layer. Supply them per line as `lots[]`, and for lot-tracked products every
lot must carry `batch_number` **and** `expiry_date`:

```json
{
  "product_id": 55,
  "qty_counted": 240,
  "unit_cost": 12.5,
  "lots": [
    { "batch_number": "LOT-2025-0042", "manufacture_date": "2025-11-04",
      "expiry_date": "2026-11-04", "quantity": 240 }
  ]
}
```

The lot quantities must add up to the line's counted quantity. If the source sheet has no batch or
expiry data for a lot-tracked product, **ask** — don't fabricate a batch number or an expiry date.

## Handle the response

- **`200`/`201`** — proceed to the next step in the pipeline.
- **`422`** — validation failed. Common causes: a future `date_count`; a `product_id` that doesn't
  exist; `bulk-insert` called without `ids`; a lot-tracked line missing `batch_number`/`expiry_date`.
  Read the `errors` map and fix the named field. See [`shared/errors.md`](https://github.com/skuio/sku-skills/blob/main/shared/errors.md).
- **`400`** — a state/business-rule refusal, not a field error: locked accounting period, take not in
  the expected status, protected-inventory conflict, or insufficient stock on finalize. Read the
  message; don't retry blindly.
- **`403`** — the token lacks `inventory:write` (or `warehouses:read` for the warehouse list, or
  `settings:write` for the inventory start date), or the user lacks the permission the write requires
  — `inventory.count` for every stock take write, `settings.update` for the start date.

## Guardrails

- **The date is one-way.** Initial counts cannot be re-dated once finalized. Confirm the date, and
  its provenance, with the user before Step 7 — every time, even when it looks obvious.
- **Never invent the inventory start date.** Read it, infer it from the source, or ask. Write it only
  when it is unset and the user has confirmed the exact day, and send nothing but
  `inventory_start_date` in that payload. Never silently change one that is already configured.
- **One initial count per warehouse (+condition).** Always run `check-initial-uniqueness` first; if
  one exists, stop and report it rather than creating a parallel count.
- **Confirm before every finalize.** It creates real inventory movements, cost layers, and an
  accounting journal. Reversal (`/reverse`) only works while no FIFO layer has been consumed — check
  `/reverse-analysis` first, and expect a compensating adjustment instead once stock has moved.
- **Not idempotent.** A blind retry after a timeout can create a second stock take or double-apply a
  finalize. On an ambiguous failure, re-fetch with `GET /api/stock-takes/{stock_take}` (or
  `filter[is_initial_count]=1`) and look before re-posting.
- **Don't invent products, quantities, costs, or lots.** Hold out rows you can't complete and report
  them. A short, correct opening count beats a complete, wrong one.
- **Don't silently substitute an ordinary count.** If the warehouse can't take an initial count, say
  so and let the user choose the alternative.

## API operations

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/stock-takes/inventory-start-date` | Read the account's configured inventory start date from application settings. This is the date initial counts are validated against and dated to. Returns { "inventory_start_date": "YYYY-MM-DD" } — null/absent means it has not been configured yet. A returned value is often a stale placeholder from account setup: treat it as a default to confirm against the source data or with the user, never as evidence of when stock was true. |
| `PUT` | `/api/v2/settings/inventory` | Set the account's inventory start date. Only use this when it has not been configured yet and the user has confirmed the exact day — changing an existing one moves the line in the sand for order import, integration sync windows, and the effective accounting start date. Send nothing but inventory_start_date; the endpoint writes every property the body carries. |
| `GET` | `/api/v2/warehouses` | List warehouses to resolve names to ids. A stock take's warehouse must be a standard (non-virtual) warehouse; check type/subtype and archived_at before using an id. |
| `POST` | `/api/stock-takes/check-initial-uniqueness` | Check whether an initial stock take already exists for a warehouse + condition. Returns { exists, stock_take_id }. Call before creating — only one initial count is allowed per pair. |
| `GET` | `/api/stock-takes/list` | List stock takes with filters — use filter[is_initial_count]=1 to see which warehouses have already been counted before starting a multi-warehouse run. |
| `POST` | `/api/stock-takes/resolve-skus` | Bulk-resolve a list of SKUs or barcodes to products in one call (max 5000). Returns found, not_found, and skipped (wrong product type) — the way to turn a count sheet into product ids. |
| `GET` | `/api/stock-takes/product-cost-options` | Get cost options for a product at a warehouse — best_available_cogs (from FIFO history) and the product's default unit_cost, to 4 decimal places. Use to sanity-check a line's unit cost. |
| `POST` | `/api/stock-takes` | Create a stock take. For opening stock set is_initial_count true, mode full_count, and date_count to the inventory start date. Created as draft by default. |
| `POST` | `/api/stock-takes/bulk-insert` | Create a stock take and bulk-insert product ids as lines in one call. Returns stock_take_id. Quantities are not part of this call — set them afterwards with update-stock-take. |
| `PUT` | `/api/stock-takes/{stock_take}` | Update a stock take and its lines — add, update, or remove items and set counted quantities and unit costs before initiating. |
| `POST` | `/api/stock-takes/{stockTake}/initiate` | Transition a stock take from draft to open, taking the inventory snapshot for all its items. Required before finalize for a full_count. |
| `POST` | `/api/stock-takes/{stockTake}/finalize` | Finalize an open stock take — creates the inventory adjustments for every variance and closes it. This is the write that makes the opening stock real. Returns 400 on protected-inventory conflicts, insufficient stock, or if the take is not open. |
| `GET` | `/api/stock-takes/{stock_take}` | Fetch a stock take with its items, warehouse, and (once closed) value_change and variance_direction. Use to review before finalizing and to verify afterwards. |
| `GET` | `/api/stock-takes/{stockTake}/reconciliation-preview` | Preview what finalizing will do, including items with conflicts and open fulfillments. Worth checking when counting a warehouse that already holds stock or has orders in flight. |
| `GET` | `/api/stock-takes/{stockTake}/reverse-analysis` | Check whether a closed stock take can still be reversed — returns can_reverse and which items have consumed FIFO layers. Run this before proposing a reversal. |

## Authentication

Every request authenticates with a SKU.io **Personal Access Token** sent as a Bearer token:

```http
Authorization: Bearer <YOUR_SKU_PAT>
```

- **Base URL:** `https://{tenant}.sku.io` (replace `{tenant}` with your account subdomain)
- **Required scopes:** `inventory:read`, `inventory:write`, `warehouses:read`, `settings:write`

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

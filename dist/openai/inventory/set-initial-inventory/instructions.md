# Set Initial Inventory

_Load opening stock into SKU.io as an initial (first-ever) count for one or more warehouses, dated to the account's inventory start date. Use this when going live, onboarding a new warehouse or 3PL, or importing an opening count sheet: it settles the start date (from the source data or by asking — the configured setting is often stale, so confirm it), turns the sheet into one initial stock take per warehouse, and drives each draft → open → closed so the quantities and their cost layers land. It also attaches the source documents to the take, files the rows it could not resolve cleanly — unmapped SKUs, lines with no cost basis, damaged stock nobody split out, sheets declared incomplete — as an HTML anomaly report, and works those anomalies once answers come back: creating missing products, updating lines, posting a revised report. An initial count happens once per warehouse and cannot be re-dated, so date and unit costs must be right before finalizing. For cycle counts or corrections use adjust-inventory._

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
  → Create draft → Attach the sources → Report the anomalies → Confirm
  → Initiate (snapshot) → Confirm → Finalize → Verify
```

An opening count almost never arrives clean. Rows that don't resolve, stock the sheet calls damaged,
costs nobody has — those are **anomalies**, and they are the substance of the handover, not noise to
swallow. Steps 7–8 exist to make them visible and answerable: the source files go onto the stock take
as attachments, and the open questions go on as an HTML report. When the answers come back, see
[Working the anomalies after feedback](#working-the-anomalies-after-feedback).

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
  the account. Keep it **under 255 characters**: the column is `varchar(255)` and nothing validates
  it, so a longer note comes back as a raw `500` ("Data too long for column 'notes'") rather than a
  `422`. Source file, who supplied it, what you excluded — that's the useful 255.
- **`date_count` is not yours to set on an initial count.** The server overwrites it with the
  configured inventory start date and discards what you sent, without saying so. Read `date_count`
  off the create response and compare it to the day you agreed in Step 1 — if they differ, the
  setting is the thing to fix, not the take. Do not initiate on a date you didn't expect.
- `variance_reason` on a line is a fixed **enum** — `receiving_error`, `picking_error`, `damage`,
  `mislabel`, `shrinkage`, `unknown` — not a free-text field; anything else is rejected `422`. It
  also rarely applies here: an initial count opens from zero, so a 3PL's own book-vs-physical
  discrepancy is not a SKU.io variance. Put that detail in `notes` instead of forcing it into a code.

## Step 7 — Attach the source documents

A stock take carries **attachments** — the backup documents the count was built from. Put them on the
take now, while it is still a draft, so the reviewer can open the original next to the lines instead
of hunting through an inbox for the spreadsheet you typed from.

Attach whatever the count actually came from: the emailed workbook, a photo of the handwritten tally,
the PDF the 3PL exported, the Slack export, the screenshot of a WMS page. If the count was assembled
from three files, attach three files.

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/stock-takes/42/documents" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json" \
  -F "file=@/path/to/handwritten-count-sheet.jpg" \
  --form-string "description=Photo of the handwritten count sheet from the Redbank floor, supplied by the warehouse manager 2026-07-30. Pages 1-2 of 2; page 2 covers the returns bay."
# → { "data": { "id": 91, "file_name": "...", "description": "...", "file_url": "...", "uploaded_by": "..." } }
```

> **`--form-string` for the description, never `-F`.** In an `-F name=value`, curl reads `;` in the
> *value* as the start of a parameter (the same syntax as `;type=` / `;filename=`) and **silently
> discards everything after it**. A description like `"3PL export; sellable and damaged are not
> split"` posts as `"3PL export"`, and the API returns `201` — nothing anywhere tells you it was
> truncated. `--form-string` sends the value literally. This actually happened on a live run: six
> attachments, every description cut at its first semicolon, only caught by reading the stored
> values back. **Whichever flag you used, list the attachments afterwards and compare the stored
> `description` lengths to what you sent** — and if one is short, fix it with the `PATCH` below,
> which takes JSON and has no such trap.

The rest of the operations:

```bash
# List what's already attached
curl -sS "https://$SKU_TENANT.sku.io/api/stock-takes/42/documents" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"

# Re-describe an attachment (send description: null to clear it)
curl -sS -X PATCH "https://$SKU_TENANT.sku.io/api/stock-takes/42/documents/91" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"description":"Superseded by the v2 report — kept for audit."}'

# Remove one (deletes the file and the link)
curl -sS -X DELETE "https://$SKU_TENANT.sku.io/api/stock-takes/42/documents/91" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"

# Stream the file back (inline; also what the UI's preview uses)
curl -sS "https://$SKU_TENANT.sku.io/api/stock-takes/42/documents/91/file" \
  -H "Authorization: Bearer $SKU_PAT"
```

**The `description` is the point of the feature — always write one.** `notes` on the take is capped at
255 characters and has to cover the whole count; the description is up to 2000 characters *per file*
and is what tells the next person what they are looking at. Say what the file is, who supplied it,
when, and what it does and doesn't cover:

> ✅ `"3PL's emailed stock-on-hand export, received from Jay 2026-07-30. Sellable + damaged are not separated in this file — see the anomaly report."`
> ❌ `"count sheet"` — tells the reader nothing they couldn't guess from the filename.

Practical notes:

- **Multipart, not JSON.** `-F file=@...`; sending a JSON body gets you a `422` on `file`.
- Accepted: `pdf, jpg, jpeg, png, gif, webp, heic, doc, docx, xls, xlsx, csv, txt, html, htm, eml,
  msg, zip`, **max 20 MB** each. Anything else is a `422` on `file`. The **filename extension**
  decides the type — the file's contents are not sniffed to classify it, so a text or CSV export
  whose contents happen to look like another format still uploads. Contents that are an executable
  or script are refused under any name, with a different message ("contains a program or script").
  If you hit `422 FileMimes` on a plainly-allowed extension, the pod predates that fix — wrap the
  file (e.g. the text verbatim inside a `<pre>` in a self-contained HTML page) and say so in the
  description rather than dropping the source.
- `description` is optional and capped at **2000 characters** — longer is a `422`, not a truncation.
- Writes need the `inventory.count` permission (same as every other stock take write); reading and
  streaming need only `inventory:read`.
- **Attachments are not gated on status.** You can attach to a draft, an open, or a closed take — so
  the resolution record can still go onto a count that was finalized weeks ago.
- Attachments are per stock take. A document id from another take returns `404`, not someone else's
  file.

## Step 8 — Report the anomalies

Everything the count couldn't resolve cleanly goes into a **single HTML anomaly report**, attached to
the take. Do this even when the list is short — an initial count is the most-audited record in the
account, and "we asked about the damaged units on the 30th" is worth having on the record rather than
in a chat scrollback.

### What counts as an anomaly

Sweep for all of these — they are the ones that actually recur:

| Anomaly | Why it matters |
| --- | --- |
| `not_found` SKUs | Stock was counted that has no product in SKU.io. It is not in the take, so the opening balance is short by that much. |
| `skipped` rows | Wrong product type (bundle / matrix parent). Silently absent unless reported. |
| Lines with **no cost basis** | They open a **zero-value FIFO layer** — everything sold from it books 100% margin until the layer is exhausted. |
| Damaged / unsellable stock not split out | Counted into sellable on-hand, so it becomes allocatable and sellable. |
| Two source rows collapsed onto one product | E.g. an old and a new generation both mapped to one SKU — the quantity is right, the identity isn't. |
| A source that says it is incomplete | "all that's missing are the returns" is a statement that the opening balance is wrong by an unknown amount. |
| Quantities in a different unit or pack size | 12 cases vs 12 units is a 12× error in the opening valuation. |
| Free-text on the sheet carrying a decision | "will inspect at my return", "check with the supplier" — an open action that dies with the spreadsheet unless it is captured. |
| Duplicate rows you summed | Report the sum you took, so the counterparty can confirm it was a duplicate and not two locations. |

### Write the report

A complete, self-contained, **light-mode** HTML document — full `<!doctype html> … </html>`, all CSS in
a `<style>` block, no external requests at all.

> **No JavaScript, no CDN fonts, no remote images.** The document stream serves user-uploaded HTML
> under a `Content-Security-Policy: sandbox` with `default-src 'none'` — scripts and every external
> load are blocked by design, so a report that depends on them renders broken in the UI. Inline CSS,
> system font stack, and `data:` URIs only. Dark mode is wrong here; these get printed and emailed.

For each anomaly give four things, in this order — it is the shape that gets an actual answer back:

1. **What the source said** — quoted verbatim, including the typos. Paraphrasing loses the evidence.
2. **What the count did about it** — excluded / included at zero cost / collapsed / summed. Be exact.
3. **The impact if it is left as-is** — in units and dollars where you can compute it.
4. **The question**, addressed to whoever can answer it, phrased so a one-line reply resolves it.

Open with a summary line the reader can act on without scrolling — warehouse, count date, lines,
units, opening value, and the number of open items by severity. Group by severity, not by SKU:
anything that changes the opening balance or the valuation first, bookkeeping detail last.

### Attach it

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/stock-takes/42/documents" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json" \
  -F "file=@/tmp/stock-take-42-anomalies.html" \
  --form-string "description=Anomaly report v1 — Northline CA (Redbank), count dated 2026-07-31. 6 open items: 1 blocking (count incomplete), 3 needing a decision, 2 FYI. Generated 2026-07-31."
```

- Name the file `stock-take-{id}-anomalies.html` so it sorts next to the take it belongs to.
- **Version the description, never the endpoint** — `v1`, `v2`, … Each revision is a *new* attachment;
  see [Working the anomalies after feedback](#working-the-anomalies-after-feedback).
- Post the same summary as text in the conversation too. The attachment is the durable record; the
  chat message is what actually gets read today.

## Step 9 — Hand the draft to the user and wait

**Stop here and let the user see the draft in the UI before you initiate.** The response carries the
new id — turn it into a link and give it to them:

```
https://$SKU_TENANT.sku.io/v2/inventory/stock-takes/{id}
```

Post that URL with a short summary of what they are about to check — warehouse, count date, line
count, total units, opening value, anything you held out, and the anomalies you just filed. A draft is
the last fully reversible state: they can edit a quantity or a cost on that page, or delete the whole
take, and nothing has touched inventory yet.

**Do not initiate until they reply.** This is a blocking gate, not a courtesy notification —
a transcribed digit or a mis-mapped SKU is cheap to fix now and expensive after finalize. If they
came back with edits, re-read the take (`GET /api/stock-takes/{id}`) before continuing so you are
working from what is actually saved rather than what you sent.

**An open anomaly is not automatically a blocker.** Some have to be settled before the count is real
(the sheet is missing a whole section); others can ride along and be corrected later (a cost nobody
has yet). Say which is which and let the user decide — don't hold the whole warehouse hostage to a
question about five door hooks, and don't quietly initiate over a count the supplier has told you is
incomplete.

Because a draft is inert, Steps 3–8 are the part of the run that is safe to do concurrently for
several warehouses — see [Multiple warehouses](#multiple-warehouses). The gate itself does not
change: it is still one approval per warehouse, on that warehouse's own draft.

## Step 10 — Initiate (take the snapshot)

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

## Step 11 — Review, confirm, then finalize

**Confirm with the user before finalizing.** Show: warehouse, count date (and where it came from),
line count, total units, total opening value, how many lines had no cost, and anything held out
(`not_found` / `skipped`) — and repeat the link, since initiating may have changed what the page
shows:

```
https://$SKU_TENANT.sku.io/v2/inventory/stock-takes/{id}
```

Finalizing is the point of no return in practice — it can only be reversed while its cost layers are
untouched. This is a second, separate approval: the Step 9 gate was "is the data right", this one is
"commit it". Do not roll them into one question, and do not treat approval of the draft as approval
to finalize.

If anomalies are still open, say which ones are closing unresolved and what that bakes into the
opening balance. Then attach the resolution — see
[Working the anomalies after feedback](#working-the-anomalies-after-feedback).

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

## Step 12 — Verify and report

- `GET /api/stock-takes/{stock_take}` → confirm `status: "closed"`, and that `value_change` matches
  the opening value you showed the user.
- Spot-check two or three products' on-hand at that warehouse.
- Report per warehouse: stock take id, count date, lines counted, units, opening value, the rows you
  held out with the reason, and the anomalies still open. For a multi-warehouse run, give one row per
  warehouse plus the totals.
- Confirm the attachments landed — `GET /api/stock-takes/{stock_take}/documents` should list the
  source files and the current anomaly report. A count whose source documents are only in someone's
  inbox is not auditable.

## Working the anomalies after feedback

The report from Step 8 is a question, and questions get answered — usually days later, in an email or
a Slack reply, after the take is already closed. Closing the loop is part of this skill, not a
separate job. Attachments are not status-gated, so a finalized count can still receive the resolution
record.

### 1. Re-read before you act

Never work from the report you wrote — it is a snapshot, and the take may have moved since.

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/stock-takes/42" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
curl -sS "https://$SKU_TENANT.sku.io/api/stock-takes/42/documents" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

Note the take's **status** — it decides what you are allowed to do next (see step 3).

### 2. Classify each answer

Every reply lands in exactly one of these:

| The answer | What it means | What to do |
| --- | --- | --- |
| "That SKU is `WMMAXG4`" | A `not_found` row was a naming mismatch, not a missing product | Resolve it and add the line |
| "That's a new product, here are its details" | The product genuinely doesn't exist yet | Create it (below), then add the line |
| "Those 14 are damaged, keep them out" | A judgement call, now made | Record the decision; the count stands |
| "Use $28.40 for ACME-TSR-01" | A missing cost basis is now known | Set the unit cost |
| "Here are the returns we missed" | The source was incomplete and now isn't | Add the lines |
| "Ignore it" / "that was a duplicate" | No data change | Record it and close the item |

Anything that isn't a clear answer stays open. Do not infer a decision from silence — carry it into
the next report.

### 3. What you can still change depends on the status

- **Draft** — edit freely. `PUT /api/stock-takes/{id}` with the full `items` array (add lines, fix
  quantities, set `unit_cost`), or `POST /api/stock-takes/{id}/bulk-insert` to add products by id.
  Re-check the totals afterwards.
- **Open (initiated, not finalized)** — lines are still editable, but the inventory snapshot was
  taken at initiate. If the fix changes which products are in the count, re-snapshot rather than
  leaving the take describing a set of products it no longer covers.
- **Closed (finalized)** — **do not** try to edit the lines. The count has produced inventory
  movements, FIFO layers, and a journal. The correct instruments are a **separate adjustment stock
  take** for quantity corrections, `/apply-cost-correction` for a cost that was wrong, or `/reverse`
  (check `/reverse-analysis` first — it only works while no FIFO layer has been consumed). Tell the
  user which one you propose and get approval; a closed initial count is not something to quietly
  rewrite.

Whatever the status, the **resolution record still gets attached** — that part is always available.

### 4. Missing products: create them properly

When the answer is "that's a real product we don't have yet", don't hand-create a thin stub just to
get a line into the count. Route it through the **`build-product-catalog`** skill so the product
arrives with its SKU convention, name, type, cost, and attributes intact — the same shape as
everything else in the catalog. A product invented to satisfy a stock take line is a product someone
has to clean up later.

Then resolve and add:

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/stock-takes/resolve-skus" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"skus":["ACME-ULT-A10"]}'
```

If it still comes back in `not_found`, the product wasn't created — fix that before touching the take.

### 5. Post a new report, don't overwrite the old one

Each round gets its **own attachment**. Never delete v1 to replace it — the sequence of reports *is*
the audit trail of what was asked, when, and what came back.

```bash
# v2 — the same structure, with the answers folded in
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/stock-takes/42/documents" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json" \
  -F "file=@/tmp/stock-take-42-anomalies-v2.html" \
  --form-string "description=Anomaly report v2 — after the 3PL's 2026-08-04 reply. 4 of 6 resolved (lines added for the returns; ACME-TSR-01 costed at \$28.40); 2 still open (damaged units pending inspection, ACME-ULT-A10 needs a product)."

# Mark v1 as superseded so nobody reads a stale question as live
curl -sS -X PATCH "https://$SKU_TENANT.sku.io/api/stock-takes/42/documents/91" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"description":"Anomaly report v1 (SUPERSEDED by v2, 2026-08-04) — original 6 open items as filed 2026-07-31."}'
```

The v2 report carries every item from v1, each now marked **Resolved** (with the answer, verbatim,
and the change you made) or **Still open** (with the question restated). Resolved items stay in the
document — deleting them destroys the record of what was decided. Also attach the reply itself when
you have it as a file (`.eml`, a screenshot, the corrected spreadsheet) with a description saying
which anomalies it answers.

### 6. Report back

Tell the user, in the conversation: what was answered, what changed on the take (lines added, costs
set, quantities corrected — with the new totals), what is still open, and who owes the answer. If the
take is closed and the fix needs an adjustment or a cost correction, say so and stop for approval —
do not create either one unasked.

## Multiple warehouses

Split the run at the point where it stops being reversible. **Drafts are built in parallel; every
write that touches inventory stays serial and gated.**

- **Steps 3–8 (uniqueness check → resolve SKUs → cost the lines → create the draft → attach the
  sources → file the anomalies) are read-only plus reversible writes.** A draft moves no stock,
  creates no FIFO layer, and posts no journal; it can be edited or deleted outright, and an
  attachment is just a file on it. Building six of them concurrently costs nothing and saves the user
  waiting through six serial round-trips of SKU resolution and cost lookups.
- **Steps 10–12 (initiate → finalize → verify) stay one warehouse at a time**, each behind its own
  two approvals. Nothing about the parallel phase changes that.

### Settle the shared inputs first — before any fan-out

These are account-level and must be decided **once**, with the user, ahead of the parallel phase:

1. The **inventory start date** (Step 1). It is one date for every warehouse; resolving it inside
   per-warehouse agents would ask the user N times and risk N different answers.
2. The **cost basis** (Step 5) — which source of truth the unit costs come from, and what to do about
   lines that have none.
3. The **warehouse list and their ids** (Step 2), plus which source rows belong to which warehouse.

Fanning out before these are settled is the one way to make the parallel phase worse than the serial
one: you would be committing the same unreviewed assumption to every warehouse simultaneously.

### Fan out the drafts

Run one agent per warehouse via the `Workflow` tool — a single phase, one `agent()` call per
warehouse, all concurrent. Give each agent only its own warehouse: its id and name, its slice of the
source rows, the settled inventory start date, the settled cost basis, and the tenant + token.

Each agent does Steps 3–8 for its warehouse and returns a structured summary — do not let it print
prose. Use a `schema` so the result comes back validated:

```
{ warehouse_id, warehouse_name, stock_take_id, date_count, line_count, total_units,
  opening_value, lines_without_cost, not_found: [], skipped: [],
  anomalies: [ { severity, summary, question } ], document_ids: [], error: null }
```

Each agent attaches **its own warehouse's** source files and posts **its own** anomaly report — the
anomalies are per-warehouse and the reviewer reads them on the take, not in one merged document. It
returns the anomaly list as well so you can roll them into the review-queue table.

Hard rules for the fan-out:

- **Never put `initiate` or `finalize` inside the workflow.** No agent may call either endpoint. The
  workflow's only write is `POST /api/stock-takes` in draft status. State this explicitly in every
  agent prompt — it is the guardrail that makes the parallelism safe.
- **One agent per warehouse, never per SKU batch.** The uniqueness key is warehouse + condition, so
  agents on distinct warehouses cannot collide. Two agents on the *same* warehouse would race the
  uniqueness check and create a duplicate initial count.
- **A failing warehouse must not take down the others.** `agent()` returns `null` when an agent dies;
  filter those out and carry the failure into the report rather than aborting the run.
- **`log()` each draft as it lands** — `log("Northline AU → draft #42, 14 lines, $18,240.00")` — so the
  user watches them arrive instead of staring at a silent tool call.

### Present them as a review queue

When the workflow returns, post **one table** of everything that got built — warehouse, stock take
id, count date, lines, units, opening value, lines missing a cost, rows held out, open anomalies —
with a live link per row:

```
https://$SKU_TENANT.sku.io/v2/inventory/stock-takes/{id}
```

Then say plainly that all of them are drafts, nothing has touched inventory, and they can be reviewed
in any order. Ask which to take live first.

From that point the gates are unchanged and strictly per-warehouse: approve *this* draft → initiate
it → approve *this* finalize → close it → verify → move to the next. The parallel phase bought the
user their review time; it does not buy a blanket "finalize everything." Never batch the finalize
confirmations — each one is its own irreversible write.

### When to skip the parallelism

Do it serially if any of these hold — the fan-out is a speed optimization, not a requirement:

- Only one or two warehouses (the workflow overhead exceeds the saving).
- The SKU→product mapping or the cost basis is still uncertain. Take **one** warehouse through
  Steps 3–8 first and let the user check the mapping on a real draft; a wrong assumption caught on
  one draft is cheaper than the same assumption baked into six.
- The `Workflow` tool isn't available in the current environment.

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
  exist; `bulk-insert` called without `ids`; a lot-tracked line missing `batch_number`/`expiry_date`;
  an attachment with a disallowed extension, over 20 MB, or a `description` past 2000 characters.
  Read the `errors` map and fix the named field. See [`shared/errors.md`](https://github.com/skuio/sku-skills/blob/main/shared/errors.md).
- **`400`** — a state/business-rule refusal, not a field error: locked accounting period, take not in
  the expected status, protected-inventory conflict, or insufficient stock on finalize. Read the
  message; don't retry blindly.
- **`403`** — the token lacks `inventory:write` (or `warehouses:read` for the warehouse list, or
  `settings:write` for the inventory start date), or the user lacks the permission the write requires
  — `inventory.count` for every stock take write, `settings.update` for the start date.

## Guardrails

- **The date is one-way.** Initial counts cannot be re-dated once finalized. Confirm the date, and
  its provenance, with the user before Step 10 — every time, even when it looks obvious.
- **Attach the sources, always.** Every count is built from something; that something belongs on the
  take with a description saying what it is and what it covers. "It's in the email thread" is not a
  record. Undescribed attachments are barely better than none.
- **Report the anomalies, don't absorb them.** An unresolved SKU, a zero-cost line, or damaged stock
  counted as sellable is a decision the user has to make — surface it in the report and in the
  conversation. Quietly excluding rows so the count looks clean is the worst outcome this skill can
  produce.
- **Uploaded HTML runs sandboxed.** The document stream serves it with `default-src 'none'` and no
  script execution. Any report with JavaScript, a CDN stylesheet, a web font, or a remote image
  renders broken in the UI. Self-contained, inline CSS, light mode.
- **Never delete a superseded anomaly report.** Post a new version and PATCH the old one's
  description to mark it superseded. The sequence of reports is the audit trail.
- **Never invent the inventory start date.** Read it, infer it from the source, or ask. Write it only
  when it is unset and the user has confirmed the exact day, and send nothing but
  `inventory_start_date` in that payload. Never silently change one that is already configured.
- **One initial count per warehouse (+condition).** Always run `check-initial-uniqueness` first; if
  one exists, stop and report it rather than creating a parallel count.
- **Parallelism stops at the draft.** Warehouses may build their drafts concurrently; `initiate` and
  `finalize` are always serial, one warehouse at a time, each behind its own approval. Never place
  either call inside a workflow or subagent — the whole point of fanning out only the reversible
  work is that an unattended agent can never move stock.
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
| `GET` | `/api/stock-takes/{stockTake}/documents` | List the source / backup documents attached to a stock take — count sheets, the 3PL's spreadsheet, anomaly reports — newest first, each with its description, file_url, and uploaded_by. |
| `POST` | `/api/stock-takes/{stockTake}/documents` | Attach a source / backup document to a stock take. Multipart form-data, not JSON. Accepts pdf, jpg, jpeg, png, gif, webp, heic, doc, docx, xls, xlsx, csv, txt, html, htm, eml, msg, zip up to 20 MB. Always send a description saying what the file is, who supplied it, when, and what it does and doesn't cover. Not gated on status — a draft, open, or closed take can all receive attachments. Needs the inventory.count permission. |
| `PATCH` | `/api/stock-takes/{stockTake}/documents/{document}` | Re-describe an attached document. Send description null to clear it. Used to mark a superseded anomaly report rather than deleting it. Needs the inventory.count permission. |
| `DELETE` | `/api/stock-takes/{stockTake}/documents/{document}` | Remove an attachment — deletes the document, its link, and the stored file. Do not use this to replace a superseded anomaly report; post a new version and re-describe the old one. Needs the inventory.count permission. |
| `GET` | `/api/stock-takes/{stockTake}/documents/{document}/file` | Stream an attachment's contents inline — the same URL the UI previews. Executable types (text/html, application/xhtml+xml, image/svg+xml) are served under a CSP sandbox with default-src 'none', so an uploaded HTML report must be fully self-contained: no JavaScript, no CDN fonts, no remote images. |

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

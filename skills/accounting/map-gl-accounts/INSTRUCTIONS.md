Use this skill to connect SKU.io's **accounting roles** to the customer's own **chart of accounts**.
Every journal SKU.io posts (a sale, a shipment's cost, a receipt, a supplier bill) debits and
credits accounts it looks up in this mapping. Map `cogs` to the wrong account and every sale from
today on books its cost there, and the error reaches QuickBooks or Xero.

It is the agent lane for the Launch Roadmap step **Map GL accounts**. SKU.io marks that step done on
its own when these eight roles are mapped: `sales_orders`, `shipping_sales_orders`, `cogs`,
`inventory_control`, `accrued_purchases`, `accounts_receivable`, `accounts_payable`, `sales_tax`.
Nothing you say makes it done; the data does.

> **This is finance work. Treat it that way.** You propose; a person who owns the books approves.
> Recommend that the bookkeeper or accountant reviews the table before anything is saved. Never
> save a mapping the user hasn't explicitly approved, row by row or as a whole table they've seen.

The pipeline:

```
Read what's mapped → Read the accounts → (Read the user's chart export) → Propose the table
  → Explicit approval → Save only the approved keys → Read back → Report
```

## Step 1 — Read the current mapping

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/v2/settings/nominal-code-mapping" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
# → { "sales_orders": "41", "cogs": null, "inventory_control": "12", "accrued_purchases": null, ... }
```

Values are **nominal code ids** (as strings), not account numbers; `null` means unmapped. Anything
already mapped stays as it is unless the user asks you to change it (see Guardrails).

## Step 2 — Read the accounts you can map to

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/v2/nominal-codes?per_page=100&sort=code&page=1" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
# → { "data": [ { "id": 12, "code": "1200", "name": "Inventory Asset", "type": "Current", "archived_at": null },
#               { "id": 41, "code": "4000", "name": "Sales", ... } ],
#     "current_page": 1, "last_page": 2, ... }
```

Iterate `page` to `last_page`. Archived accounts are left out by default; never map to one. These
are the accounts SKU.io knows about. With QuickBooks Online or Xero connected they mirror that chart
of accounts, and `type` is the accounting system's account type (the app itself only offers
`Current` accounts for inventory and work in process, `Expense`/`Directcosts` for purchase price
variance, and liability types for deferred revenue).

This needs `accounting:read`. If the token only has settings access, fall back to
`GET /api/sub-sales-channels/lookup/nominal-codes` (`{id, name, code}`, **no type**, needs the
`sales_channels.show` permission). Then ask the user for their **chart of accounts export** from
QuickBooks or Xero to read the types, or say in the proposal that the types are inferred.

If an account the business needs isn't in the list, it doesn't exist in SKU.io yet. **Don't map to a
near-miss.** Tell the user to add it in their accounting system (or under Ledger → Settings →
Nominal Codes) and re-sync, then come back.

## Step 3 — Propose the mapping table

Cover the eight required roles first, then any optional role the business's operations call for.
For each row give the account, the reason, and your confidence:

| Role (key) | What posts here | Proposed account | Why | Confidence |
| --- | --- | --- | --- | --- |
| Sales Orders (`sales_orders`) | Income from sales | 4000 Sales | Only income account named "Sales" | High |
| Shipping Revenue from Sales Orders (`shipping_sales_orders`) | Shipping charged to customers | 4100 Shipping Income | Dedicated shipping income account | High |
| Cost of Goods Sold (`cogs`) | Cost of what shipped | 5000 Cost of Goods Sold | Expense, direct cost | High |
| Inventory Control (`inventory_control`) | Inventory asset; fallback for warehouses without their own | 1200 Inventory Asset | Current asset | High |
| Purchase Clearing (`accrued_purchases`) | Goods invoiced by a supplier but not yet received | 2050 Accrued Purchases | — | **Medium**: there's no exact match; confirm with the bookkeeper |
| Accounts Receivable (`accounts_receivable`) | Customer balances | 1100 Accounts Receivable | Control account | High |
| Accounts Payable (`accounts_payable`) | Supplier balances | 2000 Accounts Payable | Control account | High |
| Sales Tax (`sales_tax`) | Tax collected | 2200 Sales Tax Payable | Current liability | High |

Rules for proposing:

- **Revenue roles → income accounts; COGS → expense / direct-cost; inventory and work-in-process
  → current asset; receivables and payables → their control accounts; tax and liabilities →
  liability accounts.** A mismatch is a mistake even if the name looks right.
- `accounts_receivable` and `accounts_payable` should be the ledger's real AR/AP control accounts,
  not lookalikes such as "Due from Owner".
- Don't reuse one account for two roles that need to stay apart (e.g. `inventory_control` and
  `accrued_purchases`, or `cogs` and `purchase_price_variance`) without the user saying so.
- Optional roles, mapped only when the business uses the feature, include `sales_returns_and_allowances`,
  `shipping_refunds`, `goods_received_not_invoiced`, `inventory_in_transit`, `rounding`,
  `receiving_discrepancies`, `sales_discount`, `committed_purchases`, `customer_deposits`,
  `prepaid_vendor_deposits`, `work_in_process`, `direct_labor_applied`,
  `manufacturing_overhead_applied`, `expired_stock_write_off`, `fba_inventory_loss` and the
  gift-card and store-credit accounts. Propose one only when you can say why the business needs it.
- **Leave these to the bookkeeper, in the app**: `deferred_revenue` and `purchase_price_variance`.
  Each is tied to an accounting-treatment switch, and SKU.io guards changes to them; they aren't
  part of a first mapping.

Under the table, list: roles already mapped (left alone), roles you're **not** proposing and why,
and the accounts that seemed to be missing.

## Step 4 — Get explicit approval

Ask plainly: "Shall I save these N mappings exactly as shown?" Accept edits, re-show the changed
table, and ask again. Silence, "looks fine probably" or approval of a *different* table is not
approval. If the user wants their bookkeeper to look first, stop here and leave the table with them.
The roadmap step will wait.

## Step 5 — Save only the approved keys

```bash
curl -sS -X PUT "https://$SKU_TENANT.sku.io/api/v2/settings/nominal-code-mapping" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{ "cogs": "57", "accrued_purchases": "33", "sales_tax": "28" }'
# → the whole mapping, after the write
```

- **Send only the keys the user approved.** The endpoint writes exactly the keys in the body and
  leaves the rest alone, so a narrow body is the safety mechanism. Never send the whole object back.
- **Values are nominal code `id`s from Step 2**, not account numbers. `"57"` is the id of
  "5000 Cost of Goods Sold", not the code `5000`. SKU.io refuses an id with no account behind it
  (`422`, one error per key), but an id that exists and is simply the wrong account saves without
  complaint, so check every id against the Step 2 list before sending.
- One call is enough for a first mapping (eight keys). Never more than 25 keys in a single call.
- **`403`** — the token lacks `settings:write`, or the user lacks the `settings.update` permission.
  A `403` on Step 2 means the token lacks `accounting:read` (use the fallback). **`422`** — an account
  id that doesn't exist, or a guarded key (deferred revenue, purchase price variance) refused the
  change: read the message per key and hand it to the user.

## Step 6 — Read back and report

- `GET /api/v2/settings/nominal-code-mapping` again and compare **every** key you sent with what came
  back.
- Report a before → after table (role, old account, new account), the roles still unmapped, and
  what's left for a person: missing accounts to create, optional roles to decide, the bookkeeper's
  review if it hasn't happened.
- Link: `https://{tenant}.sku.io/v2/ledger?tab=settings` (Nominal Code Mappings).

Working a Launch Roadmap step? Hand this summary to `follow-launch-roadmap` to post as the step's
progress comment. The roadmap's next finance steps, **Map tax rates** and **Reconcile a test batch**,
are for people, and the test batch is a sign-off, which no agent can give.

## Connected through the SKU.io MCP server?

Through the MCP server, Steps 1–2 work with `api_read` (the account list needs the connection's
accounting read access), and `api_write` can call `PUT /api/v2/settings/nominal-code-mapping`, the
mapping and nothing else in settings. It still needs the connection's settings write access and the
user's `settings.update` permission, and unknown account ids are still refused. Nothing about the
approval gate changes: the table in Step 3 is approved before the write, exactly as with a token.

## Guardrails

- **Explicit approval, every time.** No mapping is saved without a yes to the exact table. Recommend
  the bookkeeper's review; it's their ledger.
- **Fill gaps; don't silently remap.** A key that is already mapped is left alone. If you think an
  existing mapping is wrong, say why, and change it only on a separate, explicit request, with a
  warning that past journals stay where they were posted and only future ones move.
- **Never clear a mapping** (send `null`) as part of this skill. Clearing `inventory_control` while
  warehouses inherit it breaks their postings.
- **Never create, rename, archive or delete nominal codes** here. A missing account is the user's
  to add.
- **Don't guess ids.** Every value comes from the Step 2 list, checked before the write. The server
  rejects ids that don't exist, not ids that point at the wrong account.
- **Report exactly what changed**: role, old value, new value.

Use this skill to create a **purchase order** — a replenishment order placed with a supplier, with
line items — in SKU.io. It maps to `POST /api/purchase-orders` (scope `purchase-orders:write`,
permission `purchase_orders.create`), plus a few read lookups to resolve the ids the PO needs.

## Two ways in — both converge on the same inputs

A PO request can arrive as either:

- **A description** — "reorder 200 of SKU-A and 50 of SKU-B from Acme into the main warehouse."
- **A source document** — a supplier email with a spreadsheet, an order form, a demand-plan export.
  The source gives the **unit mix** (SKUs + quantities); the header details (supplier, warehouse,
  terms) come from the surrounding request.

Either way, your job is to assemble one PO:

```
supplier  +  destination warehouse  +  currency  +  (payment term)  +  lines[ sku, qty, unit cost ]
```

Work the steps below in order. Resolve every id against the live API — never invent one.

## Step 1 — Get the line items (SKUs + quantities + unit cost)

If the input is a **description**, read the SKUs and quantities straight from it.

If the input is a **source document** (spreadsheet / email attachment / order form), extract it with
**your own tools** first — the SKU.io API isn't involved yet. Land a normalized table of
`sku, quantity, unit_cost?`. The extraction cautions in the **build-product-catalog** skill apply
verbatim: find the real header row, pick the right tab, skip section headers / subtotals / the
grand-total row, and get the attachment out of the email (decode base64 if needed) before parsing.

**Read the columns correctly — this is a PO, not a catalog import.** On an order form the quantity
column *is* what you want (unlike a catalog import, where you'd ignore it). Map:

- the **item code** → resolve to a product (Step 5). A supplier's own item code may be the
  `supplier_sku`, not your `sku`; if a code doesn't resolve, try it as a supplier sku or ask.
- **quantity ordered** → line `quantity`.
- **unit cost / price** if present → line `amount`. If the source has no cost, fill it in Step 5.

## Step 2 — Resolve the supplier

`GET /api/v2/suppliers?search=<name>` → take the `id`. Disambiguate to a single match; if several
plausible suppliers come back, show the candidates (name + company) and ask — don't pick the first.
The supplier record also carries `default_warehouse_id` and `default_payment_term_id`, which you'll
use in Steps 3 and 4.

If the supplier doesn't exist yet, stop and say so — creating suppliers is out of scope here.

## Step 3 — Resolve the destination warehouse

`GET /api/v2/warehouses` returns each warehouse's `id`, `name`, `code`, `is_default`.

- **Consignment order** → pick the account's **consignment warehouse** (consignment stock is
  supplier-owned and received into a dedicated warehouse). Match it by name/code. If exactly one
  consignment warehouse exists (as is typical), use it; if none is clearly the consignment one, or
  more than one matches, ask rather than guess.
- **Standard order** → use the named warehouse, else the supplier's `default_warehouse_id`, else the
  `is_default` warehouse.
- **Dropship order** (ships straight to the customer) → omit `destination_warehouse_id` entirely.

## Step 4 — Resolve the payment term (e.g. the consignment term)

`payment_term_id` is optional, but when the request names a term ("use the consignment payment
term") resolve it to an id with `GET /api/payment-terms` (scope `settings:read`). Each term in the
response carries an **`is_consignment`** boolean (and `consignment_settlement_frequency`), so you
resolve the consignment term by that flag — not by guessing at its name. Work in this order:

1. **Consignment order** → pick the term whose `is_consignment` is `true`. If exactly one exists
   (typical), use its `id`; if several do, disambiguate by `name` or ask.
2. **Named term** → match the requested term against each `name` (case-insensitive). One match →
   use its `id`; ambiguous → ask.
3. **Supplier default** → otherwise fall back to the supplier's `default_payment_term_id` (Step 2).
4. **Omit it** → create the PO without a term (telling the user it still needs setting) only if
   they're fine deferring it.

The list is **paginated and has no search param**, so page through it (`?page=`) and match
client-side. Never guess a `payment_term_id` — a wrong id silently applies the wrong terms.

## Step 5 — Resolve each product and its unit cost

For each line, resolve the product to a real reference with the **find-product** skill and prefer
passing `product_id` (a line may use `product_id` **or** `sku`; `product_id` is unambiguous).

Then make sure each line has a unit `amount` (cost). In priority order:

1. the **unit cost from the source**, if it had one;
2. else `GET /api/products/{product}/last-purchase-price` — the last price actually paid on a
   non-draft PO (returns `data: null` if there's no history);
3. else the product's supplier price, or **ask the user**.

Don't invent a cost and don't send `amount: 0` to paper over a missing one — a zero-cost line
distorts the PO value and, for consignment, the later settlement.

## Step 6 — Currency, status, approval

- **Currency** — pass `currency_code` (e.g. `"USD"`, `"AUD"`) matching the account/supplier base
  currency, or a known `currency_id`. Resolve or verify it with `GET /api/currencies` (scope
  `settings:read`), which lists the account's enabled currencies with their `code` and `is_default`.
- **Status** — omit `order_status` to create an **open** PO. Set `order_status: "draft"` (the only
  accepted value) to leave it as a draft for review. Default to a draft unless the user wants it open.
- **Approval** — `approval_status` defaults to `"pending"`; set `"approved"` only if the user has
  the authority and asks to approve on creation.

## Step 7 — Confirm, then create

Creating a PO commits an order. **Before you post, show the user the plan** — supplier, destination
warehouse, payment term, currency, status, line count, a 2–3 line sample, and the total — and get a
go-ahead. Then:

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/purchase-orders" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{
    "purchase_order_date": "2026-07-10",
    "supplier_id": 42,
    "currency_code": "USD",
    "destination_warehouse_id": 7,
    "payment_term_id": 5,
    "order_status": "draft",
    "estimated_delivery_date": "2026-08-01",
    "supplier_notes": "Consignment reorder — per Gaelle Wizenburg unit mix.",
    "purchase_order_lines": [
      { "product_id": 1567, "description": "Blue Widget", "quantity": 200, "amount": 4.20 },
      { "product_id": 1568, "description": "Red Widget",  "quantity": 50,  "amount": 4.35 }
    ]
  }'
```

See [`examples/request.json`](./examples/request.json) for the same body as a file.

## Handle the response

- **`200`** → `{ "data": { "id", "po_number", "order_status", "total" }, "message" }`. Capture the
  `id` and `po_number`; report them, and **output the direct link to the PO** so the user can click
  straight into it:

  ```
  https://{tenant}.sku.io/v2/orders/purchase-orders/{id}
  ```

  Always end by giving the user this URL along with the PO number and order status — a PO buried
  in a table search or filter is easy to miss.
- **`422`** → validation failed. The `errors` map names the fields; line errors use dot-notation,
  e.g. `purchase_order_lines.0.quantity`. Common causes: missing `purchase_order_date`, neither
  `supplier_id` nor `supplier_name`, neither `currency_id` nor `currency_code`, or a missing
  `destination_warehouse_id` on a non-dropship PO. Fix the named fields and resubmit — never
  blind-retry. See [`shared/errors.md`](../../../shared/errors.md).
- **`403`** → the token lacks a required scope (`purchase-orders:write` to create; `suppliers:read`
  / `warehouses:read` / `products:read` / `settings:read` for the lookups) or the user lacks
  `purchase_orders.create`.

## Optionally: submit it to the supplier

Creating a PO does **not** send it. To send it, `POST /api/purchase-orders/submit` with
`{ "ids": [<po_id>] }`. **Submitting emails the supplier** — a real, outward-facing action. Only
submit when the user explicitly asks, and confirm first; default to leaving the new PO unsent for
review. (Approval is separate: create with `approval_status: "approved"`, or approve later.)

## Guardrails

- **Confirm before creating, and again before submitting.** A PO is a commitment; submitting it
  contacts the supplier. Don't do either silently.
- **Don't invent ids or costs.** `supplier_id`, `destination_warehouse_id`, `payment_term_id`,
  `product_id`, and each line `amount` must be resolved or supplied — blank/ask beats wrong.
- **Consignment specifics.** Route to the consignment (supplier-owned) warehouse and apply the
  consignment payment term; get both right, because consignment settlement later prices sold stock
  off this PO's costs.
- **Not idempotent.** A retry after an ambiguous timeout can create a duplicate PO. On timeout,
  search recent POs (`GET /api/purchase-orders?search=<supplier or po number>`) before re-posting.
- **Hold incomplete lines.** If a SKU won't resolve or has no defensible cost, set it aside, create
  the rest, and list what you held for the user to resolve.

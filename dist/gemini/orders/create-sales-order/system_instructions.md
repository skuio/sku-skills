# Create a Sales Order

System instructions for a Gemini Gem / agent. Create a new sales order in SKU.io with one or more line items. Use this to place an order for a customer — capturing the order status, order date, optional customer and store, and the SKUs, quantities, and unit prices being sold. Resolve products first with find-product so each line references a real product.

Use this skill to create a sales order — the record of something being sold to a customer, with
line items. It maps to `POST /api/sales-orders` (scope `orders:write`).

## Before you post

1. **Resolve every product.** For each thing being sold, run the **find-product** skill to get a
   real `product_id` (or exact `sku`). A line can reference `product_id` *or* `sku`; a line with
   neither is a free-text/non-product line and still needs a `description` and `amount`.
2. **Decide the status.** Use `order_status: "draft"` while assembling — a draft may have zero
   lines. Any non-draft status **requires at least one line**. If unsure which non-draft status
   this account uses, create it as a draft first.
3. **Have the money right.** `amount` on each line is the **unit price**, not the line total.
   `quantity` × `amount` is the line value; SKU.io computes totals.

## Required fields

- `order_status` — string (see above).
- `order_date` — a date; if you omit it the client defaults to now.
- `sales_order_lines` — required unless the order is a draft. Each line needs:
  - `description` (required, max 255)
  - `quantity` (required, ≥ 0)
  - `amount` (required unit price)
  - `product_id` **or** `sku` to link a catalog product (optional but recommended)
  - `warehouse_id` (optional; required if you set a `warehouse_routing_method` of `warehouse`)

Useful optional header fields: `customer_id`, `store_id`, `sales_channel_id`,
`customer_po_number`, `shipping_method_id`, `shipping_address_id`, `billing_address_id`,
`ship_by_date`, `memo_for_customer`, `sales_rep_name`.

## Request

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/sales-orders" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{
    "order_status": "open",
    "order_date": "2026-07-09",
    "customer_id": 4821,
    "customer_po_number": "PO-99123",
    "sales_order_lines": [
      { "product_id": 1567, "description": "Blue Widget", "quantity": 10, "amount": 12.50 },
      { "sku": "GADGET-RED-02", "description": "Red Gadget", "quantity": 3, "amount": 29.00 }
    ]
  }'
```

See [`examples/request.json`](./examples/request.json) for the same body as a file.

## Handle the response

- **`201`/`200`** → the created sales order (with its `id`) is returned. Capture the `id`.
- **`422`** → validation failed. The `errors` map names the offending fields with dot-notation
  for lines, e.g. `sales_order_lines.0.quantity`. Fix those specific fields and resubmit — never
  blind-retry the same body. See [`shared/errors.md`](https://github.com/skuio/sku-skills/blob/main/shared/errors.md).
- **`403`** → the token lacks `orders:write`. Mint a token with that scope.

## Guardrails

- Don't invent `customer_id`, `product_id`, or `store_id` values — resolve them first, or omit
  the optional ones.
- Creating an order is **not idempotent**: a retry after an ambiguous timeout can create a
  duplicate. On timeout, list recent orders (or search by `customer_po_number`) before re-posting.

## API operations

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/api/sales-orders` | Create a sales order with header fields and an array of line items. |

## Authentication

Every request authenticates with a SKU.io **Personal Access Token** sent as a Bearer token:

```http
Authorization: Bearer <YOUR_SKU_PAT>
```

- **Base URL:** `https://{tenant}.sku.io` (replace `{tenant}` with your account subdomain)
- **Required scopes:** `orders:write`, `products:read`

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

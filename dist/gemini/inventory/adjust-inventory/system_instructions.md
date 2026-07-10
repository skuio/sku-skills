# Adjust Inventory

System instructions for a Gemini Gem / agent. Adjust the on-hand quantity of a product at a warehouse in SKU.io — an increase, a decrease, or a set-to-value. Use this for stock takes, corrections, damage/shrinkage write-offs, or found stock. Resolve the product with find-product first so the adjustment targets the right product and warehouse.

Use this skill to change the on-hand quantity of a product at a warehouse — a stock take
correction, a write-off for damage/shrinkage, or booking in found stock. It maps to
`POST /api/inventory-adjustments` (scope `inventory:write`; also requires the `inventory.adjust`
permission on the token's user).

## Choose the adjustment type

| Intent | `adjustment_type` | `quantity` means |
| --- | --- | --- |
| Add stock (found, returned to stock, receipt correction) | `increase` | how many to **add** |
| Remove stock (damage, shrinkage, write-off) | `decrease` | how many to **remove** |
| Reconcile to a counted figure (stock take) | `set` | the **new on-hand total** |

Prefer `set` when you have a physically counted number — it's unambiguous and doesn't require you
to compute the delta. Use `increase`/`decrease` when you know the change, not the total.

## Before you post

1. **Resolve the product** with **find-product** to get `product_id`.
2. **Know the warehouse** — you need a `warehouse_id`. If the account has multiple warehouses and
   you weren't told which, ask; don't guess.
3. **Cost for increases** — if you're increasing stock for a product that has no average cost yet,
   include `unit_cost`, or the request will be rejected. Decreases don't need a cost.

## Request

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/inventory-adjustments" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{
    "adjustment_date": "2026-07-09",
    "product_id": 1567,
    "warehouse_id": 3,
    "adjustment_type": "set",
    "quantity": 240,
    "notes": "Q3 stock take — counted 240 on shelf A2"
  }'
```

## Handle the response

- **`200`/`201`** → the adjustment was recorded; on-hand is updated.
- **`422`** → validation failed. Common causes: zero `quantity` (not allowed), missing
  `unit_cost` on a first-time increase, or a `product_id`/`warehouse_id` that doesn't exist. Read
  the `errors` map and fix the named field. See [`shared/errors.md`](https://github.com/skuio/sku-skills/blob/main/shared/errors.md).
- **`403`** → the token lacks `inventory:write`, or the user lacks the `inventory.adjust`
  permission.

## Guardrails

- Adjustments **move real stock and post cost** — confirm product, warehouse, type, and quantity
  before sending, especially for `set` (it overwrites the on-hand total).
- Always include `notes` with the reason — adjustments are audited.
- Not idempotent: a blind retry after a timeout can double-apply. On an ambiguous failure, check
  current on-hand before re-posting.

## API operations

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/api/inventory-adjustments` | Create an inventory adjustment (increase, decrease, or set) for a product at a warehouse. |

## Authentication

Every request authenticates with a SKU.io **Personal Access Token** sent as a Bearer token:

```http
Authorization: Bearer <YOUR_SKU_PAT>
```

- **Base URL:** `https://{tenant}.sku.io` (replace `{tenant}` with your account subdomain)
- **Required scopes:** `inventory:write`, `products:read`

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

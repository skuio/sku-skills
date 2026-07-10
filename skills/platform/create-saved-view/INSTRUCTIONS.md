Use this skill to leave a **saved view** on a SKU.io data table — a named, reusable configuration
of columns + filters + sort + search — and **favorite it** so the user actually finds it. Saved
views work on every data table (products, sales orders, inventory, purchase orders, …).

A view you create for someone to look at should almost always be **favorited** (`is_user_favorite:
true`). An unfavorited view is buried in a menu; a favorited one sits on the table's favorites bar,
one click away. If it should be the screen they land on, also set `is_user_default: true`.

**Show every field the work touched — miss nothing.** When the view exists to let someone check a
bulk operation (an import, a bulk edit), its visible columns must include a column for **every data
point that operation wrote** — plus `id`. If the import set a supplier SKU, a supplier wholesale
price, a cost, a retail price, and three attributes, then all of them belong in the view. A review
view that shows half the written fields defeats its purpose. Enumerate exactly what was written, map
each to its column key, and include them all — don't stop at the "obvious" columns.

## The two things a view needs

1. **`model`** — the exact data-table model string the target page uses. It's a class name, e.g.
   `App\Models\Product` for the Products table. Get it wrong and the view won't attach to the page.
   Common ones: `App\Models\Product` (Products), `App\Models\SalesOrder` (Sales Orders). If unsure,
   confirm the page's model before creating.
2. **`query_data`** — a **JSON string** describing the view state:

   ```json
   {
     "columns": { "visible": ["image", "sku", "name", "brand_name", "created_at"] },
     "search": "The Whale Lounge",
     "filters": { "type": "standard" },
     "filterGroups": "<base64 advanced-filter tree, optional>",
     "sortBy": "-created_at",
     "pagination": { "per_page": 50 }
   }
   ```

   Every key is optional — include only what the view needs. `columns.visible` is an ordered list
   of column keys; `search` is free-text; `filters` are simple `key: value` quick-filters;
   `filterGroups` is the base64 advanced-filter tree (only if you need grouped AND/OR conditions);
   `sortBy` uses `-` for descending. **The column keys and filter keys must be valid for that
   table** — reuse the keys the page already exposes; don't invent them. **Always include `id`** as
   the first visible column — it's the stable row key. Dynamic columns exist alongside the fixed
   ones: a custom **attribute** is the column `attribute_<attributeId>` (shown as `Attr: <name>` in
   the picker), plus `pricing_tier_<id>`, `supplier_tier_<id>`, `warehouse_available_<id>`. To
   include an attribute column, resolve that attribute's id first.

## Steps

1. **Know the table.** Identify the `model` string and the column/filter keys that table supports.
2. **Build `query_data`** for the slice you want to show, then `JSON.stringify` it (it is sent as a
   string, not a nested object).
3. **Avoid duplicates.** `GET /api/data-tables/saved-views?model=<model>` and skip (or reuse) a view
   that already has the name you're about to create.
4. **Create + favorite in one call:**

   ```bash
   curl -sS -X POST "https://$SKU_TENANT.sku.io/api/data-tables/saved-views" \
     -H "Authorization: Bearer $SKU_PAT" \
     -H "Content-Type: application/json" -H "Accept: application/json" \
     -d '{
       "model": "App\\Models\\Product",
       "name": "The Whale Lounge — New Import",
       "query_data": "{\"search\":\"The Whale Lounge\",\"sortBy\":\"-created_at\",\"columns\":{\"visible\":[\"id\",\"image\",\"sku\",\"name\",\"brand_name\",\"barcode\",\"default_supplier_sku\",\"default_supplier_price\",\"unit_cost\",\"default_price\",\"attribute_5\",\"attribute_141\",\"attribute_142\",\"created_at\"]},\"pagination\":{\"per_page\":50}}",
       "is_user_favorite": true,
       "is_shared": true
     }'
   ```

   To favorite an **existing** view instead: `POST /api/data-tables/saved-views/{id}/favorite`
   with `{ "is_favorite": true }`. To make a view the landing view:
   `POST /api/data-tables/saved-views/{id}/set-default`.

5. **Tell the user** the view name and that it's on the favorites bar of the relevant page.

## Using this from another skill (composition)

This skill is meant to be reused. For example, after **build-product-catalog** imports products,
call this to drop a favorited view scoped to exactly what was created, so the user can eyeball it:

- `model`: `App\Models\Product`
- `search` or `filters`: something that isolates the import (the brand you set, or `sortBy:
  "-created_at"` to float the newest rows to the top)
- `columns.visible`: the fields that matter for the review, including the ones the import populated
  (sku, supplier sku, costs, price) so the user can confirm they landed
- `is_user_favorite: true`

## Auth & guardrails

- **Auth:** the saved-view endpoints require a valid token (no special resource scope). To actually
  *view* the data behind the view, the user also needs read access to that table (e.g.
  `products:read`).
- **Valid keys only.** Column and filter keys must be ones the table exposes — an unknown column key
  is silently ignored and the view looks broken. When composing from another skill, prefer keys you
  know exist.
- **Attributes are real, selectable columns.** A custom product attribute is a column keyed
  `attribute_<attributeId>` (labelled `Attr: <name>`). To show imported attribute data, resolve the
  attribute ids and add those keys to `columns.visible` — never assume attributes are detail-page-only.
- **Don't drop written fields.** Cross-check the view's `columns.visible` against the full list of
  fields the operation populated. On the Products table, easy-to-forget ones are the supplier
  wholesale price (`default_supplier_price`), the supplier SKU (`default_supplier_sku`), and each
  attribute (`attribute_<id>`) — all are real columns, most default to hidden, so you must name them
  explicitly.
- **`is_shared`.** Defaults to shared (other users see it). Set `false` for a personal, throwaway
  view.
- **Favorite vs default.** Favorite = pinned to the bar (can have several). Default = the view the
  table opens on (one). Creating a favorited view doesn't change what the table opens on unless you
  also set default.

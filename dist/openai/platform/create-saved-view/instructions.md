# Create a Saved View (and favorite it)

_Create a saved view for any SKU.io data table (products, sales orders, inventory, …) — a named, reusable configuration of visible columns, filters, sort, and search — and favorite it so it appears on the table's favorites bar. Use this to give a user a one-click way back to a specific slice of data: a fresh import, an exception queue, a curated report. Composable — other skills (e.g. build-product-catalog) call it to leave behind a view of what they just created._

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

## Step 0 — Connect first

Every call below authenticates as a SKU.io **Personal Access Token** against one specific
tenant, so two things have to be true before Step 1: `$SKU_TENANT` and `$SKU_PAT` are set, and
that token actually carries `settings:write`.

If you cannot confirm both, **run the `connect-to-sku` skill first** rather than trying a call
to see what happens. It mints the token, confirms the tenant is the one the user meant, and reads
the scopes back off the token — so a missing scope surfaces now, in one exchange with the user,
instead of as a `403` midway through with half the work already committed. If that skill is not
installed alongside this one, its instructions are at <https://github.com/skuio/sku-skills/tree/main/skills/platform/connect-to-sku>.

Never invent a tenant or a token, and never quietly fall back to a different tenant than the one
the user named. Writing to the wrong account is the one mistake here the API cannot undo for you.

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
     "filterGroups": "<base64 advanced-filter tree — the reliable filter channel>",
     "sortBy": "-created_at",
     "pagination": { "per_page": 50 }
   }
   ```

   Every key is optional — include only what the view needs. `columns.visible` is an ordered list
   of column keys; `search` is free-text; `sortBy` uses `-` for descending.

   > **Filtering a saved view: use `filterGroups`, and expect `filters` to be mostly dead.**
   > The frontend does NOT pass `filters` keys through to the API. A key survives only if that
   > page registers it — on Products that is just `search`, `type`, `archived` — or if it names
   > an **advanced-filter column**, in which case it's migrated into the tree (a comma list
   > becomes `is_one_of`). Everything else — `ids`, `id`, `brand_id`, `default_supplier_id`,
   > `stock_status` — is **silently dropped**: the view saves fine, loads looking unfiltered,
   > and the quick-filter dropdowns (Brand / Default Supplier / Stock) are never saved-view
   > driven at all. The API honoring `filter[ids]=…` on a direct call proves nothing about the
   > view — the datatable rebuilds its own params and never forwards unknown keys.
   >
   > **To pin a view to an exact row set** (an import you just created, a reprice you just
   > applied), build a `filterGroups` tree on a *registered* column — `sku` with `is_one_of`
   > and a comma-joined value is the workhorse; numeric `id` is NOT a registered tree column
   > (hard 400):
   >
   > ```
   > tree = { "conjunction": "and", "children": [ { "type": "condition", "condition":
   >          { "column": "sku", "operator": "is_one_of", "value": "SKU-1,SKU-2,SKU-3" } } ] }
   > filterGroups = base64(JSON.stringify(tree))
   > ```
   >
   > Verify before saving: `GET <the table's list endpoint>?filter_groups=<base64>` must return
   > exactly the rows you expect (an unregistered column.operator is a 400). Operators: text
   > columns take is / is_not / is_one_of / contains / starts_with …; numeric take is /
   > greater_than / between / is_one_of …; multi-values are ONE comma-joined string, not an
   > array; groups nest max one level.

   **The column keys must be valid for that
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

5. **Output the direct link to the view.** The create response returns the view's `hash`; a data
   table opens with a view applied via the `?view=<hash>` query param. Build and give the user the
   URL:

   ```
   https://{tenant}.sku.io/v2/{page}?view={hash}
   ```

   `{page}` is the table's page path — the SPA route where that data table lives (e.g. `products`
   for the Products table, `sales-orders` for Sales Orders). Example:
   `https://acme.sku.io/v2/products?view=7329136e-91b1-433b-be6f-23772f2b970e`. Always finish by
   giving the user this clickable link (plus the view name and that it's on the favorites bar) — a
   view they can't find isn't much use.

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

## API operations

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/data-tables/saved-views` | List existing saved views for a data-table model (use to avoid duplicate names). |
| `POST` | `/api/data-tables/saved-views` | Create a saved view; set is_user_favorite to pin it to the favorites bar. |
| `POST` | `/api/data-tables/saved-views/{saved_view}/favorite` | Favorite or unfavorite an existing saved view for the current user. |
| `POST` | `/api/data-tables/saved-views/{saved_view}/set-default` | Make a saved view the current user's default (landing) view for its table. |

## Authentication

Every request authenticates with a SKU.io **Personal Access Token** sent as a Bearer token:

```http
Authorization: Bearer <YOUR_SKU_PAT>
```

- **Base URL:** `https://{tenant}.sku.io` — replace `{tenant}` with your account subdomain.
  The subdomain may itself contain a dot (beta and staging accounts often do), so take
  **everything** before `.sku.io` in the URL you sign in at, not just the first label.
- **Required scopes:** `settings:write`

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

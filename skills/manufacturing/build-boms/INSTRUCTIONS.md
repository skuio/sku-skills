Use this skill to create **bills of materials** (BOMs, recipes) for products the business makes,
from the recipe sheet it already keeps. A BOM says what one batch of a finished product consumes,
so manufacturing orders can issue materials, cost the output, and tell purchasing what to reorder.

It is the agent lane for the Launch Roadmap step **Bills of materials**. SKU.io marks that step done
on its own when **every active manufactured product has a non-archived BOM with at least one
component line**. Nothing you say makes it done; the data does.

The pipeline:

```
Measure → Find products without a BOM → Read the recipe sheet → Resolve ingredients and units
  → Propose → Approve → Create drafts (≤25 per batch) → Verify → Report
```

## Step 1 — Find the manufactured products that have no BOM

List the manufactured products (iterate `page` to `last_page`, skip any row with `archived_at` set):

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/v2/products?filter[type]=manufactured&per_page=100&page=1" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

List the existing BOMs (archived ones are excluded by default):

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/manufacturing/boms?per_page=100&page=1" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
# → data[]: { id, product_id, name, status, version_number, component_lines_count, archived_at, ... }
```

A product is **covered** when one of its BOMs has `component_lines_count > 0`. Everything else is the
worklist. Tell the user the count ("14 of 22 manufactured products have a recipe") before going on.

A BOM that exists with **zero component lines** is a half-finished recipe someone started. Don't add
a second BOM next to it, and don't edit it. List it as **needs a person** and give its link
(`https://{tenant}.sku.io/v2/manufacturing/boms/{id}`).

## Step 2 — Read the recipe sheet

Ask the user where their recipes live: a "Recipes" or "Formulas" tab, a spec sheet per product, a
co-packer's bill of materials, a PDF. Read it with your own tools (Drive/Sheets, an email
attachment). The messy-spreadsheet rules in `build-product-catalog` apply: find the real header
row, pick the right tab, skip subtotal and "TOTAL" rows.

Normalize to one row per ingredient:

| finished SKU | batch yield | ingredient SKU (or name) | quantity | unit | scrap % | note |
| --- | --- | --- | --- | --- | --- | --- |
| LOAF-800 | 12 | RAW-FLOUR-25KG | 6 | kg | 2 | |
| LOAF-800 | 12 | RAW-SALT | 120 | g | | |
| LOAF-800 | 12 | PKG-BAG-LOAF | 12 | ea | | |

Things to settle with the user rather than assume:

- **Per unit or per batch?** "6 kg flour" for a batch of 12 loaves is 0.5 kg per loaf. If the sheet
  has a batch size, keep quantities per batch and set the output quantity to the batch size (Step 5).
  If it doesn't say, ask.
- **Packaging and labels** are components too, if the business stocks them. Ask whether to include
  them; leaving them out makes reorder suggestions blind to bags and boxes.
- **Optional ingredients**, alternates ("flour A or flour B") and labour notes are not plain
  component lines. Flag them for the user instead of choosing one.

## Step 3 — Resolve ingredients to products

- Exact SKU: `GET /api/products/by-sku?sku=RAW-FLOUR-25KG`.
- Named only: `GET /api/v2/products?filter[search]=bread flour&filter[type]=standard,manufactured`.
  More than one plausible match → ask. (`find-product` covers the harder cases.)
- **Not found** → the raw material isn't in the catalog. That's the Launch Roadmap's "Create
  component-only products" step. Don't invent it: hold the BOM out and offer to create the missing
  materials with `build-product-catalog` first.
- **Wrong type** → BOM lines only accept products that carry stock: `standard`, `kit`,
  `blemished`, `manufactured`. A `bundle` or `matrix` parent is rejected (`422`). An intermediate
  you make yourself (a dough, a syrup) is a `manufactured` product with its own BOM.
- The finished product must not also appear as one of its own components.

## Step 4 — Resolve units

Each component line has a `uom_id`. **Leave it out** and SKU.io uses the ingredient's own stock
unit, which is right whenever the sheet's unit matches how the material is stocked.

When the sheet uses a different unit (grams of salt stocked in kg), look up the ids:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/manufacturing/units-of-measure" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
curl -sS "https://$SKU_TENANT.sku.io/api/manufacturing/products/{product}/units-of-measure" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

A line's `uom_id` must be **enabled on that product**; otherwise the create fails with "'g' isn't
enabled for 'Salt'. Add it on the product's Units of Measure tab, or pick an enabled unit." You may
either convert the quantity into the stock unit yourself (120 g → 0.12 kg — say so in the proposal)
or ask the user to enable the unit on the product. Don't enable units yourself: that changes the
product's conversion factors.

## Step 5 — Propose, then get an explicit yes

Show one block per BOM before any write:

> **LOAF-800 — Sourdough Loaf 800g** · BOM "Sourdough Loaf 800g — recipe v1" · draft · effective 2026-10-21
> Makes **12** per batch
> | Ingredient | Qty | Unit | Scrap |
> | --- | --- | --- | --- |
> | RAW-FLOUR-25KG — Bread flour | 6 | kg (stock unit) | 2% |
> | RAW-SALT — Fine sea salt | 0.12 | kg (converted from 120 g) | |
> | PKG-BAG-LOAF — Loaf bag | 12 | ea | |
> Source: "Recipes" tab, rows 4–6

Then list what's **held out** (missing materials, ambiguous rows, products that already have a
half-finished BOM) and how many batches the write takes. Ask the user to approve, edit or drop. The
`effective_from` date is part of the approval: default to today unless the user names a date.

## Step 6 — Create the BOMs as drafts (≤25 per batch)

Right before each create, re-check `GET /api/manufacturing/boms?filter[product_id]={id}` so you
never stack a second BOM on a product someone covered in the meantime.

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/manufacturing/boms" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{
    "product_id": 900,
    "name": "Sourdough Loaf 800g — recipe v1",
    "status": "draft",
    "effective_from": "2026-10-21",
    "version_notes": "From the Recipes tab of Production 2026.xlsx, rows 4-6; approved by the user 2026-10-21.",
    "output_lines": [ { "product_id": 900, "role": "primary", "quantity": 12 } ],
    "component_lines": [
      { "product_id": 501, "quantity": 6, "expected_scrap_percent": 2 },
      { "product_id": 502, "quantity": 0.12 },
      { "product_id": 503, "quantity": 12 }
    ]
  }'
# → 201 { "id": 77, "product_id": 900, "status": "draft", "version_number": 1, ... }
```

Field notes:

- **`status: "draft"`.** A person reviews and activates the recipe in the app. The roadmap counts a
  draft BOM as long as it has component lines, so the step still completes. (Over MCP, omit
  `status`; see below.)
- `output_lines` is optional. Leave it out and SKU.io adds the primary output (`product_id` × 1),
  meaning the component quantities are **per unit**. Send it, as above, when the sheet is per batch.
  `role` is one of `primary`, `coproduct`, `byproduct`, `scrap`; only add co-products and by-products
  the sheet actually names.
- `uom_id` on any line is optional (defaults to that product's stock unit) — see Step 4.
- `default_consumption_method` (`forward_flush` / `backflush`) and per-line `consumption_method`:
  leave them out unless the user tells you how they issue materials.
- Don't send `is_default`, `operations`, or cost-allocation fields from a recipe sheet. Those are
  production-setup decisions for a person.

Responses:

- **`201`** — record the BOM id.
- **`422`** — read the `errors` map: a missing `name`/`effective_from`, a non-stock product type, a
  unit not enabled on the product, a component that is also an output. Record it and carry on with
  the rest of the batch.
- **`403`** — the token lacks `manufacturing:write`, or the user lacks the `manufacturing.index`
  permission that gates the whole manufacturing area. Stop.

After each batch of ≤25, post a progress line (created / failed / remaining).

## Step 7 — Verify and report

- `GET /api/manufacturing/boms/{bom}` on two or three new BOMs: check the component lines, units
  and output quantity came out as proposed.
- Re-count coverage as in Step 1 and show before → after.
- Report: **created** (product → BOM id, link `https://{tenant}.sku.io/v2/manufacturing/boms/{id}`),
  **held out** with the reason, **failed** with the API message, and what the user still has to do
  (activate the drafts, enable a unit, create missing materials).

Working a Launch Roadmap step? Hand this summary to `follow-launch-roadmap` to post as the step's
progress comment. The next roadmap step, **Count raw materials**, needs every BOM component on a
counted stock take.

## Connected through the SKU.io MCP server?

Through the MCP server every read above works (`api_read`), and `api_write` can call
`POST /api/manufacturing/boms`, **always as a draft that is not the default**. Leave `status` and
`is_default` out of the body entirely: the server refuses a request that sends either, even
`"status": "draft"`, and creates the BOM as a draft for you. Activating a BOM or making it the
default is a person's call in the app (`https://{tenant}.sku.io/v2/manufacturing/boms/{id}`). The
write needs the connection's manufacturing write access.

## Guardrails

- **Propose before writing.** No BOM is created until the user has approved it in the Step 5 form,
  including the effective date and whether quantities are per unit or per batch.
- **Create, never change.** This skill only adds draft BOMs. It never updates, activates,
  archives, versions or deletes an existing BOM, and never adds a second BOM to a product that has
  one.
- **Don't invent materials, quantities or yields.** A row you can't resolve is held out and
  reported. A wrong recipe silently mis-costs every batch made from it.
- **Don't enable units of measure or change product types** to make a line fit. Ask the user.
- **Not idempotent.** A blind retry after a timeout can create a duplicate BOM. Re-list by
  `filter[product_id]` before retrying.
- **Batch ≤25, report each batch**, and finish with exactly what changed.

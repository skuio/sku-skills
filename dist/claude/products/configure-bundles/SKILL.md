---
name: configure-bundles
description: "Give every bundle and kit in SKU.io its components. Finds bundle/kit products that have no components yet (and standard products whose names look like packs or sets), proposes each recipe from a component list the user supplies (a sheet or file in their Drive or email) or from its channel listing titles, gets the user's approval, then saves the components in batches of at most 25 and reports what changed. Use it for the Launch Roadmap's \"Configure kits & bundles\" step, after importing channel listings that turned out to be multi-packs or sets, or whenever the Product Data Health report shows kits or bundles without components. It never replaces a recipe that already has components and never deletes anything."
license: MIT
---

# Configure Bundles and Kits

Use this skill to give every **bundle** and **kit** in SKU.io its components, so that selling one
draws down (or assembles from) the right parts. It is the agent lane for the Launch Roadmap step
**Configure kits & bundles**: SKU.io marks that step done on its own when every active bundle and
kit has at least one component. Nothing you say makes it done; the data does.

The pipeline:

```
Measure → Find the empty ones → Gather recipes → Resolve components → Propose → Approve
  → Write (≤25 per batch) → Verify → Report
```

Two product types matter here, and the difference changes what the user should expect:

| Type | What it is | When an order ships |
| --- | --- | --- |
| `bundle` | A virtual grouping with no stock of its own ("Shampoo + Conditioner Duo") | SKU.io ships the components; the bundle line is split into its parts |
| `kit` | A stocked product assembled from parts ahead of time ("Gift Box, pre-packed") | The kit's own stock ships; components are consumed when kits are assembled |

If the user isn't sure which one a product is, ask: "Do you keep these pre-packed on a shelf (kit),
or pick the parts when the order comes in (bundle)?"

## Step 0 — Connect first

Every call below authenticates as a SKU.io **Personal Access Token** against one specific
tenant, so two things have to be true before Step 1: `$SKU_TENANT` and `$SKU_PAT` are set, and
that token actually carries `products:read`, `products:write`.

If you cannot confirm both, **run the `connect-to-sku` skill first** rather than trying a call
to see what happens. It mints the token, confirms the tenant is the one the user meant, and reads
the scopes back off the token — so a missing scope surfaces now, in one exchange with the user,
instead of as a `403` midway through with half the work already committed. If that skill is not
installed alongside this one, its instructions are at <https://github.com/skuio/sku-skills/tree/main/skills/platform/connect-to-sku>.

Never invent a tenant or a token, and never quietly fall back to a different tenant than the one
the user named. Writing to the wrong account is the one mistake here the API cannot undo for you.

## Step 1 — Measure where things stand

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/product-data-health/metrics" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
# → { ..., "kits_without_components": 12, "bundles_without_components": 31, ... }
```

These two counts are what this skill drives to zero. Say them back to the user before anything else.

## Step 2 — Find the products that need a recipe

**Bundles and kits with no components** — the core worklist:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/v2/products/bundle-workshop?filter[status]=unconfigured&per_page=100&page=1" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
# → { "data": [ { "id": 812, "sku": "DUO-SHMP-COND", "name": "Shampoo + Conditioner Duo",
#                 "type": "bundle", "components_count": 0, "is_configured": false }, ... ],
#     "current_page": 1, "last_page": 1, ... }
```

Iterate `page` to `last_page`. Archived products are already excluded, matching the roadmap check.

**Standard products that look like packs or sets** — listings imported from a channel often arrive
as `standard` even when they are really a 2-pack or a gift set. Ask SKU.io's own pattern detector:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/v2/products/bundle-workshop/auto-detect?filter[confidence]=high&per_page=100" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
# → rows with detected_pattern, suggested_type, confidence, has_inventory_movements
```

These are **suggestions, not facts**. A "Pack of 3 Socks" that the supplier ships as one sealed
item is a standard product. Converting one is a separate, bigger decision (Step 6b). Never convert
anything the user hasn't named or confirmed.

## Step 3 — Gather the recipes

The best source is a **component list the user already has**: a "kits" tab in their catalog
sheet, a supplier's set breakdown, a 3PL's kitting instructions, an email from the ops lead. Ask
for it first ("Do you have a sheet that lists what goes in each kit or bundle?"), then read it with
your own tools (Drive/Sheets, an email attachment, a PDF). The messy-spreadsheet rules in
`build-product-catalog` apply: find the real header row, pick the right tab, skip totals.

Normalize it to one row per component:

| parent SKU | component SKU (or name) | quantity |
| --- | --- | --- |
| DUO-SHMP-COND | SHMP-250 | 1 |
| DUO-SHMP-COND | COND-250 | 1 |
| SOCK-3PK | SOCK-BLK-M | 3 |

When the user has **no list**, propose recipes from the listing text — and label every one of them
as inferred:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/v2/products/812/listings" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
# → data[].title, data[].sales_channel, data[].listing_sku.seller_sku
```

A title like "Shampoo & Conditioner Duo (250 ml each)" suggests two components at quantity 1; "Black
Crew Socks, 3-Pack, Size M" suggests `SOCK-BLK-M` × 3. Only propose a component you can point at in
the title. When the title doesn't say, mark the row **needs the user** instead of guessing.

## Step 4 — Resolve every component to a product id

Components must already exist as products, and must be type **`standard` or `kit`** — a bundle or a
matrix parent can't be a component.

- Exact SKU: `GET /api/products/by-sku?sku=SHMP-250` → `200` with the product, or `404`.
- Named, not SKU'd: `GET /api/v2/products?filter[search]=conditioner 250&filter[type]=standard,kit`.
  More than one plausible match → ask; never pick by best guess. (`find-product` covers the harder
  cases.)
- **Not found** → the part isn't in the catalog yet. That is the Launch Roadmap's "Create
  component-only products" step. Don't invent a product to satisfy a recipe: hold the row out, and
  offer to create the missing parts properly with `build-product-catalog` before coming back.

Also check each recipe for the API's own rules, so the write doesn't fail halfway:

- quantity is a number ≥ 1 (whole units for anything you count in units),
- a component appears **once** per recipe (sum duplicates),
- the parent is not one of its own components,
- the component isn't a bundle or kit that already contains this parent (circular).

## Step 5 — Propose, then get an explicit yes

Show the plan as a table before any write:

| # | Product | Type | Components (qty) | Source |
| --- | --- | --- | --- | --- |
| 1 | DUO-SHMP-COND — Shampoo + Conditioner Duo | bundle | SHMP-250 ×1, COND-250 ×1 | Kits sheet, row 14 |
| 2 | SOCK-3PK — Black Crew Socks 3-Pack M | bundle | SOCK-BLK-M ×3 | **Inferred** from Amazon title |
| 3 | GIFT-BOX-01 — Holiday Gift Box | kit | — | **Needs the user**: title doesn't list contents |

Below it, list: products skipped because they **already have components** (out of scope, see
Guardrails), components **not found**, and how many batches the write will take. Ask the user to
approve, edit or drop rows. Inferred rows need their own explicit approval — "yes to the sheet rows"
doesn't cover the inferred ones.

## Step 6a — Write the approved recipes (≤25 per batch)

Right before each write, re-read the product's components and confirm it is **still empty** — a
teammate may have configured it in the Bundle Workshop since you looked:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/v2/products/bundle-workshop/812/components" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
# → { "data": { "components": [], "buildable_quantity": 0, "total_unit_cost": 0 } }
```

Then save:

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/v2/products/bundle-workshop/812/components" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{
    "components": [ { "id": 501, "quantity": 1 }, { "id": 502, "quantity": 1 } ],
    "change_summary": "Initial recipe from the Kits tab of Catalog 2026-10.xlsx (row 14), approved by the user."
  }'
# → { "data": { "components": [...], "buildable_quantity": 40, "total_unit_cost": 7.1,
#               "revision": { "id": 9, "revision_number": 1, "valid_from": "2026-10-21" } } }
```

- **At most 25 products per batch.** After each batch, post a one-line progress note (done / failed
  / remaining) and continue only if nothing surprising happened. A run of failures means stop and
  show the user.
- Always send `change_summary` saying where the recipe came from. It is stored on the component
  revision and is the audit trail for "why does this kit contain that".
- **`422`** — read `message` (e.g. "X is not a standard or kit product and cannot be bundled.",
  "Component quantity must be at least 1."). Record the row, keep going with the rest.
- **`403`** — the token lacks `products:write`, or the user lacks the `products.update`
  permission. Stop.

## Step 6b — Converting a standard product (only when the user asks)

Turning a `standard` product into a bundle or kit is a type change, not just a recipe:

1. `POST /api/v2/products/bundle-workshop/check-restrictions` with `{"product_ids": [...]}`. A
   `true` means the product has sales or assembly history, and **cannot become a bundle**.
2. Explain the consequence before asking: converting to **bundle** also **splits any open sales
   order lines** for that product into its components, and from then on the product holds no stock
   of its own. Converting to **kit** keeps it stocked.
3. On an explicit yes, convert with the components in the same call (≤25 products per call):

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/v2/products/bundle-workshop/batch-convert" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{ "products": [ { "id": 640, "type": "bundle", "components": [ { "id": 610, "quantity": 3 } ] } ] }'
# → { "data": { "converted_count": 1, "skipped": [] } }
```

Report every `skipped[]` entry with its `reason` ("Has sales or assembly history — cannot convert to
Bundle.", "Open orders hold stock or shipments for it as a single item: SO-1042."). Those need a
person in the Bundle Workshop, not a retry.

## Step 7 — Verify and report

- Re-read 2–3 written products with `GET /api/v2/products/bundle-workshop/{product}/components`.
- Re-run `GET /api/product-data-health/metrics` and show the before → after counts.
- Report: **configured** (product, components), **converted**, **skipped as already configured**,
  **held out** (component not found, needs the user), **failed** (with the API's message). Give the
  user the link to check the result: `https://{tenant}.sku.io/v2/products/bundle-workshop`.

If you're working a Launch Roadmap step, hand this summary to `follow-launch-roadmap` to post as the
step's progress comment.

## Connected through the SKU.io MCP server?

Through the MCP server (`api_read` / `api_write`) you can do Steps 1–5, Step 6a and Step 7:

- **Allowed:** every read above, `POST /api/v2/products/bundle-workshop/{product}/components` **for
  a kit or bundle that has no components yet**, and `check-restrictions`.
- **Refused for a product that already has components** (`422 "… already has components. Through an
  AI assistant you can only set components on a kit or bundle that has none; change an existing
  recipe in SKU's Bundle Workshop."`). Pass that on: changing an existing recipe is done by a person
  in the Bundle Workshop (`https://{tenant}.sku.io/v2/products/bundle-workshop`).
- **Not available:** `batch-convert` and type changes (Step 6b). Give the user the approved
  conversions and send them to the Bundle Workshop.

The write still needs the connection's products write access and the user's `products.update`
permission.

## Guardrails

- **Propose before writing.** No recipe is saved until the user has seen it in the Step 5 table and
  said yes. Inferred recipes need their own yes.
- **Never replace an existing recipe.** `POST …/components` replaces the whole list, deleting
  components it leaves out. Only write to products whose `components_count` is `0`, re-checked right
  before the write. Changing an existing recipe is a component-revision decision for a person in the
  Bundle Workshop: if a kit or bundle already has components, tell the user to change it there.
- **Never delete, archive or un-convert anything.** This skill only adds.
- **Don't invent parts.** A component that doesn't resolve to an existing `standard` or `kit`
  product is held out and reported, not created on the fly.
- **Not idempotent across edits.** Re-saving the same list mints another revision. On a timeout,
  re-read the components before retrying.
- **Batch ≤25, report each batch**, and finish with what changed — counts and SKUs, not "done".

## API operations

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/product-data-health/metrics` | Account-wide catalog health counts. kits_without_components and bundles_without_components are the numbers this skill drives to zero. |
| `GET` | `/api/v2/products/bundle-workshop` | List active (non-archived) bundle and kit products with components_count and is_configured. filter[status]=unconfigured returns only the ones with no components. |
| `GET` | `/api/v2/products/bundle-workshop/auto-detect` | Standard products whose SKU or name matches a pack/set pattern ("2-pack", "set of 3", "bundle", "kit", ...), each with detected_pattern, suggested_type (bundle or kit), confidence, components_count and has_inventory_movements. |
| `GET` | `/api/v2/products/{product}/listings` | The product's sales-channel listings, each with its channel title, seller SKU and sales_channel. Read the titles to propose components when the user has no component list. |
| `GET` | `/api/v2/products/bundle-workshop/{product}/components` | A bundle or kit's current components (id, sku, name, quantity, type, available_stock, unit_cost) with buildable_quantity and total_unit_cost. Use it to confirm a product is still empty right before writing, and to verify afterwards. |
| `GET` | `/api/products/by-sku` | Resolve a component SKU from the user's list to its product id. |
| `GET` | `/api/v2/products` | Search the catalog when a component is named rather than given by SKU. Rows carry id, sku, name, type and barcode. |
| `POST` | `/api/v2/products/bundle-workshop/check-restrictions` | For standard products you plan to convert, report which have sales or assembly inventory movements (true = restricted). A product with history cannot become a bundle. |
| `POST` | `/api/v2/products/bundle-workshop/batch-convert` | Convert standard products to bundle or kit, setting their components in the same call. Converting to bundle also splits any open sales order lines for that product into its components. Returns converted_count and skipped[] with a reason per product. |
| `POST` | `/api/v2/products/bundle-workshop/{product}/components` | Set a bundle or kit's components. The list REPLACES the current recipe and records a new component revision dated today. Only call it on products with zero components. |

## Authentication

Every request authenticates with a SKU.io **Personal Access Token** sent as a Bearer token:

```http
Authorization: Bearer <YOUR_SKU_PAT>
```

- **Base URL:** `https://{tenant}.sku.io` — replace `{tenant}` with your account subdomain.
  The subdomain may itself contain a dot (beta and staging accounts often do), so take
  **everything** before `.sku.io` in the URL you sign in at, not just the first label.
- **Required scopes:** `products:read`, `products:write`

Mint a token under **Settings → Developer → Personal Access Tokens** in the SKU.io web app.
See [`shared/authentication.md`](shared/authentication.md) for the full flow.

---

## Improve this skill

Did this skill fall short—an unclear step, a wrong endpoint, or something it couldn't finish? Don't
just work around it: capture what was off and open a pull request so the next agent does better.

- Repo: <https://github.com/skuio/sku-skills>
- Edit the **canonical** skill under `skills/<domain>/<name>/` (not this generated file), then run
  `npm run build` and open a PR. External contributors: fork the repo and PR from the fork.
- The full agent workflow is in [`AGENTS.md`](https://github.com/skuio/sku-skills/blob/main/AGENTS.md).

Your agent can do this end to end. The library gets better every time someone sends a fix.

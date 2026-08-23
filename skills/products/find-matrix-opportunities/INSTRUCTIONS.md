Use this skill to answer "which of our products should really be one product with variants?" — and,
once the answer is agreed, to build those matrix families.

A **matrix** product in SKU.io is a container (`type: matrix`, no inventory of its own) whose
children are ordinary `standard` products linked by `parent_id`. The family declares its **axes** in
`shared_children_attributes` (attribute ids), and each child carries its value for each axis as a
product attribute. Channels read that structure to publish one grouped listing with a size/colour
selector instead of N unrelated listings.

The output is a **ranked list of candidate families**, each with its proposed axes, its grid of
children, the evidence behind it, and what is missing before it could be published. Creating the
families is a separate, explicitly confirmed step.

## Step 1 — See what evidence is available

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/integrations" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

Look for an entry with `name: "Amazon"` and read `integration_instances[].id`. If one exists, the
Amazon pass in Step 3 is available and you should use it — it is by far the strongest signal. If it
doesn't, Steps 2 and 4 alone still work; say so in the report rather than pretending the evidence is
equally strong.

## Step 2 — Scan the catalog

One paginated pass over `/api/v2/products` gives you everything. Each row already carries
`product_attributes`, `total_quantity_sold`, `total_orders`, `parent_id`, `is_variation`, `type`,
`barcode`, `image_url` and `brand_name` — you do **not** need a per-product call.

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/v2/products?per_page=200&page=1\
&filter%5Btype%5D=standard&sort=-total_quantity_sold" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

- Page until `current_page == last_page`. See [`shared/pagination.md`](../../../shared/pagination.md).
- **Skip rows where `parent_id` is set** — they are already in a family.
- On a large catalog, or when the user names a brand or product line, narrow first:
  `filter[brand_name]=…`, `filter[search]=…`, or `filter[total_quantity_sold.greater_than]=0` to
  consider only what actually sells. Say in the report which slice you scanned.
- Also pull `filter[type]=matrix` once, so you can report families that already exist and avoid
  proposing a duplicate.

## Step 3 — Corroborate against Amazon (when the integration exists)

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/amazon/{integrationInstance}/products?per_page=200&page=1" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

For each row, the useful parts are:

| Field | What it gives you |
| --- | --- |
| `sku_product.id` | **The join key back to the SKU.io catalog.** |
| `product_id` | The **ASIN** — despite the name. Never join on this. |
| `color`, `size`, `style` | Amazon's resolved per-child axis values. |
| `product_type` | Amazon's category, e.g. `INCONTINENCE_PROTECTOR`. |
| `catalog_data.relationships[].relationships[]` | Entries with `type: "VARIATION"` carry `parentAsins` and `variationTheme` (`{ attributes: ["color","size"], theme: "COLOR_NAME/SIZE_NAME" }`). |

Two SKUs sharing a `parentAsins` value are a family Amazon has already accepted, and the
`variationTheme` names the axes. That is vendor-validated evidence, not a guess — weight it far above
name pattern matching.

**Three traps, all of which occur in real data:**

1. **Amazon parentage is not authoritative for grouping.** One SKU.io product can have two Amazon
   listings under different ASINs, sometimes with different parents — so an ASIN group can pull in a
   product from a genuinely different family (a drawstring item landing under a snap-closure
   parent). Use the parent ASIN to *confirm* a family you derived from the catalog; use the internal
   product name to *define* its membership.
2. **Amazon size values are not normalised.** The same size arrives as both `Small` and
   `Small (12-20 Pound)`. Strip parentheticals before treating them as axis values, or a four-size
   family will present as seven and the channel selector will be broken.
3. **A populated `color`/`size` is not proof of an axis, and neither is the theme.** A family can
   declare `COLOR_NAME/SIZE_NAME` while every child resolves to the *same* colour — and that colour
   can be plain wrong (six helmets named "Flat Black" all reporting `color: "Matte Black"`).
   Read the theme to learn **which attributes to look at**, then derive the axes from the values
   that actually **vary** across the children. Corrupted data is common in the other direction too,
   e.g. a colour name stored in the `Size` field.

## Step 4 — Cluster into candidate families

Work from the internal `name` and `sku`. Common shapes, most reliable first:

| Shape | Example | Axes |
| --- | --- | --- |
| `<family> <SIZE> - <Colour>` | `Reusable Swim Diaper Snaps L - Seally` | Size, Colour |
| `<family> (<Colour>, <Size>)` | `T3 Full-Face Helmet (Matte Black, Medium)` | Size, Colour |
| `<family> <Colour> <SIZE>` | `Retro Full Face Helmet Flat Black XL` | Size, Colour |
| `<family> - <Colour>` | `Diaper Pail White` | Colour only |
| `<family> <SIZE>` | `3 Hemp Inserts Newborn` | Size only |

Then reinforce or reject each cluster:

- **Existing attributes are strong evidence.** A group already carrying `Size`/`Color` product
  attributes needs no name parsing — but validate the values first (trap 3).
- **A shared brand and a shared Amazon `product_type`** support the grouping.
- **Declare only the axes that actually vary.** A family with one distinct size has a colour axis
  only; declaring a dead axis produces a useless one-option selector on the channel.
- **A single-member cluster is not an opportunity.** Require at least two children, and prefer three
  or more.
- **Watch for sibling clusters that differ only by a colour word in the family name** — e.g.
  `… Helmet Flat Black <SIZE>` and `… Helmet Gloss Black <SIZE>`, each size-complete on its own.
  These are often one colour × size family that the naming has split. Don't merge them silently and
  don't assume the split is right either: check whether the seller's channel already groups them
  (they may deliberately not — Amazon frequently keeps each colourway under its own parent), then
  offer the merge as an explicit option in the report with the trade-off stated.

**Reject these, however tempting:**

- **"Size" that isn't a wearable size** — wattage, speaker diameter, litres-per-hour, blade length.
  Distinct models sold on their specs are not variants of each other, and grouping them hurts the
  listing. This is the single most common false positive in industrial, automotive and electronics
  catalogs.
- **Position or fitment** (front/rear, left/right) unless the channel's category genuinely offers it
  as a variation theme.
- **Pack-count mixed into a colour/size family.** A 1-pack and a 5-pack of the same colour and size
  are two products, and merging them makes the axis values collide. Split by pack count into
  separate families.
- Anything already carrying a `parent_id`.

## Step 5 — Rank and report

Rank by how much the grouping is worth and how ready the data is:

1. **Trailing sales** — `total_quantity_sold` and `total_orders` summed across the children. A
   family nobody buys is not an opportunity.
2. **Grid density** — how many of the size × colour cells actually exist. A dense grid makes an
   obviously better listing than a sparse one.
3. **Identifier coverage** — children with a `barcode`. Most marketplaces require a GTIN per child.
4. **Image coverage** — children with an `image_url`. A distinct image per child is what makes
   swatches possible at all.
5. **Amazon corroboration** — whether Amazon already groups them, and under which theme.

Report each candidate with its proposed parent SKU and name, its axes, the child grid, the totals
above, and the specific gaps ("6 of 28 children have no image"). Present it and **stop** — do not
create anything until the user picks.

## Step 6 — Build the families (only on explicit confirmation)

Resolve the axis attribute ids first — `shared_children_attributes` takes ids, not names:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/v2/attributes?filter%5Bname%5D=Size" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

Then, per family, create the parent and attach the children:

```bash
# 1. the container
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/products" \
  -H "Authorization: Bearer $SKU_PAT" -H "Content-Type: application/json" \
  -d '{"sku":"CB-SWIM-DIAPER-DRAWSTRING",
       "name":"Charlie Banana Reusable Swim Diaper - Drawstring",
       "type":"matrix","brand_name":"Charlie Banana"}'

# 2. attach children + declare the axes (COMPLETE child list — see the guardrail below)
curl -sS -X PUT "https://$SKU_TENANT.sku.io/api/products/7206" \
  -H "Authorization: Bearer $SKU_PAT" -H "Content-Type: application/json" \
  -d '{"shared_children_attributes":[5,6],
       "variations":[
         {"id":1942,"attributes":[{"id":5,"value":"S"},{"id":6,"value":"White"}]},
         {"id":1943,"attributes":[{"id":5,"value":"M"},{"id":6,"value":"White"}]}
       ]}'
```

`POST /api/products` **ignores** `shared_children_attributes` — the axes are only applied by the
`PUT`, so both calls are required. Verify with
`GET /api/v2/products/{parent}/variations`, which returns each child with its resolved axis values.

If the children don't exist yet — you're onboarding a range rather than reorganising one — create
them with **build-product-catalog** first, then come back to Step 6.

To make the family publishable with swatches, set a shared swatch per option value. Use one hex for
solid colours and an image for prints:

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/attributes/6/option-swatch" \
  -H "Authorization: Bearer $SKU_PAT" -H "Content-Type: application/json" \
  -d '{"value":"Hello Sunshine","swatch_image_url":"https://…/hello-sunshine.jpg"}'
```

Publishing the grouped listing is **publish-listing**'s job — hand off once the family exists.

## Guardrails

- **`variations` on the PUT is a full synchronise, not an append.** Any existing child whose `id` or
  `sku` is missing from the array has its `parent_id` set back to `null`. Always send the complete
  list, including children you are not changing. (Children are detached, not deleted, so it is
  recoverable — but it silently changes the family.)
- **Never send a partial `option_values` array to `PUT /api/attributes/{id}`** for the same reason —
  it replaces the option list and will `422` with `IsLinked` when it would orphan a value still
  assigned to a product. Use `POST /api/attributes/{id}/option-swatch`, which is additive.
- **Report before you write.** Grouping reorganises live catalog data that channels, the buyer
  portal and existing listings read. Present the candidates and get an explicit choice first.
- **Axis attributes are usually shared tenant-wide.** `Size` and `Color` are typically used by
  unrelated product lines too, so option lists and any `has_options` flag you cause affect those
  products' editing experience as well. Check what else uses an attribute before treating it as a
  family-private axis.
- **Don't invent ids.** Resolve attribute ids via `/api/v2/attributes` and product ids from the scan;
  never guess either.
- **Re-parenting has side effects worth naming in the report**: children with a `parent_id` drop out
  of the B2B portal catalog and are nested under their parent in channel product lists rather than
  appearing top-level.
- **Idempotency.** Creating a parent whose SKU already exists returns `422`. Before a retry, check
  with `GET /api/products/by-sku?sku=…` (see **find-product**) so a partial run doesn't create a
  second parent.
- Errors and status codes: [`shared/errors.md`](../../../shared/errors.md).

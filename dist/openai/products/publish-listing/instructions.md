# Publish or Update a Channel Listing

_List a product on a sales channel — Amazon, eBay, Walmart, Shopify, BigCommerce, WooCommerce, TikTok Shop, Temu, Faire — or revise a listing that is already live. Drives SKU.io's listing-draft workflow end to end: read per-channel publish readiness, pick the channel category (on Amazon, the product type), map the channel's required fields from product data, validate against the channel's own schema, then publish and follow the attempt log. Use this whenever someone wants a product listed, re-listed, scheduled, or its listing content updated on a marketplace or storefront._

Use this skill to get a product onto a sales channel — or to revise a listing that is already
live. It drives SKU.io's **listing draft** workflow, which is the same shape on every channel:
open a draft, point it at a category, fill the channel's fields, validate against the channel,
publish. Amazon, eBay, Walmart, Shopify, BigCommerce, WooCommerce, TikTok Shop, Temu and Faire
all go through these endpoints; only the vocabulary at the category step differs.

Everything here is scope `products:read` + `products:write`.

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

## The draft is the unit of work

A draft holds the product, the channel, the category, and the resolved value of every channel
field. Its `state` tells you what to do next:

| `state` | Meaning | Next move |
| --- | --- | --- |
| `draft` | Being edited, not validated | Fill fields, then validate |
| `validating` | Validation engine running | Poll `GET` the draft |
| `ready` | Validation passed | Publishable |
| `scheduled` | Ready, with a future `scheduled_at` | Publishes itself; `unschedule` to cancel |
| `publishing` | Publish job running | Poll the draft and the attempts log |
| `published` | Terminal — a live listing exists | Nothing; a further change needs a `purpose=update` draft |
| `error` | Channel rejected it | Read `channel_errors`, fix, validate, publish again |

`purpose` decides what publishing *means*: `create` makes a new listing, `update` seeds the draft
from an existing listing so publishing revises it in place.

## Step 1 — resolve the product and the channel

Run the **find-product** skill to turn a SKU or name into a real `product_id`. Never guess one.

Then `GET /api/v2/listing-publishing/channels`. Only channels on this list can be published to —
a generic sales-channel list will include storefronts and marketplaces that have no listing
provider, and pointing a draft at one fails later, confusingly.

```json
{ "data": [ { "id": 16, "name": "AMZ partusa", "integration_name": "Amazon",
             "integration_instance_id": 2 } ] }
```

## Step 2 — read readiness before doing anything

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/v2/products/7200/publish-readiness" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

One entry per publish-capable channel. This is the skill's decision table — branch on `bucket`:

| `bucket` | What it means | Do this |
| --- | --- | --- |
| `idle` | No listing, no draft | Create a `purpose=create` draft |
| `draft` | Open draft, no errors yet | Continue that draft — use `draft.id`, don't open a second |
| `ready` | Draft validated | Confirm with the user, then publish |
| `warn` | Draft has errors, **or** a live listing is degraded/hidden | Read the errors and fix |
| `scheduled` | Publish is queued for later | Leave it, or `unschedule` |
| `publishing` | Publish in flight | Wait; poll |
| `live` | Listing is up | A change needs a `purpose=update` draft |
| `removed` | Was live, no longer on the channel | Re-publish rather than rebuild |

The entry also carries `draft.missing_required` (`[{field, label}]`), `issues_count`,
`available_templates_count`, and `quantity_to_push` — the stock a publish would seed. Report
`quantity_to_push` to the user before publishing; a listing that goes live at zero is a silent
failure.

## Step 3 — pick the category

The category defines which fields exist, so pick it before filling anything.

Ask the channel first:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/v2/sales-channels/16/categories/suggest?product_id=7200&limit=5" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

Suggestions come back ranked with a confidence and a source. If none is convincing, search:
`GET /api/v2/sales-channels/16/categories?filter[search]=ABRASIVE&filter[leaf_only]=1`.

Two things about that search that will otherwise waste your time:

- **It is a prefix match, not a substring match.** Terms of 3+ characters run as a FULLTEXT
  boolean prefix query over the whole name. Channel taxonomies whose names are joined with
  underscores (Amazon's product types) are a *single* token, so `ABRASIVE` finds
  `ABRASIVE_DISCS` but `SWEATER` does **not** find `DESIGNER_SWEATER`. Search on the leading
  word, or lean on `suggest`. (Terms under 3 characters fall back to a substring `LIKE`, which
  is why a shorter query can return *more* than a longer one.)
- **A missing category usually means a stale taxonomy, not an unsupported product.** Fire
  `POST /api/v2/sales-channels/{id}/sync-taxonomy` — a tracked background job — and search again
  once it finishes.

Use the SKU.io row `id` when writing the draft. `external_id` is the channel's own identifier
(the Amazon product type name); it is what you show a human, not what you post.

## Step 4 — open the draft

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/v2/listing-drafts" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{ "purpose": "create", "product_id": 7200, "sales_channel_id": 16,
        "sales_channel_category_id": 17105,
        "sales_channel_product_template_id": 41 }'
```

Returns `201` with the draft. To revise a live listing instead, post
`{"purpose": "update", "product_listing_id": 9182}` — the draft is seeded from the listing.

**Check for a template first** (`GET /api/v2/sales-channels/{id}/product-templates`, or
`available_templates_count` on the readiness entry). A template is a saved set of field mappings;
seeding from one typically leaves only a handful of fields to fill by hand, and it is how the
account keeps listings consistent. Only hand-map every field when no template fits.

## Step 5 — fill the fields

`GET /api/v2/listing-drafts/{draft}` returns a `fields[]` array — one row per channel field,
already resolved:

```json
{ "name": "brand", "label": "Brand",
  "schema": { "type": "text", "usage": "required", "cardinality": 1,
              "allowed_values": null, "allows_custom_value": true,
              "max_length": 50, "min_length": null,
              "description": "…", "unit_field": null, "object_schema": null },
  "value": "Acme", "provenance": "template",
  "source_type": "product_field", "source_value": "brand",
  "has_override": false, "override": null, "errors": [] }
```

Work only the rows where `schema.usage` is `required` and `value` is empty, plus any row with a
non-empty `errors`. `recommended` and `optional` rows are worth filling when the data exists —
they drive channel search ranking — but they never block a publish.

Respect the schema when you write: a `select`/`multiselect` with `allowed_values` and
`allows_custom_value: false` accepts nothing else; `max_length` is the channel's own limit, so a
title that exceeds it is rejected at validation, not silently trimmed. `object` and `object_list`
types take a JSON object (or array of objects) shaped by `object_schema`, not a string.

Write with `PUT /api/v2/listing-drafts/{draft}`. Overrides merge by field name — send only what
you are changing:

```bash
curl -sS -X PUT "https://$SKU_TENANT.sku.io/api/v2/listing-drafts/318" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{
    "field_overrides": {
      "brand": "Acme",
      "item_type_keyword": ["abrasive-discs", "sanding"],
      "bullet_point": { "source_type": "product_attribute", "source_value": 412 },
      "item_name": { "source_type": "expression",
                     "source_value": "{{product.name}} — {{attribute.color}}" }
    },
    "image_urls": ["https://cdn.example.com/main.jpg", "https://cdn.example.com/alt-1.jpg"]
  }'
```

Each override is **either** a literal (a scalar, or an array for a multiselect) **or** a mapping
object. A mapping has `source_type` ∈ `product_field` | `product_attribute` | `static` |
`expression`, and a **scalar** `source_value`:

- `product_field` — a product column. The valid values are exactly what
  `GET /api/v2/listing-drafts/mappable-product-fields` returns; the resolver reads no others, so
  a guessed column name resolves to blank rather than erroring.
- `product_attribute` — an attribute id.
- `static` — a literal string, used verbatim.
- `expression` — a mustache template over `{{product.*}}` and `{{attribute.*}}`.

Prefer a mapping over a literal whenever the value comes from product data. A literal is a
snapshot that goes stale; a mapping re-resolves every time the draft is read or revalidated,
so renaming the product updates the listing.

The first URL in `image_urls` is the main image.

## Step 6 — variations, if this is a family

If the product is a variation parent, do this before validating. `GET
/api/v2/listing-drafts/{draft}/variation-themes` returns the theme, the axes, and the per-child
grid; `POST /api/v2/listing-drafts/{draft}/variations/validate` checks completeness, duplicate
combinations, axis consistency and the channel's caps, returning `{valid, errors}` without
persisting. Clear this before the main validation — a variation matrix rejected at publish time
is far harder to read than the same problem reported here.

## Step 7 — validate against the channel

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/v2/listing-drafts/318/validate" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json"
```

The refreshed draft comes back. Read `state`, `validation_errors` (ours) and `channel_errors`
(the channel's). Each error carries a `field`, so map it back to the `fields[]` row, fix that
field, and validate again. **Do not publish a draft that is not `ready`.**

Two passes run, in order. Local validation checks the draft against the cached channel schema —
required fields, allowed values, lengths, types. Then, *only if that left the draft `ready`* and
*only on channels that implement a pre-publish dry-run*, the draft is verified against the
channel's live API. That second pass catches what a schema cannot: shipping and business
policies, category business rules, listing-type constraints. When it fails, the errors land in
`channel_errors` and **the draft drops back to `draft`** — so a `state` that regressed after a
validate is the dry-run rejecting it, not a bug. Channels without a dry-run skip it silently, and
a transport failure reaching the channel is non-fatal: the locally-valid result stands, which
means `ready` on such a channel is a weaker guarantee than `ready` on one that verified.

## Step 8 — publish (the human gate)

**Publishing puts content on a public storefront under the merchant's account. Confirm with the
user before this call, every time.** Steps 1–7 are all reversible and internal; this one is not.
Show them the product, the channel, the category, the title, the price, and `quantity_to_push`,
and get an explicit yes.

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/v2/listing-drafts/318/publish" \
  -H "Authorization: Bearer $SKU_PAT" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{}'
```

`202` with `{"data": {"tracked_job_log_id": 90210}, "message": "Publish started."}` — the publish
is **asynchronous**. A 202 means accepted, not live. Poll `GET /api/v2/listing-drafts/{draft}`
until `state` leaves `publishing`.

Add `{"scheduled_at": "2026-09-01T09:00:00Z"}` (must be in the future) to schedule instead; the
draft moves to `scheduled`. Cancel with `POST /api/v2/listing-drafts/{draft}/unschedule`.

**The job re-validates before it sends** — every publish, scheduled or immediate. So a draft that
was `ready` an hour ago can still fail: the channel's schema may have gained a required attribute
in the meantime, and the draft falls back to `draft`/`error` instead of publishing stale content.
That failure names the regressed fields, but it names them **in the tracked job log**, not on the
draft. The same is true of the catalog-governance gate, which lets a channel refuse a product
whose catalog content is incomplete even though the draft itself validates.

Both of those mean: **a `202` followed by a draft that is no longer `publishing` and not
`published` is not self-explaining.** Read `GET /api/v2/listing-drafts/{draft}/attempts` — one row
per attempt, so a transient failure that retried and a final fatal rejection stay
distinguishable, where the draft shows only the last state it reached.

## Updating something already live

Two different jobs, two different endpoints. Choosing the wrong one is the most common mistake
here:

- **Listing content** — title, description, images, attributes, category. Open a
  `purpose=update` draft (`product_listing_id`), edit, validate, publish. This republishes to the
  channel.
- **Price and stock behaviour** — who owns the price, which pricing tier, inventory rules,
  handling time. `PUT /api/v2/product-listings/{productListing}`. No draft, no republish; it
  changes how the ongoing sync computes what to push.

Setting `master_of_price` to `"sku.io"` requires a `product_pricing_tier_id`. `inventory_rules`
is stored whole, not merged — read the current value first and send it back modified, or you will
drop sibling keys.

## Handle the response

- **`201`** — draft created. **`200`** — draft updated/validated. **`202`** — publish or taxonomy
  sync *accepted*, work happens in the background; poll before reporting success.
- **`422`** — validation failed. The `errors` map names the fields. Note the two distinct kinds:
  a `422` from `POST .../publish` means the draft is in a state that cannot publish (read the
  `message`); a `422` from `PUT .../listing-drafts/{draft}` means the body was malformed. Fix the
  named fields and resubmit — never blind-retry the same body. See
  [`shared/errors.md`](https://github.com/skuio/sku-skills/blob/main/shared/errors.md).
- **`403`** — the token lacks `products:read`/`products:write`. Mint one with both.
- **`404` on a category's fields** — the category does not belong to that channel. Re-resolve it
  from the channel you are actually publishing to.

When a listing goes live, end by giving the user links, not ids — the listing in SKU.io at
`https://{tenant}.sku.io/v2/listings`, and the public page on the channel itself.
`GET /api/v2/product-listings/{productListing}` returns that second one as `listing_url`
(e.g. `https://www.ebay.com/itm/177725731487`), alongside the effective `title`, `price` and
`quantity` — worth reading back once so you are reporting what the channel actually has, not
what you sent.

## Channel notes

The workflow above is channel-generic. What changes per channel is the category step and the
identifier rules.

**Amazon.** Product types stand in for categories — one product type is one category row, and
`external_id` is the product type name (`ABRASIVE_DISCS`). The cached schema is Amazon's own JSON
Schema, so local validation runs against exactly what Amazon will see. The taxonomy is large (a
synced channel holds a few thousand product types) and the underscore-joined names are why the
prefix-search caveat above bites hardest here — lead with `suggest`.

`purpose=create` does a `PUT` of the whole listings item. `purpose=update` does a **JSON-Patch,
built solely from `field_overrides`** — and that has two consequences worth holding onto:

- **An update draft with no overrides pushes nothing and reports success.** There is no error;
  the publish is a no-op. If you meant to change something, the change has to be an override.
- **Setting an override to `null` or `""` emits a `delete` op** and removes that attribute from
  the live listing. To leave a field alone, omit it — do not send it empty.

A variation family publishes as a parent plus one call per child, so a partial failure can leave
some children live and others not. Read `attempts` per draft rather than assuming the family
moved as a unit.

**eBay.** Implements the pre-publish dry-run via `VerifyAddItem`, so shipping policies, business
policies and category rules surface in `channel_errors` at Step 7 rather than as a publish
failure. Take a clean eBay validate as a strong signal; take a clean validate elsewhere as a
weaker one.

**TikTok Shop.** Also implements the dry-run.

**Walmart.** Publishing submits an `MP_ITEM` feed and stores the returned feed id — the API
accepting the feed is *not* the item being live. A separate poll job chases the feed to a
terminal status, so a Walmart publish stays in flight noticeably longer than the `202` suggests.
Poll the draft; don't report a listing live off the feed submission.

**Everything else.** Only some channels implement end/recover lifecycle actions on a live
listing. Read what the readiness snapshot reports for that channel rather than assuming an action
exists.

When you extend this skill to a channel not described here, add its category vocabulary, its
identifier requirements, and its async behaviour to this section — those are the three things
that differ.

## Guardrails

- **Publishing needs an explicit human yes.** Everything before Step 8 is internal and
  reversible; publishing is neither. Never publish as an implied part of "get this ready".
- **One draft per product/channel pair.** Check the readiness snapshot for an existing
  `draft.id` before creating one, or ask directly:
  `GET /api/v2/listing-drafts?filter[product_id]=7200&filter[sales_channel_id]=16`. Duplicate
  drafts race each other to the same listing.
- **Publishing is not idempotent.** A `202` means the job was queued. If a call times out
  ambiguously, poll the draft state and the attempts log before re-posting — re-publishing a
  draft mid-flight can create a duplicate listing on the channel.
- **Don't invent ids or field names.** Category ids come from the channel's taxonomy, product
  ids from find-product, `product_field` sources from `mappable-product-fields`, and field names
  from the draft's own `fields[]`. A guessed `product_field` fails silently as a blank value.
- **Don't work around a validation error by dropping the field.** A required field with no
  real value means the product data is incomplete — say so and ask, rather than filling a
  plausible-looking placeholder into a public listing.
- **Report `quantity_to_push` before publishing.** Zero is a valid number and a bad surprise.

## API operations

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/v2/listing-publishing/channels` | List the sales channels that can be published to. Only channels whose integration implements a listing-schema provider appear here — use this, not a generic channel list. |
| `GET` | `/api/v2/products/{product}/publish-readiness` | Per-channel readiness snapshot for one product — bucket, any live listing, any open draft, the count of available templates, and the required fields still missing. |
| `GET` | `/api/v2/sales-channels/{salesChannel}/categories/suggest` | Ranked category suggestions for a product on this channel, with confidence and source. |
| `GET` | `/api/v2/sales-channels/{salesChannel}/categories` | Paginated search over the channel's cached category taxonomy. On Amazon each row is a product type and `external_id` is the Amazon product type name. |
| `GET` | `/api/v2/sales-channels/{salesChannel}/categories/{category}/fields` | The channel's field schema for one category — type, usage tier, allowed values, length limits, guidance, and object sub-schemas. Lazily re-syncs from the channel when stale. |
| `POST` | `/api/v2/sales-channels/{salesChannel}/sync-taxonomy` | Re-pull the channel's whole category taxonomy as a tracked background job. Run this when the category you expect is missing from search. |
| `GET` | `/api/v2/sales-channels/{salesChannel}/product-templates` | Reusable product templates for this channel — a saved set of field mappings and defaults that seeds a draft so most fields arrive already filled. |
| `POST` | `/api/v2/listing-drafts` | Open a listing draft. `purpose=create` starts a new listing for a product on a channel; `purpose=update` seeds a draft from an existing live listing so publishing revises it. |
| `GET` | `/api/v2/listing-drafts` | Paginated list of listing drafts. Use it to find an open draft for a product/channel pair before creating a second one. |
| `GET` | `/api/v2/listing-drafts/{draft}` | The draft with its full `fields[]` array — one row per channel field with the resolved value, where it came from, and its errors. Re-resolves mappings on read. |
| `GET` | `/api/v2/listing-drafts/mappable-product-fields` | The whitelist of product columns usable as a `product_field` mapping source. Only these values are read by the resolver — never invent one. |
| `PUT` | `/api/v2/listing-drafts/{draft}` | Set field overrides, images, or swap the category/template/profile. Overrides are merged by field name, so send only what you are changing. |
| `POST` | `/api/v2/listing-drafts/{draft}/validate` | Run local validation plus the channel's own pre-publish dry-run. Returns the refreshed draft; state becomes "ready" when clean, and errors land in validation_errors/channel_errors. |
| `GET` | `/api/v2/listing-drafts/{draft}/variation-themes` | The draft's variation theme, axes, and per-child grid for a variation family. |
| `POST` | `/api/v2/listing-drafts/{draft}/variations/validate` | Check the variation matrix for completeness, duplicates, axis consistency, and channel caps without persisting. Returns {valid, errors}. |
| `POST` | `/api/v2/listing-drafts/{draft}/publish` | Publish the draft to the channel, or schedule it. Asynchronous — returns 202 with a tracked job id; the draft moves through publishing to published or error. |
| `POST` | `/api/v2/listing-drafts/{draft}/unschedule` | Cancel a scheduled publish and return the draft to "ready". Returns 422 if the draft is not currently scheduled. |
| `GET` | `/api/v2/listing-drafts/{draft}/attempts` | The publish-attempt timeline — one row per attempt, so transient retries and the final fatal error are both visible rather than only the last message. |
| `GET` | `/api/v2/product-listings/{productListing}` | A live listing in full — channel, listing_sku, listing_url (the public URL on the channel), title, price, effective price/stock mastery, inventory rules, and the per-location quantity caches. |
| `PUT` | `/api/v2/product-listings/{productListing}` | Change a live listing's pricing and inventory *settings* (price mastery, pricing tier, inventory rules, fulfilment latency) without republishing its content. |

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

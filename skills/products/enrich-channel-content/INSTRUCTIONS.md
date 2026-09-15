Use this skill when a sales channel needs product content the catalogue does not have yet —
typically a description — and you want it written **for that channel**, from everything that
already exists, and **reviewed before it lands**. The canonical case: "we want most of the
catalogue on TikTok Shop, but TikTok needs a description and we only have Amazon's."

It produces one thing: a filled channel-specific attribute (e.g. `tiktokshop_description`) on
each product the reviewer approved, plus an HTML review report that shows exactly what each
description was built from and why.

Everything here is scope `products:read` + `products:write`, plus `suppliers:read` for the
final fallback.

## Why a per-channel attribute, not one "description"

Channels disagree on what a description *is*:

| Channel | Format | Cap | What it rewards |
| --- | --- | --- | --- |
| TikTok Shop | HTML (`<p>`, `<ul>`, `<strong>`, `<br>`; tables become images) | 10,000 | >300 chars, 3–5 selling points ≤250 chars each, no links/competitors/pricing |
| Amazon | Plain text — HTML stripped | 2,000 | Connected prose; features live in the bullets, not here |
| eBay | HTML (no scripts/iframes/external links) | very large | Item + condition first, then features, then what's included |
| Walmart | Plain (basic formatting stripped) | 4,000 | Use, materials, fit — key features go in their own bullets |
| Shopify | HTML | 20,000 | First sentence is the search snippet |
| Temu / Faire | Plain | 5,000 | Concrete specifics / written for a retail buyer |

Reusing Amazon's plain 2,000-character description on TikTok is not wrong, it is just a
"Fair"-tier listing. So the target is always a **channel-named attribute** following the
tenant's existing convention — `amazon_description`, `ebay_description` → `tiktokshop_description`
— and the channel's listing profile maps its `Description` field to it. SKU.io's AI endpoint
already knows every rule in that table; you do not restate them in the prompt.

## Step 0 — connect, and agree the scope

Run **connect-to-sku**. Then agree three things with the user before touching anything:

1. **Target channel** — resolve it to a `sales_channel_id` (`GET /api/v2/listing-publishing/channels`
   is the list of publishable channels; the name is enough to pick).
2. **Scope** — one supplier / brand at a time. Resolve the brand id first — `GET /api/v2/brands?per_page=100`
   has no name search, so page it and match the name — then
   `GET /api/v2/products?filter[brand_id]=16&per_page=100` and page through. Group by family: rows with a `parent_id` are variants of that parent.
   **Generate per family, not per variant** — a swim diaper in 31 colours has one description
   with the colour left to the variant attribute. Standalone products (no parent, no children)
   are their own family.
3. **The attribute name** — `{channel}_description`, lower-case, matching what the tenant already
   uses. Confirm with `GET /api/v2/attributes?filter[search]=description` and reuse anything
   that already exists for this channel rather than creating a near-duplicate.

Create it only if missing:

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/attributes" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json" -H "Content-Type: application/json" \
  -d '{"name":"tiktokshop_description","type":"longtext","display_options":{"is_html":true},
       "notes":"Mapped to TikTok Shop -> Description on the channel listing profile."}'
```

`type` is always `longtext`. Set `display_options.is_html` only for HTML channels — it is what
makes the PIM open a rich-text editor for the value instead of a textarea.

## Step 1 — gather what already exists, per family

For the family's parent (or the first variant that has listings), walk the fallback ladder in
order and **stop at the first rung that yields real copy**. Record every source you used with a
label; the report shows them side by side and the AI names them in its rationale.

**Rung 1 — the product's own attributes.**
`GET /api/products/{id}/attributes`. Any `*_description` already written for another channel,
and every short attribute (material, size, care, certifications) — these are facts.

**Rung 2 — copy that is live on another channel.**
`GET /api/v2/products/{id}/listings` lists the rows with `integration_name` and `channel_name`
but not the ids you need; for each Amazon or eBay row, `GET /api/v2/product-listings/{row.id}`
gives `integration_instance_id` and `document_id`. Then:

- **Amazon** → `GET /api/amazon/{integration_instance_id}/products/{document_id}?included=["catalog_data"]`
  and read `catalog_data.attributes.product_description[0].value`,
  `catalog_data.attributes.bullet_point[].value`, `catalog_data.attributes.item_name[0].value`.
  This is Amazon's own rendition of the listing and is usually the richest source there is.
- **eBay** → `GET /api/ebay/{integration_instance_id}/products/{document_id}/raw` and read the
  item's `Description` (HTML). The stored channel product does not carry it; only the raw fetch
  does. Strip the HTML to prose before passing it on.
- **Walmart / Shopify / others** — the stored channel product has no description; skip.

If a variant has its own distinct copy (different Amazon `product_description` from its
siblings), note it — but still generate once per family unless the variants are genuinely
different products.

**Rung 2b — a colour or size sold as its own product.** Some catalogues model "Change Pad
CB Yellow" and "Change Pad CB Leaf" as separate standalone products, and only some colours
are listed on Amazon. When a standalone product has no listing of its own, look for a sibling
in the same brand whose name matches minus its last word(s) and *does* have copy, and use that
— labelled as the sibling's, so the reviewer can see it. Same product, different colour.

**Rung 3 — the manufacturer.** Only when rungs 1–2 produced nothing. Search the web for the
brand's own product page (brand name + product name + SKU/MPN), read it, and use only what it
states — materials, dimensions, what's included, care. Label the source with the URL. Never
paraphrase a competitor's or a reseller's listing as if it were the manufacturer's.

**Rung 4 — ask the supplier.** Only when rungs 1–3 all produced nothing. Do not generate a
description from a name alone; that is fabrication with extra steps. Instead draft an email —
`GET /api/v2/suppliers/{default_supplier.id}` for `email` / `purchase_order_email` and the
contact name — listing the SKUs and the exact data points needed (a short description, key
features, materials, dimensions, care, what is in the box), and put it in the report for the
user to send. The product stays unenriched until the answer arrives.

## Step 2 — generate the proposal

One call per family, target channel in `sales_channel_id`, every gathered source in
`source_material`. The POST queues the generation and answers `202` with
`data.id` and `data.poll_url`; poll `GET /api/ai/listing-content/{id}` every
second or two until `data.status` is `completed` (the content fields are on that
response) or `failed` (`data.error` says why). The bundled script does this for
you; a bare curl needs the second call:

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/ai/listing-content" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json" -H "Content-Type: application/json" \
  -d '{
    "product_id": 7206,
    "sales_channel_id": 30,
    "fields": ["description"],
    "source_material": [
      {"label": "Amazon listing (AMZ partusa)", "text": "At Charlie Banana, we are all about ..."},
      {"label": "Amazon bullets", "text": "Made with quality materials: tested to OEKO-TEX Standard 100 ...\nOne size ..."}
    ],
    "tone": "professional"
  }'
```

The response carries `content.description` in the channel's own format and length, and
`content.rationale` — the model's own account of which sources it drew on, what it reconciled
or left out, and why the copy is shaped the way it is. Keep both; the rationale is what the
reviewer reads.

Omit `description_format` / `description_max_length` unless the user has a reason to override
the channel's rules. Do **not** add your own restatement of the channel's rules to
`additional_instructions` — the endpoint already applies them; a second copy just muddies the
prompt. `additional_instructions` is for the user's steer ("mention the money-back guarantee",
"British spelling").

If the endpoint answers `422 AI Listing Content is disabled`, the tenant has not enabled the
feature — say so and stop rather than writing descriptions yourself. If it answers `422 ...
returned no usable content` for one family, retry once, then leave that family for review with
no proposal.

## Step 3 — build the review report, and let the reviewer decide

Write the gathered sources and proposals to a JSON file (one entry per family — see
`assets/build-review-report.mjs --help` for the shape), then:

```bash
node assets/build-review-report.mjs proposals.json review.html
cd "$(dirname review.html)" && python3 -m http.server 8080
```

Open `http://localhost:8080/review.html` **served, not as a file** — the report applies
approvals by calling the API from the browser, and `http://localhost:8080` is an origin the
API accepts; `file://` is not. The report shows, per family: the product image, name and SKU
list; every source, labelled and collapsible; the proposed description rendered as the channel
will render it, with a raw view; the rationale; and Approve / Edit / Reject. Decisions persist
in the browser. **Apply approved** writes each approved description to the attribute, with the
outcome shown inline; **Copy approved as JSON** is the fallback if the browser cannot reach the
API, in which case apply them yourself with Step 4.

Never write a description the reviewer did not approve. Never write to any attribute other than
the channel's own description attribute. Never touch the product name, brand, or images.

## Step 4 — write approved descriptions (fallback path)

If applying from the report is not possible, write each approved family:

```bash
curl -sS -X PUT "https://$SKU_TENANT.sku.io/api/products/7206/attributes" \
  -H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json" -H "Content-Type: application/json" \
  -d '{"attributes":[{"name":"tiktokshop_description","value":"<p>...</p>"}]}'
```

Write the family's description to **the parent and every variant** — a listing publishes from
the variant row, and a variant with no value falls through to nothing, not to its parent.
Sending the attribute by `name` leaves every other attribute on the product untouched.

## Step 5 — point the channel profile at it

`GET /api/v2/sales-channels/{channel}/listing-profiles/{profile}/mappings`, change the
`Description` row to `{"source_type":"product_attribute","source_value":"<attribute id>"}`, and
`PUT` the complete set back (it is a full replace). From then on every listing on that channel —
templated or not, if the profile is the channel default — reads the new attribute. Confirm by
publishing one product and reading the draft's `Description` provenance: it should say
`profile_mapping`.

## Guardrails

- **Approval is the write gate.** Generation is free; writing is not. The report is not
  optional and "apply all" is the reviewer's button, not yours.
- **Facts only.** Every claim in a description must trace to a source in the report. If the
  sources are thin, say so in the report rather than padding.
- **One family, one description.** Variants inherit; the variant attribute carries the colour
  or size.
- **Channel attribute only.** Never overwrite `amazon_description` with TikTok copy or vice versa.
- **Idempotent.** Re-running on a product whose attribute is already filled is a no-op unless
  the user asked to regenerate; the report marks those "already enriched".
- **Rung 4 is a draft, not a send.** The supplier email leaves in the user's hands.

See [shared/errors.md](../../../shared/errors.md) for `403` (scope) and `422` handling, and
[shared/pagination.md](../../../shared/pagination.md) for walking a large brand.

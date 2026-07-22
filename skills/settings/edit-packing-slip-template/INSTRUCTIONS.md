Use this skill to edit a SKU.io **packing-slip** PDF template — especially its **footer banner**,
logo, or per-store layout. Packing slips have structural rules the generic editor doesn't enforce,
and getting them wrong produces the classic complaint: *"the banner is inconsistent — it shows on
some orders, is missing or cut off on others, and looks different per store."* This skill encodes
what actually makes a packing banner render reliably.

**This extends the `edit-pdf-template` skill.** Do the base loop there —
read → edit → validate → preview → verify → save, optimistic-lock `updated_at`, version rollback,
first-party/session auth (a user PAT gets `403`). This file adds only the packing-specific rules.
Apply them on top.

## Why packing slips render differently from what you see in the editor

The exported PDF is produced by **wkhtmltopdf**, not the browser. The in-editor "interactive
preview" is a *different* engine (Chrome), so a template can look perfect in the editor and come out
wrong in the real PDF. **Always QA the real thing:** `POST /api/pdf-templates/{id}/preview` with
`format=pdf` (the default), decode `data.pdf` from base64, rasterise, and look. `format=html` is a
sanity check only — never the final word.

## Rule 1 — the footer banner MUST be `<div class="footer-banner">`

The PDF export only pins an image to the **bottom of every page** when it's wrapped in a div with the
exact class **`footer-banner`**:

```html
<div class="footer-banner">
    {{{asset.curvy_au_footer}}}
</div>
```

That block is lifted out at render time and re-attached as a repeating page footer. **Any other
wrapper** — `<div id="footer-image">`, `<div id="packing-slip-bottom-art">`, a plain `<div>`, a
`<footer>` — is **not** recognised. The image then renders **inline in the document body**, which
means it:

- appears **once**, after the last line item (not on every page);
- sits at a **different vertical position depending on how many items** are on the order;
- can be **pushed onto a second page or off the bottom** on long orders.

That is exactly what "inconsistent banner" means. **Before editing, grep the content for the banner
image.** If it isn't inside `class="footer-banner"`, that's the bug — rename the wrapper to
`class="footer-banner"` (extra classes are fine: `class="footer-banner bottom-0"`). Keep the asset
token itself as `{{{asset.<slug>}}}`.

## Rule 2 — keep the banner artwork ~6.94:1 (e.g. 1734×250)

The reserved footer band is sized for a banner about **6.94:1** (width:height ≈ 1734×250). A banner
with a very different ratio (say **4:1**, like 2508×627) renders **taller than the reserved band and
gets clipped** at the page bottom — so even a correctly-wrapped `footer-banner` looks cut off or
missing. Check the asset's dimensions (the assets list / upload response return `width` and
`height`); if the ratio is far from ~6.9:1, **re-crop the artwork** (or expect clipping). When you
upload a replacement banner, keep it in the same proportions the other stores use.

## Rule 3 — make EVERY store consistent

Packing slips are commonly per-store: one global template plus a **store override** per store, and an
order renders its own store's template. The inconsistency customers report is often that **each
store's template was authored differently** — one uses `footer-banner`, another `id="footer-image"`,
another has no banner at all — so the same order type looks different per store.

When you touch the packing banner, **audit all stores**, don't fix just one:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/pdf-templates/packing/store-overrides" --cookie "$SKU_SESSION"
```

Bring every override (and the global template) to the **same** footer structure and the **same
proportioned asset**. Then, in QA (Rule 4), render **one order per store** and confirm the banner is
identical.

## Rule 4 — QA against a real-order matrix, on the exported PDF

`packing` is the one type that renders against **real order data**, so use it. Pull candidate orders
and preview the draft against several shapes — the banner bug hides on the "normal" order and only
shows on the extremes:

```bash
# candidate orders (optionally per store):
curl -sS "https://$SKU_TENANT.sku.io/api/pdf-templates/search-sales-orders" --cookie "$SKU_SESSION"
curl -sS "https://$SKU_TENANT.sku.io/api/pdf-templates/search-sales-orders?store_id=4" --cookie "$SKU_SESSION"

# render the DRAFT content against each order id, as a real PDF:
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/pdf-templates/42/preview" \
  -H "Content-Type: application/json" --cookie "$SKU_SESSION" \
  -d '{"content":"…draft…","format":"pdf","sales_order_id":30399}'
# data.pdf is base64 -> decode + rasterise -> look:
#   echo "$B64" | base64 -d > /tmp/p.pdf && pdftoppm -png -r 100 /tmp/p.pdf /tmp/p
```

Render at least:

| Case | What it catches |
| --- | --- |
| 1-line order | banner sits high on the page — inline banners jump around here |
| Order spanning **2+ pages** (many lines) | banner must repeat on **every** page and not collide with the page-number row / content |
| **One order per store** | cross-store consistency (Rule 3) |
| Pickup / backordered / partial order | any conditional layout the template has |
| Long / international shipping address | header height pushing content into the footer |

To compare against what the store currently ships (the SAVED template, not your draft), use
`POST /api/pdf-templates/preview-sales-order` with just `sales_order_id`.

### Footer QA checklist (per rendered order)
- Banner is **present** and **fully visible** — not clipped at the bottom edge.
- Banner is **pinned to the bottom of every page** on multi-page output (not floating after the last
  item, not only on page 1).
- Banner does **not** overlap line items or the "Page N of M" row.
- The banner looks the **same** across all stores' orders.
- The header logo still renders.

## Rule 5 — preserve the renderer's structures

When editing packing content, don't disturb the things the export depends on:

- the `<meta name="pdf-paper-size" content="…">` tag (a4/a3/a5/letter/legal), if present;
- `<img src="/storage/…">` sources (inlined at render) and `{{{asset.<slug>}}}` tokens;
- the `footer-banner` div (Rule 1);
- only variables present in the template's `schema`.

## Save & roll back

Save via the base skill's `PUT /api/pdf-templates/{id}` (round-trip `updated_at`; only `content` is
writable). Every save snapshots a version — if a change ships wrong, roll back:

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/pdf-templates/42/versions" --cookie "$SKU_SESSION"
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/pdf-templates/42/versions/1187/restore" --cookie "$SKU_SESSION"
```

## Guardrails

- **Don't blind-save.** The whole point is Rules 1–4: a packing banner that isn't in `footer-banner`,
  is off-ratio, or differs per store *will* generate a support ticket. Prove it on the exported PDF
  first.
- **Confirm the scope.** Tell the user exactly which templates you changed (global + which store
  overrides) and that each has a restorable version.
- **Banners are PNG/JPG at ~6.94:1.** webp can vanish from the exported PDF; off-ratio art clips.

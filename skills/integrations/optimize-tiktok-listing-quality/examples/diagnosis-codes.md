# TikTok Listing-Quality diagnosis codes → fix rules

A branching table for Step 3. **`how_to_solve` on each result is authoritative** — it is TikTok's
own instruction and carries the exact threshold/pattern for this product and category. Use `code`
as a fast path to the right strategy; when a code isn't in this table, fall back to `how_to_solve`.

TikTok does not publish a fixed, exhaustive code list, and the catalogue differs by category and
market (Listing Quality is US-market today). So the codes below are **representative, not complete**:
match by `field` + the shape of the code + `how_to_solve`, never by assuming a code must exist.
`TITLE_LESS_THAN_40_CHARACTERS` and `IMAGE_LOW_RES` are confirmed from live responses; the rest are
representative of the families TikTok returns.

## TITLE

| Code (representative) | What it means | Fix rule |
| --- | --- | --- |
| `TITLE_LESS_THAN_40_CHARACTERS` | Title under the length floor | Rewrite to **≥ 40 chars** (aim higher), brand-first, with product type + searchable attributes; stay ≤ **255**. |
| `TITLE_*_TOO_SHORT` / `TITLE_LENGTH_*` | A length/structure threshold unmet | Follow the exact number in `how_to_solve`; add the missing descriptive attributes. |
| `TITLE_MISSING_KEYWORDS` / `TITLE_LOW_SEO` | Not enough high-intent keywords | Weave the field's `seo_words` in where true; lead with brand + product type + top attribute. |
| `TITLE_*FORBIDDEN*` / `TITLE_*PROMOTIONAL*` | Banned content (promo text, pricing, emoji, contact, competitor) | Remove exactly the pattern `how_to_solve` names; keep the factual descriptor. |

**Always:** keep brand + model exactly; no keyword stuffing/repetition; no ALL-CAPS; ≤ 255 chars.

## DESCRIPTION

| Code (representative) | What it means | Fix rule |
| --- | --- | --- |
| `DESCRIPTION_TOO_SHORT` / `DESCRIPTION_MISSING` | Description under the length floor / absent | Write a structured HTML description **≥ ~300 chars**: opening paragraph + **3–5 selling-point bullets** (`<ul><li>`), each a concrete benefit/spec ≤ ~250 chars. For a from-scratch case consider handing off to `enrich-channel-content`. |
| `DESCRIPTION_LOW_DETAIL` / `DESCRIPTION_MISSING_ATTRIBUTES` | Lacks materials/fit/care/specs | Add the facts from the current listing + the mapped product's attributes + the seller. Never invent specs. |
| `DESCRIPTION_*FORBIDDEN*` | External links, competitors, pricing, contact details | Strip exactly what `how_to_solve` names; keep allowed TikTok HTML tags only. |

**Always:** allowed tags only (`<p>`, `<ul>`, `<li>`, `<strong>`, `<br>`); facts only; weave
`seo_words` in naturally where true.

## IMAGE (checklist only — never auto-written)

| Code (representative) | What it means | Merchant action to emit |
| --- | --- | --- |
| `IMAGE_COUNT_LOW_AND_FIRST_NOT_WHITE` | Too few images and/or the first isn't on white | "Add images to reach the minimum (aim 5+); make the **first image** a clean product shot on a **plain white background**." |
| `IMAGE_COUNT_LOW` | Too few images | "Add product images to reach TikTok's minimum for this category." |
| `IMAGE_LOW_RES` | Resolution below TikTok's minimum | "Replace with a higher-resolution image (meet the pixel minimum in `how_to_solve`)." |
| `MAIN_IMAGE_NOT_WHITE` / `MAIN_IMAGE_*` | Main image doesn't meet main-image rules | "Reshoot/replace the main image per `how_to_solve` (background/framing/aspect)." |
| `IMAGE_CANNOT_BE_FETCHED` | TikTok couldn't load an image | "Re-upload the image; the current URL isn't fetchable." |

Quote the concrete count/dimension from `how_to_solve` in every image action. These are always
merchant tasks in the report, never part of the automated write.

## General

- `how_to_solve` wins over this table whenever they differ — it has the live threshold.
- `quality_tier` on a result is the tier it's dragging the field to; fixing the POOR results first
  gives the biggest lift.
- `seo_words` are per-field suggestions; use them only where truthful for the product.

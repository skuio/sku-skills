Use this skill to change a SKU.io **PDF document template** — a packing slip, quote, sales order,
pick list, purchase order, or a vendor/sales credit — by editing its HTML directly and proving the
result renders correctly before you save. It replaces "eyeball it in the editor and hope": you read
the exact template source, make a surgical edit, validate it, render it against real and mock
documents, look at the rendered PDF, and only then save — with a version snapshot you can roll back.

For **packing slips specifically**, also load **edit-packing-slip-template** — packing slips have
extra structural rules (the footer banner, aspect ratio, per-store consistency) that this general
skill does not enforce.

## The golden rule: never blind-save

A PDF template is Mustache/HTML that gets rendered to a PDF for real customer documents. A bad edit
ships on every order until someone notices. So the loop is always:

1. **Read** the current `content` (and its `updated_at` and `schema`).
2. **Edit** the HTML surgically.
3. **Validate** (`/validate`) — fix every error.
4. **Preview** against a matrix of documents (`/preview`) — as a real PDF.
5. **Look** at the rendered pages and check them against the QA checklist.
6. **Save** (`PUT`) with the optimistic-lock `updated_at`.

Never skip 3–5. If you can't render and look at the output, do not save.

## Auth — important

These endpoints are **first-party / session-scoped**. They do **not** accept a user-created
Personal Access Token: a PAT gets `403 {"message":"This endpoint is not available to API tokens."}`.
Run this skill in a context with a first-party session (the in-app SKU.io agent, or a dev-login
session), against `https://{tenant}.sku.io`. If you only have a PAT, stop and say so — don't retry.
Writes also require the `pdf_templates.update` permission.

Responses from the template/asset endpoints are wrapped: the payload is under a top-level `data`
key (`{ "data": … }`). The `versions` list is the exception — it's a plain Laravel paginator
(`{ data: [...], current_page, last_page, total, … }`).

## Step 1 — Find the template

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/pdf-templates" \
  -H "Accept: application/json" --cookie "$SKU_SESSION"
```

There is **no `type` filter** — you get all templates back; filter client-side on `type`. Types
(the exact value strings): `packing`, `quote`, `sales_order`, `pick_list`, `purchase_order`,
`vendor_credit`, `sales_credit`.

`store_id` tells you the scope: **`null` = the global template; a number = a per-store override.** A
type can have one global template plus several store overrides — and an order renders the override
for its store when one exists. If you're changing branding for everyone, you likely need to edit the
global template **and** every override (see Step 7).

## Step 2 — Read the current content

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/pdf-templates/42" --cookie "$SKU_SESSION"
```

Keep three things from the response:

- **`content`** — the raw HTML/Mustache you're about to edit.
- **`updated_at`** — pass it back on save so you don't clobber a concurrent edit.
- **`schema`** / `variables_tree` — the variables and uploaded assets this template may reference.
  **Only use variables that appear here** — an invented `{{something}}` renders empty. Assets are
  referenced with the triple-brace token `{{{asset.<slug>}}}`.

## Step 3 — Edit the HTML surgically

Change the smallest thing that achieves the goal. Preserve everything the renderer depends on:

- **Paper size.** If `<head>` has `<meta name="pdf-paper-size" content="letter">` (accepted:
  `a4`, `a3`, `a5`, `letter`, `legal`), keep it — remove it and the page silently reverts to A4.
- **Image sources.** `<img src="/storage/…">` sources are inlined into the PDF at render time; keep
  that form. To add an image, upload it (Step 8) and reference it as `{{{asset.<slug>}}}`.
- **Variables.** Reuse the exact tokens from `schema` — don't guess field names.
- **Structural blocks** the type relies on (for packing slips, the `footer-banner` div — see the
  packing sub-skill). Don't rename wrapper classes/ids the renderer keys off of.

## Step 4 — Validate

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/pdf-templates/42/validate" \
  -H "Content-Type: application/json" --cookie "$SKU_SESSION" \
  -d '{"content":"<!doctype html>…"}'
# -> {"data":{"ok":true,"errors":[],"warnings":[]}}
```

Fix every `errors[]` entry before rendering. Treat `warnings[]` as must-review. Malformed Mustache
also surfaces as a `422` on `/preview` keyed to `content` (with the parser line) — same fix.

## Step 5 — Preview against a document matrix, then LOOK

Render the **draft** content (not the stored one) to a real PDF:

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/pdf-templates/42/preview" \
  -H "Content-Type: application/json" --cookie "$SKU_SESSION" \
  -d '{"content":"<!doctype html>…","format":"pdf"}'
# -> {"data":{"pdf":"<BASE64>","type":"application/pdf","rendered_with":"wkhtmltopdf"}}
```

`data.pdf` is **base64 of the PDF file** — you must decode and *view* it, not just check the call
succeeded. Decode to a file and rasterise the pages so you can actually see them:

```bash
echo "$B64" | base64 -d > /tmp/preview.pdf
pdftoppm -png -r 100 /tmp/preview.pdf /tmp/preview   # -> /tmp/preview-1.png, -2.png, …
```

Then open the PNGs and inspect. (No rasteriser handy? Request `"format":"html"` for a quick
structural check of `data.html` — but the HTML preview uses a different engine than the real PDF,
so treat it as a sanity check, never as the final QA.)

**One render is not QA.** Layout bugs only show on certain document shapes. For **packing** (the one
type that renders against real data), build a matrix with `search-sales-orders` and preview several:

- a **short** order (1 line) — content sits high on the page;
- a **long** order that spans **2+ pages** — headers/footers and page breaks;
- **one order per store** if the type has overrides (`search-sales-orders?store_id=…`);
- edge cases relevant to the change (pickup, backordered/partial, a long international address).

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/pdf-templates/search-sales-orders?search=" --cookie "$SKU_SESSION"
# pick ids, then preview each:
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/pdf-templates/42/preview" \
  -H "Content-Type: application/json" --cookie "$SKU_SESSION" \
  -d '{"content":"…","format":"pdf","sales_order_id":30399}'
```

For the **other six types**, `/preview` renders **mock data** only (any `sales_order_id` is ignored)
— so you get one representative shape. Still render it and look; just note you can't vary the data.

### QA checklist (every previewed document)
- Logo/header present and correctly placed; nothing overlapping.
- Any footer/banner present, fully visible (not clipped at the page edge), and in the right spot.
- On multi-page output, header/footer behave correctly on **every** page (repeat where they should).
- No content collides with the footer or the page-number row.
- The fields you changed show real values (not empty) across the different orders.

## Step 6 — Save

```bash
curl -sS -X PUT "https://$SKU_TENANT.sku.io/api/pdf-templates/42" \
  -H "Content-Type: application/json" --cookie "$SKU_SESSION" \
  -d '{"content":"<!doctype html>…","updated_at":"2026-07-21T18:34:38.000000Z"}'
```

Only `content` is writable. Include `updated_at` from Step 2 — a stale value means someone else
saved in the meantime; re-read and re-apply rather than clobbering them. A `422` means validation
failed — go back to Step 4.

## Step 7 — Multi-store consistency

If the type has store overrides, a change to the global template does **not** touch them. After
editing the global one, list the overrides and apply the same change to each — otherwise the
document looks different per store (a common, confusing bug):

```bash
curl -sS "https://$SKU_TENANT.sku.io/api/pdf-templates/packing/store-overrides" --cookie "$SKU_SESSION"
```

Need a store to differ on purpose? `POST /api/pdf-templates/{globalId}/store-override` with
`{ "store_id": 4 }` clones the global into an editable override.

## Step 8 — Assets (logos, banners)

```bash
curl -sS -X POST "https://$SKU_TENANT.sku.io/api/pdf-template-assets" \
  --cookie "$SKU_SESSION" -F "image=@/path/logo.png" -F "name=Store Logo"
# -> {"data":{"slug":"store_logo","token":"{{{asset.store_logo}}}","width":1734,"height":250,…}}
```

Paste the returned `token` into `content` where the image goes. Prefer **PNG/JPG** over webp — webp
can render in the editor preview but drop out of the exported PDF. `GET /api/pdf-template-assets`
lists existing assets and their dimensions.

## Safety net & guardrails

- **Rollback.** Every save/reset/restore snapshots a version. `GET /api/pdf-templates/{id}/versions`
  then `POST /api/pdf-templates/{id}/versions/{versionId}/restore` reverts a bad edit. `POST
  /api/pdf-templates/{id}/reset` returns to SKU.io's stock default.
- **No create/delete of templates.** There is no working endpoint to create or delete a *template* —
  only store-overrides and assets can be created/deleted. Don't POST/DELETE `/api/pdf-templates`.
- **Optimistic lock.** Always round-trip `updated_at`. Don't force a save over a stale token.
- **Don't invent variables.** Only tokens present in the template's `schema` resolve.
- **Confirm before saving** a template that prints on live customer documents, and tell the user
  which template (id, type, store) you changed and that a version was snapshotted.
- **The AI builder is the fallback.** SKU.io's in-app "talk to it" template builder exists for users
  without an agent. This skill edits content directly because it's precise, diff-able, and
  QA-gated — prefer it.

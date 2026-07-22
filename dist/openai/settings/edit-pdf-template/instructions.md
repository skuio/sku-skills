# Edit a PDF Template

_Edit any SKU.io PDF document template — packing slips, quotes, sales orders, pick lists, purchase orders, and vendor/sales credits — by editing its HTML content directly, then validating, previewing against real and mock documents, and visually QA-ing the rendered PDF before saving. Use this to change branding, layout, a logo or footer banner, or which fields a document shows. Runs a deterministic read → edit → validate → preview → verify → save loop; every save snapshots a version you can restore, so edits are reversible. Prefer this over the in-app AI builder, which is the fallback for users without an agent. For packing slips, load edit-packing-slip-template too._

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

## API operations

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/pdf-templates` | List all PDF templates (global templates and per-store overrides). No server-side type filter — read the `type` field and filter client-side. Returns each template's `content`. |
| `GET` | `/api/pdf-templates/{id}` | Get one template, including its `content` HTML, `updated_at` (optimistic-lock token), `store_id`, and `schema`/`variables_tree` (the variables and assets the template may use). |
| `POST` | `/api/pdf-templates/{id}/validate` | Validate draft `content` WITHOUT rendering. Returns { ok, errors[], warnings[] }. Run this after every edit and fix all errors before previewing or saving. |
| `POST` | `/api/pdf-templates/{id}/preview` | Render draft `content` (unsaved) to a preview. format=pdf (default) returns { pdf: <base64>, type, rendered_with }; format=html returns { html: <string> }. For the `packing` type only, pass sales_order_id to render against a real order's data. |
| `GET` | `/api/pdf-templates/search-sales-orders` | Find up to 20 real sales orders (newest first) to preview a packing slip against. Use this to build a QA matrix of different document shapes (short, multi-page, per-store, …). |
| `POST` | `/api/pdf-templates/preview-sales-order` | Render the store's EFFECTIVE saved packing-slip template against a real order (base64 PDF). Resolves the right template by the order's store. Packing slips only. |
| `PUT` | `/api/pdf-templates/{id}` | Save new `content` for a template. Only `content` is writable. Pass back the `updated_at` you read from get-pdf-template for stale-write protection. Snapshots the prior version. Returns 422 if content fails validation. |
| `GET` | `/api/pdf-templates/{id}/versions` | List saved versions of a template (paginated, newest first) — each with its historical `content`, `source`, and `created_at`. Use to find a good version to restore. |
| `POST` | `/api/pdf-templates/{id}/versions/{versionId}/restore` | Roll a template back to a prior version's content (snapshots the current one first). The safety net if an edit goes wrong. |
| `POST` | `/api/pdf-templates/{id}/reset` | Reset a template to SKU.io's stock default content (snapshots the prior version). |
| `GET` | `/api/pdf-templates/{type}/store-overrides` | List every per-store override template for a document type. Use to audit that all stores' templates are consistent before/after an edit. |
| `POST` | `/api/pdf-templates/{id}/store-override` | Clone a global template into a store-specific override so one store can differ. The override then has its own id/content you edit independently. |
| `GET` | `/api/pdf-template-assets` | List uploaded template image assets (logos, footer banners). Each returns its `slug`, `token` ({{{asset.<slug>}}}), `mime_type`, and `width`/`height`. |
| `POST` | `/api/pdf-template-assets` | Upload an image (multipart/form-data) to use in a template. Returns the `slug` and the ready-to-paste `token`. Reference it in `content` as {{{asset.<slug>}}}. |

## Authentication

Every request authenticates with a SKU.io **Personal Access Token** sent as a Bearer token:

```http
Authorization: Bearer <YOUR_SKU_PAT>
```

- **Base URL:** `https://{tenant}.sku.io` (replace `{tenant}` with your account subdomain)
- **Required scopes:** `settings:read`, `settings:write`

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

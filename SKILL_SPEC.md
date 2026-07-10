# Skill specification

A skill is a folder under `skills/<domain>/<name>/` containing two files (plus optional examples):

```
skills/<domain>/<name>/
├── skill.yaml        # metadata + the API operations the skill uses  (required)
├── INSTRUCTIONS.md   # model-agnostic how-to + e-commerce context     (required)
└── examples/         # optional sample request/response bodies
```

The folder name **must** equal `skill.yaml`'s `name`, and the parent folder **must** equal its
`domain`. The build tool renders each skill into `dist/{claude,openai,gemini}/…`.

The authoritative schema is [`schemas/skill.schema.json`](./schemas/skill.schema.json); `npm run
validate` enforces it. This document is the human-readable version.

## `skill.yaml`

```yaml
name: create-sales-order          # kebab-case, unique, == folder name
title: Create a Sales Order       # human-readable
domain: orders                    # one of the domains below; == parent folder
version: 1.0.0                     # semver; bump on any behavioural change
description: >-                    # 40–1024 chars. Model-facing "when to use this".
  Create a new sales order in SKU.io with one or more line items. Use this to place an order
  for a customer…
tags: [orders, sales-order, create]
maintainers: [your-github-handle]

auth:
  scopes: [orders:write, products:read]   # PAT scopes, "{resource}:{read|write}"

api:
  base_url: https://{tenant}.sku.io
  operations:
    - id: create-sales-order      # kebab-case, unique within the skill
      method: POST                # GET | POST | PUT | PATCH | DELETE
      path: /api/sales-orders     # relative to base_url; path params in {braces}
      summary: Create a sales order with header fields and line items.
      parameters:
        - name: order_status
          in: body                # query | path | body | header
          type: string            # string | integer | number | boolean | array | object
          required: true
          description: Order status (e.g. draft, open).
          example: draft
```

### Field notes

- **`description`** is the single most important field — it becomes the Claude `SKILL.md`
  description *and* the OpenAI/Gemini tool description, i.e. the text a model reads when deciding
  whether to use the skill. Write it for that decision: what task it does, and when to reach for it.
- **`domain`** must be one of: `platform`, `products`, `orders`, `inventory`, `purchase-orders`,
  `suppliers`, `customers`, `warehouses`, `returns`, `manufacturing`, `accounting`,
  `integrations`, `reports`, `subscriptions`, `settings`. These mirror SKU.io PAT scope resources
  (`platform` is for auth/meta skills).
- **`auth.scopes`** are `{resource}:read` for `GET`/`HEAD` and `{resource}:write` for
  state-changing verbs. List every scope the skill's operations need (least privilege).
- **`operations`** should be the *real* endpoints from <https://developer.sku.io>. Keep paths and
  fields accurate — an agent will call them verbatim. Prefer the exact path the API exposes (some
  resources live under `/api/v2/…`).
- **`parameters`** — mark `required: true` only when the API rejects the request without it. Path
  params are always required. Body params become the request JSON; query/path/header map to the
  URL and headers.

## `INSTRUCTIONS.md`

Plain Markdown — the model-agnostic body that appears in all three outputs. This is where the
practical value lives. A good `INSTRUCTIONS.md`:

- States **when** to use the skill and what it produces.
- Gives the **decision logic** an agent needs (which endpoint for which situation, how to
  disambiguate multiple results, which status/type to pick).
- Shows a concrete **request** (a `curl` with the real path and fields).
- Explains how to **handle the response** — success, `422` validation, `403` scope, and retries.
- Calls out **guardrails**: idempotency, destructive operations, "don't invent ids", ask-don't-guess.

Link to shared references with relative paths, e.g.
`[shared/errors.md](../../../shared/errors.md)` (three `../` from `skills/<domain>/<name>/`).

Keep it tight and operational. It's guidance for an agent mid-task, not a tutorial.

## Building & validating

```bash
npm run validate   # schema + structural checks
npm run build      # regenerate dist/ for all three models
npm run check      # validate then build
```

CI runs `npm run check` on every PR and verifies `dist/` is up to date. `dist/` is **committed** so
skills install without a build — never edit it by hand; edit the canonical skill, run `npm run
build`, and commit the refreshed `dist/`.

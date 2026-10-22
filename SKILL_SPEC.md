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
pages:                             # optional; app routes where this skill is contextually relevant
  - /orders/sales-orders           # prefix match — also covers /orders/sales-orders/{id}

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

mcp:                             # optional; how the SKU.io MCP server exposes the skill
  tools:
    - tool: create_sales_order        # snake_case, ≤ 64 chars, unique across the repo
      operation: create-sales-order   # an api.operations id
      scope: orders:write             # the exact scope the tool needs (or mcp:access)
      description: >-                 # 40–600 chars; describes, never orders other tool calls
        Creates a sales order, as a draft or with line items. Returns the order id and sku_url.
      params:                         # optional shorter parameter text for the MCP schema
        order_status: draft, reserved, open or closed.
      annotations: { read_only: false, destructive: false, idempotent: false, open_world: false }
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
  state-changing verbs. List every scope the skill's operations need (least privilege). Use the
  resource name exactly as SKU.io spells it — most are hyphenated (`purchase-orders`), a few use
  underscores (`launch_plan`, `success_plan`).
- **`operations`** should be the *real* endpoints from <https://developer.sku.io>. Keep paths and
  fields accurate — an agent will call them verbatim. Prefer the exact path the API exposes (some
  resources live under `/api/v2/…`).
- **`pages`** (optional) — the SPA route patterns where this skill is contextually relevant. The
  SKU.io web app matches the **active page's path** against these and surfaces the skill's action
  there (the contextual skill icon). Write each **without** the app's `/v2` base prefix; matching is
  segment-by-segment: a bare path is a **prefix** match (also matches pages nested under it), `*`
  matches any single segment, and a trailing `$` forces an exact segment-count match. E.g.
  `/settings/pdf-templates` covers the list page and every template editor under it; `/products$`
  matches only the products list. These end up in `dist/catalog.json` (the machine-readable index the
  app reads); they don't change the model outputs. Omit for skills with no natural home page
  (auth/meta skills like `connect-to-sku`).
- **`icon`** (optional) — the Material Design Icon (`mdi-…`) the SKU.io web app shows beside the
  skill in its contextual skills menu. Like `pages`, it lands in `dist/catalog.json` only.
- **`mcp`** (optional) — how the hosted SKU.io MCP server exposes the skill. The build
  renders every block into `dist/mcp/manifest.json`, which the app copies in with
  `php artisan mcp:sync-skills`. A skill without the block is left out of the MCP server.
  - **`prompt_only: true`** — publish the skill's `INSTRUCTIONS.md` as an MCP prompt and no tool.
    Use it for multi-step, high-judgement skills (opening stock, listing publication, template
    edits): the model follows the prompt and makes the calls through the server's gateway tools.
  - **`tools: [...]`** — one entry per hand-picked tool. A skill may define several (e.g. create a
    draft PO, and separately submit it). Each entry names its `operation`, optional
    `also_operations` (alternate lookups whose parameters merge in as optional), the exact `scope`,
    a `description`, and **all four** `annotations` — `read_only`, `destructive`, `idempotent`,
    `open_world` — set explicitly. Set `destructive: true` when the call overwrites data, sends
    something to a third party, or changes inventory valuation, even when it can be undone.
    `exclude_params` hides parameters the tool forces itself (a draft-only status), and `params`
    gives shorter schema text per parameter (an empty string drops it). Every client loads every
    tool schema into context on connect, so keep both short.
  - **`prompt: true`** — also publish the instructions as a prompt next to the tools.
  - `validate` rejects tool names over 64 characters or not `snake_case`, a read-only tool that
    calls a write operation, a write tool without a `:write` scope, a DELETE operation, and
    descriptions that order the model to call other tools ("always call…", "you must use…",
    "invoke the … tool"). Directory reviewers treat that wording as prompt injection.
  - The manifest's `version` is `package.json`'s. The app refuses to sync a manifest older than
    the one it has, so bump the package version when tool text or shape changes.
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

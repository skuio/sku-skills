# sku-skills

**Open-source e-commerce agent skills for the [SKU.io](https://developer.sku.io) API — for Claude
Code, Codex and Cursor, and generated for OpenAI and Gemini too.**

```bash
npx skills add skuio/sku-skills
```

That lists the skills, asks which you want and which coding agents to put them in, and installs
them. Nothing to clone or build. [More ways to install ↓](#install)

A *skill* here is a curated shortcut for an AI agent: for a real business task ("find a product",
"create a sales order", "adjust inventory"), it says *exactly* which SKU.io endpoints to call, in
what order, with which fields — plus the practical e-commerce context an agent needs to get it
right. Instead of rediscovering 4,000+ endpoints every time, an agent loads the skill and acts.

Skills are written **once** in a small, model-agnostic format and compiled into each platform's
native shape:

| Platform | What you get | Where |
| --- | --- | --- |
| **Claude Code, Codex, Cursor** | An [Agent Skill](https://agentskills.io) folder (`SKILL.md`), the open format all three read | `dist/claude/…` |
| **OpenAI** (custom GPTs, API) | GPT/Assistant instructions + an importable Action (OpenAPI) + function-calling `tools.json` | `dist/openai/…` |
| **Gemini** | Gem system instructions + `function_declarations.json` | `dist/gemini/…` |
| **SKU.io MCP server** | The hand-picked tools and skill prompts the hosted SKU.io MCP server serves, from each skill's `mcp:` block | `dist/mcp/manifest.json` |

> **Community-owned & self-evolving.** These are meant to be used, forked, and improved. If a
> skill is wrong or missing, open a PR — your agent can too. See
> [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`AGENTS.md`](./AGENTS.md).

---

## The idea

```
                 skills/orders/create-sales-order/
                 ├── skill.yaml        ← metadata: domain, endpoints, scopes
                 ├── INSTRUCTIONS.md   ← the model-agnostic how-to + e-commerce context
                 └── examples/
                          │
                          │   npm run build
                          ▼
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
  dist/claude/       dist/openai/        dist/gemini/
  SKILL.md           instructions.md     system_instructions.md
                     action.openapi.json function_declarations.json
                     tools.json
```

One source of truth, three idiomatic outputs. Fix the knowledge in one place; every model benefits.

## Skills in this repo

<!-- BEGIN:skills-table -->
| Domain | Skill | What it does |
| --- | --- | --- |
| `accounting` | **map-gl-accounts** | Map SKU.io's GL roles onto the customer's QuickBooks or Xero accounts, with sign-off |
| `accounting` | **map-product-accounts** | Turn a per-product GL sheet into a few account rules, with sign-off |
| `accounting` | **reconcile-supplier-statement** | Match a supplier's statement and bank payments to SKU.io's payables, and fix the gaps |
| `accounting` | **record-vendor-credit** | Record a supplier credit memo and apply it to an open bill |
| `integrations` | **manage-amazon-recovery** | Triage, file and follow up on Amazon reimbursement claims |
| `integrations` | **optimize-tiktok-listing-quality** | Diagnose and fix POOR/FAIR TikTok Shop listings toward GOOD, reviewed before it lands |
| `inventory` | **adjust-inventory** | Increase / decrease / set on-hand stock at a warehouse |
| `inventory` | **set-initial-inventory** | Load opening stock per warehouse as an initial count on the inventory start date |
| `manufacturing` | **build-boms** | Create BOMs for manufactured products from the user's recipe sheet |
| `orders` | **create-sales-order** | Create a sales order with line items |
| `platform` | **connect-to-sku** | Authenticate, verify the token and tenant, and establish scopes before anything else |
| `platform` | **create-saved-view** | Create and favorite a saved view — columns, filters, sort — on any data table |
| `platform` | **create-workflow** | Build, validate, publish and test an automation workflow from a node/edge graph |
| `platform` | **follow-launch-roadmap** | Pick your next Launch Roadmap steps and work them with the matching skill |
| `platform` | **sync-sops** | Reconcile your internal SOPs against what changed in SKU.io — automatically |
| `products` | **build-product-catalog** | Import products from a spreadsheet, price list, web page, or pasted text |
| `products` | **configure-bundles** | Turn bundle and kit listings into products with real components |
| `products` | **enrich-channel-content** | Amalgamate existing copy into channel-correct descriptions, reviewed before it lands |
| `products` | **find-matrix-opportunities** | Spot size/colour families hiding in a flat catalog and group them into matrix products |
| `products` | **find-product** | Resolve a product by SKU, barcode, or fuzzy search |
| `products` | **map-supplier-costs** | Fill missing supplier costs from price lists or past purchase orders |
| `products` | **publish-listing** | Draft, validate, and publish a listing to any sales channel |
| `products` | **update-catalog-pricing** | Apply a supplier's new price file to the existing catalog |
| `purchase-orders` | **create-purchase-order** | Create a replenishment PO for a supplier from a description or document |
| `purchase-orders` | **record-purchase-invoice** | Record a supplier invoice against a PO from the invoice document |
| `settings` | **edit-packing-slip-template** | Edit packing-slip templates without breaking the footer banner |
| `settings` | **edit-pdf-template** | Edit, preview, and visually QA any PDF document template — safely |
<!-- END:skills-table -->

_This table is generated by `npm run build` from each skill's `tagline` — don't edit it by hand._
Run the build to regenerate `dist/`, `dist/catalog.json` (the machine-readable index), and this table.

## Install

Claude Code, Codex and Cursor all read the same `SKILL.md` folders, so one command covers them
(Node 18+; it uses the open-source [`skills`](https://github.com/vercel-labs/skills) installer):

| You use | Every skill, with no questions asked |
| --- | --- |
| Claude Code | `npx skills add skuio/sku-skills --skill '*' -a claude-code -g -y` |
| Codex | `npx skills add skuio/sku-skills --skill '*' -a codex -g -y` |
| Cursor | `npx skills add skuio/sku-skills --skill '*' -a cursor -g -y` |
| All three | `npx skills add skuio/sku-skills --skill '*' -a claude-code -a codex -a cursor -g -y` |

`-g` installs for every project on your machine. Leave it off to install into the current project
only. `npx skills update -g` picks up new versions. The installer supports other agents too: swap the
`-a` name for one in [its list](https://github.com/vercel-labs/skills/blob/main/docs/agents.md). It
collects anonymous usage data; `DISABLE_TELEMETRY=1` turns that off.

Then **start a session in your own project** and describe the task ("import these products from this
spreadsheet"). The skill is chosen from your request by its `description`; you don't invoke it by
name. Authentication is handled for you: every skill opens with a **Step 0 — Connect first** that
routes to `connect-to-sku`, which walks you through minting a Personal Access Token with the right
scopes and confirms the tenant before anything is written.

### Install one skill

The installer copies exactly the skills you name. Some skills hand off to others, and every skill
needs `connect-to-sku`, so each command below names the whole set:

<details>
<summary>One-line command for each skill</summary>

<!-- BEGIN:install-table -->
| Skill | Command |
| --- | --- |
| **adjust-inventory** | `npx skills add skuio/sku-skills --skill adjust-inventory --skill connect-to-sku --skill find-product` |
| **build-boms** | `npx skills add skuio/sku-skills --skill build-boms --skill connect-to-sku --skill find-product --skill build-product-catalog --skill create-saved-view` |
| **build-product-catalog** | `npx skills add skuio/sku-skills --skill build-product-catalog --skill connect-to-sku --skill create-saved-view --skill find-product` |
| **configure-bundles** | `npx skills add skuio/sku-skills --skill configure-bundles --skill connect-to-sku --skill find-product --skill build-product-catalog --skill create-saved-view` |
| **connect-to-sku** | `npx skills add skuio/sku-skills --skill connect-to-sku` |
| **create-purchase-order** | `npx skills add skuio/sku-skills --skill create-purchase-order --skill connect-to-sku --skill build-product-catalog --skill find-product --skill create-saved-view` |
| **create-sales-order** | `npx skills add skuio/sku-skills --skill create-sales-order --skill connect-to-sku --skill find-product` |
| **create-saved-view** | `npx skills add skuio/sku-skills --skill create-saved-view --skill connect-to-sku` |
| **create-workflow** | `npx skills add skuio/sku-skills --skill create-workflow --skill connect-to-sku` |
| **edit-packing-slip-template** | `npx skills add skuio/sku-skills --skill edit-packing-slip-template --skill connect-to-sku --skill edit-pdf-template` |
| **edit-pdf-template** | `npx skills add skuio/sku-skills --skill edit-pdf-template --skill connect-to-sku` |
| **enrich-channel-content** | `npx skills add skuio/sku-skills --skill enrich-channel-content --skill connect-to-sku --skill find-product` |
| **find-matrix-opportunities** | `npx skills add skuio/sku-skills --skill find-matrix-opportunities --skill connect-to-sku --skill find-product --skill build-product-catalog --skill publish-listing --skill create-saved-view` |
| **find-product** | `npx skills add skuio/sku-skills --skill find-product --skill connect-to-sku` |
| **follow-launch-roadmap** | `npx skills add skuio/sku-skills --skill follow-launch-roadmap --skill connect-to-sku --skill build-product-catalog --skill configure-bundles --skill build-boms --skill map-supplier-costs --skill set-initial-inventory --skill create-purchase-order --skill create-saved-view --skill map-gl-accounts --skill sync-sops --skill find-product --skill update-catalog-pricing` |
| **manage-amazon-recovery** | `npx skills add skuio/sku-skills --skill manage-amazon-recovery --skill connect-to-sku` |
| **map-gl-accounts** | `npx skills add skuio/sku-skills --skill map-gl-accounts --skill connect-to-sku` |
| **map-product-accounts** | `npx skills add skuio/sku-skills --skill map-product-accounts --skill connect-to-sku` |
| **map-supplier-costs** | `npx skills add skuio/sku-skills --skill map-supplier-costs --skill connect-to-sku --skill update-catalog-pricing --skill find-product --skill create-saved-view` |
| **optimize-tiktok-listing-quality** | `npx skills add skuio/sku-skills --skill optimize-tiktok-listing-quality --skill connect-to-sku --skill enrich-channel-content --skill find-product` |
| **publish-listing** | `npx skills add skuio/sku-skills --skill publish-listing --skill connect-to-sku --skill find-product` |
| **reconcile-supplier-statement** | `npx skills add skuio/sku-skills --skill reconcile-supplier-statement --skill connect-to-sku --skill record-purchase-invoice --skill record-vendor-credit --skill create-purchase-order --skill build-product-catalog --skill find-product --skill create-saved-view` |
| **record-purchase-invoice** | `npx skills add skuio/sku-skills --skill record-purchase-invoice --skill connect-to-sku --skill create-purchase-order --skill build-product-catalog --skill find-product --skill create-saved-view` |
| **record-vendor-credit** | `npx skills add skuio/sku-skills --skill record-vendor-credit --skill connect-to-sku --skill record-purchase-invoice --skill create-purchase-order --skill build-product-catalog --skill find-product --skill create-saved-view` |
| **set-initial-inventory** | `npx skills add skuio/sku-skills --skill set-initial-inventory --skill connect-to-sku --skill build-product-catalog --skill create-saved-view --skill find-product` |
| **sync-sops** | `npx skills add skuio/sku-skills --skill sync-sops --skill connect-to-sku --skill create-saved-view --skill find-product` |
| **update-catalog-pricing** | `npx skills add skuio/sku-skills --skill update-catalog-pricing --skill connect-to-sku --skill find-product --skill create-saved-view` |
<!-- END:install-table -->

</details>

_This table is generated by `npm run build` from each skill's `composes` — don't edit it by hand._

### As a plugin

The same repository is a plugin marketplace for Claude Code and Codex:

```bash
# Claude Code (inside a session: /plugin marketplace add …, then /plugin install …)
claude plugin marketplace add skuio/sku-skills && claude plugin install sku-skills@sku-skills

# Codex
codex plugin marketplace add skuio/sku-skills && codex plugin add sku-skills@sku-skills
```

### From a clone or a fork

`dist/` is committed and the installer uses only Node built-ins, so there's no build step and no
`npm ci`. It pulls in the skills a given one hands off to by itself:

```bash
git clone https://github.com/skuio/sku-skills && cd sku-skills

node tools/install.mjs --list                                 # see what's available
node tools/install.mjs build-product-catalog                  # → ~/.claude/skills/
node tools/install.mjs build-product-catalog --agent codex    # → ~/.agents/skills/ (cursor: the same)
node tools/install.mjs build-product-catalog --project /path/to/project   # one project only
node tools/install.mjs all --agent claude,codex               # everything, for both
```

### Custom GPTs, the OpenAI API and Gemini

**OpenAI (Custom GPT)** — create a GPT, paste `dist/openai/products/find-product/instructions.md`
into *Instructions*, and import `action.openapi.json` under *Actions* (auth: API Key → Bearer,
your SKU.io PAT). For the API/Assistants, pass `tools.json` as your tool definitions.

**Gemini** — use `system_instructions.md` as your Gem/system instructions and register
`function_declarations.json` with your function-calling loop.

In every case, authenticate with a SKU.io **Personal Access Token** (Bearer) against
`https://{tenant}.sku.io`. See [`shared/authentication.md`](./shared/authentication.md).

## Quickstart — add a skill

```bash
git clone https://github.com/skuio/sku-skills && cd sku-skills && npm ci
# create skills/<domain>/<name>/skill.yaml + INSTRUCTIONS.md  (copy an existing skill as a template)
npm run check      # validate + build
```

Full authoring rules are in [`SKILL_SPEC.md`](./SKILL_SPEC.md); the contribution flow (for humans
and agents) is in [`CONTRIBUTING.md`](./CONTRIBUTING.md) / [`AGENTS.md`](./AGENTS.md).

## Repository layout

```
skills/        canonical skills — the source of truth (edit these)
shared/        cross-cutting reference: auth, api overview, pagination, errors
schemas/       JSON Schema for skill.yaml
tools/         build.mjs (canonical → 3 targets), validate.mjs, install.mjs + check-install.mjs
dist/          generated outputs — COMMITTED so skills install without a build; rebuild with npm run build
```

## Hit a limit? Send us a PR

These skills are meant to be *used* — and to get better every time they fall short. If a skill
doesn't fully accomplish what you need (a missing step, a wrong endpoint, an unsupported case),
don't just work around it: **have your agent open a pull request to improve it.**

- Every generated skill ends with an **"Improve this skill"** footer explaining exactly this, so an
  agent sees the invitation right where it hit the wall.
- Edit the **canonical** skill under `skills/<domain>/<name>/`, run `npm run build`, and open a PR.
  External contributors fork the repo and PR from the fork; the full agent workflow is in
  [`AGENTS.md`](./AGENTS.md).
- We review every PR. The library evolves from real usage — your fix helps the next person's agent.

## About SKU.io

[SKU.io](https://sku.io) is an operations platform for e-commerce and wholesale — products,
inventory, orders, purchasing, fulfilment, returns, manufacturing, accounting, and integrations
with sales channels, 3PLs, and shipping providers. API reference: <https://developer.sku.io>.

## License

MIT — see [`LICENSE`](./LICENSE). Not an official SKU.io product warranty; community-maintained.

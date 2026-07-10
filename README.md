# sku-skills

**Open-source e-commerce agent skills for the [SKU.io](https://developer.sku.io) API — authored
once, generated for Claude, OpenAI, and Gemini.**

A *skill* here is a curated shortcut for an AI agent: for a real business task ("find a product",
"create a sales order", "adjust inventory"), it says *exactly* which SKU.io endpoints to call, in
what order, with which fields — plus the practical e-commerce context an agent needs to get it
right. Instead of rediscovering 4,000+ endpoints every time, an agent loads the skill and acts.

Skills are written **once** in a small, model-agnostic format and compiled into each platform's
native shape:

| Platform | What you get | Where |
| --- | --- | --- |
| **Claude** | An [Agent Skill](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) folder (`SKILL.md`) | `dist/claude/…` |
| **OpenAI** | GPT/Assistant instructions + an importable Action (OpenAPI) + function-calling `tools.json` | `dist/openai/…` |
| **Gemini** | Gem system instructions + `function_declarations.json` | `dist/gemini/…` |

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

| Domain | Skill | What it does |
| --- | --- | --- |
| `platform` | **connect-to-sku** | Authenticate, verify the token, and check scopes before anything else |
| `products` | **find-product** | Resolve a product by SKU, barcode, or fuzzy search |
| `orders` | **create-sales-order** | Create a sales order with line items |
| `inventory` | **adjust-inventory** | Increase / decrease / set on-hand stock at a warehouse |

Run `npm run build` to regenerate `dist/` and `dist/catalog.json` (the machine-readable index).

## Quickstart — use a skill

**Claude** — copy a skill folder into your project or personal skills directory:

```bash
npm ci && npm run build
cp -r dist/claude/products/find-product ~/.claude/skills/find-product
```

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
tools/         build.mjs (canonical → 3 targets) + validate.mjs
dist/          generated outputs (git-ignored; produced by npm run build)
```

## About SKU.io

[SKU.io](https://sku.io) is an operations platform for e-commerce and wholesale — products,
inventory, orders, purchasing, fulfilment, returns, manufacturing, accounting, and integrations
with sales channels, 3PLs, and shipping providers. API reference: <https://developer.sku.io>.

## License

MIT — see [`LICENSE`](./LICENSE). Not an official SKU.io product warranty; community-maintained.

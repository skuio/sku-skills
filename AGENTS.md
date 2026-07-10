# AGENTS.md

Instructions for AI agents contributing to **sku-skills**. (Humans: see
[`CONTRIBUTING.md`](./CONTRIBUTING.md).) This file follows the [agents.md](https://agents.md)
convention — Claude Code, Codex, Cursor, Gemini CLI, and others read it automatically.

## What this repo is

A library of e-commerce agent skills for the [SKU.io](https://developer.sku.io) API. Each skill is
authored **once** in a canonical format and compiled to Claude / OpenAI / Gemini outputs. Source of
truth is `skills/`; `dist/` is generated and **committed** — **never edit `dist/` by hand; rebuild it.**

## You're probably here to improve a skill

The most common reason an agent lands in this repo: you were **using** one of these skills and it
fell short — a missing step, a wrong endpoint, a case it didn't cover. That's exactly the
contribution we want. Don't just patch around it in your own project — fix the skill here so the
next agent benefits, then open a PR for review.

- **Maintainer (write access):** branch, edit, `npm run build`, PR — see the checklist below.
- **External contributor:** **fork** the repo, push a branch to your fork, and open a PR against
  `skuio/sku-skills:main`. With the GitHub CLI:

  ```bash
  gh repo fork skuio/sku-skills --clone && cd sku-skills
  # …make the change + npm run build + commit…
  gh pr create --repo skuio/sku-skills --title "improve <skill>: <what>" --body "<the gap + the fix>"
  ```

Everything below applies either way.

## Golden rules

1. **Edit canonical source only** — `skills/<domain>/<name>/{skill.yaml,INSTRUCTIONS.md}` and
   `shared/`. Regenerate `dist/` with `npm run build` and commit the refreshed `dist/` with your change.
2. **Use real endpoints.** Every path, method, and field must come from the live API
   (<https://developer.sku.io>) — do **not** invent or guess. If you can't verify an endpoint,
   don't add it.
3. **Least privilege.** `auth.scopes` lists only the scopes the operations need (`{resource}:read`
   for GET, `{resource}:write` otherwise).
4. **`npm run check` must pass** before you open a PR.
5. **One task per skill, one skill (or fix) per PR.**

## Add or fix a skill — checklist

```bash
npm ci
# 1. Read an exemplar to match structure/quality:
#    skills/products/find-product/  (simple)  or  skills/orders/create-sales-order/  (with body)
# 2. Create/edit skills/<domain>/<name>/skill.yaml + INSTRUCTIONS.md  (see SKILL_SPEC.md)
npm run check                       # 3. validate schema + build all three targets
git checkout -b add-<domain>-<name> # 4. branch
git add skills/ shared/ dist/       # 5. stage source AND the rebuilt dist/
git commit -m "feat(<domain>): add <name> skill"
```

Then open a PR against `main` and fill in the template.

## What "good" looks like

- **`description`** (in `skill.yaml`) reads as a *when-to-use-this* for a model choosing tools —
  40–1024 chars, task + trigger.
- **`INSTRUCTIONS.md`** contains: when to use it, decision logic (which endpoint when, how to
  disambiguate), a concrete `curl`, response handling (`2xx`/`422`/`403`), and guardrails
  (idempotency, destructive ops, don't-invent-ids, ask-don't-guess).
- **Guardrails are mandatory** for any create/update/delete/adjust skill.

## Guardrails for you, the contributing agent

- Do **not** add credentials, real PAT values, or tenant-specific data to any file. Examples use
  placeholders (`$SKU_PAT`, `$SKU_TENANT`, fake ids).
- Do **not** weaken `tools/validate.mjs` or the schema to make a skill pass — fix the skill.
- Do **not** hand-edit `dist/` (regenerate it), and don't commit `node_modules/` or lockfile churn
  unrelated to your change.
- If a task needs an endpoint you can't confirm exists, say so in the PR rather than fabricating it.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run validate` | Schema + structural checks over all skills |
| `npm run build` | Regenerate `dist/` for Claude, OpenAI, Gemini |
| `npm run check` | `validate` then `build` (run before every PR) |

See [`SKILL_SPEC.md`](./SKILL_SPEC.md) for the full canonical format.

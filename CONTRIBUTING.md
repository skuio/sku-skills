# Contributing to sku-skills

Thanks for helping build the SKU.io skills library. Every skill you add or fix makes agents on
Claude, OpenAI, and Gemini better at real e-commerce work — for the whole SKU.io community.

**Both humans and AI agents are welcome to contribute.** If you're an agent, also read
[`AGENTS.md`](./AGENTS.md) for a machine-oriented checklist.

## Ways to contribute

- **Add a skill** for a task the library doesn't cover yet.
- **Fix or sharpen** an existing skill — wrong endpoint, missing field, unclear guidance, a
  guardrail that should exist.
- **Improve shared references** in `shared/` (auth, pagination, errors, api overview).
- **Improve the tooling** in `tools/` or the spec.

## Setup

```bash
git clone https://github.com/skuio/sku-skills && cd sku-skills
npm ci
npm run check     # validate + build; should be green before you start
```

## Adding a skill

1. **Pick a domain and name.** Create `skills/<domain>/<name>/`. Copy an existing skill as a
   template — `skills/products/find-product/` is a good, simple one.
2. **Write `skill.yaml`** per [`SKILL_SPEC.md`](./SKILL_SPEC.md). Use **real** endpoints and
   fields from <https://developer.sku.io> — don't guess paths. Request least-privilege scopes.
3. **Write `INSTRUCTIONS.md`** — the practical how-to: decision logic, a concrete `curl`, response
   handling, and guardrails. This is where the value is; make it operational, not a tutorial.
4. **Validate and build:**

   ```bash
   npm run check
   ```

5. **Do not commit `dist/`** — it's generated and git-ignored. Commit only the canonical source.

## Quality bar

A skill should be **accurate, scoped, and safe**:

- **Accurate** — the endpoints, methods, and fields match the live API. If you can, test the calls
  against a real tenant with a scoped PAT.
- **Scoped** — `auth.scopes` lists exactly what's needed, nothing more.
- **Safe** — destructive or non-idempotent operations (creates, adjustments, deletes) carry
  explicit guardrails in `INSTRUCTIONS.md`: confirm-before-send, don't-invent-ids, retry/idempotency
  notes.
- **Focused** — one skill = one coherent task. If it's sprawling, split it.

## Pull requests

- Keep PRs focused — ideally one skill (or one fix) per PR.
- Fill in the PR template. Note the SKU.io endpoints touched and whether you tested them live.
- CI (`npm run check`) must pass. Maintainers review for accuracy and the quality bar above.
- By contributing you agree your work is licensed under the repo's [MIT license](./LICENSE).

## Reporting problems

Open an issue (there's a template) if a skill is wrong or a task is missing but you can't write the
skill yourself. The more concrete the endpoint/field detail, the faster it gets fixed.

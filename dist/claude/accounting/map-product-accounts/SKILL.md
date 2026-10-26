---
name: map-product-accounts
description: "Turn a customer's per-product GL spreadsheet into a few SKU.io account rules (by category, brand, supplier or product type), keep true exceptions as product overrides, and save only after explicit approval. Use for the Launch Roadmap's \"Map GL accounts\" step or a product GL sheet."
license: MIT
---

# Map Product Accounts with Account Rules

Use this skill when a customer hands you a **spreadsheet of products and the GL accounts each one
should post to** (sales, cost of goods sold, sometimes inventory or discounts), or when the Launch
Roadmap step **Map GL accounts** needs per-product accounts.

Don't turn that sheet into hundreds of per-product overrides. SKU.io has **account rules**: ordered
rules such as "Category is Binding Machines → Sales 4010", which every matching product follows,
including products added later. Your job is to find the **fewest rules that explain the sheet**,
keep only the rows that genuinely disagree as product overrides, and save nothing until a person
who owns the books has approved the exact plan.

How SKU.io picks a product's account, for each account type: the product's own override, else the
first matching rule (top of the list down), else the sales channel's account, else the company
default. A rule only sets the accounts it names; the rest fall through.

> **This is finance work.** You propose; the bookkeeper approves. Every account a rule sets is used
> for every future posting of every matching product, including products that aren't in the sheet.

The pipeline:

```
Read the sheet → Read SKU.io (defaults, rules, products, accounts) → Resolve accounts
  → Cluster into rules + exceptions → Preview → Explicit approval → Apply → Read back → Report
```

## Step 0 — Connect first

Every call below authenticates as a SKU.io **Personal Access Token** against one specific
tenant, so two things have to be true before Step 1: `$SKU_TENANT` and `$SKU_PAT` are set, and
that token actually carries `accounting:read`, `accounting:write`, `products:read`, `products:write`.

If you cannot confirm both, **run the `connect-to-sku` skill first** rather than trying a call
to see what happens. It mints the token, confirms the tenant is the one the user meant, and reads
the scopes back off the token — so a missing scope surfaces now, in one exchange with the user,
instead of as a `403` midway through with half the work already committed. If that skill is not
installed alongside this one, its instructions are at <https://github.com/skuio/sku-skills/tree/main/skills/platform/connect-to-sku>.

Never invent a tenant or a token, and never quietly fall back to a different tenant than the one
the user named. Writing to the wrong account is the one mistake here the API cannot undo for you.

## Step 1 — Read the sheet

Get, for each row: the **SKU** and the account for each account type the sheet covers. Accounts may
be numbers (`4010`), number and name (`4010 Machine Sales`) or names. Ask which column is which if
the headers are ambiguous. Note rows with no SKU or no account; they're not part of the plan.

## Step 2 — Read what SKU.io has now

```bash
H=(-H "Authorization: Bearer $SKU_PAT" -H "Accept: application/json")
# Company defaults, existing rule count, and how the catalog splits by category/brand/supplier/type
curl -sS "${H[@]}" "https://$SKU_TENANT.sku.io/api/product-account-rules/setup/dimensions"
# Existing rules, in order
curl -sS "${H[@]}" "https://$SKU_TENANT.sku.io/api/product-account-rules?per_page=100"
# Products: iterate page to last_page
curl -sS "${H[@]}" "https://$SKU_TENANT.sku.io/api/v2/products?per_page=100&page=1"
# Accounts: iterate page to last_page
curl -sS "${H[@]}" "https://$SKU_TENANT.sku.io/api/v2/nominal-codes?per_page=100&sort=code&page=1"
```

From each product keep `id`, `sku`, `type`, `brand_id`, `default_supplier_id`,
`primary_category_id`, `primary_category_path`, `tags`, the six `*_nominal_code_id` overrides, and
`sales_account_source` (and the other `*_account_source` fields): `product_override`, `rule` or
`company_default`.

`setup/dimensions` lists **top-level** category groups, so map each product's
`primary_category_path` (`Clothing -> Baby Clothing`) to its top-level category for grouping. A
category rule includes subcategories by default.

**If the account already has rules**, list them for the user before proposing anything. New rules
from this skill go above them and never change them.

## Step 3 — Resolve every account in the sheet to an id

Rules and overrides take **nominal code ids**, never account numbers. Match each sheet value in
this order: exact account number; number and name (`4010 Machine Sales`, `4010 - Machine Sales`);
exact name, ignoring case. Stop and ask about any value that matches no account, matches more than
one, or matches only an **archived** account. Never map to a near miss; a missing account is the
user's to create in their accounting system.

Check the kind of account too: sales and discount → income accounts; COGS → expense or direct
costs; inventory and in-transit → current assets; accrued purchases → a liability. Flag a mismatch
rather than proposing it.

## Step 4 — Cluster the sheet into rules and exceptions

Drop rows whose accounts already equal the company default for every type the sheet covers. They
need nothing.

For each dimension (`category`, `brand`, `supplier`, `type`):

1. Group the sheet rows by that dimension's value for the product.
2. In each group, find the **dominant account** per account type and its share of the group's rows.
3. A group earns a rule when its dominant account differs from the company default and covers at
   least **80%** of its rows (and at least two rows). A group whose dominant account *is* the company
   default needs no rule.
4. Rows that disagree with their group's rule are **exceptions**: they keep, or get, a product
   override.

Pick the dimension with the **fewest rules plus exceptions**. Prefer the one the user says their
accountant thinks in (usually category) when two are close. If no single dimension works, say so:
mixed cases (one brand inside a category, a SKU prefix, a tag) can be expressed as an extra rule
with `preview-rule` / `create-rule`, placed above the broader one.

**Watch the products that aren't in the sheet.** A category rule moves *every* active product in the
category. Count them from the Step 2 product list and show them in the proposal.

## Step 5 — Preview it with SKU.io

```bash
curl -sS -X POST "${H[@]}" -H "Content-Type: application/json" \
  "https://$SKU_TENANT.sku.io/api/product-account-rules/setup/preview" \
  -d '{ "dimension": "category",
        "groups": [ { "id": 12, "accounts": { "sales": 41, "cogs": 57 } },
                    { "id": 15, "accounts": { "sales": 42 } } ] }'
# → { "data": { "rules": [ { "name", "conditions_summary", "accounts", "product_count" } ],
#               "exceptions": [ { "product_id", "sku", "override_account", "rule_account", "account_types" } ],
#               "totals": { "will_change", "on_company_default", "keep_override", ... },
#               "account_map": { ... before and after ... } } }
```

This saves nothing. `exceptions` are products whose **current** override disagrees with the new
rule. Compare it with your Step 4 exceptions: a current override the sheet agrees with the rule on
can be cleared (`use_rule_product_ids`); one the sheet disagrees with stays, or is changed.

Then show the user one table:

| # | Rule | Accounts | Products it covers | In the sheet | Not in the sheet |
| --- | --- | --- | --- | --- | --- |
| 1 | Category is Binding Machines | Sales 4010 Machine Sales · COGS 5010 Machine COGS | 38 | 36 | 2 |

followed by the exceptions (SKU, account, why it differs), the overrides you propose clearing, the
rows you're leaving alone, and the totals from the preview (`will_change`, products staying on the
company default).

## Step 6 — Get explicit approval

Ask: "Shall I create these N rules, clear these M overrides and set these K product overrides,
exactly as shown?" Edits mean a new preview and a new question. Silence or "probably fine" is not
approval. If the bookkeeper wants to review first, stop and leave them the table.

## Step 7 — Apply

```bash
curl -sS -X POST "${H[@]}" -H "Content-Type: application/json" \
  "https://$SKU_TENANT.sku.io/api/product-account-rules/setup/apply" \
  -d '{ "dimension": "category", "groups": [ ...exactly as previewed... ],
        "use_rule_product_ids": [ 1042, 1077 ] }'
```

- Send **exactly** the body the user approved. It creates the rules above any existing ones and
  clears only the overrides listed. Products move to their new accounts in a background job.
- An extra rule from `preview-rule`: `POST /api/product-account-rules` with the same body.
- **Exceptions** (a product the sheet sends somewhere other than its rule), with a token:

  ```bash
  curl -sS -X PUT "${H[@]}" -H "Content-Type: application/json" \
    "https://$SKU_TENANT.sku.io/api/products/1050" -d '{ "sales_nominal_code_id": 44 }'
  ```

  Send only the account fields you're setting, never the rest of the product.
- **`422`** names the problem per field (an unknown or archived account, a duplicate rule name, an
  account of the wrong kind). An account-kind warning can be overridden with
  `confirm_type_mismatch: true`, but only when the user has confirmed that account on purpose.
  **`403`**: the token lacks `accounting:write` (rules) or `products:write` (overrides), or the user
  lacks the `accounting.manage_settings` / `products.update` permission.

## Step 8 — Read back and report

- `GET /api/product-account-map?account_type=sales&group_by=category`: every group should now post
  where you said. `totals.anomalies` counts products still unlike their category.
- `GET /api/products/accounts?ids=…` (up to 200 ids) for the exceptions: `source` should be
  `product_override` with the account you set, and every other sheet row should show `rule`.
- Report the rules created, overrides cleared and set, and anything left for a person. Link:
  `https://{tenant}.sku.io/v2/ledger?tab=settings&subtab=product-accounts`.

Entries **already posted** keep their accounts. Rules change postings from now on. Moving unsynced
entries is the **Re-map unsynced entries** button on that page, and it's the bookkeeper's call;
mention it, don't do it.

Working a Launch Roadmap step? Hand the summary to `follow-launch-roadmap` to post as the step's
progress comment.

## Connected through the SKU.io MCP server?

Steps 2–5 work with `api_read`. `api_write` can create rules (`POST /api/product-account-rules`,
`setup/preview`, `setup/apply`, `reorder`, `import`) but **not** product updates and **not**
re-mapping entries. Through MCP, propose the exceptions and leave them to a person (the product's
Accounting tab, or the product import with the account number in each account column). The approval
gate doesn't change.

## Guardrails

- **Explicit approval for the exact plan**, every time. Recommend the bookkeeper's review.
- **Never edit, reorder, deactivate or delete existing rules.** New rules go above them. If an
  existing rule looks wrong, say so and leave it.
- **Never clear an override the user hasn't approved clearing**, and never clear one the sheet
  disagrees with.
- **Never re-map posted or unsynced entries** from this skill.
- **Never create, rename or archive accounts.**
- **Don't guess ids.** Every account id comes from the Step 2 list, every group id from
  `setup/dimensions`, every product id from the product list.
- **Report exactly what changed**: rule, accounts, products covered; override, old account, new account.

## API operations

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/product-account-rules/setup/dimensions` | How the catalog splits: the company default account per type, the existing rule count, and for each dimension (category, brand, supplier, type) its groups { id, name, product_count }, how many products it covers and how many have no value. |
| `GET` | `/api/product-account-rules` | The existing rules in order (first match wins), each with its conditions, accounts, match_count and is_active. Paginated. |
| `GET` | `/api/v2/products` | Products with sku, type, brand_id/brand_name, default_supplier_id/default_supplier_name, primary_category_id/primary_category_path, tags, each *_nominal_code_id override and the resolved *_account with *_account_source (product_override, rule, company_default). |
| `GET` | `/api/v2/nominal-codes` | The chart of accounts: { id, code, name, type, archived_at } per account. Rules and overrides take these ids, not account numbers. Archived accounts are excluded by default. |
| `POST` | `/api/product-account-rules/setup/preview` | Read-only. Given a dimension and accounts per group, returns the rules it would create, the products whose own override disagrees (exceptions), totals (will_change, on_company_default, keep_override) and the before/after account map. Saves nothing. |
| `POST` | `/api/product-account-rules/setup/apply` | Writes the previewed rules above any existing ones (never edits or deletes a rule) and clears the overrides named in use_rule_product_ids. Same body as preview-setup. Products move in a background job. Needs the accounting.manage_settings permission. |
| `POST` | `/api/product-account-rules/preview` | Read-only. What one draft rule would do: matches, will_change, a by-account breakdown and a sample of products that move. Use for a rule the setup dimensions can't express (a tag, a SKU prefix, or two conditions together). |
| `POST` | `/api/product-account-rules` | Creates one rule (same body as preview-rule, plus optional position, is_active and channel_accounts_take_priority). A blank position puts it above the first broader rule. Needs the accounting.manage_settings permission. |
| `GET` | `/api/product-account-map` | Where the catalog posts now: per group, how many products post to each account and whether from rules, overrides or the company default, plus anomalies (products unlike 80%+ of their category). |
| `GET` | `/api/products/accounts` | Resolved accounts for up to 200 products: per account type the account, its source, the override id, and whether a rule would apply (rule_would_apply, rule_account). |
| `PUT` | `/api/products/{id}` | Sets a single product's own account override. Send only the *_nominal_code_id fields being set. Not available through the SKU.io MCP server's api_write; there, leave exceptions to a person. |

## Authentication

Every request authenticates with a SKU.io **Personal Access Token** sent as a Bearer token:

```http
Authorization: Bearer <YOUR_SKU_PAT>
```

- **Base URL:** `https://{tenant}.sku.io` — replace `{tenant}` with your account subdomain.
  The subdomain may itself contain a dot (beta and staging accounts often do), so take
  **everything** before `.sku.io` in the URL you sign in at, not just the first label.
- **Required scopes:** `accounting:read`, `accounting:write`, `products:read`, `products:write`

Mint a token under **Settings → Developer → Personal Access Tokens** in the SKU.io web app.
See [`shared/authentication.md`](shared/authentication.md) for the full flow.

---

## Improve this skill

Did this skill fall short—an unclear step, a wrong endpoint, or something it couldn't finish? Don't
just work around it: capture what was off and open a pull request so the next agent does better.

- Repo: <https://github.com/skuio/sku-skills>
- Edit the **canonical** skill under `skills/<domain>/<name>/` (not this generated file), then run
  `npm run build` and open a PR. External contributors: fork the repo and PR from the fork.
- The full agent workflow is in [`AGENTS.md`](https://github.com/skuio/sku-skills/blob/main/AGENTS.md).

Your agent can do this end to end. The library gets better every time someone sends a fix.

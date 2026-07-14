Keep a team's internal **SOPs** (Standard Operating Procedures — the step-by-step docs in Confluence,
Notion, Google Docs, a wiki, or a binder) in step with SKU.io as it ships. This skill has two modes:

- **Author** — write a new SOP for a task, from SKU.io's current documentation, in the customer's format.
- **Reconcile** (the important one) — take the customer's existing SOPs plus a *last-reviewed date*,
  find every SKU.io change since then that affects those SOPs, and rewrite the exact stale steps.

You do **not** need SKU.io API access to read the docs or changelog — they're public. A Personal Access
Token is only needed if you also want to ground SOPs in the customer's *live* account (their actual
warehouses, custom-field names, pricing tiers) — see "Grounding in live data".

## Knowledge sources (all public, no auth)

Fetch these from `https://docs.sku.io`:

| What | URL | Use |
|---|---|---|
| Doc map | `https://docs.sku.io/llms.txt` | Index of every doc page with a one-line description and its URL. Start here to find the right pages. |
| Changelog (structured) | `https://docs.sku.io/changelog.json` | Machine-readable list of user-facing changes. The heart of Reconcile mode. |
| Changelog (readable) | `https://docs.sku.io/changelog.md` | The same, as prose. |
| Any doc page as clean markdown | append `.md` to its URL, e.g. `https://docs.sku.io/guides/orders/purchase-orders/import-columns-reference.md` | Read the authoritative steps/fields for a page. Always prefer the `.md` variant. |

### The `changelog.json` shape

```json
{
  "impact_legend": { "added": "…", "changed": "…", "moved": "…", "fixed": "…", "deprecated": "…", "removed": "…" },
  "entries": [
    {
      "id": "2026-07-06-fulfillments-nav-consolidated",
      "date": "2026-07-06",
      "area": "Fulfillments",
      "type": "moved",
      "title": "Fulfillments combined into one sidebar item with tabs",
      "summary": "…what changed…",
      "sop_impact": "If an SOP says to click a specific Fulfillments item in the sidebar, update it: …",
      "docs": ["/guides/orders"]
    }
  ]
}
```

`entries` is newest-first. `type` = **added** (new capability) · **changed** (behaviour changed) ·
**moved** (UI/navigation moved — the highest-risk kind for step-by-step SOPs) · **fixed** ·
**deprecated** · **removed**. `sop_impact` is written specifically for someone maintaining an SOP.

## Mode A — Author an SOP

1. Ask the customer for: the task, and their SOP **template/format** (headings, numbered steps, a house
   style, or an existing SOP to match). If they don't have one, use a clean numbered-steps format.
2. Find the relevant pages in `llms.txt`, then read each page's `.md`.
3. Write the SOP **only from what the docs say** — real button labels, menu paths, field names, and
   order of steps. Do not invent UI. Where the docs show a screenshot or an exact label, use it verbatim.
4. Add a footer line: `Based on SKU.io docs as of <today> — sources: <doc URLs>`. This date is what the
   customer will pass to Reconcile mode next time.

## Mode B — Reconcile existing SOPs (the payoff)

Inputs you need: the customer's **SOP content** (paste, upload, or export) and the **date each SOP was
last reviewed** (or one date for the whole set). If a date is missing, ask — don't guess.

1. **Pull the changes since then.** `GET https://docs.sku.io/changelog.json` and keep every entry with
   `date >= last_reviewed_date`. Sort **`moved` and `removed` first** — they break procedures hardest.
2. **Match changes to SOPs.** For each candidate entry, decide which SOP(s) it touches by matching the
   entry's `area` and the nouns/UI terms in its `title`/`summary`/`sop_impact` against the SOP's headings
   and step text (e.g. a `Fulfillments · moved` entry matches any SOP that mentions "Fulfillments" or a
   sidebar click). When unsure, include it and flag it as "review" rather than dropping it.
3. **Read the proof.** For each matched entry, fetch its linked `docs[]` pages (`.md`) to get the *current*
   correct steps — never rewrite from the changelog summary alone.
4. **Rewrite the stale steps.** Produce a **minimal edit**: change only the steps the change affects,
   preserving the customer's numbering, voice, and format. Show it as a clear before → after (or a diff),
   not a wholesale rewrite.
5. **Report.** Output, per SOP:
   - a short list of what changed and why (each with the changelog `id` + date + the doc URL as proof),
   - the patched steps,
   - anything you flagged for human review (ambiguous match, or a change with no doc link),
   - a new "last reviewed: `<today>`" line so the next run starts from here.

### Output format (Reconcile)

```
## <SOP name> — 3 changes since 2026-05-01

1. 🔶 MOVED (2026-07-06) — Fulfillments is now one sidebar item with tabs.
   • Step 4 was: "Click Fulfillments → Pending in the sidebar"
     now:        "Click Fulfillments in the sidebar, then open the Pending tab"
   • proof: https://docs.sku.io/guides/orders  (changelog id: 2026-07-06-fulfillments-nav-consolidated)

2. 🟡 CHANGED (2026-07-13) — Products import now sets selling prices …
   • Step 7 (the Bulk-edit workaround) can be replaced with a `Price: Retail` column …
   • proof: https://docs.sku.io/guides/products/import-products#set-selling-prices

⚠️ Review: 1 entry (a Reports change) *might* touch the "Weekly stock report" SOP — please confirm.

Suggested footer: "Last reviewed against SKU.io: 2026-07-14."
```

## Grounding in live data (optional)

When SOPs need the customer's *actual* configuration (warehouse names, custom-field labels, pricing-tier
names, statuses in use), use `verify-connection` (`GET /api/auth/profile`) to confirm the tenant, then
compose with the **`connect-to-sku`** skill and the relevant resource skills (e.g. `find-product`,
`create-saved-view`) to read live values and drop them into the SOP. Without a token, keep SOPs generic
and note where the customer should fill in their own names.

## Guardrails

- **Never invent UI.** Every menu path, button label, and step must come from a doc page you actually
  read. If the docs don't cover it, say so — don't fabricate.
- **Always cite proof.** Every rewritten step carries the doc URL (and changelog `id`) it's based on, so
  the customer can verify.
- **Ask for the last-reviewed date.** Reconcile is only correct relative to a real "since" date.
- **Minimal edits, preserve their format.** You're patching their SOP, not replacing it. Keep numbering,
  tone, and structure.
- **Flag, don't drop.** An ambiguous match goes to a "review" list, never silently ignored.
- **`moved` first.** Navigation changes break the most SOPs and are the easiest to miss — surface them at
  the top.
- **The customer applies the output.** This skill produces the patch; it doesn't write back to Confluence/
  Notion/etc. (a platform connector can be added later). Hand back clean, copy-pasteable results.

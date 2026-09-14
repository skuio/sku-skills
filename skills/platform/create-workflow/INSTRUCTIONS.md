Use this skill to build a SKU.io **automation workflow** from the API — the same directed graph of
nodes and edges the visual Workflow Builder draws. A workflow is "when X happens, do Y (maybe only
if Z)": a trigger node, optional logic and data nodes, and one or more action or integration nodes.

Reach for it whenever the ask is *automatic*: "email me when an order comes in on TikTok Shop",
"Slack the warehouse when stock runs low", "tag every order over $500", "pull the supplier feed off
SFTP every morning", "post new orders to our ERP".

## Before you build

**Read the node catalog first — every time.** The set of nodes and their settings is
account-and-version specific, and it is the only place the valid `nodes[*].type` strings and
`data` keys exist:

```bash
curl -s -H "Authorization: Bearer $SKU_PAT" -H 'Accept: application/json' \
  "https://$SKU_TENANT.sku.io/api/automation/workflow-nodes" | jq '.data[] | {type, category, label}'
```

Each entry carries `settings` (the `data` keys: `key`, `type`, `required`, `defaultValue`),
`outputSchema` (the fields downstream nodes can reference), and `supportsBranching`. **Never
hand-write a node type from memory** — if it isn't in that response, it doesn't exist here.

Nodes fall into six categories: `triggers` (what starts a run — exactly one per workflow),
`logic` (IF / Switch / stock checks — these branch), `actions` (write to SKU.io: orders, products,
inventory, tags, notes), `integrations` (reach outside: email, Slack, webhook, HTTP, Sheets,
Airtable, FTP), `data` (parse, reshape, aggregate), `utilities` (delay).

### Resolve ids, never names

A setting typed `multiselect` with an `apiEndpoint` stores **numeric ids**. The Sales Channels
filter on an order trigger is the common case — `"TikTok Shop"` is not a value, `30` is:

```bash
curl -s -H "Authorization: Bearer $SKU_PAT" \
  "https://$SKU_TENANT.sku.io/api/automation/lookups/sales-channels"
# {"data":[{"name":"TikTok Shop","id":30}, …]}
```

Same for `…/lookups/warehouses` and `…/lookups/tags`. Look the id up; don't guess it, and don't
pass the display name.

## Graph shape

```jsonc
{
  "name": "TikTok Shop: email on new order",
  "description": "Why this exists, for whoever finds it later.",
  "category": "orders",
  "nodes": [
    { "id": "trigger-1", "type": "sales-order-created", "label": "Order created",
      "position": { "x": 80, "y": 200 },
      "data": { "salesChannels": [30], "orderStatuses": ["*"] } },
    { "id": "email-1", "type": "send-email", "label": "Email ops",
      "position": { "x": 420, "y": 200 },
      "data": { "to": "ops@example.com", "template": "custom",
                "subject": "New order {{ $json.salesOrder.salesOrderNumber }}",
                "customBody": "…" } }
  ],
  "edges": [ { "id": "e1", "source": "trigger-1", "target": "email-1" } ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

Rules the validator enforces: **exactly one trigger node**, every edge's `source`/`target` must
name a node in the graph, and every non-trigger node needs an incoming edge. `position` is the
canvas layout — space nodes ~300px apart on x so the builder is readable when a human opens it.
`data` is required on every node even when empty (`{}`).

**Leaving a branching node needs a `sourceHandle`.** IF exposes `true` and `false`; Switch exposes
`case0`, `case1`, … and `fallback`. An edge off a branching node with no `sourceHandle` is a
silently dead path:

```json
{ "id": "e2", "source": "if-1", "target": "email-1", "sourceHandle": "true" }
```

## Expressions

Any setting typed `expression` or `expression_textarea` interpolates:

| Form | Resolves to |
| --- | --- |
| `{{ $json.path.to.value }}` | a field of the **trigger** payload (the trigger's `outputSchema`) |
| `{{ $nodes.<nodeIdOrType>.path }}` | an **earlier node's** output |
| `{{#each $json.lines }}…{{ this.sku }}…{{/each}}` | repeat per item of an array; `{{ this }}`, `{{ this.<path> }}`, `{{ $index }}` |

A token that is the *entire* value returns the raw typed value (so an IF can compare numbers and
booleans); a token embedded in prose is stringified in place. A list expression that doesn't
resolve to an array renders empty — so an `{{#each}}` over a field the trigger doesn't emit
produces a blank section, not an error. Check the trigger's `outputSchema` before referencing a
field.

**Only interpolate scalars into text.** Stringification is `(string)` for scalars and
`json_encode` for everything else, so a field that turns out to be an object or array lands in the
email as raw JSON — `Customer: {"id":819025,"name":"Grayson Mair"}`. Booleans are worse than they
look: `true` renders `1` and **`false` renders the empty string**, so `Created: {{ $json.x.exists }}`
silently becomes `Created: ` on exactly the runs you care about. Use the boolean for IF conditions
and a string field for prose; if a trigger only offers the boolean, branch on it with an IF and
write the two sentences out. Always read a real rendered run before publishing — that is what
catches this.

IF/Switch conditions are `{ "field": "{{ $json.… }}", "operator": "…", "value": … }` with
`combineOperation` `and`/`or`. Operators: `equals`, `not_equals`, `contains`, `not_contains`,
`starts_with`, `ends_with`, `is_empty`, `is_not_empty`, `greater_than`, `less_than`,
`greater_than_or_equal`, `less_than_or_equal`, `in`, `not_in`, `regex`, `is_true`, `is_false`.
An unrecognised operator evaluates **false**, quietly — copy the spelling exactly.

## Choosing the trigger: arrival or readiness?

For anything shaped like "tell me when an order comes in", there are two different moments and the
node catalog exposes both. Getting this wrong produces a workflow that looks correct and is quiet
precisely when it matters.

| | `sales-order-created` | `channel-order-imported` |
| --- | --- | --- |
| Fires when | the SKU **sales order** has been created | the **channel sync** pulled in an order it had not seen |
| Relative order | second | first |
| Silent when | the channel order never became a sales order — creation is gated off, deferred, or erroring | — it fires first, and reports whether a sales order exists yet |
| Payload root | `$json.salesOrder.*` | `$json.channelOrder.*`, plus `$json.salesOrder.exists` |

**Alerting a human → `channel-order-imported`.** The merchant means "an order arrived", and the
failure they most need to hear about is the one where it arrived and then nothing happened to it.
**Acting on an order → `sales-order-created`.** Tagging, noting, routing and warehouse work all
need the sales order to exist, so the later moment is the correct one.

Check the live catalog for which triggers this account actually has — `channel-order-imported` is
dispatched per integration, so an account whose channels do not yet publish it will see no runs.

## Steps

1. **Check for a duplicate.** `GET /api/automation/workflows?filter[search]=<name>`. If one already
   does this job, update or clone it rather than adding a second — every matching published
   workflow fires, so two near-identical ones mean two emails.
2. **Read the node catalog** and resolve every id (channels, warehouses, tags).
3. **Assemble the graph**, then **validate it before saving**:

   ```bash
   curl -s -X POST "https://$SKU_TENANT.sku.io/api/automation/workflows/validate" \
     -H "Authorization: Bearer $SKU_PAT" -H 'Content-Type: application/json' \
     -d '{"nodes":[…],"edges":[…]}'
   # {"data":{"valid":true,"errors":[]}}
   ```

   `valid` is false only when an entry has `type: "error"`; `warning` entries don't block.
4. **Create it** — `POST /api/automation/workflows`. It lands as a **draft**, which never fires.
   For anything that sends mail, posts to Slack, hits a webhook, or writes to orders/inventory,
   create it with `"preview_mode": true`.
5. **Publish** — `POST /api/automation/workflows/{id}/publish`. Validation runs again; a 422 leaves
   the workflow exactly as it was.
6. **Dry-run it before you trust it.** With `preview_mode` on, run it by hand against a realistic
   payload:

   ```bash
   curl -s -X POST "https://$SKU_TENANT.sku.io/api/automation/workflows/{id}/execute" \
     -H "Authorization: Bearer $SKU_PAT" -H 'Content-Type: application/json' \
     -d '{"trigger_payload":{"salesOrder":{…},"lines":[…]}}'
   ```

   Build `trigger_payload` to match the trigger's `outputSchema`, populated from a **real** record
   you fetched — a made-up payload proves the graph runs, not that it renders. Omit
   `trigger_payload` entirely and an event trigger falls back to sample data from the most recent
   matching record. The call returns an execution at `pending`; poll
   `GET /api/automation/workflow-executions/{id}` until it leaves `pending`/`running`, then read
   `steps[]` — each step's `status`, `logs`, and in preview mode the input the skipped step would
   have used.
7. **Show the user the rendered result** — the actual subject and body, the actual webhook payload —
   and only then turn preview off (`PUT … {"preview_mode": false}`). A workflow that emails the
   wrong thing on every order is worse than no workflow.
8. **Hand back the link**: `https://{tenant}.sku.io/v2/automation/workflows/{id}`.

## Guardrails

- **Draft → preview → publish, in that order.** Never publish a workflow with live actions that
  nobody has seen a rendered run of. `preview_mode` executes triggers, conditions and lookups for
  real and skips every state-changing step — it is the safe way to test against production data.
- **Confirm the recipient and the trigger filter with the user before publishing.** Those two
  decide who gets bothered and how often. An unfiltered `sales-order-created` on a busy account is
  an email per order across every channel.
- **Don't invent ids, node types, or setting keys.** Every one comes from the node catalog or a
  lookup endpoint. A wrong setting key is accepted on save and ignored at run time — it fails
  silently, which is the hardest failure to notice.
- **`PUT` replaces the graph.** Send the complete `nodes` and `edges`, or omit both keys. A partial
  list deletes the nodes you left out.
- **Disable, don't delete.** `POST …/toggle` pauses a workflow and keeps its history; `DELETE` is
  permanent and takes the run history with it. Only delete when the user says delete.
- **Editing a live workflow: clone first.** `POST …/clone` gives you a draft copy to change and
  test while the original keeps working.
- **Every published workflow whose trigger matches will run.** Before adding one, look at what is
  already published for that trigger — `GET /api/automation/workflows?filter[trigger_type]=event`.

## Authorization — read this before promising it will work

These endpoints sit behind `auth:sanctum` plus the **`workflows.index` user permission**, and — 
unlike the rest of `/api` — they are **not** behind the PAT scope guard. Two consequences:

- The PAT's owning **user** must hold `workflows.index` (an Admin does). Otherwise: `403`.
- The token's **scopes are not checked** on these routes today, so the `settings:read` /
  `settings:write` this skill declares are forward-looking, not enforced. Don't tell a user that
  minting a narrowly-scoped token restricts what a workflow call can do — right now it doesn't.

developer.sku.io currently badges these operations *"Not yet available to API tokens — this
endpoint requires session authentication"*. That badge is derived from the scope registry, not from
the running middleware: a PAT does work today. Treat the badge as a signal that scope enforcement
is **coming**, and if these calls start returning
`403 {"message":"This endpoint is not available to API tokens."}`, that is the gap closing — the
fix is a token with the workflow scope, not a retry.

## Failure modes

| What you see | What it means |
| --- | --- |
| `422` with `errors: [{type:"error", message:…, nodeId:…}]` from create/publish | Graph structure — no trigger, two triggers, an orphan node, an edge to a node that isn't there. |
| `422` field→messages map | Body validation — `name` missing or over 128 chars, a node missing `type`/`position`/`data`. |
| `403` on execute with `"Workflow automation is disabled"` | The account-level automation switch is off. A human turns it on; don't retry. |
| Execution `success`, but nothing happened | Either `previewMode: true` (check the execution's flag), or a setting key that isn't in the catalog and was ignored. |
| Published, matching orders exist, zero executions | The trigger's filter doesn't match. Re-check that ids — not names — went into `salesChannels`, and compare against `triggerConfig` on the workflow. For `channel-order-imported`, also confirm that integration publishes the event on this build. |
| A field renders as `{"id":…}` or vanishes entirely | A non-scalar or a boolean was interpolated into text — see the expressions section. |
| `{{#each}}` renders nothing | The trigger doesn't emit that array. Check its `outputSchema`. |

See [shared/errors.md](../../../shared/errors.md) for the standard status-code contract and
[shared/authentication.md](../../../shared/authentication.md) for token handling.

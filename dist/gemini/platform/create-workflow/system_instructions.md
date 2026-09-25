# Create a Workflow (automation)

System instructions for a Gemini Gem / agent. Build, validate, publish, test-run and maintain SKU.io automation workflows from the API — the same node/edge graph the visual Workflow Builder draws. Use this whenever a user wants something to happen automatically in response to something else: email or Slack me when an order lands on a given sales channel, tag or note orders that match a rule, post a webhook to another system, import a supplier feed from FTP on a schedule, or route orders to a warehouse — and when an existing workflow needs changing, pausing, or diagnosing because it did not fire. Starts from a template when one fits, discovers the node catalog and credentials live, and publishes only after a dry run the user has seen — including picking the right moment to fire on, which for an order alert is the channel import rather than the sales-order creation.

Use this skill to build a SKU.io **automation workflow** from the API — the same directed graph of
nodes and edges the visual Workflow Builder draws. A workflow is "when X happens, do Y (maybe only
if Z)": a trigger node, optional logic and data nodes, and one or more action or integration nodes.

Reach for it whenever the ask is *automatic*: "email me when an order comes in on TikTok Shop",
"Slack the warehouse when stock runs low", "tag every order over $500", "pull the supplier feed off
SFTP every morning", "post new orders to our ERP" — and when an existing workflow needs changing,
pausing, or explaining ("why didn't it fire?").

## Step 0 — Connect first

Every call below authenticates as a SKU.io **Personal Access Token** against one specific
tenant, so two things have to be true before Step 1: `$SKU_TENANT` and `$SKU_PAT` are set, and
that token actually carries `settings:read`, `settings:write`.

If you cannot confirm both, **run the `connect-to-sku` skill first** rather than trying a call
to see what happens. It mints the token, confirms the tenant is the one the user meant, and reads
the scopes back off the token — so a missing scope surfaces now, in one exchange with the user,
instead of as a `403` midway through with half the work already committed. If that skill is not
installed alongside this one, its instructions are at <https://github.com/skuio/sku-skills/tree/main/skills/platform/connect-to-sku>.

Never invent a tenant or a token, and never quietly fall back to a different tenant than the one
the user named. Writing to the wrong account is the one mistake here the API cannot undo for you.

## Before you build

### Start from a template when one fits

```bash
curl -s -H "Authorization: Bearer $SKU_PAT" \
  "https://$SKU_TENANT.sku.io/api/automation/workflow-templates" | jq '.data[] | {slug, name, description}'
```

A template is a tested graph. If one matches the ask, `GET …/workflow-templates/{slug}`, answer its
`parameterPrompts` (each has a `key`, a `type`, `required`, and — like a node setting — often an
`apiEndpoint` to resolve the value from), make sure every `requiredCredentials` entry exists, then
`POST …/workflow-templates/{slug}/instantiate` with `{"name": …, "parameters": {<key>: <value>}}`.
It lands as a draft; carry on from step 4 below. A prompt you leave out keeps the template's
placeholder, so answer every required one. Build by hand only when no template fits.

### Read the node catalog — every time

The catalog is the only place the valid `nodes[*].type` strings and `data` keys exist, and it
changes with each SKU.io release — this skill deliberately does not list the nodes:

```bash
curl -s -H "Authorization: Bearer $SKU_PAT" -H 'Accept: application/json' \
  "https://$SKU_TENANT.sku.io/api/automation/workflow-nodes" \
  | jq '.data[] | {type, category, label, description, preview, availability}'
```

Read each candidate's `description` before choosing it. **Never hand-write a node type from
memory** — if it isn't in that response, it doesn't exist on this build. Everything else you need to
fill a node in is a pointer inside its entry; follow the pointer rather than guessing:

| In the catalog entry | What to do with it |
| --- | --- |
| `settings[*].key` / `type` / `required` / `defaultValue` | The node's `data` keys, exactly. A key not listed here is accepted on save and ignored at run time. |
| a setting with `apiEndpoint` | `GET /api<apiEndpoint>` and store the item's `id` — never the display name you were given. Most are numeric (`salesChannels: [30]`, not `"TikTok Shop"`); a few are names by design (`…/lookups/integrations` returns `{"id":"Shopify"}`). Store whatever `id` says. |
| a setting typed `credential_select` | `GET /api/automation/workflow-credentials/lookup?type=<its credentialTypes, comma-joined>` and store the chosen `uuid` as `credentialUuid`. None stored → see *Credentials* below. |
| IF's `conditions` or Switch's `rules` setting | Its `operators` list (newer builds) is the full set of valid operator strings. |
| `outputs[*].key` | The branch handles (Switch: the defaults — see *Graph shape*). Any handle other than `main` must go on the leaving edge's `sourceHandle`. |
| `outputSchema` | The fields downstream expressions may reference (`{{ $json.… }}` for a trigger). |
| `preview` / `mutates` (newer builds) | What a preview run does with the node: `runs`, `skipped`, or `simulated` (reports what it would have done). `mutates: true` means it changes state live. |
| `availability` on a trigger (newer builds) | `available: false` means nothing on this account emits that event yet — the workflow would publish and never run. Read `reason`, and tell the user. |

On a build that does not yet return `preview` / `mutates`, the rule is: every node in the
`actions` and `integrations` categories changes state and is skipped in preview, except
read-only ones such as a plain URL download.

Nodes fall into six categories: `triggers` (what starts a run — exactly one per workflow),
`logic` (IF / Switch / stock checks — these branch), `actions` (write to SKU.io: orders, products,
inventory, tags, notes), `integrations` (reach outside: email, Slack, webhook, HTTP, Sheets,
Airtable, FTP), `data` (parse, reshape, aggregate), `utilities` (delay).

### Credentials

FTP/SFTP, Google Sheets, and authenticated HTTP nodes carry a **required** `credentialUuid`. Look
for an existing one first (the lookup above). If none exists:

- `ftp`, `sftp`, `basic_auth`, `api_key`, `bearer_token`, `webhook_token` — you may
  `POST /api/automation/workflow-credentials` with `{name, type, data}`, **only** with values the
  user gave you for this purpose. Never echo a secret back into chat or logs; the API redacts secret
  fields on read, so don't try to read one back to "check" it.
- `google_oauth` — cannot be created from the API; it needs the browser consent flow. Ask the user
  to connect the Google account in the Workflow Builder, then look it up.

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

**Leaving a branching node needs a `sourceHandle`**, taken from that node's `outputs[*].key` in the
catalog (IF is `true`/`false`). Switch is the exception — its handles come from its own `data`:
rule *n* emits on that rule's `output` if set, else `case<n>`, and no match emits on the
`fallbackOutput` setting (default `fallback`); match the edge to what you configured. An edge off a
branching node with no matching `sourceHandle` is a silently dead path:

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
`combineOperation` `and`/`or`. Take the operator strings from that setting's `operators` list in
the catalog. Builds that don't publish it yet accept: `equals`, `not_equals`,
`contains`, `not_contains`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty`,
`greater_than`, `less_than`, `greater_than_or_equal`, `less_than_or_equal`, `in`, `not_in`,
`regex`, `is_true`, `is_false`. An unrecognised operator evaluates **false**, quietly — copy the
spelling exactly.

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

The catalog lists every trigger on every account, but `channel-order-imported` is only emitted by
integrations that publish it. Check its `availability` in the catalog: `available: false` means no
connected channel on this account emits it yet — use `sales-order-created` and tell the user the
alert will stay silent for orders that never become sales orders. On a build without
`availability`, ask `get-sample-payload` for it: `data: null` on an account with recent orders on
that channel is the same signal.

## Steps

1. **Check for a duplicate.** `GET /api/automation/workflows?filter[search]=<name>`. If one already
   does this job, update or clone it rather than adding a second — every matching published
   workflow fires, so two near-identical ones mean two emails.
2. **Check the templates, then read the node catalog** and resolve every lookup value and
   credential the chosen nodes point at.
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

   Get `trigger_payload` from `POST /api/automation/workflow-nodes/sample-payload` with
   `{"node_type": "<trigger type>", "parameters": <the trigger node's data>}` — the most recent
   **real** matching record, shaped exactly like the trigger's output. A made-up payload proves the
   graph runs, not that it renders. If it returns `data: null`, nothing matches yet: say so, and
   only then build one from a record you fetched. (Omitting `trigger_payload` makes an event
   trigger fall back to the same sample.) The call returns an execution at `pending`; poll
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
| Trigger shows `availability.available: false` | Nothing on this account emits that event; the workflow will publish and never run. Use the fallback trigger its `reason` names. |
| A run fails at an FTP/Sheets/HTTP node with an auth error | The `credentialUuid` is missing, deleted, or of the wrong type. Re-run the credentials lookup with that setting's `credentialTypes`. |

See [shared/errors.md](https://github.com/skuio/sku-skills/blob/main/shared/errors.md) for the standard status-code contract and
[shared/authentication.md](https://github.com/skuio/sku-skills/blob/main/shared/authentication.md) for token handling.

## API operations

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/automation/workflow-nodes` | The live catalog of every node type — its category, description, settings (key, type, required, default, apiEndpoint, credentialTypes), outputs (the branch handles) and outputSchema; on newer builds also `preview`/`mutates`, condition `operators`, and a trigger's `availability` on this account. Always read this first; it is the only reliable source for valid `nodes[*].type` values and their `data` keys. |
| `POST` | `/api/automation/workflow-nodes/sample-payload` | A trigger payload built from the most recent real record that matches the trigger's settings — the right `trigger_payload` for a dry run. Returns `data: null` when nothing on the account matches yet. |
| `GET` | `/api/automation/lookups/sales-channels` | Sales channels as {id, name}. The stored value is the numeric id. |
| `GET` | `/api/automation/lookups/integrations` | Connected integrations as {id, name}, where `id` IS the name (e.g. `Shopify`) — the integration order filter matches on the name as text. |
| `GET` | `/api/automation/lookups/sub-sales-channels` | Sub sales channels as {id, name}, where `id` is the sub-channel name (e.g. `POS`) and `name` also names its parent channel(s). |
| `GET` | `/api/automation/lookups/warehouses` | Warehouses as {id, name}, for warehouse-valued node settings. |
| `GET` | `/api/automation/lookups/tags` | Order tags, for the Apply Tags node's `tags` setting. |
| `GET` | `/api/automation/lookups/airtable-instances` | Connected Airtable instances, for the Airtable node. |
| `GET` | `/api/automation/lookups/order-filter-fields` | The sales-order fields an order filter may test. The filter is evaluated against this allow-list, so a field not in it never matches. |
| `GET` | `/api/automation/workflow-credentials/lookup` | Stored credentials as {uuid, name}, filtered by type — the values for a `credential_select` setting's `credentialUuid`. |
| `POST` | `/api/automation/workflow-credentials` | Store a credential (secrets encrypted at rest, redacted on read). Only with values the user supplied for this purpose; `google_oauth` cannot be created here — it needs the browser consent flow in the Workflow Builder. |
| `GET` | `/api/automation/workflow-templates` | Ready-made workflows with their `parameterPrompts` (what must be filled in) and `requiredCredentials`. Check here before assembling a graph by hand. |
| `GET` | `/api/automation/workflow-templates/{slug}` | One template with its prompts and required credentials. |
| `POST` | `/api/automation/workflow-templates/{slug}/instantiate` | Create a Draft workflow from a template, writing each answered prompt into the graph. A prompt you leave out keeps the template's placeholder, so answer every required one. |
| `GET` | `/api/automation/workflows` | Paginated list of workflows with run stats. Use it to avoid creating a duplicate, and to find an existing workflow to update. |
| `POST` | `/api/automation/workflows/validate` | Check a graph without saving. Verifies exactly one trigger node, that every edge references existing nodes, and that every non-trigger node has an incoming connection. Call this before create and before update — it is free and catches the structural mistakes. |
| `POST` | `/api/automation/workflows` | Create a workflow in Draft status from a node/edge graph. The trigger type is derived from the trigger node — you do not set it. Drafts never fire. |
| `GET` | `/api/automation/workflows/{workflow}` | One workflow with its full graph, derived triggerType/triggerConfig, and publish state. |
| `PUT` | `/api/automation/workflows/{workflow}` | Update name, description, category, graph, settings or preview_mode. All fields optional. Submitting `nodes` re-derives the trigger type and trigger config, so send the WHOLE graph — a partial node list silently drops the nodes you left out. |
| `POST` | `/api/automation/workflows/{workflow}/publish` | Validate then publish, making the trigger live. On validation failure nothing changes and the errors come back as 422. On success the version increments and publishedAt is set. A workflow only ever fires once published. |
| `POST` | `/api/automation/workflows/{workflow}/toggle` | Flip between published (live) and disabled (paused). Only those two states can be toggled — a draft must be published first. This is the off switch; prefer it to delete. |
| `POST` | `/api/automation/workflows/{workflow}/execute` | Run a published workflow by hand against a payload you supply, instead of waiting for a real trigger. Queued asynchronously — the response is the execution record at status `pending`; poll get-execution for the result. |
| `GET` | `/api/automation/workflows/{workflow}/executions` | Run history for one workflow — status, duration, trigger reference, error. |
| `GET` | `/api/automation/workflow-executions/{execution}` | One execution with its per-step results — each step's status, logs, and (in preview mode) the input the skipped step would have used. This is where you read what actually happened. |
| `POST` | `/api/automation/workflows/{workflow}/clone` | Duplicate a workflow as a new Draft named "<name> (Copy)". Use it to change a live workflow safely — clone, edit the clone, test it, then swap. |
| `DELETE` | `/api/automation/workflows/{workflow}` | Permanently delete a workflow. Irreversible, and it takes the run history with it — disable instead unless the user explicitly asked to delete. |

## Authentication

Every request authenticates with a SKU.io **Personal Access Token** sent as a Bearer token:

```http
Authorization: Bearer <YOUR_SKU_PAT>
```

- **Base URL:** `https://{tenant}.sku.io` — replace `{tenant}` with your account subdomain.
  The subdomain may itself contain a dot (beta and staging accounts often do), so take
  **everything** before `.sku.io` in the URL you sign in at, not just the first label.
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

import { singleLine, snake, paramsByLocation } from './skills.mjs';

// JSON-schema fragment for one canonical parameter (OpenAI / OpenAPI flavour).
function jsonSchemaFor(param) {
  const node = { type: param.type };
  if (param.description) {
    node.description = param.description;
  }
  if (param.example !== undefined) {
    node.example = param.example;
  }
  if (param.type === 'array') {
    node.items = { type: 'string' };
  }
  return node;
}

// Gemini uses OpenAPI-subset schema with UPPERCASE type names.
function geminiSchemaFor(param) {
  const node = { type: param.type.toUpperCase() };
  if (param.description) {
    node.description = param.description;
  }
  if (param.type === 'array') {
    node.items = { type: 'STRING' };
  }
  return node;
}

/** All params flattened into one object schema (function-calling shape). */
function flatParamsSchema(op, dialect = 'openai') {
  const build = dialect === 'gemini' ? geminiSchemaFor : jsonSchemaFor;
  const properties = {};
  const required = [];
  for (const param of op.parameters ?? []) {
    properties[param.name] = build(param);
    if (param.required) {
      required.push(param.name);
    }
  }
  const schema = {
    type: dialect === 'gemini' ? 'OBJECT' : 'object',
    properties,
  };
  if (required.length) {
    schema.required = required;
  }
  return schema;
}

function operationsTable(skill) {
  const rows = skill.meta.api.operations
    .map((op) => `| \`${op.method}\` | \`${op.path}\` | ${singleLine(op.summary)} |`)
    .join('\n');
  return `| Method | Path | What it does |\n| --- | --- | --- |\n${rows}`;
}

function authBlock(skill) {
  const scopes = skill.meta.auth.scopes.map((s) => `\`${s}\``).join(', ');
  return [
    'Every request authenticates with a SKU.io **Personal Access Token** sent as a Bearer token:',
    '',
    '```http',
    'Authorization: Bearer <YOUR_SKU_PAT>',
    '```',
    '',
    `- **Base URL:** \`${skill.meta.api.base_url}\` — replace \`{tenant}\` with your account subdomain.`,
    '  The subdomain may itself contain a dot (beta and staging accounts often do), so take',
    '  **everything** before `.sku.io` in the URL you sign in at, not just the first label.',
    `- **Required scopes:** ${scopes}`,
    '',
    'Mint a token under **Settings → Developer → Personal Access Tokens** in the SKU.io web app.',
    'See [`shared/authentication.md`](../../../shared/authentication.md) for the full flow.',
  ].join('\n');
}

const CONNECT_SKILL_URL = 'https://github.com/skuio/sku-skills/tree/main/skills/platform/connect-to-sku';

/**
 * Every skill but connect-to-sku assumes a tenant and a verified token already exist. That
 * assumption is invisible in the instructions themselves — they open at Step 1 and start calling
 * the API — so an agent handed a bare task has nothing telling it to establish auth first, and
 * discovers the gap as a 401/403 with work already done. Generate the hand-off instead of writing
 * it into each INSTRUCTIONS.md, so it stays identical across skills and covers new ones for free.
 */
function connectBlock(skill) {
  const scopes = skill.meta.auth.scopes.map((s) => `\`${s}\``).join(', ');
  return [
    '## Step 0 — Connect first',
    '',
    'Every call below authenticates as a SKU.io **Personal Access Token** against one specific',
    'tenant, so two things have to be true before Step 1: `$SKU_TENANT` and `$SKU_PAT` are set, and',
    `that token actually carries ${scopes}.`,
    '',
    'If you cannot confirm both, **run the `connect-to-sku` skill first** rather than trying a call',
    "to see what happens. It mints the token, confirms the tenant is the one the user meant, and reads",
    'the scopes back off the token — so a missing scope surfaces now, in one exchange with the user,',
    'instead of as a `403` midway through with half the work already committed. If that skill is not',
    `installed alongside this one, its instructions are at <${CONNECT_SKILL_URL}>.`,
    '',
    'Never invent a tenant or a token, and never quietly fall back to a different tenant than the one',
    'the user named. Writing to the wrong account is the one mistake here the API cannot undo for you.',
  ].join('\n');
}

/**
 * Splice the connect step in immediately before the instructions' first `##` section, so the
 * skill's own lead-in still introduces it and Step 0 lands directly above Step 1. Skills with no
 * `##` headings get it appended.
 */
function withConnectStep(skill) {
  const { instructions } = skill;
  if (skill.name === 'connect-to-sku') {
    return instructions;
  }
  const block = connectBlock(skill);
  const firstSection = instructions.search(/^## /m);
  if (firstSection === -1) {
    return `${instructions}\n\n${block}`;
  }
  return `${instructions.slice(0, firstSection)}${block}\n\n${instructions.slice(firstSection)}`;
}

// ---------------------------------------------------------------------------
// Claude — Agent Skill (SKILL.md)
// ---------------------------------------------------------------------------

export function renderClaudeSkill(skill) {
  const { meta } = skill;
  const instructions = withConnectStep(skill);
  const frontmatter = [
    '---',
    `name: ${meta.name}`,
    `description: ${JSON.stringify(singleLine(meta.description))}`,
    'license: MIT',
    '---',
  ].join('\n');

  return [
    frontmatter,
    '',
    `# ${meta.title}`,
    '',
    instructions,
    '',
    '## API operations',
    '',
    operationsTable(skill),
    '',
    '## Authentication',
    '',
    authBlock(skill),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// OpenAI — GPT/Assistant instructions + Action OpenAPI + function tools
// ---------------------------------------------------------------------------

export function renderOpenAiInstructions(skill) {
  const { meta } = skill;
  const instructions = withConnectStep(skill);
  return [
    `# ${meta.title}`,
    '',
    `_${singleLine(meta.description)}_`,
    '',
    instructions,
    '',
    '## API operations',
    '',
    operationsTable(skill),
    '',
    '## Authentication',
    '',
    authBlock(skill),
  ].join('\n');
}

export function renderOpenApi(skill) {
  const { meta } = skill;
  const paths = {};
  for (const op of meta.api.operations) {
    const method = op.method.toLowerCase();
    paths[op.path] ??= {};
    const parameters = [];
    for (const loc of ['path', 'query', 'header']) {
      for (const p of paramsByLocation(op, loc)) {
        parameters.push({
          name: p.name,
          in: loc,
          required: loc === 'path' ? true : Boolean(p.required),
          description: p.description ?? '',
          schema: jsonSchemaFor(p),
        });
      }
    }
    const entry = {
      operationId: snake(op.id),
      summary: singleLine(op.summary),
      responses: { 200: { description: 'Successful response' } },
    };
    if (parameters.length) {
      entry.parameters = parameters;
    }
    const bodyParams = paramsByLocation(op, 'body');
    if (bodyParams.length) {
      const properties = {};
      const required = [];
      for (const p of bodyParams) {
        properties[p.name] = jsonSchemaFor(p);
        if (p.required) {
          required.push(p.name);
        }
      }
      const schema = { type: 'object', properties };
      if (required.length) {
        schema.required = required;
      }
      entry.requestBody = {
        required: required.length > 0,
        content: { 'application/json': { schema } },
      };
    }
    paths[op.path][method] = entry;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: `SKU.io — ${meta.title}`,
      description: singleLine(meta.description),
      version: meta.version,
    },
    servers: [
      {
        url: meta.api.base_url,
        variables: { tenant: { default: 'app', description: 'Your SKU.io account subdomain.' } },
      },
    ],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'SKU.io Personal Access Token.' },
      },
    },
  };
}

export function renderOpenAiTools(skill) {
  return skill.meta.api.operations.map((op) => ({
    type: 'function',
    function: {
      name: snake(op.id),
      description: `${singleLine(op.summary)} (${op.method} ${op.path})`,
      parameters: flatParamsSchema(op, 'openai'),
    },
  }));
}

// ---------------------------------------------------------------------------
// Gemini — system instructions + function declarations
// ---------------------------------------------------------------------------

export function renderGeminiInstructions(skill) {
  const { meta } = skill;
  const instructions = withConnectStep(skill);
  return [
    `# ${meta.title}`,
    '',
    `System instructions for a Gemini Gem / agent. ${singleLine(meta.description)}`,
    '',
    instructions,
    '',
    '## API operations',
    '',
    operationsTable(skill),
    '',
    '## Authentication',
    '',
    authBlock(skill),
  ].join('\n');
}

export function renderGeminiFunctions(skill) {
  return {
    functionDeclarations: skill.meta.api.operations.map((op) => ({
      name: snake(op.id),
      description: `${singleLine(op.summary)} (${op.method} ${op.path})`,
      parameters: flatParamsSchema(op, 'gemini'),
    })),
  };
}

// ---------------------------------------------------------------------------
// MCP — the manifest the SKU.io MCP server builds its hand-picked tools and
// skill prompts from (dist/mcp/manifest.json)
// ---------------------------------------------------------------------------

const SHARED_URL = 'https://github.com/skuio/sku-skills/blob/main/shared/';

/**
 * First sentence of a parameter description, capped. Every MCP client loads every tool schema
 * into context on connect, so the manifest keeps parameter text short; a skill sets `mcp.tools[].params`
 * when the first sentence is not enough.
 */
function shortDescription(text = '', max = 90) {
  // Pointers at other skill operations ("(from find-supplier)") mean nothing to an MCP client.
  const line = singleLine(text).replace(/\s*\((from|see|via) [^)]*\)/gi, '');
  const first = line.split(/(?<!\b(?:e\.g|i\.e|etc|vs)\.)(?<=[.!?])\s/)[0] ?? line;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/**
 * skill.yaml does not declare array item types, so infer them from the example: objects stay
 * objects, scalars keep their type. Some clients (OpenAI's among them) reject an array schema
 * without `items`.
 */
function mcpItemsFor(param) {
  const first = Array.isArray(param.example) ? param.example[0] : undefined;
  if (first !== undefined && first !== null && typeof first === 'object') {
    return { type: 'object' };
  }
  if (typeof first === 'number') {
    return { type: Number.isInteger(first) ? 'integer' : 'number' };
  }
  if (typeof first === 'string') {
    return { type: 'string' };
  }
  if (/(^|_)ids?$/.test(param.name)) {
    return { type: 'integer' };
  }
  return /(^|_)(tags|skus|codes|names)$/.test(param.name) ? { type: 'string' } : { type: 'object' };
}

function mcpSchemaFor(param, override) {
  const node = { type: param.type };
  // An empty override drops the description: the parameter's name already says it all.
  const description = override !== undefined ? singleLine(override) : shortDescription(param.description);
  if (description) {
    node.description = description;
  }
  if (param.type === 'array') {
    node.items = mcpItemsFor(param);
  }
  return node;
}

/** Every write tool takes these two, so a retry never writes twice and a model can check first. */
export const MCP_WRITE_PARAMS = {
  idempotency_key: {
    type: 'string',
    maxLength: 128,
    description: 'A repeat with this key replays the first result.',
  },
  dry_run: {
    type: 'boolean',
    description: 'Validate only; saves nothing.',
  },
};

export const isMcpWriteTool = (tool) => tool.scope.endsWith(':write');

/** The MCP view of one `mcp.tools[]` entry. Throws when it references an operation the skill lacks. */
export function renderMcpTool(skill, tool) {
  const ops = skill.meta.api.operations;
  const opIds = [tool.operation, ...(tool.also_operations ?? [])];
  const resolved = opIds.map((id) => {
    const op = ops.find((o) => o.id === id);
    if (!op) {
      throw new Error(`${skill.domain}/${skill.name}: mcp tool "${tool.tool}" references unknown operation "${id}"`);
    }
    return op;
  });

  const exclude = new Set(tool.exclude_params ?? []);
  const properties = {};
  const required = [];
  resolved.forEach((op, index) => {
    for (const param of op.parameters ?? []) {
      if (exclude.has(param.name) || properties[param.name]) {
        continue;
      }
      properties[param.name] = mcpSchemaFor(param, tool.params?.[param.name]);
      // Only the primary operation sets what is required; the others are alternate ways in.
      if (index === 0 && (param.required || param.in === 'path')) {
        required.push(param.name);
      }
    }
  });
  if (isMcpWriteTool(tool)) {
    Object.assign(properties, MCP_WRITE_PARAMS);
  }

  const inputSchema = { type: 'object', properties };
  if (required.length) {
    inputSchema.required = required;
  }

  return {
    name: tool.tool,
    title: tool.title ?? skill.meta.title,
    description: singleLine(tool.description),
    inputSchema,
    annotations: {
      readOnlyHint: tool.annotations.read_only,
      destructiveHint: tool.annotations.destructive,
      idempotentHint: tool.annotations.idempotent,
      openWorldHint: tool.annotations.open_world,
    },
    operation: { method: resolved[0].method, path: resolved[0].path },
    operations: resolved.map((op) => ({
      id: op.id,
      method: op.method,
      path: op.path,
      // Where each exposed argument goes on the request, so the server can build it without guessing.
      params: Object.fromEntries((op.parameters ?? []).filter((p) => !exclude.has(p.name)).map((p) => [p.name, p.in])),
    })),
    scope: tool.scope,
    skill: `${skill.domain}/${skill.name}`,
    skill_version: skill.meta.version,
  };
}

/**
 * The prompt body: the skill's own INSTRUCTIONS.md under an MCP preamble. The preamble replaces
 * the generated PAT-oriented "Step 0 — Connect first" (an MCP session is already connected), and
 * shared/ links point at GitHub because there is no folder to bundle them into.
 */
export function renderMcpPrompt(skill) {
  const { meta } = skill;
  const preamble = [
    `# ${meta.title}`,
    '',
    'You are running this skill through the SKU.io MCP server, which is already connected to one',
    'tenant with the access the user granted. Where the steps below show a `curl` call, make the same',
    'request through the server instead: a hand-picked tool when one covers the operation, otherwise',
    'the gateway (`describe_endpoint`, then `api_read` for GET or `api_write` for POST/PUT/PATCH).',
    'Skip any step about minting or pasting a Personal Access Token. A `scope_required` error means the',
    'connection lacks that access: tell the user to reconnect and grant it, rather than working around it.',
    '',
    `Scopes this skill uses: ${meta.auth.scopes.map((s) => `\`${s}\``).join(', ')}.`,
  ].join('\n');

  return {
    name: snake(skill.name),
    title: meta.title,
    description: singleLine(meta.description),
    arguments: [
      {
        name: 'request',
        description: 'Optional. What the user wants done, in their own words (the PO, file or SKUs involved).',
        required: false,
      },
    ],
    text: `${preamble}\n\n${skill.instructions.replaceAll('../../../shared/', SHARED_URL)}\n`,
    skill: `${skill.domain}/${skill.name}`,
    skill_version: meta.version,
    scopes: meta.auth.scopes,
  };
}

/** dist/mcp/manifest.json: every skill's `mcp:` block, resolved against its operations. */
export function renderMcpManifest(skills, version) {
  const tools = [];
  const prompts = [];
  for (const skill of skills) {
    const mcp = skill.meta.mcp;
    if (!mcp) {
      continue;
    }
    for (const tool of mcp.tools ?? []) {
      tools.push(renderMcpTool(skill, tool));
    }
    if (mcp.prompt_only || mcp.prompt) {
      prompts.push(renderMcpPrompt(skill));
    }
  }
  tools.sort((a, b) => a.name.localeCompare(b.name));
  prompts.sort((a, b) => a.name.localeCompare(b.name));

  return {
    $comment: 'Generated by `npm run build` from the `mcp:` blocks in skills/*/skill.yaml. Do not edit.',
    version,
    source: 'https://github.com/skuio/sku-skills',
    tools,
    prompts,
  };
}

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
    `- **Base URL:** \`${skill.meta.api.base_url}\` (replace \`{tenant}\` with your account subdomain)`,
    `- **Required scopes:** ${scopes}`,
    '',
    'Mint a token under **Settings → Developer → Personal Access Tokens** in the SKU.io web app.',
    'See [`shared/authentication.md`](../../../shared/authentication.md) for the full flow.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Claude — Agent Skill (SKILL.md)
// ---------------------------------------------------------------------------

export function renderClaudeSkill(skill) {
  const { meta, instructions } = skill;
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
  const { meta, instructions } = skill;
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
  const { meta, instructions } = skill;
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

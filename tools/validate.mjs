#!/usr/bin/env node
// Validate every canonical skill against the sku-skills spec. Exit non-zero on any error.
import fs from 'node:fs';
import path from 'node:path';
import { findSkillEntries, loadSkill } from './lib/skills.mjs';

const DOMAINS = [
  'platform', 'products', 'orders', 'inventory', 'purchase-orders', 'suppliers',
  'customers', 'warehouses', 'returns', 'manufacturing', 'accounting',
  'integrations', 'reports', 'subscriptions', 'settings',
];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const SCOPE = /^[a-z_-]+:(read|write)$/;
const MCP_TOOL_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const MCP_SCOPE = /^([a-z_-]+:(read|write)|mcp:access)$/;
const MCP_ANNOTATIONS = ['read_only', 'destructive', 'idempotent', 'open_world'];
const ICON = /^mdi-[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Directory reviewers (Anthropic's and OpenAI's) reject tool descriptions that order the model
 * to call other tools — that is the shape of a prompt-injection, even when well meant. A
 * description may say what a tool is for and what it pairs with; it may not issue the order.
 */
const CROSS_TOOL_IMPERATIVES = [
  /\balways\s+(call|use|invoke|run)\b/i,
  /\b(you\s+)?must\s+(first\s+)?(call|use|invoke|run)\b/i,
  /\b(call|invoke|run|use)\s+(the\s+)?(?!this\b)`?[a-z0-9_]+`?\s+tool\b/i,
  /\b(never|don't|do not)\s+(call|use|invoke)\b/i,
  /\bbefore\s+(calling|invoking|using)\b/i,
  /\b(call|invoke)\s+[a-z0-9_`]+\s+first\b/i,
];
const imperativeIn = (text = '') => CROSS_TOOL_IMPERATIVES.find((re) => re.test(String(text)));
const seenMcpTools = new Map();

const entries = findSkillEntries();
const errors = [];
const seenNames = new Set();
// `composes` points at sibling skills, so it can only be resolved once every skill is known.
// Collect the references here and check them after the per-skill loop.
const allNames = new Set(entries.map((e) => e.name));
const composeRefs = [];

if (entries.length === 0) {
  console.error('No skills found under skills/.');
  process.exit(1);
}

for (const entry of entries) {
  const id = `${entry.domain}/${entry.name}`;
  const fail = (msg) => errors.push(`${id}: ${msg}`);
  let skill;
  try {
    skill = loadSkill(entry);
  } catch (e) {
    fail(`skill.yaml failed to parse — ${e.message}`);
    continue;
  }
  const m = skill.meta ?? {};

  if (m.name !== entry.name) {
    fail(`name "${m.name}" must match folder name "${entry.name}"`);
  }
  if (!KEBAB.test(m.name ?? '')) {
    fail('name must be kebab-case');
  }
  if (seenNames.has(m.name)) {
    fail(`duplicate skill name "${m.name}"`);
  }
  seenNames.add(m.name);

  if (!m.title || String(m.title).length < 3) {
    fail('title is required (min 3 chars)');
  }
  if (!DOMAINS.includes(m.domain)) {
    fail(`domain "${m.domain}" is not one of: ${DOMAINS.join(', ')}`);
  }
  if (entry.domain !== m.domain) {
    fail(`domain "${m.domain}" must match parent folder "${entry.domain}"`);
  }
  if (!SEMVER.test(m.version ?? '')) {
    fail('version must be semver (x.y.z)');
  }
  const desc = m.description ?? '';
  // Claude Code loads every installed skill's description into context, and long ones crowd
  // other skills out of its listing. Say what it does and when to use it; detail goes in INSTRUCTIONS.md.
  if (desc.length < 40 || desc.length > 300) {
    fail(`description must be 40–300 chars (got ${desc.length})`);
  }

  if (m.pages !== undefined) {
    if (!Array.isArray(m.pages) || m.pages.length === 0) {
      fail('pages, if present, must be a non-empty array of app route globs');
    } else {
      for (const p of m.pages) {
        if (typeof p !== 'string' || !p.startsWith('/')) {
          fail(`page "${p}" must be a string route glob starting with "/"`);
        }
      }
    }
  }

  if (m.composes !== undefined) {
    if (!Array.isArray(m.composes) || m.composes.length === 0) {
      fail('composes, if present, must be a non-empty array of skill names');
    } else {
      for (const c of m.composes) {
        if (typeof c !== 'string' || !KEBAB.test(c)) {
          fail(`composes entry "${c}" must be a kebab-case skill name`);
        } else if (c === m.name) {
          fail('composes must not list the skill itself');
        } else if (c === 'connect-to-sku') {
          fail('composes must not list connect-to-sku — the installer always includes it');
        } else {
          composeRefs.push({ id, ref: c });
        }
      }
    }
  }

  if (!m.auth || !Array.isArray(m.auth.scopes) || m.auth.scopes.length === 0) {
    fail('auth.scopes must be a non-empty array');
  } else {
    for (const s of m.auth.scopes) {
      if (!SCOPE.test(s)) {
        fail(`invalid scope "${s}" (expected "{resource}:read" or "{resource}:write")`);
      }
    }
  }

  if (!m.api || !m.api.base_url) {
    fail('api.base_url is required');
  }
  const ops = m.api?.operations;
  if (!Array.isArray(ops) || ops.length === 0) {
    fail('api.operations must be a non-empty array');
  } else {
    const opIds = new Set();
    for (const op of ops) {
      if (!KEBAB.test(op.id ?? '')) {
        fail(`operation id "${op.id}" must be kebab-case`);
      }
      if (opIds.has(op.id)) {
        fail(`duplicate operation id "${op.id}"`);
      }
      opIds.add(op.id);
      if (!METHODS.includes(op.method)) {
        fail(`operation "${op.id}" has invalid method "${op.method}"`);
      }
      if (!op.path || !op.path.startsWith('/')) {
        fail(`operation "${op.id}" path must start with "/"`);
      }
      if (!op.summary || op.summary.length < 5) {
        fail(`operation "${op.id}" needs a summary (min 5 chars)`);
      }
      for (const p of op.parameters ?? []) {
        if (!p.name || !p.in || !p.type) {
          fail(`operation "${op.id}" has a parameter missing name/in/type`);
        }
        if (p.in && !['query', 'path', 'body', 'header'].includes(p.in)) {
          fail(`operation "${op.id}" parameter "${p.name}" has invalid location "${p.in}"`);
        }
      }
    }
  }

  if (m.icon !== undefined && !ICON.test(String(m.icon))) {
    fail(`icon "${m.icon}" must be a Material Design Icon name like "mdi-cart-plus"`);
  }

  if (m.mcp !== undefined) {
    validateMcp(m, id, fail);
  }

  const instructionsPath = path.join(entry.dir, 'INSTRUCTIONS.md');
  if (!fs.existsSync(instructionsPath) || fs.readFileSync(instructionsPath, 'utf8').trim().length < 200) {
    fail('INSTRUCTIONS.md is required and must be substantive (min 200 chars)');
  }
}

/** The `mcp:` block: tools resolve to real operations, names fit MCP clients, hints are explicit. */
function validateMcp(m, id, fail) {
  const mcp = m.mcp;
  if (typeof mcp !== 'object' || mcp === null || Array.isArray(mcp)) {
    fail('mcp must be an object');
    return;
  }
  for (const key of Object.keys(mcp)) {
    if (!['prompt_only', 'prompt', 'tools'].includes(key)) {
      fail(`mcp has unknown key "${key}"`);
    }
  }
  const hasTools = mcp.tools !== undefined;
  if (mcp.prompt_only === true && hasTools) {
    fail('mcp: a prompt_only skill must not also declare tools');
  }
  if (mcp.prompt_only !== true && !hasTools) {
    fail('mcp must declare tools, or set prompt_only: true');
  }
  if (mcp.prompt_only !== undefined && typeof mcp.prompt_only !== 'boolean') {
    fail('mcp.prompt_only must be a boolean');
  }
  if (mcp.prompt !== undefined && typeof mcp.prompt !== 'boolean') {
    fail('mcp.prompt must be a boolean');
  }
  if (!hasTools) {
    return;
  }
  if (!Array.isArray(mcp.tools) || mcp.tools.length === 0) {
    fail('mcp.tools must be a non-empty array');
    return;
  }

  const ops = new Map((m.api?.operations ?? []).map((op) => [op.id, op]));
  const allowed = new Set(['tool', 'operation', 'also_operations', 'title', 'description', 'scope', 'exclude_params', 'params', 'annotations']);
  for (const tool of mcp.tools) {
    const name = tool?.tool ?? '';
    const where = `mcp tool "${name}"`;
    for (const key of Object.keys(tool ?? {})) {
      if (!allowed.has(key)) {
        fail(`${where} has unknown key "${key}"`);
      }
    }
    if (!MCP_TOOL_NAME.test(name)) {
      fail(`${where}: name must be snake_case (lowercase letters, digits, single underscores)`);
    }
    if (name.length > 64) {
      fail(`${where}: name must be at most 64 characters (got ${name.length})`);
    }
    if (seenMcpTools.has(name)) {
      fail(`${where}: name is already used by ${seenMcpTools.get(name)}`);
    }
    seenMcpTools.set(name, id);

    const opIds = [tool.operation, ...(tool.also_operations ?? [])];
    const resolved = [];
    for (const opId of opIds) {
      const op = ops.get(opId);
      if (!op) {
        fail(`${where}: operation "${opId}" is not in api.operations`);
      } else {
        resolved.push(op);
      }
    }

    if (!MCP_SCOPE.test(tool.scope ?? '')) {
      fail(`${where}: scope "${tool.scope}" must be "{resource}:read", "{resource}:write" or "mcp:access"`);
    } else if (tool.scope !== 'mcp:access' && !(m.auth?.scopes ?? []).includes(tool.scope)) {
      fail(`${where}: scope "${tool.scope}" must also be listed in auth.scopes`);
    }

    const desc = singleLineOf(tool.description);
    if (desc.length < 40 || desc.length > 600) {
      fail(`${where}: description must be 40–600 chars (got ${desc.length})`);
    }
    const hit = imperativeIn(desc);
    if (hit) {
      fail(`${where}: description gives the model a cross-tool instruction (${hit}); describe the tool instead`);
    }
    if (tool.title !== undefined && (String(tool.title).length < 3 || String(tool.title).length > 60)) {
      fail(`${where}: title must be 3–60 chars`);
    }

    const paramNames = new Set(resolved.flatMap((op) => (op.parameters ?? []).map((p) => p.name)));
    for (const p of tool.exclude_params ?? []) {
      if (!paramNames.has(p)) {
        fail(`${where}: exclude_params names "${p}", which none of its operations take`);
      }
    }
    for (const [p, text] of Object.entries(tool.params ?? {})) {
      if (!paramNames.has(p)) {
        fail(`${where}: params describes "${p}", which none of its operations take`);
      }
      const paramHit = imperativeIn(text);
      if (paramHit) {
        fail(`${where}: the description of "${p}" gives a cross-tool instruction (${paramHit})`);
      }
    }
    for (const p of ['idempotency_key', 'dry_run']) {
      if (paramNames.has(p)) {
        fail(`${where}: an operation parameter is named "${p}", which the MCP server reserves`);
      }
    }

    const ann = tool.annotations ?? {};
    for (const key of MCP_ANNOTATIONS) {
      if (typeof ann[key] !== 'boolean') {
        fail(`${where}: annotations.${key} must be set explicitly to true or false`);
      }
    }
    for (const key of Object.keys(ann)) {
      if (!MCP_ANNOTATIONS.includes(key)) {
        fail(`${where}: annotations has unknown key "${key}"`);
      }
    }
    const writes = resolved.some((op) => op.method !== 'GET');
    if (ann.read_only === true && writes) {
      fail(`${where}: read_only is true but it calls a ${resolved.find((op) => op.method !== 'GET').method} operation`);
    }
    if (ann.read_only === true && ann.destructive === true) {
      fail(`${where}: a read_only tool cannot be destructive`);
    }
    if (resolved.some((op) => op.method === 'DELETE')) {
      fail(`${where}: MCP tools never wrap a DELETE operation`);
    }
    if (writes && String(tool.scope).endsWith(':read')) {
      fail(`${where}: it writes, so its scope must be a :write scope`);
    }
    if (!writes && String(tool.scope).endsWith(':write')) {
      fail(`${where}: it only reads, so its scope must not be a :write scope`);
    }
  }
}

function singleLineOf(s = '') {
  return String(s).replace(/\s+/g, ' ').trim();
}

for (const { id, ref } of composeRefs) {
  if (!allNames.has(ref)) {
    errors.push(`${id}: composes references "${ref}", which is not a skill in this repo`);
  }
}

if (errors.length) {
  console.error(`✗ ${errors.length} validation error(s):\n`);
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
}

console.log(`✓ ${entries.length} skill(s) valid.`);

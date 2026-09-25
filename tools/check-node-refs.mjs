#!/usr/bin/env node
// Check that every workflow node type a skill names still exists in SKU.io's node registry.
//
// The skills deliberately do not list the node catalog (the agent reads it live), but they do
// name a few node types in prose and examples — `sales-order-created`, `channel-order-imported`.
// A rename in the app would leave those pointing at nothing, and nothing here would notice.
//
// Not part of `npm run check`: CI has neither a tenant nor the app source, so this is run by
// hand before releasing a workflow-skill change. Pick a registry source:
//
//   node tools/check-node-refs.mjs --source ~/code/sku     # parse a local checkout of the app
//   SKU_TENANT=… SKU_PAT=… node tools/check-node-refs.mjs  # ask a live tenant
//
// Which skills: those that call GET /api/automation/workflow-nodes.
import fs from 'node:fs';
import path from 'node:path';
import { loadAllSkills } from './lib/skills.mjs';

const CATALOG_PATH = '/api/automation/workflow-nodes';
const KEBAB_TOKEN = /`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g;
const JSON_TYPE = /"(?:type|node_type)"\s*:\s*"([a-z][a-z0-9]*(?:-[a-z0-9]+)+)"/g;

async function registryTypes() {
  const i = process.argv.indexOf('--source');
  if (i !== -1) {
    const root = process.argv[i + 1];
    const provider = path.join(root, 'Modules/Automation/Providers/AutomationServiceProvider.php');
    const php = fs.readFileSync(provider, 'utf8');
    const types = [...php.matchAll(/->register\(\s*'([^']+)'/g)].map((m) => m[1]);
    if (types.length === 0) throw new Error(`No ->register('…') calls found in ${provider}`);
    return { types: new Set(types), from: provider };
  }
  const { SKU_TENANT, SKU_PAT } = process.env;
  if (!SKU_TENANT || !SKU_PAT) {
    throw new Error('Pass --source <sku app checkout>, or set SKU_TENANT and SKU_PAT.');
  }
  const res = await fetch(`https://${SKU_TENANT}.sku.io${CATALOG_PATH}`, {
    headers: { Authorization: `Bearer ${SKU_PAT}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${CATALOG_PATH} → HTTP ${res.status}`);
  const body = await res.json();
  return { types: new Set(body.data.map((n) => n.type)), from: `${SKU_TENANT}.sku.io` };
}

/** Node types a skill names: example node `type`s, `node_type` examples, and backticked kebab tokens. */
function referencedTypes(skill, notNodeTypes) {
  const refs = new Set();
  const text = skill.instructions;
  for (const m of text.matchAll(KEBAB_TOKEN)) refs.add(m[1]);
  for (const m of text.matchAll(JSON_TYPE)) refs.add(m[1]);
  for (const op of skill.meta.api?.operations ?? []) {
    for (const p of op.parameters ?? []) {
      if (p.name === 'node_type' && typeof p.example === 'string') refs.add(p.example);
      if (p.name === 'nodes' && Array.isArray(p.example)) {
        for (const node of p.example) if (node?.type) refs.add(node.type);
      }
    }
  }
  for (const t of notNodeTypes) refs.delete(t);
  return refs;
}

const skills = loadAllSkills();
const targets = skills.filter((s) =>
  (s.meta.api?.operations ?? []).some((op) => op.method === 'GET' && op.path === CATALOG_PATH),
);
// Backticked kebab tokens that are not node types: skill names and operation ids.
const notNodeTypes = new Set(skills.map((s) => s.meta.name));
for (const s of targets) for (const op of s.meta.api?.operations ?? []) notNodeTypes.add(op.id);

let registry;
try {
  registry = await registryTypes();
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(2);
}

let missing = 0;
for (const skill of targets) {
  const refs = [...referencedTypes(skill, notNodeTypes)].sort();
  const gone = refs.filter((t) => !registry.types.has(t));
  missing += gone.length;
  const where = `${skill.meta.domain}/${skill.meta.name}`;
  if (gone.length) {
    console.error(`✗ ${where} names node types not in the registry: ${gone.join(', ')}`);
  } else {
    console.log(`✓ ${where}: ${refs.length} node type(s) found in the registry (${refs.join(', ')})`);
  }
}
console.log(`  registry: ${registry.types.size} node types from ${registry.from}`);
process.exit(missing ? 1 : 0);

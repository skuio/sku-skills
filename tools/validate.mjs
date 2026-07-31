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
const SCOPE = /^[a-z-]+:(read|write)$/;

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
  if (desc.length < 40 || desc.length > 1024) {
    fail(`description must be 40–1024 chars (got ${desc.length})`);
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

  const instructionsPath = path.join(entry.dir, 'INSTRUCTIONS.md');
  if (!fs.existsSync(instructionsPath) || fs.readFileSync(instructionsPath, 'utf8').trim().length < 200) {
    fail('INSTRUCTIONS.md is required and must be substantive (min 200 chars)');
  }
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

#!/usr/bin/env node
// Prove the README's one-line install: run the `skills` installer on this checkout, for Claude Code,
// Codex and Cursor, and check that every skill in the catalog landed where each agent looks.
//
// Why: `npx skills add skuio/sku-skills` once answered "No valid skills found" for every skill,
// because the installer searches skills/ (the source) and the built ones are in dist/. The
// .claude-plugin manifest fixed it, and nothing else in this repo fails when that breaks again.
//
// Needs the network (npx). The installer is pinned so a release of it cannot turn an unrelated PR
// red; move SKILLS_CLI forward on purpose.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, DIST_DIR } from './lib/fs.mjs';
import { ALWAYS } from './lib/compose.mjs';

const SKILLS_CLI = 'skills@1.9.0';
// Agent name the installer uses → where that agent looks for project skills.
const AGENTS = { 'claude-code': '.claude/skills', codex: '.agents/skills', cursor: '.agents/skills' };

const catalog = JSON.parse(fs.readFileSync(path.join(DIST_DIR, 'catalog.json'), 'utf8')).skills;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sku-skills-install-'));
const problems = [];

/** Run the installer in an empty project with an empty HOME, so nothing already installed can pass for it. */
function install(label, args) {
  const project = path.join(tmp, label, 'project');
  const home = path.join(tmp, label, 'home');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const run = spawnSync('npx', ['-y', SKILLS_CLI, 'add', ROOT, ...args, '-y'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 180_000,
    env: {
      ...process.env,
      HOME: home,
      DISABLE_TELEMETRY: '1',
      NO_COLOR: '1',
      npm_config_cache: process.env.npm_config_cache ?? path.join(os.homedir(), '.npm'),
    },
  });
  if (run.status !== 0) {
    problems.push(`${label}: installer exited ${run.status ?? run.signal}\n${run.stdout ?? ''}${run.stderr ?? ''}`.trim());
    return null;
  }
  return project;
}

/** Every file of the built skill must be there, byte for byte: SKILL.md alone leaves its links dead. */
function check(label, project, dir, skill) {
  const built = path.join(DIST_DIR, 'claude', skill.domain, skill.name);
  for (const entry of fs.readdirSync(built, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const source = path.join(entry.parentPath ?? entry.path, entry.name);
    const rel = path.relative(built, source);
    const landed = path.join(project, dir, skill.name, rel);
    if (!fs.existsSync(landed)) {
      problems.push(`${label}: ${dir}/${skill.name}/${rel} is missing`);
    } else if (!fs.readFileSync(landed).equals(fs.readFileSync(source))) {
      problems.push(`${label}: ${dir}/${skill.name}/${rel} differs from dist/`);
    }
  }
}

let checked = 0;
try {
  for (const [agent, dir] of Object.entries(AGENTS)) {
    const project = install(agent, ['--skill', '*', '-a', agent]);
    if (!project) {
      continue;
    }
    for (const skill of catalog) {
      check(agent, project, dir, skill);
      checked += 1;
    }
    const extra = fs.readdirSync(path.join(project, dir)).filter((n) => !catalog.some((s) => s.name === n));
    if (extra.length) {
      problems.push(`${agent}: installed something that is not in the catalog: ${extra.join(', ')}`);
    }
  }

  // The README's per-skill command, for the skill that hands off to the most others.
  const deepest = [...catalog].sort((a, b) => b.install.length - a.install.length)[0];
  const args = deepest.install.replace('npx skills add skuio/sku-skills ', '').split(' ');
  const wanted = args.filter((a) => a !== '--skill');
  const project = install('one-skill', [...args, '-a', 'claude-code']);
  if (project) {
    const got = fs.readdirSync(path.join(project, AGENTS['claude-code'])).sort();
    if (got.join() !== [...wanted].sort().join()) {
      problems.push(`one-skill: wanted ${wanted.join(', ')} — got ${got.join(', ')}`);
    }
    if (!got.includes(ALWAYS)) {
      problems.push(`one-skill: ${ALWAYS} was not installed`);
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (catalog.length === 0 || problems.length) {
  console.error(problems.length ? problems.map((p) => `✗ ${p}`).join('\n') : '✗ the catalog is empty');
  process.exit(1);
}
console.log(`✓ ${SKILLS_CLI} installed ${catalog.length} skills for ${Object.keys(AGENTS).join(', ')} (${checked} checked), and one skill with what it hands off to`);

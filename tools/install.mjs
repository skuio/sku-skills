#!/usr/bin/env node
// Install prebuilt Claude Agent Skills from dist/ into a directory Claude Code scans.
//
// Cloning this repo does not install anything: Claude Code discovers skills at
// ~/.claude/skills/<name>/SKILL.md (every project) or <project>/.claude/skills/<name>/SKILL.md
// (one project), and the built skills live at dist/claude/<domain>/<name>/. This script copies
// them across, pulling in the skills a given one hands off to so the whole flow works.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, DIST_DIR, copyDir } from './lib/skills.mjs';

const CATALOG_PATH = path.join(DIST_DIR, 'catalog.json');
// Every skill's generated "Step 0 — Connect first" sends the agent here when there is no verified
// token, so it ships with whatever else is installed rather than being a dead reference.
const ALWAYS = 'connect-to-sku';

const USAGE = `
Install SKU.io agent skills into a directory Claude Code scans.

  node tools/install.mjs <skill|all> [<skill>...] [options]

Arguments
  <skill>            Skill name (e.g. set-initial-inventory) or domain/name.
  all                Every skill in the catalog.

Options
  --user             Install to ~/.claude/skills  (default — available in every project)
  --project [path]   Install to <path>/.claude/skills  (default path: the current directory)
  --list             Print the catalog and exit.
  --no-deps          Do not pull in composed skills (still installs ${ALWAYS}).
  --force            Overwrite skills that are already installed.
  --dry-run          Print what would happen, write nothing.
  -h, --help         This text.

Examples
  node tools/install.mjs set-initial-inventory
  node tools/install.mjs build-product-catalog --project ~/work/acme
  node tools/install.mjs all --force
`;

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { names: [], target: null, list: false, deps: true, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        console.log(USAGE.trim());
        process.exit(0);
      // eslint-disable-next-line no-fallthrough -- process.exit above never returns
      case '--list':
        opts.list = true;
        break;
      case '--no-deps':
        opts.deps = false;
        break;
      case '--force':
        opts.force = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--user':
        opts.target = path.join(os.homedir(), '.claude', 'skills');
        break;
      case '--project': {
        // Optional path argument — `--project` alone means the current directory.
        const next = argv[i + 1];
        const base = next && !next.startsWith('-') ? (i += 1, next) : process.cwd();
        opts.target = path.join(path.resolve(base.replace(/^~(?=$|\/)/, os.homedir())), '.claude', 'skills');
        break;
      }
      default:
        if (arg.startsWith('-')) {
          die(`unknown option "${arg}"\n${USAGE}`);
        }
        // Accept "domain/name" as well as a bare name.
        opts.names.push(arg.includes('/') ? arg.split('/').pop() : arg);
    }
  }
  opts.target ??= path.join(os.homedir(), '.claude', 'skills');
  return opts;
}

function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    die(`no build found at ${path.relative(ROOT, CATALOG_PATH)} — run \`npm run build\` first.`);
  }
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')).skills ?? [];
  } catch (e) {
    die(`could not read ${path.relative(ROOT, CATALOG_PATH)} — ${e.message}`);
  }
}

/** Walk `composes` transitively, so installing one skill brings the flow it depends on. */
function resolve(names, byName, followDeps) {
  const out = new Map();
  const queue = [...names];
  while (queue.length) {
    const name = queue.shift();
    if (out.has(name)) {
      continue;
    }
    const skill = byName.get(name);
    if (!skill) {
      // Match on shared kebab tokens, so a typo in one word ("inital-inventory") still points at
      // the skills that share the other ("set-initial-inventory", "adjust-inventory").
      const wanted = new Set(name.split('-'));
      const guesses = [...byName.keys()].filter(
        (k) => k.includes(name) || name.includes(k) || k.split('-').some((t) => wanted.has(t)),
      );
      die(`unknown skill "${name}"${guesses.length ? ` — did you mean: ${guesses.join(', ')}?` : ''}\nRun with --list to see them all.`);
    }
    out.set(name, skill);
    if (followDeps) {
      queue.push(...(skill.composes ?? []));
    }
  }
  return [...out.values()];
}

const opts = parseArgs(process.argv.slice(2));
const catalog = loadCatalog();
const byName = new Map(catalog.map((s) => [s.name, s]));

if (opts.list) {
  console.log(`${catalog.length} skill(s) available:\n`);
  for (const s of [...catalog].sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name))) {
    console.log(`  ${s.domain}/${s.name}`);
    console.log(`      ${s.tagline}`);
    console.log(`      scopes: ${s.scopes.join(', ')}${s.composes?.length ? `  ·  composes: ${s.composes.join(', ')}` : ''}`);
  }
  process.exit(0);
}

if (opts.names.length === 0) {
  console.error(USAGE.trim());
  process.exit(1);
}

const requested = opts.names.includes('all') ? catalog.map((s) => s.name) : opts.names;
// connect-to-sku underpins every skill, so it goes in even with --no-deps.
const selected = resolve([...new Set([...requested, ALWAYS])], byName, opts.deps);

const explicit = new Set(requested);
const installed = [];
const skipped = [];

for (const skill of selected) {
  const src = path.join(DIST_DIR, 'claude', skill.domain, skill.name);
  const dest = path.join(opts.target, skill.name);
  if (!fs.existsSync(src)) {
    die(`${skill.domain}/${skill.name} is in the catalog but missing from dist/ — run \`npm run build\`.`);
  }
  const why = explicit.has(skill.name) ? '' : skill.name === ALWAYS ? '  (required by every skill)' : '  (composed)';
  if (fs.existsSync(dest) && !opts.force) {
    skipped.push(skill.name);
    console.log(`· ${skill.name} — already installed, leaving it alone (--force to overwrite)`);
    continue;
  }
  if (!opts.dryRun) {
    fs.rmSync(dest, { recursive: true, force: true });
    copyDir(src, dest);
  }
  installed.push(skill.name);
  console.log(`${opts.dryRun ? '→ would install' : '✓ installed'} ${skill.name}${why}`);
}

const pretty = opts.target.startsWith(os.homedir()) ? opts.target.replace(os.homedir(), '~') : opts.target;
console.log(`\n${opts.dryRun ? 'Target' : 'Installed to'}: ${pretty}`);
if (skipped.length) {
  console.log(`Left in place: ${skipped.join(', ')}`);
}
if (installed.length && !opts.dryRun) {
  console.log(
    [
      '',
      'Next: start a Claude Code session in the project you want to work in and just say what you',
      "want done — the skill is chosen from your request, you don't invoke it by name. It will ask",
      'for your SKU.io tenant and a Personal Access Token, and walk you through minting one if you',
      'do not have it yet.',
    ].join('\n'),
  );
}

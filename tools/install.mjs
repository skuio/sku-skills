#!/usr/bin/env node
// Install prebuilt Agent Skills from dist/ into the directory a coding agent scans.
//
// Cloning this repo does not install anything: each agent discovers skills in its own folder, at
// user level (every project) or inside one project, and the built skills live at
// dist/claude/<domain>/<name>/. SKILL.md is an open format, so Claude Code, Codex and Cursor all
// read the same folder; only its location differs (see AGENTS below). This script copies them
// across, pulling in the skills a given one hands off to so the whole flow works.
//
// `npx skills add skuio/sku-skills` needs no clone and is the README's first choice. This is the
// route for a clone, a fork or a local change, and it resolves `composes` for you.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Built-ins only: a fresh clone runs this with plain Node, no `npm ci` (js-yaml is a build dependency).
import { ROOT, DIST_DIR, copyDir } from './lib/fs.mjs';
import { ALWAYS, withComposed } from './lib/compose.mjs';

const CATALOG_PATH = path.join(DIST_DIR, 'catalog.json');
// Where each agent looks, relative to the home directory or to a project.
//   Claude Code: https://code.claude.com/docs/en/skills
//   Codex:       https://developers.openai.com/codex/skills
//   Cursor:      https://cursor.com/docs/skills
const AGENTS = {
  claude: { label: 'Claude Code', dir: path.join('.claude', 'skills') },
  codex: { label: 'Codex', dir: path.join('.agents', 'skills') },
  cursor: { label: 'Cursor', dir: path.join('.agents', 'skills') },
};

const USAGE = `
Install SKU.io agent skills for Claude Code, Codex or Cursor.

  node tools/install.mjs <skill|all> [<skill>...] [options]

Arguments
  <skill>            Skill name (e.g. set-initial-inventory) or domain/name.
  all                Every skill in the catalog.

Options
  --agent <name>     claude (default), codex, cursor, or several: --agent claude,codex
                     claude → .claude/skills   codex, cursor → .agents/skills
  --user             Install under your home directory  (default — available in every project)
  --project [path]   Install under <path>  (default path: the current directory)
  --list             Print the catalog and exit.
  --no-deps          Do not pull in composed skills (still installs ${ALWAYS}).
  --force            Overwrite skills that are already installed.
  --dry-run          Print what would happen, write nothing.
  -h, --help         This text.

Examples
  node tools/install.mjs set-initial-inventory
  node tools/install.mjs build-product-catalog --project ~/work/acme
  node tools/install.mjs create-purchase-order --agent codex
  node tools/install.mjs all --force
`;

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { names: [], base: os.homedir(), agents: [], list: false, deps: true, force: false, dryRun: false };
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
        opts.base = os.homedir();
        break;
      case '--project': {
        // Optional path argument — `--project` alone means the current directory.
        const next = argv[i + 1];
        const base = next && !next.startsWith('-') ? (i += 1, next) : process.cwd();
        opts.base = path.resolve(base.replace(/^~(?=$|\/)/, os.homedir()));
        break;
      }
      case '--agent': {
        const next = argv[i + 1];
        if (!next || next.startsWith('-')) {
          die(`--agent needs a name: ${Object.keys(AGENTS).join(', ')}`);
        }
        i += 1;
        opts.agents.push(...next.split(',').map((a) => a.trim()).filter(Boolean));
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
  // "claude-code" is what `npx skills` calls it; accept it here too.
  opts.agents = [...new Set(opts.agents.map((a) => (a === 'claude-code' ? 'claude' : a)))];
  const unknown = opts.agents.filter((a) => !Object.hasOwn(AGENTS, a));
  if (unknown.length) {
    die(`unknown agent "${unknown[0]}" — use one of: ${Object.keys(AGENTS).join(', ')}`);
  }
  if (opts.agents.length === 0) {
    opts.agents = ['claude'];
  }
  // Codex and Cursor share a folder, so the same target is only written once.
  opts.targets = [...new Set(opts.agents.map((a) => path.join(opts.base, AGENTS[a].dir)))];
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

function unknownSkill(name, byName) {
  // Match on shared kebab tokens, so a typo in one word ("inital-inventory") still points at
  // the skills that share the other ("set-initial-inventory", "adjust-inventory").
  const wanted = new Set(name.split('-'));
  const guesses = [...byName.keys()].filter(
    (k) => k.includes(name) || name.includes(k) || k.split('-').some((t) => wanted.has(t)),
  );
  die(`unknown skill "${name}"${guesses.length ? ` — did you mean: ${guesses.join(', ')}?` : ''}\nRun with --list to see them all.`);
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
const selected = withComposed([...new Set(requested)], byName, {
  followDeps: opts.deps,
  onUnknown: (name) => unknownSkill(name, byName),
});

const explicit = new Set(requested);
const tilde = (p) => (p.startsWith(os.homedir()) ? p.replace(os.homedir(), '~') : p);
let installedAny = false;

for (const target of opts.targets) {
  const skipped = [];
  for (const skill of selected) {
    const src = path.join(DIST_DIR, 'claude', skill.domain, skill.name);
    const dest = path.join(target, skill.name);
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
      installedAny = true;
    }
    console.log(`${opts.dryRun ? '→ would install' : '✓ installed'} ${skill.name}${why}`);
  }
  console.log(`\n${opts.dryRun ? 'Target' : 'Installed to'}: ${tilde(target)}`);
  if (skipped.length) {
    console.log(`Left in place: ${skipped.join(', ')}`);
  }
}

if (installedAny) {
  console.log(
    [
      '',
      `Next: start a ${opts.agents.map((a) => AGENTS[a].label).join(' or ')} session in the project you want to work in`,
      "and just say what you want done — the skill is chosen from your request, you don't invoke it by",
      'name. It will ask for your SKU.io tenant and a Personal Access Token, and walk you through',
      'minting one if you do not have it yet.',
    ].join('\n'),
  );
}

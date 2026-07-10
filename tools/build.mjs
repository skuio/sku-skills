#!/usr/bin/env node
// Render every canonical skill into Claude, OpenAI, and Gemini formats under dist/.
import fs from 'node:fs';
import path from 'node:path';
import { loadAllSkills, DIST_DIR, ROOT, writeFile, copyDir, singleLine } from './lib/skills.mjs';
import {
  renderClaudeSkill,
  renderOpenAiInstructions,
  renderOpenApi,
  renderOpenAiTools,
  renderGeminiInstructions,
  renderGeminiFunctions,
} from './lib/render.mjs';

const skills = loadAllSkills();

if (skills.length === 0) {
  console.error('No skills found under skills/. Nothing to build.');
  process.exit(1);
}

fs.rmSync(DIST_DIR, { recursive: true, force: true });

const json = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

// Skills reference shared/ docs with `../../../shared/…` (relative to skills/<domain>/<name>/).
// Each output target resolves that differently so an installed skill has no dead links:
//   Claude — bundle shared/ into the skill folder, link to `shared/…`
//   OpenAI/Gemini — no folder to bundle into (content is pasted), so link to the GitHub copy.
const SHARED_SRC = path.join(ROOT, 'shared');
const SHARED_URL = 'https://github.com/skuio/sku-skills/blob/main/shared/';
const localizeShared = (s) => s.replaceAll('../../../shared/', 'shared/');
const urlizeShared = (s) => s.replaceAll('../../../shared/', SHARED_URL);

// Appended to every generated skill so the agent using it is invited — right where it hit the wall —
// to send an improvement back. This is the community feedback loop: use the skill, and if it didn't
// fully work, have your agent open a PR to make it better.
const IMPROVE_FOOTER = [
  '',
  '',
  '---',
  '',
  '## Improve this skill',
  '',
  "Did this skill fall short—an unclear step, a wrong endpoint, or something it couldn't finish? Don't",
  'just work around it: capture what was off and open a pull request so the next agent does better.',
  '',
  '- Repo: <https://github.com/skuio/sku-skills>',
  '- Edit the **canonical** skill under `skills/<domain>/<name>/` (not this generated file), then run',
  '  `npm run build` and open a PR. External contributors: fork the repo and PR from the fork.',
  '- The full agent workflow is in [`AGENTS.md`](https://github.com/skuio/sku-skills/blob/main/AGENTS.md).',
  '',
  'Your agent can do this end to end. The library gets better every time someone sends a fix.',
  '',
].join('\n');

const catalog = [];

for (const skill of skills) {
  const { domain, name, dir, meta } = skill;
  const slug = `${domain}/${name}`;

  // --- Claude: a self-contained Agent Skill folder -------------------------
  const claudeDir = path.join(DIST_DIR, 'claude', domain, name);
  writeFile(path.join(claudeDir, 'SKILL.md'), localizeShared(renderClaudeSkill(skill)) + IMPROVE_FOOTER);
  copyDir(path.join(dir, 'examples'), path.join(claudeDir, 'examples'));
  copyDir(SHARED_SRC, path.join(claudeDir, 'shared'));

  // --- OpenAI: GPT instructions + importable Action + function tools -------
  const openaiDir = path.join(DIST_DIR, 'openai', domain, name);
  writeFile(path.join(openaiDir, 'instructions.md'), urlizeShared(renderOpenAiInstructions(skill)) + IMPROVE_FOOTER);
  writeFile(path.join(openaiDir, 'action.openapi.json'), json(renderOpenApi(skill)));
  writeFile(path.join(openaiDir, 'tools.json'), json(renderOpenAiTools(skill)));

  // --- Gemini: system instructions + function declarations ----------------
  const geminiDir = path.join(DIST_DIR, 'gemini', domain, name);
  writeFile(path.join(geminiDir, 'system_instructions.md'), urlizeShared(renderGeminiInstructions(skill)) + IMPROVE_FOOTER);
  writeFile(path.join(geminiDir, 'function_declarations.json'), json(renderGeminiFunctions(skill)));

  const description = singleLine(meta.description);
  catalog.push({
    name,
    domain,
    title: meta.title,
    version: meta.version,
    description,
    // Short human-facing 'what it does' for the root README table; fall back to the first sentence.
    tagline: meta.tagline ? singleLine(meta.tagline) : description.split(/(?<=[.!?])\s/)[0],
    scopes: meta.auth.scopes,
    operations: meta.api.operations.length,
    tags: meta.tags ?? [],
    outputs: {
      claude: `dist/claude/${slug}/SKILL.md`,
      openai: `dist/openai/${slug}/`,
      gemini: `dist/gemini/${slug}/`,
    },
  });
}

// --- catalog + generated index ---------------------------------------------
writeFile(path.join(DIST_DIR, 'catalog.json'), json({ generatedFrom: 'skills/', count: catalog.length, skills: catalog }));

const byDomain = catalog.reduce((acc, s) => {
  (acc[s.domain] ??= []).push(s);
  return acc;
}, {});
const indexRows = Object.keys(byDomain)
  .sort()
  .map((domain) => {
    const rows = byDomain[domain]
      .map((s) => `| \`${s.name}\` | ${s.title} | ${s.description} | ${s.scopes.join(', ')} |`)
      .join('\n');
    return `### ${domain}\n\n| Skill | Title | Description | Scopes |\n| --- | --- | --- | --- |\n${rows}`;
  })
  .join('\n\n');
writeFile(
  path.join(DIST_DIR, 'README.md'),
  `# Built skills\n\n_Generated by \`npm run build\` — do not edit. Source of truth is \`skills/\`._\n\n${indexRows}\n`,
);

// --- root README skills table (spliced between markers) --------------------
// The root README is hand-written, but this one table is generated so it can
// never drift from skills/. CI verifies README.md alongside dist/.
const README_PATH = path.join(ROOT, 'README.md');
const BEGIN_MARK = '<!-- BEGIN:skills-table -->';
const END_MARK = '<!-- END:skills-table -->';
const tableRows = [...catalog]
  .sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name))
  .map((s) => `| \`${s.domain}\` | **${s.name}** | ${s.tagline} |`)
  .join('\n');
const skillsTable = `| Domain | Skill | What it does |\n| --- | --- | --- |\n${tableRows}`;

const readme = fs.readFileSync(README_PATH, 'utf8');
const begin = readme.indexOf(BEGIN_MARK);
const end = readme.indexOf(END_MARK);
if (begin === -1 || end === -1 || end < begin) {
  console.error(`README.md is missing the ${BEGIN_MARK} … ${END_MARK} markers; cannot regenerate the skills table.`);
  process.exit(1);
}
const updatedReadme =
  readme.slice(0, begin + BEGIN_MARK.length) + `\n${skillsTable}\n` + readme.slice(end);
if (updatedReadme !== readme) {
  fs.writeFileSync(README_PATH, updatedReadme);
}

const rel = (p) => path.relative(ROOT, p);
console.log(`Built ${skills.length} skill(s) → ${rel(DIST_DIR)}/{claude,openai,gemini}`);
for (const s of catalog) {
  console.log(`  • ${s.domain}/${s.name}  (${s.operations} op${s.operations === 1 ? '' : 's'}, scopes: ${s.scopes.join(', ')})`);
}

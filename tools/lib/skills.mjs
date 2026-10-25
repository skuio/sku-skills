import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { SKILLS_DIR } from './fs.mjs';

// Paths and filesystem helpers live in the dependency-free ./fs.mjs; re-exported for callers.
export { ROOT, SKILLS_DIR, DIST_DIR, writeFile, copyDir } from './fs.mjs';

/** Discover every `skills/<domain>/<name>/skill.yaml`. */
export function findSkillEntries() {
  const entries = [];
  if (!fs.existsSync(SKILLS_DIR)) {
    return entries;
  }
  for (const domain of fs.readdirSync(SKILLS_DIR).sort()) {
    const domainDir = path.join(SKILLS_DIR, domain);
    if (!fs.statSync(domainDir).isDirectory()) {
      continue;
    }
    for (const name of fs.readdirSync(domainDir).sort()) {
      const dir = path.join(domainDir, name);
      if (!fs.statSync(dir).isDirectory()) {
        continue;
      }
      const yamlPath = path.join(dir, 'skill.yaml');
      if (fs.existsSync(yamlPath)) {
        entries.push({ domain, name, dir, yamlPath });
      }
    }
  }
  return entries;
}

export function loadSkill(entry) {
  const meta = yaml.load(fs.readFileSync(entry.yamlPath, 'utf8')) ?? {};
  const instructionsPath = path.join(entry.dir, 'INSTRUCTIONS.md');
  const instructions = fs.existsSync(instructionsPath)
    ? fs.readFileSync(instructionsPath, 'utf8').trim()
    : '';
  return { ...entry, meta, instructions };
}

export function loadAllSkills() {
  return findSkillEntries().map(loadSkill);
}

// ---------------------------------------------------------------------------
// small string helpers
// ---------------------------------------------------------------------------

export const singleLine = (s = '') => String(s).replace(/\s+/g, ' ').trim();
export const snake = (s = '') => String(s).replace(/-/g, '_');

/** Collect params by location, tolerating a missing `parameters` array. */
export function paramsByLocation(op, location) {
  return (op.parameters ?? []).filter((p) => p.in === location);
}

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import yaml from 'js-yaml';

export const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
export const SKILLS_DIR = path.join(ROOT, 'skills');
export const DIST_DIR = path.join(ROOT, 'dist');

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

// ---------------------------------------------------------------------------
// filesystem helpers
// ---------------------------------------------------------------------------

export function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents.endsWith('\n') ? contents : `${contents}\n`);
}

export function copyDir(from, to) {
  if (!fs.existsSync(from)) {
    return;
  }
  fs.mkdirSync(to, { recursive: true });
  for (const item of fs.readdirSync(from)) {
    const src = path.join(from, item);
    const dst = path.join(to, item);
    if (fs.statSync(src).isDirectory()) {
      copyDir(src, dst);
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

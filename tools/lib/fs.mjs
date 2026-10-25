// Dependency-free paths and filesystem helpers.
//
// tools/install.mjs imports from here (never from ./skills.mjs, which needs js-yaml), so the
// documented `git clone … && node tools/install.mjs …` works on a fresh clone with no `npm ci`.
// Keep this file to node: built-ins only.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

export const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
export const SKILLS_DIR = path.join(ROOT, 'skills');
export const DIST_DIR = path.join(ROOT, 'dist');

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

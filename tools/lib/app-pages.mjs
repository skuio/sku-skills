// The SKU.io web app's page routes, and matching the page links a skill hands back against them.
//
// The app (frontend-vue-3) uses file-based routing: every `src/pages/**.vue` file outside a
// `components/` or `widgets/` folder is a page, served under the `/v2` base. The route list is
// generated from that tree into `tools/data/app-pages.json` by `npm run sync:app-pages` and
// committed, so `npm run validate` can check every link with no app checkout (CI has none).
//
// Why this exists: a skill that names no link leaves the agent to build one by analogy with the
// API path, and the app's routes do not follow the API. `POST /api/inventory-adjustments` lives
// at `/v2/inventory/inventory-adjustments/{id}`; an agent recording a demo built
// `/v2/inventory/adjustments/{id}` and handed back a 404 (2026-11-11).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './fs.mjs';

export const APP_PAGES_FILE = path.join(ROOT, 'tools', 'data', 'app-pages.json');
const EXCLUDED_DIRS = new Set(['components', 'widgets', '__tests__']);

/**
 * `src/pages`-relative `.vue` file → route path, following unplugin-vue-router's rules:
 * `index` is the empty segment (also as a folder, where it holds nested child pages), `[id]` is a
 * param, `[...all]` a catch-all, `(group)` folders add no segment, and dots in a file name nest.
 * Returns null for files that are not pages.
 */
export function routeForPageFile(rel) {
  if (!rel.endsWith('.vue')) return null;
  const parts = rel.slice(0, -4).split('/');
  if (parts.slice(0, -1).some((d) => EXCLUDED_DIRS.has(d))) return null;
  const file = parts.pop();
  const segments = [...parts, ...file.split('.')]
    .filter((s) => !/^\(.*\)$/.test(s))
    .filter((s) => s !== 'index')
    .map((s) => s
      .replace(/^\[\.\.\.(\w+)\]$/, ':$1(.*)*')
      .replace(/^\[\[(\w+)\]\]$/, ':$1?')
      .replace(/\[(\w+)\]/g, ':$1'));
  return `/${segments.join('/')}`;
}

export function loadAppPages() {
  if (!fs.existsSync(APP_PAGES_FILE)) return null;
  return JSON.parse(fs.readFileSync(APP_PAGES_FILE, 'utf8'));
}

const isParam = (seg) => seg.startsWith(':');
const isCatchAll = (seg) => /^:\w+\(\.\*\)\*$/.test(seg);
const isOptional = (seg) => /^:\w+\?$/.test(seg);
/** `{id}`, `{bill id}`, `<hash>`, `*` — a link placeholder for a value the agent substitutes. */
const isPlaceholder = (seg) => /^(\{[^}]*\}|<[^>]*>|\*)$/.test(seg);

function segmentsMatch(linkSeg, routeSeg) {
  if (isParam(routeSeg)) return true; // a param takes a placeholder or a literal value
  if (isPlaceholder(linkSeg)) return false; // a placeholder never stands for a fixed word
  return linkSeg === routeSeg;
}

/** Does `route` serve the whole of `link`? */
function routeServes(route, linkSegs) {
  const routeSegs = route.split('/').filter(Boolean);
  for (let i = 0; i < routeSegs.length; i++) {
    if (isCatchAll(routeSegs[i])) return true;
    if (i >= linkSegs.length) return routeSegs.slice(i).every(isOptional);
    if (!segmentsMatch(linkSegs[i], routeSegs[i])) return false;
  }
  return routeSegs.length === linkSegs.length;
}

/** Does `route` sit at or under the prefix `linkSegs` (a `pages:` entry)? */
function routeUnder(route, linkSegs) {
  const routeSegs = route.split('/').filter(Boolean);
  if (routeSegs.length < linkSegs.length) return false;
  return linkSegs.every((seg, i) => seg === '*' || segmentsMatch(seg, routeSegs[i]));
}

const splitPath = (p) => p.split('/').filter(Boolean);

/** A page link, written without the `/v2` base and without its query string. */
export function linkResolves(pages, link) {
  const segs = splitPath(link);
  return pages.routes.some((r) => routeServes(r, segs));
}

/** A skill's `pages:` entry: a prefix (or `$`-anchored exact) pattern, `*` for one segment. */
export function pagesEntryResolves(pages, entry) {
  const exact = entry.endsWith('$');
  const segs = splitPath(exact ? entry.slice(0, -1) : entry);
  return pages.routes.some((r) =>
    exact ? routeServes(r, segs.map((s) => (s === '*' ? '{x}' : s))) : routeUnder(r, segs));
}

/** The closest real routes to a dead link, for the error message. */
export function nearestRoutes(pages, link, n = 3) {
  const segs = splitPath(link);
  const score = (route) => {
    const r = splitPath(route);
    let shared = 0;
    for (const s of segs) if (r.includes(s) || r.some((x) => x.includes(s) || s.includes(x))) shared++;
    return shared - Math.abs(r.length - segs.length) * 0.5;
  };
  const sameRoot = pages.routes.filter((r) => splitPath(r)[0] === segs[0]);
  return [...(sameRoot.length ? sameRoot : pages.routes)]
    .sort((a, b) => score(b) - score(a))
    .slice(0, n);
}

/**
 * Every in-app page link in a piece of text: `https://{tenant}.sku.io/v2/…`, `{tenant}.sku.io/v2/…`
 * or a bare `/v2/…` path. API paths (`/api/v2/…`) are not page links, nor is `/v2` glued to any
 * other word. Templated links (`/v2{lanes.manual}`) have no `/` after `v2` and are skipped.
 */
export function pageLinksIn(text) {
  const links = [];
  const re = /\/v2((?:\/(?:\{[^}\n]*\}|[A-Za-z0-9_\-.:<>*])+)+)/g;
  for (const m of text.matchAll(re)) {
    const before = text.slice(0, m.index);
    if (/\w$/.test(before) && !/\.sku\.io$/.test(before)) continue; // /api/v2/…, foo/v2/…
    let p = m[1].replace(/[.:]+$/, '');
    if (p.endsWith('/')) p = p.slice(0, -1);
    // `/v2/{page}?view=…` describes a family of links, not one page; nothing to check.
    if (p && !isPlaceholder(p.split('/')[1])) links.push(p);
  }
  return links;
}

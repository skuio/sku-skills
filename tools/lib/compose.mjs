// Which skills have to be installed together. Built-ins only: tools/install.mjs runs on a fresh
// clone with no `npm ci`.

// Every skill's generated "Step 0 — Connect first" sends the agent here when there is no verified
// token, so it ships with whatever else is installed rather than being a dead reference.
export const ALWAYS = 'connect-to-sku';

/**
 * Walk `composes` transitively, so installing one skill brings the flow it depends on.
 * `onUnknown(name)` is called for a name the catalog does not have, and must throw or exit.
 */
export function withComposed(names, byName, { followDeps = true, onUnknown } = {}) {
  const out = new Map();
  const queue = [...names, ALWAYS];
  while (queue.length) {
    const name = queue.shift();
    if (out.has(name)) {
      continue;
    }
    const skill = byName.get(name);
    if (!skill) {
      onUnknown(name);
      continue;
    }
    out.set(name, skill);
    if (followDeps) {
      queue.push(...(skill.composes ?? []));
    }
  }
  return [...out.values()];
}

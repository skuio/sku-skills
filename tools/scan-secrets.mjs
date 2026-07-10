#!/usr/bin/env node
// Scan tracked files for secrets and internal-ops data before they can land in the public repo.
// Two layers:
//   1. Always-on pattern rules (no config) — run everywhere, including untrusted fork PRs where
//      repo secrets are unavailable: PAT shapes, private keys, cloud keys, non-allowlisted *.sku.io
//      subdomains (i.e. leaked tenant hostnames).
//   2. A denylist rule gated on the SECRET_DENYLIST env var (wired to a repo secret in CI) — exact
//      tenant slugs, server IPs, and SSH aliases that must never appear in the public tree.
// Exit non-zero on any finding. Matched text is redacted in output so CI logs don't leak.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const SELF = 'tools/scan-secrets.mjs';
// Files that legitimately contain pattern-like strings or are noise to scan.
const SKIP_FILES = new Set([SELF, 'package-lock.json']);
const MAX_BYTES = 512 * 1024;

// Subdomains of sku.io that are public/expected and must NOT be flagged.
const ALLOWED_SUBDOMAINS = new Set([
  'developer', 'www', 'app', 'docs', 'api', 'status', 'blog', 'acme', 'tenant',
]);

const findings = [];
const record = (file, line, rule, note) => findings.push({ file, line, rule, note });

function trackedFiles() {
  try {
    return execSync('git ls-files', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      .split('\n')
      .filter(Boolean);
  } catch {
    console.error('scan-secrets: not a git repo or git unavailable.');
    process.exit(1);
  }
}

// Redact so the scan output itself never becomes the leak.
const mask = (s) => (s.length <= 4 ? '*'.repeat(s.length) : `${s.slice(0, 3)}${'*'.repeat(Math.min(s.length - 3, 8))}`);

function buildDenylist() {
  const raw = process.env.SECRET_DENYLIST || '';
  const terms = raw
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith('#'));
  const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return terms.map((t) => ({ term: t, re: new RegExp(`(?<![\\w.-])${escape(t)}(?![\\w.-])`, 'i') }));
}

const PAT = /sku_pat_([A-Za-z0-9]{8,})/;
// Documented placeholders that are safe to ship in examples (e.g. sku_pat_xxxxxxxx).
const PAT_PLACEHOLDER = /^(x+|(.)\2{3,}|replace.*|your.*|example.*|sample.*|dummy.*|changeme|redacted|placeholder)$/i;
const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const AWS_KEY = /\bAKIA[0-9A-Z]{16}\b/;
// Capture the full (possibly multi-level) subdomain, e.g. `beta.rouge` in beta.rouge.sku.io.
const SKU_HOST = /([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)\.sku\.io\b/gi;

const denylist = buildDenylist();

for (const file of trackedFiles()) {
  if (SKIP_FILES.has(file)) continue;
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    continue;
  }
  if (buf.length > MAX_BYTES || buf.includes(0)) continue; // skip huge / binary files
  const text = buf.toString('utf8');
  const lines = text.split('\n');

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw;

    const pat = line.match(PAT);
    if (pat && !PAT_PLACEHOLDER.test(pat[1])) record(file, lineNo, 'sku-pat', mask(pat[0]));

    if (PRIVATE_KEY.test(line)) record(file, lineNo, 'private-key', '(private key block)');

    const aws = line.match(AWS_KEY);
    if (aws) record(file, lineNo, 'aws-access-key', mask(aws[0]));

    for (const m of line.matchAll(SKU_HOST)) {
      const sub = m[1].toLowerCase();
      const before = line[m.index - 1];
      if (before === '{' || before === '$' || before === '_') continue; // {tenant}, $SKU_TENANT placeholders
      // Multi-level hosts (beta.rouge.sku.io) are never public — always flag. Single labels: allowlist.
      if (!sub.includes('.') && ALLOWED_SUBDOMAINS.has(sub)) continue;
      record(file, lineNo, 'sku-subdomain', `${mask(sub)}.sku.io`);
    }

    for (const { re } of denylist) {
      if (re.test(line)) record(file, lineNo, 'tenant-data', '(redacted)');
    }
  });
}

if (findings.length) {
  console.error(`✗ scan-secrets: ${findings.length} finding(s) — remove before committing:\n`);
  for (const f of findings) {
    console.error(`  - ${f.file}:${f.line} [${f.rule}] ${f.note}`);
  }
  console.error('\nIf a match is a false positive, adjust the rule/allowlist in tools/scan-secrets.mjs.');
  process.exit(1);
}

if (!denylist.length) {
  console.log('✓ scan-secrets: no secrets found (SECRET_DENYLIST not set — tenant denylist layer skipped).');
} else {
  console.log(`✓ scan-secrets: no secrets or tenant data found (denylist: ${denylist.length} term(s)).`);
}

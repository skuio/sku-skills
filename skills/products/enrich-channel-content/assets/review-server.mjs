#!/usr/bin/env node
/**
 * Serve an enrichment review report AND apply its approvals with the skill's
 * own credential — so the reviewer never handles a token.
 *
 *   SKU_TENANT=siber SKU_PAT=… node review-server.mjs review.html [--port 8080]
 *
 * The page is served on http://localhost:<port>/ (an origin the SKU.io API
 * accepts). The page probes GET /session; when it answers, the page hides its
 * token box and sends approvals to POST /apply, which writes each family's
 * proposed attributes to every member product with SKU_PAT from this process.
 * The token stays in this process: it is never written into the HTML, never
 * sent to the browser, never logged.
 *
 * Bind is loopback only. The only mutation is PUT /api/products/{id}/attributes
 * for the attributes the page proposed — the same call the reviewer would have
 * made by hand in Step 4 of INSTRUCTIONS.md.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const port = Number((args[args.indexOf('--port') + 1] || 0)) || 8080;
const tenant = process.env.SKU_TENANT;
const pat = process.env.SKU_PAT;
if (!file || !tenant || !pat) {
  console.error('usage: SKU_TENANT=… SKU_PAT=… node review-server.mjs review.html [--port 8080]');
  process.exit(1);
}
const html = path.resolve(file);
const dir = path.dirname(html);
const base = `https://${tenant}.sku.io`;

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

async function putAttributes(productId, attributes) {
  const r = await fetch(`${base}/api/products/${productId}/attributes`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'sku-skills/enrich-channel-content review-server' },
    body: JSON.stringify({ attributes }),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (req.method === 'GET' && url.pathname === '/session') return json(res, 200, { served: true, tenant });
  if (req.method === 'POST' && url.pathname === '/apply') {
    let body = ''; for await (const chunk of req) body += chunk;
    let families;
    try { families = JSON.parse(body).families; } catch { return json(res, 400, { error: 'bad json' }); }
    if (!Array.isArray(families)) return json(res, 400, { error: 'families[] required' });
    const results = [];
    for (const f of families) {
      const attributes = (f.attributes || []).filter((a) => a && a.name && typeof a.value === 'string' && a.value.trim() !== '');
      if (!attributes.length) { results.push({ key: f.key, written: 0, failed: 0, skipped: true }); continue; }
      let written = 0, failed = 0;
      for (const id of f.product_ids || []) {
        try { await putAttributes(id, attributes); written++; } catch (e) { failed++; console.error(`PUT product ${id}: ${e.message}`); }
      }
      results.push({ key: f.key, written, failed });
      console.log(`family ${f.key}: ${attributes.map((a) => a.name).join('+')} → ${written} written, ${failed} failed`);
    }
    return json(res, 200, { results });
  }
  // Static: the report at / and anything beside it (images, other reports).
  const rel = url.pathname === '/' ? path.basename(html) : decodeURIComponent(url.pathname.slice(1));
  const target = path.resolve(dir, rel);
  if (!target.startsWith(dir + path.sep) && target !== html) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const type = target.endsWith('.html') ? 'text/html; charset=utf-8' : target.endsWith('.json') ? 'application/json' : target.endsWith('.png') ? 'image/png' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(target).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`review: http://localhost:${port}/  (tenant ${tenant}; approvals apply with this process's token)`);
});

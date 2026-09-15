#!/usr/bin/env node
/**
 * gather-and-generate.mjs — Steps 1–2 of the enrich-channel-content skill, end to end.
 *
 *   SKU_TENANT=acme SKU_PAT='105|…' node gather-and-generate.mjs \
 *     --brand "Charlie Banana" --channel 30 --attribute tiktokshop_description \
 *     [--brand-id 16] [--limit 5] [--regenerate] [--tone professional] --out proposals.json
 *
 * For every family in the brand (a parent and its variants, or a standalone
 * product) it walks the fallback ladder — own attributes → Amazon catalog copy
 * → eBay raw Description — and asks SKU.io's AI for one description per family
 * with everything gathered passed as source_material. Families with nothing to
 * draw on get a drafted supplier email instead of a proposal. Nothing is
 * written; the output feeds build-review-report.mjs.
 *
 * Manufacturer-site research (rung 3) is deliberately not automated here: it
 * needs judgement about which page is the manufacturer's. The agent does it
 * for the families this script reports as `needs_research`, and adds the
 * result as a source before generating.
 */
import fs from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const tenant = process.env.SKU_TENANT;
const pat = process.env.SKU_PAT;
if (!tenant || !pat || !args.brand || !args.channel || !args.attribute) {
  console.error('usage: SKU_TENANT=… SKU_PAT=… node gather-and-generate.mjs --brand "…" --channel <id> --attribute <name> [--limit N] [--regenerate] [--tone t] --out proposals.json');
  process.exit(1);
}
const base = `https://${tenant}.sku.io`;
const out = args.out || 'proposals.json';
const limit = args.limit ? Number(args.limit) : Infinity;
const tone = args.tone || 'professional';

async function api(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) { const err = new Error(`${method} ${path} → ${r.status} ${json?.message || text.slice(0, 200)}`); err.status = r.status; err.body = json; throw err; }
  return json;
}
const strip = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const log = (...m) => console.error(...m);

// ── channel + attribute ────────────────────────────────────────────────────
const channels = (await api('GET', '/api/v2/listing-publishing/channels')).data || [];
const channel = channels.find((c) => String(c.id) === String(args.channel));
if (!channel) { console.error(`channel ${args.channel} is not publishable; known: ${channels.map((c) => c.id + '=' + c.name).join(', ')}`); process.exit(1); }
log(`channel: ${channel.name} (#${channel.id})`);

// ── brand → id, then products in scope, grouped into families ──────────────
// The products index filters by brand ID, and the brands index has no name
// search — so list brands (there are never many) and match the name here.
let brandId = args['brand-id'] ? Number(args['brand-id']) : null;
if (!brandId) {
  const want = String(args.brand).trim().toLowerCase();
  for (let page = 1; ; page++) {
    const res = await api('GET', `/api/v2/brands?per_page=100&page=${page}`);
    const hit = (res.data || []).find((b) => String(b.name || '').trim().toLowerCase() === want);
    if (hit) { brandId = hit.id; break; }
    if ((res.current_page ?? page) >= (res.last_page ?? page)) break;
  }
  if (!brandId) { console.error(`brand "${args.brand}" not found — pass --brand-id <id> if the name differs`); process.exit(1); }
}
log(`brand: ${args.brand} (#${brandId})`);
const products = [];
for (let page = 1; ; page++) {
  const res = await api('GET', `/api/v2/products?filter[brand_id]=${brandId}&per_page=100&page=${page}`);
  products.push(...(res.data || []));
  if ((res.current_page ?? page) >= (res.last_page ?? page)) break;
}
log(`products in brand "${args.brand}": ${products.length}`);
const byId = new Map(products.map((p) => [p.id, p]));
const families = new Map();
for (const p of products) {
  const rootId = p.parent_id && byId.has(p.parent_id) ? p.parent_id : p.id;
  if (!families.has(rootId)) families.set(rootId, { parentId: rootId, members: [] });
  families.get(rootId).members.push(p);
}
log(`families: ${families.size}`);

// ── per family ─────────────────────────────────────────────────────────────
const result = {
  tenant, channel: { id: channel.id, name: channel.name },
  attribute: { name: args.attribute, is_html: true },
  brand: args.brand, generated_at: new Date().toISOString(), families: [],
};
let n = 0;
for (const fam of families.values()) {
  if (n++ >= limit) break;
  const parent = byId.get(fam.parentId) || fam.members[0];
  const members = [parent, ...fam.members.filter((m) => m.id !== parent.id)].filter(Boolean);
  const entry = {
    key: String(parent.id),
    parent: { id: parent.id, sku: parent.sku, name: parent.name, image_url: null },
    members: members.map((m) => ({ id: m.id, sku: m.sku })),
    sources: [], proposal: null, already_enriched: false, supplier_email: null, needs_research: false,
  };
  result.families.push(entry);
  log(`\n[${parent.sku}] ${parent.name} — ${members.length} product(s)`);

  // Image: parent first, else the first member that has one.
  for (const m of members) {
    const full = await api('GET', `/api/v2/products/${m.id}`).then((r) => r.data || r).catch(() => null);
    const img = full?.image_url || full?.image || (full?.other_images || [])[0];
    if (img) { entry.parent.image_url = img; break; }
  }

  // Rung 1 — own attributes. Also decides "already enriched".
  const attrs = await api('GET', `/api/products/${parent.id}/attributes`).then((r) => r.data || r).catch(() => []);
  const attrList = Array.isArray(attrs) ? attrs : Object.values(attrs || {});
  for (const a of attrList) {
    const name = a.name || a.attribute?.name; const value = a.value ?? a.pivot?.value;
    if (!name || value == null || String(value).trim() === '') continue;
    if (name === args.attribute) { entry.already_enriched = !args.regenerate; continue; }
    if (/description/i.test(name)) entry.sources.push({ label: `Product attribute: ${name}`, text: strip(value), url: null });
  }
  if (entry.already_enriched) { log('  already enriched — skipped'); continue; }

  // Rung 2 — copy live on another channel. Try every member until Amazon/eBay copy is found.
  outer: for (const m of members) {
    const listings = await api('GET', `/api/v2/products/${m.id}/listings`).then((r) => r.data || []).catch(() => []);
    for (const l of listings) {
      const integ = String(l.integration?.name || '').toLowerCase();
      if (integ === 'amazon' && l.document_id) {
        const cp = await api('GET', `/api/amazon/${l.integration_instance_id}/products/${l.document_id}?included=${encodeURIComponent('["catalog_data"]')}`).then((r) => r.data || r).catch(() => null);
        const a = cp?.catalog_data?.attributes || {};
        const desc = a.product_description?.[0]?.value; const bullets = (a.bullet_point || []).map((b) => b.value).filter(Boolean);
        const title = a.item_name?.[0]?.value;
        if (desc) entry.sources.push({ label: `Amazon listing (${l.sales_channel})${m.id !== parent.id ? ' — ' + m.sku : ''}`, text: strip(desc), url: l.listing_sku?.url || null });
        if (bullets.length) entry.sources.push({ label: 'Amazon bullets', text: bullets.map((b) => '• ' + strip(b)).join('\n'), url: null });
        if (title) entry.sources.push({ label: 'Amazon title', text: strip(title), url: null });
        if (desc || bullets.length) break outer;
      }
      if (integ === 'ebay' && l.document_id) {
        const raw = await api('GET', `/api/ebay/${l.integration_instance_id}/products/${l.document_id}/raw`).then((r) => r.data || r).catch(() => null);
        // The raw endpoint wraps the item as {data: {product: …}}; the item's
        // Description sits either directly on it or under Item, depending on
        // the connector's response DTO.
        const item = raw?.product?.Item || raw?.product || raw?.Item || raw;
        const d = item?.Description;
        if (d) { entry.sources.push({ label: `eBay listing (${l.sales_channel})`, text: strip(d).slice(0, 8000), url: l.listing_sku?.url || null }); break outer; }
      }
    }
  }

  if (entry.sources.length === 0) {
    entry.needs_research = true;
    log('  no copy anywhere → needs manufacturer research / supplier email');
    const supplierId = parent.default_supplier?.id || products.find((p) => p.default_supplier?.id)?.default_supplier?.id;
    const supplier = supplierId ? await api('GET', `/api/v2/suppliers/${supplierId}`).then((r) => r.data || r).catch(() => null) : null;
    if (supplier) {
      entry.supplier_email = {
        to: supplier.purchase_order_email || supplier.email || '',
        subject: `Product content needed for ${members.length} ${args.brand} SKU${members.length === 1 ? '' : 's'}`,
        body: `Hi ${supplier.primary_contact_name || 'there'},\n\nWe're listing the following ${args.brand} products on ${channel.name} and don't have product content for them yet:\n\n${members.map((x) => `  - ${x.sku} — ${x.name}`).join('\n')}\n\nCould you send, for each: a short description (2–4 sentences), 3–5 key features/benefits, materials, dimensions and weight, care instructions, and what's included in the box? Existing marketing copy or a spec sheet is perfect.\n\nThanks,\n`,
      };
    }
    continue;
  }

  // Rung generate — one call per family.
  try {
    const res = await api('POST', '/api/ai/listing-content', {
      product_id: parent.id, sales_channel_id: channel.id, fields: ['description'],
      source_material: entry.sources.slice(0, 10).map((s) => ({ label: s.label.slice(0, 80), text: s.text.slice(0, 8000) })),
      tone,
    });
    const c = res?.data?.content || {};
    if (c.description) { entry.proposal = { description: c.description, rationale: c.rationale || '' }; log(`  proposal: ${c.description.length} chars (${res.data.provider})`); }
    else log('  generation returned no description');
  } catch (e) {
    log(`  generation failed: ${e.message}`);
    if (e.status === 422 && /disabled|not configured/i.test(e.message)) { console.error('AI listing content is not enabled on this tenant — stopping.'); break; }
  }
}

fs.writeFileSync(out, JSON.stringify(result, null, 2));
const stats = {
  families: result.families.length,
  proposals: result.families.filter((f) => f.proposal).length,
  already_enriched: result.families.filter((f) => f.already_enriched).length,
  needs_research: result.families.filter((f) => f.needs_research).length,
};
log(`\nwrote ${out}`, JSON.stringify(stats));

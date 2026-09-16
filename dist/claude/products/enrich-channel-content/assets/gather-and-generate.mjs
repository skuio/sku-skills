#!/usr/bin/env node
/**
 * gather-and-generate.mjs — Steps 1–2 of the enrich-channel-content skill, end to end.
 *
 *   SKU_TENANT=acme SKU_PAT='105|…' node gather-and-generate.mjs \
 *     --brand "Acme Baby" --channel 30 --attribute tiktokshop_description \
 *     [--fields title,description --title-attribute tiktokshop_title] [--brand-id 16] [--limit 5] [--only 1864,1865 --merge-into prior.json] [--regenerate] [--tone professional] [--instructions "…"] --out proposals.json
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
// --only 1864,1865 re-runs just those families (parent product ids) — for a
// second pass after manufacturer research, without paying for the rest again.
const only = args.only ? new Set(String(args.only).split(',').map((x) => x.trim())) : null;
// --merge-into proposals.json: start from an earlier run — its families are sibling
// candidates for rung 2b, and the re-run's entries replace theirs by key in --out.
const prior = args['merge-into'] ? JSON.parse(fs.readFileSync(args['merge-into'], 'utf8')).families || [] : [];
const tone = args.tone || 'professional';
// --instructions "…" → additional_instructions (the endpoint caps it at 500 chars):
// the merchant's steer, e.g. a channel's title rules, "British spelling".
const instructions = args.instructions ? String(args.instructions).slice(0, 500) : null;
// --fields title,description (default: description). Titles need their own
// attribute: --title-attribute tiktokshop_title. Each requested field is judged
// "already enriched" against its own attribute.
const fields = String(args.fields || 'description').split(',').map((x) => x.trim()).filter(Boolean);
const titleAttribute = args['title-attribute'] || null;
if (fields.includes('title') && !titleAttribute) { console.error('--fields title needs --title-attribute <name>'); process.exit(1); }
const attributeFor = (field) => (field === 'title' ? titleAttribute : args.attribute);

// A distinctive User-Agent: the pod's access log attributes every caller by UA
// first, and Node's default ("node") says nothing about who is calling.
const USER_AGENT = 'sku-skills/enrich-channel-content (gather-and-generate.mjs)';

async function api(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json', 'User-Agent': USER_AGENT, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) { const err = new Error(`${method} ${path} → ${r.status} ${json?.message || text.slice(0, 200)}`); err.status = r.status; err.body = json; throw err; }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// POST /api/ai/listing-content queues the generation and answers 202 with a
// tracked job id (the model call is 10-20s, so it runs off the web worker);
// poll GET /api/ai/listing-content/{id} until it settles. An older build
// answers 200 with the content inline — accept both, and hand back the same
// { data: { content, provider, tokens, rufus_optimized } } shape either way.
async function generateListingContent(body) {
  const res = await api('POST', '/api/ai/listing-content', body);
  if (res?.data?.content) return res;
  const id = res?.data?.id;
  if (!id) throw new Error(`listing-content: unexpected response ${JSON.stringify(res).slice(0, 200)}`);
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await sleep(1500);
    const job = (await api('GET', `/api/ai/listing-content/${id}`))?.data || {};
    if (job.status === 'completed') return { data: { content: job.content || {}, provider: job.provider, tokens: job.tokens, rufus_optimized: job.rufus_optimized } };
    if (job.status === 'failed' || job.status === 'cancelled') throw new Error(`listing-content job ${id} ${job.status}: ${job.error || 'no reason given'}`);
  }
  throw new Error(`listing-content job ${id} did not finish within 150s`);
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
  title_attribute: titleAttribute ? { name: titleAttribute } : null,
  fields,
  brand: args.brand, generated_at: new Date().toISOString(), families: [],
};
let n = 0;
for (const fam of families.values()) {
  if (only && !only.has(String(fam.parentId))) continue;
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

  // Image: parent first, else the first member that has one. The full parent
  // is kept — the index rows do not carry default_supplier, the full product does.
  let fullParent = null;
  for (const m of members) {
    const full = await api('GET', `/api/v2/products/${m.id}`).then((r) => r.data || r).catch(() => null);
    if (m.id === parent.id) fullParent = full;
    let img = full?.image_url || full?.image || (full?.other_images || [])[0];
    // Tenant-relative storage paths (/storage/images/…) cannot load from the
    // report's own origin — anchor them to the tenant.
    if (img && String(img).startsWith('/')) img = base + img;
    if (img) { entry.parent.image_url = img; if (fullParent) break; }
  }

  // Rung 1 — own attributes. Also decides "already enriched". The grouped
  // endpoint is the one that carries values: the legacy /attributes renders
  // every row as nulls (seen 2026-09-15 on a live tenant), which made this rung blind and
  // "already enriched" impossible to detect.
  const grouped = await api('GET', `/api/products/${parent.id}/attributes-grouped`).then((r) => r.data || r).catch(() => ({}));
  const attrList = [
    ...(Array.isArray(grouped?.direct) ? grouped.direct : []),
    ...((Array.isArray(grouped?.groups) ? grouped.groups : []).flatMap((g) => g?.attributes || g?.items || [])),
  ];
  for (const a of attrList) {
    const name = a.name || a.attribute?.name; const value = a.value ?? a.pivot?.value;
    if (!name || value == null || String(value).trim() === '') continue;
    if (fields.map(attributeFor).includes(name)) { entry.filled = entry.filled || {}; entry.filled[name] = true; continue; }
    if (/description/i.test(name)) entry.sources.push({ label: `Product attribute: ${name}`, text: strip(value), url: null });
  }
  const missing = fields.filter((f) => !(entry.filled && entry.filled[attributeFor(f)]));
  entry.already_enriched = !args.regenerate && missing.length === 0;
  entry.fields = args.regenerate ? fields : missing;
  if (entry.already_enriched) { log('  already enriched — skipped'); continue; }

  // Rung 2 — copy live on another channel. The product-scoped listings list
  // carries the channel and integration NAMES; the ids needed to fetch the
  // channel's own copy (integration instance + channel-product id) come from
  // the canonical listing resource, one GET per candidate row.
  outer: for (const m of members) {
    const listings = await api('GET', `/api/v2/products/${m.id}/listings`).then((r) => r.data || []).catch(() => []);
    for (const l of listings) {
      const integ = String(l.integration_name || l.integration?.name || '').toLowerCase();
      if (integ !== 'amazon' && integ !== 'ebay') continue;
      const full = await api('GET', `/api/v2/product-listings/${l.id}`).then((r) => r.data || r).catch(() => null);
      const inst = full?.integration_instance_id; const doc = full?.document_id;
      if (!inst || !doc) continue;
      const channelName = l.channel_name || l.sales_channel || integ;
      if (integ === 'amazon') {
        const cp = await api('GET', `/api/amazon/${inst}/products/${doc}?included=${encodeURIComponent('["catalog_data"]')}`).then((r) => r.data || r).catch((e) => { log(`  amazon fetch failed: ${e.message}`); return null; });
        let cd = cp?.catalog_data; if (typeof cd === 'string') { try { cd = JSON.parse(cd); } catch { cd = null; } }
        const a = cd?.attributes || {};
        // Amazon's MAIN image is public (m.media-amazon.com); a tenant-relative
        // /storage image redirects to login for anyone but a signed-in browser
        // tab, so it cannot show in a report served from localhost.
        const amzImg = (cd?.images || []).flatMap((g) => g.images || []).find((i) => i.variant === 'MAIN')?.link;
        if (amzImg && !entry.parent.channel_image_url) entry.parent.channel_image_url = amzImg;
        const desc = a.product_description?.[0]?.value; const bullets = (a.bullet_point || []).map((b) => b.value).filter(Boolean);
        const title = a.item_name?.[0]?.value;
        if (desc) entry.sources.push({ label: `Amazon listing (${channelName})${m.id !== parent.id ? ' — ' + m.sku : ''}`, text: strip(desc), url: l.listing_url || null });
        if (bullets.length) entry.sources.push({ label: 'Amazon bullets', text: bullets.map((b) => '• ' + strip(b)).join('\n'), url: null });
        if (title) entry.sources.push({ label: 'Amazon title', text: strip(title), url: null });
        if (desc || bullets.length) break outer;
      }
      if (integ === 'ebay') {
        const raw = await api('GET', `/api/ebay/${inst}/products/${doc}/raw`).then((r) => r.data || r).catch((e) => { log(`  ebay fetch failed: ${e.message}`); return null; });
        // The raw endpoint wraps the item as {data: {product: …}}; the item's
        // Description sits either directly on it or under Item, depending on
        // the connector's response DTO.
        const item = raw?.product?.Item || raw?.product || raw?.Item || raw;
        const d = item?.Description;
        if (d) { entry.sources.push({ label: `eBay listing (${channelName})`, text: strip(d).slice(0, 8000), url: l.listing_url || null }); break outer; }
      }
    }
  }

  // Rung 2b — a standalone colour/size variant with no listing of its own.
  // Some catalogues model "Change Pad Yellow" and "Change Pad Leaf" as
  // separate products, and only some colours are on Amazon. If a sibling in
  // the same brand shares the name minus its last token(s) and HAS copy, borrow
  // it, labelled as the sibling's — same product, different colour.
  if (entry.sources.length === 0 && members.length === 1) {
    const base = (name) => String(name || '').replace(/\s*[-–—]\s*/g, ' ').trim().toLowerCase();
    const stem = (name) => { const w = base(name).split(/\s+/); return w.length > 2 ? w.slice(0, -1).join(' ') : null; };
    const mine = stem(parent.name);
    const candidates = [...prior, ...result.families];
    const sibling = mine && candidates.find((f) => f.key !== entry.key && (f.sources || []).length > 0 && (stem(f.parent.name) === mine || base(f.parent.name).startsWith(mine)));
    if (sibling) {
      log(`  no listing of its own — borrowing sources from sibling ${sibling.parent.sku} (${sibling.parent.name})`);
      for (const src of sibling.sources) entry.sources.push({ ...src, label: `Sibling ${sibling.parent.sku}: ${src.label}` });
    }
  }

  if (entry.parent.channel_image_url && (!entry.parent.image_url || /\/storage\//.test(String(entry.parent.image_url)))) {
    entry.parent.image_url = entry.parent.channel_image_url;
  }

  if (entry.sources.length === 0) {
    entry.needs_research = true;
    log('  no copy anywhere → needs manufacturer research / supplier email');
    const supplierId = fullParent?.default_supplier?.id || parent.default_supplier?.id || products.find((p) => p.default_supplier?.id)?.default_supplier?.id;
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
    const body = {
      product_id: parent.id, sales_channel_id: channel.id, fields: entry.fields,
      source_material: entry.sources.slice(0, 10).map((s) => ({ label: s.label.slice(0, 80), text: s.text.slice(0, 8000) })),
      tone,
      ...(instructions ? { additional_instructions: instructions } : {}),
    };
    let res = await generateListingContent(body);
    // A missing rationale usually means the model folded it into the description
    // (reviewer prose that must never reach the channel). One retry is cheap.
    if (entry.fields.includes('description') && res?.data?.content?.description && !res?.data?.content?.rationale) {
      log('  rationale missing — retrying once');
      res = await generateListingContent(body);
    }
    const c = res?.data?.content || {};
    const got = entry.fields.filter((f) => c[f]);
    if (got.length) {
      entry.proposal = { rationale: c.rationale || '' };
      if (c.title) entry.proposal.title = c.title;
      if (c.description) entry.proposal.description = c.description;
      log(`  proposal: ${got.map((f) => `${f} ${String(c[f]).length} chars`).join(', ')} (${res.data.provider})`);
    } else log(`  generation returned none of: ${entry.fields.join(', ')}`);
  } catch (e) {
    log(`  generation failed: ${e.message}`);
    if (e.status === 422 && /disabled|not configured/i.test(e.message)) { console.error('AI listing content is not enabled on this tenant — stopping.'); break; }
  }
}

if (prior.length) {
  const byKey = new Map(result.families.map((f) => [f.key, f]));
  result.families = [...prior.map((f) => byKey.get(f.key) || f), ...result.families.filter((f) => !prior.some((p) => p.key === f.key))];
}
fs.writeFileSync(out, JSON.stringify(result, null, 2));
const stats = {
  families: result.families.length,
  proposals: result.families.filter((f) => f.proposal).length,
  titles: result.families.filter((f) => f.proposal && f.proposal.title).length,
  already_enriched: result.families.filter((f) => f.already_enriched).length,
  needs_research: result.families.filter((f) => f.needs_research).length,
};
log(`\nwrote ${out}`, JSON.stringify(stats));

#!/usr/bin/env node
/**
 * build-review-report.mjs — render an enrichment review report.
 *
 *   node build-review-report.mjs proposals.json review.html
 *
 * proposals.json:
 * {
 *   "tenant": "acme",                       // the SKU.io tenant prefix
 *   "channel": {"id": 30, "name": "TikTok Shop"},
 *   "attribute": {"name": "tiktokshop_description", "is_html": true},
 *   "brand": "Acme Baby",
 *   "generated_at": "2026-09-15T18:00:00Z",
 *   "families": [
 *     {
 *       "key": "7206",                       // stable id for the family (parent product id)
 *       "parent": {"id": 7206, "sku": "CB-SWIM-DIAPER-DRAWSTRING", "name": "…", "image_url": "https://…"},
 *       "members": [{"id": 7206, "sku": "…"}, {"id": 7207, "sku": "…"}],   // parent + variants
 *       "sources": [{"label": "Amazon listing", "text": "…", "url": null}],
 *       "proposal": {"description": "<p>…</p>", "rationale": "…"} | null,
 *       "already_enriched": false,
 *       "supplier_email": {"to": "orders@…", "subject": "…", "body": "…"} | null
 *     }
 *   ]
 * }
 *
 * The output is ONE self-contained HTML file. Serve it from http://localhost:8080 (an origin
 * the SKU.io API accepts) so "Apply approved" can PUT straight to the API with a PAT.
 */
import fs from 'node:fs';
import path from 'node:path';

const [,, input, output = 'review.html'] = process.argv;
if (!input || input === '--help' || input === '-h') {
  console.error('usage: node build-review-report.mjs proposals.json [review.html]');
  process.exit(input ? 0 : 1);
}

const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const families = Array.isArray(data.families) ? data.families : [];
const withProposal = families.filter((f) => f.proposal && f.proposal.description);
const needSupplier = families.filter((f) => !f.proposal && f.supplier_email);
const already = families.filter((f) => f.already_enriched);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Enrichment review — ${esc(data.brand)} → ${esc(data.channel?.name)}</title>
<style>
  :root { --ink:#1f2933; --muted:#616e7c; --line:#e4e7eb; --paper:#fff; --bg:#f5f7fa;
          --ok:#1b8f5a; --warn:#b7791f; --bad:#c0392b; --pri:#2f6fb5; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  header { position:sticky; top:0; z-index:5; background:var(--paper); border-bottom:1px solid var(--line); padding:14px 24px; display:flex; gap:18px; align-items:center; flex-wrap:wrap; }
  header h1 { font-size:18px; margin:0; }
  header .meta { color:var(--muted); font-size:13px; }
  header .spacer { flex:1 }
  .counts { display:flex; gap:10px; font-size:13px; }
  .pill { padding:2px 10px; border-radius:999px; background:#eef2f6; }
  .pill.ok { background:#e3f5ec; color:var(--ok) } .pill.bad { background:#fbe9e7; color:var(--bad) } .pill.warn { background:#fdf3e1; color:var(--warn) }
  main { max-width:1280px; margin:0 auto; padding:20px 24px 80px; }
  .apply { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  input[type=password] { padding:7px 10px; border:1px solid var(--line); border-radius:6px; width:280px; font:inherit; }
  button { font:inherit; padding:7px 14px; border-radius:6px; border:1px solid var(--line); background:var(--paper); cursor:pointer; }
  button.primary { background:var(--pri); color:#fff; border-color:var(--pri); }
  button.ok { border-color:var(--ok); color:var(--ok) } button.ok.on { background:var(--ok); color:#fff }
  button.bad { border-color:var(--bad); color:var(--bad) } button.bad.on { background:var(--bad); color:#fff }
  button:disabled { opacity:.5; cursor:not-allowed }
  .card { background:var(--paper); border:1px solid var(--line); border-radius:10px; margin:18px 0; overflow:hidden; }
  .card.approved { border-color:var(--ok) } .card.rejected { border-color:var(--bad); opacity:.75 }
  .card-head { display:flex; gap:16px; padding:14px 18px; border-bottom:1px solid var(--line); align-items:flex-start; }
  .card-head img { width:96px; height:96px; object-fit:cover; border-radius:8px; border:1px solid var(--line); background:#fafafa; flex:none; }
  .card-head .noimg { width:96px; height:96px; border-radius:8px; border:1px dashed var(--line); display:flex; align-items:center; justify-content:center; color:var(--muted); font-size:12px; flex:none; }
  .card-head h2 { font-size:16px; margin:0 0 4px; }
  .skus { color:var(--muted); font-size:12px; word-break:break-word; }
  .decide { margin-left:auto; display:flex; gap:8px; align-items:center; flex:none; }
  .status { font-size:12px; color:var(--muted); min-width:120px; text-align:right; }
  .cols { display:grid; grid-template-columns: 1fr 1fr; gap:0; }
  @media (max-width: 900px) { .cols { grid-template-columns:1fr } }
  .col { padding:14px 18px; min-width:0; }
  .col + .col { border-left:1px solid var(--line); }
  .col h3 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 8px; }
  details { border:1px solid var(--line); border-radius:6px; margin:6px 0; }
  details summary { padding:6px 10px; cursor:pointer; font-size:13px; }
  details .src { padding:8px 12px; border-top:1px solid var(--line); font-size:13px; white-space:pre-wrap; max-height:260px; overflow:auto; }
  .proposal { border:1px solid var(--line); border-radius:6px; padding:12px 14px; max-height:520px; overflow:auto; }
  .proposal ul { padding-left:20px }
  textarea.edit { width:100%; min-height:260px; font:13px/1.45 ui-monospace, Menlo, monospace; border:1px solid var(--line); border-radius:6px; padding:10px; }
  .rationale { margin-top:12px; padding:10px 12px; background:#f8f5ee; border-left:3px solid #d9c38a; font-size:13px; }
  .rationale b { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#8a6d1f; margin-bottom:4px; }
  .tabs { display:flex; gap:6px; margin-bottom:8px; }
  .tabs button { padding:3px 10px; font-size:12px; }
  .tabs button.on { background:#eef2f6; }
  .email { white-space:pre-wrap; font-size:13px; border:1px solid var(--line); border-radius:6px; padding:12px; }
  .result { font-size:12px; margin-top:6px; }
  .result.ok { color:var(--ok) } .result.bad { color:var(--bad) }
  .chars { color:var(--muted); font-size:12px; }
  footer { color:var(--muted); font-size:12px; margin-top:40px; }
</style>
</head>
<body>
<header>
  <div>
    <h1>Enrichment review — ${esc(data.brand)} → ${esc(data.channel?.name)}</h1>
    <div class="meta">Writes <code>${esc(data.attribute?.name)}</code> on approved families · generated ${esc(data.generated_at || '')} · tenant <code>${esc(data.tenant)}</code></div>
  </div>
  <div class="spacer"></div>
  <div class="counts">
    <span class="pill">${families.length} families</span>
    <span class="pill">${withProposal.length} proposals</span>
    <span class="pill warn">${needSupplier.length} need supplier</span>
    <span class="pill">${already.length} already enriched</span>
    <span class="pill ok" id="c-approved">0 approved</span>
    <span class="pill bad" id="c-rejected">0 rejected</span>
  </div>
</header>
<main>
  <div class="card"><div class="col apply">
    <strong>Apply approved</strong>
    <input type="password" id="pat" placeholder="SKU.io personal access token (products:write)" autocomplete="off">
    <button class="primary" id="apply">Apply approved to ${esc(data.tenant)}.sku.io</button>
    <button id="approve-all">Approve all proposals</button>
    <button id="copy-json">Copy approved as JSON</button>
    <span class="chars" id="apply-note">Serve this file from http://localhost:8080 — the API accepts that origin; file:// is refused.</span>
  </div></div>

  ${families.map((f, i) => renderFamily(f, i)).join('\n')}

  <footer>Decisions are saved in this browser. Nothing is written to SKU.io until you press Apply. Only <code>${esc(data.attribute?.name)}</code> is ever written; names, brands and images are never touched.</footer>
</main>
<script>
const DATA = ${JSON.stringify(data)};
const KEY = 'enrich:' + DATA.tenant + ':' + (DATA.channel && DATA.channel.id) + ':' + (DATA.attribute && DATA.attribute.name);
let state = {};
try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { state = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

function fam(key) { return DATA.families.find((f) => String(f.key) === String(key)); }
function decision(key) { return (state[key] && state[key].decision) || null; }
function text(key) {
  const f = fam(key);
  return (state[key] && typeof state[key].text === 'string') ? state[key].text : ((f && f.proposal && f.proposal.description) || '');
}
function setDecision(key, d) { state[key] = Object.assign({}, state[key], { decision: d }); save(); paint(key); counts(); }
function setText(key, t) { state[key] = Object.assign({}, state[key], { text: t }); save(); }

function paint(key) {
  const card = document.getElementById('f-' + key); if (!card) return;
  const d = decision(key);
  card.classList.toggle('approved', d === 'approve');
  card.classList.toggle('rejected', d === 'reject');
  card.querySelector('.ok') && card.querySelector('.ok').classList.toggle('on', d === 'approve');
  card.querySelector('.bad') && card.querySelector('.bad').classList.toggle('on', d === 'reject');
  const s = card.querySelector('.status'); if (s && !s.dataset.result) s.textContent = d ? (d === 'approve' ? 'Approved' : 'Rejected') : 'Undecided';
}
function counts() {
  const a = DATA.families.filter((f) => decision(f.key) === 'approve').length;
  const r = DATA.families.filter((f) => decision(f.key) === 'reject').length;
  document.getElementById('c-approved').textContent = a + ' approved';
  document.getElementById('c-rejected').textContent = r + ' rejected';
}
function approved() {
  return DATA.families.filter((f) => decision(f.key) === 'approve' && text(f.key).trim() !== '')
    .map((f) => ({ key: f.key, product_ids: (f.members || []).map((m) => m.id), value: text(f.key) }));
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const key = b.dataset.key, act = b.dataset.act;
  if (act === 'approve' || act === 'reject') setDecision(key, decision(key) === act ? null : act);
  if (act === 'tab') {
    const card = document.getElementById('f-' + key);
    card.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    card.querySelector('.view-rendered').hidden = b.dataset.tab !== 'rendered';
    card.querySelector('.view-raw').hidden = b.dataset.tab !== 'raw';
  }
});
document.addEventListener('input', (e) => {
  const t = e.target.closest('textarea.edit'); if (!t) return;
  setText(t.dataset.key, t.value);
  const card = document.getElementById('f-' + t.dataset.key);
  const r = card.querySelector('.view-rendered .proposal'); if (r) r.innerHTML = DATA.attribute && DATA.attribute.is_html ? t.value : escapeHtml(t.value).replace(/\\n/g, '<br>');
  const c = card.querySelector('.chars-n'); if (c) c.textContent = t.value.length + ' chars';
});
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

document.getElementById('approve-all').onclick = () => {
  DATA.families.forEach((f) => { if (f.proposal && f.proposal.description && !f.already_enriched) setDecision(f.key, 'approve'); });
};
document.getElementById('copy-json').onclick = async () => {
  const payload = JSON.stringify({ attribute: DATA.attribute.name, approved: approved() }, null, 2);
  try { await navigator.clipboard.writeText(payload); note('Copied ' + approved().length + ' approved families as JSON.'); }
  catch (e) { prompt('Copy this JSON:', payload); }
};
function note(t, bad) { const n = document.getElementById('apply-note'); n.textContent = t; n.style.color = bad ? 'var(--bad)' : ''; }

document.getElementById('apply').onclick = async () => {
  const pat = document.getElementById('pat').value.trim();
  if (!pat) return note('Enter a personal access token with products:write first.', true);
  const list = approved();
  if (!list.length) return note('Nothing approved yet.', true);
  if (!confirm('Write ' + DATA.attribute.name + ' on ' + list.reduce((n, f) => n + f.product_ids.length, 0) + ' products across ' + list.length + ' families?')) return;
  const base = 'https://' + DATA.tenant + '.sku.io';
  document.getElementById('apply').disabled = true;
  let okN = 0, badN = 0;
  for (const f of list) {
    const card = document.getElementById('f-' + f.key);
    const s = card.querySelector('.status'); s.dataset.result = '1'; s.textContent = 'Writing…';
    let failed = 0;
    for (const id of f.product_ids) {
      try {
        const r = await fetch(base + '/api/products/' + id + '/attributes', {
          method: 'PUT',
          headers: { 'Authorization': 'Bearer ' + pat, 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ attributes: [{ name: DATA.attribute.name, value: f.value }] }),
        });
        if (!r.ok) { failed++; console.error('PUT failed', id, r.status, await r.text()); }
      } catch (e) { failed++; console.error('PUT threw', id, e); }
    }
    if (failed) { badN++; s.textContent = 'Failed on ' + failed + ' of ' + f.product_ids.length; s.style.color = 'var(--bad)'; }
    else { okN++; s.textContent = 'Written to ' + f.product_ids.length + ' product' + (f.product_ids.length === 1 ? '' : 's'); s.style.color = 'var(--ok)'; }
  }
  document.getElementById('apply').disabled = false;
  note(okN + ' families written' + (badN ? ', ' + badN + ' failed (see console). If every call failed, the page is probably not served from http://localhost:8080.' : '.'), badN > 0);
};

DATA.families.forEach((f) => paint(f.key)); counts();
</script>
</body>
</html>`;

function renderFamily(f, i) {
  const p = f.parent || {};
  const members = (f.members || []).map((m) => esc(m.sku)).join(' · ');
  const sources = (f.sources || []).map((s) => `
      <details${(f.sources || []).length <= 2 ? ' open' : ''}>
        <summary>${esc(s.label)}${s.url ? ` — <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>` : ''} <span class="chars">(${String(s.text || '').length} chars)</span></summary>
        <div class="src">${esc(s.text)}</div>
      </details>`).join('');
  const isHtml = !!(data.attribute && data.attribute.is_html);
  const desc = f.proposal?.description || '';
  const rendered = isHtml ? desc : esc(desc).replace(/\n/g, '<br>');

  let right;
  if (f.already_enriched) {
    right = `<h3>Already enriched</h3><p class="chars">This family already has <code>${esc(data.attribute?.name)}</code>. Re-run with regeneration requested to replace it.</p>`;
  } else if (desc) {
    right = `
      <h3>Proposed ${esc(data.channel?.name)} description <span class="chars-n chars">${desc.length} chars</span></h3>
      <div class="tabs">
        <button class="on" data-act="tab" data-tab="rendered" data-key="${esc(f.key)}">As the channel shows it</button>
        <button data-act="tab" data-tab="raw" data-key="${esc(f.key)}">Edit ${isHtml ? 'HTML' : 'text'}</button>
      </div>
      <div class="view-rendered"><div class="proposal">${rendered}</div></div>
      <div class="view-raw" hidden><textarea class="edit" data-key="${esc(f.key)}">${esc(desc)}</textarea></div>
      <div class="rationale"><b>Why it is built this way</b>${esc(f.proposal?.rationale || 'No rationale returned.')}</div>`;
  } else if (f.supplier_email) {
    const em = f.supplier_email;
    const mailto = `mailto:${encodeURIComponent(em.to || '')}?subject=${encodeURIComponent(em.subject || '')}&body=${encodeURIComponent(em.body || '')}`;
    right = `
      <h3>No source copy anywhere — ask the supplier</h3>
      <p class="chars">Nothing to amalgamate from: no other-channel listing, no attribute, no manufacturer page. Drafted for you to send:</p>
      <div class="email"><b>To:</b> ${esc(em.to)}\n<b>Subject:</b> ${esc(em.subject)}\n\n${esc(em.body)}</div>
      <p><a href="${mailto}"><button>Open in your mail client</button></a></p>`;
  } else {
    right = `<h3>No proposal</h3><p class="chars">Generation returned nothing for this family.</p>`;
  }

  const decidable = !!desc && !f.already_enriched;
  return `
  <section class="card" id="f-${esc(f.key)}">
    <div class="card-head">
      ${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : `<div class="noimg">no image</div>`}
      <div style="min-width:0">
        <h2>${esc(p.name || p.sku || 'Family ' + (i + 1))}</h2>
        <div class="skus">${(f.members || []).length} product${(f.members || []).length === 1 ? '' : 's'}: ${members}</div>
      </div>
      <div class="decide">
        <span class="status">Undecided</span>
        ${decidable ? `<button class="ok" data-act="approve" data-key="${esc(f.key)}">Approve</button>
        <button class="bad" data-act="reject" data-key="${esc(f.key)}">Reject</button>` : ''}
      </div>
    </div>
    <div class="cols">
      <div class="col"><h3>Sources (${(f.sources || []).length})</h3>${sources || '<p class="chars">None.</p>'}</div>
      <div class="col">${right}</div>
    </div>
  </section>`;
}

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, html);
console.log(`wrote ${output}: ${families.length} families, ${withProposal.length} proposals, ${needSupplier.length} need supplier, ${already.length} already enriched`);

#!/usr/bin/env node
/**
 * render-dashboard.js — Renders findings.json into a self-contained HTML
 * dashboard. The output is one file, no external assets, no JS frameworks.
 * It includes a print stylesheet so "Save as PDF" from any browser produces
 * a clean, paginated report.
 *
 * Usage:  node render-dashboard.js <findings.json> <output.html>
 */

const fs = require('node:fs');
const path = require('node:path');
const { esc, safeUrl } = require('./lib/sanitize');

const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: render-dashboard.js <findings.json> <output.html>');
  process.exit(1);
}

const findings = JSON.parse(fs.readFileSync(inPath, 'utf8'));

const verdictRank = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, UNKNOWN: 1.5, PASS: 1, 'N/A': 0 };
const verdictColor = {
  CRITICAL: '#b00020', HIGH: '#d84315', MEDIUM: '#f9a825',
  LOW: '#9e9d24', UNKNOWN: '#455a64', PASS: '#2e7d32', 'N/A': '#607d8b'
};
const rollupColor = { RED: '#b00020', AMBER: '#f9a825', GREEN: '#2e7d32' };
const postureLabel = {
  Critical: '#b00020', Concerning: '#d84315',
  Acceptable: '#f9a825', Strong: '#2e7d32',
  'Needs Review': '#455a64', 'No AI surface detected': '#607d8b'
};

const verdictOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN', 'PASS', 'N/A'];
const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0, PASS: 0, 'N/A': 0 };
for (const f of findings.findings || []) {
  counts[f.verdict] = (counts[f.verdict] || 0) + 1;
}

const categories = ['general-controls', 'input-threats', 'dev-time', 'runtime', 'testing', 'privacy'];
const categoryLabel = {
  'general-controls': 'General Controls',
  'input-threats': 'Input Threats',
  'dev-time': 'Development-time',
  'runtime': 'Runtime',
  'testing': 'Testing',
  'privacy': 'Privacy'
};

const findingsByCategory = Object.fromEntries(categories.map((c) => [c, []]));
for (const f of findings.findings || []) {
  if (findingsByCategory[f.category]) findingsByCategory[f.category].push(f);
}
for (const c of categories) {
  findingsByCategory[c].sort((a, b) => (verdictRank[b.verdict] || 0) - (verdictRank[a.verdict] || 0));
}

const rollup = findings.rollup || {};
const overall = rollup.overall || 'Unknown';
const groundingMode = findings.grounding?.primary_source || 'unknown';
const groundingNote = {
  live: 'Findings grounded in live content fetched from owaspai.org at audit time.',
  cache: 'Findings grounded in recently cached content from owaspai.org (within 7-day TTL).',
  snapshot: 'Live fetch failed. Findings grounded in bundled snapshot. Refresh snapshot or check connectivity.',
  index: 'Citations resolved from the bundled taxonomy index; no live fetch performed this run.'
}[groundingMode] || 'Grounding mode unknown.';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OWASP AI Audit — ${esc(findings.subject?.identifier || 'Report')}</title>
<style>
  :root {
    --bg: #fafafa;
    --panel: #ffffff;
    --ink: #1a1a1a;
    --muted: #5a5a5a;
    --border: #e3e3e3;
    --accent: #0b3d91;
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
         margin: 0; padding: 0; background: var(--bg); color: var(--ink); line-height: 1.5; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
  header.report-head { border-bottom: 1px solid var(--border); padding-bottom: 20px; margin-bottom: 24px; }
  header.report-head h1 { margin: 0 0 4px; font-size: 28px; }
  header.report-head .sub { color: var(--muted); font-size: 14px; }
  .grid { display: grid; gap: 16px; }
  .row-2 { grid-template-columns: 2fr 1fr; }
  .row-3 { grid-template-columns: repeat(3, 1fr); }
  .row-6 { grid-template-columns: repeat(6, 1fr); }
  @media (max-width: 800px) {
    .row-2, .row-3, .row-6 { grid-template-columns: 1fr; }
  }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
  .card h2 { margin: 0 0 12px; font-size: 18px; }
  .card h3 { margin: 0 0 8px; font-size: 15px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .posture { display: flex; align-items: center; gap: 16px; }
  .posture-dot { width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0; }
  .posture-label { font-size: 22px; font-weight: 600; }
  .counts { display: flex; gap: 12px; flex-wrap: wrap; }
  .count-pill { padding: 6px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; color: white; }
  .category-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .category-row:last-child { border-bottom: none; }
  .category-name { flex: 1; }
  .category-light { width: 16px; height: 16px; border-radius: 50%; }
  .category-count { color: var(--muted); font-size: 13px; min-width: 80px; text-align: right; }
  .finding { border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; background: var(--panel); page-break-inside: avoid; }
  .finding-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
  .finding-title { font-weight: 600; font-size: 15px; margin: 0; }
  .finding-title a { color: var(--accent); text-decoration: none; }
  .finding-title a:hover { text-decoration: underline; }
  .verdict-badge { padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 700; color: white; letter-spacing: 0.04em; }
  .finding dl { margin: 8px 0 0; display: grid; grid-template-columns: 120px 1fr; gap: 4px 12px; font-size: 14px; }
  .finding dt { color: var(--muted); font-weight: 600; }
  .finding dd { margin: 0; }
  .finding .controls { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border); font-size: 13px; }
  .finding .controls a { color: var(--accent); }
  .category-section { margin-top: 24px; }
  .category-section h2 { font-size: 20px; border-bottom: 2px solid var(--border); padding-bottom: 8px; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }
  .category-section .light { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
  footer.report-foot { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); }
  footer.report-foot p { margin: 4px 0; }
  code { background: #f0f0f0; padding: 1px 5px; border-radius: 3px; font-size: 90%; }

  @media print {
    body { background: white; }
    .wrap { max-width: none; padding: 16px; }
    .card, .finding { break-inside: avoid; }
    .category-section { break-before: auto; }
    a { color: var(--ink); text-decoration: none; }
    a[href]::after { content: " (" attr(href) ")"; font-size: 10px; color: var(--muted); }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<div class="wrap">

<header class="report-head">
  <h1>OWASP AI Exchange Audit</h1>
  <div class="sub">
    Subject: <strong>${esc(findings.subject?.identifier || '—')}</strong> ·
    Type: <strong>${esc(findings.subject?.type || '—')}</strong> ·
    Generated: <strong>${esc(findings.timestamp || '—')}</strong>
  </div>
</header>

<div class="grid row-2">
  <div class="card">
    <h3>Overall posture</h3>
    <div class="posture">
      <div class="posture-dot" style="background: ${postureLabel[overall] || '#999'};"></div>
      <div class="posture-label">${esc(overall)}</div>
    </div>
    <p style="margin: 12px 0 0; color: var(--muted); font-size: 14px;">
      ${esc(groundingNote)}
    </p>
  </div>
  <div class="card">
    <h3>Findings by severity</h3>
    <div class="counts">
      ${verdictOrder.map((v) => `
        <div class="count-pill" style="background: ${verdictColor[v]};">
          ${esc(v)}: ${counts[v] || 0}
        </div>`).join('')}
    </div>
  </div>
</div>

<div class="card" style="margin-top: 16px;">
  <h2>Category posture</h2>
  ${categories.map((c) => {
    const rollupKey = rollup[c] || 'GREEN';
    const findingsInCat = findingsByCategory[c].length;
    return `
    <div class="category-row">
      <span class="category-light" style="background: ${rollupColor[rollupKey] || '#999'};"></span>
      <span class="category-name">${esc(categoryLabel[c])}</span>
      <span class="category-count">${findingsInCat} finding${findingsInCat === 1 ? '' : 's'}</span>
    </div>`;
  }).join('')}
</div>

<div class="card" style="margin-top: 16px;">
  <h2>Scope</h2>
  <dl style="display: grid; grid-template-columns: 180px 1fr; gap: 6px 12px; font-size: 14px; margin: 0;">
    <dt style="color: var(--muted);">System kind</dt>
    <dd>${esc(findings.scope?.system_kind || '—')}</dd>
    <dt style="color: var(--muted);">Included categories</dt>
    <dd>${esc((findings.scope?.included_categories || []).join(', ') || '—')}</dd>
    <dt style="color: var(--muted);">Excluded categories</dt>
    <dd>${esc((findings.scope?.excluded_categories || []).join(', ') || 'none')}</dd>
  </dl>
  ${Object.keys(findings.scope?.exclusion_reasons || {}).length > 0 ? `
    <details style="margin-top: 8px;">
      <summary style="cursor: pointer; color: var(--muted); font-size: 13px;">Exclusion reasons</summary>
      <ul style="font-size: 13px;">
        ${Object.entries(findings.scope.exclusion_reasons)
          .map(([k, v]) => `<li><code>${esc(k)}</code> — ${esc(v)}</li>`).join('')}
      </ul>
    </details>` : ''}
</div>

${categories.map((c) => {
  const list = findingsByCategory[c];
  if (list.length === 0) return '';
  const rollupKey = rollup[c] || 'GREEN';
  return `
  <section class="category-section">
    <h2>
      <span class="light" style="background: ${rollupColor[rollupKey] || '#999'};"></span>
      ${esc(categoryLabel[c])}
    </h2>
    ${list.map((f) => `
      <div class="finding">
        <div class="finding-head">
          <p class="finding-title">
            <a href="${esc(safeUrl(f.threat_url))}" target="_blank" rel="noopener">${esc(f.threat_id || '')} — ${esc(extractTitleFromUrl(f.threat_url))}</a>
          </p>
          <span class="verdict-badge" style="background: ${verdictColor[f.verdict] || '#999'};">${esc(f.verdict)}</span>
        </div>
        <dl>
          <dt>Evidence</dt>
          <dd>${esc(f.evidence || '—')}</dd>
          <dt>Reasoning</dt>
          <dd>${esc(f.reasoning || '—')}</dd>
        </dl>
        ${(f.recommended_controls || []).length > 0 ? `
          <div class="controls">
            <strong>Recommended controls:</strong>
            <ul style="margin: 4px 0 0; padding-left: 20px;">
              ${f.recommended_controls.map((ctrl) => `
                <li><a href="${esc(safeUrl(ctrl.url))}" target="_blank" rel="noopener">${esc(ctrl.control_id || ctrl.url)}</a> — ${esc(ctrl.summary || '')}</li>
              `).join('')}
            </ul>
          </div>` : ''}
      </div>
    `).join('')}
  </section>`;
}).join('')}

<footer class="report-foot">
  ${findings.footer_note ? `<p style="padding: 10px 12px; background: #eceff1; border-left: 3px solid #455a64; border-radius: 4px; color: var(--ink);"><strong>Note:</strong> ${esc(findings.footer_note)}</p>` : ''}
  <p><strong>Grounding:</strong> ${esc(groundingNote)}</p>
  <p><strong>Snapshot date:</strong> ${esc(findings.grounding?.snapshot_date || 'n/a')} · <strong>Audit run:</strong> ${esc(findings.grounding?.fetched_at || '—')}</p>
  <p><strong>Audit ID:</strong> <code>${esc(findings.audit_id || '—')}</code></p>
  <p>Threat taxonomy: <a href="https://owaspai.org/">OWASP AI Exchange</a>. This report is not a compliance certification.</p>
  <p class="no-print"><em>Tip: To export this report as PDF, use your browser's "Print → Save as PDF".</em></p>
</footer>

</div>
</body>
</html>`;

function extractTitleFromUrl(url) {
  if (!url) return '';
  const m = String(url).match(/\/go\/([^\/]+)\/?$/);
  return m ? m[1] : url;
}

fs.writeFileSync(outPath, html);
console.log(`Wrote dashboard to ${outPath}`);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const RENDERER = path.join(REPO_ROOT, 'scripts', 'render-dashboard.js');

// A findings.json with a coverage block, a verdict_ledger, evidence_class on
// findings, and a hostile URL that the renderer must neutralise.
const DOC = {
  audit_id: 'test-cov',
  timestamp: '2026-06-01T00:00:00Z',
  subject: { type: 'codebase', identifier: 'fixture' },
  scope: { system_kind: 'llm-app', included_categories: ['input-threats'], excluded_categories: [] },
  grounding: { primary_source: 'live' },
  coverage: {
    L1_surface_inventory:     { covered: 10, total: 10 },
    L2_taxonomy_completeness: { verdicted: 26, applicable: 60 },   // 43% — the lever
    L3_authz_matrix:          { cells_filled: 12, cells_total: 15 },
    L4_trust_boundary:        { subareas_covered: 7, subareas_total: 7 },
    L5_probe_verification:    { high_plus_with_probe: 2, high_plus_total: 2 },
    L6_regulatory:            { obligations_addressed: 5, obligations_total: 6, jurisdictions: ['EU'] },
    L7_operational:           { subareas_covered: 4, subareas_total: 4 },
    L8_race_toctou:           { patterns_inspected: 3, patterns_identified: 3 },
  },
  verdict_ledger: [
    { entry_id: 'INPUT-PROMPTINJECTION', verdict: 'MEDIUM', applicability: 'applicable', rationale: 'concatenated input' },
    { entry_id: 'INPUT-EVASION', verdict: 'N/A', applicability: 'no-predictive-surface', rationale: 'no training surface' },
  ],
  evidence_class_summary: { static: 1, 'reasoned-probe': 1, demonstrated: 0 },
  findings: [
    { threat_id: 'INPUT-PROMPTINJECTION', threat_url: 'javascript:alert(1)', category: 'input-threats',
      verdict: 'MEDIUM', evidence_class: 'static', evidence: 'x:1', reasoning: 'r' },
    { threat_id: 'RUNTIME-X', threat_url: 'https://owaspai.org/go/leastmodelprivilege/', category: 'runtime',
      verdict: 'HIGH', evidence_class: 'reasoned-probe', evidence: 'y:2', reasoning: 'r2' },
  ],
  rollup: { graded_posture: 'Acceptable', overall: 'Acceptable' },
};

function render() {
  const inF = path.join(os.tmpdir(), `oaa-cov-in-${process.pid}.json`);
  const outF = path.join(os.tmpdir(), `oaa-cov-out-${process.pid}.html`);
  fs.writeFileSync(inF, JSON.stringify(DOC));
  execFileSync('node', [RENDERER, inF, outF], { encoding: 'utf8' });
  const html = fs.readFileSync(outF, 'utf8');
  fs.rmSync(inF, { force: true });
  fs.rmSync(outF, { force: true });
  return html;
}

test('page-one Coverage panel renders with per-layer percentages', () => {
  const html = render();
  assert.match(html, /Completeness coverage/);
  // every layer label appears
  for (const label of ['L1 · Surface inventory', 'L2 · Taxonomy completeness', 'L8 · Race / TOCTOU pass']) {
    assert.ok(html.includes(label), `missing ${label}`);
  }
  // L2 = 26/60 = 43%
  assert.match(html, /43%/);
  // panel appears before the first finding section
  assert.ok(html.indexOf('Completeness coverage') < html.indexOf('class="finding"'),
    'coverage panel must precede findings');
});

test('posture is capped to Screen only despite Acceptable graded label', () => {
  const html = render();
  assert.match(html, /Screen only — not an audit/);
  assert.ok(!/posture-label">Acceptable/.test(html), 'must not show Acceptable as the posture');
});

test('verdict_ledger renders as an appendix with the N/A row visible', () => {
  const html = render();
  assert.match(html, /Verdict ledger/);
  assert.match(html, /INPUT-EVASION/);
  assert.match(html, /no-predictive-surface/);
});

test('evidence_class badges render on finding cards and in the footer', () => {
  const html = render();
  assert.match(html, /ev-badge ev-static/);
  assert.match(html, /ev-badge ev-reasoned-probe/);
  assert.match(html, /Evidence classes:/);
});

test('safeUrl still neutralises javascript: hrefs in finding links', () => {
  const html = render();
  // The real invariant: no executable javascript: URL in any href attribute.
  assert.ok(!/href\s*=\s*["']\s*javascript:/i.test(html), 'no javascript: href may survive');
});

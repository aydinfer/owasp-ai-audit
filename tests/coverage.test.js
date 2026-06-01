const test = require('node:test');
const assert = require('node:assert/strict');

const {
  layerPercent, band, minCoverage, meanCoverage, cappedPosture,
  evidenceClassSummary, evidenceCapViolations, summarize, LAYERS,
} = require('../scripts/lib/coverage');

// A coverage block where every layer is at `pct` (caller can override cells).
function fullBlock(pct, over = {}) {
  const n = pct, d = 100;
  const base = {
    L1_surface_inventory:     { covered: n, total: d },
    L2_taxonomy_completeness: { verdicted: n, applicable: d },
    L3_authz_matrix:          { cells_filled: n, cells_total: d },
    L4_trust_boundary:        { subareas_covered: n, subareas_total: d },
    L5_probe_verification:    { high_plus_with_probe: n, high_plus_total: d },
    L6_regulatory:            { obligations_addressed: n, obligations_total: d, jurisdictions: ['EU'] },
    L7_operational:           { subareas_covered: n, subareas_total: d },
    L8_race_toctou:           { patterns_inspected: n, patterns_identified: d },
  };
  return { ...base, ...over };
}

test('layerPercent recomputes from N/M and ignores a stored percent', () => {
  const block = { L2_taxonomy_completeness: { verdicted: 9, applicable: 10, percent: 100 } };
  assert.equal(layerPercent(LAYERS[1], block), 90);   // 9/10, not the lying 100
});

test('zero denominator is vacuously 100% (no surface to cover)', () => {
  const block = { L5_probe_verification: { high_plus_with_probe: 0, high_plus_total: 0 } };
  assert.equal(layerPercent(LAYERS[4], block), 100);
});

test('an absent layer reads as null and counts as 0 toward the minimum', () => {
  assert.equal(layerPercent(LAYERS[7], {}), null);
  const { percent, layer } = minCoverage({ L1_surface_inventory: { covered: 10, total: 10 } });
  assert.equal(percent, 0);
  assert.equal(layer, 'L2_taxonomy_completeness');   // first absent required layer
});

test('band thresholds: >=90 green, 70-89 amber, <70 red', () => {
  assert.equal(band(100), 'green');
  assert.equal(band(90), 'green');
  assert.equal(band(89), 'amber');
  assert.equal(band(70), 'amber');
  assert.equal(band(69), 'red');
  assert.equal(band(null), 'red');
});

test('posture cap: >=90 on every layer keeps the graded posture', () => {
  const r = cappedPosture(fullBlock(95), 'Concerning');
  assert.equal(r.posture, 'Concerning');
  assert.equal(r.cap, 'none');
});

test('posture cap: a single 70-89 layer floors to Partial with the min %', () => {
  const block = fullBlock(95, { L3_authz_matrix: { cells_filled: 8, cells_total: 10 } });
  const r = cappedPosture(block, 'Acceptable');
  assert.equal(r.cap, 'partial');
  assert.match(r.posture, /^Partial — acceptable for what was read \(80%\)$/);
  assert.equal(r.min_layer, 'L3_authz_matrix');
});

test('posture cap: any layer <70 forces Screen only, however clean the findings', () => {
  const block = fullBlock(99, { L2_taxonomy_completeness: { verdicted: 26, applicable: 60 } });
  const r = cappedPosture(block, 'Strong');
  assert.equal(r.cap, 'screen-only');
  assert.equal(r.posture, 'Screen only — not an audit');
});

test('the lever: 26/97-style taxonomy coverage cannot be "Acceptable"', () => {
  // Reproduces the v0.2.2 dishonesty pattern: a clean-looking findings list but
  // only ~43% taxonomy coverage. The cap must override the graded label.
  const block = fullBlock(100, { L2_taxonomy_completeness: { verdicted: 26, applicable: 60 } });
  const s = summarize({ coverage: block, rollup: { graded_posture: 'Acceptable' }, findings: [] });
  assert.equal(s.posture, 'Screen only — not an audit');
  assert.notEqual(s.posture, 'Acceptable');
});

test('meanCoverage averages all eight layers (absent = 0)', () => {
  assert.equal(meanCoverage(fullBlock(80)), 80);
  // drop two layers → mean = 80*6/8 = 60
  const block = fullBlock(80);
  delete block.L7_operational;
  delete block.L8_race_toctou;
  assert.equal(meanCoverage(block), 60);
});

test('evidenceClassSummary tallies classes incl. unspecified', () => {
  const findings = [
    { evidence_class: 'static' }, { evidence_class: 'static' },
    { evidence_class: 'reasoned-probe' }, { evidence_class: 'demonstrated' },
    {},
  ];
  assert.deepEqual(evidenceClassSummary(findings),
    { static: 2, 'reasoned-probe': 1, demonstrated: 1, unspecified: 1 });
});

test('evidenceCapViolations: static-only finding cannot be HIGH+', () => {
  const findings = [
    { threat_id: 'A', verdict: 'HIGH', evidence_class: 'static' },        // violation
    { threat_id: 'B', verdict: 'HIGH', evidence_class: 'reasoned-probe' }, // ok
    { threat_id: 'C', verdict: 'CRITICAL', evidence_class: 'reasoned-probe' }, // violation (cap HIGH)
    { threat_id: 'D', verdict: 'CRITICAL', evidence_class: 'demonstrated' }, // ok
    { threat_id: 'E', verdict: 'MEDIUM', evidence_class: 'static' },       // ok (within cap)
    { threat_id: 'F', verdict: 'HIGH' },                                   // violation (no class)
  ];
  const v = evidenceCapViolations(findings).map((x) => x.threat_id);
  assert.deepEqual(v.sort(), ['A', 'C', 'F']);
});

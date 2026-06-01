const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  categoryColor, gradedPosture, recomputeL5, finalize,
} = require('../scripts/lib/coverage');

const REPO_ROOT = path.resolve(__dirname, '..');
const FINALIZE = path.join(REPO_ROOT, 'scripts', 'finalize-findings.js');

// real entry ids → categories, from the shipped taxonomy
const IDX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'reference', 'taxonomy-index.json'), 'utf8'));
const CAT_OF = {};
for (const e of [...IDX.threats, ...(IDX.controls || [])]) CAT_OF[e.id] = e.category;

test('categoryColor follows verdict-rules thresholds', () => {
  assert.equal(categoryColor({ CRITICAL: 1 }), 'RED');
  assert.equal(categoryColor({ HIGH: 2 }), 'RED');
  assert.equal(categoryColor({ HIGH: 1 }), 'AMBER');
  assert.equal(categoryColor({ MEDIUM: 3 }), 'AMBER');
  assert.equal(categoryColor({ MEDIUM: 2, LOW: 9 }), 'GREEN');
});

test('gradedPosture: 2+ AMBER is Concerning, 1 is Acceptable', () => {
  assert.equal(gradedPosture({ a: 'AMBER', b: 'AMBER', c: 'GREEN' }), 'Concerning');
  assert.equal(gradedPosture({ a: 'AMBER', b: 'GREEN' }), 'Acceptable');
  assert.equal(gradedPosture({ a: 'GREEN' }), 'Strong');
  assert.equal(gradedPosture({ a: 'RED', b: 'AMBER' }), 'Critical');
});

test('recomputeL5 counts HIGH+ with a probe', () => {
  const f = [
    { verdict: 'HIGH', evidence_class: 'reasoned-probe' },
    { verdict: 'HIGH', evidence_class: 'static' },   // shouldn't happen, but counts in denom
    { verdict: 'MEDIUM', evidence_class: 'static' },
  ];
  assert.deepEqual(recomputeL5(f), { high_plus_with_probe: 1, high_plus_total: 2 });
});

// The core fix: the model mislabels, the tool corrects. A doc that *claims*
// "Acceptable" with two real AMBER categories must come out "Concerning".
test('finalize recomputes a mislabelled rollup from the ledger', () => {
  const inputThreat = IDX.threats.find((t) => t.category === 'input-threats').id;
  const runtimeThreat = IDX.threats.find((t) => t.category === 'runtime').id;
  const doc = {
    verdict_ledger: [
      { entry_id: inputThreat, verdict: 'HIGH' },
      { entry_id: runtimeThreat, verdict: 'HIGH' },
    ],
    findings: [],
    rollup: { 'input-threats': 'GREEN', overall: 'Acceptable', graded_posture: 'Acceptable' },  // the lie
  };
  const { doc: out } = finalize(doc, CAT_OF);
  assert.equal(out.rollup['input-threats'], 'AMBER');
  assert.equal(out.rollup.runtime, 'AMBER');
  assert.equal(out.rollup.graded_posture, 'Concerning');   // not the claimed Acceptable
});

test('finalize reconciles a finding verdict into its ledger row', () => {
  const id = IDX.threats[0].id;
  const doc = {
    verdict_ledger: [{ entry_id: id, verdict: 'MEDIUM' }],
    findings: [{ threat_id: id, verdict: 'HIGH', evidence_class: 'reasoned-probe', category: IDX.threats[0].category }],
  };
  const { doc: out, errors } = finalize(doc, CAT_OF);
  assert.equal(out.verdict_ledger[0].verdict, 'HIGH', 'ledger row follows the card');
  assert.equal(errors.length, 0);
});

test('finalize flags a finding with no ledger row', () => {
  const doc = {
    verdict_ledger: [{ entry_id: IDX.threats[0].id, verdict: 'LOW' }],
    findings: [{ threat_id: 'NOT-A-REAL-ID', verdict: 'MEDIUM', evidence_class: 'static' }],
  };
  const { errors } = finalize(doc, CAT_OF);
  assert.ok(errors.some((e) => /NOT-A-REAL-ID/.test(e)));
});

test('finalize leaves screen_only rollup untouched', () => {
  const doc = {
    screen_only: true,
    findings: [{ threat_id: IDX.threats[0].id, verdict: 'UNKNOWN', category: IDX.threats[0].category }],
    rollup: { overall: 'Needs Review' },
  };
  const { doc: out } = finalize(doc, CAT_OF);
  assert.equal(out.rollup.overall, 'Needs Review');
});

test('finalize CLI --check exits 2 on an evidence-cap violation', () => {
  const id = IDX.threats[0].id;
  const doc = {
    coverage: { L5_probe_verification: { high_plus_with_probe: 0, high_plus_total: 1 } },
    verdict_ledger: [{ entry_id: id, verdict: 'HIGH' }],
    findings: [{ threat_id: id, verdict: 'HIGH', evidence_class: 'static', category: IDX.threats[0].category }],
  };
  const p = path.join(os.tmpdir(), `oaa-fin-${process.pid}.json`);
  fs.writeFileSync(p, JSON.stringify(doc));
  let code = 0;
  try { execFileSync('node', [FINALIZE, p, '--check'], { stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  fs.rmSync(p, { force: true });
  assert.equal(code, 2, 'static HIGH must fail the gate');
});

test('finalize CLI writes finalized:true and a corrected rollup', () => {
  const inputThreat = IDX.threats.find((t) => t.category === 'input-threats').id;
  const runtimeThreat = IDX.threats.find((t) => t.category === 'runtime').id;
  const doc = {
    verdict_ledger: [
      { entry_id: inputThreat, verdict: 'HIGH' },
      { entry_id: runtimeThreat, verdict: 'HIGH' },
    ],
    findings: [
      { threat_id: inputThreat, verdict: 'HIGH', evidence_class: 'reasoned-probe', category: 'input-threats' },
      { threat_id: runtimeThreat, verdict: 'HIGH', evidence_class: 'demonstrated', category: 'runtime' },
    ],
    rollup: { overall: 'Acceptable' },
  };
  const p = path.join(os.tmpdir(), `oaa-fin2-${process.pid}.json`);
  fs.writeFileSync(p, JSON.stringify(doc));
  execFileSync('node', [FINALIZE, p], { stdio: 'pipe' });
  const out = JSON.parse(fs.readFileSync(p, 'utf8'));
  fs.rmSync(p, { force: true });
  assert.equal(out.finalized, true);
  assert.equal(out.rollup.graded_posture, 'Concerning');
});

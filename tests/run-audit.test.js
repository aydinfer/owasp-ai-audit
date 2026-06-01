const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { scanText, scanDir, scopeFromKinds } = require('../scripts/lib/static-detectors');
const { gateTripped } = require('../scripts/run-audit');
const { buildSummary, topFindings } = require('../scripts/lib/audit-summary');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'llm-app-sample');
const RUN_AUDIT = path.join(REPO_ROOT, 'scripts', 'run-audit.js');
const INDEX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'reference', 'taxonomy-index.json'), 'utf8'));
const SLUGS = new Set([...INDEX.threats, ...INDEX.controls].map((e) => e.slug));

// ---- detector unit tests -------------------------------------------------

test('scanText finds an LLM call site', () => {
  const hits = scanText('const r = await streamText({ model });');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'llm-call');
});

test('scanText finds prompt construction only when input is interpolated', () => {
  assert.equal(scanText('system: `static instructions`').length, 0);
  const hits = scanText('system: `You are an agent. Context: ${ctx}`');
  assert.ok(hits.some((h) => h.kind === 'prompt-construction'));
});

test('scanText does NOT match Vitest test() or readline prompt (no false positives)', () => {
  assert.deepEqual(scanText("test('reads the prompt', async () => {})"), []);
  assert.deepEqual(scanText("const a = await rl.question('prompt> ')"), []);
  assert.deepEqual(scanText('// the word tool appears in a comment'), []);
});

test('scanDir finds AI surfaces in the fixture and skips the decoy test file', () => {
  const { surfaces } = scanDir(FIXTURE);
  const kinds = new Set(surfaces.map((s) => s.kind));
  assert.ok(kinds.has('llm-call'));
  assert.ok(kinds.has('prompt-construction'));
  assert.ok(kinds.has('tool-definition'));
  assert.ok(kinds.has('rag-embeddings'));
  // the decoy CLI test file must contribute nothing
  assert.ok(!surfaces.some((s) => s.file.includes('cli.test.ts')),
    `decoy file leaked surfaces: ${surfaces.filter((s) => s.file.includes('cli.test.ts')).map((s) => s.kind)}`);
});

test('scopeFromKinds always includes general-controls and maps to real slugs', () => {
  const { categories, threatSlugs, controlSlugs } = scopeFromKinds(new Set(['llm-call']));
  assert.ok(categories.has('general-controls'));
  assert.ok(categories.has('input-threats'));
  for (const s of [...threatSlugs, ...controlSlugs]) {
    assert.ok(SLUGS.has(s), `slug ${s} not in taxonomy index`);
  }
});

// ---- full runner against the fixture -------------------------------------

test('run-audit produces a valid findings.json against the fixture', () => {
  const out = path.join(os.tmpdir(), `oaa-findings-${process.pid}.json`);
  execFileSync('node', [RUN_AUDIT, FIXTURE, '--no-fetch', '--no-dashboard', '--out', out],
    { encoding: 'utf8' });
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(out, { force: true });

  // shape
  for (const key of ['audit_id', 'timestamp', 'subject', 'scope', 'grounding', 'findings', 'rollup', 'footer_note']) {
    assert.ok(key in doc, `findings.json missing ${key}`);
  }
  assert.ok(doc.findings.length > 0, 'expected at least one finding');
  assert.match(doc.footer_note, /first-pass/i);
  assert.equal(doc.grounding.primary_source, 'index');   // --no-fetch
  assert.ok(doc.scope.included_categories.includes('input-threats'));
  assert.ok(doc.scope.included_categories.includes('runtime'));

  // every static finding is UNKNOWN and carries a live-permalink citation
  for (const f of doc.findings) {
    assert.equal(f.verdict, 'UNKNOWN', `finding ${f.threat_id} should be UNKNOWN`);
    assert.match(f.threat_url, /^https:\/\/owaspai\.org\/go\/[a-z0-9-]+\/$/);
    assert.ok(f.evidence && /:\d+/.test(f.evidence), 'evidence should cite file:line');
    for (const c of f.recommended_controls || []) {
      assert.match(c.url, /^https:\/\/owaspai\.org\/go\//);
    }
  }

  // the threats we expect from the fixture's surfaces are present
  const ids = new Set(doc.findings.map((f) => f.threat_id));
  assert.ok([...ids].some((id) => /PROMPTINJECTION/.test(id)), 'expected a prompt-injection finding');
});

test('run-audit self-labels "Screen only" via the coverage cap', () => {
  const out = path.join(os.tmpdir(), `oaa-screen-${process.pid}.json`);
  execFileSync('node', [RUN_AUDIT, FIXTURE, '--no-fetch', '--no-dashboard', '--out', out],
    { encoding: 'utf8' });
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(out, { force: true });
  assert.equal(doc.screen_only, true);
  assert.ok(doc.coverage, 'screen emits a coverage block');
  assert.equal(doc.coverage.L1_surface_inventory.covered, 0, 'screen reads no file end-to-end');
  // the reasoning layers are 0%, so the cap forces "Screen only" regardless of findings
  assert.equal(doc.rollup.overall, 'Screen only — not an audit');
  assert.equal(doc.rollup.graded_posture, 'Needs Review');
});

// ---- gate logic ----------------------------------------------------------

test('gateTripped: NONE never trips', () => {
  assert.equal(gateTripped([{ verdict: 'UNKNOWN' }], 'NONE').tripped, false);
});

test('gateTripped: any UNKNOWN trips a non-NONE gate (treated worst-case)', () => {
  for (const level of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
    assert.equal(gateTripped([{ verdict: 'UNKNOWN', threat_id: 'X' }], level).tripped, true, level);
  }
});

test('gateTripped: graded findings compare by their own rank', () => {
  assert.equal(gateTripped([{ verdict: 'LOW' }], 'HIGH').tripped, false);
  assert.equal(gateTripped([{ verdict: 'CRITICAL', threat_id: 'X' }], 'HIGH').tripped, true);
  assert.equal(gateTripped([{ verdict: 'PASS' }, { verdict: 'N/A' }], 'LOW').tripped, false);
});

// ---- summary -------------------------------------------------------------

test('buildSummary renders posture, counts and top findings with permalinks', () => {
  const doc = {
    rollup: { overall: 'Needs Review' },
    grounding: { primary_source: 'live' },
    subject: { identifier: '/tmp/app' },
    findings: [
      { threat_id: 'INPUT-PROMPTINJECTION', threat_url: 'https://owaspai.org/go/promptinjection/', verdict: 'UNKNOWN', evidence: 'app/chat.ts:5' },
      { threat_id: 'RUN-GENERICSECTHREATS', threat_url: 'https://owaspai.org/go/genericsecthreats/', verdict: 'UNKNOWN', evidence: 'lib/tools.ts:5' },
    ],
    footer_note: 'first-pass static screen',
  };
  const md = buildSummary(doc, { title: 'Screen' });
  assert.match(md, /### Screen/);
  assert.match(md, /Needs Review/);
  assert.match(md, /UNKNOWN: 2/);
  assert.match(md, /\(https:\/\/owaspai\.org\/go\/promptinjection\/\)/);
  assert.match(md, /first-pass static screen/);
});

test('topFindings orders worst-severity first', () => {
  const doc = { findings: [{ verdict: 'LOW' }, { verdict: 'CRITICAL' }, { verdict: 'UNKNOWN' }] };
  // UNKNOWN ranks just below LOW: it means "ungraded", not "severe".
  assert.deepEqual(topFindings(doc, 2).map((f) => f.verdict), ['CRITICAL', 'LOW']);
});

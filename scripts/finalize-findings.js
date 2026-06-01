#!/usr/bin/env node
/**
 * finalize-findings.js — the deterministic finalizer. You (the auditor) write
 * the verdicts; this writes the MATH, so no run can mislabel its own posture.
 *
 * It loads findings.json + reference/taxonomy-index.json and recomputes, from
 * the verdict_ledger and findings:
 *   - the per-category rollup and graded posture (verdict-rules.md),
 *   - coverage.L5_probe_verification and every coverage .percent,
 *   - evidence_class_summary,
 * reconciling each finding's verdict into its ledger row. It is the enforcement
 * gate: it EXITS NON-ZERO if any finding exceeds its evidence-class cap
 * (static→MEDIUM, reasoned-probe→HIGH, demonstrated→CRITICAL) or if a finding
 * has no ledger row. The renderer self-computes the same values, so a forgotten
 * finalize still renders correctly — but CI should run this to fail the build.
 *
 * Usage:
 *   node scripts/finalize-findings.js <findings.json> [--out f] [--check]
 *
 * Exit codes: 0 clean · 2 cap violation / ledger gap · 3 invalid invocation
 */

const fs = require('node:fs');
const path = require('node:path');
const coverage = require('./lib/coverage');

const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(REPO_ROOT, 'reference', 'taxonomy-index.json');

function parseArgs(argv) {
  const opts = { in: null, out: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--check') opts.check = true;
    else if (!a.startsWith('-') && !opts.in) opts.in = a;
  }
  if (!opts.out) opts.out = opts.in;
  return opts;
}

// { entry_id: category } from the taxonomy index.
function loadCatOf() {
  const idx = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const catOf = {};
  for (const e of [...idx.threats, ...(idx.controls || [])]) catOf[e.id] = e.category;
  return catOf;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.in) {
    console.error('usage: finalize-findings.js <findings.json> [--out f] [--check]');
    process.exit(3);
  }
  if (!fs.existsSync(opts.in)) {
    console.error(`findings not found: ${opts.in}`);
    process.exit(3);
  }

  const doc = JSON.parse(fs.readFileSync(opts.in, 'utf8'));
  const catOf = loadCatOf();
  const { doc: finalized, violations, errors } = coverage.finalize(doc, catOf);
  finalized.finalized = true;

  const s = coverage.summarize(finalized);
  console.log(`Rollup: ${coverage.CATEGORY_ORDER.map((c) => `${c}=${finalized.rollup?.[c] || '—'}`).join(' ')}`);
  console.log(`Graded posture: ${s.graded_posture}  →  Reported (capped): ${s.posture}  [cap: ${s.cap}, min ${s.min.percent}% @ ${s.min.layer || '—'}]`);
  if (finalized.coverage?.L5_probe_verification) {
    const l5 = finalized.coverage.L5_probe_verification;
    console.log(`L5 probe verification: ${l5.high_plus_with_probe}/${l5.high_plus_total} HIGH+ findings carry a probe`);
  }
  console.log(`Evidence classes: ${Object.entries(s.evidence_class_summary).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(' ') || 'none'}`);

  const fatal = violations.length > 0 || errors.length > 0;
  for (const e of errors) console.error(`  ERROR  ${e}`);
  for (const v of violations) console.error(`  CAP VIOLATION  ${v.threat_id} is ${v.verdict} but ${v.reason}`);

  if (opts.check) {
    if (fatal) { console.error(`finalize --check FAILED: ${violations.length} cap violation(s), ${errors.length} error(s).`); process.exit(2); }
    console.log('finalize --check: clean.');
    process.exit(0);
  }

  fs.writeFileSync(opts.out, JSON.stringify(finalized, null, 2) + '\n');
  console.log(`Wrote finalized findings to ${opts.out}.`);
  if (fatal) {
    console.error(`Finalized, but ${violations.length} cap violation(s) + ${errors.length} error(s) must be fixed (verdict lowered or a probe added).`);
    process.exit(2);
  }
  process.exit(0);
}

module.exports = { parseArgs };

if (require.main === module) main();

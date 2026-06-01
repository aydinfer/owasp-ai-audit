// coverage.js — the enforcement core of v1.0.0. Pure, dependency-free, and
// unit-tested. Turns the `coverage` block + `verdict_ledger` + `findings` of a
// findings.json into per-layer percentages, colour bands, an evidence-class
// summary, evidence-cap violations, and — the lever — a posture that is CAPPED
// by the lowest-covered layer. This is what makes "graded 8/97 entries but
// labelled Acceptable" impossible: the cap, not the findings list, decides.
//
// See SKILL.md (eight completeness layers) and reference/verdict-rules.md.

// The eight ordered layers and the (numerator, denominator) field names each
// uses in the findings.json `coverage` block.
const LAYERS = [
  { key: 'L1_surface_inventory',     label: 'L1 · Surface inventory',      num: 'covered',             den: 'total' },
  { key: 'L2_taxonomy_completeness', label: 'L2 · Taxonomy completeness',  num: 'verdicted',           den: 'applicable' },
  { key: 'L3_authz_matrix',          label: 'L3 · Auth/authz matrix',      num: 'cells_filled',        den: 'cells_total' },
  { key: 'L4_trust_boundary',        label: 'L4 · Trust-boundary depth',   num: 'subareas_covered',    den: 'subareas_total' },
  { key: 'L5_probe_verification',    label: 'L5 · Probe verification',     num: 'high_plus_with_probe', den: 'high_plus_total' },
  { key: 'L6_regulatory',            label: 'L6 · Regulatory pass',        num: 'obligations_addressed', den: 'obligations_total' },
  { key: 'L7_operational',           label: 'L7 · Operational pass',       num: 'subareas_covered',    den: 'subareas_total' },
  { key: 'L8_race_toctou',           label: 'L8 · Race / TOCTOU pass',     num: 'patterns_inspected',  den: 'patterns_identified' },
];

// Evidence-class severity caps (Phase 3.C / L5). A finding may not exceed the
// cap implied by its evidence_class.
const EVIDENCE_CLASS_CAP = {
  static: 'MEDIUM',
  'reasoned-probe': 'HIGH',
  demonstrated: 'CRITICAL',
};
const SEVERITY_RANK = { 'N/A': 0, PASS: 1, LOW: 2, MEDIUM: 3, HIGH: 4, CRITICAL: 5 };

// A layer with a zero denominator is vacuously complete (100%), e.g. "no HIGH+
// findings to probe" or "no read-then-act patterns identified" — NOT 0%, which
// would punish an audit for the target lacking the surface. The numerator/
// denominator the auditor wrote always wins over a stored percent (we recompute
// so a hand-edited percent can't lie about the cap).
function layerPercent(layer, block) {
  const cell = block && block[layer.key];
  if (!cell) return null;                 // layer entirely absent from coverage
  const n = Number(cell[layer.num]);
  const d = Number(cell[layer.den]);
  if (!Number.isFinite(d) || d === 0) return 100;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round((n / d) * 100)));
}

function band(percent) {
  if (percent == null) return 'red';      // a missing required layer is red
  if (percent >= 90) return 'green';
  if (percent >= 70) return 'amber';
  return 'red';
}

// Per-layer view for the renderer: [{ key, label, num, den, percent, band, present }].
function layerRows(block) {
  return LAYERS.map((layer) => {
    const cell = block && block[layer.key];
    const percent = layerPercent(layer, block);
    return {
      key: layer.key,
      label: layer.label,
      numerator: cell ? cell[layer.num] : null,
      denominator: cell ? cell[layer.den] : null,
      jurisdictions: cell ? cell.jurisdictions : undefined,
      percent,
      band: band(percent),
      present: !!cell,
    };
  });
}

// The lowest layer percentage across all eight layers. A required layer that is
// entirely absent counts as 0 — you cannot earn a clean posture by omitting a
// layer's coverage block. Returns { percent, layer }.
function minCoverage(block) {
  let min = 101;
  let which = null;
  for (const layer of LAYERS) {
    const p = layerPercent(layer, block);
    const eff = p == null ? 0 : p;
    if (eff < min) { min = eff; which = layer.key; }
  }
  if (which == null) return { percent: 0, layer: null };
  return { percent: min === 101 ? 100 : min, layer: which };
}

// Mean coverage across the eight layers (absent layer = 0). For reporting only;
// the cap is driven by the MINIMUM, never the mean.
function meanCoverage(block) {
  const ps = LAYERS.map((layer) => {
    const p = layerPercent(layer, block);
    return p == null ? 0 : p;
  });
  return Math.round(ps.reduce((a, b) => a + b, 0) / ps.length);
}

// Phase 3.C — the posture cap. `gradedPosture` is what verdict-rules.md would
// label the findings on their own (Strong/Acceptable/Concerning/Critical). The
// returned posture is that label ONLY when every layer is >= 90%; otherwise it
// is floored to "Partial …" (70–90% min) or "Screen only …" (<70% min).
function cappedPosture(block, gradedPosture) {
  const { percent, layer } = minCoverage(block);
  if (percent >= 90) {
    return { posture: gradedPosture, cap: 'none', min_percent: percent, min_layer: layer };
  }
  if (percent >= 70) {
    return {
      posture: `Partial — acceptable for what was read (${percent}%)`,
      cap: 'partial', min_percent: percent, min_layer: layer,
    };
  }
  return {
    posture: 'Screen only — not an audit',
    cap: 'screen-only', min_percent: percent, min_layer: layer,
  };
}

// Evidence-class tally over findings ({ static, 'reasoned-probe', demonstrated,
// unspecified }).
function evidenceClassSummary(findings) {
  const out = { static: 0, 'reasoned-probe': 0, demonstrated: 0, unspecified: 0 };
  for (const f of findings || []) {
    const c = f.evidence_class;
    if (c && c in out) out[c] += 1;
    else out.unspecified += 1;
  }
  return out;
}

// Findings whose verdict exceeds the cap implied by their evidence_class.
// static→MEDIUM, reasoned-probe→HIGH, demonstrated→CRITICAL. A HIGH+ finding
// with no evidence_class is also a violation (it has no standing to be HIGH+).
function evidenceCapViolations(findings) {
  const out = [];
  for (const f of findings || []) {
    const rank = SEVERITY_RANK[f.verdict];
    if (rank == null || rank < SEVERITY_RANK.HIGH) continue;   // only HIGH/CRITICAL can violate
    const cls = f.evidence_class;
    const cap = EVIDENCE_CLASS_CAP[cls];
    if (!cap) {
      out.push({ threat_id: f.threat_id, verdict: f.verdict, evidence_class: cls || null, reason: 'HIGH+ finding without a valid evidence_class' });
      continue;
    }
    if (rank > SEVERITY_RANK[cap]) {
      out.push({ threat_id: f.threat_id, verdict: f.verdict, evidence_class: cls, cap, reason: `${cls} caps at ${cap}` });
    }
  }
  return out;
}

// One-call rollup used by the renderer and the inline summary.
function summarize(doc) {
  const block = doc.coverage || {};
  const graded = doc.rollup?.graded_posture || doc.rollup?.overall || 'Unknown';
  const capped = cappedPosture(block, graded);
  return {
    layers: layerRows(block),
    min: minCoverage(block),
    mean: meanCoverage(block),
    graded_posture: graded,
    posture: capped.posture,
    cap: capped.cap,
    evidence_class_summary: doc.evidence_class_summary || evidenceClassSummary(doc.findings),
    evidence_cap_violations: evidenceCapViolations(doc.findings),
  };
}

module.exports = {
  LAYERS, EVIDENCE_CLASS_CAP, SEVERITY_RANK,
  layerPercent, band, layerRows, minCoverage, meanCoverage,
  cappedPosture, evidenceClassSummary, evidenceCapViolations, summarize,
};

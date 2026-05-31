#!/usr/bin/env node
/**
 * run-audit.js — Non-interactive, static-only OWASP AI audit runner.
 *
 * The full skill reasons inside Claude Code (see SKILL.md). This runner is the
 * CI counterpart: it statically catalogues the AI surfaces in a target tree,
 * maps them to in-scope OWASP AI Exchange threats, fetches a live citation for
 * each, and emits a findings.json + dashboard.html. It does NOT grade severity
 * — every finding it writes carries verdict `UNKNOWN`, because a static pass
 * cannot make a severity call without an LLM. Its job is to surface *presence*
 * and *citations* as a first-pass screen, then point you at the full workflow.
 *
 * Surface discovery prefers the deterministic AST enumerator
 * (scripts/enumerate-ai-surfaces.js → surfaces.json, v0.4.0+) when available,
 * and falls back to the regex detectors in scripts/lib/static-detectors.js.
 *
 * Usage:
 *   node scripts/run-audit.js <target> [options]
 *
 * Options:
 *   --fail-on <LEVEL>   NONE|LOW|MEDIUM|HIGH|CRITICAL (default NONE).
 *                       Exit 2 if any finding meets or exceeds LEVEL. Because
 *                       the runner only emits UNKNOWN findings, an UNKNOWN
 *                       counts as "could be anything up to CRITICAL" — it
 *                       cannot be cleared below a threshold by static means, so
 *                       any UNKNOWN trips a non-NONE gate.
 *   --out <path>        findings.json output (default ./findings.json)
 *   --dashboard <path>  dashboard.html output (default ./dashboard.html)
 *   --surfaces <path>   pre-computed surfaces.json (from enumerate-ai-surfaces)
 *   --no-enumerate      skip the AST enumerator; use the regex detectors
 *   --no-fetch          skip fetch-threat.sh; cite straight from the index
 *                       (used by tests for hermetic, network-free runs)
 *   --no-dashboard      write findings.json only
 *
 * Exit codes:
 *   0 — completed, gate not tripped
 *   2 — completed, fail-on gate tripped
 *   3 — invalid invocation / target not found
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { scanDir, scopeFromKinds } = require('./lib/static-detectors');

const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(REPO_ROOT, 'reference', 'taxonomy-index.json');
const FETCH_SCRIPT = path.join(REPO_ROOT, 'scripts', 'fetch-threat.sh');
const RENDERER = path.join(REPO_ROOT, 'scripts', 'render-dashboard.js');

const FAIL_LEVELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const GATE_RANK = { LOW: 2, MEDIUM: 3, HIGH: 4, CRITICAL: 5 };

const FOOTER_NOTE =
  'First-pass static screen produced by the owasp-ai-audit GitHub Action. ' +
  'It surfaces AI attack surfaces and cites the OWASP AI Exchange threats they ' +
  'implicate, but does NOT grade severity — every finding is UNKNOWN. A full ' +
  'audit requires the SKILL.md workflow running inside Claude Code, which reads ' +
  'the implicated files end-to-end and assigns verdicts per reference/verdict-rules.md.';

function parseArgs(argv) {
  const opts = {
    target: null, failOn: 'NONE',
    out: 'findings.json', dashboard: 'dashboard.html',
    surfaces: null, enumerate: true, fetch: true, renderDashboard: true
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fail-on') opts.failOn = String(argv[++i] || '').toUpperCase();
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--dashboard') opts.dashboard = argv[++i];
    else if (a === '--surfaces') opts.surfaces = argv[++i];
    else if (a === '--no-enumerate') opts.enumerate = false;
    else if (a === '--no-fetch') opts.fetch = false;
    else if (a === '--no-dashboard') opts.renderDashboard = false;
    else if (!a.startsWith('-') && !opts.target) opts.target = a;
  }
  return opts;
}

// Normalise a surfaces.json entry list to the flat shape the runner uses.
function normalizeSurfaces(list) {
  return list.map((s) => ({
    file: s.file,
    line: s.line ?? s.line_start ?? 0,
    kind: s.kind,
    evidence_excerpt: s.evidence_excerpt || s.name || ''
  }));
}

// Discover AI surfaces, preferring (in order): a pre-built surfaces.json, the
// deterministic AST enumerator, then the regex detectors. The enumerator is
// the accurate path; the regex detectors are the dependency-light fallback for
// environments where the vendored tree-sitter runtime can't load.
async function loadSurfaces(opts) {
  if (opts.surfaces && fs.existsSync(opts.surfaces)) {
    const doc = JSON.parse(fs.readFileSync(opts.surfaces, 'utf8'));
    const list = Array.isArray(doc) ? doc : (doc.surfaces || []);
    return { source: 'enumerator', surfaces: normalizeSurfaces(list) };
  }
  if (opts.enumerate) {
    try {
      const { enumerateDir } = require('./enumerate-ai-surfaces');
      const doc = await enumerateDir(opts.target);
      return { source: 'enumerator', surfaces: normalizeSurfaces(doc.surfaces) };
    } catch (e) {
      console.error(`enumerator unavailable (${e.message}); falling back to regex detectors.`);
    }
  }
  return { source: 'regex', ...scanDir(opts.target) };
}

// Resolve a slug to { url, title, source } — live via fetch-threat.sh, or
// straight from the index when --no-fetch or the fetch fails.
function citation(slug, indexEntry, doFetch) {
  if (doFetch) {
    try {
      const out = execFileSync('bash', [FETCH_SCRIPT, slug], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000
      });
      const j = JSON.parse(out);
      if (j.url) return { url: j.url, title: j.title || indexEntry?.title || slug, source: j.source || 'live' };
    } catch { /* fall through to index */ }
  }
  return { url: indexEntry?.url, title: indexEntry?.title || slug, source: 'index' };
}

function evidenceString(surfaces, max = 3) {
  const shown = surfaces.slice(0, max)
    .map((s) => `${s.file}:${s.line}` + (s.evidence_excerpt ? ` — ${s.evidence_excerpt}` : ''))
    .join('; ');
  const extra = surfaces.length > max ? ` (+${surfaces.length - max} more)` : '';
  return `${surfaces.length} static surface(s): ${shown}${extra}`;
}

// Pick the least-fresh source actually used, so we never over-claim freshness.
function dominantGrounding(sources) {
  if (sources.has('snapshot')) return 'snapshot';
  if (sources.has('index')) return 'index';
  if (sources.has('cache')) return 'cache';
  if (sources.has('live')) return 'live';
  return 'index';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.target) {
    console.error('usage: run-audit.js <target> [--fail-on LEVEL] [--out f] [--dashboard f] [--surfaces f] [--no-fetch]');
    process.exit(3);
  }
  if (!FAIL_LEVELS.includes(opts.failOn)) {
    console.error(`--fail-on must be one of ${FAIL_LEVELS.join('|')}`);
    process.exit(3);
  }
  if (!fs.existsSync(opts.target)) {
    console.error(`target not found: ${opts.target}`);
    process.exit(3);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const bySlug = {};
  for (const e of [...index.threats, ...(index.controls || [])]) bySlug[e.slug] = e;

  const { source: surfaceSource, surfaces } = await loadSurfaces(opts);
  const kinds = new Set(surfaces.map((s) => s.kind));
  const { categories, threatSlugs, threatKinds, threatControls } = scopeFromKinds(kinds);

  // surfaces grouped by the kinds that implicate each threat
  const surfacesByKind = {};
  for (const s of surfaces) (surfacesByKind[s.kind] ||= []).push(s);

  const groundingSources = new Set();
  const findings = [];

  for (const slug of [...threatSlugs].sort()) {
    const entry = bySlug[slug];
    if (!entry) continue;   // defensive: every SIGNALS slug should be in the index
    const evKinds = [...(threatKinds[slug] || [])];
    const evidenceSurfaces = evKinds.flatMap((k) => surfacesByKind[k] || []);
    if (evidenceSurfaces.length === 0) continue;   // no detectable static evidence

    const cite = citation(slug, entry, opts.fetch);
    groundingSources.add(cite.source);

    const controls = [...(threatControls[slug] || [])].map((cs) => {
      const ce = bySlug[cs];
      const cc = citation(cs, ce, opts.fetch);
      groundingSources.add(cc.source);
      return {
        control_id: ce?.id || cs,
        url: cc.url,
        summary: `See OWASP control "${cc.title}". The static screen cannot confirm it is applied — verify in a full audit.`
      };
    });

    findings.push({
      threat_id: entry.id,
      threat_url: cite.url,
      category: entry.category,
      verdict: 'UNKNOWN',
      evidence: evidenceString(evidenceSurfaces),
      reasoning:
        `Static screen detected ${evKinds.join(', ')} surface(s) that implicate this threat. ` +
        'Severity is not graded: a non-LLM pass cannot judge isolation, validation, or exposure. ' +
        'Run the full SKILL.md workflow in Claude Code to assign a verdict.',
      recommended_controls: controls
    });
  }

  // Rollup: a category with ungraded surfaces is "needs review" (AMBER).
  const allCategories = ['general-controls', 'input-threats', 'dev-time', 'runtime', 'testing', 'privacy'];
  const rollup = {};
  const catsWithFindings = new Set(findings.map((f) => f.category));
  for (const c of allCategories) rollup[c] = catsWithFindings.has(c) ? 'AMBER' : 'GREEN';
  rollup.overall = findings.length ? 'Needs Review' : 'No AI surface detected';

  const now = new Date().toISOString();
  const doc = {
    audit_id: `static-${now.replace(/[^0-9]/g, '').slice(0, 14)}`,
    timestamp: now,
    subject: { type: 'codebase', identifier: path.resolve(opts.target) },
    scope: {
      system_kind: kinds.has('rag-embeddings') ? 'rag'
        : kinds.has('tool-definition') ? 'agent'
        : kinds.has('llm-call') ? 'llm-app' : 'mixed',
      included_categories: [...categories].sort(),
      excluded_categories: allCategories.filter((c) => !categories.has(c)),
      exclusion_reasons: { _static: 'Categories with no statically-detectable AI surface in the target.' }
    },
    grounding: {
      primary_source: dominantGrounding(groundingSources),
      surface_discovery: surfaceSource,
      fetched_at: now
    },
    findings,
    rollup,
    footer_note: FOOTER_NOTE
  };

  fs.writeFileSync(opts.out, JSON.stringify(doc, null, 2) + '\n');
  console.log(`Wrote ${findings.length} static finding(s) to ${opts.out} (surfaces via ${surfaceSource}).`);

  if (opts.renderDashboard) {
    execFileSync('node', [RENDERER, opts.out, opts.dashboard], { stdio: 'inherit' });
  }

  // Gate.
  const gated = gateTripped(findings, opts.failOn);
  if (gated.tripped) {
    console.error(`fail-on=${opts.failOn} tripped: ${gated.reason}`);
    process.exit(2);
  }
  console.log(`fail-on=${opts.failOn}: gate not tripped.`);
  process.exit(0);
}

// Decide whether the fail-on gate trips. UNKNOWN findings are treated as
// worst-case (rank CRITICAL) because a static screen cannot prove an ungraded
// surface sits below the threshold. Graded findings compare by their own rank.
function gateTripped(findings, failOn) {
  if (failOn === 'NONE') return { tripped: false };
  const threshold = GATE_RANK[failOn];
  for (const f of findings) {
    const rank = f.verdict === 'UNKNOWN' ? GATE_RANK.CRITICAL : (GATE_RANK[f.verdict] || 0);
    if (rank >= threshold) {
      return { tripped: true, reason: `${f.verdict} finding ${f.threat_id} meets/exceeds ${failOn}` };
    }
  }
  return { tripped: false };
}

module.exports = { gateTripped, parseArgs };

if (require.main === module) main().catch((e) => { console.error('Fatal:', e); process.exit(1); });

// audit-summary.js — turn a findings.json object into a short Markdown
// summary (overall posture, severity counts, top findings with permalinks).
// Pure and dependency-free so it can be unit-tested and reused by both the
// inline chat summary and the PR comment. Exercised by tests/run-audit.test.js.

const VERDICT_RANK = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, UNKNOWN: 1.5, PASS: 1, 'N/A': 0 };
const VERDICT_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN', 'PASS', 'N/A'];

function countBySeverity(findings) {
  const counts = {};
  for (const v of VERDICT_ORDER) counts[v] = 0;
  for (const f of findings.findings || []) {
    counts[f.verdict] = (counts[f.verdict] || 0) + 1;
  }
  return counts;
}

// Top-N findings, worst severity first, ties broken by document order.
function topFindings(findings, n = 3) {
  return [...(findings.findings || [])]
    .map((f, i) => ({ f, i }))
    .sort((a, b) =>
      (VERDICT_RANK[b.f.verdict] ?? 0) - (VERDICT_RANK[a.f.verdict] ?? 0) || a.i - b.i)
    .slice(0, n)
    .map((x) => x.f);
}

// Build a Markdown summary suitable for a PR comment. `title` lets the caller
// brand it (e.g. the CI runner adds the "first-pass screen" framing).
function buildSummary(findings, opts = {}) {
  const title = opts.title || 'OWASP AI Audit';
  const overall = findings.rollup?.overall || 'Unknown';
  const counts = countBySeverity(findings);
  const total = (findings.findings || []).length;

  const countLine = VERDICT_ORDER
    .filter((v) => counts[v] > 0)
    .map((v) => `${v}: ${counts[v]}`)
    .join(' · ') || 'no findings';

  const lines = [];
  lines.push(`### ${title}`);
  lines.push('');
  lines.push(`**Overall posture:** ${overall}  `);
  lines.push(`**Findings (${total}):** ${countLine}  `);
  const subj = findings.subject?.identifier;
  if (subj) lines.push(`**Subject:** \`${subj}\`  `);
  const grounding = findings.grounding?.primary_source;
  if (grounding) lines.push(`**Grounding:** ${grounding}  `);
  lines.push('');

  const top = topFindings(findings, 3);
  if (top.length) {
    lines.push('**Top findings**');
    lines.push('');
    for (const f of top) {
      const id = f.threat_id || f.threat_url || 'finding';
      const link = f.threat_url ? `[${id}](${f.threat_url})` : id;
      const ev = f.evidence ? ` — ${f.evidence}` : '';
      lines.push(`- \`${f.verdict}\` ${link}${ev}`);
    }
    lines.push('');
  }

  if (findings.footer_note) {
    lines.push(`> ${findings.footer_note}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

module.exports = { buildSummary, countBySeverity, topFindings, VERDICT_RANK, VERDICT_ORDER };

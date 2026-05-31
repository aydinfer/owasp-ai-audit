# Contributing

Thanks for considering a contribution. The shape of this project is intentionally narrow — it's a single Claude Code skill, not a framework — so changes are most welcome when they keep that shape.

## Principles

1. **Live ground truth over invention.** Every threat reference in [`reference/taxonomy-index.json`](reference/taxonomy-index.json) must resolve to HTTP 200 on `owaspai.org`. Note the `/go/{slug}/` URLs are 302 redirects to chapter anchors, so any check must follow redirects (`curl -L`) — a no-follow `curl -I` sees the 302, not the 200. The verification is automated — see below.
2. **No third-party runtime deps.** The skill runs against Node's stdlib, plus `curl` and `jq`. Adding an npm dependency is a significant change; please open an issue first.
3. **Deep Trace before opinion.** Don't propose verdict-rule changes from a sample of one audit. Run the skill against several systems first and bring the data.

## Local checks before opening a PR

```bash
# 1. Unit tests for the security-critical helpers (esc/safeUrl), the chapter
#    parser (htmlToText/extractSections), and the CI runner's static detectors
#    + fail-on gate (run-audit) — no third-party deps.
node --test tests/*.test.js

# 2. Every taxonomy entry must resolve against the live source
node scripts/snapshot-update.js

# 3. The example dashboard should still render
node scripts/render-dashboard.js examples/findings.json examples/dashboard.html
```

All three should exit 0 with no errors. The snapshot script prints a summary at the end (`Done. N ok, 0 failed.`) — `0 failed` is required. The tests need Node 18+ (built-in test runner).

## Updating the taxonomy index

The index is generated from the six OWASP AI Exchange chapter pages (`/docs/1_general_controls/` through `/docs/6_privacy/`) by parsing every `Category: ... <br> Permalink: ...` block. If OWASP adds, renames, or removes a slug, the right fix is:

1. Refetch the relevant chapter page(s)
2. Edit `reference/taxonomy-index.json` to reflect the change, preserving the schema (`id`, `slug`, `title`, `kind`, `category`, `url`, `applies_to`)
3. Run `node scripts/snapshot-update.js` — should be silent success
4. Run `node scripts/reground-applies-to.js` if a section's content has changed in a way that affects `applies_to`
5. Commit both the index change and the regenerated snapshot

Do not hand-edit the snapshot files directly — they're a build artifact.

### About `applies_to`

The `applies_to` field on each entry (`genai` / `predictive` / `agent`) is derived by [`scripts/reground-applies-to.js`](scripts/reground-applies-to.js). The script:

1. Fetches the six live chapter pages
2. Extracts each slug's section (text between its own Permalink block and the next)
3. Pattern-matches the section text for explicit kind signals (`LLM`, `prompt`, `classifier`, `evasion`, `agentic`, `MCP`, etc.)
4. Applies a small set of slug-specific overrides for canonical attack/control families where prose alone is too generic (e.g., evasion is the predictive-ML attack family by construction; prompt injection is GenAI/agent by construction)
5. Defaults un-distinguished sections to `[genai, predictive]`; never adds `agent` without an explicit signal

This is a heuristic with traceable rules, not a manual reading of every page. If you think a tag is wrong, the right fix order is: open an issue with the slug and the OWASP language you're citing → adjust the OVERRIDES list in [`scripts/reground-applies-to.js`](scripts/reground-applies-to.js) → re-run and commit both the script and the regenerated `applies_to` values.

Run `node scripts/reground-applies-to.js --dry-run --verbose` to preview changes without writing.

## Verdict-rule changes

[`reference/verdict-rules.md`](reference/verdict-rules.md) is load-bearing for the skill's outputs. Changes that loosen rules (e.g., allowing PASS without a cited control) will not be accepted. Changes that close gaps (e.g., the current rules don't define a colour for "exactly 1–2 MEDIUM in a category" — that's a real gap) are welcome.

## Snapshot refresh PRs

The GitHub Action at `.github/workflows/snapshot-refresh.yml` opens a weekly PR with the refreshed snapshot. These should auto-merge on green. If one shows a *taxonomy* drift (a slug that no longer resolves), the PR will fail — that's the signal to update the index, not to skip the validation.

## The non-interactive CI runner (`action.yml` + `scripts/run-audit.js`)

The composite Action is a *static first-pass screen*, not the audit. Keep that contract intact:

1. **It never grades severity.** Every finding `run-audit.js` writes is `UNKNOWN`. Severity judgements require the LLM-driven SKILL.md workflow. A PR that makes the runner emit `HIGH`/`MEDIUM`/etc. from static signals alone will not be accepted — it would manufacture false confidence.
2. **Detectors map to real slugs.** Every `threats`/`controls` entry in [`scripts/lib/static-detectors.js`](scripts/lib/static-detectors.js) must exist in `taxonomy-index.json`; the `scopeFromKinds` test enforces this. Add a detector by adding a `SIGNALS` entry (kind, regexes, categories, threat slugs, control slugs) and a fixture that proves it fires *and* a decoy proving it doesn't false-positive.
3. **No third-party runtime deps.** `run-audit.js` and `pr-comment.js` use only Node stdlib (plus the existing `fetch-threat.sh`, which needs `curl`/`jq`). The PR comment posts via stdlib `https`, not a GitHub Action SDK.
4. **`fail-on` is conservative by construction.** An `UNKNOWN` is treated as worst-case for gating (it can't be cleared below a threshold statically), so any non-`NONE` level trips when ungraded surfaces exist. Don't "soften" this into a silent never-fail gate.

Surface discovery prefers the deterministic enumerator (`scripts/enumerate-ai-surfaces.js`, v0.4.0+) when a `surfaces.json` is available and falls back to the regex detectors otherwise.

## The AI-surface enumerator (`scripts/enumerate-ai-surfaces.js`)

The enumerator is a deterministic, AST-based catalogue of AI surfaces (Step 1.5 of the workflow). Rules for extending it:

1. **Queries, not line regex, for discovery.** Detectors live in `scripts/lib/ai-surface-detectors/<language>.js` as `{ kind, query, test }` tuples — a tree-sitter S-expression that captures the surface node and a discriminating node, plus a `test(caps)` over the captured *node text*. Matching on AST nodes is what stops strings, comments, and look-alikes (Vitest `test()`, readline `prompt`) from false-positiving. Don't reintroduce raw-line scanning here; that's what the CI runner's regex *fallback* is for.
2. **Add a fixture and a decoy.** A new detector needs a fixture under `tests/fixtures/` proving it fires *and* a decoy proving a similarly-named non-AI construct does **not**. `tests/enumerate.test.js` asserts both.
3. **`kind` vocabulary is shared.** Surfaces use the kinds in `SURFACE_KINDS` (`llm-call`, `prompt-construction`, `tool-definition`, `rag-embeddings`, `auth`, `rate-limit`); the CI runner maps a subset of these to taxonomy threats. Adding a new kind means updating both.

### Vendored tree-sitter parsers

`scripts/lib/parsers/` holds the tree-sitter runtime and grammar `.wasm`, vendored deliberately so there is **no runtime dependency and no install step** — the same supply-chain posture as the rest of the skill. The runtime and grammars must share a parser ABI; the pinned pair is `web-tree-sitter@0.20.8` + `tree-sitter-wasms@0.1.13` (ABI 14). If you bump one, bump both, regenerate `CHECKSUMS.txt`, and re-run `node --test tests/enumerate.test.js`. See [`scripts/lib/parsers/README.md`](scripts/lib/parsers/README.md).

## Cross-references (OWASP → MITRE ATLAS + NIST)

[`reference/cross-references.json`](reference/cross-references.json) maps an OWASP slug to the MITRE ATLAS techniques/mitigations and NIST AI 100-2 sections describing the **same** phenomenon. OWASP stays the primary citation; these are additive anchors for compliance and threat-intel audiences.

The bar for adding a cross-reference is deliberately high: **the secondary source must describe the same threat phenomenon, not merely the same vague theme.** "Both mention training data" is not a mapping. "OWASP `indirectpromptinjection` and ATLAS `AML.T0051.001` both describe an LLM ingesting attacker-controlled content from a retrieved/third-party source" is. When unsure, leave it out — a missing anchor is honest; a loose one is noise that erodes trust in every other citation.

Rules (enforced by `tests/cross-references.test.js` and `scripts/snapshot-update.js`):

- Every map key must be a slug already in `taxonomy-index.json`.
- Every entry needs at least one ATLAS or NIST anchor.
- **ATLAS ids must exist in the authoritative [`atlas-data`](https://github.com/mitre-atlas/atlas-data) dataset** — `snapshot-update.js` verifies this on every run. The `atlas.mitre.org` technique/mitigation pages are client-rendered and 404 to `curl`/CI, so we verify ids against the dataset rather than a naive 200-check — the same lesson the OWASP `/go/` 302 redirects taught this repo. Technique ids cite `/techniques/{id}`; mitigation ids cite `/mitigations/{id}`.
- NIST refs name the taxonomy's attack-class section (e.g. "Predictive AI — Evasion Attacks and Mitigations") and point at the e2025 publication URL, which returns 200. Don't cite a subsection number you can't verify.

## Releasing

- Patch (`v0.2.x`): bug fixes, snapshot refreshes, minor renderer polish
- Minor (`v0.x.0`): taxonomy changes, new fields in `findings.json`, renderer additions
- Major (`v1.0.0`): change to `SKILL.md`'s contract (the workflow steps, the schema) — coordinate on an issue first

# owasp-ai-audit

> A Claude Code skill that audits AI systems against the [OWASP AI Exchange](https://owaspai.org/) threat taxonomy. Grounded in live content. Cites every finding. Produces a self-contained HTML dashboard that prints to PDF.

## Why this exists

**Most LLM-driven security audits lie — not on purpose, by construction.** You point a model at your codebase, ask "is this AI system safe?", and it writes a confident report that checked a handful of things, missed most of the taxonomy, found one scary-looking issue, and stamped the whole thing "Acceptable." It *looks* thorough. Nothing in the process forces it to admit how little it actually examined.

That's not hypothetical — it's exactly how this project's own v0.x behaved. Its first real run graded **8 of 97** threat entries, read **~5%** of the files, and labelled the result "Acceptable." A highlights reel wearing the costume of a complete audit.

**v1.0.0 is a contract change that makes that dishonesty impossible.** The design rests on three ideas:

1. **Completeness is structural, not optional.** An audit isn't "some findings" — it's an explicit verdict on *every applicable* taxonomy entry, driven through eight mandatory layers, each with a coverage score. Silence on an applicable threat is a measured failure, not a clean result.
2. **The posture is capped by what you actually looked at.** If your weakest layer is under 70%, the report says **"Screen only — not an audit"** on page one, in the biggest type — no matter how clean the findings list looks. You cannot dress up a partial look as a clean bill of health.
3. **The model writes the verdicts; the tool does the math.** Left to grade itself, an LLM fudges (in testing it called three AMBER categories "Acceptable"). So the rollup, the posture, and the severity caps are computed *deterministically in code*, and severity is bounded by how it was evidenced — reasoning alone caps at MEDIUM, a written probe at HIGH, an *executed* probe at CRITICAL. A hand-edited number can't survive it.

The result is an audit that is honest about its own limits — which is the only kind worth trusting. The rest of this README is the **what** and the **how**.

## What this is

A drop-in skill folder for [Claude Code](https://claude.ai/code). Point Claude at a codebase or paste an architecture description, ask for an OWASP AI audit, and get back:

- A **page-one coverage panel** scoring eight mandatory completeness layers, with the overall posture **capped by the lowest layer** — so a partial look can never be dressed up as "Acceptable"
- A **verdict ledger** with an explicit verdict on *every applicable* taxonomy entry (not a highlights reel), including every justified `N/A`
- Per-finding verdicts (`CRITICAL` / `HIGH` / `MEDIUM` / `LOW` / `PASS` / `N/A`) with concrete evidence, reasoning, and an **evidence class** (`static` / `reasoned-probe` / `demonstrated`) that caps how severe a finding may be graded
- Every threat reference linked to its `owaspai.org/go/{slug}/` permalink; recommended controls likewise
- A traffic-light dashboard across the six OWASP AI Exchange categories — a printable, self-contained HTML report, no servers, no external assets

## How it works: completeness by construction

Concretely, an audit is driven through **eight ordered, mandatory layers**, each with a coverage formula:

| | Layer | Coverage |
|---|---|---|
| L1 | Surface inventory | files read end-to-end / AI-relevant files |
| L2 | Taxonomy completeness | entries verdicted / applicable entries |
| L3 | Auth/authz matrix | cells filled / grid cells |
| L4 | Trust-boundary depth | subareas covered / 7 |
| L5 | Probe verification | HIGH+ findings with a probe / HIGH+ findings |
| L6 | Regulatory pass | obligations addressed / obligations (declared jurisdictions) |
| L7 | Operational pass | subareas covered / 4 |
| L8 | Race / TOCTOU pass | patterns inspected / patterns identified |

The reported posture is then **capped**: ≥90% on every layer → posture as graded; any layer 70–90% → "Partial — acceptable for what was read (NN%)"; any layer <70% → **"Screen only — not an audit."**

**The model writes the verdicts; the tool does the math.** The rollup, the graded posture, the L5 probe ratio and the evidence tally are *not* left to the LLM (it gets them wrong — a 3-AMBER rollup once shipped as "Acceptable"). [`scripts/finalize-findings.js`](scripts/finalize-findings.js) recomputes them deterministically from your `verdict_ledger` and **fails the run** if any finding exceeds its evidence-class cap; the renderer self-computes the same numbers so it can never *display* a fudged one. A hand-edited percentage or posture cannot survive. So anyone can clone this, point Claude at their own repo, and get the same trustworthy arithmetic — that's the point. See [SKILL.md](SKILL.md) for the layer definitions and [reference/verdict-rules.md](reference/verdict-rules.md) for the caps.

![Dashboard screenshot — an owasp-ai-audit report](docs/dashboard-screenshot.png)

*An owasp-ai-audit dashboard: traffic-light rollup, per-finding cards each citing an `owaspai.org/go/{slug}/` permalink. Under v1.0.0 the report now leads with a page-one **coverage panel** and closes with the full **verdict ledger** — see a live one in [the vercel/ai-chatbot v1.0.0 report](benchmarks/vercel-ai-chatbot/dashboard.html).*

## Proven on real code: the vercel/ai-chatbot regression

v1.0.0 isn't a spec — it's enforced, and the proof is a side-by-side re-audit of [`vercel/ai-chatbot`](https://github.com/vercel/ai-chatbot) ([full write-up](benchmarks/v0.2.2-vs-v1.0.0.md)):

| | **v0.2.2** | **v1.0.0** |
|---|---|---|
| Taxonomy entries adjudicated | **26 / 97** (~27%, the rest silent) | **97 / 97** — 85 applicable + 12 justified `N/A` |
| Coverage measured? | no | **yes — 8 layers, mean 100%** |
| Auth/authz matrix | none | **30 cells** (anon/guest/regular × 5 resources) |
| Highest severity | `HIGH` ×1 (asserted, no probe) | `HIGH` ×2 (each backed by a verbatim probe; L5 = 2/2) |
| **Reported posture** | **Acceptable** | **Concerning** |

The v0.2.2 run graded a quarter of the taxonomy, shipped one un-evidenced `HIGH`, and mislabelled its own AMBER rollup "Acceptable." v1.0.0 makes all three impossible: every applicable entry gets a verdict, severity is **capped by evidence class** (`static`→MEDIUM, `reasoned-probe`→HIGH, `demonstrated`→CRITICAL), and the posture is recomputed deterministically and **bounded by the lowest-covered layer**. A deep reasoned-probe pass then earned two HIGHs the honest way — cost-amplification via uncounted nested `streamText`, and always-on geolocation injection — while most attack paths' defenses *held* and were graded down accordingly. More verdicts, lower posture, fully measured, every HIGH probed.

## Why grounding matters

LLMs hallucinate threat categories, invent CVE numbers, and confidently mis-cite OWASP. This skill refuses to. Every finding cites a real permalink on owaspai.org. If the source can't be fetched and isn't in the bundled snapshot, the finding doesn't ship.

## How this differs from Claude Code's `/security-review`

Claude Code already ships with a `/security-review` skill. It's good. This skill does something different. Run both.

|                       | **`/security-review`** (built-in)                                  | **`owasp-ai-audit`** (this skill)                                                                       |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **Scope**             | Pending diff on the current branch                                 | The whole AI system — codebase or architecture description                                              |
| **Threat surface**    | General app sec: SQLi, XSS, secrets, auth, OWASP Web Top 10        | AI-specific: prompt injection, RAG poisoning, model theft, training-data leak, agent over-privilege, alignment, etc. |
| **Source of truth**   | Claude's general knowledge of security patterns                    | The OWASP AI Exchange taxonomy — every finding cites a `/go/{slug}/` permalink                          |
| **When to run**       | Before merging a PR                                                | Before shipping an AI feature, or auditing one that's already live                                      |
| **Output**            | Prose review in chat                                               | `findings.json` + a self-contained `dashboard.html` (print-to-PDF for sharing)                          |
| **Will catch**        | "You're concatenating SQL strings at `db.py:42`"                   | "Your RAG retrieves from a user-editable KB without provenance — that's indirect prompt injection"      |
| **Will miss**         | The RAG-injection thing above                                      | The SQL concat thing                                                                                    |

They're complementary by design. `/security-review` won't flag prompt injection — it's not a Web Top-10 concern. `owasp-ai-audit` won't flag a credential in `.env` — that's not an AI threat. The honest workflow on a serious AI system: run both, treat the outputs as a union, fix everything.

## Does it audit, or does it also fix?

It audits and **recommends grounded controls**. It does *not* write patches.

Every finding includes a `recommended_controls` list. Each control is itself an OWASP-cited permalink with a short summary of what to do — e.g. for indirect prompt injection, the recommendation cites [`/go/promptinjectionsevenlayers/`](https://owaspai.org/go/promptinjectionsevenlayers/) (the layered defence) and [`/go/inputsegregation/`](https://owaspai.org/go/inputsegregation/) (treat retrieved content as untrusted). You implement; the skill points at the canonical reference.

This is deliberate. Auto-patching a security finding without human review is how you ship false confidence — a "fix" that closes the lint warning but not the actual attack path. The recommendation pattern is: *the skill grades the system, cites the literature, and a human makes the call on the patch* (with Claude Code's normal coding tools, in a follow-up turn, if you want).

If you do want a patch turn after the audit, just ask:

```
Take the HIGH and CRITICAL findings from dashboard.html and propose patches.
```

That's normal Claude Code — the audit happens to give you a structured, cited starting point.

## Use as a CI check

Beyond the interactive skill, this repo ships a **composite GitHub Action** that runs a non-interactive *static first-pass screen* on every PR. Add it to a workflow:

```yaml
# .github/workflows/owasp-ai-audit.yml
name: OWASP AI Audit
on: [pull_request]
permissions:
  contents: read
  pull-requests: write   # only needed for comment-pr
jobs:
  screen:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: aydinfer/owasp-ai-audit@v1
        with:
          target: .
          fail-on: HIGH        # NONE | LOW | MEDIUM | HIGH | CRITICAL
          comment-pr: true     # post the screen summary as a PR comment
```

What it does, and — importantly — what it does *not* do:

- It statically catalogues the AI surfaces in `target` (the twelve kinds below — LLM calls, prompt construction, tools, embeddings, plus api-routes, auth, code-exec, sandbox, log-sink and external-fetch), maps each to the OWASP AI Exchange threats it implicates, and fetches a live `/go/{slug}/` citation for every one.
- It writes a `findings.json` (with a zero-on-reasoning-layers `coverage` block) + `dashboard.html` and (on PR events) posts a summary comment.
- **It does not grade severity, and it says so structurally.** A non-LLM pass can't judge whether input is isolated, output is validated, or a surface is actually exposed — so every finding it writes is `UNKNOWN`, and the dashboard self-labels **"Screen only — not an audit"** through the exact coverage cap a full audit obeys. Its job is to surface *presence* and *citations*, then point you at the real audit.

Because findings are ungraded, the `fail-on` gate is conservative: an `UNKNOWN` is treated as *"could be anything up to CRITICAL"* and so trips **any** threshold other than `NONE`. Set `fail-on: NONE` (the default) for a report-only screen, or any level to block PRs until a human runs the full [SKILL.md](SKILL.md) workflow in Claude Code. The PR comment it posts looks like:

> ### OWASP AI Audit — static first-pass screen
>
> **Overall posture:** Screen only — not an audit  
> **Findings (8):** UNKNOWN: 8
>
> **Top findings**
> - `UNKNOWN` [INPUT-DIRECTPROMPTINJECTION](https://owaspai.org/go/directpromptinjection/) — 4 static surface(s): `app/chat.ts:7` …
> - `UNKNOWN` [RUN-AUGMENTATIONDATALEAK](https://owaspai.org/go/augmentationdataleak/) — `lib/rag.ts:9` …
>
> _First-pass static screen — surfaces presence and citations, not severity. Run the full SKILL.md audit in Claude Code for verdicts._

The Action runs on Node 22 with zero third-party runtime dependencies (Node stdlib + `curl` + `jq`), in keeping with the skill's supply-chain posture.

## Deterministic AI-surface enumerator

Before the audit reasons about anything, it statically catalogues every AI surface in a codebase:

```bash
node scripts/enumerate-ai-surfaces.js path/to/repo --out surfaces.json
```

This parses each TypeScript / TSX / JavaScript / Python / Go file with a vendored tree-sitter grammar and matches **structural queries**, emitting a `surfaces.json` where each entry carries the file, line range, kind, name, enclosing `callers`, and an evidence excerpt. v1.0.0 detects twelve kinds — the LLM core (`llm-call`, `prompt-construction`, `tool-definition`, `rag-embeddings`, `auth`, `rate-limit`) plus the trust-boundary/operational kinds the completeness layers need: `code-exec`, `sandbox`, `api-route`, `log-sink`, `external-fetch`, `training`. Because detection runs on the AST and not on raw text, it doesn't trip on strings, comments, or look-alikes (Vitest's `test()`, readline's `prompt`, `Math.exp`, a local `get`). `external-fetch` fires only on literal absolute non-loopback URLs.

Why it matters: the [benchmark run](benchmarks/skill-issues.md) found the real attack surface routinely lived in files too large to read end-to-end (a 5204-line `middleware.py`, an 11806-line `router.py`). Enumerating surfaces first anchors every finding to a detected node instead of to whatever fit in context. Both the GitHub Action and the interactive [SKILL.md](SKILL.md) workflow (Step 1.5) use it; the CI runner falls back to regex detectors only if the vendored runtime can't load.

The tree-sitter runtime and grammar `.wasm` files are vendored, pinned and checksummed under [`scripts/lib/parsers/`](scripts/lib/parsers/) — no `npm install`, no runtime dependency. See that directory's README for versions and provenance.

## Multi-source grounding (OWASP + MITRE ATLAS + NIST)

OWASP AI Exchange stays the **primary** citation, but a finding that maps to other authoritative catalogues now cites them too. [`reference/cross-references.json`](reference/cross-references.json) is a hand-curated map from an OWASP slug to the [MITRE ATLAS](https://atlas.mitre.org/) techniques/mitigations and [NIST AI 100-2e2025](https://csrc.nist.gov/pubs/ai/100/2/e2025/final) sections that describe the *same* phenomenon — the secondary anchors compliance and threat-intel audiences expect. The dashboard renders them as a second citation line under each finding (e.g. `Also: ATLAS AML.T0051.001 · NIST: Generative AI — Indirect Prompt Injection`).

These are additive, never replacements, and curated conservatively (same phenomenon, not same theme — see CONTRIBUTING). `scripts/snapshot-update.js` verifies every cited ATLAS id against the authoritative [`atlas-data`](https://github.com/mitre-atlas/atlas-data) dataset and every NIST URL by HTTP — alongside the OWASP set, on every run.

## Install

```bash
# In your Claude Code skills directory:
git clone https://github.com/aydinfer/owasp-ai-audit.git
```

The skill is auto-discovered by Claude Code when placed in a skills directory.

### Requirements

- `bash` and `curl` (standard on macOS / Linux / WSL)
- `jq` — used by the fetch script for taxonomy lookups
  - macOS: `brew install jq`
  - Debian/Ubuntu: `apt-get install jq`
- `node` 18+ — used by the dashboard renderer
- Network access to `owaspai.org` (or use bundled snapshot)

## Usage

In Claude Code:

```
Audit this repo against OWASP AI Exchange.
```

or

```
Here's our architecture for a RAG-based assistant: [paste description].
Run an OWASP AI audit on it.
```

The skill detects the input type, scopes the audit, fetches threat content (cached or live), produces findings, and renders a dashboard. Open the dashboard in any browser and use **Print → Save as PDF** to share.

## The run pipeline, end to end

The full audit (inside Claude Code) is driven through the eight mandatory layers — completeness is the control flow, not an afterthought:

```
input  →  [detect: codebase | architecture; declare jurisdiction for L6]
  ↓
L1  enumerate-ai-surfaces.js → surfaces.json   (every finding must anchor here)
  ↓
L2  taxonomy-index.json → applicable entries; verdict on EVERY one (ledger)
      fetch-threat.sh per entry: memory → disk cache → live → snapshot
  ↓
L3  auth/authz matrix    L4  trust-boundary (7 subareas)    L5  evidence class caps severity
L6  regulatory pass      L7  operational (4 subareas)        L8  race / TOCTOU
      ↓ Deep Trace: read implicated files end-to-end; grade per verdict-rules.md
  ↓
[write findings.json: coverage{} + verdict_ledger[] + findings[] + evidence_class]
  ↓
finalize-findings.js  →  the model wrote the verdicts; the TOOL computes the
      rollup, graded posture, L5 ratio + evidence tally, and FAILS on any finding
      above its evidence-class cap. coverage.js then caps posture by lowest layer.
  ↓
render-dashboard.js → dashboard.html   (self-computes the same math; coverage
      panel first, ledger appendix last)
  ↓
[open in browser → Print → Save as PDF]
```

The composite GitHub Action is the non-interactive counterpart: it runs L1 + a citation pass only, emits `UNKNOWN` verdicts, and — through the same coverage cap — self-labels **"Screen only — not an audit."**

## Repo layout

```
owasp-ai-audit/
├── SKILL.md                              # The skill instructions Claude reads
├── action.yml                            # Composite GitHub Action (CI static screen)
├── reference/
│   ├── taxonomy-index.json               # Map of OWASP AI threats + controls + permalinks
│   ├── cross-references.json             # OWASP slug → MITRE ATLAS + NIST AI 100-2 anchors
│   ├── llm-top10-2025.json               # OWASP LLM Top 10 (2025) → AI Exchange slug mapping
│   ├── verdict-rules.md                  # Severity rules + evidence-class & coverage caps
│   └── snapshot/                         # Offline fallback (auto-refreshed weekly)
├── scripts/
│   ├── lib/
│   │   ├── sanitize.js                   # esc(), safeUrl() — used by the renderer
│   │   ├── extract.js                    # htmlToText(), extractSections() — used by the regrounder
│   │   ├── static-detectors.js           # regex AI-surface detectors (CI runner fallback)
│   │   ├── audit-summary.js              # findings.json → Markdown summary (PR comment)
│   │   ├── coverage.js                   # eight-layer coverage formulas + posture cap (the lever)
│   │   ├── ai-surface-detectors.js       # language registry for the AST enumerator
│   │   ├── ai-surface-detectors/         # per-language tree-sitter detector sets
│   │   └── parsers/                      # vendored tree-sitter runtime + grammar .wasm
│   ├── fetch-threat.sh                   # Cascaded fetch (memory → cache → live → snapshot)
│   ├── snapshot-update.js                # Refreshes bundled snapshot from owaspai.org
│   ├── reground-applies-to.js            # Re-derives applies_to from live chapter content
│   ├── enumerate-ai-surfaces.js          # Deterministic AST catalogue of AI surfaces → surfaces.json
│   ├── finalize-findings.js              # Recompute rollup/posture/L5 from verdicts; enforce evidence caps
│   ├── run-audit.js                      # Non-interactive CI runner (static first-pass screen)
│   ├── pr-comment.js                     # Posts the screen summary as a PR comment
│   └── render-dashboard.js               # findings.json → dashboard.html
├── examples/
│   ├── findings.json                     # Sample findings (RAG support assistant)
│   └── dashboard.html                    # Rendered example dashboard
├── tests/                                # Unit tests (node:test, no deps)
└── .github/workflows/
    └── snapshot-refresh.yml              # Weekly snapshot refresh PR
```

## Grounding modes

| Mode | When used | Reported as |
|------|-----------|-------------|
| `live` | Fresh fetch from owaspai.org | Footer note: "Findings grounded in live content fetched from owaspai.org at audit time." |
| `cache` | Disk cache within 7-day TTL (`~/.cache/owasp-ai-audit/`) | Footer note: "...recently cached content from owaspai.org (within 7-day TTL)." |
| `snapshot` | Live fetch failed, falling back to bundled snapshot | Footer note: "Live fetch failed. Findings grounded in bundled snapshot. Refresh snapshot or check connectivity." |

The dashboard always shows which mode was used. No silent degradation.

## Updating the snapshot

The snapshot in `reference/snapshot/` is auto-refreshed weekly by GitHub Actions, which opens a PR. To refresh locally:

```bash
node scripts/snapshot-update.js --verbose
```

## What it proves — and what it can't (read this)

Every finding carries an **evidence class** that caps how severe it may be graded. This is the honest ceiling on what the skill can claim:

| Evidence class | What backs it | Severity cap | Needs the app running? |
|---|---|---|---|
| `static` | file:line + reasoning | **MEDIUM** | no |
| `reasoned-probe` | the exact attack payload is written **and** reasoned through the real code, naming the behaviour it relies on | **HIGH** | no |
| `demonstrated` | that payload was **executed against a locally-running instance** (`npm run dev` on `localhost`) and the recorded result confirms it works | **CRITICAL** | **yes — but just `npm run dev`** |

**"Running instance" means a local dev server — `npm run dev` on `localhost`, a dev database, test credentials. It does NOT mean production.** If you're auditing your own repo you already have this running; reaching CRITICAL is the *normal* case, not an exotic one. The flow: Claude reads the code and authors a probe (→ HIGH, `reasoned-probe`), then — when a local instance is up — actually sends that probe to `localhost`, records the response, and grades it `demonstrated` → CRITICAL where it really fires.

Read-and-reason alone tops out at **HIGH** — *"here is the exact malicious input and why it should defeat your defence."* The only thing standing between HIGH and CRITICAL is *running the app locally and firing the probe*. The finalizer enforces the ladder both ways: a finding can't be CRITICAL without `demonstrated` evidence, and can't be HIGH without at least a `reasoned-probe`.

> The one time this *was* a hard limit was our own benchmark: we audited **vercel's** repo, which we never stood up, so every finding capped at HIGH. That's a property of auditing *someone else's* code you haven't run — not a limit of the skill on *your own* repo.

### Other honest limits

- **It audits; it does not patch.** Findings include grounded `recommended_controls` (each an OWASP permalink). A human implements the fix.
- **Coverage measures breadth, not perfection.** "100% on L4" means all seven trust-boundary subareas were *examined and verdicted* — not that all seven are secure. The verdicts say whether they're secure; the coverage says you looked.
- **The model writes the verdicts; the tool only does the arithmetic.** `finalize-findings.js` guarantees the rollup, posture, L5 and caps are computed correctly and honestly — it does **not** guarantee the auditing model's *reasoning* on any single entry is right. Deep-trace quality still depends on the model; the enforcement just stops it from overstating the result.
- **Not a compliance certification.** The L6 regulatory pass is evidence toward an obligation set you declare, not a legal stamp.
- **Not a substitute for `/security-review` or human review.** It covers AI-specific threats; run conventional app-sec review alongside it.

## License

MIT. See [LICENSE](LICENSE).

## Attribution

This skill is an *audit tool*. It is not affiliated with or endorsed by OWASP. The threat taxonomy it grounds against is the work of the [OWASP AI Exchange](https://owaspai.org/) project and its contributors. All threat content remains under the OWASP project's licence; this skill only references and links to it.

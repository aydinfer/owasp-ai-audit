# owasp-ai-audit

> A Claude Code skill that audits AI systems against the [OWASP AI Exchange](https://owaspai.org/) threat taxonomy. Grounded in live content. Cites every finding. Produces a self-contained HTML dashboard that prints to PDF.

## What this is

A drop-in skill folder for [Claude Code](https://claude.ai/code). Point Claude at a codebase or paste an architecture description, ask for an OWASP AI audit, and get back:

- A traffic-light dashboard across the six OWASP AI Exchange categories
- Per-finding verdicts (`CRITICAL` / `HIGH` / `MEDIUM` / `LOW` / `PASS` / `N/A`) with concrete evidence and reasoning
- Every threat reference linked to its `owaspai.org/go/{slug}/` permalink
- Recommended controls, also citing OWASP permalinks
- A printable, self-contained HTML report — no servers, no external assets

![Dashboard screenshot — the skill audited its own repo](docs/dashboard-screenshot.png)

*The screenshot above is the actual dashboard the skill produced when run on its own repository — every category green, one bug found and fixed (see [v0.2.0 → v0.2.1](https://github.com/aydinfer/owasp-ai-audit/releases)).*

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

## How it works

```
input
  ↓
[detect: codebase | architecture]
  ↓
[load taxonomy-index.json — the map of OWASP AI threats]
  ↓
[scope filter — drop threats irrelevant to system class]
  ↓
[fetch-threat.sh per threat: memory → disk cache → live → snapshot]
  ↓
[Claude analyses, grades per verdict-rules.md, follows Deep Trace on code]
  ↓
[write findings.json]
  ↓
[render-dashboard.js → dashboard.html]
  ↓
[user prints to PDF]
```

## Repo layout

```
owasp-ai-audit/
├── SKILL.md                              # The skill instructions Claude reads
├── reference/
│   ├── taxonomy-index.json               # Map of OWASP AI threats + controls + permalinks
│   ├── verdict-rules.md                  # Explicit severity assignment rules
│   └── snapshot/                         # Offline fallback (auto-refreshed weekly)
├── scripts/
│   ├── lib/
│   │   ├── sanitize.js                   # esc(), safeUrl() — used by the renderer
│   │   └── extract.js                    # htmlToText(), extractSections() — used by the regrounder
│   ├── fetch-threat.sh                   # Cascaded fetch (memory → cache → live → snapshot)
│   ├── snapshot-update.js                # Refreshes bundled snapshot from owaspai.org
│   ├── reground-applies-to.js            # Re-derives applies_to from live chapter content
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

## What this skill does NOT do

- Penetration testing — this is a *taxonomy audit*, not a live attack
- Compliance certification — output is evidence, not a stamp
- Code fixes — recommends controls, does not write patches
- Replace human security review — augments it

## License

MIT. See [LICENSE](LICENSE).

## Attribution

This skill is an *audit tool*. It is not affiliated with or endorsed by OWASP. The threat taxonomy it grounds against is the work of the [OWASP AI Exchange](https://owaspai.org/) project and its contributors. All threat content remains under the OWASP project's licence; this skill only references and links to it.

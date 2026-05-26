# owasp-ai-audit

> A Claude Code skill that audits AI systems against the [OWASP AI Exchange](https://owaspai.org/) threat taxonomy. Grounded in live content. Cites every finding. Produces a self-contained HTML dashboard that prints to PDF.

## What this is

A drop-in skill folder for [Claude Code](https://claude.ai/code). Point Claude at a codebase or paste an architecture description, ask for an OWASP AI audit, and get back:

- A traffic-light dashboard across the six OWASP AI Exchange categories
- Per-finding verdicts (`CRITICAL` / `HIGH` / `MEDIUM` / `LOW` / `PASS` / `N/A`) with concrete evidence and reasoning
- Every threat reference linked to its `owaspai.org/go/{slug}/` permalink
- Recommended controls, also citing OWASP permalinks
- A printable, self-contained HTML report — no servers, no external assets

## Why grounding matters

LLMs hallucinate threat categories, invent CVE numbers, and confidently mis-cite OWASP. This skill refuses to. Every finding cites a real permalink on owaspai.org. If the source can't be fetched and isn't in the bundled snapshot, the finding doesn't ship.

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
│   ├── fetch-threat.sh                   # Cascaded fetch (memory → cache → live → snapshot)
│   ├── snapshot-update.js                # Refreshes bundled snapshot from owaspai.org
│   └── render-dashboard.js               # findings.json → dashboard.html
├── templates/                            # Currently empty; renderer is self-contained
├── examples/
│   ├── findings.json                     # Sample findings (RAG support assistant)
│   └── dashboard.html                    # Rendered example dashboard
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

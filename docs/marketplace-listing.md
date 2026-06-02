# Marketplace listing copy — owasp-ai-audit

Drafted to satisfy GitHub Marketplace Developer Agreement §5.4(vi): truthful,
accurate, not intended to mislead. The defining honesty constraint of this
project is the boundary between the **static screen** (this Action) and the
**full graded audit** (the Claude Code skill). Every field below states it.

---

## Action name (action.yml `name:`)

> OWASP AI Audit (static screen)

## Short description (≤125 chars, shown in search results)

> First-pass static screen: catalogs your repo's AI surfaces and cites OWASP AI Exchange threats. Not a graded audit.

## Categories

- **Primary:** Code review
- **Secondary:** Security

## Listing "About" / long description

> **A static first-pass screen — not a full audit.**
>
> This Action runs non-interactively on every PR. It enumerates the AI surfaces
> in your repository (AST-based, with a regex fallback), maps each to the
> relevant [OWASP AI Exchange](https://owaspai.org/) threat, attaches a live
> `owaspai.org/go/{slug}/` permalink to every citation, renders a self-contained
> HTML dashboard, and optionally comments on the PR.
>
> **What it deliberately does *not* do:** grade severity. The screen emits only
> `UNKNOWN` findings — it surfaces *presence and citations*, never a clean bill
> of health. Severity grading, the eight-layer completeness model, the
> deterministic posture rollup, and the verdict ledger live in the **Claude Code
> skill** ([SKILL.md](https://github.com/aydinfer/owasp-ai-audit/blob/main/SKILL.md)),
> which you run interactively. Use the Action as a tripwire in CI; run the skill
> for the real audit.
>
> **Inputs:** `target` (dir to scan), `fail-on` (NONE…CRITICAL — gate the build
> when ungraded AI surfaces are present), `comment-pr`, `github-token`.
>
> **Privacy:** runs entirely inside your own runner using your own token.
> Findings and the dashboard are uploaded as a workflow artifact to *your*
> workflow. Nothing is transmitted to the author. No telemetry.
>
> **Limitations (read before relying on it):**
> - It reports *what to look at*, not *how bad it is*. An empty findings list
>   means "no AI surfaces detected by the static pass," not "safe."
> - A passing `fail-on=NONE` run is report-only and never blocks a merge.
> - It is not a substitute for the full SKILL.md audit, for
>   `/security-review`, or for human review.

## Quickstart (shown in listing body)

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
          fail-on: HIGH
```

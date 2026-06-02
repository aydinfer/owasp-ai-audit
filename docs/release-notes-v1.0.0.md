# v1.0.0 — Completeness by construction

First stable release. An OWASP AI audit is now an explicit verdict on **every
applicable taxonomy entry**, with a posture that is **capped by the weakest
layer** and **computed in code, not asserted by the model**.

## ⚠️ What the Marketplace Action is — and isn't

This release publishes a **composite GitHub Action that is a static first-pass
screen**, not the full audit. The screen:

- enumerates AI surfaces and cites the matching OWASP AI Exchange threats with
  live `owaspai.org/go/{slug}/` permalinks, and
- emits **only `UNKNOWN` findings** — it surfaces *presence*, never severity.

**Severity grading, the eight completeness layers, and the deterministic posture
rollup are in the Claude Code skill ([SKILL.md]), which you run interactively.**
Use the Action as a CI tripwire; run the skill for the real audit. An empty
screen means "no AI surfaces detected by the static pass," **not** "safe."

## Highlights

- **Eight mandatory completeness layers**, each with a coverage formula —
  surface inventory, taxonomy, auth/authz matrix, trust-boundary depth, probe
  verification, regulatory, operational, race/TOCTOU.
- **Posture capped by the lowest layer.** Any layer <70% stamps the report
  **"Screen only — not an audit"** on page one, in the largest type — a partial
  look can't be dressed up as "Acceptable."
- **The model writes verdicts; the tool does the math.** [`scripts/finalize-findings.js`]
  recomputes the rollup, posture, L5 probe ratio and evidence tally
  deterministically and **fails the run** if any finding exceeds its
  evidence-class cap (reasoning → MEDIUM, written probe → HIGH, executed probe →
  CRITICAL). A hand-edited number can't survive.
- **Verdict ledger** — an explicit verdict on every applicable entry (97/97 on
  the bundled `vercel/ai-chatbot` benchmark), including every justified `N/A`.
- **Grounded or it doesn't ship.** If a source can't be fetched and isn't in the
  bundled snapshot, the finding is dropped.

## Worked example

The `vercel/ai-chatbot` benchmark report ([dashboard], [findings.json]):
**97/97 entries adjudicated**, all 8 layers measured, 21 findings each carrying
an evidence class, posture **Concerning** — graded from the full ledger, not
asserted.

## Install

**As a CI screen:**
```yaml
- uses: aydinfer/owasp-ai-audit@v1   # floating major; pin @v1.0.0 to freeze
  with: { target: ., fail-on: HIGH }
```

**As the full audit:** clone into your Claude Code skills and ask for an OWASP
AI audit. See [README] and [SKILL.md].

## Privacy

Runs entirely in your own runner with your own token. No telemetry; nothing is
transmitted to the author.

---

[SKILL.md]: https://github.com/aydinfer/owasp-ai-audit/blob/main/SKILL.md
[README]: https://github.com/aydinfer/owasp-ai-audit/blob/main/README.md
[`scripts/finalize-findings.js`]: https://github.com/aydinfer/owasp-ai-audit/blob/main/scripts/finalize-findings.js
[dashboard]: https://github.com/aydinfer/owasp-ai-audit/blob/main/benchmarks/vercel-ai-chatbot/dashboard.html
[findings.json]: https://github.com/aydinfer/owasp-ai-audit/blob/main/benchmarks/vercel-ai-chatbot/findings.json

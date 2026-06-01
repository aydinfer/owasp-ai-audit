# Verdict Rules

Severity is not a feeling. These are the rules. Follow them.

## Levels

| Verdict | Meaning |
|---------|---------|
| `CRITICAL` | Active, exploitable, easily reproduced. No mitigating control present. Production system exposed. |
| `HIGH` | Exploitable with effort, OR critical with one weak mitigating control. Significant business or safety impact if exploited. |
| `MEDIUM` | Plausible attack path with multiple preconditions, OR HIGH with partial mitigation. Material risk, not imminent. |
| `LOW` | Defensible posture with minor gaps. Hygiene items. Worth noting, not worth a sprint. |
| `PASS` | The threat is addressed, evidenced, and the control is appropriate to the system. |
| `N/A` | The threat does not apply to this system class (e.g. prompt injection on a pure predictive ML model with no LLM). Must justify in the finding. |

## Decision tree

For each in-scope threat, walk this tree top-down. First match wins.

```
Does the threat apply to this system class at all?
├── No → N/A (justify in evidence: "no LLM surface", "no training data", etc.)
└── Yes ↓

Is there evidence of the threat being exploitable right now?
├── Direct evidence (e.g. concatenated user input in system prompt, no auth on model endpoint) → continue
└── No direct evidence ↓
    Is there a mitigating control in place?
    ├── Yes, appropriate → PASS
    ├── Yes, partial → LOW or MEDIUM (see "partial control" rules)
    └── No → continue with "no mitigation" weighting

Severity grading (when threat is exploitable or unmitigated):

Impact tier:
  - Catastrophic (data breach at scale, RCE, full model theft, safety harm) → start at CRITICAL
  - Significant (limited data leak, output manipulation, DoS, IP loss) → start at HIGH
  - Material (degraded outputs, partial info disclosure, cost inflation) → start at MEDIUM
  - Minor (logging gaps, missing hardening) → start at LOW

Adjustments (apply each, max one level up/down):
  - Trivial to exploit (no auth, public endpoint, no rate limit) → bump up one level
  - Hard to exploit (insider only, specific timing, deep knowledge) → bump down one level
  - Mitigating control present but partial (e.g. input filter without instruction hierarchy) → bump down one level
  - Agent system + threat amplified by agent context (per OWASP "Agentic AI perspective") → bump up one level
  - Compounds with another HIGH+ finding in same category → bump up one level
```

## Partial control rules

A "partial control" must be named and cited. Examples:

- **Partial prompt injection defence**: input filter present but no instruction hierarchy or output validation → MEDIUM (started HIGH, -1 for partial)
- **Partial supply chain control**: model SBOM exists but no signature verification → MEDIUM
- **Partial data minimisation**: PII redaction in training data but no redaction at inference → MEDIUM

If you cannot name and cite the partial control, it is not a partial control. Re-grade as if no control existed.

## Codebase audit — evidence rules

Evidence must be a `file:line` reference, OR a `file:function` reference for functions longer than 20 lines.

**Acceptable evidence:**
- `src/agent.ts:42 — user_input concatenated into system_prompt template without delimiter discipline`
- `services/rag.py:RAGRetriever.augment — no source validation on retrieved chunks before injection into context`

**Unacceptable evidence (do not write findings like this):**
- "The codebase has prompt injection risk" (no location, no specifics)
- "Looks like there might be SQL injection somewhere" (no specifics, hedged language)
- "Generally weak input handling" (vague, ungradeable)

If you cannot produce file:line evidence, you have not done Deep Trace yet. Go back and read the files end-to-end before writing the finding.

## Architecture audit — evidence rules

Evidence must quote or cite the specific part of the architecture description that triggered the finding.

**Acceptable evidence:**
- "Section 3.2 states 'user prompts are passed directly to the LLM' with no mention of input validation or instruction hierarchy"
- "The data flow diagram shows training data sourced from public web scraping with no validation stage"

**Unacceptable:**
- "The architecture suggests poor input handling" (which part? what suggested it?)
- "Looks like a typical LLM app" (this is not evidence of anything)

## Rollup rules (category → traffic light)

| Color | Trigger |
|-------|---------|
| 🔴 RED | Any `CRITICAL`, OR 2+ `HIGH` in the category |
| 🟡 AMBER | Any `HIGH`, OR 3+ `MEDIUM` in the category |
| 🟢 GREEN | Only `LOW` / `PASS` / `N/A` |

## Evidence-class caps (v1.0.0, L5)

Every finding declares an `evidence_class`. A finding **may not exceed the cap** its evidence class affords. This is enforced by `scripts/lib/coverage.js` and surfaced on page one of the dashboard.

| `evidence_class` | what backs it | severity cap |
|---|---|---|
| `static` | file:line + reasoning only | **MEDIUM** |
| `reasoned-probe` | a probe is authored **and** reasoned through against the *named* model behaviour the exploit depends on | **HIGH** |
| `demonstrated` | the probe was executed against a running instance and the recorded result confirms exploitability | **CRITICAL** |

A `HIGH`/`CRITICAL` finding with no valid `evidence_class`, or one above its cap, is an enforced violation — fix the class or lower the verdict. "I'm confident it's exploitable" is `static` until a probe is reasoned through or run.

## Graded posture

| Posture | Trigger |
|---------|---------|
| **Critical** | Any category is RED |
| **Concerning** | Two or more categories are AMBER |
| **Acceptable** | One category AMBER, rest GREEN |
| **Strong** | All categories GREEN |

The graded posture is the worst-case category rollup. Do not soften it for politeness. Record it as `rollup.graded_posture`.

## Reported posture — capped by coverage (v1.0.0, the lever)

The graded posture is what the findings *alone* say. The **reported** posture is the graded posture **bounded by the lowest of the eight completeness layers** (SKILL.md L1–L8). `scripts/lib/coverage.js` recomputes every layer's percentage from its numerator/denominator — a hand-edited `percent` cannot move the cap.

| Lowest-layer coverage | Reported posture |
|---|---|
| **≥ 90% on every layer** | the graded posture |
| **any layer 70–90%** | **"Partial — acceptable for what was read (NN%)"** |
| **any layer < 70%** | **"Screen only — not an audit"** |

A required layer with no coverage block counts as 0% (you cannot earn a clean posture by omitting a layer). A layer whose denominator is genuinely zero — no HIGH+ findings to probe, no read-then-act patterns, no declared jurisdiction — is vacuously 100%, but the report must say so. This is the rule that makes "graded 8 of 97 entries, labelled Acceptable" impossible.

**You do not apply these rules by hand.** `scripts/finalize-findings.js` recomputes the category rollup, the graded posture, the L5 ratio and the evidence tally from the `verdict_ledger` you wrote, and exits non-zero on any evidence-class cap violation. The auditor writes verdicts; the tool does the arithmetic — because an LLM, left to eyeball it, mislabels (a 3-AMBER rollup once shipped as "Acceptable").

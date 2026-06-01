---
name: owasp-ai-audit
description: Audits AI systems against the OWASP AI Exchange threat taxonomy. Use whenever the user asks to audit, assess, or check an AI system, ML model, LLM application, RAG pipeline, or agent for security or privacy risks — or mentions OWASP AI, AI threats, prompt injection assessment, model poisoning checks, AI supply chain, or AI governance review. Accepts a codebase (path to a directory) or an architecture description (text). Grounds every finding in live content fetched from owaspai.org with permalink citations. Produces a self-contained HTML dashboard that doubles as a print-to-PDF report.
---

# OWASP AI Audit

This skill audits an AI system against the [OWASP AI Exchange](https://owaspai.org/) threat taxonomy. **Every finding must cite a `/go/{slug}/` permalink on owaspai.org.** No hallucinated threats. No invented controls.

**v1.0.0 makes completeness structural, not optional.** An audit is not "some findings"; it is an explicit verdict on *every applicable taxonomy entry*, driven through **eight mandatory completeness layers**, each with a coverage gate. The posture you report is **capped by the lowest-covered layer** — so an audit that examined a fraction of the system can never be dressed up as "Acceptable." If you only screened it, the report says **"Screen only — not an audit"** in the largest type on page one, and you cannot override that.

## When to use

- User asks to audit, assess, review, or check an AI system, ML model, LLM application, RAG pipeline, or agent
- User mentions OWASP AI, AI security taxonomy, prompt injection risk, model poisoning, AI supply chain, AI privacy posture
- User uploads a codebase and asks "is this AI system safe?" or anything semantically close
- User provides an architecture description (text, diagram description, or doc) of an AI system and wants risk analysis

## Hard rules

1. **No finding without a citation.** Every threat reference cites the owaspai.org permalink it came from. If you cannot find a permalink, the finding does not go in the report.
2. **Live ground truth first.** Always attempt live fetch from `owaspai.org/go/{slug}/`. Cascade to cache and snapshot only on failure. Mark the report's grounding mode honestly in the footer.
3. **No invented severity.** Severity rules come from `reference/verdict-rules.md`. Don't ad-lib. No finding may exceed the cap implied by its evidence class (see L5).
4. **No prose-only deliverable.** The output is the HTML dashboard. Inline summaries in chat are fine, but the artifact is the file.
5. **Deep Trace on code inputs.** When auditing a codebase, read implicated files end-to-end before flagging. No grep-and-guess findings.
6. **Completeness is measured, and the posture is capped by it.** Every layer below has a coverage formula (Phase 3.B in the schema). The reported posture is bounded by the lowest layer. Silence on an applicable entry is a coverage failure, not a clean result. You may not hand-edit a coverage percentage to lie about the cap — the renderer recomputes it from the numerator/denominator you wrote.

## The eight completeness layers

An audit runs these in order. Each layer produces a coverage number that lands in `findings.json → coverage`. **None is optional.** A layer that does not apply is recorded as covered (its denominator is zero — vacuously complete), with the surface absence justified; it is never silently dropped.

### L1 — Surface inventory (REQUIRED)

Run the deterministic AST enumerator **before any reasoning**:

```bash
node scripts/enumerate-ai-surfaces.js <target> --out surfaces.json
```

`surfaces.json` is the structural catalogue of every AI surface tree-sitter found — by `kind`: `llm-call`, `prompt-construction`, `tool-definition`, `rag-embeddings`, `auth`, `rate-limit`, `code-exec`, `sandbox`, `api-route`, `log-sink`, `external-fetch`, `training`. Each entry has a `file`, `line_start`/`line_end`, `name`, enclosing `callers`, and an `evidence_excerpt`. The detectors run on AST nodes, so look-alikes (Vitest's `test()`, readline's `prompt`, `Math.exp`, a local `get`) do not false-positive.

**No finding may be written without an anchor entry in `surfaces.json` (file:line).** A surface the static enumerator provably cannot see (e.g. a sink built by reflection) must be **added to `surfaces.json` manually with a justification**, plus a `TODO` opening a detector-gap issue. Do not invent locations.

> **L1 coverage = (AI-relevant files read end-to-end) / (AI-relevant files in surfaces.json)**, where an AI-relevant file contains ≥ 1 surface. This is the honesty meter the v0.2.2 audit failed: it read 8 of 153 files and called it done.

### L2 — Taxonomy completeness (REQUIRED)

Load `reference/taxonomy-index.json` (97 entries: 32 threats + 65 controls). Produce an **explicit verdict on every applicable entry**, recorded in `findings.json → verdict_ledger`.

**Applicability is a conjunction**: an entry is applicable iff its `applies_to` (`genai` / `predictive` / `agent`) intersects the surface kinds detected in `surfaces.json` **AND** a matching surface is actually present. A chapter- or category-level scope exclusion needs its own justified-N/A record citing the absent surfaces.

- Allowed: *"no `training`/predictive surface in surfaces.json → all predictive-evasion threats N/A."*
- Forbidden: *"we decided not to look."* **Silence on an applicable entry fails L2.**

Every `verdict_ledger` row is `{ entry_id, verdict, applicability, rationale }`. Every `N/A` carries either a `file:line` or an explicit surface-absence justification.

> **L2 coverage = (entries with an explicit verdict) / (applicable entries).**

### L3 — Auth / authz matrix (REQUIRED, AI-surface scope)

Build a `user-type × resource × action` grid over the resources AI surfaces touch (chats, documents, messages, streams, tool outputs, model outputs, embedding stores). User types: whichever exist — `anonymous` / `guest` / `regular` / `admin`. Every cell gets an evidence-backed verdict or a justified N/A: IDOR, anonymous reads, ID guessability, deletion windows, stream-consumption authz on resumable streams, ownership re-checks.

Anchor every cell to an `auth` / `api-route` surface in `surfaces.json`. Conventional non-AI API authz (e.g. a vote endpoint's IDOR with no AI nexus) is `/security-review`'s job, not this layer's.

> **L3 coverage = (cells with an evidence-backed verdict) / (cells in the grid).**

### L4 — Trust-boundary depth (REQUIRED)

A separate, explicit verdict for **each of seven subareas**:

1. **server input** — untrusted input into prompts/tools
2. **server output** — model output before it leaves the server
3. **client renderer** — XSS / markdown / `dangerouslySetInnerHTML` / `javascript:` URLs / code-block rendering / link rewriting / image `src` handling
4. **code-exec sandbox** — Pyodide / E2B / Modal / Daytona / Replit / Riza: the escape surface and what runs inside (see Appendix A)
5. **log sink** — what model I/O reaches each `log-sink`
6. **telemetry** — what is sent to analytics / Sentry / PostHog / DataDog
7. **provider / gateway** — token scope, routing manipulation via user-controlled `selectedModel` / `gatewayOrder`, response handling on streaming corruption

> **L4 coverage = (subareas with an explicit verdict) / 7.**

### L5 — Adversarial probe verification (REQUIRED for findings ≥ MEDIUM)

Every finding declares an `evidence_class`, and **no finding may exceed its cap**:

| `evidence_class` | what it means | severity cap |
|---|---|---|
| `static` | file:line + reasoning only | **MEDIUM** |
| `reasoned-probe` | a probe is authored **and** reasoned through against the *named* model behaviour the exploit depends on | **HIGH** |
| `demonstrated` | the probe was executed against a running instance and the recorded result confirms exploitability | **CRITICAL** |

The renderer shows `evidence_class` on every finding card, and flags any cap violation on page one. A HIGH+ finding with no valid `evidence_class` is itself a violation.

> **L5 coverage = (HIGH+ findings with evidence_class ≥ reasoned-probe) / (HIGH+ findings total).** Zero HIGH+ findings ⇒ vacuously 100%.

### L6 — Regulatory pass (REQUIRED in declared jurisdictions)

**Declare jurisdiction at the start of the audit.** Coverage is measured against that jurisdiction's obligation set. Check EU AI Act, GDPR/CCPA AI provisions, and applicable sectoral rules (HIPAA / FERPA / PCI-DSS) **only where a chat surface plausibly touches that data**. The concrete obligation checklist with live citations is in Appendix B; it gets its own rollup colour.

> **L6 coverage = (obligations addressed) / (obligations applicable to declared jurisdictions).** No jurisdiction declared ⇒ denominator 0 ⇒ vacuous, but say so explicitly in the report.

### L7 — Operational pass (REQUIRED)

Four subareas, each an explicit verdict:

1. **logging** — for every `log-sink` in `surfaces.json`, trace what reaches it (PII-in-logs is the highest-value class nobody checks)
2. **telemetry** — analytics / Sentry / PostHog / DataDog destinations
3. **error handling** — does one user's input crash the route for others
4. **cost attribution** — tool-call loops, per-call `streamText` spawned from artifact servers, model-selection bypass via user-controlled routing, reasoning-effort multipliers

> **L7 coverage = (subareas with an explicit verdict) / 4.**

### L8 — Race / TOCTOU pass (REQUIRED)

Every read-then-act pattern around LLM calls, tool execution, and document mutation: ownership check followed by long-running `streamText`; `getDocumentById → patch → saveDocument` across concurrent tool calls; chat-delete handler vs. in-flight stream. Identify the patterns from `surfaces.json` (llm-call / tool-definition / api-route adjacency) and inspect each.

> **L8 coverage = (patterns inspected) / (read-then-act patterns identified).** Zero patterns identified ⇒ vacuously 100%, but record that you looked.

## Posture caps — the lever

After the eight layers, the posture you would assign from `reference/verdict-rules.md` (Strong / Acceptable / Concerning / Critical) is the **graded posture**. The **reported** posture is capped:

| Lowest-layer coverage | Reported posture |
|---|---|
| **≥ 90% on every layer** | posture as graded by verdict-rules |
| **any layer 70–90%** | floor of **"Partial — acceptable for what was read (NN%)"** |
| **any layer < 70%** | **"Screen only — not an audit"** — no matter how clean the findings list |

This is computed deterministically by `scripts/lib/coverage.js` and rendered on page one. You do not get to soften it.

## Workflow

### Step 1 — Detect input type

- **Path to a directory/repo** → codebase audit mode
- **Path to a single file** → file-scoped audit
- **Text/markdown describing a system** → architecture audit mode
- **Ambiguous** → ask once. Do not guess.

Also: **declare the regulatory jurisdiction(s)** for L6 now (or record "none declared").

### Step 2 — L1 surface inventory

Run `enumerate-ai-surfaces.js` (above). Load `surfaces.json`. This is the map every later finding anchors to. It is dependency-free: the tree-sitter runtime and grammar `.wasm` files are vendored under `scripts/lib/parsers/`.

### Step 3 — Load the taxonomy index

Read `reference/taxonomy-index.json`. Each entry has `id`, `slug`, `kind` (`threat`/`control`), `url` (the `/go/{slug}/` permalink — a 302 that resolves to HTTP 200; verification must follow redirects, e.g. `curl -L`), `category` (`general-controls` / `input-threats` / `dev-time` / `runtime` / `testing` / `privacy`), `applies_to`, and `owasp_category_line`. Cross-framing: `reference/llm-top10-2025.json` maps the OWASP LLM Top 10 (2025) onto these slugs for reviewers who expect that framing.

### Step 4 — Determine applicability (L2)

Intersect each entry's `applies_to` with the surface kinds in `surfaces.json`. Build the **list of applicable entries** — this is the L2 denominator and the set the `verdict_ledger` must cover completely.

### Step 5 — Fetch threats (cascaded)

For each in-scope threat/control, run `scripts/fetch-threat.sh <slug>`. The cascade: in-session memory → on-disk cache (`~/.cache/owasp-ai-audit/{slug}.json`, 7-day TTL) → live `owaspai.org/go/{slug}/` → bundled snapshot (`reference/snapshot/{slug}.json`) → hard fail. It returns `{ slug, url, title, content_md, source }`. Track `source` for the footer.

### Step 6 — Analyse against the system (L2–L8)

For each applicable entry decide `CRITICAL | HIGH | MEDIUM | LOW | PASS | N/A` per `reference/verdict-rules.md`, and walk L3–L8 for the surfaces involved. Each verdict needs:

- **Evidence** — file:line (code) anchored to a `surfaces.json` entry, or the cited part of the architecture description
- **Reasoning** — why this severity, not the next one up or down
- **`evidence_class`** — `static` / `reasoned-probe` / `demonstrated` (L5); the verdict may not exceed its cap
- **Citation** — the owaspai.org permalink
- **Recommended control** — from the OWASP control catalogue, citing its own permalink
- **Cross-references (additive)** — if `reference/cross-references.json` has an entry for the slug, attach its MITRE ATLAS technique IDs and NIST AI 100-2 sections as `cross_references`. Additive only — OWASP stays primary; never invent ATLAS/NIST mappings.

Follow Deep Trace: read implicated files end-to-end. No grep-only conclusions.

### Step 7 — Compute coverage and roll up

Fill `findings.json → coverage` for all eight layers (numerator/denominator per the formulas). Per-category traffic lights and graded posture come from `reference/verdict-rules.md`; the **reported posture is then capped** by `scripts/lib/coverage.js`. Set `rollup.graded_posture` to the uncapped grade so the renderer can show "graded X, capped to Y."

### Step 8 — Render the dashboard

1. Write `findings.json` in the working directory.
2. `node scripts/render-dashboard.js findings.json dashboard.html`
3. The page-one **Coverage panel** (per-layer % + colour band) renders **before any findings**; the **verdict ledger** renders as an appendix; every finding card shows its `evidence_class`.
4. Tell the user the file location and that "Save as PDF" from any browser produces the deliverable. Use `present_files` if available.

### Step 9 — Inline summary

In chat, 6 lines:

- Reported posture (and, if capped, the graded posture it was capped from)
- Mean coverage % and the lowest layer
- Number of findings by severity, plus the evidence-class breakdown
- Top 3 issues by severity, each with the OWASP permalink
- Grounding mode (live / cached / snapshot — be honest)
- "Full report: dashboard.html — open in a browser, print to PDF for sharing"

## findings.json schema

```json
{
  "audit_id": "uuid",
  "timestamp": "2026-06-01T14:30:00Z",
  "subject": { "type": "codebase | architecture", "identifier": "path or short description" },
  "scope": {
    "system_kind": "llm-app | rag | agent | predictive-ml | mixed",
    "included_categories": ["..."],
    "excluded_categories": ["..."],
    "exclusion_reasons": { "...": "..." },
    "jurisdictions": ["EU", "US-CA"]
  },
  "grounding": { "primary_source": "live | cache | snapshot", "snapshot_date": "2026-05-13", "fetched_at": "2026-06-01T14:25:00Z" },
  "coverage": {
    "L1_surface_inventory":     { "covered": 0, "total": 0, "percent": 0 },
    "L2_taxonomy_completeness": { "verdicted": 0, "applicable": 0, "percent": 0 },
    "L3_authz_matrix":          { "cells_filled": 0, "cells_total": 0, "percent": 0 },
    "L4_trust_boundary":        { "subareas_covered": 0, "subareas_total": 7, "percent": 0 },
    "L5_probe_verification":    { "high_plus_with_probe": 0, "high_plus_total": 0, "percent": 0 },
    "L6_regulatory":            { "obligations_addressed": 0, "obligations_total": 0, "percent": 0, "jurisdictions": ["EU"] },
    "L7_operational":           { "subareas_covered": 0, "subareas_total": 4, "percent": 0 },
    "L8_race_toctou":           { "patterns_inspected": 0, "patterns_identified": 0, "percent": 0 }
  },
  "verdict_ledger": [
    { "entry_id": "INPUT-PROMPTINJECTION", "verdict": "MEDIUM", "applicability": "applicable", "rationale": "..." },
    { "entry_id": "INPUT-EVASION", "verdict": "N/A", "applicability": "no-predictive-surface", "rationale": "surfaces.json contains no training or predictive classification surface" }
  ],
  "evidence_class_summary": { "static": 0, "reasoned-probe": 0, "demonstrated": 0 },
  "findings": [
    {
      "threat_id": "INPUT-PROMPTINJECTION",
      "threat_url": "https://owaspai.org/go/promptinjection/",
      "category": "input-threats",
      "verdict": "HIGH",
      "evidence_class": "reasoned-probe",
      "evidence": "app/(chat)/api/chat/route.ts:120 — user message concatenated into system prompt with no isolation",
      "reasoning": "Direct concatenation, no instruction hierarchy, no output validation. Probe: a message instructing the model to ignore prior instructions and emit the system prompt; depends on the model honouring later instructions over earlier ones — documented behaviour for this model family.",
      "recommended_controls": [
        { "control_id": "CTRL-INPUT-PROMPTINJECTIONSEVENLAYERS", "url": "https://owaspai.org/go/promptinjectionsevenlayers/", "summary": "Layered prompt-injection defence." }
      ],
      "cross_references": {
        "atlas": [{ "id": "AML.T0051", "url": "https://atlas.mitre.org/techniques/AML.T0051" }],
        "nist": [{ "section": "Generative AI — Prompt Injection (Direct & Indirect)", "url": "https://csrc.nist.gov/pubs/ai/100/2/e2025/final" }]
      }
    }
  ],
  "rollup": { "general-controls": "AMBER", "input-threats": "RED", "graded_posture": "Concerning", "overall": "Concerning" }
}
```

`coverage.*.percent` is advisory — `scripts/lib/coverage.js` recomputes every percentage from the numerator/denominator before deciding the cap, so a hand-edited percent cannot move the posture.

## surfaces.json schema (codebase inputs)

Produced by `scripts/enumerate-ai-surfaces.js`. Deterministic and dependency-free.

```json
{
  "tool": "enumerate-ai-surfaces",
  "schema_version": 1,
  "target": "/abs/path",
  "generated_at": "2026-06-01T20:00:00Z",
  "parsers": { "runtime": "web-tree-sitter@0.20.8", "grammars": "tree-sitter-wasms@0.1.13" },
  "counts_by_kind": { "llm-call": 9, "auth": 17, "api-route": 15, "sandbox": 4, "log-sink": 8, "external-fetch": 4 },
  "surfaces": [
    { "file": "app/(chat)/api/chat/route.ts", "line_start": 60, "line_end": 60, "kind": "api-route", "name": "POST", "callers": [], "evidence_excerpt": "export async function POST(" }
  ]
}
```

`kind` ∈ `llm-call`, `prompt-construction`, `tool-definition`, `rag-embeddings`, `auth`, `rate-limit`, `code-exec`, `sandbox`, `api-route`, `log-sink`, `external-fetch`, `training`. Languages: TypeScript, TSX, JavaScript, Python, Go.

## CI screen vs. full audit

`scripts/run-audit.js` (the composite GitHub Action) is a **non-interactive first-pass screen**, not an audit. It catalogues surfaces, cites the threats they implicate, emits `screen_only: true` findings with verdict `UNKNOWN`, and writes a coverage block that is zero on every reasoning layer — so the shared renderer labels it **"Screen only — not an audit"** by the same cap a full audit obeys. The full audit is this SKILL.md workflow inside Claude Code.

## What this skill does not do

- Penetration testing — a *taxonomy audit*, not a live attack (though L5 `demonstrated` evidence may include executed probes)
- Compliance certification — output is evidence, not a stamp
- Code fixes — recommends controls, does not write patches
- Replace human security review — augments it

## Appendix A — Code-execution sandbox escape classes (L4)

For the `code-exec` / `sandbox` subarea, inspect the boundary class, not just "is there a sandbox":

- **Pyodide** — CPython-on-WASM inside the host JS runtime with full JS interop; **not** a security boundary against the host. In the browser the only isolation is the browser sandbox; on Node it exposes the module loader/FS/process APIs — treat as effectively unsandboxed without an outer layer. <https://pyodide.org/en/stable/usage/faq.html>
- **E2B** — per-execution Firecracker microVM; boundary is hardware virtualization. Focus on network egress and secrets injected into the sandbox env/template. <https://e2b.dev/docs>
- **Modal** — Sandboxes isolated with gVisor (userspace syscall interception); escape class is gVisor/syscall-emulation bugs + network policy, not VM escape. <https://modal.com/docs/guide/sandbox>
- **Daytona** — "sandboxes" advertised with a dedicated kernel; docs are light on the mechanism, so verify VM-vs-hardened-container, default egress, and the security exhibit rather than assuming kernel isolation. <https://www.daytona.io/docs/>
- **Replit** — omegajail unprivileged-container sandbox, defense-in-depth ("every layer assumes the one above may fail"); examine container-escape surface, mounted secrets, and agent egress. <https://blog.replit.com/ai-agents-code-execution>
- **Riza** — interpreters in a WASM sandbox over HTTP; boundary is the WASM host-interface — confirm which host capabilities (FS/network/env) are exposed and that no secrets cross in. <https://riza.io/>

## Appendix B — Regulatory obligation checklist (L6)

Declare jurisdiction, then measure coverage against the applicable rows. Each cites a live source.

**EU AI Act** (in force 2024-08-01; general application 2026-08-02 per Art. 113):
- AI-interaction disclosure — a chatbot must tell users they are interacting with AI unless obvious, at first interaction — Art. 50(1) — <https://artificialintelligenceact.eu/article/50/>
- Synthetic-content marking — AI-generated output marked machine-readably as artificially generated where technically feasible — Art. 50(2) — <https://artificialintelligenceact.eu/article/50/>
- Deepfake / published-text disclosure — Art. 50(4) — <https://artificialintelligenceact.eu/article/50/>
- Record-keeping / automatic logging (if high-risk) — Art. 12 — <https://artificialintelligenceact.eu/article/12/>
- GPAI provider obligations — technical docs, downstream docs, copyright policy + training-data summary — Art. 53 — <https://artificialintelligenceact.eu/article/53/>

**GDPR / CCPA:**
- Automated decision-making safeguards (human intervention, contest) — GDPR Art. 22 — <https://gdpr-info.eu/art-22-gdpr/>
- Transparency at collection + "logic involved" — Art. 13(2)(f) — <https://gdpr-info.eu/art-13-gdpr/>
- Right of access / meaningful info on automated-decision logic — Art. 15(1)(h) — <https://gdpr-info.eu/art-15-gdpr/>
- Data minimisation at inference — Art. 5(1)(c) — <https://gdpr-info.eu/art-5-gdpr/>
- CCPA/CPRA know/delete/opt-out + ADMT rules — <https://oag.ca.gov/privacy/ccpa>

**Sectoral (only if the chat surface plausibly touches the data):**
- HIPAA PHI (health assistant) — 45 CFR Part 164 — <https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164>
- FERPA education records (ed-tech tutor) — <https://studentprivacy.ed.gov/faq/what-ferpa>
- PCI-DSS cardholder data (payments assistant; keep PAN out of prompts/logs) — <https://www.pcisecuritystandards.org/standards/pci-dss/>

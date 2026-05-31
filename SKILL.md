---
name: owasp-ai-audit
description: Audits AI systems against the OWASP AI Exchange threat taxonomy. Use whenever the user asks to audit, assess, or check an AI system, ML model, LLM application, RAG pipeline, or agent for security or privacy risks — or mentions OWASP AI, AI threats, prompt injection assessment, model poisoning checks, AI supply chain, or AI governance review. Accepts a codebase (path to a directory) or an architecture description (text). Grounds every finding in live content fetched from owaspai.org with permalink citations. Produces a self-contained HTML dashboard that doubles as a print-to-PDF report.
---

# OWASP AI Audit

This skill audits an AI system against the [OWASP AI Exchange](https://owaspai.org/) threat taxonomy. **Every finding must cite a `/go/{slug}/` permalink on owaspai.org.** No hallucinated threats. No invented controls.

## When to use

- User asks to audit, assess, review, or check an AI system, ML model, LLM application, RAG pipeline, or agent
- User mentions OWASP AI, AI security taxonomy, prompt injection risk, model poisoning, AI supply chain, AI privacy posture
- User uploads a codebase and asks "is this AI system safe?" or anything semantically close
- User provides an architecture description (text, diagram description, or doc) of an AI system and wants risk analysis

## Hard rules

1. **No finding without a citation.** Every threat reference cites the owaspai.org permalink it came from. If you cannot find a permalink, the finding does not go in the report.
2. **Live ground truth first.** Always attempt live fetch from `owaspai.org/go/{slug}/`. Cascade to cache and snapshot only on failure. Mark the report's grounding mode honestly in the footer.
3. **No invented severity.** Severity rules come from `reference/verdict-rules.md`. Don't ad-lib.
4. **No prose-only deliverable.** The output is the HTML dashboard. Inline summaries in chat are fine, but the artifact is the file.
5. **Deep Trace on code inputs.** When auditing a codebase, read implicated files end-to-end before flagging. No grep-and-guess findings.

## Workflow

### Step 1 — Detect input type

- **Path to a directory/repo** → codebase audit mode
- **Path to a single file** → file-scoped audit
- **Text/markdown describing a system** → architecture audit mode
- **Ambiguous** → ask once. Do not guess.

### Step 1.5 — Enumerate AI surfaces (codebase inputs)

If the input is a codebase, run the deterministic AST enumerator *before* scope filtering:

```bash
node scripts/enumerate-ai-surfaces.js <target> --out surfaces.json
```

Load `surfaces.json`. It is a structural catalogue of every AI surface tree-sitter could find — LLM call sites, prompt construction, tool/function definitions, embedding/RAG calls, auth surfaces, and rate-limit sites — each with a file, line range, kind, name, enclosing `callers`, and an evidence excerpt. Running it first means findings are anchored to *detected nodes* rather than to whatever fit in the context window — the recurring miss in `benchmarks/skill-issues.md` was real sinks hiding in 5000-line files.

**Every subsequent finding on a codebase must cite a surface from `surfaces.json` (file:line) as its evidence anchor.** If a threat applies but the enumerator found no surface for it, say so explicitly — do not invent a location. The enumerator *complements* Deep Trace; it does not replace reading the implicated files end-to-end (Hard rule 5). It is dependency-free: the tree-sitter runtime and grammar `.wasm` files are vendored under `scripts/lib/parsers/`.

### Step 2 — Load the taxonomy index

Read `reference/taxonomy-index.json`. This lists every threat and control with:
- `id` (e.g. `INPUT-PROMPTINJECTION`)
- `slug` (e.g. `promptinjection`)
- `kind` (`threat` or `control`)
- `url` (the `/go/{slug}/` permalink — a 302 redirect to its chapter anchor that resolves to HTTP 200; any verification must follow redirects, e.g. `curl -L`, as the bundled scripts do)
- `category` (one of: `general-controls`, `input-threats`, `dev-time`, `runtime`, `testing`, `privacy`)
- `applies_to` (e.g. `["genai", "predictive", "agent"]`)
- `owasp_category_line` (the raw "Category:" string from the OWASP chapter page — useful when picking between similar entries)

This index is the *map of what to look for*. Do not skip threats. Do not invent new ones.

### Step 3 — Scope filtering

Not every threat applies to every system. Apply these gates:

- Pure predictive ML (no LLM)? Skip prompt injection, GenAI output handling.
- LLM application with no fine-tuning? Skip dev-time training-data poisoning (still check supply chain).
- No user-facing input? Skip input threats but check augmentation manipulation if RAG.
- Agent system (tools, function calls)? Add extra weight to runtime + output injection.

Document scope decisions in the report's "Scope" section. Be explicit about what was excluded and why.

### Step 4 — Fetch threats (cascaded)

For each in-scope threat, run `scripts/fetch-threat.sh <slug>`. The script handles the cascade:

1. In-session memory (script-level dedupe)
2. On-disk cache at `~/.cache/owasp-ai-audit/{slug}.json` (TTL 7 days, ETag refresh)
3. Live fetch from `https://owaspai.org/go/{slug}/`
4. Bundled snapshot at `reference/snapshot/{slug}.json` (offline fallback)
5. Hard fail — never silently degrade

The script returns JSON with `{ slug, url, title, content_md, source }`. Track `source` for the report footer.

### Step 5 — Analyse against the system

For each threat, decide one of: `CRITICAL | HIGH | MEDIUM | LOW | PASS | N/A`. Rules in `reference/verdict-rules.md`. Each verdict needs:

- **Evidence** — concrete reference. For code: file:line. For architecture: which part of the description.
- **Reasoning** — why this severity, not the next one up or down
- **Citation** — the owaspai.org permalink the threat came from
- **Recommended control** — pulled from the OWASP control catalogue, citing its own permalink

For codebase audits, follow Deep Trace: read affected files end-to-end before writing the finding. No grep-only conclusions.

### Step 6 — Roll up per category

Each category gets a traffic light: 🔴 / 🟡 / 🟢

- 🔴 — any CRITICAL or 2+ HIGH in the category
- 🟡 — any HIGH or 3+ MEDIUM
- 🟢 — only LOW / PASS / N/A

Overall posture = worst category, weighted by relevance.

### Step 7 — Render the dashboard

1. Write findings to `findings.json` in the working directory
2. Run `node scripts/render-dashboard.js findings.json dashboard.html`
3. Tell the user the file location and that "Save as PDF" from any browser produces the deliverable
4. Use `present_files` (if available in environment) to surface `dashboard.html`

### Step 8 — Inline summary

In chat, give a 5-line summary:

- Overall posture (Strong / Acceptable / Concerning / Critical)
- Number of findings by severity
- Top 3 issues by severity, each with the OWASP permalink
- Grounding mode (live / cached / snapshot — be honest)
- "Full report: dashboard.html — open in a browser, print to PDF for sharing"

## findings.json schema

```json
{
  "audit_id": "uuid",
  "timestamp": "2026-05-20T14:30:00Z",
  "subject": {
    "type": "codebase | architecture",
    "identifier": "path or short description"
  },
  "scope": {
    "system_kind": "llm-app | rag | agent | predictive-ml | mixed",
    "included_categories": [...],
    "excluded_categories": [...],
    "exclusion_reasons": {...}
  },
  "grounding": {
    "primary_source": "live | cache | snapshot",
    "snapshot_date": "2026-05-13",
    "fetched_at": "2026-05-20T14:25:00Z"
  },
  "findings": [
    {
      "threat_id": "INPUT-PROMPTINJECTION",
      "threat_url": "https://owaspai.org/go/promptinjection/",
      "category": "input-threats",
      "verdict": "HIGH",
      "evidence": "src/agent.ts:42 — user input concatenated into system prompt with no isolation",
      "reasoning": "Direct concatenation without delimiter discipline or instruction hierarchy. No detection layer. No output validation. Exposed surface.",
      "recommended_controls": [
        {
          "control_id": "CTRL-INPUT-PROMPTINJECTIONSEVENLAYERS",
          "url": "https://owaspai.org/go/promptinjectionsevenlayers/",
          "summary": "Apply layered prompt injection defence — input filtering, instruction hierarchy, output validation."
        }
      ]
    }
  ],
  "rollup": {
    "general-controls": "AMBER",
    "input-threats": "RED",
    "dev-time": "GREEN",
    "runtime": "AMBER",
    "testing": "AMBER",
    "privacy": "GREEN",
    "overall": "CONCERNING"
  }
}
```

## surfaces.json schema (codebase inputs)

Produced by `scripts/enumerate-ai-surfaces.js` (Step 1.5). Deterministic and dependency-free — the tree-sitter runtime and grammar `.wasm` files are vendored under `scripts/lib/parsers/`.

```json
{
  "tool": "enumerate-ai-surfaces",
  "schema_version": 1,
  "target": "/abs/path/to/codebase",
  "generated_at": "2026-05-31T20:00:00Z",
  "parsers": { "runtime": "web-tree-sitter@0.20.8", "grammars": "tree-sitter-wasms@0.1.13" },
  "counts_by_kind": {
    "llm-call": 2, "prompt-construction": 2, "tool-definition": 1,
    "rag-embeddings": 1, "auth": 0, "rate-limit": 0
  },
  "surfaces": [
    {
      "file": "app/chat.ts",
      "line_start": 7,
      "line_end": 9,
      "kind": "llm-call",
      "name": "streamText",
      "callers": ["chat"],
      "evidence_excerpt": "return streamText({"
    }
  ]
}
```

`kind` is one of `llm-call`, `prompt-construction`, `tool-definition`, `rag-embeddings`, `auth`, `rate-limit`. Languages covered: TypeScript, TSX, JavaScript, Python, Go. Detection runs on AST nodes — not raw text — so strings, comments, and look-alike identifiers (Vitest's `test()`, readline's `prompt`) do not false-positive.

## What this skill does not do

- Penetration testing — this is a *taxonomy audit*, not a live attack
- Compliance certification — output is evidence, not a stamp
- Code fixes — recommends controls, does not write patches
- Replace human security review — augments it

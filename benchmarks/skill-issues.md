# owasp-ai-audit — skill issues log

What the benchmark run (5 public AI repos, 2026-05-31) taught us about the **skill itself** — distinct from the per-repo findings. Aggregated from each repo's auditor + an independent adversarial verifier.

---

## Citation / grounding observations (central)

- **All 96 `/go/{slug}/` permalinks return HTTP `302`, not `200`.** They redirect to a chapter anchor (e.g. `promptinjection` → `…/docs/2_threats_through_use/#22-prompt-injection`). Following redirects (`curl -L`), **0 / 96 fail** — every slug resolves to a live 200 page, and all **61 distinct URLs actually cited across the 5 audits** also resolve 200. `scripts/fetch-threat.sh` already uses `--location`, so the skill is functionally correct.
  - **Issue:** the user-facing hard rule *"if a cited URL doesn't return 200, the skill is wrong about that slug"* is ambiguous — a naive `curl -I` / no-follow check reports **all 96 as broken**. **Fix:** document that `/go/` permalinks are 302 redirects and verification must follow them, or add a resolved-anchor `url_resolved` field to `taxonomy-index.json`. No replacement slugs were needed; the index is accurate.
- **Grounding mode for this run: live** (owaspai.org reachable; fetch returned `live`/`cache`-within-TTL, never `snapshot`).
- **Verifier signal:** across 98 written findings the adversarial pass flagged **0 false positives and 0 citation problems**. That is a strong result, but a 100%-clean verify also suggests the verify prompt could be sharper (e.g. force it to *re-derive* one severity from scratch and challenge N/A scoping, not just confirm file:line). Treat the zero as "evidence held up," not "nothing to improve."

---

## Missed surfaces
_Where reading-alone was slow or unreliable and a static/AST pass would have been faster or more complete. **This was the single most consistent observation — every repo hit it.**_

**The recurring root cause: a few enormous files concentrate the real attack surface, and they exceed a comfortable read window.** Auditors fell back to grep + windowed reads and explicitly flagged the risk of missing a sink:

- **vercel/ai-chatbot** — `components/ai-elements/message.tsx` (321 L, output-render sinks), `lib/db/queries.ts` (~40 query fns; SQLi cleared only by grepping for `sql.raw`/interpolation). Tool/LLM-call discovery (`tool(`, `streamText`, `generateText`) via grep caught nested `streamText` inside `requestSuggestions` that linear reading risked missing.
- **mckaywrigley/chatbot-ui** — `components/messages/*` renderer not fully read → `RUN-OUTPUTCONTAINSCONVENTIONALINJECTION` marked N/A rather than graded. 8 near-duplicate provider routes; only 3 read, rest inferred — **the unauthenticated `/api/chat/custom` route was found only because it was read specifically**, a structural diff for `getServerProfile()` presence would have been more reliable than sampling.
- **BerriAI/litellm** — `user_api_key_auth.py` (2668 L), `auth_checks.py` (4488 L), `router.py` (11806 L), `handle_jwt.py` (1896 L), 30+ guardrail hooks — all too large to read whole; JWT/OAuth2/SSO sub-paths only spot-checked.
- **open-webui/open-webui** — `utils/middleware.py` (**5204 L**) holds the entire streaming/agent loop incl. code-interpreter exec; ~25 web-search engine files each do outbound HTTP. Verified the central chokepoint, not every caller. Pyodide sandbox boundary lives in untraced frontend worker code.
- **langchain-ai/langgraph** — `tool_node.py` (2030 L), `jsonplus.py` codec dispatch (884 L, integer EXT-code → sink), `remote.py` (1000+ L, 6 `**dict`-splat sites). The msgpack-RCE sinks were pinpointed by grepping `importlib.import_module(<var>)` + `getattr(...)(...)`.

**→ Shippable:** add a **"sink census" pre-pass** to the SKILL.md workflow (new Step ~1.5) — run `ast-grep`/`semgrep` (or ripgrep rule-pack) to enumerate, before manual reading: LLM/tool call sites (`streamText`/`generateText`/`chat.completions`/`.invoke`/`ToolNode`), outbound HTTP (SSRF), `exec`/`subprocess`/`eval`, deserialization (`pickle`/`importlib`/msgpack ext hooks), raw SQL (`sql.raw`, f-string SQL), and output sinks (`dangerouslySetInnerHTML`, `rehype-raw`). Manual Deep Trace then focuses on the enumerated sinks. This directly de-risks the "missed an LLM/exec call in a 5000-line file" failure mode that every repo surfaced.

---

## Likely false positives
_Findings flagged that, on reflection, are defensible. The auditors self-reported these (honesty is the deliverable); the verifier independently confirmed 0 outright-wrong findings, so these are "severity arguable," not "fabricated."_

| Repo | Location | Finding | Why it's defensible / over-graded |
|------|----------|---------|-----------------------------------|
| vercel/ai-chatbot | `lib/ai/tools/get-weather.ts:70-77` | weather JSON as indirect-injection vector | open-meteo is fixed, reputable, attacker-uncontrolled, numeric fields → alone it's LOW/PASS; the MEDIUM is rightly carried by the document-refeed path |
| vercel/ai-chatbot | `app/(chat)/api/files/upload/route.ts:48-53` | public-bucket flat-namespace uploads | restricted to jpeg/png ≤5MB, sanitised filename; not gradable above LOW for a demo template |
| mckaywrigley/chatbot-ui | `app/api/chat/tools/route.ts:62-198` | server-side SSRF via model-chosen URL | URL is from a tool **the authenticated user themselves registered**; in single-tenant BYO deploy, attacker only reaches hosts they configured → arguably MEDIUM not part of the HIGH |
| mckaywrigley/chatbot-ui | `app/api/chat/custom/route.ts:11-30` | unauth route fetches model row + api_key | needs a non-enumerable UUIDv4; key is used not returned → real but bounded; HIGH rests on missing-auth + RLS-bypass combination |
| BerriAI/litellm | `user_api_key_auth.py:1373` | token-hash echoed in 401 (LOW) | it's the SHA-256 of a key the caller already supplied, returned only to that caller on an invalid key → defensible as informational |
| BerriAI/litellm | `auth_utils.py:694-700` | request-size cap enterprise-gated (LOW) | intentional license gate; RPM/TPM/cost budgets still enforced in OSS; most deploys front a body-size-capping proxy → near-informational |
| open-webui/open-webui | `routers/utils.py:43` /code/execute | shared-Jupyter cross-user disclosure (MEDIUM) | **default engine is pyodide** (client-side, isolated); shared-kernel exposure only exists if an admin switches to `jupyter` → MEDIUM generous for default deploy |
| open-webui/open-webui | `INPUT-DIRECTPROMPTINJECTION` (LOW) | no jailbreak filter on user input | in a self-hosted single-principal chat the user jailbreaking their own session crosses no privilege boundary |
| langchain-ai/langgraph | `remote.py:830/842` `**dict`-splat (LOW) | no inbound schema validation | exploit needs compromise of an already-trusted server → defensible as LOW/N/A |
| langchain-ai/langgraph | `_shared/utilities.py:167` (NOT flagged) | SDK redirect API-key leak | auditor **correctly declined** to flag the stale-threat-model's T9 HIGH — same-origin check at `http.py:170/249` closes it; flagging it would itself have been the false positive |

**Theme:** the defensible cases cluster on **deployment-context-dependent severity** — single-tenant BYO vs multi-tenant, default engine vs admin-misconfig, library vs app. **→ Shippable:** the skill should require an explicit **"deployment assumptions" field** in `scope` (single-tenant/multi-tenant, who controls config, trust boundaries), and verdict-rules should add a documented "-1 when exploitability depends on an integrator misconfiguration of a secure default" adjustment.

---

## Recurring fix patterns
_Findings recurring across repos with the same canonical fix — candidate patch templates to ship in a future skill version. Ordered by how many repos exhibited them._

### 1. Fail-open / silently-disabled security control — **4 of 5 repos** (the dominant pattern)
A control that lets traffic through, degrades open, or no-ops when a precondition isn't met.
- vercel: rate limiter returns/▸swallows errors when Redis not ready → traffic allowed.
- open-webui: `RateLimiter` wired to sign-in only → all AI endpoints effectively unthrottled.
- litellm: `max_request_size_mb` returns `True` (no check) when caller isn't `premium_user` → configured cap silently off.
- langgraph: `LANGGRAPH_STRICT_MSGPACK` defaults **false** (permissive deserialization); `EncryptedSerializer` passes through data whose tag lacks the `+cipher` suffix without decrypt/verify; `assert ciphername=='aes'` (stripped under `python -O`).
- **(Counter-example / positive template: litellm fails *closed* on auth during DB outage — degrades to a restricted non-admin identity behind an explicit flag.)**
- **Canonical fix:** when a security-relevant precondition (store reachable, license set, tag present, flag configured) is absent → **fail closed / reject / require explicit opt-in to widen**; never silently disable. Flip insecure defaults to secure-by-default. Replace security `assert`s with explicit `raise`.

### 2. Missing or partial volumetric control on AI endpoints — **3 of 5** (vercel, mckaywrigley, open-webui)
Expensive inference/embedding/RAG/code-exec routes with no per-user/per-IP rate limit or token/cost budget.
- **Canonical fix:** apply per-user + per-IP limits and a server-enforced token/cost budget at the edge/middleware across **every** inference-adjacent route; bind to a durable identity, not a cheaply-rotated guest/anon one; never trust client-supplied size/context-length. (litellm's multi-tier budget model is the reference template.)

### 3. Untrusted content → model context with no data/instruction segregation — **3 of 5** (vercel, open-webui, mckaywrigley)
User prompts + RAG/web/tool output concatenated into the prompt with at most delimiter tags and a log line.
- **Canonical fix:** treat retrieved/tool content as data-not-instructions — provenance-tag and escape instruction-like/HTML sequences at context assembly, enforce an instruction hierarchy, validate tool-call arguments, and gate state-changing tool calls behind explicit human approval. Cites `promptinjectionsevenlayers`, `inputsegregation`, `promptinjectioniohandling`.

### 4. Privileged DB client on a user-facing read path without ownership re-check — mckaywrigley (the RED driver)
Service-role/admin client + request-supplied resource id + no `owner == caller` check (RLS bypassed); compounded by a vector match RPC that filters by doc id but not tenant.
- **Canonical fix:** query with the user-scoped client so RLS enforces ownership, or validate every id against `resource.user_id == caller` before the privileged call; add a `user_id`/tenant parameter inside the match SQL. Reserve the service-role key for trusted server-only ingestion.

### 5. Insecure deserialization boundary — langgraph
Default-permissive msgpack ext hook importing+instantiating arbitrary `(module, name)`; archive `extractall` without per-member path validation (zip-slip).
- **Canonical fix:** allowlist on deserialization by default; validate each archive member resolves inside the destination before extract.

### 6. Indefinite retention + third-party forwarding, no TTL/minimisation — vercel, langgraph (+ integrator-owned elsewhere)
- **Canonical fix:** define a retention TTL, minimise/coarsen persisted PII (e.g. geolocation), document provider-forwarding in a privacy notice. Cites `dataminimize`, `shortretain`.

### 7. Library-vs-app scope confusion (process pattern, not a code bug) — langgraph
- **Canonical fix (for the skill):** for framework targets, grade only framework-determined behaviour (defaults, codec safety, injection-merge, oversight primitives) and mark auth/rate-limit/output-rendering/prompt-construction **N/A as integrator-controlled with explicit justification** — do not invent app-level findings. The langgraph audit did this well and is the reference for framework scoping.

---

## Single most-shippable improvement
**Add a static "sink census" pre-pass (Step 1.5) to the workflow.** Every one of the 5 repos independently reported that the real attack surface lived in a handful of files too large to read end-to-end (5204-line `middleware.py`, 11806-line `router.py`, 884-line codec dispatch), and that grep/AST located the sinks faster and more reliably than linear reading. A bundled `ast-grep`/`semgrep` rule-pack that enumerates LLM-call, outbound-HTTP, exec, deserialization, raw-SQL and output-render sinks would (a) eliminate the "missed a call in a huge file" failure mode, (b) auto-feed the Deep Trace file list, and (c) directly surface the #1 recurring vulnerability class — **fail-open / silently-disabled controls** — which is exactly the kind of pattern (a guard wrapped in a license/flag/precondition check) that an AST query catches structurally but a tired human reader skims past.

---

## Implementation log — v0.3.0 / v0.4.0 / v0.5.0 upgrades

### Move A — GitHub Action (v0.3.0)
Shipped `action.yml` (composite) + `scripts/run-audit.js` (non-interactive static screen) + `scripts/pr-comment.js` + `scripts/lib/static-detectors.js` + `scripts/lib/audit-summary.js`. The runner regex-detects AI surfaces, maps them to in-scope OWASP threats, cites each via `fetch-threat.sh`, and emits `findings.json`/`dashboard.html` with every finding marked `UNKNOWN` (no static severity grading). `fail-on` treats `UNKNOWN` as worst-case so a non-`NONE` gate trips on any ungraded surface.

- **Known gap (non-blocking):** the README documents the PR comment with a *rendered Markdown preview* rather than a binary screenshot — a real screenshot of a live GitHub PR comment can't be captured in this offline build. Capture `docs/pr-comment-screenshot.png` from the first real PR run and swap the preview block for it.

### Move B — Deterministic AI-surface enumerator (v0.4.0)
Shipped `scripts/enumerate-ai-surfaces.js` — the "sink census" pre-pass the benchmark run kept asking for. Parses TypeScript/TSX/JavaScript/Python/Go with vendored tree-sitter wasm and matches structural queries (not line regex), emitting `surfaces.json` (file, line range, kind, name, callers, evidence excerpt). Detectors live per-language under `scripts/lib/ai-surface-detectors/`. SKILL.md Step 1.5 now requires every codebase finding to anchor to a surface ID. The CI runner (`run-audit.js`) auto-prefers the enumerator and falls back to regex only if the runtime can't load.

- **Resolved blocker (ABI):** `web-tree-sitter@0.26.9` (latest) fails to load `tree-sitter-wasms@0.1.13` grammars — newer Emscripten dynamic-linking format vs ABI-14 parsers (`getDylinkMetadata` error). Pinned the matched pair `web-tree-sitter@0.20.8` + `tree-sitter-wasms@0.1.13` instead; documented in `scripts/lib/parsers/README.md`. Both vendored + checksummed, no npm install.
- **Resolved (process singleton):** `web-tree-sitter`'s `Parser.init()` can only run once per process (require-cached, init consumed), which broke repeated `enumerateDir` calls in the test file — fixed by making init a module singleton while giving each call its own `Parser` instance.

### Move C — Multi-source grounding: OWASP + MITRE ATLAS + NIST AI 100-2 (v0.5.0)
Shipped `reference/cross-references.json` — a hand-curated map from 32 of the most-cited OWASP slugs to the MITRE ATLAS techniques/mitigations and NIST AI 100-2e2025 sections describing the same phenomenon. `findings.json` gained an optional `cross_references: { atlas:[{id,url}], nist:[{section,url}] }` per finding; the renderer shows them as a second citation line; `run-audit.js` attaches them automatically via `scripts/lib/cross-references.js`; SKILL.md Step 5 tells the interactive workflow to include them when curated. `snapshot-update.js` now validates them alongside the OWASP set (39 ok: 38 ATLAS ids + 1 NIST url).

- **Resolved blocker (ATLAS SPA 404s):** `atlas.mitre.org/techniques/{ID}` and `/mitigations/{ID}` are client-rendered and return HTTP 404 to curl / WebFetch / CI (confirmed via two independent fetchers), so the literal "verify the URL returns 200" can't be satisfied for ATLAS. Adapted exactly as the repo already did for the OWASP `/go/` 302s: cite the real human URL, but **verify the technique/mitigation id against the authoritative `mitre-atlas/atlas-data` `ATLAS.yaml` dataset** (raw.githubusercontent, 200) — a stronger guarantee than a rendered page. Documented in `cross-references.json` and CONTRIBUTING.
- **Resolved blocker (NIST PDF section numbers):** the NIST AI 100-2e2025 PDF uses subsetted fonts with a custom CMap, so stdlib-zlib text extraction yields glyph codes, not readable text, and `poppler` isn't installed offline. Rather than fabricate subsection numbers, NIST refs name the taxonomy's attack-class section (e.g. "Predictive AI — Evasion Attacks and Mitigations") and point at the e2025 publication landing page (verified 200). Honest section locator, no invented numbers.

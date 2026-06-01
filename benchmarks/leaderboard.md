# OWASP AI Audit — Benchmark Leaderboard

Cross-repo comparison of 5 public AI repositories audited with the [`owasp-ai-audit`](https://github.com/aydinfer/owasp-ai-audit) skill on **2026-05-31**.

- **Grounding:** live — owaspai.org reachable; all 96 taxonomy `/go/` permalinks resolve 200 (after the expected 302 redirect). No snapshot fallback used.
- **Method:** each repo ran the full SKILL.md workflow (deep-trace, file:line evidence) followed by an independent adversarial verification pass. Across all 5 repos: **98 findings written, 98 cited URLs all `/go/` form + in-index + 200, 0 false positives, 0 citation problems** flagged by the verifier.
- Category light = OWASP rollup (🔴 RED: any CRITICAL or 2+ HIGH · 🟡 AMBER: any HIGH or 3+ MEDIUM · 🟢 GREEN: only LOW/PASS/N/A). Categories: **GC** General-controls · **IT** Input-threats · **DT** Dev-time · **RT** Runtime · **TE** Testing · **PR** Privacy.

## Standings (best → worst posture)

| Repo | Posture | GC | IT | DT | RT | TE | PR | C / H / M / L / P / N/A | Report |
|------|---------|----|----|----|----|----|----|--------------------------|--------|
| **BerriAI/litellm** | 🟢 Strong | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 0 / 0 / 0 / 5 / 4 / 15 | [dashboard](./BerriAI-litellm/dashboard.html) |
| **vercel/ai-chatbot** | 🟠 Concerning | 🟡 | 🟡 | 🟢 | 🟡 | 🟢 | 🟡 | 0 / 2 / 24 / 23 / 0 / 48 | [dashboard](./vercel-ai-chatbot/dashboard.html) |
| **open-webui/open-webui** | 🟡 Acceptable | 🟢 | 🟡 | 🟢 | 🟢 | 🟢 | 🟢 | 0 / 1 / 7 / 4 / 4 / 4 | [dashboard](./open-webui-open-webui/dashboard.html) |
| **langchain-ai/langgraph** | 🟡 Acceptable | 🟢 | 🟢 | 🟢 | 🟡 | 🟢 | 🟢 | 0 / 1 / 3 / 6 / 1 / 5 | [dashboard](./langchain-ai-langgraph/dashboard.html) |
| **mckaywrigley/chatbot-ui** | 🔴 Critical | 🟢 | 🟡 | 🟢 | 🔴 | 🟢 | 🟢 | 0 / 2 / 7 / 3 / 1 / 6 | [dashboard](./mckaywrigley-chatbot-ui/dashboard.html) |

> DT (dev-time) is 🟢 for every repo because **none of them train or fine-tune a model** — all DEV-* training/poisoning/training-data-leak threats are scoped out as N/A (documented per-repo in `exclusion_reasons`). The green there means "out of scope," not "hardened."

## One-line summaries

- **BerriAI/litellm — 🟢 Strong.** Mature, security-hardened LLM gateway: constant-time master-key check, hashed virtual keys, granular RBAC, layered SSRF/credential-exfil defence, multi-tier budgets, fail-*secure* degradation. Residual issues are LOW hygiene only (OSS request-size cap gated to enterprise, token-hash echoed in a 401, integrator-owned retention). → [report](./BerriAI-litellm/dashboard.html)
- **vercel/ai-chatbot — 🟠 Concerning.** Adjudicates **all 97 entries** (85 applicable + 12 justified predictive N/A) at measured 100% coverage on all eight layers; the rollup of four AMBER categories grades **Concerning**. A reasoned-probe pass earned **2 HIGH** the honest way — uncounted nested `streamText` cost-amplification (the `role:'user'` rate counter misses tool-spawned LLM calls) and always-on geolocation injection — each with a verbatim probe (L5 = 2/2). Most other locks **held** (IDOR re-checked per route, tools re-derive authority from the session, model selection allowlisted) and were graded down accordingly; 0 CRITICAL because the app wasn't run locally. → [report](./vercel-ai-chatbot/dashboard.html)
- **open-webui/open-webui — 🟡 Acceptable.** Strong defaults (RBAC, pending-by-default signup, admin-gated code/function execution, in-depth SSRF blocking), but the core RAG/agent loop injects untrusted retrieved/web-fetched content into tool-capable LLM prompts with no sanitisation (**indirect prompt injection HIGH**), and rate limiting only covers sign-in. → [report](./open-webui-open-webui/dashboard.html)
- **langchain-ai/langgraph — 🟡 Acceptable.** Soundly-engineered agent *framework*; injection/oversight primitives are correct and most input/runtime posture is correctly the integrator's responsibility. The one material framework-owned risk is the **checkpoint deserialization boundary (default-permissive msgpack RCE + encryption fail-open, HIGH)**. → [report](./langchain-ai-langgraph/dashboard.html)
- **mckaywrigley/chatbot-ui — 🔴 Critical.** Runtime layer is broken: a **service-role RAG retrieval path with no owner check** (user_id-less match RPC) leaks cross-tenant document chunks (HIGH), an **unauthenticated `/api/chat/custom`** route plus an SSRF-capable tool-execution loop compound it (HIGH), no rate limiting anywhere, and plaintext-stored provider API keys. → [report](./mckaywrigley-chatbot-ui/dashboard.html)

## Cross-repo read

- **Strongest:** BerriAI/litellm — the only repo where the audit's deep trace kept turning *up* controls (it cleared 4 PASS, including a layered SSRF/credential-exfil defence) and could not substantiate a single MEDIUM-or-worse.
- **Most findings:** vercel/ai-chatbot (26) and BerriAI/litellm (24) — but for opposite reasons: ai-chatbot's count is breadth of real gaps, litellm's is breadth of *verified controls* (PASS/LOW) plus a large N/A surface.
- **Worst posture:** mckaywrigley/chatbot-ui — the only RED, driven by 2 HIGH in the runtime category (cross-tenant RAG leak + unauthenticated provider-key route).
- **Most common real issue:** **fail-open / missing volumetric control** (rate-limit or budget) appeared as a graded finding in 4 of 5 repos (all except litellm, which fails *closed*). See `skill-issues.md` → Recurring fix patterns.

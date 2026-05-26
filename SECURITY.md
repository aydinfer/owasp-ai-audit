# Security Policy

## Reporting a vulnerability

If you find a security issue in `owasp-ai-audit` — the skill instructions, the fetcher, the renderer, the snapshot pipeline, or anything that could let a finding mis-attribute a threat — please report it privately first:

- Open a [GitHub Security Advisory](https://github.com/aydinfer/owasp-ai-audit/security/advisories/new) on this repo (preferred), **or**
- Email `aydinfer@gmail.com` with the subject `owasp-ai-audit: security`

Please include:

- What you observed
- A minimal reproducer (a `findings.json` snippet, a fabricated taxonomy entry, a curl command — whatever shows the failure mode)
- Why you think it matters (impact, attack chain, downstream effect)

I'll acknowledge within a few days and aim to ship a fix or a mitigation in the next release. If the issue is critical and time-sensitive, say so in the report and I'll prioritise.

## What counts as a security issue

In rough order of how seriously it gets treated:

1. **The dashboard becomes an XSS / script-execution surface** when opened in a browser or shared as PDF — e.g. a way to get `javascript:` / `data:` / `vbscript:` URLs, inline event handlers, or `<script>` into the rendered HTML via attacker-influenced `findings.json` content.
2. **The taxonomy index drifts from the live OWASP source** in a way that lets a finding cite a permalink that doesn't actually describe the cited threat — i.e., misattribution.
3. **The fetch cascade silently degrades** when it should hard-fail (e.g., serving stale snapshot as if it were live, or returning empty content_md without flagging the failure).
4. **The skill produces a finding without a citation** — the cardinal rule of the skill is broken.
5. **Supply chain regressions** — anything that adds a third-party runtime dependency without an explicit decision (the current posture is "Node stdlib + curl + jq only", and that's load-bearing for the security story).

## What does *not* count

- A threat the skill failed to flag during an audit — that's a methodology / scope discussion, not a vulnerability. Open a regular issue.
- An OWASP AI Exchange permalink that 404s — that's an upstream issue. Open a regular issue here so we can track it and update the index; report it to OWASP too.
- The skill choosing a different severity than you would have — open a regular issue, not an advisory.

## Disclosure timeline

Default: 90 days from acknowledgement to public disclosure. If a fix lands sooner, disclosure can be earlier. If the issue is hard to fix and the impact is limited, I may ask for an extension; you're free to decline.

## Verifying a release

Each tagged release will have a signed-by-default commit (GitHub displays "Verified" on `aydinfer` commits). Verify the tag's commit hash matches the release page before installing into a skills directory you trust.

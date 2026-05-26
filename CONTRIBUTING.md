# Contributing

Thanks for considering a contribution. The shape of this project is intentionally narrow — it's a single Claude Code skill, not a framework — so changes are most welcome when they keep that shape.

## Principles

1. **Live ground truth over invention.** Every threat reference in [`reference/taxonomy-index.json`](reference/taxonomy-index.json) must resolve to HTTP 200 on `owaspai.org`. The verification is automated — see below.
2. **No third-party runtime deps.** The skill runs against Node's stdlib, plus `curl` and `jq`. Adding an npm dependency is a significant change; please open an issue first.
3. **Deep Trace before opinion.** Don't propose verdict-rule changes from a sample of one audit. Run the skill against several systems first and bring the data.

## Local checks before opening a PR

```bash
# 1. Every taxonomy entry must resolve against the live source
node scripts/snapshot-update.js

# 2. The example dashboard should still render
node scripts/render-dashboard.js examples/findings.json examples/dashboard.html
```

Both should exit 0 with no errors. The snapshot script prints a summary at the end (`Done. N ok, 0 failed.`) — `0 failed` is required.

## Updating the taxonomy index

The index is generated from the six OWASP AI Exchange chapter pages (`/docs/1_general_controls/` through `/docs/6_privacy/`) by parsing every `Category: ... <br> Permalink: ...` block. If OWASP adds, renames, or removes a slug, the right fix is:

1. Refetch the relevant chapter page(s)
2. Edit `reference/taxonomy-index.json` to reflect the change, preserving the schema (`id`, `slug`, `title`, `kind`, `category`, `url`, `applies_to`)
3. Run `node scripts/snapshot-update.js` — should be silent success
4. Commit both the index change and the regenerated snapshot

Do not hand-edit the snapshot files directly — they're a build artifact.

## Verdict-rule changes

[`reference/verdict-rules.md`](reference/verdict-rules.md) is load-bearing for the skill's outputs. Changes that loosen rules (e.g., allowing PASS without a cited control) will not be accepted. Changes that close gaps (e.g., the current rules don't define a colour for "exactly 1–2 MEDIUM in a category" — that's a real gap) are welcome.

## Snapshot refresh PRs

The GitHub Action at `.github/workflows/snapshot-refresh.yml` opens a weekly PR with the refreshed snapshot. These should auto-merge on green. If one shows a *taxonomy* drift (a slug that no longer resolves), the PR will fail — that's the signal to update the index, not to skip the validation.

## Releasing

- Patch (`v0.2.x`): bug fixes, snapshot refreshes, minor renderer polish
- Minor (`v0.x.0`): taxonomy changes, new fields in `findings.json`, renderer additions
- Major (`v1.0.0`): change to `SKILL.md`'s contract (the workflow steps, the schema) — coordinate on an issue first

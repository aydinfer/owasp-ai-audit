# Vendored tree-sitter parsers

These files are **vendored on purpose** — committed, pinned, and checksummed —
so the AI-surface enumerator (`scripts/enumerate-ai-surfaces.js`) has no
`npm install` step and no third-party *runtime* dependency to resolve at audit
time. This is the same supply-chain posture the rest of the skill keeps (Node
stdlib + `curl` + `jq`): the only third-party code that runs is what you can see
and diff in this directory.

## Contents & provenance

| File | Source | Version |
|------|--------|---------|
| `tree-sitter.js`, `tree-sitter.wasm` | [`web-tree-sitter`](https://www.npmjs.com/package/web-tree-sitter) (the [tree-sitter](https://github.com/tree-sitter/tree-sitter) WASM runtime) | `0.20.8` |
| `tree-sitter-typescript.wasm`, `tree-sitter-tsx.wasm`, `tree-sitter-javascript.wasm`, `tree-sitter-python.wasm`, `tree-sitter-go.wasm` | prebuilt grammars from [`tree-sitter-wasms`](https://www.npmjs.com/package/tree-sitter-wasms) | `0.1.13` (parser ABI 14) |

Fetched from the jsdelivr npm mirror, e.g.:

```bash
curl -o tree-sitter.js   https://cdn.jsdelivr.net/npm/web-tree-sitter@0.20.8/tree-sitter.js
curl -o tree-sitter.wasm https://cdn.jsdelivr.net/npm/web-tree-sitter@0.20.8/tree-sitter.wasm
curl -o tree-sitter-python.wasm https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.13/out/tree-sitter-python.wasm
# …typescript, tsx, javascript, go likewise
```

## Why this pairing

The `web-tree-sitter` **runtime** and the grammar **`.wasm`** must agree on the
parser ABI. `tree-sitter-wasms@0.1.13` grammars are ABI 14; the matching runtime
is `web-tree-sitter@0.20.8`. Newer runtimes (`0.25+`) use a different Emscripten
dynamic-linking format and fail to load these grammars
(`getDylinkMetadata` error). If you bump either, bump both and re-run
`node --test tests/enumerate.test.js` — the fixtures prove every detector still
fires and the decoys still don't.

## Checksums

Verify after (re-)vendoring:

```bash
shasum -a 256 -c CHECKSUMS.txt
```

See `CHECKSUMS.txt` in this directory.

## Licenses

All MIT: `web-tree-sitter` (tree-sitter, MIT), `tree-sitter-wasms` (MIT), and the
bundled grammars `tree-sitter-typescript` / `tree-sitter-javascript` /
`tree-sitter-python` / `tree-sitter-go` (all MIT). Upstream copyright remains
with the respective projects; this repo only redistributes the compiled
artifacts for offline use.

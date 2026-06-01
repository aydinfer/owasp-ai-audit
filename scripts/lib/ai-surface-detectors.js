// ai-surface-detectors.js — language registry for the deterministic AI-surface
// enumerator. Maps a file extension to the vendored tree-sitter parser wasm
// and the per-language detector set. Add a language by vendoring its wasm
// under scripts/lib/parsers/ and adding a detector file under
// ./ai-surface-detectors/.

const typescript = require('./ai-surface-detectors/typescript');
const python = require('./ai-surface-detectors/python');
const go = require('./ai-surface-detectors/go');

// extension -> { lang (parser wasm basename, sans .wasm), detectors }
const LANGUAGES = {
  '.ts':  { lang: 'typescript', detectors: typescript },
  '.tsx': { lang: 'tsx',        detectors: typescript },
  '.mts': { lang: 'typescript', detectors: typescript },
  '.cts': { lang: 'typescript', detectors: typescript },
  '.js':  { lang: 'javascript', detectors: typescript },
  '.jsx': { lang: 'javascript', detectors: typescript },
  '.mjs': { lang: 'javascript', detectors: typescript },
  '.cjs': { lang: 'javascript', detectors: typescript },
  '.py':  { lang: 'python',     detectors: python },
  '.go':  { lang: 'go',         detectors: go },
};

function forExtension(ext) {
  return LANGUAGES[ext] || null;
}

// All surface kinds the detectors can emit (for documentation / validation).
// The first row is the LLM core; the second row was added in v1.0.0 to give the
// completeness layers (L3 authz, L4 trust-boundary, L7 operational, L8 race)
// structural anchors.
const SURFACE_KINDS = [
  'llm-call', 'prompt-construction', 'tool-definition',
  'rag-embeddings', 'auth', 'rate-limit',
  'code-exec', 'sandbox', 'api-route', 'log-sink', 'external-fetch', 'training',
];

module.exports = { LANGUAGES, forExtension, SURFACE_KINDS };

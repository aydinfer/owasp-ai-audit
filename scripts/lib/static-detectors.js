// static-detectors.js — heuristic, dependency-free detectors used by the
// non-interactive CI runner (scripts/run-audit.js) to find AI surfaces by
// regex before any OWASP reasoning happens.
//
// This is the *v1* surface finder: line-oriented regex over source files.
// It is deliberately coarse — its only job is to decide which taxonomy
// categories are in scope and which threats have *detectable static
// evidence*. The deterministic AST enumerator (scripts/enumerate-ai-surfaces.js,
// shipped in v0.4.0) supersedes this for precision; run-audit prefers it when
// a surfaces.json is available and falls back to these regexes otherwise.
//
// Every `threats`/`controls` slug below MUST exist in
// reference/taxonomy-index.json — the runner cites them by permalink.
// Exercised by tests/run-audit.test.js.

const fs = require('node:fs');
const path = require('node:path');

// Each signal: a kind, the regexes that detect it, the taxonomy categories it
// puts in scope, the threat slugs it gives detectable evidence for, and the
// control slugs worth recommending. Patterns are intentionally specific enough
// to avoid the obvious false positives (Vitest's `tool`, readline's `prompt`).
const SIGNALS = [
  {
    kind: 'llm-call',
    patterns: [
      /\bstreamText\s*\(/, /\bgenerateText\s*\(/, /\bgenerateObject\s*\(/,
      /\bstreamObject\s*\(/,
      /\bchat\.completions\.create\b/, /\.messages\.create\b/,
      /\blitellm\.completion\b/, /\bcompletion\s*\(\s*model\s*=/,
      /\bnew\s+OpenAI\s*\(/, /\bnew\s+Anthropic\s*\(/,
      /\bChatOpenAI\s*\(/, /\bChatAnthropic\s*\(/,
      /\bAnthropic\s*\(\s*\)/, /\bopenai\.ChatCompletion\b/
    ],
    categories: ['input-threats', 'runtime'],
    threats: ['promptinjection', 'directpromptinjection', 'outputcontainsconventionalinjection', 'disclosureinoutput'],
    controls: ['promptinjectionsevenlayers', 'inputsegregation', 'encodemodeloutput']
  },
  {
    kind: 'prompt-construction',
    patterns: [
      // object keys feeding an LLM call, only when interpolation is present
      /\bsystem\s*:\s*[`'"][^`'"]*\$\{/, /\bprompt\s*:\s*[`'"][^`'"]*\$\{/,
      /\bsystem\s*:\s*`[\s\S]*?\$\{/, /\bprompt\s*:\s*`[\s\S]*?\$\{/,
      // python f-string / concatenation into a system/messages payload
      /["']role["']\s*:\s*["']system["']/, /\bsystem_prompt\s*=\s*f["']/
    ],
    categories: ['input-threats'],
    threats: ['directpromptinjection', 'promptinjection'],
    controls: ['inputsegregation', 'promptinjectioniohandling']
  },
  {
    kind: 'tool-definition',
    patterns: [
      /\btool\s*\(\s*\{/, /\.tool\s*\(\s*[`'"{]/, /\bserver\.tool\s*\(/,
      /\bregisterTool\s*\(/, /\baddTool\s*\(/,
      /["']type["']\s*:\s*["']function["']/, /\bfunction_call\b/,
      /\b@mcp\.tool\b/, /\btools\s*=\s*\[/
    ],
    categories: ['runtime'],
    threats: ['outputcontainsconventionalinjection', 'genericsecthreats', 'indirectpromptinjection'],
    controls: ['leastmodelprivilege', 'oversight', 'runtimemodeliointegrity']
  },
  {
    kind: 'rag-embeddings',
    patterns: [
      /\.embeddings\.create\b/, /\bembedMany\s*\(/, /\bembed\s*\(\s*\{/,
      /\bpgvector\b/, /\bpinecone\b/i, /\bweaviate\b/i, /\bqdrant\b/i,
      /\bchromadb\b/i, /\bChroma\s*\(/, /\bvectorize\b/i,
      /\.similaritySearch\s*\(/, /\bvectorStore\b/
    ],
    categories: ['runtime', 'input-threats'],
    threats: ['indirectpromptinjection', 'augmentationdatamanipulation', 'augmentationdataleak'],
    controls: ['inputsegregation', 'augmentationdataintegrity', 'augmentationdataconfidentiality']
  },
  {
    kind: 'training',
    patterns: [
      /\bfine[_-]?tune\b/i, /\btrainer\.train\s*\(/, /\bmodel\.fit\s*\(/,
      /\bload_dataset\s*\(/, /\bTrainingArguments\s*\(/, /\bSFTTrainer\s*\(/
    ],
    categories: ['dev-time'],
    threats: ['datapoison', 'modelpoison'],
    controls: ['dataqualitycontrol', 'poisonrobustmodel']
  },
  {
    kind: 'rate-limit',
    patterns: [
      /\brateLimit\b/, /\bRatelimit\s*\(/, /\bexpress-rate-limit\b/,
      /\bnew\s+Bottleneck\b/, /\bslowDown\s*\(/
    ],
    categories: ['input-threats'],
    threats: ['airesourceexhaustion'],
    controls: ['ratelimit', 'limitresources']
  }
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'vendor',
  'coverage', '.venv', 'venv', '__pycache__', '.cache', 'target'
]);
const CODE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rb', '.java', '.kt'
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;   // skip giant minified bundles
const EXCERPT_MAX = 160;

function excerpt(line) {
  const t = line.trim();
  return t.length > EXCERPT_MAX ? t.slice(0, EXCERPT_MAX - 1) + '…' : t;
}

// Scan a single buffer of source text. Returns
// [{ kind, line, evidence_excerpt }] in file order. One match per (line, kind)
// — a line that triggers two patterns of the same kind counts once.
function scanText(text) {
  const out = [];
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const sig of SIGNALS) {
      if (sig.patterns.some((re) => re.test(line))) {
        out.push({ kind: sig.kind, line: i + 1, evidence_excerpt: excerpt(line) });
      }
    }
  }
  return out;
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') {
      if (SKIP_DIRS.has(e.name)) continue;
    }
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(full);
    } else if (e.isFile() && CODE_EXT.has(path.extname(e.name))) {
      yield full;
    }
  }
}

// Scan a directory tree. Returns { surfaces, byKind } where surfaces is a flat
// list of { file (relative to root), line, kind, evidence_excerpt } and byKind
// groups surfaces by kind.
function scanDir(root) {
  const surfaces = [];
  for (const file of walk(root)) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch { continue; }
    if (stat.size > MAX_FILE_BYTES) continue;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch { continue; }
    for (const hit of scanText(text)) {
      surfaces.push({
        file: path.relative(root, file),
        line: hit.line,
        kind: hit.kind,
        evidence_excerpt: hit.evidence_excerpt
      });
    }
  }
  const byKind = {};
  for (const s of surfaces) (byKind[s.kind] ||= []).push(s);
  return { surfaces, byKind };
}

// Map a set of matched kinds to the union of in-scope categories and the
// per-threat / per-control slug sets, drawn straight from SIGNALS.
function scopeFromKinds(kinds) {
  const categories = new Set(['general-controls']);   // governance always applies
  const threatSlugs = new Set();
  const controlSlugs = new Set();
  const threatKinds = {};      // slug -> Set(kinds) that gave evidence for it
  const threatControls = {};   // threat slug -> Set(control slugs) to recommend
  for (const sig of SIGNALS) {
    if (!kinds.has(sig.kind)) continue;
    sig.categories.forEach((c) => categories.add(c));
    sig.threats.forEach((t) => {
      threatSlugs.add(t);
      (threatKinds[t] ||= new Set()).add(sig.kind);
      (threatControls[t] ||= new Set());
      sig.controls.forEach((c) => threatControls[t].add(c));
    });
    sig.controls.forEach((c) => controlSlugs.add(c));
  }
  return { categories, threatSlugs, controlSlugs, threatKinds, threatControls };
}

module.exports = { SIGNALS, scanText, scanDir, scopeFromKinds };

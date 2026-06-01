const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { enumerateDir } = require('../scripts/enumerate-ai-surfaces');
const { SURFACE_KINDS } = require('../scripts/lib/ai-surface-detectors');

const FX = (n) => path.join(__dirname, 'fixtures', n);
const REPO_ROOT = path.resolve(__dirname, '..');

// Memoise: tree-sitter init + parse once per fixture across the whole file.
const _cache = new Map();
function doc(fixture) {
  if (!_cache.has(fixture)) _cache.set(fixture, enumerateDir(FX(fixture)));
  return _cache.get(fixture);
}
function byKind(d) {
  const m = {};
  for (const s of d.surfaces) (m[s.kind] ||= []).push(s);
  return m;
}

test('TS/JS: detects llm-call, prompt-construction, tool-definition, rag-embeddings', async () => {
  const d = await doc('llm-app-sample');
  const k = byKind(d);
  assert.ok(k['llm-call']?.some((s) => s.name === 'streamText'), 'streamText');
  assert.ok(k['llm-call']?.some((s) => s.name === 'OpenAI'), 'new OpenAI');
  assert.ok((k['prompt-construction'] || []).length >= 2, 'system + prompt');
  assert.ok(k['tool-definition']?.some((s) => s.name === 'tool'), 'tool()');
  assert.ok(k['rag-embeddings']?.some((s) => /embeddings\.create/.test(s.name)), 'embeddings.create');
});

test('every surface has the documented schema and a known kind', async () => {
  const d = await doc('llm-app-sample');
  for (const s of d.surfaces) {
    for (const f of ['file', 'line_start', 'line_end', 'kind', 'name', 'callers', 'evidence_excerpt']) {
      assert.ok(f in s, `surface missing ${f}`);
    }
    assert.ok(SURFACE_KINDS.includes(s.kind), `unknown kind ${s.kind}`);
    assert.ok(Array.isArray(s.callers));
    assert.ok(s.line_end >= s.line_start);
  }
  const total = Object.values(d.counts_by_kind).reduce((a, b) => a + b, 0);
  assert.equal(total, d.surfaces.length, 'counts_by_kind must total surfaces');
  assert.match(d.parsers.runtime, /web-tree-sitter@/);
});

test('TS/JS v1.0.0 kinds: api-route, auth, external-fetch, log-sink, code-exec, sandbox', async () => {
  const d = await doc('llm-app-sample');
  const k = byKind(d);
  assert.ok(k['api-route']?.some((s) => s.name === 'POST'), 'Next.js POST route');
  assert.ok(k['auth']?.some((s) => s.name === 'getServerSession'), 'getServerSession');
  assert.ok(k['external-fetch']?.some((s) => /api\.example\.com/.test(s.evidence_excerpt)), 'external fetch');
  assert.ok(k['log-sink']?.some((s) => /console\.error/.test(s.name)), 'console.error');
  assert.ok(k['code-exec']?.some((s) => s.name === 'Function'), 'new Function');
  assert.ok(k['code-exec']?.some((s) => /child_process\.exec/.test(s.name)), 'child_process.exec');
  assert.ok(k['code-exec']?.some((s) => /vm\.runInNewContext/.test(s.name)), 'vm.runInNewContext');
  assert.ok(k['sandbox']?.some((s) => s.name === 'loadPyodide'), 'loadPyodide');
  assert.ok(k['sandbox']?.some((s) => s.name === 'Worker'), 'new Worker');
});

test('TS decoy: Vitest test() and readline prompt are NOT AI surfaces', async () => {
  const d = await doc('llm-app-sample');
  assert.equal(d.surfaces.filter((s) => s.file.includes('cli.test.ts')).length, 0);
});

test('TS decoy2: Math.exp/new Map/fetchData/lowercase get are NOT AI surfaces', async () => {
  const d = await doc('llm-app-sample');
  assert.equal(d.surfaces.filter((s) => s.file.includes('decoy2.test.ts')).length, 0);
});

test('external-fetch ignores internal/relative URLs', async () => {
  // The fixture only fetches an absolute https URL; relative fetches never fire.
  const d = await doc('llm-app-sample');
  for (const s of d.surfaces.filter((s) => s.kind === 'external-fetch')) {
    assert.match(s.evidence_excerpt, /https?:\/\//, 'external-fetch must carry an absolute URL');
  }
});

test('Python: f-string prompt, @tool, member calls, and auth — with callers', async () => {
  const d = await doc('py-llm-app');
  const k = byKind(d);
  assert.ok(k['llm-call']?.some((s) => s.name === 'OpenAI'));
  assert.ok(k['llm-call']?.some((s) => /chat\.completions\.create/.test(s.name)));
  assert.ok((k['rag-embeddings'] || []).length >= 1);
  assert.ok(k['prompt-construction']?.some((s) => s.name === 'system_prompt' && s.callers.includes('answer')));
  assert.ok((k['tool-definition'] || []).length >= 1, '@tool decorator');
  assert.ok(k['auth']?.some((s) => s.name === 'get_current_user'));
});

test('Python v1.0.0 kinds: api-route, code-exec, log-sink, external-fetch', async () => {
  const d = await doc('py-llm-app');
  const k = byKind(d);
  assert.ok(k['api-route']?.some((s) => s.name === 'post'), '@app.post route decorator');
  assert.ok(k['code-exec']?.some((s) => /subprocess\.run/.test(s.name)), 'subprocess.run');
  assert.ok(k['log-sink']?.some((s) => /logger\.info/.test(s.name)), 'logger.info');
  assert.ok(k['external-fetch']?.some((s) => /requests\.get/.test(s.name)), 'requests.get');
});

test('Python decoy: pytest.fixture, input() prompt, plain f-string ignored', async () => {
  const d = await doc('py-llm-app');
  assert.equal(d.surfaces.filter((s) => s.file.includes('decoy')).length, 0);
});

test('Go: CreateChatCompletion / NewClient (known SDK) / CreateEmbeddings', async () => {
  const d = await doc('go-llm-app');
  const k = byKind(d);
  assert.ok(k['llm-call']?.some((s) => s.name === 'CreateChatCompletion'));
  assert.ok(k['llm-call']?.some((s) => s.name === 'NewClient'));
  assert.ok(k['rag-embeddings']?.some((s) => s.name === 'CreateEmbeddings'));
});

test('Go decoy: generic .Create() and fmt.Println ignored', async () => {
  const d = await doc('go-llm-app');
  assert.equal(d.surfaces.filter((s) => s.file.includes('decoy')).length, 0);
});

test('run-audit consumes a surfaces.json from the enumerator', async () => {
  const surf = path.join(os.tmpdir(), `oaa-surf-${process.pid}.json`);
  const find = path.join(os.tmpdir(), `oaa-find-${process.pid}.json`);
  const d = await doc('llm-app-sample');
  fs.writeFileSync(surf, JSON.stringify(d) + '\n');
  execFileSync('node', [
    path.join(REPO_ROOT, 'scripts', 'run-audit.js'), FX('llm-app-sample'),
    '--surfaces', surf, '--no-fetch', '--no-dashboard', '--out', find,
  ], { encoding: 'utf8' });
  const findings = JSON.parse(fs.readFileSync(find, 'utf8'));
  fs.rmSync(surf, { force: true });
  fs.rmSync(find, { force: true });
  assert.equal(findings.grounding.surface_discovery, 'enumerator');
  assert.ok(findings.findings.length > 0);
  assert.ok(findings.findings.every((f) => f.verdict === 'UNKNOWN'));
});

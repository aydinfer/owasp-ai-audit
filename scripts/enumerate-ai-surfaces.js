#!/usr/bin/env node
/**
 * enumerate-ai-surfaces.js — Deterministic, AST-based catalogue of every AI
 * surface in a codebase, written before the audit reasons about anything.
 *
 * Why: auditing by reading every file misses sinks buried in 5000-line files
 * (see benchmarks/skill-issues.md). This pass parses each source file with a
 * vendored tree-sitter grammar and matches structural queries, so findings can
 * be anchored to detected nodes rather than to what fit in a context window.
 *
 * No third-party runtime dependency: the tree-sitter runtime and the per-
 * language parser .wasm files are vendored (and pinned + checksummed) under
 * scripts/lib/parsers/ — there is no npm install step. See that directory's
 * README.md for versions and provenance.
 *
 * Output: surfaces.json — { ..., surfaces: [{ file, line_start, line_end,
 * kind, name, callers, evidence_excerpt }] }. Schema documented in SKILL.md.
 *
 * Usage:
 *   node scripts/enumerate-ai-surfaces.js <target> [--out surfaces.json] [--quiet]
 *
 * Exit codes: 0 ok · 2 parser runtime failed to load · 3 invalid invocation
 */

const fs = require('node:fs');
const path = require('node:path');
const { forExtension, SURFACE_KINDS } = require('./lib/ai-surface-detectors');

const PARSERS_DIR = path.join(__dirname, 'lib', 'parsers');
const RUNTIME_VERSION = 'web-tree-sitter@0.20.8';
const GRAMMARS_VERSION = 'tree-sitter-wasms@0.1.13';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'vendor',
  'coverage', '.venv', 'venv', '__pycache__', '.cache', 'target',
  'parsers',   // never parse our own vendored wasm dir
]);
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const EXCERPT_MAX = 160;

// Function-like node types per grammar, used to label `callers`.
const FN_TYPES = new Set([
  'function_declaration', 'function_definition', 'method_definition',
  'method_declaration', 'arrow_function', 'function_expression',
  'func_literal', 'generator_function_declaration',
]);

function firstLine(text) {
  const l = String(text).split('\n')[0].trim();
  return l.length > EXCERPT_MAX ? l.slice(0, EXCERPT_MAX - 1) + '…' : l;
}

// Innermost-first list of enclosing named functions (best-effort, capped).
function enclosingCallers(node, max = 3) {
  const names = [];
  let n = node.parent;
  while (n && names.length < max) {
    if (FN_TYPES.has(n.type)) {
      let name = n.childForFieldName && n.childForFieldName('name');
      if (!name && (n.type === 'arrow_function' || n.type === 'function_expression')) {
        // assigned to a variable or used as an object value
        const p = n.parent;
        if (p && p.type === 'variable_declarator') name = p.childForFieldName('name');
        else if (p && p.type === 'pair') name = p.childForFieldName('key');
      }
      if (name && name.text) names.push(name.text);
    }
    n = n.parent;
  }
  return names;
}

// web-tree-sitter's Parser.init() can only run once per process (the module
// is require-cached and init is consumed), so initialise it as a singleton.
// Language and compiled Query objects are global and reusable across parser
// instances, so cache them at module scope. Each makeContext() still gets its
// own Parser instance, so concurrent enumerations never race on setLanguage.
let _ParserClass = null;
let _initPromise = null;
const _langCache = new Map();    // langName -> Language
const _queryCache = new Map();   // `${langName}::${query}` -> Query

async function getParserClass() {
  if (!_initPromise) {
    try {
      _ParserClass = require(path.join(PARSERS_DIR, 'tree-sitter.js'));
      _initPromise = _ParserClass.init({ locateFile: (f) => path.join(PARSERS_DIR, f) });
    } catch (e) {
      _initPromise = Promise.reject(e);
    }
  }
  try {
    await _initPromise;
  } catch (e) {
    const err = new Error(`tree-sitter runtime failed to load from ${PARSERS_DIR}: ${e.message}`);
    err.code = 'RUNTIME_LOAD';
    throw err;
  }
  return _ParserClass;
}

async function makeContext() {
  const Parser = await getParserClass();
  const parser = new Parser();

  async function loadLanguage(langName) {
    if (_langCache.has(langName)) return _langCache.get(langName);
    const Lang = await Parser.Language.load(path.join(PARSERS_DIR, `tree-sitter-${langName}.wasm`));
    _langCache.set(langName, Lang);
    return Lang;
  }
  function compile(langName, Lang, queryStr) {
    const key = `${langName}::${queryStr}`;
    if (_queryCache.has(key)) return _queryCache.get(key);
    const q = Lang.query(queryStr);
    _queryCache.set(key, q);
    return q;
  }
  return { parser, loadLanguage, compile };
}

// Run every detector for a parsed tree; returns surfaces for one file.
function detectInTree(tree, detectors, ctx, langName, Lang, relFile) {
  const out = [];
  const seen = new Set();
  for (const det of detectors) {
    const q = ctx.compile(langName, Lang, det.query);
    for (const match of q.matches(tree.rootNode)) {
      const caps = {};
      const capsNode = {};
      for (const c of match.captures) { caps[c.name] = c.node.text; capsNode[c.name] = c.node; }
      if (!det.test(caps)) continue;
      const surface = capsNode.surface || capsNode.name;
      if (!surface) continue;
      const key = `${det.kind}:${surface.startPosition.row}:${surface.startPosition.column}:${surface.endPosition.row}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        file: relFile,
        line_start: surface.startPosition.row + 1,
        line_end: surface.endPosition.row + 1,
        kind: det.kind,
        name: caps.name || firstLine(surface.text),
        callers: enclosingCallers(surface),
        evidence_excerpt: firstLine(surface.text),
      });
    }
  }
  return out;
}

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

// Enumerate a directory tree. Returns the surfaces.json document object.
async function enumerateDir(root, opts = {}) {
  const ctx = await makeContext();
  const surfaces = [];
  for (const file of walk(root)) {
    const reg = forExtension(path.extname(file));
    if (!reg) continue;
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (stat.size > MAX_FILE_BYTES) continue;
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const Lang = await ctx.loadLanguage(reg.lang);
    ctx.parser.setLanguage(Lang);
    const tree = ctx.parser.parse(text);
    const rel = path.relative(root, file);
    for (const s of detectInTree(tree, reg.detectors, ctx, reg.lang, Lang, rel)) surfaces.push(s);
  }
  surfaces.sort((a, b) =>
    a.file.localeCompare(b.file) || a.line_start - b.line_start || a.kind.localeCompare(b.kind));

  const countsByKind = Object.fromEntries(SURFACE_KINDS.map((k) => [k, 0]));
  for (const s of surfaces) countsByKind[s.kind] = (countsByKind[s.kind] || 0) + 1;

  return {
    tool: 'enumerate-ai-surfaces',
    schema_version: 1,
    target: path.resolve(root),
    generated_at: opts.now || new Date().toISOString(),
    parsers: { runtime: RUNTIME_VERSION, grammars: GRAMMARS_VERSION },
    counts_by_kind: countsByKind,
    surfaces,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  let target = null, out = 'surfaces.json', quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out = argv[++i];
    else if (a === '--quiet') quiet = true;
    else if (!a.startsWith('-') && !target) target = a;
  }
  if (!target) {
    console.error('usage: enumerate-ai-surfaces.js <target> [--out surfaces.json] [--quiet]');
    process.exit(3);
  }
  if (!fs.existsSync(target)) {
    console.error(`target not found: ${target}`);
    process.exit(3);
  }
  let doc;
  try {
    doc = await enumerateDir(target);
  } catch (e) {
    if (e.code === 'RUNTIME_LOAD') { console.error(e.message); process.exit(2); }
    throw e;
  }
  fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  if (!quiet) {
    const c = doc.counts_by_kind;
    console.log(`Wrote ${doc.surfaces.length} AI surface(s) to ${out}`);
    console.log('  ' + Object.entries(c).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(', '));
  }
}

module.exports = { enumerateDir, makeContext, enclosingCallers };

if (require.main === module) {
  main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
}

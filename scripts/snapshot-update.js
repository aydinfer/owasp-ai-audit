#!/usr/bin/env node
/**
 * snapshot-update.js — Refreshes reference/snapshot/ by fetching every threat
 * and control listed in reference/taxonomy-index.json from owaspai.org.
 *
 * Used by the weekly GitHub Action (.github/workflows/snapshot-refresh.yml).
 * Can also be run locally to bootstrap a snapshot.
 *
 * Usage:  node scripts/snapshot-update.js [--verbose] [--dry-run]
 *
 * Exit codes:
 *   0 — all entries fetched (or unchanged), snapshot is current
 *   1 — one or more entries failed; snapshot left in best-effort state
 *   2 — fatal error (taxonomy missing, etc.)
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(REPO_ROOT, 'reference', 'taxonomy-index.json');
const SNAPSHOT_DIR = path.join(REPO_ROOT, 'reference', 'snapshot');
const CROSSREF_PATH = path.join(REPO_ROOT, 'reference', 'cross-references.json');
const ATLAS_DATA_URL = 'https://raw.githubusercontent.com/mitre-atlas/atlas-data/main/dist/ATLAS.yaml';

const args = new Set(process.argv.slice(2));
const VERBOSE = args.has('--verbose');
const DRY_RUN = args.has('--dry-run');

const log = (...m) => console.log(...m);
const vlog = (...m) => VERBOSE && console.log(...m);

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'owasp-ai-audit-snapshot/0.1 (+https://github.com/aydinfer/owasp-ai-audit)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 20000
    }, (res) => {
      // Follow one redirect
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(fetchUrl(new URL(res.headers.location, url).toString()));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ body, etag: res.headers.etag || '' }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`timeout fetching ${url}`));
    });
  });
}

function htmlToText(html) {
  // Crude but deterministic. The dashboard rendering does not need
  // perfectly-faithful Markdown — it needs the threat text content with
  // links and headings preserved enough for citation.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/(h[1-6]|p|li|tr|div|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Validate reference/cross-references.json: every cited ATLAS id must exist in
// the authoritative MITRE atlas-data dataset (the atlas.mitre.org pages are
// client-rendered and 404 to non-browser clients, so a naive 200-check is
// meaningless — verifying IDs against the dataset is a stronger guarantee), and
// every distinct NIST publication URL must return 200.
async function validateCrossReferences() {
  if (!fs.existsSync(CROSSREF_PATH)) {
    vlog('  no cross-references.json; skipping cross-reference validation');
    return { ok: 0, failed: 0, failures: [] };
  }
  const cr = JSON.parse(fs.readFileSync(CROSSREF_PATH, 'utf8'));
  const failures = [];
  let ok = 0;

  // Collect cited ATLAS ids and distinct NIST urls.
  const atlasIds = new Set();
  const nistUrls = new Set();
  for (const slug of Object.keys(cr.map || {})) {
    for (const a of cr.map[slug].atlas || []) atlasIds.add(a.id);
    for (const n of cr.map[slug].nist || []) nistUrls.add(n.url);
  }

  // ATLAS: fetch the dataset and check every id is present.
  log(`Validating ${atlasIds.size} ATLAS id(s) against ${ATLAS_DATA_URL} …`);
  try {
    const { body } = await fetchUrl(ATLAS_DATA_URL);
    const present = new Set([...body.matchAll(/id:\s*(AML\.(?:T|M)\d+(?:\.\d+)?)\s*$/gm)].map((m) => m[1]));
    for (const id of atlasIds) {
      if (present.has(id)) { ok += 1; }
      else { failures.push({ kind: 'atlas', id, error: 'id not in atlas-data dataset' }); console.error(`  FAIL  ATLAS ${id} not in dataset`); }
    }
  } catch (e) {
    failures.push({ kind: 'atlas', url: ATLAS_DATA_URL, error: String(e.message || e) });
    console.error(`  FAIL  could not fetch ATLAS dataset: ${e.message || e}`);
  }

  // NIST: every distinct publication URL must return 200.
  log(`Validating ${nistUrls.size} NIST publication URL(s) …`);
  for (const url of nistUrls) {
    try { await fetchUrl(url); ok += 1; vlog(`  ok  ${url}`); }
    catch (e) { failures.push({ kind: 'nist', url, error: String(e.message || e) }); console.error(`  FAIL  NIST ${url}  ${e.message || e}`); }
  }

  log(`Cross-references: ${ok} ok, ${failures.length} failed.`);
  return { ok, failed: failures.length, failures };
}

async function main() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`taxonomy index not found at ${INDEX_PATH}`);
    process.exit(2);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  if (!DRY_RUN) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  const entries = [
    ...index.threats.map((t) => ({ kind: 'threat', ...t })),
    ...(index.controls || []).map((c) => ({ kind: 'control', ...c }))
  ];

  log(`Refreshing snapshot for ${entries.length} entries…`);
  let ok = 0;
  let failed = 0;
  const failures = [];
  const fetchedAt = new Date().toISOString();

  for (const entry of entries) {
    try {
      vlog(`  fetching ${entry.slug}  ${entry.url}`);
      const { body, etag } = await fetchUrl(entry.url);
      const contentMd = htmlToText(body);

      const record = {
        slug: entry.slug,
        url: entry.url,
        title: entry.title,
        kind: entry.kind,
        category: entry.category || null,
        content_md: contentMd,
        etag,
        fetched_at: fetchedAt
      };

      if (!DRY_RUN) {
        const out = path.join(SNAPSHOT_DIR, `${entry.slug}.json`);
        fs.writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
      }
      ok += 1;
    } catch (e) {
      failed += 1;
      failures.push({ slug: entry.slug, url: entry.url, error: String(e.message || e) });
      console.error(`  FAIL  ${entry.slug}  ${e.message || e}`);
    }
  }

  // Validate cross-references (ATLAS ids + NIST urls) alongside the OWASP set.
  const xref = await validateCrossReferences();

  // Write a manifest
  const manifest = {
    generated_at: fetchedAt,
    source: 'https://owaspai.org/',
    entries_total: entries.length,
    entries_ok: ok,
    entries_failed: failed,
    failures,
    cross_references: { ok: xref.ok, failed: xref.failed, failures: xref.failures }
  };
  if (!DRY_RUN) {
    fs.writeFileSync(path.join(SNAPSHOT_DIR, 'manifest.json'),
                     JSON.stringify(manifest, null, 2) + '\n');
  }

  const totalFailed = failed + xref.failed;
  log(`Done. ${ok} ok, ${failed} failed (OWASP); ${xref.ok} ok, ${xref.failed} failed (cross-refs).`);
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(2);
});

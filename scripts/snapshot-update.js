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

  // Write a manifest
  const manifest = {
    generated_at: fetchedAt,
    source: 'https://owaspai.org/',
    entries_total: entries.length,
    entries_ok: ok,
    entries_failed: failed,
    failures
  };
  if (!DRY_RUN) {
    fs.writeFileSync(path.join(SNAPSHOT_DIR, 'manifest.json'),
                     JSON.stringify(manifest, null, 2) + '\n');
  }

  log(`Done. ${ok} ok, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(2);
});

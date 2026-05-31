#!/usr/bin/env node
/**
 * pr-comment.js — Post (or update) the static-screen summary as a PR comment.
 *
 * Reads a findings.json, builds a Markdown summary with scripts/lib/audit-summary,
 * and posts it to the pull request via the GitHub REST API using Node's stdlib
 * https (no third-party deps). It is a safe noop when:
 *   - the event is not a pull_request (GITHUB_EVENT_NAME)
 *   - no token is present (GITHUB_TOKEN / INPUT_GITHUB-TOKEN)
 *   - the event payload has no PR number
 *
 * To keep the PR conversation clean, it updates a prior comment it recognises
 * by a hidden marker rather than posting a fresh one each run.
 *
 * Usage:  node scripts/pr-comment.js <findings.json>
 * Exit:   always 0 (commenting must never fail the build)
 */

const fs = require('node:fs');
const https = require('node:https');
const { buildSummary } = require('./lib/audit-summary');

const MARKER = '<!-- owasp-ai-audit:static-screen -->';

function ghRequest(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: urlPath,
      method,
      headers: {
        'User-Agent': 'owasp-ai-audit-action',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(buf ? JSON.parse(buf) : {});
        } else {
          reject(new Error(`GitHub API ${method} ${urlPath} → ${res.statusCode}: ${buf.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const inPath = process.argv[2] || 'findings.json';
  const token = process.env.GITHUB_TOKEN || process.env['INPUT_GITHUB-TOKEN'] || '';
  const eventName = process.env.GITHUB_EVENT_NAME || '';
  const repo = process.env.GITHUB_REPOSITORY || '';
  const eventPath = process.env.GITHUB_EVENT_PATH || '';

  if (!eventName.startsWith('pull_request')) {
    console.log('pr-comment: not a pull_request event; skipping.');
    return;
  }
  if (!token || !repo || !eventPath || !fs.existsSync(eventPath)) {
    console.log('pr-comment: missing token/repo/event payload; skipping.');
    return;
  }
  let prNumber;
  try {
    const ev = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    prNumber = ev.pull_request?.number || ev.number;
  } catch { /* ignore */ }
  if (!prNumber) {
    console.log('pr-comment: no PR number in event payload; skipping.');
    return;
  }
  if (!fs.existsSync(inPath)) {
    console.log(`pr-comment: ${inPath} not found; skipping.`);
    return;
  }

  const findings = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const summary = buildSummary(findings, { title: 'OWASP AI Audit — static first-pass screen' });
  const bodyText = `${MARKER}\n${summary}\n_Posted by [owasp-ai-audit](https://github.com/aydinfer/owasp-ai-audit) — a static screen, not a full audit._`;

  const [owner, name] = repo.split('/');
  const base = `/repos/${owner}/${name}`;
  try {
    const existing = await ghRequest('GET', `${base}/issues/${prNumber}/comments?per_page=100`, token);
    const prior = Array.isArray(existing) ? existing.find((c) => (c.body || '').includes(MARKER)) : null;
    if (prior) {
      await ghRequest('PATCH', `${base}/issues/comments/${prior.id}`, token, { body: bodyText });
      console.log(`pr-comment: updated comment ${prior.id} on PR #${prNumber}.`);
    } else {
      await ghRequest('POST', `${base}/issues/${prNumber}/comments`, token, { body: bodyText });
      console.log(`pr-comment: posted new comment on PR #${prNumber}.`);
    }
  } catch (e) {
    console.log(`pr-comment: GitHub API call failed (non-fatal): ${e.message}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.log(`pr-comment: unexpected error (non-fatal): ${e.message}`);
  process.exit(0);
});

#!/usr/bin/env node
/**
 * reground-applies-to.js — Re-derive the `applies_to` field on every
 * taxonomy-index.json entry from per-permalink section text in the live
 * OWASP AI Exchange chapter pages.
 *
 * Method
 * ------
 * 1. Fetch the six chapter pages from owaspai.org.
 * 2. For each "Category: ... <br> Permalink: ..." block, extract the section
 *    text running up to the next Permalink block. This is the per-topic
 *    content between OWASP's own boundary markers.
 * 3. Pattern-match the section for explicit kind signals:
 *      - genai:      GenAI / generative AI / LLM / language model /
 *                    prompt / chatbot / system prompt / jailbreak / completion
 *      - predictive: predictive AI / predictive model / classifier /
 *                    classification model / regression / discriminative /
 *                    feature engineering / tabular / decision boundary
 *      - agent:      agentic / agentic AI / autonomous agent / AI agent /
 *                    tool use / tool calling / function call(ing) / MCP
 * 4. Apply a small set of slug-specific OVERRIDES for canonical attack
 *    and control families where pattern matching is plainly insufficient
 *    (e.g., "evasion" is the predictive-ML attack family by construction,
 *    even when a section's prose happens to use generic language).
 * 5. Default for sections with no explicit kind signal: [genai, predictive].
 *    Never tag `agent` without an explicit signal.
 *
 * Usage:  node scripts/reground-applies-to.js [--verbose] [--dry-run]
 *
 * Exit codes:
 *   0 — index updated (or unchanged in dry-run)
 *   1 — one or more chapter fetches failed
 *   2 — fatal error
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(REPO_ROOT, 'reference', 'taxonomy-index.json');

const args = new Set(process.argv.slice(2));
const VERBOSE = args.has('--verbose');
const DRY_RUN = args.has('--dry-run');

const CHAPTERS = [
  { url: 'https://owaspai.org/docs/1_general_controls/',                       cat: 'general-controls' },
  { url: 'https://owaspai.org/docs/2_threats_through_use/',                    cat: 'input-threats' },
  { url: 'https://owaspai.org/docs/3_development_time_threats/',               cat: 'dev-time' },
  { url: 'https://owaspai.org/docs/4_runtime_application_security_threats/',   cat: 'runtime' },
  { url: 'https://owaspai.org/docs/5_testing/',                                cat: 'testing' },
  { url: 'https://owaspai.org/docs/6_privacy/',                                cat: 'privacy' }
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'owasp-ai-audit-reground/0.2 (+https://github.com/aydinfer/owasp-ai-audit)',
        'Accept': 'text/html'
      },
      timeout: 20000
    }, (res) => {
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
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`timeout fetching ${url}`)));
  });
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSections(html, chapterCat) {
  const sections = [];
  const permalinkRe = /Category:\s*[^<\n]+?\s*<br>\s*Permalink:\s*<a\s+href=https:\/\/owaspai\.org\/go\/([a-zA-Z0-9_-]+)\//g;
  const matches = [];
  let m;
  while ((m = permalinkRe.exec(html)) !== null) {
    matches.push({ slug: m[1], blockStart: m.index, blockEnd: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const end = (i + 1 < matches.length) ? matches[i + 1].blockStart : html.length;
    sections.push({
      slug: matches[i].slug,
      chapter: chapterCat,
      text: htmlToText(html.slice(matches[i].blockEnd, end))
    });
  }
  return sections;
}

const GENAI_PATTERNS = [
  /\bgenai\b/, /\bgenerative ai\b/, /\bgenerative model\b/,
  /\bllm\b/, /\blarge language model\b/, /\blanguage model\b/,
  /\bprompt\b/, /\bchatbot\b/, /\bcompletion\b/, /\bsystem prompt\b/,
  /\bjailbreak\b/, /\btext generation\b/
];

const PREDICTIVE_PATTERNS = [
  /\bpredictive ai\b/, /\bpredictive model\b/, /\bpredictive ml\b/,
  /\bclassifier\b/, /\bclassification model\b/, /\bregression\b/,
  /\bdecision boundary\b/, /\bdiscriminative\b/, /\bfeature engineering\b/,
  /\btabular\b/
];

const AGENT_PATTERNS = [
  /\bagentic\b/, /\bagentic ai\b/,
  /\bautonomous agent\b/, /\bai agent\b/,
  /\btool use\b/, /\btool calling\b/, /\bfunction call(?:ing)?\b/,
  /\bmcp\b/
];

function detectKinds(text) {
  const t = text.toLowerCase();
  return {
    genai:      GENAI_PATTERNS.some((re) => re.test(t)),
    predictive: PREDICTIVE_PATTERNS.some((re) => re.test(t)),
    agent:      AGENT_PATTERNS.some((re) => re.test(t))
  };
}

// Cross-cutting entries (no chapter section) — manual mapping.
const CROSS_CUTTING_TAGS = {
  agenticaithreats: ['agent', 'genai']
};

// Slug-specific overrides for canonical attack/control families where the
// OWASP source's per-section prose is too generic to distinguish.
const OVERRIDES = {
  // Evasion family is canonically predictive-ML attacks.
  evasion:                       { add: ['predictive'] },
  evasioninputhandling:          { add: ['predictive'] },
  evasionrobustmodel:            { add: ['predictive'] },
  evasionafterpoison:            { add: ['predictive'] },
  zeroknowledgeevasion:          { force: ['predictive'] },
  perfectknowledgeevasion:       { force: ['predictive'] },
  partialknowledgeevasion:       { force: ['predictive'] },
  transferattack:                { force: ['predictive'] },
  trainadversarial:              { add: ['predictive'] },
  inputdistortion:               { add: ['predictive'] },
  adversarialrobustdistillation: { add: ['predictive'] },

  // Prompt injection family is GenAI-only (agents amplify).
  promptinjection:               { force: ['agent', 'genai'] },
  directpromptinjection:         { force: ['agent', 'genai'] },
  indirectpromptinjection:       { force: ['agent', 'genai'] },
  promptinjectioniohandling:     { force: ['agent', 'genai'] },
  promptinjectionsevenlayers:    { force: ['agent', 'genai'] },
  testingpromptinjection:        { force: ['agent', 'genai'] },
  inputsegregation:              { force: ['agent', 'genai'] },

  // Theft / inversion / membership: any model can be targeted.
  modelinversionandmembership:   { force: ['genai', 'predictive'] },
  modelexfiltration:             { force: ['genai', 'predictive'] },
  modeltheftuse:                 { force: ['genai', 'predictive'] },

  // Poisoning applies wherever training/fine-tuning happens.
  datapoison:           { force: ['genai', 'predictive'] },
  modelpoison:          { force: ['genai', 'predictive'] },
  devmodelpoison:       { force: ['genai', 'predictive'] },
  supplymodelpoison:    { force: ['genai', 'predictive'] },
  runtimemodelpoison:   { force: ['genai', 'predictive'] },
  poisonrobustmodel:    { force: ['genai', 'predictive'] },
  traindatadistortion:  { force: ['genai', 'predictive'] },
  dataqualitycontrol:   { force: ['genai', 'predictive'] },
  moretraindata:        { force: ['genai', 'predictive'] },
  obfuscatetrainingdata:{ force: ['genai', 'predictive'] },
  datalimit:            { force: ['genai', 'predictive'] },

  // Governance / program / policy: all three model classes.
  governancecontrols:    { force: ['agent', 'genai', 'predictive'] },
  generalcontrols:       { force: ['agent', 'genai', 'predictive'] },
  aiprogram:             { force: ['agent', 'genai', 'predictive'] },
  secprogram:            { force: ['agent', 'genai', 'predictive'] },
  secdevprogram:         { force: ['agent', 'genai', 'predictive'] },
  devprogram:            { force: ['agent', 'genai', 'predictive'] },
  checkcompliance:       { force: ['agent', 'genai', 'predictive'] },
  seceducate:            { force: ['agent', 'genai', 'predictive'] },
  oversight:             { force: ['agent', 'genai', 'predictive'] },
  continuousvalidation:  { force: ['agent', 'genai', 'predictive'] },
  aitransparency:        { force: ['agent', 'genai', 'predictive'] },

  // Tooling reviews target specific model classes by name.
  testingtoolsgenai:        { force: ['agent', 'genai'] },
  testingtoolspredictiveai: { force: ['predictive'] },
  testing:                  { force: ['agent', 'genai', 'predictive'] }
};

function applyToEntry(e, slugKinds) {
  if (e.category === 'privacy') return ['agent', 'genai', 'predictive'];
  if (CROSS_CUTTING_TAGS[e.slug]) return [...CROSS_CUTTING_TAGS[e.slug]].sort();
  if (OVERRIDES[e.slug]?.force)   return [...OVERRIDES[e.slug].force].sort();

  const k = slugKinds[e.slug];
  if (!k) return e.applies_to;

  const tags = new Set();
  if (k.genai)      tags.add('genai');
  if (k.predictive) tags.add('predictive');
  if (k.agent)      tags.add('agent');
  for (const t of OVERRIDES[e.slug]?.add || []) tags.add(t);

  if (tags.size === 0) return ['genai', 'predictive'];
  return [...tags].sort();
}

async function main() {
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));

  console.log(`Fetching ${CHAPTERS.length} chapter pages…`);
  const slugKinds = {};
  let failed = 0;
  for (const { url, cat } of CHAPTERS) {
    try {
      if (VERBOSE) console.log(`  ${cat}  ${url}`);
      const html = await fetchUrl(url);
      const sections = extractSections(html, cat);
      for (const s of sections) {
        if (!slugKinds[s.slug]) slugKinds[s.slug] = { genai: false, predictive: false, agent: false };
        const d = detectKinds(s.text);
        slugKinds[s.slug].genai      = slugKinds[s.slug].genai      || d.genai;
        slugKinds[s.slug].predictive = slugKinds[s.slug].predictive || d.predictive;
        slugKinds[s.slug].agent      = slugKinds[s.slug].agent      || d.agent;
      }
    } catch (e) {
      console.error(`  FAIL  ${cat}  ${e.message || e}`);
      failed += 1;
    }
  }

  if (failed > 0) {
    console.error(`${failed} chapter(s) failed; index left unchanged.`);
    process.exit(1);
  }

  let changed = 0;
  for (const e of [...index.threats, ...index.controls]) {
    const before = JSON.stringify([...(e.applies_to || [])].sort());
    const after  = JSON.stringify(applyToEntry(e, slugKinds));
    if (before !== after) {
      if (VERBOSE) console.log(`  ${e.slug}: ${before} → ${after}`);
      changed += 1;
    }
    e.applies_to = applyToEntry(e, slugKinds);
  }

  if (DRY_RUN) {
    console.log(`Dry run. ${changed} entries would change.`);
  } else {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n');
    console.log(`Updated ${changed} entries in ${path.relative(REPO_ROOT, INDEX_PATH)}.`);
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(2);
});

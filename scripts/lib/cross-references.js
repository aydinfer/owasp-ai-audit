// cross-references.js — loader for reference/cross-references.json, the
// hand-curated map from an OWASP slug to the MITRE ATLAS techniques/mitigations
// and NIST AI 100-2 sections describing the same phenomenon. OWASP stays the
// primary citation; these are additive secondary anchors.

const fs = require('node:fs');
const path = require('node:path');

const REF_PATH = path.resolve(__dirname, '..', '..', 'reference', 'cross-references.json');

let _doc = null;
function load() {
  if (!_doc) _doc = JSON.parse(fs.readFileSync(REF_PATH, 'utf8'));
  return _doc;
}

// owaspai.org/go/{slug}/ -> slug
function slugFromUrl(url) {
  const m = String(url || '').match(/\/go\/([a-z0-9-]+)\/?$/i);
  return m ? m[1] : null;
}

// Return the additive citations for a slug in the findings.json shape
// ({ atlas: [{id, url}], nist: [{section, url}] }), or null if none are curated.
function lookup(slug) {
  const entry = load().map[slug];
  if (!entry) return null;
  const out = {};
  if (entry.atlas?.length) out.atlas = entry.atlas.map((a) => ({ id: a.id, url: a.url }));
  if (entry.nist?.length) out.nist = entry.nist.map((n) => ({ section: n.section, url: n.url }));
  return Object.keys(out).length ? out : null;
}

function lookupByUrl(threatUrl) {
  const slug = slugFromUrl(threatUrl);
  return slug ? lookup(slug) : null;
}

module.exports = { load, lookup, lookupByUrl, slugFromUrl, REF_PATH };

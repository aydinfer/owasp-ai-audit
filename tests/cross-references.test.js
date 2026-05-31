const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lookup, lookupByUrl, slugFromUrl } = require('../scripts/lib/cross-references');

const REPO_ROOT = path.resolve(__dirname, '..');
const cr = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'reference', 'cross-references.json'), 'utf8'));
const idx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'reference', 'taxonomy-index.json'), 'utf8'));
const SLUGS = new Set([...idx.threats, ...idx.controls].map((e) => e.slug));

const ATLAS_ID = /^AML\.(?:T|M)\d+(?:\.\d+)?$/;

test('schema: top-level note + sources for OWASP, ATLAS, NIST', () => {
  assert.ok(cr.schema_version);
  assert.ok(cr.note);
  assert.ok(cr.sources?.owasp);
  assert.ok(cr.sources?.atlas?.data, 'ATLAS data source recorded');
  assert.ok(cr.sources?.nist?.pub, 'NIST pub url recorded');
});

test('has at least the 30 most-cited slugs', () => {
  assert.ok(Object.keys(cr.map).length >= 30, `only ${Object.keys(cr.map).length} entries`);
});

test('every map key is a real OWASP slug in the taxonomy index', () => {
  for (const slug of Object.keys(cr.map)) {
    assert.ok(SLUGS.has(slug), `cross-reference slug not in taxonomy: ${slug}`);
  }
});

test('every entry has at least one ATLAS or NIST anchor', () => {
  for (const [slug, entry] of Object.entries(cr.map)) {
    const n = (entry.atlas || []).length + (entry.nist || []).length;
    assert.ok(n >= 1, `${slug} has no ATLAS or NIST anchor`);
  }
});

test('ATLAS anchors are well-formed (id pattern, name, atlas.mitre.org url)', () => {
  for (const [slug, entry] of Object.entries(cr.map)) {
    for (const a of entry.atlas || []) {
      assert.match(a.id, ATLAS_ID, `${slug}: bad ATLAS id ${a.id}`);
      assert.ok(a.name, `${slug}: ATLAS ${a.id} missing name`);
      assert.match(a.url, /^https:\/\/atlas\.mitre\.org\/(techniques|mitigations)\/AML\./, `${slug}: bad ATLAS url`);
      // technique ids live under /techniques/, mitigation ids under /mitigations/
      const seg = a.id.startsWith('AML.M') ? 'mitigations' : 'techniques';
      assert.ok(a.url.includes(`/${seg}/${a.id}`), `${slug}: ${a.id} url/segment mismatch`);
    }
  }
});

test('NIST anchors are well-formed (section + csrc.nist.gov url)', () => {
  for (const [slug, entry] of Object.entries(cr.map)) {
    for (const n of entry.nist || []) {
      assert.ok(n.section && n.section.length > 3, `${slug}: NIST missing section`);
      assert.match(n.url, /^https:\/\/csrc\.nist\.gov\/pubs\/ai\/100\/2\//, `${slug}: bad NIST url`);
    }
  }
});

test('loader.lookup returns the findings.json shape (id/url for ATLAS, section/url for NIST)', () => {
  const x = lookup('indirectpromptinjection');
  assert.ok(x.atlas.some((a) => a.id === 'AML.T0051.001'));
  for (const a of x.atlas) {
    assert.deepEqual(Object.keys(a).sort(), ['id', 'url']);   // name stripped for findings
  }
  for (const n of x.nist) {
    assert.deepEqual(Object.keys(n).sort(), ['section', 'url']);
  }
  assert.equal(lookup('definitely-not-a-slug'), null);
});

test('slugFromUrl + lookupByUrl resolve an owaspai.org permalink', () => {
  assert.equal(slugFromUrl('https://owaspai.org/go/promptinjection/'), 'promptinjection');
  const x = lookupByUrl('https://owaspai.org/go/promptinjection/');
  assert.ok(x.atlas.some((a) => a.id === 'AML.T0051'));
});

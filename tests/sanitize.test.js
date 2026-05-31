const test = require('node:test');
const assert = require('node:assert/strict');
const { esc, safeUrl } = require('../scripts/lib/sanitize');

test('esc encodes the five characters that matter inside HTML', () => {
  assert.equal(esc('&'), '&amp;');
  assert.equal(esc('<'), '&lt;');
  assert.equal(esc('>'), '&gt;');
  assert.equal(esc('"'), '&quot;');
  assert.equal(esc("'"), '&#39;');
});

test('esc encodes a script tag so it cannot execute when interpolated', () => {
  assert.equal(
    esc('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;'
  );
});

test('esc handles null / undefined / non-string input without throwing', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

test('safeUrl accepts http(s) and mailto absolute URLs unchanged', () => {
  assert.equal(safeUrl('https://owaspai.org/go/promptinjection/'), 'https://owaspai.org/go/promptinjection/');
  assert.equal(safeUrl('http://example.com'), 'http://example.com');
  assert.equal(safeUrl('mailto:security@example.com'), 'mailto:security@example.com');
});

test('safeUrl accepts relative paths and fragments unchanged', () => {
  assert.equal(safeUrl('/docs/findings'), '/docs/findings');
  assert.equal(safeUrl('#section-3'), '#section-3');
});

test('safeUrl rewrites every known script-execution scheme to #', () => {
  const dangerous = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'VBScript:msgbox(1)',
    'file:///etc/passwd'
  ];
  for (const u of dangerous) {
    assert.equal(safeUrl(u), '#', `expected ${u} to be neutralized`);
  }
});

test('safeUrl strips leading whitespace before deciding (no bypass via space-padding)', () => {
  assert.equal(safeUrl('  javascript:alert(1)'), '#');
  assert.equal(safeUrl('\tjavascript:alert(1)'), '#');
  assert.equal(safeUrl('  https://example.com'), 'https://example.com');
});

test('safeUrl handles null / undefined / empty string as #', () => {
  assert.equal(safeUrl(null), '#');
  assert.equal(safeUrl(undefined), '#');
  assert.equal(safeUrl(''), '#');
  assert.equal(safeUrl('   '), '#');
});

test('safeUrl rejects unknown protocols (ftp, gopher, etc.)', () => {
  assert.equal(safeUrl('ftp://example.com'), '#');
  assert.equal(safeUrl('gopher://example.com'), '#');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { htmlToText, extractSections } = require('../scripts/lib/extract');

test('htmlToText strips tags, scripts, styles, and comments', () => {
  const html = '<p>Hello <script>alert(1)</script><style>x{color:red}</style><!-- note -->world</p>';
  assert.equal(htmlToText(html), 'Hello world');
});

test('htmlToText decodes the entities we actually see on owaspai.org', () => {
  const html = 'a &amp; b &lt; c &gt; d &nbsp;e &ldquo;f&rdquo; &rsquo;g&ndash;h';
  assert.equal(htmlToText(html), "a & b < c > d e \"f\" 'g-h");
});

test('htmlToText collapses whitespace and trims', () => {
  const html = '  <p>foo</p>\n\n\n<p>  bar\t</p>  ';
  assert.equal(htmlToText(html), 'foo bar');
});

test('htmlToText handles null / undefined / empty input', () => {
  assert.equal(htmlToText(null), '');
  assert.equal(htmlToText(undefined), '');
  assert.equal(htmlToText(''), '');
});

test('extractSections returns nothing when the page has no Permalink blocks', () => {
  const html = '<h2>Just a heading</h2><p>No category lines here.</p>';
  assert.deepEqual(extractSections(html, 'cat-x'), []);
});

test('extractSections pulls one section per Permalink with the right slug', () => {
  const html = `
    <h2>Section A</h2>
    <blockquote><p>Category: input threat<br>Permalink: <a href=https://owaspai.org/go/slugA/ target=_blank>x</a></p></blockquote>
    <p>Body of A talks about LLMs.</p>
    <h2>Section B</h2>
    <blockquote><p>Category: input threat<br>Permalink: <a href=https://owaspai.org/go/slugB/ target=_blank>x</a></p></blockquote>
    <p>Body of B talks about classifiers.</p>
  `;
  const sections = extractSections(html, 'input-threats');
  assert.equal(sections.length, 2);
  assert.equal(sections[0].slug, 'slugA');
  assert.equal(sections[1].slug, 'slugB');
  assert.equal(sections[0].chapter, 'input-threats');
});

test('extractSections bounds each section by the next Permalink, not by heading level', () => {
  // Section A has a deeply nested h4 in its body; section B is a sibling.
  // The extractor must not let h4 end section A — it must run to slugB's block.
  const html = `
    <h2>A</h2>
    <blockquote><p>Category: x<br>Permalink: <a href=https://owaspai.org/go/slugA/ target=_blank>x</a></p></blockquote>
    <p>Body A.</p>
    <h4>Subheading inside A</h4>
    <p>More A content with the word AGENTIC.</p>
    <h2>B</h2>
    <blockquote><p>Category: x<br>Permalink: <a href=https://owaspai.org/go/slugB/ target=_blank>x</a></p></blockquote>
    <p>Body B.</p>
  `;
  const sections = extractSections(html, 'c');
  assert.equal(sections.length, 2);
  assert.match(sections[0].text, /AGENTIC/);
  assert.doesNotMatch(sections[0].text, /Body B/);
  assert.match(sections[1].text, /Body B/);
});

test('extractSections ignores Permalinks pointing outside owaspai.org/go/', () => {
  const html = `
    <p>Category: x<br>Permalink: <a href=https://example.com/go/slugX/ target=_blank>x</a></p>
    <p>Category: x<br>Permalink: <a href=https://owaspai.org/go/realslug/ target=_blank>x</a></p>
  `;
  const sections = extractSections(html, 'c');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].slug, 'realslug');
});

test('extractSections preserves document order', () => {
  const html = `
    <p>Category: x<br>Permalink: <a href=https://owaspai.org/go/first/ target=_blank>x</a></p>
    <p>Category: x<br>Permalink: <a href=https://owaspai.org/go/second/ target=_blank>x</a></p>
    <p>Category: x<br>Permalink: <a href=https://owaspai.org/go/third/ target=_blank>x</a></p>
  `;
  const sections = extractSections(html, 'c');
  assert.deepEqual(sections.map((s) => s.slug), ['first', 'second', 'third']);
});

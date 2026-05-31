// HTML parsing helpers for the OWASP AI Exchange chapter pages.
// Pure functions over strings; exercised by tests/extract.test.js.

// Collapse HTML to single-line plain text. Strips scripts/styles/comments,
// removes tags, decodes the entities we actually see on owaspai.org, and
// collapses whitespace. Used for pattern matching, not display.
function htmlToText(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract per-slug section text from a chapter HTML page. For each
// "Category: ... <br> Permalink: <a href=https://owaspai.org/go/{slug}/...>"
// block, the section body runs from that block's end up to the next
// such block (or the end of the chapter). Returns
// [{ slug, text }, ...] in document order.
//
// chapterCategory is opaque metadata threaded through to each section so
// callers can keep track of which chapter a section came from.
function extractSections(html, chapterCategory) {
  const sections = [];
  const re = /Category:\s*[^<\n]+?\s*<br>\s*Permalink:\s*<a\s+href=https:\/\/owaspai\.org\/go\/([a-zA-Z0-9_-]+)\//g;
  const matches = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    matches.push({ slug: m[1], blockStart: m.index, blockEnd: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const end = (i + 1 < matches.length) ? matches[i + 1].blockStart : html.length;
    sections.push({
      slug: matches[i].slug,
      chapter: chapterCategory,
      text: htmlToText(html.slice(matches[i].blockEnd, end))
    });
  }
  return sections;
}

module.exports = { htmlToText, extractSections };

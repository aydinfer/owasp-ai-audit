// HTML/URL sanitisation helpers used by the dashboard renderer.
// Kept tiny and dependency-free; exercised by tests/sanitize.test.js.

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Allow only http(s)/mailto absolute URLs and relative paths/fragments.
// Anything else (javascript:, data:, vbscript:, file:, etc.) is rewritten
// to '#' so it cannot execute when interpolated into a dashboard href.
function safeUrl(u) {
  if (u == null) return '#';
  const s = String(u).trim();
  if (s === '') return '#';
  if (/^(https?:|mailto:)/i.test(s)) return s;
  if (/^[\/#]/.test(s)) return s;
  return '#';
}

module.exports = { esc, safeUrl };

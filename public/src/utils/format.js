// ============================================================
// utils/format.js, small string helpers shared across components
// ============================================================

/** Escapes a value for safe interpolation into HTML text/attributes. */
export function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** Uppercases the first character, e.g. for class/theme names from data. */
export function capitalize(str) {
  const s = String(str ?? '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

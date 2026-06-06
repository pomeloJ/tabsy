/**
 * Shared server helpers used across routes.
 */

const MAX_ID_LENGTH = 64;
const ID_PATTERN = /^[a-zA-Z0-9\-_]+$/;

/** Client-generated IDs: non-empty, bounded length, safe charset. */
function isValidId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH && ID_PATTERN.test(id);
}

/** Parse JSON text columns defensively, returning a fallback on malformed data. */
function safeJsonParse(str, fallback = []) {
  try { return JSON.parse(str); }
  catch { return fallback; }
}

/** Ensure SQLite datetime strings are proper ISO 8601 with a UTC indicator. */
function utc(dt) {
  if (!dt) return dt;
  // Already has timezone info (Z or +/-offset)
  if (/[Z+\-]\d{0,4}$/.test(dt)) return dt;
  // SQLite datetime('now') format: "2026-04-04 08:45:00" → append Z
  return dt.replace(' ', 'T') + 'Z';
}

module.exports = { MAX_ID_LENGTH, ID_PATTERN, isValidId, safeJsonParse, utc };

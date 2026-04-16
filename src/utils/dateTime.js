/**
 * Parsing robusto per date SQL-like (es. "YYYY-MM-DD HH:mm:ss").
 * - Se manca il timezone e include ora, opzionalmente interpreta come UTC.
 * - Mantiene compatibilità con stringhe ISO già complete.
 */
export function parseAppDate(value, { assumeUtcWhenMissingTz = false } = {}) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(' ', 'T');
  const hasTz = /(?:Z|[+\-]\d{2}:\d{2})$/i.test(normalized);
  const hasExplicitTime = /T\d{2}:\d{2}/.test(normalized);
  const input = !hasTz && hasExplicitTime && assumeUtcWhenMissingTz ? `${normalized}Z` : normalized;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}


/** Chiave stabile per cache disco: path DB tipo uploads/app_loading/foo.mp4 */
import { UPLOAD_PATH_ALIASES } from '../generated/uploadPathAliases';

export function resolveCanonicalUploadPath(input) {
  if (input == null) return null;
  let path = normalizeUploadPath(input);
  if (!path) return null;
  const seen = new Set();
  while (path && UPLOAD_PATH_ALIASES[path] && !seen.has(path)) {
    seen.add(path);
    path = UPLOAD_PATH_ALIASES[path];
  }
  return path;
}

export function normalizeUploadPath(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    const marker = '/storage/v1/object/public/';
    const idx = s.indexOf(marker);
    if (idx >= 0) {
      s = s.slice(idx + marker.length);
    } else {
      return null;
    }
  }
  s = s.replace(/^\/+/, '');
  if (!s.startsWith('uploads/')) return null;
  return s;
}

import { publicAssetUrl } from '../services/api';
import { getBundledAssetUri } from './bundledUploads';
import { normalizeUploadPath, resolveCanonicalUploadPath } from './normalizeUploadPath';
import { logMediaCache, mediaUriSource } from './mediaCacheDebug';
import { resolveMediaLocalFirst } from './stableMediaDiskCache';

function pickStorageInput({ logoUrl, logoPath, photoPath, teamLogo }) {
  const candidates = [logoPath, photoPath, teamLogo, logoUrl];
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (!s || s.startsWith('default_')) continue;
    const normalized = resolveCanonicalUploadPath(s) || normalizeUploadPath(s);
    if (normalized) return normalized;
  }
  return null;
}

function pickRemoteFallback({ logoUrl, logoPath, photoPath, teamLogo }) {
  if (logoUrl && /^https?:\/\//i.test(String(logoUrl))) return String(logoUrl).trim();
  const path = logoPath || photoPath || teamLogo;
  if (path && !String(path).startsWith('default_')) {
    const canonical = resolveCanonicalUploadPath(path);
    return publicAssetUrl(canonical || path) || null;
  }
  if (logoUrl && !String(logoUrl).startsWith('default_')) {
    const canonical = resolveCanonicalUploadPath(logoUrl);
    return publicAssetUrl(canonical || logoUrl) || null;
  }
  return null;
}

/**
 * Risoluzione immediata (solo bundle app). Per loghi già nell'APK: zero attesa al primo frame.
 */
export function resolveDisplayMediaUriSync({
  logoUrl,
  logoPath,
  photoPath,
  teamLogo,
  asset = 'team_logo',
} = {}) {
  const storagePath = pickStorageInput({ logoUrl, logoPath, photoPath, teamLogo });
  if (!storagePath) {
    return { uri: pickRemoteFallback({ logoUrl, logoPath, photoPath, teamLogo }), path: null };
  }
  const bundled = getBundledAssetUri(storagePath);
  if (bundled) {
    return { uri: bundled, path: storagePath };
  }
  return { uri: null, path: storagePath };
}

/**
 * Risolve URI per logo squadra / foto giocatore con cache disco + log.
 * @param {'team_logo'|'player_photo'|'fantasy_team_logo'|'login_background'} asset
 */
export async function resolveDisplayMediaUri({
  logoUrl,
  logoPath,
  photoPath,
  teamLogo,
  asset = 'team_logo',
}) {
  const storagePath = pickStorageInput({ logoUrl, logoPath, photoPath, teamLogo });
  if (!storagePath) {
    const remote = pickRemoteFallback({ logoUrl, logoPath, photoPath, teamLogo });
    if (remote) {
      logMediaCache(`${asset}_remote_only`, { path: null, uri: remote, layer: 'display', asset });
    }
    return { uri: remote, path: null };
  }

  const uri = await resolveMediaLocalFirst(storagePath, { asset });
  const resolved = uri || publicAssetUrl(resolveCanonicalUploadPath(storagePath) || storagePath);
  logMediaCache(`${asset}_display_resolve`, {
    path: storagePath,
    uri: resolved,
    layer: 'display',
    savedToDisk: mediaUriSource(resolved) === 'local_disk',
  });
  return { uri: resolved, path: storagePath };
}

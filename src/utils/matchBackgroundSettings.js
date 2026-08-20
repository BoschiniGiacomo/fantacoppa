import api, { publicAssetUrl, superuserService } from '../services/api';
import { resolveCanonicalUploadPath } from './normalizeUploadPath';
import { resolveMediaLocalFirst } from './stableMediaDiskCache';
import { getBundledMatchBackground } from './bundledUploads';
import { logMediaCache } from './mediaCacheDebug';

/**
 * Sfondo hero partita ufficiale.
 * Bundle first (come loghi), poi API + cache disco.
 */
export async function getMatchBackgroundSettings() {
  const bundled = getBundledMatchBackground();

  try {
    const res = await api.get('/public/match-background');
    const rawPath = res.data?.path;
    const path = rawPath ? resolveCanonicalUploadPath(rawPath) || rawPath : null;
    if (path) {
      // Stesso file del bundle → niente download, usa asset interno
      if (bundled?.path && path === bundled.path) {
        logMediaCache('match_bg_bundle_match', { path, layer: 'bundle', asset: 'match_background' });
        return bundled;
      }
      logMediaCache('match_bg_api_ok', { path, layer: 'api_db', asset: 'match_background' });
      const uri =
        (await resolveMediaLocalFirst(path, { asset: 'match_background' })) || publicAssetUrl(path);
      logMediaCache('match_bg_resolved', { path, uri, layer: 'api_db', asset: 'match_background' });
      return { uri, path };
    }
    logMediaCache('match_bg_api_empty', { layer: 'api_db', asset: 'match_background' });
  } catch (e) {
    logMediaCache('match_bg_api_error', {
      layer: 'api_db',
      asset: 'match_background',
      error: e?.message || String(e),
    });
  }

  if (bundled?.uri) {
    logMediaCache('match_bg_bundle_fallback', { path: bundled.path, layer: 'bundle', asset: 'match_background' });
  }
  return bundled || null;
}

export async function saveMatchBackgroundFromPicker(asset) {
  const formData = new FormData();
  formData.append('media', {
    uri: asset.uri,
    name: asset.name || 'match_background.jpg',
    type: asset.mimeType || 'image/jpeg',
  });
  const res = await superuserService.uploadMatchBackground(formData);
  const path = res.data?.path;
  if (!path) return null;
  const uri =
    (await resolveMediaLocalFirst(path, { asset: 'match_background' })) || publicAssetUrl(path);
  return { uri, path };
}

export async function clearMatchBackground() {
  await superuserService.deleteMatchBackground();
}

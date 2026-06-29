import api, { publicAssetUrl, superuserService } from '../services/api';
import { resolveCanonicalUploadPath } from './normalizeUploadPath';
import { resolveMediaLocalFirst } from './stableMediaDiskCache';
import { logMediaCache } from './mediaCacheDebug';

export async function getLoginBackgroundSettings() {
  try {
    const res = await api.get('/public/login-background');
    const rawPath = res.data?.path;
    const path = rawPath ? resolveCanonicalUploadPath(rawPath) || rawPath : null;
    if (path) {
      logMediaCache('login_bg_api_ok', { path, layer: 'api_db', asset: 'login_background' });
      const uri =
        (await resolveMediaLocalFirst(path, { asset: 'login_background' })) || publicAssetUrl(path);
      logMediaCache('login_bg_resolved', { path, uri, layer: 'api_db', asset: 'login_background' });
      return { uri, path };
    }
    logMediaCache('login_bg_api_empty', { layer: 'api_db', asset: 'login_background' });
    return null;
  } catch (e) {
    logMediaCache('login_bg_api_error', {
      layer: 'api_db',
      asset: 'login_background',
      error: e?.message || String(e),
    });
    return null;
  }
}

export async function saveLoginBackgroundFromPicker(asset) {
  const formData = new FormData();
  formData.append('media', {
    uri: asset.uri,
    name: asset.name || 'background.jpg',
    type: asset.mimeType || 'image/jpeg',
  });
  const res = await superuserService.uploadLoginBackground(formData);
  const path = res.data?.path;
  if (!path) return null;
  const uri =
    (await resolveMediaLocalFirst(path, { asset: 'login_background' })) || publicAssetUrl(path);
  return { uri, path };
}

export async function clearLoginBackground() {
  await superuserService.deleteLoginBackground();
}

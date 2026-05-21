import api, { publicAssetUrl, superuserService } from '../services/api';
import { resolveStableMediaToLocal } from './stableMediaDiskCache';
import { logMediaCache } from './mediaCacheDebug';

export async function getLoginLogoSettings() {
  try {
    const res = await api.get('/public/login-logo');
    const path = res.data?.path;
    if (path) {
      logMediaCache('logo_api_ok', { path, layer: 'api_db' });
      const uri = (await resolveStableMediaToLocal(path, { asset: 'login_logo' })) || publicAssetUrl(path);
      logMediaCache('logo_resolved', { path, uri, layer: 'api_db' });
      return { uri, path };
    }
    logMediaCache('logo_api_empty', { layer: 'api_db' });
    return null;
  } catch (e) {
    logMediaCache('logo_api_error', { layer: 'api_db', error: e?.message || String(e) });
    return null;
  }
}

export async function saveLoginLogoFromPicker(asset) {
  const formData = new FormData();
  formData.append('media', {
    uri: asset.uri,
    name: asset.name || 'logo.png',
    type: asset.mimeType || 'image/png',
  });
  const res = await superuserService.uploadLoginLogo(formData);
  const path = res.data?.path;
  if (!path) return null;
  const uri = (await resolveStableMediaToLocal(path)) || publicAssetUrl(path);
  return { uri, path };
}

export async function clearLoginLogo() {
  await superuserService.deleteLoginLogo();
}

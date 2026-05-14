import api, { publicAssetUrl, superuserService } from '../services/api';

export async function getLoginLogoSettings() {
  try {
    const res = await api.get('/public/login-logo');
    const path = res.data?.path;
    if (path) {
      return { uri: publicAssetUrl(path) };
    }
    return null;
  } catch {
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
  return { uri: publicAssetUrl(path) };
}

export async function clearLoginLogo() {
  await superuserService.deleteLoginLogo();
}

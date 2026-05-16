import api, { publicAssetUrl, superuserService } from '../services/api';

export async function getLoginBackgroundSettings() {
  try {
    const res = await api.get('/public/login-background');
    const path = res.data?.path;
    if (path) {
      return { uri: publicAssetUrl(path) };
    }
    return null;
  } catch {
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
  return { uri: publicAssetUrl(path) };
}

export async function clearLoginBackground() {
  await superuserService.deleteLoginBackground();
}

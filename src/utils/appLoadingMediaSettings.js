import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { publicAssetUrl, superuserService } from '../services/api';

const LEGACY_STORAGE_URI_KEY = 'app_loading_media_uri';
const LEGACY_STORAGE_TYPE_KEY = 'app_loading_media_render';

let subscribers = [];

export function subscribeAppLoadingMedia(callback) {
  subscribers.push(callback);
  return () => {
    subscribers = subscribers.filter((fn) => fn !== callback);
  };
}

function emitChange() {
  subscribers.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn('appLoadingMedia subscriber', e);
    }
  });
}

async function clearLegacyDeviceOnlyKeys() {
  await AsyncStorage.multiRemove([LEGACY_STORAGE_URI_KEY, LEGACY_STORAGE_TYPE_KEY]).catch(() => {});
}

export function guessPickMediaType(mimeType, fileName) {
  const n = (fileName || '').toLowerCase();
  const m = String(mimeType || '').toLowerCase();
  if (m.startsWith('video/')) return 'video';
  if (['.mp4', '.webm', '.mov', '.m4v'].some((ext) => n.endsWith(ext))) return 'video';
  return 'image';
}

/**
 * Media di caricamento globale: legge dal backend (stesso file per tutti gli utenti).
 */
export async function getAppLoadingMediaSettings() {
  try {
    const t0 = Date.now();
    const res = await api.get('/public/app-loading');
    console.log(`[PERF][LoadingMedia] GET /public/app-loading: ${Date.now() - t0}ms`);
    const path = res.data?.path;
    const type = res.data?.type;
    if (path) {
      await clearLegacyDeviceOnlyKeys();
      return {
        uri: publicAssetUrl(path),
        type: type === 'video' ? 'video' : 'image',
        name: null,
      };
    }
    await clearLegacyDeviceOnlyKeys();
    return { uri: null, type: null, name: null };
  } catch {
    return { uri: null, type: null, name: null };
  }
}

export async function saveAppLoadingMediaFromPicker(asset) {
  const formData = new FormData();
  formData.append('media', {
    uri: asset.uri,
    name: asset.name || 'upload.bin',
    type: asset.mimeType || 'application/octet-stream',
  });
  const res = await superuserService.uploadAppLoadingMedia(formData);
  emitChange();
  const path = res.data?.path;
  if (!path) return { uri: null, type: null, name: null };
  return {
    uri: publicAssetUrl(path),
    type: res.data?.type === 'video' ? 'video' : 'image',
    name: asset?.name ? String(asset.name) : null,
  };
}

export async function clearAppLoadingMedia() {
  await superuserService.deleteAppLoadingMedia();
  emitChange();
}

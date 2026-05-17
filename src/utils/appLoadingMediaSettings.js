import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { publicAssetUrl, superuserService } from '../services/api';

const LEGACY_STORAGE_URI_KEY = 'app_loading_media_uri';
const LEGACY_STORAGE_TYPE_KEY = 'app_loading_media_render';
/** Bump quando cambia il logo bundled (invalida cache AsyncStorage su Expo Go). */
const CACHE_KEY = 'app_loading_media_cache_v2';

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
 * Read cached loading media from AsyncStorage (synchronous-ish, ~5ms).
 * Returns { uri, type } or null if no cache.
 */
export async function getCachedAppLoadingMedia() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.uri) return { uri: parsed.uri, type: parsed.type || 'image', name: null };
    return null;
  } catch {
    return null;
  }
}

async function persistMediaCache(uri, type) {
  try {
    if (uri) {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ uri, type }));
    } else {
      await AsyncStorage.removeItem(CACHE_KEY);
    }
  } catch {}
}

/**
 * Media di caricamento globale: legge dal backend (stesso file per tutti gli utenti).
 * Aggiorna anche la cache locale per avvii futuri istantanei.
 */
export async function getAppLoadingMediaSettings() {
  try {
    const res = await api.get('/public/app-loading');
    const path = res.data?.path;
    const type = res.data?.type;
    if (path) {
      await clearLegacyDeviceOnlyKeys();
      const uri = publicAssetUrl(path);
      const mediaType = type === 'video' ? 'video' : 'image';
      persistMediaCache(uri, mediaType);
      return { uri, type: mediaType, name: null };
    }
    await clearLegacyDeviceOnlyKeys();
    persistMediaCache(null, null);
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

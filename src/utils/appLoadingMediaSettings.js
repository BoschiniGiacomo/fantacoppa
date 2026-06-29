import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { publicAssetUrl, superuserService } from '../services/api';
import { getBundledAppLoading } from './bundledUploads';
import { resolveCanonicalUploadPath } from './normalizeUploadPath';
import { getCachedLocalUriForPath, resolveMediaLocalFirst } from './stableMediaDiskCache';
import { logMediaCache } from './mediaCacheDebug';

const LEGACY_STORAGE_URI_KEY = 'app_loading_media_uri';
const LEGACY_STORAGE_TYPE_KEY = 'app_loading_media_render';
const CACHE_KEY_V2 = 'app_loading_media_cache_v2';
const CACHE_KEY = 'app_loading_media_cache_v3';

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

function packResult({ uri, type, path }) {
  if (!uri) return null;
  return {
    uri,
    type: type === 'video' ? 'video' : 'image',
    path: path || null,
    name: null,
  };
}

function logLoading(phase, result, extra = {}) {
  logMediaCache(`loading_${phase}`, {
    type: result?.type,
    path: result?.path,
    uri: result?.uri,
    ...extra,
  });
}

/**
 * Cache locale: v3 (path + file video su disco), compat v2/legacy (solo URI remoto).
 */
export async function getCachedAppLoadingMedia() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const type = parsed?.type === 'video' ? 'video' : 'image';
      const storagePath = parsed?.path ? String(parsed.path).trim() : null;

      if (storagePath) {
        if (type === 'video') {
          const local = parsed.localUri || (await getCachedLocalUriForPath(storagePath, { asset: 'loading_video' }));
          if (local) {
            const r = packResult({ uri: local, type, path: storagePath });
            logLoading('cache_v3_video_disk', r, { layer: 'async_storage' });
            return r;
          }
        } else {
          const local = await getCachedLocalUriForPath(storagePath, { asset: 'loading_image' });
          if (local) {
            const r = packResult({ uri: local, type, path: storagePath });
            logLoading('cache_v3_image_disk', r, { layer: 'async_storage' });
            return r;
          }
        }
        const bundled = await resolveLoadingUri(storagePath, type);
        if (bundled?.uri) {
          const r = packResult({ uri: bundled.uri, type, path: storagePath });
          logLoading('cache_v3_bundle', r, { layer: 'bundle' });
          return r;
        }
      }
    }

    const rawV2 = await AsyncStorage.getItem(CACHE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (parsed?.uri) {
        const r = packResult({
          uri: parsed.uri,
          type: parsed.type,
          path: null,
        });
        logLoading('cache_v2', r, { layer: 'async_storage', note: 'solo URI remoto salvato' });
        return r;
      }
    }

    const legacyUri = await AsyncStorage.getItem(LEGACY_STORAGE_URI_KEY);
    const legacyType = await AsyncStorage.getItem(LEGACY_STORAGE_TYPE_KEY);
    if (legacyUri) {
      const r = packResult({
        uri: legacyUri,
        type: legacyType === 'video' ? 'video' : 'image',
        path: null,
      });
      logLoading('cache_legacy', r, { layer: 'async_storage' });
      return r;
    }

    logMediaCache('loading_cache_miss', {});
    const bundled = getBundledAppLoading();
    if (bundled?.uri) {
      const r = packResult({ uri: bundled.uri, type: bundled.type, path: bundled.path });
      logLoading('cache_bundle_default', r, { layer: 'bundle' });
      return r;
    }
    return null;
  } catch (e) {
    logMediaCache('loading_cache_error', { error: e?.message || String(e) });
    return null;
  }
}

async function persistMediaCache({ path, type, uri, localUri }) {
  try {
    if (path) {
      await AsyncStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          path,
          type,
          uri: uri || publicAssetUrl(path),
          localUri: localUri || null,
        })
      );
    } else {
      await AsyncStorage.removeItem(CACHE_KEY);
    }
  } catch {}
}

async function resolveLoadingUri(path, type) {
  if (!path) return { uri: null, localUri: null };
  const mediaType = type === 'video' ? 'video' : 'image';
  const asset = mediaType === 'video' ? 'loading_video' : 'loading_image';
  const uri = await resolveMediaLocalFirst(path, { asset });
  const isLocalDisk = uri && (String(uri).startsWith('file://') || String(uri).startsWith('content://'));
  const isBundle = uri && !isLocalDisk && !/^https?:\/\//i.test(String(uri));
  logMediaCache('loading_resolve', {
    path,
    uri,
    type: mediaType,
    savedToDisk: isLocalDisk,
    fromBundle: isBundle || (!isLocalDisk && uri && !/^https?:\/\//i.test(String(uri))),
  });
  return {
    uri,
    localUri: isLocalDisk ? uri : null,
  };
}

/**
 * Media di caricamento globale: API per path, video su disco se già scaricato.
 */
export async function getAppLoadingMediaSettings() {
  try {
    const res = await api.get('/public/app-loading');
    const rawPath = res.data?.path;
    const path = rawPath ? resolveCanonicalUploadPath(rawPath) || rawPath : null;
    const type = res.data?.type;
    if (path) {
      await clearLegacyDeviceOnlyKeys();
      const mediaType = type === 'video' ? 'video' : 'image';
      logMediaCache('loading_api_ok', { path, type: mediaType, layer: 'api_db' });
      const { uri, localUri } = await resolveLoadingUri(path, mediaType);
      await persistMediaCache({ path, type: mediaType, uri, localUri });
      const r = packResult({ uri, type: mediaType, path });
      logLoading('api', r, { layer: 'api_db', hasLocalFile: !!localUri });
      return r;
    }
    await clearLegacyDeviceOnlyKeys();
    const bundled = getBundledAppLoading();
    if (bundled?.uri) {
      await persistMediaCache({
        path: bundled.path,
        type: bundled.type,
        uri: bundled.uri,
        localUri: null,
      });
      const r = packResult({ uri: bundled.uri, type: bundled.type, path: bundled.path });
      logLoading('api_empty_bundle', r, { layer: 'bundle' });
      return r;
    }
    await clearLegacyDeviceOnlyKeys();
    await persistMediaCache({ path: null, type: null, uri: null, localUri: null });
    logMediaCache('loading_api_empty', { layer: 'api_db' });
    return { uri: null, type: null, name: null, path: null };
  } catch (e) {
    logMediaCache('loading_api_error', { layer: 'api_db', error: e?.message || String(e) });
    const cached = await getCachedAppLoadingMedia();
    if (cached?.uri) {
      logLoading('api_fallback_cache', cached, { layer: 'async_storage' });
      return cached;
    }
    const bundled = getBundledAppLoading();
    if (bundled?.uri) {
      const r = packResult({ uri: bundled.uri, type: bundled.type, path: bundled.path });
      logLoading('api_error_bundle', r, { layer: 'bundle' });
      return r;
    }
    return { uri: null, type: null, name: null, path: null };
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
  const mediaType = res.data?.type === 'video' ? 'video' : 'image';
  const { uri, localUri } = await resolveLoadingUri(path, mediaType);
  await persistMediaCache({ path, type: mediaType, uri, localUri });
  return packResult({ uri, type: mediaType, path });
}

export async function clearAppLoadingMedia() {
  await superuserService.deleteAppLoadingMedia();
  emitChange();
}

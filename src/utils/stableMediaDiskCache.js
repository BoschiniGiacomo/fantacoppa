import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { publicAssetUrl } from '../services/api';
import { normalizeUploadPath } from './normalizeUploadPath';
import { logMediaCache } from './mediaCacheDebug';

const INDEX_KEY = 'stable_media_disk_index_v1';
const CACHE_DIR = `${FileSystem.cacheDirectory}fc-stable-media/`;

const inflight = new Map();

function hashPath(storagePath) {
  return storagePath.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function fileExists(uri) {
  if (!uri) return false;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return !!info?.exists;
  } catch {
    return false;
  }
}

async function ensureCacheDir() {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

async function loadIndex() {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function saveIndex(index) {
  try {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {}
}

/**
 * Scarica su disco solo se il path Supabase è cambiato; altrimenti riusa il file locale.
 * Usato per video splash e logo login (media che cambiano raramente).
 */
export async function resolveStableMediaToLocal(pathOrUrl, meta = {}) {
  const storagePath = normalizeUploadPath(pathOrUrl);
  if (!storagePath) {
    const remote = publicAssetUrl(pathOrUrl) || (pathOrUrl ? String(pathOrUrl).trim() : null);
    logMediaCache('disk_skip_no_path', { ...meta, uri: remote });
    return remote || null;
  }

  if (inflight.has(storagePath)) {
    logMediaCache('disk_inflight_wait', { ...meta, path: storagePath });
    return inflight.get(storagePath);
  }

  const task = (async () => {
    const local = await getCachedLocalUriForPath(storagePath, { ...meta, silent: true });
    if (local) {
      logMediaCache('disk_hit', { ...meta, path: storagePath, uri: local });
      return local;
    }

    const remoteUrl = publicAssetUrl(storagePath);
    if (!remoteUrl) return null;

    logMediaCache('disk_download_start', { ...meta, path: storagePath, remoteUrl: remoteUrl.slice(0, 56) });

    await ensureCacheDir();
    const ext = storagePath.includes('.') ? storagePath.slice(storagePath.lastIndexOf('.')) : '.bin';
    const localUri = `${CACHE_DIR}${hashPath(storagePath)}${ext}`;

    try {
      const result = await FileSystem.downloadAsync(remoteUrl, localUri);
      const localPath = result?.uri || localUri;
      const index = await loadIndex();
      index[storagePath] = { localUri: localPath, updatedAt: Date.now() };
      await saveIndex(index);
      logMediaCache('disk_download_ok', { ...meta, path: storagePath, uri: localPath });
      return localPath;
    } catch (e) {
      logMediaCache('disk_download_fail_remote_fallback', {
        ...meta,
        path: storagePath,
        uri: remoteUrl,
        error: e?.message || String(e),
      });
      return remoteUrl;
    }
  })();

  inflight.set(storagePath, task);
  try {
    return await task;
  } finally {
    inflight.delete(storagePath);
  }
}

/** URI file locale già presente (nessuna rete). */
export async function getCachedLocalUriForPath(pathOrUrl, meta = {}) {
  const storagePath = normalizeUploadPath(pathOrUrl);
  if (!storagePath) return null;
  const index = await loadIndex();
  const localUri = index[storagePath]?.localUri;
  if (!localUri) {
    if (!meta.silent) {
      logMediaCache('disk_index_miss', { ...meta, path: storagePath });
    }
    return null;
  }
  const exists = await fileExists(localUri);
  if (!exists) {
    logMediaCache('disk_file_missing', { ...meta, path: storagePath, uri: localUri });
    return null;
  }
  if (!meta.silent) {
    logMediaCache('disk_file_ok', { ...meta, path: storagePath, uri: localUri });
  }
  return localUri;
}

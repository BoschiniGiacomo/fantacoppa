import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { publicAssetUrl } from '../services/api';
import { getBundledAssetUri } from './bundledUploads';
import { normalizeUploadPath, resolveCanonicalUploadPath } from './normalizeUploadPath';
import { logMediaCache } from './mediaCacheDebug';

const INDEX_KEY = 'stable_media_disk_index_v1';
const CACHE_DIR = `${FileSystem.cacheDirectory}fc-stable-media/`;

const inflight = new Map();
/** path → local file URI (sync peek for primo frame) */
const memoryLocalByPath = new Map();
let indexMemory = null;
let indexLoadPromise = null;

function hashPath(storagePath) {
  return storagePath.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function rememberLocalUri(storagePath, localUri) {
  if (!storagePath || !localUri) return;
  memoryLocalByPath.set(storagePath, localUri);
}

/** Peek sincrono: evita remote→file swap al secondo frame. */
export function peekMemoryCachedLocalUri(pathOrUrl) {
  const storagePath = resolveCanonicalUploadPath(pathOrUrl) || normalizeUploadPath(pathOrUrl);
  if (!storagePath) return null;
  return memoryLocalByPath.get(storagePath) || null;
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
  if (indexMemory) return indexMemory;
  if (indexLoadPromise) return indexLoadPromise;
  indexLoadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(INDEX_KEY);
      if (!raw) {
        indexMemory = {};
        return indexMemory;
      }
      const parsed = JSON.parse(raw);
      indexMemory = parsed && typeof parsed === 'object' ? parsed : {};
      // Warm sync peek map
      for (const [path, entry] of Object.entries(indexMemory)) {
        if (entry?.localUri) rememberLocalUri(path, entry.localUri);
      }
      return indexMemory;
    } catch {
      indexMemory = {};
      return indexMemory;
    } finally {
      indexLoadPromise = null;
    }
  })();
  return indexLoadPromise;
}

async function saveIndex(index) {
  indexMemory = index;
  try {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {}
}

/**
 * Disco → bundle app → download Supabase (solo se path non in bundle e non in cache).
 */
export async function resolveMediaLocalFirst(pathOrUrl, meta = {}) {
  const storagePath = resolveCanonicalUploadPath(pathOrUrl);
  if (!storagePath) {
    const remote = publicAssetUrl(pathOrUrl) || (pathOrUrl ? String(pathOrUrl).trim() : null);
    logMediaCache('media_skip_no_path', { ...meta, uri: remote });
    return remote || null;
  }

  const mem = memoryLocalByPath.get(storagePath);
  if (mem) {
    logMediaCache('media_memory_hit', { ...meta, path: storagePath, uri: mem });
    return mem;
  }

  const cached = await getCachedLocalUriForPath(storagePath, { ...meta, silent: true });
  if (cached) {
    rememberLocalUri(storagePath, cached);
    logMediaCache('media_disk_hit', { ...meta, path: storagePath, uri: cached });
    return cached;
  }

  const bundled = getBundledAssetUri(storagePath);
  if (bundled) {
    logMediaCache('media_bundle_hit', { ...meta, path: storagePath, uri: bundled, layer: 'bundle' });
    return bundled;
  }

  return resolveStableMediaToLocal(pathOrUrl, meta);
}

/**
 * Scarica su disco solo se il path Supabase non è già in cache locale.
 */
export async function resolveStableMediaToLocal(pathOrUrl, meta = {}) {
  const storagePath = resolveCanonicalUploadPath(pathOrUrl);
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
      rememberLocalUri(storagePath, local);
      logMediaCache('disk_hit', { ...meta, path: storagePath, uri: local });
      return local;
    }

    const bundled = getBundledAssetUri(storagePath);
    if (bundled) {
      logMediaCache('disk_skip_bundle', { ...meta, path: storagePath, uri: bundled, layer: 'bundle' });
      return bundled;
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
      rememberLocalUri(storagePath, localPath);
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
  const storagePath = resolveCanonicalUploadPath(pathOrUrl);
  if (!storagePath) return null;

  const mem = memoryLocalByPath.get(storagePath);
  if (mem) return mem;

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
  rememberLocalUri(storagePath, localUri);
  if (!meta.silent) {
    logMediaCache('disk_file_ok', { ...meta, path: storagePath, uri: localUri });
  }
  return localUri;
}

/** Warm index in background (Matches screen mount). */
export function warmStableMediaIndex() {
  void loadIndex();
}

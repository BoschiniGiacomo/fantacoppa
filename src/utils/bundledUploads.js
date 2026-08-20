import { Image } from 'react-native';
import { BUNDLED_UPLOADS, BUNDLED_SLOT_DEFAULTS } from '../generated/bundledUploadsManifest';
import { resolveCanonicalUploadPath } from './normalizeUploadPath';
import { logMediaCache } from './mediaCacheDebug';

const uriCache = new Map();

/** URI risolvibile da React Native (file:// in dev, asset:// in release) per un path Supabase in bundle. */
export function getBundledAssetUri(storagePath) {
  if (!storagePath) return null;
  const key = resolveCanonicalUploadPath(storagePath) || String(storagePath).trim();
  if (uriCache.has(key)) return uriCache.get(key);

  const mod = BUNDLED_UPLOADS[key];
  if (!mod) return null;

  try {
    const resolved = Image.resolveAssetSource(mod);
    const uri = resolved?.uri || null;
    if (uri) uriCache.set(key, uri);
    return uri;
  } catch {
    return null;
  }
}

export function isBundledUploadPath(storagePath) {
  const key = resolveCanonicalUploadPath(storagePath) || String(storagePath || '').trim();
  if (!key) return false;
  return Object.prototype.hasOwnProperty.call(BUNDLED_UPLOADS, key);
}

/** Default login / loading dal bundle (zero rete). */
export function getBundledSlotMedia(slot) {
  const path = BUNDLED_SLOT_DEFAULTS[slot];
  if (!path) return null;
  const uri = getBundledAssetUri(path);
  if (!uri) return null;
  logMediaCache('bundle_slot_default', { asset: slot, path, uri, layer: 'bundle' });
  if (slot === 'app_loading') {
    const lower = path.toLowerCase();
    const type = ['.mp4', '.webm', '.mov', '.m4v'].some((e) => lower.endsWith(e)) ? 'video' : 'image';
    return { uri, path, type };
  }
  return { uri, path };
}

export function getBundledLoginLogo() {
  return getBundledSlotMedia('login_logo');
}

export function getBundledLoginBackground() {
  return getBundledSlotMedia('login_background');
}

export function getBundledMatchBackground() {
  return getBundledSlotMedia('match_background');
}

export function getBundledAppLoading() {
  return getBundledSlotMedia('app_loading');
}

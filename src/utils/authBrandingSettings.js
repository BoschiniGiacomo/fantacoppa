import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import {
  getBundledAssetUri,
  getBundledLoginBackground,
  getBundledLoginLogo,
} from './bundledUploads';
import { getLoginLogoSettings } from './loginLogoSettings';
import { getLoginBackgroundSettings } from './loginBackgroundSettings';
import { getCachedLocalUriForPath } from './stableMediaDiskCache';
import { logMediaCache } from './mediaCacheDebug';

const CACHE_KEY = 'auth_branding_cache_v4';

async function localFileExists(uri) {
  if (!uri || typeof uri !== 'string') return false;
  if (!uri.startsWith('file://') && !uri.startsWith('content://')) return false;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return !!info?.exists;
  } catch {
    return false;
  }
}

/** Preferisci file disco o asset bundle per un path noto (senza forzare il default di slot). */
async function preferLocalOrBundled(item) {
  if (!item?.path) return null;
  const local = await getCachedLocalUriForPath(item.path, { silent: true });
  if (local) return { uri: local, path: item.path };
  const bundled = getBundledAssetUri(item.path);
  if (bundled) return { uri: bundled, path: item.path };
  return null;
}

/**
 * Da cache AsyncStorage: niente https “stale” senza file locale
 * (altrimenti Image/ImageBackground restano vuoti e nascondono i fallback).
 */
async function resolveCachedBrandingItem(item, slot) {
  const bundledSlot = slot === 'login_logo' ? getBundledLoginLogo() : getBundledLoginBackground();
  if (!item) return bundledSlot || null;

  const localOrBundled = await preferLocalOrBundled(item);
  if (localOrBundled) return localOrBundled;

  if (item.uri && (await localFileExists(item.uri))) {
    return { uri: item.uri, path: item.path || null };
  }

  if (
    item.uri
    && !item.uri.startsWith('http://')
    && !item.uri.startsWith('https://')
    && !item.uri.startsWith('file://')
  ) {
    return { uri: item.uri, path: item.path || null };
  }

  return bundledSlot || null;
}

function withBundledDefaults(logo, background) {
  return {
    logo: logo?.uri ? logo : getBundledLoginLogo(),
    background: background?.uri ? background : getBundledLoginBackground(),
  };
}

export async function getCachedAuthBranding() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return withBundledDefaults(null, null);
    const parsed = JSON.parse(raw);
    const rawLogo = parsed?.logo?.uri || parsed?.logo?.path ? parsed.logo : null;
    const rawBg = parsed?.background?.uri || parsed?.background?.path ? parsed.background : null;
    const logo = await resolveCachedBrandingItem(rawLogo, 'login_logo');
    const background = await resolveCachedBrandingItem(rawBg, 'login_background');
    return withBundledDefaults(logo, background);
  } catch (e) {
    logMediaCache('logo_cache_error', { error: e?.message || String(e) });
    return withBundledDefaults(null, null);
  }
}

async function persistAuthBrandingCache(logo, background) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ logo, background }));
  } catch {}
}

/** Logo e sfondo login: bundle → cache disco verificata → API. */
export async function loadAuthBranding() {
  const cached = await getCachedAuthBranding();
  let logo = cached.logo;
  let background = cached.background;

  try {
    const [apiLogo, apiBackground] = await Promise.all([
      getLoginLogoSettings(),
      getLoginBackgroundSettings(),
    ]);

    if (apiLogo?.uri) {
      logo = (await preferLocalOrBundled(apiLogo)) || apiLogo;
    } else {
      logo = (await resolveCachedBrandingItem(logo, 'login_logo')) || getBundledLoginLogo();
    }

    if (apiBackground?.uri) {
      background = (await preferLocalOrBundled(apiBackground)) || apiBackground;
    } else {
      background =
        (await resolveCachedBrandingItem(background, 'login_background'))
        || getBundledLoginBackground();
    }

    await persistAuthBrandingCache(logo, background);
    logMediaCache('branding_load_ok', {
      logoPath: logo?.path,
      logoUri: logo?.uri,
      bgPath: background?.path,
      bgUri: background?.uri,
      layer: 'api_db',
    });
  } catch (e) {
    logMediaCache('branding_load_error', { error: e?.message || String(e) });
    const fallback = await getCachedAuthBranding();
    logo = fallback.logo;
    background = fallback.background;
  }

  return withBundledDefaults(logo, background);
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBundledAssetUri, getBundledLoginBackground, getBundledLoginLogo } from './bundledUploads';
import { getLoginLogoSettings } from './loginLogoSettings';
import { getLoginBackgroundSettings } from './loginBackgroundSettings';
import { getCachedLocalUriForPath } from './stableMediaDiskCache';
import { logMediaCache } from './mediaCacheDebug';

const CACHE_KEY = 'auth_branding_cache_v4';

function withBundledDefaults(logo, background) {
  let nextLogo = logo;
  let nextBg = background;
  if (!nextLogo?.uri) {
    const bundled = getBundledLoginLogo();
    if (bundled?.uri) nextLogo = bundled;
  }
  if (!nextBg?.uri) {
    const bundled = getBundledLoginBackground();
    if (bundled?.uri) nextBg = bundled;
  }
  return { logo: nextLogo, background: nextBg };
}

function preferBundleForPath(item) {
  if (!item?.path) return item;
  const bundled = getBundledAssetUri(item.path);
  if (bundled) return { uri: bundled, path: item.path };
  return item;
}

async function hydrateFromDisk(logo, background) {
  let nextLogo = logo;
  let nextBg = background;

  if (nextLogo?.path) {
    const local = await getCachedLocalUriForPath(nextLogo.path, { asset: 'login_logo' });
    if (local) {
      nextLogo = { uri: local, path: nextLogo.path };
      logMediaCache('logo_cache_disk', { path: nextLogo.path, uri: local, layer: 'async_storage' });
    } else {
      nextLogo = preferBundleForPath(nextLogo);
    }
  }

  if (nextBg?.path) {
    const local = await getCachedLocalUriForPath(nextBg.path, { asset: 'login_background' });
    if (local) {
      nextBg = { uri: local, path: nextBg.path };
      logMediaCache('login_bg_cache_disk', {
        path: nextBg.path,
        uri: local,
        layer: 'async_storage',
        asset: 'login_background',
      });
    } else {
      nextBg = preferBundleForPath(nextBg);
    }
  }

  return withBundledDefaults(nextLogo, nextBg);
}

export async function getCachedAuthBranding() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return withBundledDefaults(null, null);
    const parsed = JSON.parse(raw);
    let logo = parsed?.logo?.uri ? parsed.logo : null;
    let background = parsed?.background?.uri ? parsed.background : null;
    return hydrateFromDisk(logo, background);
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

/** Logo e sfondo login: bundle → cache disco → download solo se path nuovo fuori bundle. */
export async function loadAuthBranding() {
  const cached = await getCachedAuthBranding();
  let logo = cached.logo;
  let background = cached.background;

  try {
    const [apiLogo, apiBackground] = await Promise.all([getLoginLogoSettings(), getLoginBackgroundSettings()]);
    if (apiLogo) {
      logo = apiLogo;
    } else if (!logo?.uri) {
      logo = getBundledLoginLogo();
    }
    if (apiBackground) {
      background = apiBackground;
    } else if (!background?.uri) {
      background = getBundledLoginBackground();
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

  return { logo, background };
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'react-native';
import { getLoginLogoSettings } from './loginLogoSettings';
import { getLoginBackgroundSettings } from './loginBackgroundSettings';
import { getCachedLocalUriForPath } from './stableMediaDiskCache';
import { logMediaCache } from './mediaCacheDebug';

const CACHE_KEY = 'auth_branding_cache_v3';

export async function prefetchAuthImage(uri) {
  if (!uri || !/^https?:\/\//i.test(uri)) return;
  try {
    await Image.prefetch(uri);
  } catch {
    // file:// o rete lenta: mostra comunque l'URI
  }
}

export async function getCachedAuthBranding() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return { logo: null, background: null };
    const parsed = JSON.parse(raw);
    let logo = parsed?.logo?.uri ? parsed.logo : null;
    const background = parsed?.background?.uri ? parsed.background : null;

    if (logo?.path) {
      const local = await getCachedLocalUriForPath(logo.path, { asset: 'login_logo' });
      if (local) {
        logo = { uri: local, path: logo.path };
        logMediaCache('logo_cache_disk', { path: logo.path, uri: local, layer: 'async_storage' });
      } else if (logo?.uri) {
        logMediaCache('logo_cache_async_remote', { path: logo.path, uri: logo.uri, layer: 'async_storage' });
      }
    } else if (logo?.uri) {
      logMediaCache('logo_cache_async_only_uri', { uri: logo.uri, layer: 'async_storage' });
    }

    if (background?.uri) {
      logMediaCache('login_bg_cache', { uri: background.uri, layer: 'async_storage', note: 'sfondo ancora remoto' });
    }

    return { logo, background };
  } catch (e) {
    logMediaCache('logo_cache_error', { error: e?.message || String(e) });
    return { logo: null, background: null };
  }
}

async function persistAuthBrandingCache(logo, background) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ logo, background }));
  } catch {}
}

/**
 * Logo login su disco (path stabile); sfondo login resta URL remoto per ora.
 */
export async function loadAuthBranding() {
  let logo = null;
  let background = null;

  try {
    [logo, background] = await Promise.all([getLoginLogoSettings(), getLoginBackgroundSettings()]);
    await persistAuthBrandingCache(logo, background);
    logMediaCache('branding_load_ok', {
      logoPath: logo?.path,
      logoUri: logo?.uri,
      bgUri: background?.uri,
      layer: 'api_db',
    });
  } catch (e) {
    logMediaCache('branding_load_error', { error: e?.message || String(e) });
    const cached = await getCachedAuthBranding();
    logo = cached.logo;
    background = cached.background;
  }

  await Promise.all([prefetchAuthImage(logo?.uri), prefetchAuthImage(background?.uri)]);

  return { logo, background };
}

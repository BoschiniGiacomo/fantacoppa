import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'react-native';
import { getLoginLogoSettings } from './loginLogoSettings';
import { getLoginBackgroundSettings } from './loginBackgroundSettings';

const CACHE_KEY = 'auth_branding_cache_v2';

export async function prefetchAuthImage(uri) {
  if (!uri) return;
  try {
    await Image.prefetch(uri);
  } catch {
    // Mostra comunque l'URI se il prefetch fallisce (rete lenta, ecc.)
  }
}

export async function getCachedAuthBranding() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return { logo: null, background: null };
    const parsed = JSON.parse(raw);
    return {
      logo: parsed?.logo?.uri ? parsed.logo : null,
      background: parsed?.background?.uri ? parsed.background : null,
    };
  } catch {
    return { logo: null, background: null };
  }
}

async function persistAuthBrandingCache(logo, background) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ logo, background }));
  } catch {}
}

/**
 * Scarica impostazioni auth, prefetch immagini, aggiorna cache.
 * Da chiamare prima di mostrare login / register / forgot password.
 */
export async function loadAuthBranding() {
  let logo = null;
  let background = null;

  try {
    [logo, background] = await Promise.all([getLoginLogoSettings(), getLoginBackgroundSettings()]);
    await persistAuthBrandingCache(logo, background);
  } catch {
    const cached = await getCachedAuthBranding();
    logo = cached.logo;
    background = cached.background;
  }

  await Promise.all([prefetchAuthImage(logo?.uri), prefetchAuthImage(background?.uri)]);

  return { logo, background };
}

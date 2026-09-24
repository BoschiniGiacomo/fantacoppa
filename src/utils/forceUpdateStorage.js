import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAppVersionInfo } from '../services/api';

const FORCE_UPDATE_STORAGE_KEY = 'force_update_required_v1';

export async function readPersistedForceUpdate() {
  try {
    const raw = await AsyncStorage.getItem(FORCE_UPDATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const minCode = Number(parsed.minVersionCode);
    const currentCode = Number(getAppVersionInfo().code) || 0;
    if (Number.isFinite(minCode) && minCode > 0 && currentCode >= minCode) {
      await AsyncStorage.removeItem(FORCE_UPDATE_STORAGE_KEY);
      return null;
    }
    return {
      message: parsed.message || 'È disponibile una nuova versione. Aggiorna per scoprire le novità.',
      updateUrl: parsed.updateUrl || null,
      minVersionCode: parsed.minVersionCode || null,
    };
  } catch (_) {
    return null;
  }
}

export async function persistForceUpdate(info) {
  try {
    await AsyncStorage.setItem(
      FORCE_UPDATE_STORAGE_KEY,
      JSON.stringify({
        message: info?.message || 'È disponibile una nuova versione. Aggiorna per scoprire le novità.',
        updateUrl: info?.updateUrl || null,
        minVersionCode: info?.minVersionCode || null,
      }),
    );
  } catch (_) {}
}

export async function clearPersistedForceUpdate() {
  try {
    await AsyncStorage.removeItem(FORCE_UPDATE_STORAGE_KEY);
  } catch (_) {}
}

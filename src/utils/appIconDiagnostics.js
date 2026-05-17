import { Image } from 'react-native';
import Constants from 'expo-constants';
import { APP_ICON, APP_ICON_REVISION, APP_ICON_LABEL } from '../constants/appBrandAssets';

const LOG = '[APP_ICON]';

/**
 * Log in Metro / Logcat: quale logo è nel bundle JS e se un OTA sta sovrascrivendo lo splash.
 */
export async function logAppIconDiagnostics() {
  const resolved = Image.resolveAssetSource(APP_ICON);
  const cfg = Constants.expoConfig || {};

  console.log(`${LOG} ========== diagnostica logo app ==========`);
  console.log(`${LOG} revisione attesa nel codice:`, APP_ICON_REVISION);
  console.log(`${LOG} descrizione:`, APP_ICON_LABEL);
  console.log(`${LOG} asset nel bundle JS (schermata caricamento in-app se senza media server):`, {
    uri: resolved?.uri ?? '(n/a)',
    width: resolved?.width,
    height: resolved?.height,
  });
  console.log(`${LOG} manifest Expo (icona lista progetti + splash nativo):`, {
    icon: cfg?.icon,
    splashImage: cfg?.splash?.image,
    splashBg: cfg?.splash?.backgroundColor,
    runtimeVersion: cfg?.runtimeVersion,
    otaCheckAutomatically: cfg?.updates?.checkAutomatically,
    manifestRevision: cfg?.extra?.appIconRevision,
  });

  if (cfg?.extra?.appIconRevision !== APP_ICON_REVISION) {
    console.warn(
      `${LOG} MISMATCH: extra.appIconRevision (${cfg?.extra?.appIconRevision}) !== codice (${APP_ICON_REVISION}). Riavvia Metro con -c.`
    );
  } else {
    console.log(`${LOG} OK: manifest allineato alla revisione nel codice.`);
  }

  try {
    const Updates = await import('expo-updates');
    const createdAt = Updates.createdAt ? new Date(Updates.createdAt).toISOString() : null;
    console.log(`${LOG} expo-updates:`, {
      enabled: Updates.isEnabled,
      embeddedLaunch: Updates.isEmbeddedLaunch,
      updateId: Updates.updateId ?? '(nessuno)',
      channel: Updates.channel ?? '(n/a)',
      createdAt,
      runtimeVersion: Updates.runtimeVersion,
    });

    if (Updates.isEnabled && Updates.updateId && !Updates.isEmbeddedLaunch) {
      console.warn(
        `${LOG} SPLASH VECCHIO? Stai usando un OTA già scaricato (${Updates.updateId}). ` +
          'Expo Go può mostrare splash/icona di quell\'update, non del logo di oggi su Metro. ' +
          'Cancella dati Expo Go o attendi OTA nuovo con eas update.'
      );
    } else if (cfg?.updates?.checkAutomatically === 'NEVER') {
      console.log(
        `${LOG} OTA disattivato in dev: splash nativo dovrebbe usare ./assets/app-icon.png del manifest attuale.`
      );
    }
  } catch (e) {
    console.log(`${LOG} expo-updates:`, e?.message || 'non disponibile');
  }

  console.log(`${LOG} Se in Expo Go vedi ancora COPPA/CANTONI nero su bianco = cache splash o OTA vecchio, non il file in assets/.`);
  console.log(`${LOG} ========== fine diagnostica ==========`);
}

import { Linking, Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import { notificationService as notificationApiService } from './api';

/**
 * Da SDK 53, in Expo Go su Android l'import di expo-notifications crasha
 * (push remote rimosse; addPushTokenListener → throw). In Expo Go usiamo stub.
 */
const PUSH_UNSUPPORTED_IN_EXPO_GO = isRunningInExpoGo() && Platform.OS === 'android';

let Notifications = null;
if (!PUSH_UNSUPPORTED_IN_EXPO_GO) {
  // eslint-disable-next-line global-require
  Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

const CHANNEL_ID = 'fantacoppa-reminders';
const SOURCE = 'fantacoppa-local';
const TOKEN_REFRESH_MS = 10 * 60 * 1000;

let initialized = false;
let registerInFlightPromise = null;
let lastRegisteredToken = null;
let lastRegisterAtMs = 0;

async function ensureAndroidChannel() {
  if (!Notifications || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Promemoria FantaCoppa',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
}

export async function initNotifications() {
  if (PUSH_UNSUPPORTED_IN_EXPO_GO || initialized) return;
  await ensureAndroidChannel();
  initialized = true;
}

export async function requestNotificationsPermissionIfNeeded() {
  if (!Notifications) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }
  const requested = await Notifications.requestPermissionsAsync();
  return !!(requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
}

export async function openSystemNotificationSettings() {
  try {
    await Linking.openSettings();
  } catch {
    // ignore
  }
}

/** Stato permesso notifiche per UI (senza richiedere il permesso). */
export async function getNotificationPermissionStatus() {
  if (PUSH_UNSUPPORTED_IN_EXPO_GO) {
    return { granted: false, status: 'expo-go-unsupported' };
  }
  try {
    await initNotifications();
    const current = await Notifications.getPermissionsAsync();
    const provisional =
      Platform.OS === 'ios'
      && current?.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (current?.granted || provisional) {
      return { granted: true, status: provisional ? 'provisional' : 'granted' };
    }
    if (current?.canAskAgain === false) {
      return { granted: false, status: 'blocked' };
    }
    return { granted: false, status: 'denied' };
  } catch {
    return { granted: false, status: 'unknown' };
  }
}

function resolveExpoProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null
  );
}

async function registerDevicePushToken({ force = false } = {}) {
  if (!Notifications) return false;

  const nowAtEntry = Date.now();
  if (!force && lastRegisteredToken && nowAtEntry - lastRegisterAtMs < TOKEN_REFRESH_MS) {
    return true;
  }

  if (registerInFlightPromise) {
    return registerInFlightPromise;
  }

  registerInFlightPromise = (async () => {
    const projectId = resolveExpoProjectId();

    try {
      const tokenRes = projectId
        ? await Notifications.getExpoPushTokenAsync({ projectId })
        : await Notifications.getExpoPushTokenAsync();
      const expoPushToken = tokenRes?.data;
      if (!expoPushToken) {
        return false;
      }

      const now = Date.now();
      const sameToken = lastRegisteredToken && lastRegisteredToken === expoPushToken;
      const recentRegistration = now - lastRegisterAtMs < 60 * 1000;
      if (sameToken && recentRegistration) {
        return true;
      }

      await notificationApiService.registerPushToken(expoPushToken, Platform.OS);
      lastRegisteredToken = expoPushToken;
      lastRegisterAtMs = now;
      return true;
    } catch {
      return false;
    }
  })();

  try {
    const ok = await registerInFlightPromise;
    return !!ok;
  } finally {
    registerInFlightPromise = null;
  }
}

export async function registerPushTokenIfPermitted() {
  if (PUSH_UNSUPPORTED_IN_EXPO_GO) return false;
  await initNotifications();
  const ok = await requestNotificationsPermissionIfNeeded();
  if (!ok) {
    return false;
  }
  return await registerDevicePushToken();
}

/** Rimuove vecchie notifiche locali programmate (formazione) dopo passaggio a push server. */
async function cancelLegacyLocalFormationReminders() {
  if (!Notifications) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const managed = scheduled.filter((n) => n?.content?.data?.source === SOURCE);
  await Promise.all(managed.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

/**
 * Registra il token push (serve per tutte le notifiche “stile WhatsApp”: calcolo giornata + promemoria formazione da server).
 * Promemoria e “giornata calcolata” arrivano via Expo → FCM/APNs anche con app chiusa (cron + calcolo ).
 */
export async function syncLeagueNotifications(_leagues = []) {
  if (PUSH_UNSUPPORTED_IN_EXPO_GO) return;
  await initNotifications();
  const hasPermission = await requestNotificationsPermissionIfNeeded();
  if (hasPermission) {
    await registerDevicePushToken();
  }

  if (!hasPermission) {
    return;
  }

  await cancelLegacyLocalFormationReminders();
}

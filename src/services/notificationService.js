import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import { notificationService as notificationApiService, apiFileUrl } from './api';
import { notificationDebugLog } from './notificationDebugLog';

const CHANNEL_ID = 'fantacoppa-reminders';
const SOURCE = 'fantacoppa-local';

let initialized = false;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Promemoria FantaCoppa',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
}

export async function initNotifications() {
  if (initialized) return;
  await ensureAndroidChannel();
  initialized = true;
}

export async function requestNotificationsPermissionIfNeeded() {
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

function resolveExpoProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null
  );
}

function formatRegisterError(error) {
  if (error?.response) {
    const st = error.response.status;
    const d = error.response.data;
    const body = typeof d === 'object' && d !== null ? JSON.stringify(d) : String(d);
    return `HTTP ${st} ${body.slice(0, 800)}`;
  }
  return error?.message || String(error);
}

async function registerDevicePushToken() {
  await notificationDebugLog(`registerDevicePushToken: platform=${Platform.OS}`);

  const projectId = resolveExpoProjectId();
  await notificationDebugLog(
    `registerDevicePushToken: projectId=${projectId ? 'presente' : 'assente'} url=${apiFileUrl('notifications/register-token')}`
  );

  try {
    const tokenRes = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const expoPushToken = tokenRes?.data;
    if (!expoPushToken) {
      await notificationDebugLog('registerDevicePushToken: getExpoPushTokenAsync ha restituito token vuoto');
      return;
    }
    const preview = `${String(expoPushToken).slice(0, 36)}… (len ${String(expoPushToken).length})`;
    await notificationDebugLog(`registerDevicePushToken: token ottenuto ${preview}`);
    await notificationApiService.registerPushToken(expoPushToken, Platform.OS);
    await notificationDebugLog('registerDevicePushToken: POST register-token OK (200)');
  } catch (error) {
    const msg = formatRegisterError(error);
    await notificationDebugLog(`registerDevicePushToken: ERRORE ${msg}`);
    console.log('Push token registration failed', error?.message || error);
  }
}

export async function registerPushTokenIfPermitted() {
  await initNotifications();
  const ok = await requestNotificationsPermissionIfNeeded();
  const perm = await Notifications.getPermissionsAsync();
  await notificationDebugLog(
    `registerPushTokenIfPermitted: granted=${perm.granted} ios=${perm.ios?.status ?? 'n/a'}`
  );
  if (!ok) {
    await notificationDebugLog('registerPushTokenIfPermitted: permesso negato, skip registrazione');
    return;
  }
  await registerDevicePushToken();
}

export async function scheduleDebugTestNotification() {
  await initNotifications();
  await notificationDebugLog('scheduleDebugTestNotification: programmata tra 3s');
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'FantaCoppa — test',
      body: 'Se leggi questo, le notifiche locali sul dispositivo funzionano.',
      data: { source: 'fantacoppa-debug', type: 'debug_local' },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 3,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
  });
}

export async function retryRegisterPushTokenForDebug() {
  await notificationDebugLog('--- retryRegisterPushTokenForDebug (manuale) ---');
  await registerPushTokenIfPermitted();
}

/** Rimuove vecchie notifiche locali programmate (formazione) dopo passaggio a push server. */
async function cancelLegacyLocalFormationReminders() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const managed = scheduled.filter((n) => n?.content?.data?.source === SOURCE);
  await Promise.all(managed.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

/**
 * Registra il token push (serve per tutte le notifiche “stile WhatsApp”: calcolo giornata + promemoria formazione da server).
 * Promemoria e “giornata calcolata” arrivano via Expo → FCM/APNs anche con app chiusa (cron + calcolo su api.php).
 */
export async function syncLeagueNotifications(leagues = []) {
  await initNotifications();
  const hasPermission = await requestNotificationsPermissionIfNeeded();
  if (hasPermission) {
    await registerDevicePushToken();
  }

  if (!hasPermission) {
    await notificationDebugLog('syncLeagueNotifications: permesso negato, solo skip token');
    return;
  }

  await cancelLegacyLocalFormationReminders();
  await notificationDebugLog(
    `syncLeagueNotifications: token ok; promemoria/calcolo via push server (leghe in lista: ${Array.isArray(leagues) ? leagues.length : 0})`
  );
}

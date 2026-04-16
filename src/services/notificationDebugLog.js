import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

const KEY = 'fc_notification_debug_log_v1';
const MAX_LINES = 400;

function timestamp() {
  return new Date().toISOString();
}

/** Aggiunge una riga al log (max ~400 righe). */
export async function notificationDebugLog(message) {
  const line = `[${timestamp()}] ${message}`;
  try {
    const prev = await AsyncStorage.getItem(KEY);
    const lines = prev ? prev.split('\n').filter(Boolean) : [];
    lines.push(line);
    const trimmed = lines.slice(-MAX_LINES);
    await AsyncStorage.setItem(KEY, trimmed.join('\n'));
  } catch (e) {
    console.warn('notificationDebugLog', e);
  }
}

export async function getNotificationDebugLog() {
  return (await AsyncStorage.getItem(KEY)) || '';
}

export async function clearNotificationDebugLog() {
  await AsyncStorage.removeItem(KEY);
}

/** Condivide il log come file .txt (es. Drive, email) o apre il foglio Condividi. */
export async function shareNotificationDebugLogFile() {
  const text = (await getNotificationDebugLog()) || '(log vuoto)';
  const base = FileSystem.cacheDirectory;
  if (!base) {
    await Share.share({ title: 'Log notifiche FantaCoppa', message: text.slice(0, 50000) });
    return;
  }
  const path = `${base}fc_notification_debug.txt`;
  await FileSystem.writeAsStringAsync(path, text, { encoding: 'utf8' });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(path, {
      mimeType: 'text/plain',
      dialogTitle: 'Log notifiche FantaCoppa',
      UTI: 'public.plain-text',
    });
  } else {
    await Share.share({
      title: 'Log notifiche FantaCoppa',
      message: text.length > 25000 ? `${text.slice(0, 25000)}\n…(troncato)` : text,
    });
  }
}

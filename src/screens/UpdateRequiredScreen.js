import React from 'react';
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.fantacoppa.app';
const APP_STORE_URL = 'https://apps.apple.com/us/app/fantacoppa/id6761119410';
const FALLBACK_UPDATE_URL = PLAY_STORE_URL;

export const DEFAULT_UPDATE_REQUIRED_MESSAGE =
  "Questa versione dell'app non è più supportata. Aggiorna per continuare.";

const getStoreUrlByPlatform = () => {
  if (Platform.OS === 'android') return PLAY_STORE_URL;
  if (Platform.OS === 'ios') return APP_STORE_URL;
  return FALLBACK_UPDATE_URL;
};

export default function UpdateRequiredScreen({
  updateInfo,
  previewMode = false,
  onClose,
}) {
  const insets = useSafeAreaInsets();
  const message = updateInfo?.message || DEFAULT_UPDATE_REQUIRED_MESSAGE;
  const updateUrl = updateInfo?.updateUrl || getStoreUrlByPlatform();

  const handleUpdatePress = async () => {
    if (previewMode) return;
    try {
      await Linking.openURL(updateUrl);
    } catch (error) {
      console.error('Impossibile aprire URL aggiornamento:', error);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Aggiornamento richiesto</Text>
        <Text style={styles.message}>{message}</Text>
        <TouchableOpacity
          style={[styles.button, previewMode && styles.buttonPreview]}
          onPress={handleUpdatePress}
          activeOpacity={previewMode ? 1 : 0.85}
          disabled={previewMode}
        >
          <Text style={styles.buttonText}>
            {previewMode ? 'Aggiorna ora (anteprima)' : 'Aggiorna ora'}
          </Text>
        </TouchableOpacity>
      </View>

      {previewMode && typeof onClose === 'function' ? (
        <TouchableOpacity
          accessibilityLabel="Chiudi anteprima"
          onPress={onClose}
          style={[styles.closeBtn, { top: Math.max(insets.top, 10) + 6 }]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <View style={styles.closeInner}>
            <Ionicons name="close" size={26} color="#fff" />
          </View>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f6fb',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 12,
  },
  message: {
    fontSize: 16,
    color: '#4b5563',
    lineHeight: 23,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#667eea',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 14,
  },
  buttonPreview: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  closeBtn: {
    position: 'absolute',
    right: 14,
    zIndex: 20,
  },
  closeInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import React from 'react';
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.fantacoppa.app';
const APP_STORE_URL = 'https://apps.apple.com/us/app/fantacoppa/id6761119410';
const FALLBACK_UPDATE_URL = PLAY_STORE_URL;

const getStoreUrlByPlatform = () => {
  if (Platform.OS === 'android') return PLAY_STORE_URL;
  if (Platform.OS === 'ios') return APP_STORE_URL;
  return FALLBACK_UPDATE_URL;
};

export default function UpdateRequiredScreen({ updateInfo }) {
  const message = updateInfo?.message || 'Per continuare devi aggiornare l\'app.';
  const updateUrl = updateInfo?.updateUrl || getStoreUrlByPlatform();

  const handleUpdatePress = async () => {
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
        <TouchableOpacity style={styles.button} onPress={handleUpdatePress} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Aggiorna ora</Text>
        </TouchableOpacity>
      </View>
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
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});

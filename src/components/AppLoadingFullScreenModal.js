import React, { useEffect } from 'react';
import { Modal, View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AppLoadingShell from './AppLoadingShell';

/**
 * Overlay a tutto schermo (sopra tab bar e menu lega) con media di caricamento.
 * Con `showClose` mostra la X in alto a destra (anteprima super user).
 */
export default function AppLoadingFullScreenModal({
  visible,
  uri,
  mediaType,
  /** Progresso reale 0…1 (barra mappata ease-out in AppLoadingShell) */
  progress = 0,
  showClose = false,
  onClose,
}) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : undefined}
      onRequestClose={showClose && onClose ? onClose : () => {}}
    >
      <View style={styles.wrap}>
        <AppLoadingShell uri={uri} mediaType={mediaType} progress={progress} />
        {showClose && onClose ? (
          <TouchableOpacity
            accessibilityLabel="Chiudi anteprima caricamento"
            onPress={onClose}
            style={[styles.closeBtn, { top: Math.max(insets.top, 10) + 6, right: 14 }]}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <View style={styles.closeInner}>
              <Ionicons name="close" size={26} color="#fff" />
            </View>
          </TouchableOpacity>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#000',
  },
  closeBtn: {
    position: 'absolute',
    zIndex: 50,
  },
  closeInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
});

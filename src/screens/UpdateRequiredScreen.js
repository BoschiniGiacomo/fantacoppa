import React, { useState } from 'react';
import {
  Image,
  ImageBackground,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthBranding } from '../context/AuthBrandingContext';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.fantacoppa.app';
const APP_STORE_URL = 'https://apps.apple.com/us/app/fantacoppa/id6761119410';
const FALLBACK_UPDATE_URL = PLAY_STORE_URL;

export const DEFAULT_UPDATE_REQUIRED_MESSAGE =
  'È disponibile una nuova versione. Aggiorna per scoprire le novità.';

export const UPDATE_REQUIRED_TITLE = 'Aggiorna app';
export const UPDATE_REQUIRED_CTA = 'Aggiorna ora';
export const UPDATE_REQUIRED_CTA_PREVIEW = 'Aggiorna ora';

const getStoreUrlByPlatform = () => {
  if (Platform.OS === 'android') return PLAY_STORE_URL;
  if (Platform.OS === 'ios') return APP_STORE_URL;
  return FALLBACK_UPDATE_URL;
};

function BrandMark({ logoUri }) {
  const [failed, setFailed] = useState(null);
  const uri = logoUri && logoUri !== failed ? logoUri : null;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={styles.logoImage}
        resizeMode="contain"
        onError={() => setFailed(uri)}
      />
    );
  }

  return (
    <View style={styles.logoWrap}>
      <Ionicons name="football" size={32} color="#2c3e50" />
      <Text style={styles.logoBig}>FANTA</Text>
      <View style={styles.coppaRow}>
        <Text style={styles.logoBig}>CO</Text>
        <Text style={[styles.logoBig, { transform: [{ scaleX: -1 }] }]}>P</Text>
        <Text style={styles.logoBig}>PA</Text>
      </View>
      <Text style={styles.logoMonte}>MONTECAVOLO</Text>
    </View>
  );
}

export default function UpdateRequiredScreen({
  updateInfo,
  previewMode = false,
  onClose,
  backgroundUri: backgroundUriOverride = null,
  logoUri: logoUriOverride = null,
}) {
  const insets = useSafeAreaInsets();
  const { background, logo } = useAuthBranding();
  const [bgFailed, setBgFailed] = useState(null);

  const message = updateInfo?.message || DEFAULT_UPDATE_REQUIRED_MESSAGE;
  const updateUrl = updateInfo?.updateUrl || getStoreUrlByPlatform();
  const logoUri = logoUriOverride || logo?.uri || null;
  const rawBg = backgroundUriOverride || background?.uri || null;
  const bgUri = rawBg && rawBg !== bgFailed ? rawBg : null;

  const handleUpdatePress = async () => {
    if (previewMode) return;
    try {
      await Linking.openURL(updateUrl);
    } catch (error) {
      console.error('Impossibile aprire URL aggiornamento:', error);
    }
  };

  const Shell = bgUri ? ImageBackground : View;
  const shellProps = bgUri
    ? {
        source: { uri: bgUri },
        resizeMode: 'cover',
        onError: () => setBgFailed(bgUri),
      }
    : {};

  return (
    <Shell style={[styles.root, !bgUri && styles.rootFallback]} {...shellProps}>
      {bgUri ? <View style={styles.scrim} pointerEvents="none" /> : null}

      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + 12,
            paddingBottom: Math.max(insets.bottom, 16) + 12,
          },
        ]}
      >
        <View style={styles.centerAnchor}>
          <View style={styles.brandBlock}>
            <BrandMark logoUri={logoUri} />
          </View>
          <View style={styles.panel}>
            <Text style={styles.title}>{UPDATE_REQUIRED_TITLE}</Text>
            <Text style={styles.message}>{message}</Text>

            <TouchableOpacity
              style={[styles.button, previewMode && styles.buttonPreview]}
              onPress={handleUpdatePress}
              activeOpacity={previewMode ? 1 : 0.85}
              disabled={previewMode}
            >
              <Text style={styles.buttonText}>
                {previewMode ? UPDATE_REQUIRED_CTA_PREVIEW : UPDATE_REQUIRED_CTA}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {previewMode && typeof onClose === 'function' ? (
        <TouchableOpacity
          accessibilityLabel="Chiudi anteprima"
          onPress={onClose}
          style={[styles.closeBtn, { top: Math.max(insets.top, 10) + 6 }]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <View style={styles.closeInner}>
            <Ionicons name="close" size={22} color="#2c3e50" />
          </View>
        </TouchableOpacity>
      ) : null}
    </Shell>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  rootFallback: {
    backgroundColor: '#f5f5f5',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(245, 245, 245, 0.42)',
  },
  content: {
    flex: 1,
    paddingHorizontal: 22,
    justifyContent: 'center',
  },
  centerAnchor: {
    width: '100%',
    position: 'relative',
  },
  brandBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  logoImage: {
    width: 220,
    height: 130,
    alignSelf: 'center',
  },
  logoWrap: {
    alignItems: 'center',
  },
  logoBig: {
    fontSize: 34,
    fontWeight: '900',
    color: '#2c3e50',
    letterSpacing: 3,
    lineHeight: 40,
    includeFontPadding: false,
  },
  coppaRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: -6,
  },
  logoMonte: {
    fontSize: 10,
    fontWeight: '400',
    color: '#888',
    letterSpacing: 5,
    marginTop: 4,
  },
  panel: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#2c3e50',
    letterSpacing: -0.3,
    marginBottom: 10,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    color: '#555',
    marginBottom: 22,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#198754',
    borderRadius: 10,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonPreview: {
    opacity: 0.92,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  closeBtn: {
    position: 'absolute',
    right: 14,
    zIndex: 20,
  },
  closeInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
  },
});

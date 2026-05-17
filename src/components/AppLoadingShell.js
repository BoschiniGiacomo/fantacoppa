import React, { useMemo } from 'react';
import {
  View,
  StyleSheet,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LoopingVideoView from './LoopingVideoView';
import { mapRawProgressToBarFill01 } from '../utils/loadingBarProgress';
import { APP_ICON } from '../constants/appBrandAssets';

/**
 * @param {number} [progress] — progresso reale caricamento 0…1 (non mappato).
 */
export default function AppLoadingShell({ uri, mediaType, progress = 0 }) {
  const insets = useSafeAreaInsets();
  const isVideo = mediaType === 'video' && !!uri;
  const hasMedia = !!uri;

  const fillWidthPct = useMemo(
    () => mapRawProgressToBarFill01(progress) * 100,
    [progress],
  );

  /** Spazio extra sopra gesture bar / home indicator */
  const barBottomPadding = Math.max(insets.bottom + 18, 26);

  return (
    <View style={styles.root} accessibilityLabel="Caricamento in corso">
      {hasMedia && !isVideo ? (
        <Image
          source={{ uri }}
          style={styles.mediaFull}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {hasMedia && isVideo ? (
        <LoopingVideoView uri={uri} style={styles.mediaFull} contentFit="cover" />
      ) : null}
      {!hasMedia ? (
        <View style={styles.fallbackWrap}>
          <Image
            source={APP_ICON}
            style={styles.fallbackLogo}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <ActivityIndicator size="large" color="#a8b4ff" style={styles.fallbackSpinner} />
        </View>
      ) : null}

      <View style={[styles.barArea, { paddingBottom: barBottomPadding }]}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${fillWidthPct}%` }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaFull: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  fallbackWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 32,
  },
  fallbackLogo: {
    width: '72%',
    maxWidth: 320,
    aspectRatio: 1,
    marginBottom: 28,
  },
  fallbackSpinner: {
    marginTop: 4,
  },
  barArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 28,
    paddingTop: 14,
    zIndex: 4,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#000',
    alignSelf: 'flex-start',
  },
});

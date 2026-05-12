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
        <View style={styles.spinnerWrap}>
          <ActivityIndicator size="large" color="#a8b4ff" />
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
  spinnerWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
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
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#667eea',
    alignSelf: 'flex-start',
  },
});

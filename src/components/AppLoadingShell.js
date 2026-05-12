import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Image,
  Animated,
  ActivityIndicator,
  Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LoopingVideoView from './LoopingVideoView';

/**
 * Schermata bootstrap leggera: media opzionale in loop (GIF / immagine / video corto)
 * e barra sottile animata in basso.
 */
export default function AppLoadingShell({ uri, mediaType }) {
  const insets = useSafeAreaInsets();
  const [trackW, setTrackW] = useState(0);
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(slide, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      slide.setValue(0);
    };
  }, [slide]);

  const isVideo = mediaType === 'video' && !!uri;
  const hasMedia = !!uri;

  const segmentTranslate =
    trackW > 0
      ? slide.interpolate({
          inputRange: [0, 1],
          outputRange: [-trackW * 0.35, trackW * 0.65],
        })
      : 0;

  return (
    <View style={styles.root} accessibilityLabel="Caricamento in corso">
      {hasMedia && !isVideo ? (
        <Image
          source={{ uri }}
          style={styles.media}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {hasMedia && isVideo ? (
        <LoopingVideoView uri={uri} style={styles.media} />
      ) : null}
      {!hasMedia ? (
        <View style={styles.spinnerWrap}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      ) : null}

      <View
        style={[styles.barArea, { paddingBottom: Math.max(insets.bottom, 10) }]}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      >
        <View style={styles.track}>
          {trackW > 0 ? (
            <Animated.View
              style={[
                styles.segment,
                {
                  width: trackW * 0.28,
                  transform: [{ translateX: segmentTranslate }],
                },
              ]}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f4f5fa',
    justifyContent: 'center',
    alignItems: 'center',
  },
  media: {
    width: '56%',
    maxWidth: 280,
    aspectRatio: 1,
    maxHeight: '36%',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  spinnerWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  barArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(102, 126, 234, 0.15)',
    overflow: 'hidden',
  },
  segment: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#667eea',
  },
});

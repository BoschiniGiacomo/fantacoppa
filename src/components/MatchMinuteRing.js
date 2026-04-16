import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  MINUTE_RING_ROTATIONS_BY_SECOND,
  progressToSecondIndex,
} from './matchMinuteRingGeometry';

/**
 * Anello secondi del minuto corrente (senza SVG): due metà mascherate + bordo ruotato.
 * Progress 0..1 viene mappato su 61 stati (secondi 0..60) con angoli precomputati.
 * Container progress ruotato -90°: partenza in alto, senso orario.
 */
function MatchMinuteRing({
  size,
  stroke = 2.5,
  trackColor,
  progressColor,
  progress,
  minuteStr,
  minuteTextStyle,
  minimumFontScale = 0.6,
  centerPaddingH = 4,
}) {
  const u = Math.min(1, Math.max(0, Number(progress)));
  const secIndex = progressToSecondIndex(u);
  const { rightDeg, leftDeg } = MINUTE_RING_ROTATIONS_BY_SECOND[secIndex];
  const half = size / 2;
  const pSnap = secIndex >= 60 ? 1 : secIndex / 60;

  const Rmid = half - stroke / 2;
  const tip = useMemo(() => {
    if (pSnap <= 0.002 || pSnap >= 0.999) return null;
    const ang = pSnap * 2 * Math.PI - Math.PI / 2;
    const capW = stroke * 1.28;
    const capH = stroke * 0.92;
    const deg = (ang * 180) / Math.PI;
    return {
      left: half + Rmid * Math.cos(ang) - capW / 2,
      top: half + Rmid * Math.sin(ang) - capH / 2,
      width: capW,
      height: capH,
      borderRadius: capH / 2,
      rotateDeg: deg + 90,
    };
  }, [pSnap, half, Rmid, stroke]);

  return (
    <View style={[styles.wrap, { width: size, height: size }]} collapsable={false}>
      <View
        style={[
          styles.track,
          {
            left: stroke / 2,
            top: stroke / 2,
            width: size - stroke,
            height: size - stroke,
            borderRadius: (size - stroke) / 2,
            borderWidth: stroke,
            borderColor: trackColor,
          },
        ]}
        collapsable={false}
      />

      {secIndex > 0 ? (
        <View
          style={[styles.progressSpin, { width: size, height: size }]}
          collapsable={false}
        >
          <View style={[styles.halfClip, { left: 0, width: half, zIndex: 2 }]} collapsable={false}>
            <View
              style={[
                styles.rotRing,
                {
                  left: 0,
                  top: 0,
                  width: size,
                  height: size,
                  borderRadius: half,
                  borderWidth: stroke,
                  borderColor: progressColor,
                  transform: [{ rotate: `${rightDeg}deg` }],
                },
              ]}
              collapsable={false}
            />
          </View>

          <View style={[styles.halfClip, { left: half, width: half, zIndex: 2 }]} collapsable={false}>
            <View
              style={[
                styles.rotRing,
                {
                  left: -half,
                  top: 0,
                  width: size,
                  height: size,
                  borderRadius: half,
                  borderWidth: stroke,
                  borderColor: progressColor,
                  transform: [{ rotate: `${leftDeg}deg` }],
                },
              ]}
              collapsable={false}
            />
          </View>
        </View>
      ) : null}

      {tip ? (
        <View
          pointerEvents="none"
          collapsable={false}
          style={[
            styles.tipCap,
            {
              left: tip.left,
              top: tip.top,
              width: tip.width,
              height: tip.height,
              borderRadius: tip.borderRadius,
              backgroundColor: progressColor,
              transform: [{ rotate: `${tip.rotateDeg}deg` }],
            },
          ]}
        />
      ) : null}

      <View style={[StyleSheet.absoluteFillObject, styles.textLayer]} pointerEvents="none">
        <View style={[styles.center, { paddingHorizontal: centerPaddingH }]}>
          <Text
            style={minuteTextStyle}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={minimumFontScale}
          >
            {minuteStr}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    zIndex: 1,
  },
  progressSpin: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 2,
    transform: [{ rotate: '-90deg' }],
  },
  halfClip: {
    position: 'absolute',
    top: 0,
    height: '100%',
    overflow: 'hidden',
  },
  rotRing: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
  tipCap: {
    position: 'absolute',
    zIndex: 3,
  },
  textLayer: {
    zIndex: 4,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default React.memo(MatchMinuteRing);

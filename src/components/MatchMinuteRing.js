import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Ring minuto live con SVG.
 * Il bordo di progresso usa strokeDasharray/strokeDashoffset su una circonferenza
 * ruotata di -90deg per partire dall'alto in senso orario.
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
  const radius = useMemo(() => Math.max(0.1, size / 2 - stroke / 2), [size, stroke]);
  const circumference = useMemo(() => 2 * Math.PI * radius, [radius]);
  const clampedProgress = clamp01(Number(progress));
  const animatedProgress = useRef(new Animated.Value(clampedProgress)).current;
  const lastProgressRef = useRef(clampedProgress);

  useEffect(() => {
    const prev = lastProgressRef.current;
    const delta = Math.abs(clampedProgress - prev);
    lastProgressRef.current = clampedProgress;
    const duration = Math.max(120, Math.min(1000, Math.round(delta * 1000)));
    const anim = Animated.timing(animatedProgress, {
      toValue: clampedProgress,
      duration,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animatedProgress, clampedProgress]);

  const strokeDashoffset = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={trackColor}
            strokeWidth={stroke}
            fill="none"
          />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={progressColor}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
          />
        </G>
      </Svg>

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
    alignItems: 'center',
    justifyContent: 'center',
  },
  textLayer: {
    zIndex: 2,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default React.memo(MatchMinuteRing);

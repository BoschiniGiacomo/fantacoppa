import React, { useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

/**
 * Overlay hero partita ufficiale.
 * Pattern live-score (FotMob / SofaScore / England Football):
 * velo scuro per contrasto su loghi e risultato, sfumatura in basso verso il bianco delle tab.
 */
export default function MatchHeroBackgroundOverlay() {
  const uid = useId().replace(/:/g, '');
  const dimId = `heroDim${uid}`;
  const fadeId = `heroFade${uid}`;
  const [size, setSize] = useState({ w: 0, h: 0 });

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
      }}
    >
      {size.w > 0 && size.h > 0 ? (
        <Svg width={size.w} height={size.h}>
          <Defs>
            <LinearGradient id={dimId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#050810" stopOpacity="0.50" />
              <Stop offset="0.40" stopColor="#050810" stopOpacity="0.58" />
              <Stop offset="0.78" stopColor="#050810" stopOpacity="0.66" />
              <Stop offset="1" stopColor="#050810" stopOpacity="0.74" />
            </LinearGradient>
            <LinearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
              <Stop offset="0.42" stopColor="#ffffff" stopOpacity="0.16" />
              <Stop offset="0.78" stopColor="#ffffff" stopOpacity="0.78" />
              <Stop offset="1" stopColor="#ffffff" stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={size.w} height={size.h} fill={`url(#${dimId})`} />
          <Rect
            x={0}
            y={size.h * 0.72}
            width={size.w}
            height={size.h * 0.28}
            fill={`url(#${fadeId})`}
          />
        </Svg>
      ) : null}
    </View>
  );
}

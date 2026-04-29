import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function InjurySwapIcon({ size = 26 }) {
  const scale = size / 26;
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <MaterialCommunityIcons
        name="undo"
        size={Math.round(18 * scale)}
        color="#1e8e5a"
        style={[styles.top, { left: Math.round(1 * scale), top: Math.round(0 * scale) }]}
      />
      <MaterialCommunityIcons
        name="undo"
        size={Math.round(18 * scale)}
        color="#dc3545"
        style={[
          styles.bottom,
          {
            left: Math.round(2 * scale),
            top: Math.round(11 * scale),
            transform: [{ scaleX: -1 }, { scaleY: -1 }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  top: {
    position: 'absolute',
  },
  bottom: {
    position: 'absolute',
  },
});

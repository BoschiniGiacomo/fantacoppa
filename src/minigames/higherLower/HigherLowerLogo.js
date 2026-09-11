import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Logo Higher/Lower: freccia ↑ su cerchio verde (sinistra), ↓ su cerchio rosso (destra).
 */
export default function HigherLowerLogo({ size = 52 }) {
  const circle = Math.round(size * 0.62);
  const icon = Math.max(12, Math.round(circle * 0.58));
  const gap = -Math.round(circle * 0.22);
  const shift = Math.round(circle * 0.22);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <View
        style={[
          styles.circle,
          styles.higher,
          {
            width: circle,
            height: circle,
            borderRadius: circle / 2,
            alignSelf: 'flex-start',
            marginLeft: Math.max(0, (size - circle) / 2 - shift),
          },
        ]}
      >
        <Ionicons name="arrow-up" size={icon} color="#fff" />
      </View>
      <View
        style={[
          styles.circle,
          styles.lower,
          {
            width: circle,
            height: circle,
            borderRadius: circle / 2,
            marginTop: gap,
            alignSelf: 'flex-end',
            marginRight: Math.max(0, (size - circle) / 2 - shift),
          },
        ]}
      >
        <Ionicons name="arrow-down" size={icon} color="#fff" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    justifyContent: 'center',
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  higher: {
    backgroundColor: '#22c55e',
    zIndex: 2,
    elevation: 2,
  },
  lower: {
    backgroundColor: '#ef4444',
    zIndex: 1,
    elevation: 1,
  },
});

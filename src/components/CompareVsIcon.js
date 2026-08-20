import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Icona confronto: due omini person-outline (come Panoramica) con "vs" al centro.
 */
export default function CompareVsIcon({
  color = '#667eea',
  size = 22,
  muted = false,
}) {
  const stroke = muted ? '#94a3b8' : color;
  const personSize = Math.round(size * 0.68);
  const vsFont = Math.max(9, Math.round(size * 0.42));

  return (
    <View style={[styles.wrap, { height: size }]}>
      <Ionicons name="person-outline" size={personSize} color={stroke} />
      <Text style={[styles.vs, { color: stroke, fontSize: vsFont, lineHeight: vsFont + 2 }]}>
        vs
      </Text>
      <Ionicons name="person-outline" size={personSize} color={stroke} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vs: {
    fontWeight: '700',
    marginHorizontal: 1,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});

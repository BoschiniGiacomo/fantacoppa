import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Icona confronto.
 * - withPeople: due person-outline + vs (pulsante ingresso da PlayerStats)
 * - default: solo "vs" (interno schermata confronto)
 */
export default function CompareVsIcon({
  color = '#667eea',
  size = 22,
  muted = false,
  withPeople = false,
}) {
  const stroke = muted ? '#94a3b8' : color;
  const vsFont = withPeople
    ? Math.max(9, Math.round(size * 0.42))
    : Math.max(11, Math.round(size * 0.55));

  if (!withPeople) {
    return (
      <Text style={[styles.vsOnly, { color: stroke, fontSize: vsFont, lineHeight: vsFont + 2 }]}>
        vs
      </Text>
    );
  }

  const personSize = Math.round(size * 0.68);

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
  vsOnly: {
    fontWeight: '800',
    letterSpacing: 0.5,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});

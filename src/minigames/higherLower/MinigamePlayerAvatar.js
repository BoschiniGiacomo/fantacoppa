import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PlayerPhotoImage } from '../../components/StableCachedImage';

/** Slot layout (spazio riservato nella card). */
const SLOT_WIDTH = 80;
const SLOT_HEIGHT = 96;
/** Disegno rispetto allo slot: bleed moderato, evita sfori eccessivi. */
const PHOTO_ZOOM = 1.0;
const PHOTO_SIDE_BLEED = 1.14;
const PHOTO_VERT_BLEED = 1.06;

function stripBirthYearNameSuffix(name) {
  return String(name || '')
    .replace(/\s*\(\s*'\d{2}\s*\)\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function playerInitials(name) {
  const parts = stripBirthYearNameSuffix(name)
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

/**
 * Avatar minigioco.
 * Con foto: ritratto più grande dello slot, overflow visible (come confronto).
 * Senza foto: cerchio con iniziali (size legacy).
 */
export default function MinigamePlayerAvatar({
  photoPath,
  name,
  size = 96,
  accent = '#667eea',
  slotWidth = SLOT_WIDTH,
  slotHeight = SLOT_HEIGHT,
}) {
  const path = String(photoPath || '').trim();
  const circleRadius = Math.round(size / 2);

  const fallbackCircle = useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: circleRadius,
      backgroundColor: `${accent}18`,
      alignItems: 'center',
      justifyContent: 'center',
    }),
    [size, circleRadius, accent],
  );

  if (path) {
    const baseW = slotWidth;
    const baseH = Math.round(slotWidth * 1.3);
    const drawW = Math.round(baseW * PHOTO_ZOOM * PHOTO_SIDE_BLEED);
    const drawH = Math.round(baseH * PHOTO_ZOOM * PHOTO_VERT_BLEED);
    const top = Math.round((slotHeight - drawH) / 2);
    const fallbackStyle = {
      width: baseW,
      height: baseH,
      borderRadius: 16,
      backgroundColor: '#f1f5f9',
      alignItems: 'center',
      justifyContent: 'center',
    };

    return (
      <View
        style={{
          width: slotWidth,
          height: slotHeight,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'visible',
        }}
      >
        <PlayerPhotoImage
          photoPath={path}
          style={{
            width: drawW,
            height: drawH,
            position: 'absolute',
            left: (slotWidth - drawW) / 2,
            top,
          }}
          resizeMode="cover"
          fallbackStyle={fallbackStyle}
          fallbackIcon="person-outline"
          fallbackIconSize={Math.round(Math.min(baseW, baseH) * 0.34)}
          fallbackColor="#94a3b8"
        />
      </View>
    );
  }

  return (
    <View
      style={{
        width: slotWidth,
        height: slotHeight,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={fallbackCircle}>
        <Text style={[styles.initials, { fontSize: Math.round(size * 0.32), color: accent }]}>
          {playerInitials(name)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  initials: {
    fontWeight: '800',
  },
});

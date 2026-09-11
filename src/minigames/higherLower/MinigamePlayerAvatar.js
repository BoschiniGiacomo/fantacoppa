import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PlayerPhotoImage } from '../../components/StableCachedImage';

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

export default function MinigamePlayerAvatar({ photoPath, name, size = 72, accent = '#667eea' }) {
  const radius = Math.round(size / 2);
  const path = String(photoPath || '').trim();
  const fallbackStyle = useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: radius,
      backgroundColor: `${accent}18`,
      alignItems: 'center',
      justifyContent: 'center',
    }),
    [size, radius, accent],
  );

  if (path) {
    return (
      <PlayerPhotoImage
        photoPath={path}
        style={{ width: size, height: size, borderRadius: radius }}
        resizeMode="cover"
        fallbackStyle={fallbackStyle}
        fallbackIcon="person-outline"
        fallbackIconSize={Math.round(size * 0.42)}
        fallbackColor={accent}
      />
    );
  }

  return (
    <View style={fallbackStyle}>
      <Text style={[styles.initials, { fontSize: Math.round(size * 0.32), color: accent }]}>
        {playerInitials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  initials: {
    fontWeight: '800',
  },
});

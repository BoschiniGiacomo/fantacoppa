import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Placca live sotto il nome lega.
 */
export default function LeagueNameCrest({ name = '' }) {
  const trimmed = String(name || '').trim();
  const display = trimmed || 'La tua lega';
  const empty = !trimmed;

  return (
    <View style={[styles.crest, empty && styles.crestEmpty]}>
      <View style={styles.badge}>
        <Ionicons name="trophy" size={16} color={empty ? '#94a3b8' : '#667eea'} />
      </View>
      <Text
        style={[styles.name, empty && styles.nameEmpty]}
        numberOfLines={1}
      >
        {display}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  crest: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  crestEmpty: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#312e81',
  },
  nameEmpty: {
    color: '#94a3b8',
    fontWeight: '600',
  },
});

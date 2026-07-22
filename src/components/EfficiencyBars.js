import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const ACCENT = '#667eea';

function EfficiencyBar({ label, value, displayValue, max = 1 }) {
  const numeric = Number(value || 0);
  const safeMax = Number(max) > 0 ? Number(max) : 1;
  const pct = Math.min(100, Math.max(0, (numeric / safeMax) * 100));

  return (
    <View style={styles.row}>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.value}>{displayValue}</Text>
    </View>
  );
}

export default function EfficiencyBars({ items = [] }) {
  if (!Array.isArray(items) || !items.length) {
    return (
      <Text style={styles.emptyText}>Nessun indice di efficienza disponibile.</Text>
    );
  }

  return (
    <View style={styles.wrap}>
      {items.map((item) => (
        <EfficiencyBar
          key={item.key}
          label={item.label}
          value={item.value}
          displayValue={item.displayValue}
          max={item.max}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  label: {
    width: 108,
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: ACCENT,
  },
  value: {
    width: 44,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  emptyText: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 8,
  },
});

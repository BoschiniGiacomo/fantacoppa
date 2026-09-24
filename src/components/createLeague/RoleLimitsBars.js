import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ROLE_COLORS } from './startersLayout';

/**
 * Barrette proporzionali sui limiti rosa P/D/C/A.
 * Nota: non usare la proprietà `.value` dentro `style={{...}}` —
 * il plugin Reanimated la scambia per un SharedValue e spamwarning.
 */
export default function RoleLimitsBars({
  maxPortieri = 0,
  maxDifensori = 0,
  maxCentrocampisti = 0,
  maxAttaccanti = 0,
}) {
  const roles = useMemo(() => {
    const items = [
      { key: 'P', count: Math.max(0, parseInt(maxPortieri, 10) || 0) },
      { key: 'D', count: Math.max(0, parseInt(maxDifensori, 10) || 0) },
      { key: 'C', count: Math.max(0, parseInt(maxCentrocampisti, 10) || 0) },
      { key: 'A', count: Math.max(0, parseInt(maxAttaccanti, 10) || 0) },
    ];
    const sum = items.reduce((s, r) => s + r.count, 0) || 1;
    return items.map((r) => ({ ...r, pct: (r.count / sum) * 100 }));
  }, [maxPortieri, maxDifensori, maxCentrocampisti, maxAttaccanti]);

  const total = roles.reduce((s, r) => s + r.count, 0);

  return (
    <View style={styles.wrap}>
      <View style={styles.track}>
        {roles.map((r) =>
          r.count > 0 ? (
            <View
              key={r.key}
              style={[
                styles.seg,
                {
                  flex: r.count,
                  backgroundColor: ROLE_COLORS[r.key],
                },
              ]}
            />
          ) : null
        )}
      </View>
      <View style={styles.legend}>
        {roles.map((r) => (
          <Text key={r.key} style={styles.legendItem}>
            <Text style={{ color: ROLE_COLORS[r.key], fontWeight: '800' }}>{r.key}</Text>
            {' '}
            {r.count}
          </Text>
        ))}
        <Text style={styles.total}>{total} posti</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 10,
  },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e2e8f0',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  seg: {
    height: '100%',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  legendItem: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  total: {
    marginLeft: 'auto',
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
});

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

const CHART_HEIGHT = 140;
const ACCENT = '#667eea';

export default function VoteDistributionChart({ distribution = [], width = 320 }) {
  const chartWidth = Math.max(240, Number(width) || 320);
  const buckets = useMemo(
    () => (Array.isArray(distribution) ? distribution : []).map((item) => ({
      label: String(item?.label || ''),
      count: Number(item?.count || 0),
    })),
    [distribution],
  );

  const maxCount = useMemo(
    () => Math.max(1, ...buckets.map((item) => item.count)),
    [buckets],
  );

  const barWidth = Math.min(44, (chartWidth - 24) / Math.max(buckets.length, 1) - 8);
  const gap = 8;
  const totalBarsWidth = buckets.length * barWidth + Math.max(0, buckets.length - 1) * gap;
  const startX = (chartWidth - totalBarsWidth) / 2;
  const maxBarHeight = CHART_HEIGHT - 36;

  if (!buckets.some((item) => item.count > 0)) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>Nessuna distribuzione voti disponibile.</Text>
      </View>
    );
  }

  return (
    <View>
      <Svg width={chartWidth} height={CHART_HEIGHT}>
        {buckets.map((item, index) => {
          const height = Math.max(4, (item.count / maxCount) * maxBarHeight);
          const x = startX + index * (barWidth + gap);
          const y = CHART_HEIGHT - 24 - height;
          return (
            <Rect
              key={item.label}
              x={x}
              y={y}
              width={barWidth}
              height={height}
              rx={6}
              fill={ACCENT}
              opacity={0.85}
            />
          );
        })}
      </Svg>
      <View style={[styles.labelsRow, { width: chartWidth }]}>
        {buckets.map((item) => (
          <View key={item.label} style={[styles.labelCol, { width: barWidth + gap }]}>
            <Text style={styles.countText}>{item.count}</Text>
            <Text style={styles.labelText} numberOfLines={1}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyWrap: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
  },
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: -22,
    paddingHorizontal: 0,
  },
  labelCol: {
    alignItems: 'center',
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 18,
  },
  labelText: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
    textAlign: 'center',
  },
});

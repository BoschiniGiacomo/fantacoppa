import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

/**
 * Distribuzione voti come breakdown pagelle (pattern chiaro da rating apps):
 * una riga = una fascia di voto, barra = quante volte, % a destra.
 * Titoli italiani (Eccellente → Insufficiente) + range numerico: si capisce subito.
 */

const BANDS = [
  { key: '≥7.5', title: 'Eccellente', range: '≥ 7.5', color: '#0f766e', track: '#ccfbf1' },
  { key: '7-7.5', title: 'Buono', range: '7 – 7.5', color: '#15803d', track: '#dcfce7' },
  { key: '6.5-7', title: 'Discreto', range: '6.5 – 7', color: '#65a30d', track: '#ecfccb' },
  { key: '6-6.5', title: 'Sufficiente', range: '6 – 6.5', color: '#ca8a04', track: '#fef9c3' },
  { key: '<6', title: 'Insufficiente', range: '< 6', color: '#b91c1c', track: '#fee2e2' },
];

function DistributionRow({ band, count, total, maxCount }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const fill = maxCount > 0 ? Math.max(count > 0 ? 6 : 0, (count / maxCount) * 100) : 0;

  return (
    <View style={styles.row}>
      <View style={styles.rowLabelCol}>
        <Text style={[styles.rowTitle, { color: band.color }]}>{band.title}</Text>
        <Text style={styles.rowRange}>{band.range}</Text>
      </View>

      <View style={[styles.barTrack, { backgroundColor: band.track }]}>
        <View style={[styles.barFill, { width: `${fill}%`, backgroundColor: band.color }]} />
      </View>

      <View style={styles.rowStatsCol}>
        <Text style={[styles.rowCount, { color: band.color }]}>{count}</Text>
        <Text style={styles.rowPct}>{pct.toFixed(0)}%</Text>
      </View>
    </View>
  );
}

export default function VoteDistributionChart({ distribution = [] }) {
  const buckets = useMemo(() => {
    const map = new Map(
      (Array.isArray(distribution) ? distribution : []).map((item) => [
        String(item?.label || ''),
        Number(item?.count || 0),
      ]),
    );
    return BANDS.map((band) => ({
      ...band,
      count: map.get(band.key) || 0,
    }));
  }, [distribution]);

  const total = useMemo(
    () => buckets.reduce((sum, item) => sum + item.count, 0),
    [buckets],
  );

  const maxCount = useMemo(
    () => Math.max(1, ...buckets.map((item) => item.count)),
    [buckets],
  );

  const topBand = useMemo(
    () => buckets.reduce((best, band) => (band.count > (best?.count || -1) ? band : best), null),
    [buckets],
  );

  if (total <= 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>Nessuna distribuzione voti disponibile.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.summaryCard}>
        <View
          style={[
            styles.topBadge,
            {
              borderColor: topBand.color,
              backgroundColor: topBand.track,
            },
          ]}
        >
          <Text style={[styles.topBadgeTitle, { color: topBand.color }]}>{topBand.title}</Text>
          <Text style={[styles.topBadgeCount, { color: topBand.color }]}>{topBand.count}</Text>
          <Text style={[styles.topBadgeHint, { color: topBand.color }]}>più frequente</Text>
        </View>

        <View style={styles.summaryCopy}>
          <View style={styles.summaryChip}>
            <MaterialCommunityIcons name="whistle" size={12} color="#0f766e" />
            <Text style={styles.summaryChipText}>Pagelle</Text>
          </View>
          <Text style={styles.summaryTitle}>{total} voti in tutto</Text>
          <Text style={styles.summarySub}>
            Quante volte la pagella è finita in ciascuna fascia
          </Text>
        </View>
      </View>

      <View style={styles.list}>
        {buckets.map((band) => (
          <DistributionRow
            key={band.key}
            band={band}
            count={band.count}
            total={total}
            maxCount={maxCount}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 14,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  topBadge: {
    width: 86,
    minHeight: 78,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  topBadgeTitle: {
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  topBadgeCount: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  topBadgeHint: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
    opacity: 0.85,
  },
  summaryCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  summaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#f0fdfa',
    marginBottom: 2,
  },
  summaryChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0f766e',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  summarySub: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
    lineHeight: 16,
  },
  list: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowLabelCol: {
    width: 86,
  },
  rowTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  rowRange: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
    marginTop: 1,
  },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  rowStatsCol: {
    width: 40,
    alignItems: 'flex-end',
  },
  rowCount: {
    fontSize: 13,
    fontWeight: '800',
  },
  rowPct: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
  },
  emptyWrap: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
  },
});

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const METRIC_THEME = {
  goals: {
    icon: 'soccer',
    color: '#15803d',
    soft: '#dcfce7',
    track: '#bbf7d0',
  },
  assists: {
    icon: 'shoe-cleat',
    color: '#1d4ed8',
    soft: '#dbeafe',
    track: '#bfdbfe',
  },
  involvement: {
    icon: 'lightning-bolt',
    color: '#0f766e',
    soft: '#ccfbf1',
    track: '#99f6e4',
  },
  scored: {
    icon: 'clipboard-check-outline',
    color: '#5b6ee8',
    soft: '#eef2ff',
    track: '#c7d2fe',
  },
  cards: {
    icon: 'cards',
    color: '#ca8a04',
    soft: '#fef9c3',
    track: '#fde68a',
  },
  clean_sheet_pct: {
    icon: 'shield-check',
    color: '#0369a1',
    soft: '#e0f2fe',
    track: '#bae6fd',
  },
  goals_conceded: {
    icon: 'target',
    color: '#b91c1c',
    soft: '#fee2e2',
    track: '#fecaca',
  },
};

const DEFAULT_THEME = {
  icon: 'chart-timeline-variant',
  color: '#667eea',
  soft: '#eef2ff',
  track: '#c7d2fe',
};

function EfficiencyMeter({ item }) {
  const theme = METRIC_THEME[item.key] || DEFAULT_THEME;
  const numeric = Number(item.value || 0);
  const safeMax = Number(item.max) > 0 ? Number(item.max) : 1;
  const pct = Math.min(100, Math.max(0, (numeric / safeMax) * 100));

  return (
    <View style={[styles.meterCard, { borderColor: theme.soft }]}>
      <View style={styles.meterTop}>
        <View style={styles.meterIdentity}>
          <View style={[styles.iconBadge, { backgroundColor: theme.soft }]}>
            <MaterialCommunityIcons name={theme.icon} size={14} color={theme.color} />
          </View>
          <View style={styles.meterTextBlock}>
            <Text style={styles.meterLabel} numberOfLines={1}>{item.label}</Text>
            <View style={styles.pitchMarks}>
              {[0, 1, 2, 3, 4].map((mark) => (
                <View
                  key={mark}
                  style={[
                    styles.pitchMark,
                    { backgroundColor: pct > mark * 20 ? theme.color : theme.track },
                  ]}
                />
              ))}
            </View>
          </View>
        </View>
        <Text style={[styles.meterValue, { color: theme.color }]}>{item.displayValue}</Text>
      </View>

      <View style={[styles.barTrack, { backgroundColor: theme.track }]}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: theme.color }]} />
        <View style={styles.barStripeOverlay} pointerEvents="none">
          {[0, 1, 2, 3, 4, 5, 6].map((stripe) => (
            <View key={stripe} style={styles.barStripe} />
          ))}
        </View>
      </View>
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
      <View style={styles.pitchBanner}>
        <MaterialCommunityIcons name="soccer-field" size={12} color="#15803d" />
        <Text style={styles.pitchBannerText}>Rendimento a partita</Text>
      </View>
      {items.map((item) => (
        <EfficiencyMeter key={item.key} item={item} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 7,
  },
  pitchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#f0fdf4',
    marginBottom: 1,
  },
  pitchBannerText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#15803d',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  meterCard: {
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 9,
    paddingVertical: 7,
    gap: 6,
  },
  meterTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  meterIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meterTextBlock: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  meterLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1e293b',
  },
  pitchMarks: {
    flexDirection: 'row',
    gap: 2,
  },
  pitchMark: {
    width: 10,
    height: 2,
    borderRadius: 1,
  },
  meterValue: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
    minWidth: 40,
    textAlign: 'right',
  },
  barTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    position: 'relative',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  barStripeOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'stretch',
    opacity: 0.18,
  },
  barStripe: {
    width: 1.5,
    backgroundColor: '#fff',
  },
  emptyText: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 6,
  },
});

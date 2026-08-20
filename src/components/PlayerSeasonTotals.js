import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Line } from 'react-native-svg';
import BonusIcon from './BonusIcon';

const OUTFIELD_PRIMARY_KEYS = ['goal', 'assist', 'briso'];
const KEEPER_PRIMARY_KEYS = ['clean_sheet', 'penalty_saved', 'briso'];
const SECONDARY_KEYS = ['yellow_card', 'red_card', 'own_goal', 'penalty_goal', 'penalty_missed'];
const OUTFIELD_EXTRA_KEYS = [];
const KEEPER_EXTRA_KEYS = ['goal', 'assist', 'goals_conceded'];

function MidfieldDecoration({ width, height }) {
  if (!width || !height) return null;
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(30, height * 0.34);

  return (
    <Svg
      pointerEvents="none"
      width={width}
      height={height}
      style={[StyleSheet.absoluteFill, { opacity: 0.34 }]}
    >
      <Line x1={14} y1={cy} x2={width - 14} y2={cy} stroke="#fff" strokeWidth={1.6} />
      <Circle cx={cx} cy={cy} r={r} fill="none" stroke="#fff" strokeWidth={1.6} />
      <Circle cx={cx} cy={cy} r={2.5} fill="#fff" />
    </Svg>
  );
}

function StatCell({ item, size = 'primary', showDivider }) {
  const compact = size === 'secondary';

  return (
    <View style={[styles.cell, compact && styles.cellCompact, showDivider && styles.cellDivider]}>
      <View style={[styles.iconWrap, compact && styles.iconWrapCompact]}>
        <BonusIcon type={item.key} size={compact ? 14 : 17} />
      </View>
      <Text style={[styles.cellValue, compact && styles.cellValueCompact]}>
        {item.value}
      </Text>
      <Text style={[styles.cellLabel, compact && styles.cellLabelCompact]} numberOfLines={1}>
        {item.label}
      </Text>
    </View>
  );
}

function StatsRow({ items, size = 'primary' }) {
  if (!items.length) return null;
  return (
    <View style={[styles.rowCard, size === 'secondary' && styles.rowCardCompact]}>
      {items.map((item, index) => (
        <StatCell
          key={item.key}
          item={item}
          size={size}
          showDivider={index < items.length - 1}
        />
      ))}
    </View>
  );
}

function pickByKeys(list, keys) {
  const byKey = new Map(list.map((item) => [item.key, item]));
  return keys.map((key) => byKey.get(key)).filter(Boolean);
}

export default function PlayerSeasonTotals({ appearances = 0, items = [], isGoalkeeper = false }) {
  const [heroSize, setHeroSize] = useState({ width: 0, height: 0 });
  const list = useMemo(
    () => (Array.isArray(items) ? items : []).filter((item) => item != null),
    [items],
  );

  const primary = useMemo(
    () => pickByKeys(list, isGoalkeeper ? KEEPER_PRIMARY_KEYS : OUTFIELD_PRIMARY_KEYS),
    [list, isGoalkeeper],
  );
  const secondary = useMemo(() => pickByKeys(list, SECONDARY_KEYS), [list]);
  const extra = useMemo(
    () => pickByKeys(list, isGoalkeeper ? KEEPER_EXTRA_KEYS : OUTFIELD_EXTRA_KEYS),
    [list, isGoalkeeper],
  );

  return (
    <View style={styles.wrap}>
      <View
        style={styles.hero}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setHeroSize((prev) => (
            prev.width === width && prev.height === height ? prev : { width, height }
          ));
        }}
      >
        <View style={styles.heroStripe} />
        <MidfieldDecoration width={heroSize.width} height={heroSize.height} />
        <View style={styles.heroBody}>
          <View style={styles.heroLeft}>
            <View style={styles.heroBadge}>
              <MaterialCommunityIcons name="soccer-field" size={18} color="#fff" />
            </View>
            <View style={styles.heroTextCol}>
              <Text style={styles.heroKicker}>In campo</Text>
              <Text style={styles.heroLabel}>Presenze</Text>
            </View>
          </View>
          <Text style={styles.heroValue}>{appearances}</Text>
        </View>
      </View>

      <StatsRow items={primary} size="primary" />
      <StatsRow items={secondary} size="secondary" />
      <StatsRow items={extra} size="secondary" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  hero: {
    borderRadius: 16,
    backgroundColor: '#14532d',
    overflow: 'hidden',
    position: 'relative',
    minHeight: 84,
    justifyContent: 'center',
  },
  heroStripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: '#4ade80',
    zIndex: 2,
  },
  heroBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    paddingLeft: 18,
    zIndex: 1,
  },
  heroLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  heroBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  heroTextCol: {
    gap: 1,
  },
  heroKicker: {
    fontSize: 10,
    fontWeight: '700',
    color: '#86efac',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  heroLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  heroValue: {
    fontSize: 40,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -1,
    lineHeight: 44,
  },
  rowCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8edf3',
    overflow: 'hidden',
  },
  rowCardCompact: {
    borderRadius: 12,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    gap: 4,
  },
  cellCompact: {
    paddingVertical: 8,
    gap: 3,
  },
  cellDivider: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#e2e8f0',
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  iconWrapCompact: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginBottom: 0,
  },
  cellValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.4,
  },
  cellValueCompact: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
  },
  cellLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
  },
  cellLabelCompact: {
    fontSize: 9,
    color: '#94a3b8',
  },
});

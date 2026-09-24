import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import BonusIcon from '../BonusIcon';

const BASE_VOTE = 6;

function toNum(v, fallback = 0) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Cartellino giallo con esempio punti — solo numeri e icone.
 */
export default function SampleScoreTicker({ formData }) {
  const scale = useRef(new Animated.Value(1)).current;

  const { total, parts } = useMemo(() => {
    if (!formData?.enableBonusMalus) {
      return { total: BASE_VOTE, parts: [{ kind: 'vote', amount: BASE_VOTE }] };
    }
    const chunks = [{ kind: 'vote', amount: BASE_VOTE }];
    let sum = BASE_VOTE;
    const push = (enabled, kind, raw) => {
      if (!enabled) return;
      const v = toNum(raw, 0);
      if (v === 0) return;
      chunks.push({ kind, amount: v });
      sum += v;
    };
    push(formData.enableGoal, 'goal', formData.bonusGoal);
    push(formData.enableAssist, 'assist', formData.bonusAssist);
    return { total: Math.round(sum * 10) / 10, parts: chunks };
  }, [
    formData?.enableBonusMalus,
    formData?.enableGoal,
    formData?.bonusGoal,
    formData?.enableAssist,
    formData?.bonusAssist,
  ]);

  useEffect(() => {
    scale.setValue(1.08);
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 140,
      useNativeDriver: true,
    }).start();
  }, [total, scale]);

  if (!formData?.enableBonusMalus) return null;

  return (
    <View style={styles.card}>
      <View style={styles.cardBack}>
        <View style={styles.parts}>
          {parts.map((p, i) => (
            <View key={`${p.kind}-${i}`} style={styles.partChip}>
              {p.kind === 'vote' ? (
                <Text style={styles.voteGlyph}>6</Text>
              ) : (
                <BonusIcon type={p.kind} size={16} />
              )}
              <Text style={styles.partAmount}>
                {p.kind === 'vote' ? '' : `+${p.amount}`}
              </Text>
            </View>
          ))}
        </View>
        <Animated.View style={[styles.totalBox, { transform: [{ scale }] }]}>
          <Text style={styles.total}>
            {Number.isInteger(total) ? total : total.toFixed(1)}
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

/** Cornice colorata senza titoli: verde premi / ambra sanzioni. */
export function RefereePanel({ variant = 'bonus', children }) {
  const isMalus = variant === 'malus';
  return (
    <View style={[styles.panel, isMalus ? styles.panelMalus : styles.panelBonus]}>
      <View style={[styles.panelStripe, isMalus ? styles.stripeMalus : styles.stripeBonus]} />
      <View style={styles.panelInner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 14,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#eab308',
    shadowColor: '#ca8a04',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardBack: {
    backgroundColor: '#facc15',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  parts: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  partChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.45)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  voteGlyph: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1c1917',
  },
  partAmount: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1c1917',
  },
  totalBox: {
    backgroundColor: '#1c1917',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 56,
    alignItems: 'center',
  },
  total: {
    fontSize: 22,
    fontWeight: '900',
    color: '#fff',
  },
  panel: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 14,
    borderWidth: 1,
  },
  panelBonus: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  panelMalus: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  panelStripe: {
    height: 5,
  },
  stripeBonus: { backgroundColor: '#22c55e' },
  stripeMalus: { backgroundColor: '#eab308' },
  panelInner: {
    padding: 10,
  },
});

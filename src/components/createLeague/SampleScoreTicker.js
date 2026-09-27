import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import BonusIcon from '../BonusIcon';

const BASE_VOTE = 6;

/** Eventi campione: rispecchiano i toggle dello step 3. */
const SAMPLE_EVENTS = [
  { enableKey: 'enableGoal', kind: 'goal', valueKey: 'bonusGoal', side: 'bonus' },
  { enableKey: 'enableAssist', kind: 'assist', valueKey: 'bonusAssist', side: 'bonus' },
  { enableKey: 'enablePenaltySaved', kind: 'penalty_saved', valueKey: 'bonusPenaltySaved', side: 'bonus' },
  { enableKey: 'enableCleanSheet', kind: 'clean_sheet', valueKey: 'bonusCleanSheet', side: 'bonus' },
  { enableKey: 'enableBriso', kind: 'briso', valueKey: 'bonusBriso', side: 'bonus' },
  { enableKey: 'enableYellowCard', kind: 'yellow_card', valueKey: 'malusYellowCard', side: 'malus' },
  { enableKey: 'enableRedCard', kind: 'red_card', valueKey: 'malusRedCard', side: 'malus' },
  { enableKey: 'enableGoalsConceded', kind: 'goals_conceded', valueKey: 'malusGoalsConceded', side: 'malus' },
  { enableKey: 'enableOwnGoal', kind: 'own_goal', valueKey: 'malusOwnGoal', side: 'malus' },
  { enableKey: 'enablePenaltyMissed', kind: 'penalty_missed', valueKey: 'malusPenaltyMissed', side: 'malus' },
  { enableKey: 'enablePalloneFuori', kind: 'pallone_fuori', valueKey: 'malusPalloneFuori', side: 'malus' },
  { enableKey: 'enableNoDivisa', kind: 'no_divisa', valueKey: 'malusNoDivisa', side: 'malus' },
];

function toNum(v, fallback = 0) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function formatAmount(amount) {
  const n = Math.round(amount * 10) / 10;
  const abs = Math.abs(n);
  const body = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  if (n > 0) return `+${body}`;
  if (n < 0) return `−${body}`;
  return body;
}

/**
 * Cartellino giallo: voto + bonus/malus attivi → totale.
 */
export default function SampleScoreTicker({ formData }) {
  const scale = useRef(new Animated.Value(1)).current;

  const { total, bonuses, maluses } = useMemo(() => {
    if (!formData?.enableBonusMalus) {
      return { total: BASE_VOTE, bonuses: [], maluses: [] };
    }

    const bonusParts = [];
    const malusParts = [];
    let sum = BASE_VOTE;

    for (const ev of SAMPLE_EVENTS) {
      if (!formData[ev.enableKey]) continue;
      let v = toNum(formData[ev.valueKey], 0);
      if (v === 0) continue;
      if (ev.side === 'malus' && v > 0) v = -v;
      if (ev.side === 'bonus' && v < 0) v = Math.abs(v);
      const part = { kind: ev.kind, amount: v, side: ev.side };
      if (ev.side === 'bonus') bonusParts.push(part);
      else malusParts.push(part);
      sum += v;
    }

    return {
      total: Math.round(sum * 10) / 10,
      bonuses: bonusParts,
      maluses: malusParts,
    };
  }, [formData]);

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

  const formatTotal = Number.isInteger(total) ? String(total) : total.toFixed(1);

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardHeadLabel}>Esempio punteggio</Text>
        <Text style={styles.cardHeadHint}>Voto + eventi della giornata</Text>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.stack}>
          <View style={styles.row}>
            <View style={[styles.chip, styles.chipVote]}>
              <Text style={styles.voteGlyph}>6</Text>
              <Text style={styles.chipMeta}>voto</Text>
            </View>

            {bonuses.map((p) => (
              <View key={`b-${p.kind}`} style={[styles.chip, styles.chipBonus]}>
                <BonusIcon type={p.kind} size={15} />
                <Text style={[styles.chipAmount, styles.amountBonus]}>
                  {formatAmount(p.amount)}
                </Text>
              </View>
            ))}

            {maluses.map((p) => (
              <View key={`m-${p.kind}`} style={[styles.chip, styles.chipMalus]}>
                <BonusIcon type={p.kind} size={15} />
                <Text style={[styles.chipAmount, styles.amountMalus]}>
                  {formatAmount(p.amount)}
                </Text>
              </View>
            ))}
          </View>

          {(bonuses.length === 0 && maluses.length === 0) ? (
            <Text style={styles.emptyHint}>Attiva premi o sanzioni qui sotto</Text>
          ) : null}
        </View>

        <Animated.View style={[styles.totalBox, { transform: [{ scale }] }]}>
          <Text style={styles.totalLabel}>Tot</Text>
          <Text style={styles.total}>{formatTotal}</Text>
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
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#eab308',
    shadowColor: '#ca8a04',
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHead: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardHeadLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1c1917',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  cardHeadHint: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(28,25,23,0.65)',
  },
  cardBody: {
    backgroundColor: '#facc15',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stack: {
    flex: 1,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderWidth: 1,
  },
  chipVote: {
    backgroundColor: 'rgba(28,25,23,0.9)',
    borderColor: 'rgba(28,25,23,0.9)',
    gap: 5,
  },
  chipBonus: {
    backgroundColor: 'rgba(240,253,244,0.92)',
    borderColor: 'rgba(34,197,94,0.45)',
  },
  chipMalus: {
    backgroundColor: 'rgba(254,242,242,0.95)',
    borderColor: 'rgba(239,68,68,0.4)',
  },
  voteGlyph: {
    fontSize: 14,
    fontWeight: '900',
    color: '#facc15',
  },
  chipMeta: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(250,204,21,0.85)',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  chipAmount: {
    fontSize: 12,
    fontWeight: '800',
  },
  amountBonus: {
    color: '#166534',
  },
  amountMalus: {
    color: '#b91c1c',
  },
  emptyHint: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(28,25,23,0.55)',
  },
  totalBox: {
    backgroundColor: '#1c1917',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 58,
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(250,204,21,0.7)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 1,
  },
  total: {
    fontSize: 20,
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

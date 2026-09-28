import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BonusIcon from '../BonusIcon';

const BASE_VOTE = 6;
const ROLE_ORANGE = '#e6a817';
const SLOT = 58;

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

function formatRating(n) {
  const v = Math.round(n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Anteprima come slot in campo in classifica.
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
      const part = { kind: ev.kind, amount: v };
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
    scale.setValue(1.06);
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
      <View style={styles.mainRow}>
        <View style={styles.playerCol}>
          <View style={styles.plate}>
            <Ionicons name="person" size={34} color="rgba(255,255,255,0.92)" />
          </View>
          <View style={styles.namePill}>
            <Text style={styles.namePillText} numberOfLines={1}>
              Rossi
            </Text>
          </View>
          <Animated.View style={[styles.votesPill, { transform: [{ scale }] }]}>
            <Text style={styles.voteBase}>{formatRating(BASE_VOTE)}</Text>
            <View style={styles.voteSep} />
            <Text style={styles.voteFinal}>{formatRating(total)}</Text>
          </Animated.View>
        </View>

        <View style={styles.eventsCol}>
          {(bonuses.length > 0 || maluses.length > 0) ? (
            <View style={styles.eventsInner}>
              <View style={styles.eventRow}>
                {bonuses.length > 0
                  ? bonuses.map((p) => (
                      <View key={`b-${p.kind}`} style={styles.fieldBonusChip}>
                        <BonusIcon type={p.kind} size={22} />
                      </View>
                    ))
                  : <Text style={styles.rowPlaceholder}>—</Text>}
              </View>
              <View style={styles.eventRow}>
                {maluses.length > 0
                  ? maluses.map((p) => (
                      <View key={`m-${p.kind}`} style={styles.fieldBonusChip}>
                        <BonusIcon type={p.kind} size={22} />
                      </View>
                    ))
                  : <Text style={styles.rowPlaceholder}>—</Text>}
              </View>
            </View>
          ) : (
            <Text style={styles.emptyEvents}>Attiva premi o sanzioni qui sotto</Text>
          )}
        </View>
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
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 14,
    paddingHorizontal: 12,
    shadowColor: '#78716c',
    shadowOpacity: 0.08,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  playerCol: {
    alignItems: 'center',
    width: 78,
    gap: 2,
  },
  plate: {
    width: SLOT,
    height: SLOT,
    borderRadius: SLOT / 2,
    backgroundColor: ROLE_ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: ROLE_ORANGE,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 3,
    elevation: 2,
    zIndex: 1,
  },
  namePill: {
    backgroundColor: ROLE_ORANGE,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    minWidth: 64,
    alignItems: 'center',
    maxWidth: 78,
    marginTop: -10,
    zIndex: 3,
    elevation: 4,
  },
  namePillText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  votesPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    marginTop: -4,
    zIndex: 5,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 1.5,
  },
  voteBase: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1c1917',
  },
  voteSep: {
    width: 1,
    height: 11,
    backgroundColor: '#d1d5db',
    marginHorizontal: 5,
  },
  voteFinal: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2e7d32',
  },
  eventsCol: {
    flex: 1,
    justifyContent: 'center',
    minHeight: SLOT + 44,
  },
  eventsInner: {
    gap: 8,
  },
  eventRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  fieldBonusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  rowPlaceholder: {
    fontSize: 11,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  emptyEvents: {
    fontSize: 11,
    fontWeight: '500',
    color: '#94a3b8',
  },
  panel: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 14,
    borderWidth: 1,
  },
  panelBonus: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  panelMalus: {
    backgroundColor: '#faf6f0',
    borderColor: '#e8dfd2',
  },
  panelStripe: {
    height: 5,
  },
  stripeBonus: { backgroundColor: '#166534' },
  stripeMalus: { backgroundColor: '#a16207' },
  panelInner: {
    padding: 10,
  },
});

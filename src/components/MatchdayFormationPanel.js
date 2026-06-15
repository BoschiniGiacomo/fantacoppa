import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { PlayerPhotoImage } from './StableCachedImage';
import BonusIcon from './BonusIcon';
import { formatVoteRating } from '../utils/voteRating';
import { getFormationSlotVisual } from '../utils/formationDisplay';
import { buildFieldSurnameCountMap, getFieldPlayerLabel } from '../utils/fieldPlayerLabel';

const ROLE_COLORS = { P: '#0d6efd', D: '#198754', C: '#e6a817', A: '#dc3545' };
const MINI_FIELD_H = 410;

const ALL_MODULES = {
  '1-1-1': [1, 1, 1], '1-1-2': [1, 1, 2], '1-2-1': [1, 2, 1], '2-1-1': [2, 1, 1],
  '1-2-2': [1, 2, 2], '2-2-1': [2, 2, 1], '2-1-2': [2, 1, 2], '3-1-1': [3, 1, 1],
  '2-2-2': [2, 2, 2], '3-2-1': [3, 2, 1], '2-3-1': [2, 3, 1], '1-3-2': [1, 3, 2], '3-1-2': [3, 1, 2],
  '3-2-2': [3, 2, 2], '2-3-2': [2, 3, 2], '2-2-3': [2, 2, 3], '4-2-1': [4, 2, 1], '3-3-1': [3, 3, 1],
  '3-3-2': [3, 3, 2], '3-2-3': [3, 2, 3], '2-3-3': [2, 3, 3], '4-2-2': [4, 2, 2],
  '3-3-3': [3, 3, 3], '4-2-3': [4, 2, 3], '3-4-2': [3, 4, 2], '5-2-2': [5, 2, 2],
  '4-3-2': [4, 3, 2], '3-5-1': [3, 5, 1], '4-4-1': [4, 4, 1],
  '4-4-2': [4, 4, 2], '4-3-3': [4, 3, 3], '3-5-2': [3, 5, 2], '4-5-1': [4, 5, 1], '5-3-2': [5, 3, 2],
  '5-4-1': [5, 4, 1], '5-2-3': [5, 2, 3], '3-4-3': [3, 4, 3],
};

const midTruncate = (str, max = 8) => {
  if (!str || str.length <= max) return str || '';
  const tail = 3;
  const head = max - tail - 2;
  return str.slice(0, head) + '..' + str.slice(-tail);
};

function buildBonusItems(player, formationData) {
  const items = [];
  if (!formationData?.bonus_enabled) return items;
  const bs = formationData.bonus_settings || {};
  if (player.goals > 0 && bs.enable_goal) items.push({ type: 'goal', count: player.goals });
  if (player.assists > 0 && bs.enable_assist) items.push({ type: 'assist', count: player.assists });
  if (player.yellow_cards > 0 && bs.enable_yellow_card) items.push({ type: 'yellow_card', count: player.yellow_cards });
  if (player.red_cards > 0 && bs.enable_red_card) items.push({ type: 'red_card', count: player.red_cards });
  if (player.goals_conceded > 0 && bs.enable_goals_conceded) items.push({ type: 'goals_conceded', count: player.goals_conceded });
  if (player.own_goals > 0 && bs.enable_own_goal) items.push({ type: 'own_goal', count: player.own_goals });
  if (player.penalty_missed > 0 && bs.enable_penalty_missed) items.push({ type: 'penalty_missed', count: player.penalty_missed });
  if (player.penalty_saved > 0 && bs.enable_penalty_saved) items.push({ type: 'penalty_saved', count: player.penalty_saved });
  if (player.clean_sheet > 0 && bs.enable_clean_sheet) items.push({ type: 'clean_sheet', count: player.clean_sheet });
  if (player.pallone_fuori > 0 && bs.enable_pallone_fuori) items.push({ type: 'pallone_fuori', count: player.pallone_fuori });
  if (player.briso > 0 && bs.enable_briso) items.push({ type: 'briso', count: player.briso });
  if (player.no_divisa > 0 && bs.enable_no_divisa) items.push({ type: 'no_divisa', count: player.no_divisa });
  return items;
}

export default function MatchdayFormationPanel({
  formationData,
  loading = false,
  viewMode = 'field',
  onViewModeChange,
  emptyText = 'Nessuna formazione disponibile per questa giornata.',
}) {
  if (loading) {
    return (
      <View style={styles.formationLoading}>
        <ActivityIndicator size="small" color="#667eea" />
        <Text style={styles.formationLoadingText}>Caricamento...</Text>
      </View>
    );
  }

  if (!formationData?.formation?.length) {
    return <Text style={styles.noFormation}>{emptyText}</Text>;
  }

  const canShowField = formationData.modulo && ALL_MODULES[formationData.modulo];
  const showField = viewMode === 'field' && canShowField;

  return (
    <View>
      {canShowField && onViewModeChange ? (
        <View style={styles.fViewTabs}>
          <TouchableOpacity
            style={[styles.fViewTab, viewMode === 'field' && styles.fViewTabActive]}
            onPress={() => onViewModeChange('field')}
          >
            <MaterialCommunityIcons name="soccer-field" size={20} color={viewMode === 'field' ? '#667eea' : '#bbb'} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.fViewTab, viewMode === 'list' && styles.fViewTabActive]}
            onPress={() => onViewModeChange('list')}
          >
            <Ionicons name="list" size={18} color={viewMode === 'list' ? '#667eea' : '#bbb'} />
          </TouchableOpacity>
        </View>
      ) : null}

      {showField ? (() => {
        const parts = ALL_MODULES[formationData.modulo];
        const [d, c, a] = parts;
        const players = formationData.formation;
        const surnameCountMap = buildFieldSurnameCountMap(
          [{ slots: players }],
          (row) => row.slots
        );
        const rows = [
          { role: 'A', slots: players.slice(1 + d + c, 1 + d + c + a) },
          { role: 'C', slots: players.slice(1 + d, 1 + d + c) },
          { role: 'D', slots: players.slice(1, 1 + d) },
          { role: 'P', slots: [players[0]] },
        ];
        const slotSize = 68;
        return (
          <View style={styles.miniField}>
            <View style={styles.miniFieldCenter} />
            <View style={styles.miniFieldCircle} />
            <View style={styles.miniFieldAreaTop} />
            <View style={styles.miniFieldAreaBottom} />
            {rows.map((row, ri) => {
              const cnt = row.slots.length;
              const topPct = ri === 0 ? 4
                : ri === 1 ? (cnt <= 4 ? 32 : 28)
                : ri === 2 ? 56 : 80;
              const slotMarginH = cnt >= 7 ? -10 : cnt >= 6 ? -8 : cnt >= 5 ? -3 : 0;
              return (
                <View
                  key={ri}
                  style={[
                    styles.miniFieldRow,
                    { top: `${topPct}%` },
                    cnt >= 5 && { justifyContent: 'center', marginHorizontal: 4 },
                    cnt === 4 && { justifyContent: 'center', gap: 2 },
                  ]}
                >
                  {row.slots.map((p, si) => {
                    if (!p) return <View key={si} style={{ width: slotSize, height: slotSize }} />;
                    const vis = getFormationSlotVisual(p);
                    const fieldLabel = getFieldPlayerLabel(vis, surnameCountMap, midTruncate);
                    const roleColor = ROLE_COLORS[vis.role] || '#999';
                    const hasPhoto = !!vis.photo_path;
                    const bonusItems = buildBonusItems(p, formationData);

                    let yOffset = 0;
                    if (cnt >= 5) {
                      const center = (cnt - 1) / 2;
                      const dist = Math.abs(si - center) / center;
                      const up = cnt >= 7 ? -125 : cnt >= 6 ? -115 : -105;
                      const down = cnt >= 7 ? 18 : cnt >= 6 ? 16 : 14;
                      yOffset = Math.round(up * dist + down * (1 - dist));
                    }

                    return (
                      <View
                        key={p.id || si}
                        style={[
                          styles.miniSlotWrap,
                          ...(slotMarginH !== 0 ? [{ marginHorizontal: slotMarginH }] : []),
                          ...(yOffset !== 0 ? [{ marginTop: yOffset }] : []),
                        ]}
                      >
                        <View style={[styles.miniSlotOuter, { width: slotSize, height: slotSize }]}>
                          <View
                            style={[
                              styles.miniSlot,
                              {
                                width: slotSize,
                                height: slotSize,
                                borderRadius: slotSize / 2,
                                borderColor: roleColor,
                                backgroundColor: hasPhoto ? 'transparent' : roleColor,
                              },
                              hasPhoto && { borderWidth: 0 },
                            ]}
                          >
                            {hasPhoto ? (
                              <View
                                style={[
                                  styles.miniSlotPhotoClip,
                                  { width: slotSize, height: slotSize, borderRadius: slotSize / 2 },
                                ]}
                              >
                                <PlayerPhotoImage
                                  photoPath={vis.photo_path}
                                  style={{
                                    width: slotSize * 0.90,
                                    height: slotSize * 0.90,
                                    position: 'absolute',
                                    top: -slotSize * 0.11,
                                  }}
                                />
                              </View>
                            ) : (
                              <>
                                <Text style={styles.miniSlotName} numberOfLines={1}>{fieldLabel}</Text>
                                <Text style={styles.miniSlotTeam} numberOfLines={1}>{midTruncate(vis.team_name, 9)}</Text>
                              </>
                            )}
                            {hasPhoto ? (
                              <View style={[styles.miniSlotNameBadge, { backgroundColor: roleColor }]}>
                                <Text style={styles.miniSlotNameBadgeText} numberOfLines={1}>{fieldLabel}</Text>
                              </View>
                            ) : null}
                          </View>
                          {bonusItems.length > 0 ? (
                            <View style={[styles.fieldBonusCol, cnt === 1 && styles.fieldBonusColGk]}>
                              {bonusItems.map((b, idx) => (
                                <View key={idx} style={styles.fieldBonusChip}>
                                  <BonusIcon type={b.type} size={17} />
                                  {b.count > 1 ? <Text style={styles.fieldBonusCount}>x{b.count}</Text> : null}
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </View>
                        <View style={styles.fieldVotesBox}>
                          <Text style={styles.fieldVoteBase}>{formatVoteRating(p.rating)}</Text>
                          <View style={styles.fieldVoteSep} />
                          <Text style={styles.fieldVoteFinal}>{formatVoteRating(p.final_rating)}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        );
      })() : (
        <View>
          {formationData.formation.map((player, index) => {
            if (!player) {
              return (
                <View key={`empty-${index}`} style={styles.listPlayerRow}>
                  <Text style={{ color: '#bbb', fontStyle: 'italic' }}>-</Text>
                </View>
              );
            }
            const vis = getFormationSlotVisual(player);
            const bonusItems = buildBonusItems(player, formationData);
            return (
              <View key={player.id || index} style={styles.listPlayerRow}>
                <View style={[styles.roleDot, { backgroundColor: ROLE_COLORS[vis.role] || '#999' }]}>
                  <Text style={styles.roleDotText}>{vis.role || '-'}</Text>
                </View>
                <Text style={styles.listPlayerName} numberOfLines={1}>
                  {vis.first_name} {vis.last_name}
                </Text>
                {bonusItems.length > 0 ? (
                  <View style={styles.bonusRow}>
                    {bonusItems.map((b, idx) => (
                      <View key={idx} style={styles.bonusChip}>
                        <BonusIcon type={b.type} size={12} />
                        {b.count > 1 ? <Text style={styles.bonusCount}>×{b.count}</Text> : null}
                      </View>
                    ))}
                  </View>
                ) : null}
                <View style={styles.votesBox}>
                  <Text style={styles.voteBase}>{formatVoteRating(player.rating)}</Text>
                  <Text style={styles.voteSep}>|</Text>
                  <Text style={styles.voteFinal}>{formatVoteRating(player.final_rating)}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
      {formationData.formation_recovered ? (
        <Text style={styles.recoveredFormationNote}>Formazione recuperata dal sistema</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  formationLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  formationLoadingText: { fontSize: 13, color: '#999' },
  noFormation: { fontSize: 13, color: '#999', fontStyle: 'italic', textAlign: 'center', paddingVertical: 14 },
  recoveredFormationNote: {
    marginTop: 8,
    fontSize: 12,
    color: '#666',
    textAlign: 'right',
    fontStyle: 'italic',
  },
  fViewTabs: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  fViewTab: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fViewTabActive: { backgroundColor: '#e8ecff' },
  miniField: {
    height: MINI_FIELD_H,
    backgroundColor: '#2e8b57',
    borderRadius: 8,
    position: 'relative',
    overflow: 'hidden',
    marginHorizontal: -10,
  },
  miniFieldCenter: {
    position: 'absolute',
    top: '49%',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  miniFieldCircle: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    marginLeft: -30,
    marginTop: -30,
  },
  miniFieldAreaTop: {
    position: 'absolute',
    top: 0,
    left: '25%',
    right: '25%',
    height: 30,
    borderWidth: 2,
    borderTopWidth: 0,
    borderColor: 'rgba(255,255,255,0.18)',
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
  },
  miniFieldAreaBottom: {
    position: 'absolute',
    bottom: 0,
    left: '25%',
    right: '25%',
    height: 30,
    borderWidth: 2,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.18)',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  miniFieldRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  miniSlot: {
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  miniSlotName: { color: '#fff', fontWeight: '700', fontSize: 10, textAlign: 'center' },
  miniSlotTeam: { color: 'rgba(255,255,255,0.75)', fontSize: 7, textAlign: 'center', marginTop: 1 },
  miniSlotWrap: { alignItems: 'center', overflow: 'visible' },
  miniSlotOuter: { position: 'relative', overflow: 'visible' },
  miniSlotPhotoClip: { overflow: 'hidden', justifyContent: 'flex-end' },
  miniSlotNameBadge: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 1,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 7,
    alignItems: 'center',
  },
  miniSlotNameBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700', textAlign: 'center' },
  fieldBonusCol: {
    position: 'absolute',
    top: -4,
    left: '100%',
    marginLeft: -10,
    flexDirection: 'column',
    gap: 1,
    alignItems: 'flex-start',
    zIndex: 4,
  },
  fieldBonusColGk: { marginLeft: 6 },
  fieldBonusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 6,
    paddingHorizontal: 2,
    paddingVertical: 1,
  },
  fieldBonusCount: { color: '#333', fontSize: 9, fontWeight: '700', marginLeft: 1 },
  fieldVotesBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 6,
    marginTop: -2,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  fieldVoteBase: { fontSize: 9, fontWeight: '600', color: '#333' },
  fieldVoteSep: { width: 1, height: 10, backgroundColor: '#ccc', marginHorizontal: 3 },
  fieldVoteFinal: { fontSize: 9, fontWeight: '700', color: '#2e7d32' },
  listPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  roleDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  roleDotText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  listPlayerName: { flex: 1, fontSize: 13, fontWeight: '500', color: '#2c3e50' },
  bonusRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginRight: 6 },
  bonusChip: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  bonusCount: { fontSize: 10, color: '#666', fontWeight: '600' },
  votesBox: { flexDirection: 'row', alignItems: 'center', minWidth: 56, justifyContent: 'flex-end' },
  voteBase: { fontSize: 13, fontWeight: '600', color: '#333' },
  voteSep: { fontSize: 12, color: '#ccc', marginHorizontal: 2 },
  voteFinal: { fontSize: 13, fontWeight: '700', color: '#2e7d32' },
});

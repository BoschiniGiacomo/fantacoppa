import React, { memo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BonusIcon from './BonusIcon';
import { formatVoteRating } from '../utils/voteRating';

function VotesPlayerRow({
  player,
  playerVote,
  bonusSettings,
  bonusEnabled,
  onUpdateRating,
  onSetRating,
  onToggleSV,
  onUpdateBonus,
  onIncrementBonus,
  onDecrementBonus,
}) {
  const pv = playerVote || { rating: 0 };
  const isSV = pv.rating === 0;
  const ratingDisplay = isSV ? '' : formatVoteRating(pv.rating, { empty: '' });
  const [editingText, setEditingText] = useState(null);
  const [showRow2, setShowRow2] = useState(false);
  const isEditing = editingText !== null;

  const roleColors = { P: '#0d6efd', D: '#198754', C: '#e6a800', A: '#dc3545' };
  const roleColor = roleColors[player.role] || '#6c757d';

  const handleBlur = () => {
    if (editingText !== null) {
      onSetRating(player.id, editingText);
      setEditingText(null);
    }
  };

  const displayValue = isEditing ? editingText : ratingDisplay;

  return (
    <View style={styles.playerRow}>
      <View style={styles.playerTopRow}>
        <View style={[styles.roleBadgeMini, { backgroundColor: roleColor }]}>
          <Text style={styles.roleBadgeMiniText}>{player.role}</Text>
        </View>
        <Text style={styles.playerName} numberOfLines={1}>
          {player.first_name} {player.last_name}
        </Text>
        <TouchableOpacity
          style={[styles.svBtn, isSV && styles.svBtnActive]}
          onPress={() => onToggleSV(player.id)}
        >
          <Text style={[styles.svBtnText, isSV && styles.svBtnTextActive]}>S.V.</Text>
        </TouchableOpacity>
        <View style={styles.ratingGroup}>
          <TouchableOpacity
            style={[styles.ratingBtn, styles.ratingBtnMinus]}
            onPress={() => onUpdateRating(player.id, -0.25)}
          >
            <Text style={styles.ratingBtnText}>−</Text>
          </TouchableOpacity>
          <TextInput
            style={[styles.ratingInput, isSV && styles.ratingInputSV]}
            value={displayValue}
            onFocus={() => {
              if (isSV) setEditingText('');
              else setEditingText(pv.rating % 1 === 0 ? String(pv.rating) : String(pv.rating));
            }}
            onChangeText={(text) => {
              const t = text.replace(',', '.');
              if (t === '' || /^\d*\.?\d{0,2}$/.test(t)) setEditingText(t);
            }}
            onBlur={handleBlur}
            placeholder={isSV ? 'S.V.' : '6.00'}
            placeholderTextColor={isSV ? '#dc3545' : '#bbb'}
            keyboardType="decimal-pad"
            selectTextOnFocus
          />
          <TouchableOpacity
            style={[styles.ratingBtn, styles.ratingBtnPlus]}
            onPress={() => onUpdateRating(player.id, 0.25)}
          >
            <Text style={styles.ratingBtnText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {bonusEnabled && !isSV && bonusSettings ? (() => {
        const isGK = player.role === 'P';
        const standardItems = isGK
          ? [
              { type: 'toggle', key: 'clean_sheet', enable: 'enable_clean_sheet', field: 'clean_sheet', icon: 'clean_sheet', activeStyle: styles.cardToggleGreenActive },
              { type: 'counter', key: 'goals_conceded', enable: 'enable_goals_conceded', field: 'goals_conceded', icon: 'goals_conceded' },
              { type: 'counter', key: 'penalty_saved', enable: 'enable_penalty_saved', field: 'penalty_saved', icon: 'penalty_saved' },
              { type: 'toggle', key: 'yellow_card', enable: 'enable_yellow_card', field: 'yellow_cards', icon: 'yellow_card', activeStyle: styles.cardToggleYellowActive },
              { type: 'toggle', key: 'red_card', enable: 'enable_red_card', field: 'red_cards', icon: 'red_card', activeStyle: styles.cardToggleRedActive },
              { type: 'counter', key: 'goal', enable: 'enable_goal', field: 'goals', icon: 'goal' },
              { type: 'counter', key: 'assist', enable: 'enable_assist', field: 'assists', icon: 'assist' },
              { type: 'counter', key: 'own_goal', enable: 'enable_own_goal', field: 'own_goals', icon: 'own_goal' },
              { type: 'counter', key: 'penalty_missed', enable: 'enable_penalty_missed', field: 'penalty_missed', icon: 'penalty_missed' },
            ]
          : [
              { type: 'counter', key: 'goal', enable: 'enable_goal', field: 'goals', icon: 'goal' },
              { type: 'counter', key: 'assist', enable: 'enable_assist', field: 'assists', icon: 'assist' },
              { type: 'counter', key: 'own_goal', enable: 'enable_own_goal', field: 'own_goals', icon: 'own_goal' },
              { type: 'toggle', key: 'yellow_card', enable: 'enable_yellow_card', field: 'yellow_cards', icon: 'yellow_card', activeStyle: styles.cardToggleYellowActive },
              { type: 'toggle', key: 'red_card', enable: 'enable_red_card', field: 'red_cards', icon: 'red_card', activeStyle: styles.cardToggleRedActive },
              { type: 'counter', key: 'penalty_missed', enable: 'enable_penalty_missed', field: 'penalty_missed', icon: 'penalty_missed' },
              { type: 'counter', key: 'goals_conceded', enable: 'enable_goals_conceded', field: 'goals_conceded', icon: 'goals_conceded' },
              { type: 'counter', key: 'penalty_saved', enable: 'enable_penalty_saved', field: 'penalty_saved', icon: 'penalty_saved' },
              { type: 'toggle', key: 'clean_sheet', enable: 'enable_clean_sheet', field: 'clean_sheet', icon: 'clean_sheet', activeStyle: styles.cardToggleGreenActive },
            ];

        const extraItems = [
          { type: 'counter', key: 'pallone_fuori', enable: 'enable_pallone_fuori', field: 'pallone_fuori', icon: 'pallone_fuori' },
          { type: 'toggle', key: 'briso', enable: 'enable_briso', field: 'briso', icon: 'briso', activeStyle: styles.cardToggleGreenActive },
          { type: 'toggle', key: 'no_divisa', enable: 'enable_no_divisa', field: 'no_divisa', icon: 'no_divisa', activeStyle: styles.cardToggleRedActive },
        ];

        const enabled = standardItems.filter((item) => Number(bonusSettings[item.enable]) === 1);
        const row3 = extraItems.filter((item) => Number(bonusSettings[item.enable]) === 1);

        const COUNTER_W = 71;
        const TOGGLE_W = 31;
        const EXPAND_W = 27;
        const MAX_ROW_W = 310;
        const MAX_ROW_ITEMS = 5;
        let row1Count = 0;
        let usedWidth = 0;
        for (let i = 0; i < enabled.length && row1Count < MAX_ROW_ITEMS; i += 1) {
          const itemW = enabled[i].type === 'counter' ? COUNTER_W : TOGGLE_W;
          const widthWithExpand = usedWidth + itemW + (i < enabled.length - 1 ? EXPAND_W : 0);
          if (i > 0 && widthWithExpand > MAX_ROW_W) break;
          usedWidth += itemW;
          row1Count += 1;
        }
        if (row1Count >= enabled.length) row1Count = enabled.length;

        const row1 = enabled.slice(0, row1Count);
        const row2 = enabled.slice(row1Count);

        const renderItem = (item) => {
          if (item.type === 'toggle') {
            return (
              <TouchableOpacity
                key={item.key}
                style={[styles.cardToggle, pv[item.field] && item.activeStyle]}
                onPress={() => onUpdateBonus(player.id, item.field, !pv[item.field])}
              >
                <BonusIcon type={item.icon} size={16} inactive={!pv[item.field]} />
              </TouchableOpacity>
            );
          }
          return (
            <View key={item.key} style={styles.bonusInlineItem}>
              <BonusIcon type={item.icon} size={14} />
              <TouchableOpacity style={styles.bonusMiniBtn} onPress={() => onDecrementBonus(player.id, item.field)}>
                <Text style={styles.bonusMiniBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.bonusInlineValue}>{pv[item.field] || 0}</Text>
              <TouchableOpacity style={styles.bonusMiniBtn} onPress={() => onIncrementBonus(player.id, item.field)}>
                <Text style={styles.bonusMiniBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          );
        };

        const row2HasValues = row2.some((item) => pv[item.field] > 0);
        const row3HasValues = row3.some((item) => pv[item.field] > 0);
        const hasExpandable = row2.length > 0 || row3.length > 0;

        return (
          <View>
            <View style={styles.bonusInlineRow}>
              {row1.map(renderItem)}
              {hasExpandable ? (
                <TouchableOpacity style={styles.bonusExpandBtn} onPress={() => setShowRow2(!showRow2)}>
                  <Ionicons name={showRow2 ? 'chevron-up' : 'ellipsis-horizontal'} size={14} color="#999" />
                  {!showRow2 && (row2HasValues || row3HasValues) ? <View style={styles.bonusExpandDot} /> : null}
                </TouchableOpacity>
              ) : null}
            </View>
            {showRow2 && row2.length > 0 ? (
              <View style={styles.bonusInlineRow}>{row2.map(renderItem)}</View>
            ) : null}
            {showRow2 && row3.length > 0 ? (
              <View style={styles.bonusInlineRow}>{row3.map(renderItem)}</View>
            ) : null}
          </View>
        );
      })() : null}
    </View>
  );
}

export default memo(VotesPlayerRow, (prev, next) => (
  prev.playerVote === next.playerVote && prev.bonusEnabled === next.bonusEnabled
));

export const EMPTY_VOTE = {
  rating: 0,
  goals: 0,
  assists: 0,
  yellow_cards: 0,
  red_cards: 0,
  goals_conceded: 0,
  own_goals: 0,
  penalty_missed: 0,
  penalty_saved: 0,
  clean_sheet: 0,
  pallone_fuori: 0,
  briso: 0,
  no_divisa: 0,
};

export function buildRatingsPayload(players, votesMap) {
  const ratings = {};
  (players || []).forEach((player) => {
    const vote = votesMap[player.id] || EMPTY_VOTE;
    const rating = vote.rating !== undefined && vote.rating !== null && vote.rating !== '' ? vote.rating : 0;
    ratings[player.id] = {
      rating,
      goals: vote.goals || 0,
      assists: vote.assists || 0,
      yellow_cards: vote.yellow_cards ? 1 : 0,
      red_cards: vote.red_cards ? 1 : 0,
      goals_conceded: vote.goals_conceded || 0,
      own_goals: vote.own_goals || 0,
      penalty_missed: vote.penalty_missed || 0,
      penalty_saved: vote.penalty_saved || 0,
      clean_sheet: vote.clean_sheet ? 1 : 0,
      pallone_fuori: vote.pallone_fuori || 0,
      briso: vote.briso ? 1 : 0,
      no_divisa: vote.no_divisa ? 1 : 0,
    };
  });
  return ratings;
}

export const DEFAULT_BONUS_SETTINGS = {
  enable_bonus_malus: 1,
  enable_goal: 1,
  enable_assist: 1,
  enable_yellow_card: 1,
  enable_red_card: 1,
  enable_goals_conceded: 1,
  enable_own_goal: 1,
  enable_penalty_missed: 1,
  enable_penalty_saved: 1,
  enable_clean_sheet: 1,
  enable_pallone_fuori: 1,
  enable_briso: 1,
  enable_no_divisa: 1,
};

const styles = StyleSheet.create({
  playerRow: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f2f2f2',
  },
  playerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roleBadgeMini: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBadgeMiniText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 11,
  },
  playerName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    flex: 1,
    minWidth: 0,
  },
  svBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#ddd',
    backgroundColor: '#f9f9f9',
  },
  svBtnActive: {
    backgroundColor: '#fdecea',
    borderColor: '#dc3545',
  },
  svBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#999',
  },
  svBtnTextActive: {
    color: '#dc3545',
  },
  ratingGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
  },
  ratingBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingBtnMinus: {
    backgroundColor: '#dc3545',
  },
  ratingBtnPlus: {
    backgroundColor: '#198754',
  },
  ratingBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: -1,
  },
  ratingInput: {
    width: 52,
    height: 28,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    backgroundColor: '#f9f9f9',
    paddingVertical: 0,
    paddingHorizontal: 2,
    color: '#333',
  },
  ratingInputSV: {
    backgroundColor: '#fef0ef',
    borderColor: '#f5c6cb',
  },
  bonusInlineRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: 8,
    gap: 4,
  },
  bonusInlineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#f8f9fa',
    borderRadius: 6,
    paddingHorizontal: 3,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#eee',
  },
  bonusMiniBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#e9ecef',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bonusMiniBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#555',
    marginTop: -1,
  },
  bonusInlineValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#333',
    minWidth: 12,
    textAlign: 'center',
  },
  bonusExpandBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bonusExpandDot: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#667eea',
  },
  cardToggle: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardToggleYellowActive: {
    borderColor: '#ffc107',
    backgroundColor: '#fff8e1',
  },
  cardToggleRedActive: {
    borderColor: '#dc3545',
    backgroundColor: '#fdecea',
  },
  cardToggleGreenActive: {
    borderColor: '#198754',
    backgroundColor: '#e8f5e9',
  },
});

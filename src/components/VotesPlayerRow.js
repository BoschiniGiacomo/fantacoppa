import React, { memo, useCallback, useEffect, useImperativeHandle, useMemo, useState, forwardRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BonusIcon from './BonusIcon';
import { formatVoteRating, isSvVoteRating, normalizeVoteRating, SV_VOTE_RATING } from '../utils/voteRating';

export const LIVE_DIRECT_VOTE_FIELDS = [
  'goals',
  'assists',
  'own_goals',
  'yellow_cards',
  'red_cards',
  'penalty_missed',
];

const BONUS_ROW_GAP = 5;
const BONUS_EXPAND_BTN_WIDTH = 33;
const RATING_BTN_SIZE = 28;
const RATING_INPUT_WIDTH = 56;
const RATING_INPUT_HEIGHT = 30;
const RATING_GROUP_GAP = 3;
const RATING_GROUP_WIDTH = RATING_BTN_SIZE + RATING_GROUP_GAP + RATING_INPUT_WIDTH + RATING_GROUP_GAP + RATING_BTN_SIZE;

function buildBonusItemLists(player, bonusSettings) {
  const isGK = player.role === 'P';
  const standardItems = isGK
    ? [
        { type: 'toggle', key: 'clean_sheet', enable: 'enable_clean_sheet', field: 'clean_sheet', icon: 'clean_sheet', activeStyle: 'green' },
        { type: 'counter', key: 'goals_conceded', enable: 'enable_goals_conceded', field: 'goals_conceded', icon: 'goals_conceded' },
        { type: 'counter', key: 'penalty_saved', enable: 'enable_penalty_saved', field: 'penalty_saved', icon: 'penalty_saved' },
        { type: 'toggle', key: 'yellow_card', enable: 'enable_yellow_card', field: 'yellow_cards', icon: 'yellow_card', activeStyle: 'yellow' },
        { type: 'toggle', key: 'red_card', enable: 'enable_red_card', field: 'red_cards', icon: 'red_card', activeStyle: 'red' },
        { type: 'counter', key: 'goal', enable: 'enable_goal', field: 'goals', icon: 'goal' },
        { type: 'counter', key: 'assist', enable: 'enable_assist', field: 'assists', icon: 'assist' },
        { type: 'counter', key: 'own_goal', enable: 'enable_own_goal', field: 'own_goals', icon: 'own_goal' },
        { type: 'counter', key: 'penalty_missed', enable: 'enable_penalty_missed', field: 'penalty_missed', icon: 'penalty_missed' },
      ]
    : [
        { type: 'counter', key: 'goal', enable: 'enable_goal', field: 'goals', icon: 'goal' },
        { type: 'counter', key: 'assist', enable: 'enable_assist', field: 'assists', icon: 'assist' },
        { type: 'counter', key: 'own_goal', enable: 'enable_own_goal', field: 'own_goals', icon: 'own_goal' },
        { type: 'toggle', key: 'yellow_card', enable: 'enable_yellow_card', field: 'yellow_cards', icon: 'yellow_card', activeStyle: 'yellow' },
        { type: 'toggle', key: 'red_card', enable: 'enable_red_card', field: 'red_cards', icon: 'red_card', activeStyle: 'red' },
        { type: 'counter', key: 'penalty_missed', enable: 'enable_penalty_missed', field: 'penalty_missed', icon: 'penalty_missed' },
        { type: 'counter', key: 'goals_conceded', enable: 'enable_goals_conceded', field: 'goals_conceded', icon: 'goals_conceded' },
        { type: 'counter', key: 'penalty_saved', enable: 'enable_penalty_saved', field: 'penalty_saved', icon: 'penalty_saved' },
        { type: 'toggle', key: 'clean_sheet', enable: 'enable_clean_sheet', field: 'clean_sheet', icon: 'clean_sheet', activeStyle: 'green' },
      ];

  const extraItems = [
    { type: 'counter', key: 'pallone_fuori', enable: 'enable_pallone_fuori', field: 'pallone_fuori', icon: 'pallone_fuori' },
    { type: 'toggle', key: 'briso', enable: 'enable_briso', field: 'briso', icon: 'briso', activeStyle: 'green' },
    { type: 'toggle', key: 'no_divisa', enable: 'enable_no_divisa', field: 'no_divisa', icon: 'no_divisa', activeStyle: 'red' },
  ];

  const enabled = standardItems.filter((item) => !!Number(bonusSettings[item.enable]));
  const extras = extraItems.filter((item) => !!Number(bonusSettings[item.enable]));
  return [...enabled, ...extras];
}

function isBonusItemVisible(item, pv, liveDirect) {
  const hasValue = item.type === 'toggle' ? !!pv[item.field] : (pv[item.field] || 0) > 0;
  if (liveDirect.has(item.field)) return hasValue;
  return true;
}

function toggleActiveStyle(activeStyle) {
  if (activeStyle === 'yellow') return styles.cardToggleYellowActive;
  if (activeStyle === 'red') return styles.cardToggleRedActive;
  if (activeStyle === 'green') return styles.cardToggleGreenActive;
  return null;
}

function estimateBonusItemWidth(item, pv, liveDirect) {
  const fromLive = liveDirect.has(item.field);
  const val = pv[item.field] || 0;
  if (item.type === 'toggle') return 28;
  if (fromLive) return 46;
  if (val > 0) {
    const digits = String(val).length;
    return 58 + Math.max(0, digits - 1) * 8;
  }
  return 40;
}

function VotesBonusMalusBlock({
  player,
  playerVote,
  liveDirect,
  onUpdateBonus,
  onIncrementBonus,
  onDecrementBonus,
  items,
}) {
  const pv = playerVote || { rating: 0 };
  const [containerWidth, setContainerWidth] = useState(0);
  const [itemWidths, setItemWidths] = useState({});
  const [showOverflow, setShowOverflow] = useState(false);

  const visibleItems = useMemo(
    () => items.filter((item) => isBonusItemVisible(item, pv, liveDirect)),
    [items, pv, liveDirect]
  );

  const visibleSignature = useMemo(
    () => visibleItems.map((item) => `${item.key}:${pv[item.field] || 0}`).join('|'),
    [visibleItems, pv]
  );

  const getItemWidth = useCallback((item) => {
    const measured = itemWidths[item.key];
    const estimate = estimateBonusItemWidth(item, pv, liveDirect);
    if (!measured) return estimate;
    return Math.max(measured, estimate);
  }, [itemWidths, pv, liveDirect]);

  const handleItemMeasure = useCallback((key, width) => {
    const w = Math.ceil(width);
    if (!w) return;
    setItemWidths((prev) => {
      if (prev[key] === w) return prev;
      return { ...prev, [key]: w };
    });
  }, []);

  const layout = useMemo(() => {
    if (!containerWidth || visibleItems.length === 0) {
      return { inline: visibleItems, overflow: [], needsExpand: false };
    }

    const fitCount = (reserveExpandBtn) => {
      let used = reserveExpandBtn ? BONUS_EXPAND_BTN_WIDTH : 0;
      let count = 0;
      for (let i = 0; i < visibleItems.length; i += 1) {
        const w = getItemWidth(visibleItems[i]);
        const gap = count > 0 ? BONUS_ROW_GAP : 0;
        if (used + gap + w <= containerWidth - 1) {
          used += gap + w;
          count += 1;
        } else {
          break;
        }
      }
      return count;
    };

    const fitAll = fitCount(false);
    if (fitAll >= visibleItems.length) {
      return { inline: visibleItems, overflow: [], needsExpand: false };
    }

    let fitWithBtn = fitCount(true);
    if (fitWithBtn < 1) fitWithBtn = 1;

    return {
      inline: visibleItems.slice(0, fitWithBtn),
      overflow: visibleItems.slice(fitWithBtn),
      needsExpand: true,
    };
  }, [containerWidth, visibleItems, getItemWidth, visibleSignature]);

  useEffect(() => {
    if (!layout.needsExpand) setShowOverflow(false);
  }, [layout.needsExpand]);

  const overflowHasValues = layout.overflow.some((item) => (pv[item.field] || 0) > 0);

  const renderItem = (item) => {
    const fromLive = liveDirect.has(item.field);
    const hasValue = item.type === 'toggle' ? !!pv[item.field] : (pv[item.field] || 0) > 0;
    if (fromLive && !hasValue) return null;
    if (fromLive) {
      if (item.type === 'toggle') {
        return (
          <View
            key={item.key}
            style={[styles.cardToggle, styles.cardToggleLocked, pv[item.field] && toggleActiveStyle(item.activeStyle)]}
          >
            <BonusIcon type={item.icon} size={16} inactive={!pv[item.field]} />
          </View>
        );
      }
      return (
        <View key={item.key} style={[styles.bonusInlineItem, styles.bonusInlineItemLocked]}>
          <BonusIcon type={item.icon} size={14} />
          <Text style={styles.bonusInlineValueLocked}>{pv[item.field] || 0}</Text>
        </View>
      );
    }
    if (item.type === 'toggle') {
      return (
        <TouchableOpacity
          key={item.key}
          style={[styles.cardToggle, pv[item.field] && toggleActiveStyle(item.activeStyle)]}
          onPress={() => onUpdateBonus(player.id, item.field, !pv[item.field])}
        >
          <BonusIcon type={item.icon} size={16} inactive={!pv[item.field]} />
        </TouchableOpacity>
      );
    }
    return (
      <View key={item.key} style={styles.bonusInlineItem}>
        <BonusIcon type={item.icon} size={14} />
        {(pv[item.field] || 0) > 0 ? (
          <>
            <TouchableOpacity style={styles.bonusMiniBtn} onPress={() => onDecrementBonus(player.id, item.field)}>
              <Text style={styles.bonusMiniBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.bonusInlineValue}>{pv[item.field] || 0}</Text>
          </>
        ) : null}
        <TouchableOpacity style={styles.bonusMiniBtn} onPress={() => onIncrementBonus(player.id, item.field)}>
          <Text style={styles.bonusMiniBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (visibleItems.length === 0) return null;

  return (
    <View
      style={styles.bonusBlock}
      onLayout={(e) => {
        const w = Math.floor(e.nativeEvent.layout.width);
        if (w > 0 && w !== containerWidth) setContainerWidth(w);
      }}
    >
      <View style={styles.bonusMeasureRow} pointerEvents="none">
        {visibleItems.map((item) => (
          <View
            key={`measure-${item.key}-${pv[item.field] || 0}`}
            style={styles.bonusMeasureItem}
            onLayout={(e) => handleItemMeasure(item.key, e.nativeEvent.layout.width)}
          >
            {renderItem(item)}
          </View>
        ))}
      </View>

      <View style={[styles.bonusInlineRow, styles.bonusMainRow]}>
        {layout.inline.map((item) => renderItem(item))}
        {layout.needsExpand ? (
          <TouchableOpacity
            style={styles.bonusExpandBtn}
            onPress={() => setShowOverflow((v) => !v)}
            hitSlop={6}
          >
            <Ionicons
              name={showOverflow ? 'chevron-up' : 'ellipsis-horizontal'}
              size={16}
              color="#667eea"
            />
            {!showOverflow && overflowHasValues ? <View style={styles.bonusExpandDot} /> : null}
          </TouchableOpacity>
        ) : null}
      </View>

      {showOverflow && layout.overflow.length > 0 ? (
        <View style={[styles.bonusInlineRow, styles.bonusOverflowRow]}>
          {layout.overflow.map((item) => renderItem(item))}
        </View>
      ) : null}
    </View>
  );
}

const VotesPlayerRow = forwardRef(function VotesPlayerRow({
  player,
  playerVote,
  voteUiMode = 'unset',
  bonusSettings,
  bonusEnabled,
  liveDirectFields,
  onUpdateRating,
  onSetRating,
  onActivateND,
  onToggleND,
  enableOfficialSvVote = false,
  onUpdateBonus,
  onIncrementBonus,
  onDecrementBonus,
  inputRef,
  rowRef,
  onSubmitNext,
  onInputFocus,
  isLastInput = false,
}, ref) {
  const pv = playerVote || { rating: 0 };
  const liveDirect = new Set(liveDirectFields || LIVE_DIRECT_VOTE_FIELDS);
  const isCentralNd = voteUiMode === 'saved_nd' || voteUiMode === 'draft_nd';
  const isUnset = voteUiMode === 'unset';
  const hasVote = voteUiMode === 'has_vote';
  const hasSv = voteUiMode === 'has_sv';
  const ratingDisplay = hasVote ? formatVoteRating(pv.rating, { empty: '' }) : '';
  const [editingText, setEditingText] = useState(null);
  const isEditing = editingText !== null;

  useImperativeHandle(ref, () => ({
    getPendingCommit() {
      if (editingText === null) return null;
      return resolveVoteInputCommit(editingText, { enableOfficialSvVote });
    },
    blurInput() {
      inputRef?.current?.blur?.();
    },
  }), [editingText, enableOfficialSvVote, inputRef]);

  const commitEditingText = useCallback(() => {
    if (editingText === null) return;
    const commit = resolveVoteInputCommit(editingText, { enableOfficialSvVote });
    if (!commit) {
      setEditingText(null);
      return;
    }
    if (commit.type === 'nd') {
      onActivateND(player.id);
    } else if (commit.type === 'sv') {
      onSetRating(player.id, SV_VOTE_RATING);
    } else {
      onSetRating(player.id, commit.rating);
    }
    setEditingText(null);
  }, [editingText, enableOfficialSvVote, onActivateND, onSetRating, player.id]);

  const handleRatingStep = useCallback((change) => {
    if (isEditing) {
      const commit = resolveVoteInputCommit(editingText, { enableOfficialSvVote });
      let baseRating = Number(pv.rating || 0);
      if (commit?.type === 'rating') baseRating = commit.rating;
      else if (commit?.type === 'sv') baseRating = SV_VOTE_RATING;
      else if (commit?.type === 'nd') baseRating = 0;

      const nextRating = stepRatingFromValue(baseRating, change, enableOfficialSvVote);
      setEditingText(null);
      onSetRating(player.id, nextRating);
      return;
    }
    onUpdateRating(player.id, change);
  }, [
    isEditing,
    editingText,
    enableOfficialSvVote,
    pv.rating,
    onSetRating,
    onUpdateRating,
    player.id,
  ]);

  const bonusItems = useMemo(
    () => (bonusSettings ? buildBonusItemLists(player, bonusSettings) : []),
    [player, bonusSettings]
  );

  const roleColors = { P: '#0d6efd', D: '#198754', C: '#e6a800', A: '#dc3545' };
  const roleColor = roleColors[player.role] || '#6c757d';

  const handleBlur = () => {
    commitEditingText();
  };

  const handleSubmitEditing = () => {
    handleBlur();
    if (onSubmitNext) onSubmitNext();
  };

  const handleFocus = () => {
    if (isUnset || hasSv) {
      setEditingText('');
    } else {
      setEditingText(pv.rating % 1 === 0 ? String(pv.rating) : String(pv.rating));
    }
    if (onInputFocus) onInputFocus(player.id);
  };

  const displayValue = isEditing
    ? editingText
    : (isUnset
      ? (enableOfficialSvVote ? VOTE_SV_LABEL : VOTE_ND_LABEL)
      : (hasSv ? VOTE_SV_LABEL : ratingDisplay));

  return (
    <View ref={rowRef} style={styles.playerRow}>
      <View style={styles.playerTopRow}>
        <View style={[styles.roleBadgeMini, { backgroundColor: roleColor }]}>
          <Text style={styles.roleBadgeMiniText}>{player.role}</Text>
        </View>
        <Text style={styles.playerName} numberOfLines={1}>
          {player.first_name} {player.last_name}
        </Text>
        {isCentralNd ? (
          <View style={styles.ratingGroup}>
            <View style={styles.ratingBtnSpacer} />
            <TouchableOpacity
              style={[styles.svBtn, styles.svBtnAsInput, styles.svBtnActive]}
              onPress={() => onToggleND(player.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.svBtnText, styles.svBtnTextAsInput, styles.svBtnTextActive]}>{VOTE_ND_LABEL}</Text>
            </TouchableOpacity>
            <View style={styles.ratingBtnSpacer} />
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={styles.svBtn}
              onPress={() => onActivateND(player.id)}
              activeOpacity={0.7}
            >
              <Text style={styles.svBtnText}>{VOTE_ND_LABEL}</Text>
            </TouchableOpacity>
            <View style={styles.ratingGroup}>
              <TouchableOpacity
                style={[styles.ratingBtn, styles.ratingBtnMinus]}
                onPress={() => handleRatingStep(-0.25)}
              >
                <Text style={styles.ratingBtnText}>−</Text>
              </TouchableOpacity>
              <TextInput
                ref={inputRef}
                style={[
                  styles.ratingInput,
                  isUnset && !isEditing && (enableOfficialSvVote ? styles.ratingInputSv : styles.ratingInputUnset),
                  hasSv && !isEditing && styles.ratingInputSv,
                ]}
                value={displayValue}
                onFocus={handleFocus}
                onChangeText={(text) => {
                  const t = text.replace(',', '.');
                  if (enableOfficialSvVote && /^[sSvV.\s]*$/i.test(t)) {
                    setEditingText(t);
                    return;
                  }
                  if (t === '' || /^\d*\.?\d{0,2}$/.test(t)) setEditingText(t);
                }}
                onBlur={handleBlur}
                placeholder={isUnset ? undefined : '6.00'}
                placeholderTextColor="#bbb"
                keyboardType="decimal-pad"
                returnKeyType={isLastInput ? 'done' : 'next'}
                onSubmitEditing={handleSubmitEditing}
                blurOnSubmit={false}
                selectTextOnFocus
              />
              <TouchableOpacity
                style={[styles.ratingBtn, styles.ratingBtnPlus]}
                onPress={() => handleRatingStep(0.25)}
              >
                <Text style={styles.ratingBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {bonusEnabled && hasVote && bonusSettings ? (
        <VotesBonusMalusBlock
          player={player}
          playerVote={pv}
          liveDirect={liveDirect}
          items={bonusItems}
          onUpdateBonus={onUpdateBonus}
          onIncrementBonus={onIncrementBonus}
          onDecrementBonus={onDecrementBonus}
        />
      ) : null}
    </View>
  );
});

export default memo(VotesPlayerRow, (prev, next) => (
  prev.playerVote === next.playerVote
  && prev.voteUiMode === next.voteUiMode
  && prev.bonusEnabled === next.bonusEnabled
  && prev.liveDirectFields === next.liveDirectFields
  && prev.isLastInput === next.isLastInput
));

export const VOTE_ND_LABEL = 'N.D.';
export const VOTE_SV_LABEL = 'S.V.';

/** Testo campo voto che significa non disponibile (solo N.D. esplicito, non stringa vuota). */
export function isVoteNdInputText(text) {
  const t = String(text || '').trim().toUpperCase();
  return (
    t === 'N.D.'
    || t === 'N.D'
    || t === 'ND'
  );
}

/** Testo campo voto che significa S.V. (senza voto ufficiale). */
export function isVoteSvInputText(text) {
  const t = String(text || '').trim().toUpperCase();
  return t === 'S.V.' || t === 'S.V' || t === 'SV';
}

/** Interpreta testo ancora non committato nel campo voto. */
export function resolveVoteInputCommit(text, { enableOfficialSvVote = false } = {}) {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim();
  // Campo lasciato vuoto: non forzare N.D., resta il valore precedente (es. S.V.)
  if (!raw) return null;
  if (isVoteNdInputText(raw)) return { type: 'nd' };
  if (enableOfficialSvVote && isVoteSvInputText(raw)) return { type: 'sv' };
  let rating = parseFloat(raw.replace(',', '.'));
  if (Number.isNaN(rating)) return null;
  if (isSvVoteRating(rating)) return { type: 'sv' };
  if (rating < 1) rating = 0;
  if (rating > 10) rating = 10;
  if (!isSvVoteRating(rating)) rating = normalizeVoteRating(rating);
  return { type: 'rating', rating };
}

export function applyVoteInputCommitToVote(current, commit) {
  const base = current || EMPTY_VOTE;
  if (!commit) return base;
  if (commit.type === 'nd') {
    const cleared = { ...EMPTY_VOTE };
    LIVE_DIRECT_VOTE_FIELDS.forEach((field) => {
      cleared[field] = base[field];
    });
    return cleared;
  }
  const rating = commit.type === 'sv' ? SV_VOTE_RATING : commit.rating;
  const zeroBonus = rating === 0 || isSvVoteRating(rating);
  return {
    ...base,
    rating,
    goals: zeroBonus ? 0 : base.goals,
    assists: zeroBonus ? 0 : base.assists,
    yellow_cards: zeroBonus ? 0 : base.yellow_cards,
    red_cards: zeroBonus ? 0 : base.red_cards,
  };
}

function stepRatingFromValue(currentRating, change, enableOfficialSvVote) {
  const r = Number(currentRating || 0);

  if (isSvVoteRating(r)) {
    if (change < 0) return 0;
    if (change > 0) return 1;
    return r;
  }

  if (r === 0) {
    if (change < 0) return r;
    return enableOfficialSvVote ? SV_VOTE_RATING : 6;
  }

  let nr = normalizeVoteRating(r + change);
  if (nr < 1) {
    if (enableOfficialSvVote && Math.abs(r - 1) < 0.001) {
      nr = SV_VOTE_RATING;
    } else {
      nr = 0;
    }
  }
  if (nr > 10) nr = 10;
  return nr;
}

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
    const vote = votesMap[player.id] || votesMap[String(player.id)] || EMPTY_VOTE;
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
    paddingHorizontal: 4,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f2f2f2',
    width: '100%',
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
    flexShrink: 0,
  },
  svBtnAsInput: {
    width: RATING_INPUT_WIDTH,
    height: RATING_INPUT_HEIGHT,
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  svBtnActive: {
    backgroundColor: '#fdecea',
    borderColor: '#dc3545',
  },
  svBtnActiveSv: {
    backgroundColor: '#fff8e1',
    borderColor: '#e6a800',
  },
  svBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#999',
  },
  svBtnTextAsInput: {
    fontSize: 13,
    fontWeight: '800',
  },
  svBtnTextActive: {
    color: '#dc3545',
  },
  svBtnTextActiveSv: {
    color: '#b8860b',
  },
  ratingGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: RATING_GROUP_GAP,
    flexShrink: 0,
    width: RATING_GROUP_WIDTH,
  },
  ratingBtn: {
    width: RATING_BTN_SIZE,
    height: RATING_BTN_SIZE,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingBtnSpacer: {
    width: RATING_BTN_SIZE,
    height: RATING_BTN_SIZE,
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
    width: RATING_INPUT_WIDTH,
    height: RATING_INPUT_HEIGHT,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    backgroundColor: '#f9f9f9',
    paddingVertical: 0,
    paddingHorizontal: 2,
    color: '#333',
  },
  ratingInputUnset: {
    color: '#999',
    fontWeight: '800',
  },
  ratingInputSv: {
    color: '#b8860b',
    fontWeight: '800',
    backgroundColor: '#fff8e1',
    borderColor: '#e6a800',
  },
  bonusBlock: {
    width: '100%',
    marginTop: 2,
    position: 'relative',
  },
  bonusMeasureRow: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    zIndex: -1,
  },
  bonusMeasureItem: {
    flexShrink: 0,
  },
  bonusInlineRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: 6,
    gap: BONUS_ROW_GAP,
    width: '100%',
  },
  bonusOverflowRow: {
    flexWrap: 'wrap',
  },
  bonusMainRow: {
    overflow: 'hidden',
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
    flexShrink: 0,
  },
  bonusInlineItemLocked: {
    backgroundColor: '#f5f3ff',
    borderColor: '#ddd6fe',
    paddingHorizontal: 6,
    paddingVertical: 3,
    gap: 4,
  },
  bonusInlineValueLocked: {
    fontSize: 12,
    fontWeight: '800',
    color: '#5b21b6',
    minWidth: 12,
    textAlign: 'center',
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
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
    flexShrink: 0,
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
    flexShrink: 0,
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
  cardToggleLocked: {
    borderColor: '#ddd6fe',
    backgroundColor: '#faf5ff',
  },
});

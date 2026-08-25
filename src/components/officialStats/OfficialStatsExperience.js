import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeInDown,
  LinearTransition,
} from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';
import { PlayerPhotoImage, TeamLogoImage } from '../StableCachedImage';
import BonusIcon from '../BonusIcon';
import { parseAppDate } from '../../utils/dateTime';
import { buildCompetitionRanks, formatCompetitionRank } from '../../utils/standingsRanking';
import { matchesService } from '../../services/api';

export const ABSOLUTE_STATS_KEY = 'absolute';
export const STATS_LEADERBOARD_PREVIEW = 5;

const MEDAL = {
  1: { bg: '#fef3c7', fg: '#b45309' },
  2: { bg: '#e2e8f0', fg: '#475569' },
  3: { bg: '#ffedd5', fg: '#c2410c' },
};

function formatStatAvg(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0,00';
  return v.toFixed(2).replace('.', ',');
}

const MONTH_SHORT_IT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

function parseHighlightDate(value) {
  const d = parseAppDate(value);
  if (d) return d;
  const m = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const parsed = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatHighlightDate(value) {
  const d = parseHighlightDate(value);
  if (!d) return '';
  const day = String(d.getDate()).padStart(2, '0');
  return `${day} ${MONTH_SHORT_IT[d.getMonth()]} ${d.getFullYear()}`;
}

function formatStreakRange(startedAt, endedAt, { stacked = false } = {}) {
  const start = formatHighlightDate(startedAt);
  const end = formatHighlightDate(endedAt);
  if (!start && !end) return '';
  if (start && end && start === end) return start;
  if (start && end) return stacked ? `${start}\n–\n${end}` : `${start} – ${end}`;
  return start || end;
}

function normalizeQuery(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function rowMatchesQuery(row, query, includeTeam = true) {
  if (!query) return true;
  const hay = includeTeam
    ? normalizeQuery(`${row?.name || ''} ${row?.team_name || ''}`)
    : normalizeQuery(row?.name || '');
  return hay.includes(query);
}

function stripBirthYearNameSuffix(name) {
  return String(name || '').replace(/\s*\('\d{2}\)\s*$/u, '').trim();
}

function birthYearCardLabel(name) {
  const match = String(name || '').match(/\('(\d{2})\)\s*$/u);
  return match ? `${match[1]}'` : '';
}

function playerInitials(name) {
  const parts = stripBirthYearNameSuffix(name)
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

function PlayerAvatar({ photoPath, name, accent, size = 56 }) {
  const radius = Math.round(size / 2);
  const path = String(photoPath || '').trim();
  const fallbackStyle = {
    width: size,
    height: size,
    borderRadius: radius,
    backgroundColor: `${accent || '#667eea'}18`,
    alignItems: 'center',
    justifyContent: 'center',
  };
  if (path) {
    return (
      <PlayerPhotoImage
        photoPath={path}
        style={{ width: size, height: size, borderRadius: radius }}
        resizeMode="cover"
        fallbackStyle={fallbackStyle}
        fallbackIcon="person-outline"
        fallbackIconSize={Math.round(size * 0.42)}
        fallbackColor={accent || '#667eea'}
      />
    );
  }
  return (
    <View style={fallbackStyle}>
      <Text style={{ fontSize: Math.round(size * 0.32), fontWeight: '800', color: accent || '#667eea' }}>
        {playerInitials(name)}
      </Text>
    </View>
  );
}

function IconGlyph({ pack = 'ion', name, size = 16, color }) {
  if (pack === 'mci') {
    return <MaterialCommunityIcons name={name} size={size} color={color} />;
  }
  return <Ionicons name={name} size={size} color={color} />;
}

function BoardGlyph({ board, size = 15, color, framed = false }) {
  const glyph = board?.bonusType ? (
    <BonusIcon type={board.bonusType} size={size} />
  ) : (
    <IconGlyph pack={board?.pack} name={board?.icon} size={size} color={color} />
  );
  if (!framed) return glyph;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: size + 4,
          height: size + 4,
          borderRadius: (size + 4) / 2,
          backgroundColor: '#fff',
        }}
      />
      {glyph}
    </View>
  );
}

function RankBadge({ rank }) {
  const medal = MEDAL[rank];
  const label = formatCompetitionRank(rank);
  const wide = String(label).length > 3;
  return (
    <View
      style={[
        styles.rankBadge,
        wide ? styles.rankBadgeWide : styles.rankBadgeCircle,
        medal ? { backgroundColor: medal.bg } : styles.rankBadgePlain,
      ]}
    >
      <Text
        style={[styles.rankBadgeText, medal && { color: medal.fg }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const PERIOD_MENU_MAX_HEIGHT = 220;

function PeriodSelector({ years, selectedYear, onSelectYear, showAbsolute = true, style }) {
  const [open, setOpen] = useState(false);
  const [menuLayout, setMenuLayout] = useState(null);
  const anchorRef = useRef(null);
  const yearList = Array.isArray(years) ? years : [];
  const isAbsolute = showAbsolute && selectedYear === ABSOLUTE_STATS_KEY;
  const selectedYearLabel = !isAbsolute && selectedYear != null
    ? String(selectedYear)
    : (showAbsolute ? String(yearList[0] || 'Anno') : 'Seleziona anno');

  useEffect(() => {
    setOpen(false);
    setMenuLayout(null);
  }, [selectedYear]);

  useEffect(() => {
    if (!open) {
      setMenuLayout(null);
      return undefined;
    }
    let cancelled = false;
    const measure = () => {
      if (!anchorRef.current) return;
      anchorRef.current.measureInWindow((x, y, width, height) => {
        if (cancelled) return;
        setMenuLayout({ left: x, top: y + height + 4, width });
      });
    };
    measure();
    const retry = setTimeout(measure, 64);
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [open, yearList.length]);

  const openYearMenu = () => {
    if (yearList.length === 0) return;
    setOpen((v) => !v);
  };

  return (
    <View ref={anchorRef} style={[styles.periodWrap, style]} collapsable={false}>
      <View style={styles.periodControl}>
        {showAbsolute ? (
          <>
            <TouchableOpacity
              style={[styles.periodSeg, isAbsolute && styles.periodSegActive]}
              onPress={() => onSelectYear?.(ABSOLUTE_STATS_KEY)}
              activeOpacity={0.8}
            >
              <Text style={[styles.periodSegText, isAbsolute && styles.periodSegTextActive]}>Assolute</Text>
            </TouchableOpacity>
            <View style={styles.periodDivider} />
          </>
        ) : null}
        <TouchableOpacity
          style={[styles.periodSeg, styles.periodSegYear, !isAbsolute && styles.periodSegActive]}
          onPress={openYearMenu}
          activeOpacity={0.8}
          disabled={yearList.length === 0}
        >
          <Text style={[styles.periodSegText, !isAbsolute && styles.periodSegTextActive]}>
            {selectedYearLabel}
          </Text>
          {yearList.length > 0 ? (
            <Ionicons
              name={open ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={!isAbsolute ? '#4f46e5' : '#64748b'}
            />
          ) : null}
        </TouchableOpacity>
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.periodMenuRoot}>
          <Pressable
            style={styles.periodMenuBackdrop}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Chiudi selezione anno"
          />
          {menuLayout ? (
            <View
              style={[
                styles.periodMenu,
                { top: menuLayout.top, left: menuLayout.left, width: menuLayout.width },
              ]}
            >
              <ScrollView
                style={styles.periodMenuScroll}
                contentContainerStyle={styles.periodMenuScrollContent}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
                bounces={false}
                nestedScrollEnabled
              >
                {yearList.map((y, idx) => {
                  const active = !isAbsolute && Number(selectedYear) === Number(y);
                  return (
                    <TouchableOpacity
                      key={`period-year-${y}`}
                      style={[
                        styles.periodMenuItem,
                        idx === yearList.length - 1 && styles.periodMenuItemLast,
                        active && styles.periodMenuItemActive,
                      ]}
                      onPress={() => {
                        setOpen(false);
                        onSelectYear?.(Number(y));
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.periodMenuItemText, active && styles.periodMenuItemTextActive]}>
                        {String(y)}
                      </Text>
                      {active ? <Ionicons name="checkmark" size={16} color="#4f46e5" /> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

export { PeriodSelector as StatsPeriodSelector };

function StatsSearchBar({ value, onChange, placeholder }) {
  return (
    <View style={styles.searchWrap}>
      <Ionicons name="search" size={16} color="#94a3b8" />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        style={styles.searchInput}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
      />
      {value ? (
        <TouchableOpacity onPress={() => onChange('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close-circle" size={16} color="#94a3b8" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function TrendingPlayersStrip({ competitionId, visible, onPressPlayer, showTeamName = true }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!visible) return undefined;
    const cid = Number(competitionId);
    if (!Number.isFinite(cid) || cid <= 0) {
      setPlayers([]);
      return undefined;
    }

    seqRef.current += 1;
    const seq = seqRef.current;
    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        const res = await matchesService.getTrendingPlayers(cid);
        if (cancelled || seq !== seqRef.current) return;
        setPlayers(Array.isArray(res?.data?.players) ? res.data.players : []);
      } catch (_) {
        if (cancelled || seq !== seqRef.current) return;
        setPlayers([]);
      } finally {
        if (!cancelled && seq === seqRef.current) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [visible, competitionId]);

  if (!visible) return null;
  if (loading) {
    return (
      <View style={styles.trendingWrap}>
        <Text style={styles.trendingLabel}>Più cercati</Text>
        <ActivityIndicator size="small" color="#667eea" style={styles.trendingSpinner} />
      </View>
    );
  }
  if (!players.length) return null;

  return (
    <View style={styles.trendingWrap}>
      <Text style={styles.trendingLabel}>Più cercati</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.trendingRow}
        keyboardShouldPersistTaps="handled"
      >
        {players.map((player) => {
          const pid = Number(player?.player_id);
          return (
            <TouchableOpacity
              key={`trend-${pid}-${player?.league_id}`}
              style={styles.trendingChip}
              activeOpacity={0.78}
              onPress={() => onPressPlayer?.(player)}
            >
              <PlayerPhotoImage
                photoPath={player?.photo_path || undefined}
                style={styles.trendingPhoto}
                fallbackStyle={styles.trendingPhotoFallback}
                fallbackIconSize={12}
              />
              <View style={styles.trendingMeta}>
                <Text style={styles.trendingName} numberOfLines={1}>{String(player?.name || '').trim()}</Text>
                {showTeamName && player?.team_name ? (
                  <Text style={styles.trendingTeam} numberOfLines={1}>{player.team_name}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function CategoryChips({ boards, selectedKey, onSelect }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.hScroll, styles.catScroll]}
      contentContainerStyle={styles.chipRow}
      keyboardShouldPersistTaps="handled"
    >
      {boards.map((board) => {
        const active = board.key === selectedKey;
        const count = Array.isArray(board.items) ? board.items.length : 0;
        return (
          <TouchableOpacity
            key={board.key}
            style={[
              styles.catChip,
              active && { backgroundColor: board.accent, borderColor: board.accent },
            ]}
            onPress={() => onSelect(board.key)}
            activeOpacity={0.8}
          >
            <BoardGlyph
              board={board}
              size={14}
              color={active ? '#fff' : board.accent}
              framed={active && board.keepIconOnWhite}
            />
            <Text style={[styles.catChipText, active && styles.catChipTextActive]}>
              {board.shortLabel || board.label}
            </Text>
            {count > 0 ? (
              <View style={[styles.catCount, active && styles.catCountActive]}>
                <Text style={[styles.catCountText, active && styles.catCountTextActive]}>{count}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function LeaderboardList({
  board,
  expanded,
  onToggleExpand,
  onPressPlayer,
  query,
  includeTeam = true,
  animKey,
}) {
  const list = Array.isArray(board.items) ? board.items : [];
  const filtered = query ? list.filter((row) => rowMatchesQuery(row, query, includeTeam)) : list;
  if (filtered.length === 0) {
    return <Text style={styles.emptyText}>{query ? 'Nessun risultato per la ricerca.' : board.empty}</Text>;
  }
  const canExpand = !query && filtered.length > STATS_LEADERBOARD_PREVIEW;
  const visible = query || expanded || !canExpand
    ? filtered
    : filtered.slice(0, STATS_LEADERBOARD_PREVIEW);
  const ranks = buildCompetitionRanks(list);
  const indexByIdentity = new Map();
  list.forEach((row, idx) => {
    const id = Number(row?.cluster_id) > 0
      ? `c-${row.cluster_id}`
      : (Number(row?.player_id) > 0 ? `p-${row.player_id}` : `n-${row?.name}-${idx}`);
    indexByIdentity.set(id, idx);
  });

  return (
    <Animated.View layout={LinearTransition.duration(220)} style={styles.boardCard}>
      {visible.map((row, i) => {
        const playerName = String(row?.name || '-');
        const teamName = String(row?.team_name || '').trim();
        const playerId = Number(row?.player_id);
        const clusterId = Number(row?.cluster_id);
        const identity = clusterId > 0
          ? `c-${clusterId}`
          : (playerId > 0 ? `p-${playerId}` : `n-${playerName}-${i}`);
        const sourceIndex = indexByIdentity.has(identity) ? indexByIdentity.get(identity) : i;
        const rank = ranks[sourceIndex] || sourceIndex + 1;
        const value = Number(row?.value || 0);
        const canOpen = playerId > 0;
        const isLast = i === visible.length - 1 && !canExpand;
        return (
          <Animated.View
            key={`${animKey}-${identity}`}
            entering={i < STATS_LEADERBOARD_PREVIEW
              ? FadeInDown.delay(Math.min(i, 6) * 40).duration(280)
              : undefined}
          >
            <TouchableOpacity
              style={[styles.lbRow, isLast && styles.lbRowLast]}
              activeOpacity={canOpen ? 0.72 : 1}
              disabled={!canOpen}
              onPress={() => onPressPlayer?.(row)}
            >
              <RankBadge rank={rank} />
              <View style={styles.lbMain}>
                <Text style={styles.lbName} numberOfLines={1}>{playerName}</Text>
                {teamName ? <Text style={styles.lbTeam} numberOfLines={1}>{teamName}</Text> : null}
              </View>
              <Text style={styles.lbValue}>{value}</Text>
            </TouchableOpacity>
          </Animated.View>
        );
      })}
      {canExpand ? (
        <TouchableOpacity style={styles.expandBtn} onPress={onToggleExpand} activeOpacity={0.75}>
          <Text style={styles.expandText}>
            {expanded ? 'Mostra meno' : `Altri ${filtered.length - STATS_LEADERBOARD_PREVIEW}`}
          </Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#0f172a" />
        </TouchableOpacity>
      ) : null}
    </Animated.View>
  );
}

function TeaserStrip({ boards, onSelect, showTeamName = true }) {
  const teasers = boards
    .map((board) => {
      const top = Array.isArray(board.items) && board.items[0] ? board.items[0] : null;
      return top ? { board, top } : null;
    })
    .filter(Boolean);
  if (teasers.length === 0) return null;
  return (
    <View style={styles.teaserBlock}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.teaserRow}
        keyboardShouldPersistTaps="handled"
      >
        {teasers.map(({ board, top }, idx) => {
          const playerName = String(top.name || '-');
          const displayName = stripBirthYearNameSuffix(playerName) || '-';
          const yearLabel = birthYearCardLabel(playerName);
          const teamName = String(top.team_name || '').trim();
          const value = Number(top.value || 0);
          return (
            <Animated.View
              key={`teaser-${board.key}`}
              entering={FadeInDown.delay(idx * 35).duration(260)}
            >
              <TouchableOpacity
                style={styles.teaserCard}
                onPress={() => onSelect(board.key)}
                activeOpacity={0.82}
              >
                <View style={styles.teaserCatRow}>
                  <View style={[styles.teaserCatBadge, { backgroundColor: `${board.accent}18` }]}>
                    <BoardGlyph board={board} size={13} color={board.accent} />
                  </View>
                  <Text style={styles.teaserLabel} numberOfLines={1}>
                    {board.shortLabel || board.label}
                  </Text>
                </View>
                <View style={styles.teaserHero}>
                  <View style={styles.teaserPhotoWrap}>
                    {String(top.photo_path || '').trim() ? (
                      <View style={styles.teaserPhotoBleed} pointerEvents="none">
                        <PlayerAvatar
                          photoPath={top.photo_path}
                          name={displayName}
                          accent={board.accent}
                          size={72}
                        />
                      </View>
                    ) : (
                      <PlayerAvatar
                        photoPath={top.photo_path}
                        name={displayName}
                        accent={board.accent}
                        size={56}
                      />
                    )}
                    {yearLabel ? (
                      <View style={styles.teaserYearBadge}>
                        <Text style={styles.teaserYearBadgeText}>{yearLabel}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.teaserValue, { color: board.accent }]}>{value}</Text>
                </View>
                <Text
                  style={styles.teaserName}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                >
                  {displayName}
                </Text>
                {showTeamName && teamName ? (
                  <Text style={styles.teaserTeam} numberOfLines={1}>{teamName}</Text>
                ) : null}
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function GroupHighlights({ highlights, onPressTeam, onPressMatch }) {
  const h = highlights || {};
  const topMatch = h.highest_scoring_match || null;
  const attack = h.best_attack || null;
  const defense = h.best_defense || null;
  const hasAttackDefense = !!(attack || defense);
  const winStreak = h.longest_win_streak || null;
  const unbeatenStreak = h.longest_unbeaten_streak || null;
  const lossStreak = h.longest_loss_streak || null;
  const hasStreaks = !!(winStreak || unbeatenStreak || lossStreak);
  const miniDefs = [
    { key: 'yellow', bonusType: 'yellow_card', label: 'Gialli', src: h.most_yellow_cards },
    { key: 'red', bonusType: 'red_card', label: 'Rossi', src: h.most_red_cards },
    { key: 'pen-for', bonusType: 'penalty_goal', label: 'Rigori\na favore', src: h.most_penalties_for },
    { key: 'pen-against', bonusType: 'penalty_missed', label: 'Rigori\na sfavore', src: h.most_penalties_against },
  ];
  const hasMini = miniDefs.some((item) => item.src);
  if (!topMatch && !hasAttackDefense && !hasMini && !hasStreaks) {
    return <Text style={styles.emptyText}>Nessuna statistica di squadra disponibile.</Text>;
  }
  const matchId = Number(topMatch?.match_id);
  return (
    <View>
      <Text style={styles.sectionEyebrow}>Squadre</Text>
      {hasAttackDefense ? (
        <Animated.View
          entering={FadeInDown.delay(20).duration(280)}
          style={[styles.streakPanel, !topMatch && { marginTop: 0 }]}
        >
          <StreakCell
            bonusType="goal"
            value={attack ? formatStatAvg(attack.avg) : '–'}
            valueColor={attack ? '#0f172a' : '#94a3b8'}
            label="Miglior attacco"
            detail={attack
              ? `${Number(attack.goals || 0)} gol · ${Number(attack.played || 0)} partite`
              : null}
            teamName={attack?.team_name}
            logoUrl={attack?.team_logo_url}
            logoPath={attack?.team_logo_path}
            onPress={Number(attack?.team_id) > 0
              ? () => onPressTeam?.(Number(attack.team_id), attack.team_name)
              : null}
            showDivider
          />
          <StreakCell
            bonusType="goals_conceded"
            value={defense ? formatStatAvg(defense.avg) : '–'}
            valueColor={defense ? '#0f172a' : '#94a3b8'}
            label="Miglior difesa"
            detail={defense
              ? `${Number(defense.goals_conceded || 0)} subiti · ${Number(defense.played || 0)} partite`
              : null}
            teamName={defense?.team_name}
            logoUrl={defense?.team_logo_url}
            logoPath={defense?.team_logo_path}
            onPress={Number(defense?.team_id) > 0
              ? () => onPressTeam?.(Number(defense.team_id), defense.team_name)
              : null}
          />
        </Animated.View>
      ) : null}
      {hasStreaks ? (
        <Animated.View
          entering={FadeInDown.delay(40).duration(280)}
          style={[styles.streakPanel, !topMatch && !hasAttackDefense && { marginTop: 0 }]}
        >
          <StreakCell
            compact
            icon="flame"
            color="#16a34a"
            value={winStreak && Number(winStreak.value || 0) > 0 ? String(Number(winStreak.value)) : '–'}
            valueColor={winStreak && Number(winStreak.value || 0) > 0 ? '#16a34a' : '#94a3b8'}
            label={"Vittorie\ndi fila"}
            detail={winStreak && Number(winStreak.value || 0) > 0
              ? formatStreakRange(winStreak.started_at, winStreak.ended_at, { stacked: true })
              : null}
            teamName={winStreak?.team_name}
            logoUrl={winStreak?.team_logo_url}
            logoPath={winStreak?.team_logo_path}
            onPress={Number(winStreak?.team_id) > 0
              ? () => onPressTeam?.(Number(winStreak.team_id), winStreak.team_name)
              : null}
            showDivider
          />
          <StreakCell
            compact
            icon="shield-checkmark"
            color="#0f766e"
            value={unbeatenStreak && Number(unbeatenStreak.value || 0) > 0 ? String(Number(unbeatenStreak.value)) : '–'}
            valueColor={unbeatenStreak && Number(unbeatenStreak.value || 0) > 0 ? '#0f766e' : '#94a3b8'}
            label={"Striscia di\nimbattibilità"}
            detail={unbeatenStreak && Number(unbeatenStreak.value || 0) > 0
              ? formatStreakRange(unbeatenStreak.started_at, unbeatenStreak.ended_at, { stacked: true })
              : null}
            teamName={unbeatenStreak?.team_name}
            logoUrl={unbeatenStreak?.team_logo_url}
            logoPath={unbeatenStreak?.team_logo_path}
            onPress={Number(unbeatenStreak?.team_id) > 0
              ? () => onPressTeam?.(Number(unbeatenStreak.team_id), unbeatenStreak.team_name)
              : null}
            showDivider
          />
          <StreakCell
            compact
            icon="trending-down"
            color="#b91c1c"
            value={lossStreak && Number(lossStreak.value || 0) > 0 ? String(Number(lossStreak.value)) : '–'}
            valueColor={lossStreak && Number(lossStreak.value || 0) > 0 ? '#b91c1c' : '#94a3b8'}
            label={"Sconfitte\ndi fila"}
            detail={lossStreak && Number(lossStreak.value || 0) > 0
              ? formatStreakRange(lossStreak.started_at, lossStreak.ended_at, { stacked: true })
              : null}
            teamName={lossStreak?.team_name}
            logoUrl={lossStreak?.team_logo_url}
            logoPath={lossStreak?.team_logo_path}
            onPress={Number(lossStreak?.team_id) > 0
              ? () => onPressTeam?.(Number(lossStreak.team_id), lossStreak.team_name)
              : null}
          />
        </Animated.View>
      ) : null}
      {hasMini ? (
        <View style={styles.miniRow}>
          {miniDefs.map((item) => {
            const teamId = Number(item.src?.team_id);
            return (
              <MiniStat
                key={item.key}
                bonusType={item.bonusType}
                value={item.src ? Number(item.src.value || 0) : '–'}
                label={item.label}
                teamName={item.src?.team_name}
                logoUrl={item.src?.team_logo_url}
                logoPath={item.src?.team_logo_path}
                onPress={teamId > 0 ? () => onPressTeam?.(teamId, item.src?.team_name) : null}
              />
            );
          })}
        </View>
      ) : null}
      {topMatch ? (
        <Animated.View
          entering={FadeInDown.duration(280)}
          style={styles.streakPanel}
        >
          <MatchRecordCell
            label="Partita con più gol"
            bonusType="most_goals"
            record={topMatch}
            onPress={matchId > 0 ? () => onPressMatch?.(matchId) : null}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

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

function PlayedPitchHero({ value, delay = 0 }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(280)}
      style={styles.pitchHero}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((prev) => (
          prev.width === width && prev.height === height ? prev : { width, height }
        ));
      }}
    >
      <MidfieldDecoration width={size.width} height={size.height} />
      <View style={styles.pitchHeroBody}>
        <View style={styles.pitchHeroLeft}>
          <View style={styles.pitchHeroBadge}>
            <Ionicons name="calendar-outline" size={18} color="#fff" />
          </View>
          <Text style={styles.pitchHeroLabel}>Partite</Text>
        </View>
        <Text style={styles.pitchHeroValue}>{value}</Text>
      </View>
    </Animated.View>
  );
}

function GoalsKpiCell({ bonusType, icon, pack, color, value, label, valueColor, showDivider }) {
  return (
    <View style={[styles.goalsKpiCell, showDivider && styles.goalsKpiCellDivider]}>
      <View style={styles.goalsKpiHead}>
        <View style={styles.goalsKpiBadge}>
          {bonusType ? (
            <BonusIcon type={bonusType} size={16} />
          ) : (
            <IconGlyph pack={pack} name={icon} size={15} color={color} />
          )}
        </View>
        <Text style={styles.goalsKpiLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{label}</Text>
      </View>
      <Text
        style={[styles.goalsKpiValue, valueColor ? { color: valueColor } : null]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function StreakCell({
  icon,
  color,
  bonusType,
  value,
  valueColor,
  label,
  detail,
  showDivider,
  teamName,
  logoUrl,
  logoPath,
  onPress,
  compact = false,
}) {
  const name = String(teamName || '').trim();
  const inner = (
    <View style={[
      styles.goalsKpiCell,
      compact && styles.streakCellCompact,
      showDivider && styles.goalsKpiCellDivider,
    ]}
    >
      <View style={[styles.goalsKpiHead, compact && styles.streakHeadCompact]}>
        <View style={[styles.goalsKpiBadge, compact && styles.streakBadgeCompact]}>
          {bonusType ? (
            <BonusIcon type={bonusType} size={compact ? 14 : 16} />
          ) : (
            <Ionicons name={icon} size={compact ? 13 : 15} color={color} />
          )}
        </View>
        <Text
          style={[styles.goalsKpiLabel, compact && styles.streakLabelCompact]}
          numberOfLines={compact ? 2 : 1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
        >
          {label}
        </Text>
      </View>
      <View style={styles.streakValueBlock}>
        <Text
          style={[
            styles.goalsKpiValue,
            compact && styles.streakValueCompact,
            valueColor ? { color: valueColor } : null,
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {value}
        </Text>
        {name ? (
          <View style={styles.streakTeam}>
            <TeamLogoImage
              logoUrl={logoUrl}
              logoPath={logoPath}
              style={styles.miniStatLogo}
              fallbackStyle={styles.miniStatLogoFallback}
              fallbackIconSize={9}
            />
            <Text style={styles.streakTeamName} numberOfLines={1}>{name}</Text>
          </View>
        ) : null}
        <Text
          style={[styles.streakDetail, compact && styles.streakDetailCompact]}
          numberOfLines={compact ? 3 : 1}
          ellipsizeMode="clip"
        >
          {detail || ' '}
        </Text>
      </View>
    </View>
  );
  if (!onPress) {
    return <View style={styles.recordCellHit}>{inner}</View>;
  }
  return (
    <TouchableOpacity style={styles.recordCellHit} activeOpacity={0.78} onPress={onPress}>
      {inner}
    </TouchableOpacity>
  );
}

function MiniStat({ icon, color, value, label, bonusType, teamName, logoUrl, logoPath, onPress }) {
  const name = String(teamName || '').trim();
  const content = (
    <>
      {bonusType ? (
        <BonusIcon type={bonusType} size={15} />
      ) : (
        <Ionicons name={icon} size={14} color={color} />
      )}
      <Text style={styles.miniStatValue}>{value}</Text>
      {name ? (
        <View style={styles.miniStatTeam}>
          <TeamLogoImage
            logoUrl={logoUrl}
            logoPath={logoPath}
            style={styles.miniStatLogo}
            fallbackStyle={styles.miniStatLogoFallback}
            fallbackIconSize={9}
          />
          <Text style={styles.miniStatTeamName} numberOfLines={1}>{name}</Text>
        </View>
      ) : null}
      <Text style={styles.miniStatLabel}>{label}</Text>
    </>
  );
  if (!onPress) {
    return <View style={styles.miniStat}>{content}</View>;
  }
  return (
    <TouchableOpacity style={styles.miniStat} activeOpacity={0.78} onPress={onPress}>
      {content}
    </TouchableOpacity>
  );
}

function MatchRecordCell({ icon, pack, color, bonusType, record, onPress, label, showDivider }) {
  const hasScore = record && Number.isFinite(Number(record.home_score)) && Number.isFinite(Number(record.away_score));
  const homeName = String(record?.home_team || record?.home_team_name || '').trim();
  const awayName = String(record?.away_team || record?.away_team_name || '').trim();
  const date = formatHighlightDate(record?.kickoff_at) || formatHighlightDate(record?.date);
  const inner = (
    <View style={[styles.goalsKpiCell, showDivider && styles.goalsKpiCellDivider]}>
      <View style={styles.recordHead}>
        <View style={styles.goalsKpiBadge}>
          {bonusType ? (
            <BonusIcon type={bonusType} size={16} />
          ) : (
            <IconGlyph pack={pack} name={icon} size={16} color={color} />
          )}
        </View>
        <Text style={styles.recordTitle}>{label}</Text>
      </View>
      {!hasScore ? (
        <Text style={[styles.goalsKpiValue, { color: '#94a3b8' }]}>–</Text>
      ) : (
        <View style={styles.streakValueBlock}>
          <View style={styles.recordScoreRow}>
            <TeamLogoImage
              logoUrl={record.home_team_logo_url}
              logoPath={record.home_team_logo_path}
              style={styles.recordLogo}
              fallbackStyle={styles.recordLogoFallback}
              fallbackIconSize={12}
            />
            <Text style={styles.recordScore}>
              {Number(record.home_score)}-{Number(record.away_score)}
            </Text>
            <TeamLogoImage
              logoUrl={record.away_team_logo_url}
              logoPath={record.away_team_logo_path}
              style={styles.recordLogo}
              fallbackStyle={styles.recordLogoFallback}
              fallbackIconSize={12}
            />
          </View>
          {homeName && awayName ? (
            <Text style={styles.recordNames} numberOfLines={1}>{homeName} vs {awayName}</Text>
          ) : (
            <Text style={styles.recordNames}> </Text>
          )}
          <Text style={styles.recordDate} numberOfLines={1}>{date || ' '}</Text>
        </View>
      )}
    </View>
  );
  if (!onPress) {
    return <View style={styles.recordCellHit}>{inner}</View>;
  }
  return (
    <TouchableOpacity style={styles.recordCellHit} activeOpacity={0.78} onPress={onPress}>
      {inner}
    </TouchableOpacity>
  );
}

function TeamGeneral({ general, outcomes, onPressMatch }) {
  const played = Number(general?.played || 0);
  const gf = Number(general?.goals || 0);
  const ga = Number(general?.goals_conceded || 0);
  const wins = Number(outcomes?.wins || 0);
  const draws = Number(outcomes?.draws || 0);
  const losses = Number(outcomes?.losses || 0);
  const totalOut = wins + draws + losses;
  const winPct = totalOut > 0 ? wins / totalOut : 0;
  const drawPct = totalOut > 0 ? draws / totalOut : 0;
  const lossPct = totalOut > 0 ? losses / totalOut : 0;
  const winStreak = Number(general?.longest_win_streak?.value || 0);
  const unbeatenStreak = Number(general?.longest_unbeaten_streak?.value || 0);
  const lossStreak = Number(general?.longest_loss_streak?.value || 0);
  const diff = gf - ga;
  const diffColor = diff > 0 ? '#15803d' : diff < 0 ? '#b91c1c' : '#0f766e';

  return (
    <View>
      <View style={styles.kpiStack}>
        <PlayedPitchHero value={played} delay={0} />
        <Animated.View entering={FadeInDown.delay(40).duration(280)} style={styles.goalsKpiPanel}>
          <GoalsKpiCell
            bonusType="goal"
            value={String(gf)}
            label="Gol fatti"
            showDivider
          />
          <GoalsKpiCell
            bonusType="goals_conceded"
            value={String(ga)}
            label="Gol subiti"
            showDivider
          />
          <GoalsKpiCell
            icon="swap-vertical"
            color={diffColor}
            value={`${diff >= 0 ? '+' : ''}${diff}`}
            valueColor={diffColor}
            label="Differenza"
          />
        </Animated.View>
      </View>

      <View style={styles.miniRow}>
        <MiniStat bonusType="yellow_card" value={Number(general?.yellow_cards || 0)} label="Gialli" />
        <MiniStat bonusType="red_card" value={Number(general?.red_cards || 0)} label="Rossi" />
        <MiniStat bonusType="penalty_goal" value={Number(general?.penalties_for || 0)} label={"Rigori\na favore"} />
        <MiniStat bonusType="penalty_missed" value={Number(general?.penalties_against || 0)} label={"Rigori\na sfavore"} />
      </View>

      <View style={styles.wdlCard}>
        <View style={styles.wdlNumbers}>
          <Text style={[styles.wdlNum, { color: '#15803d' }]}>{wins}</Text>
          <Text style={[styles.wdlNum, { color: '#64748b' }]}>{draws}</Text>
          <Text style={[styles.wdlNum, { color: '#b91c1c' }]}>{losses}</Text>
        </View>
        <View style={styles.wdlTrack}>
          {totalOut > 0 ? (
            <>
              <View style={[styles.wdlSeg, { flex: Math.max(winPct, 0.001), backgroundColor: '#22c55e' }]} />
              <View style={[styles.wdlSeg, { flex: Math.max(drawPct, 0.001), backgroundColor: '#94a3b8' }]} />
              <View style={[styles.wdlSeg, { flex: Math.max(lossPct, 0.001), backgroundColor: '#ef4444' }]} />
            </>
          ) : null}
        </View>
        <View style={styles.wdlLegend}>
          <Text style={styles.wdlLeg}>{Number(outcomes?.wins_pct || 0)}% V</Text>
          <Text style={styles.wdlLeg}>{Number(outcomes?.draws_pct || 0)}% P</Text>
          <Text style={styles.wdlLeg}>{Number(outcomes?.losses_pct || 0)}% S</Text>
        </View>
      </View>

      <Animated.View entering={FadeInDown.delay(80).duration(280)} style={styles.streakPanel}>
        <StreakCell
          compact
          icon="flame"
          color="#16a34a"
          value={winStreak > 0 ? String(winStreak) : '–'}
          valueColor={winStreak > 0 ? '#16a34a' : '#94a3b8'}
          label={"Vittorie\ndi fila"}
          detail={winStreak > 0
            ? formatStreakRange(general?.longest_win_streak?.started_at, general?.longest_win_streak?.ended_at, { stacked: true })
            : null}
          showDivider
        />
        <StreakCell
          compact
          icon="shield-checkmark"
          color="#0f766e"
          value={unbeatenStreak > 0 ? String(unbeatenStreak) : '–'}
          valueColor={unbeatenStreak > 0 ? '#0f766e' : '#94a3b8'}
          label={"Striscia di\nimbattibilità"}
          detail={unbeatenStreak > 0
            ? formatStreakRange(
              general?.longest_unbeaten_streak?.started_at,
              general?.longest_unbeaten_streak?.ended_at,
              { stacked: true },
            )
            : null}
          showDivider
        />
        <StreakCell
          compact
          icon="trending-down"
          color="#b91c1c"
          value={lossStreak > 0 ? String(lossStreak) : '–'}
          valueColor={lossStreak > 0 ? '#b91c1c' : '#94a3b8'}
          label={"Sconfitte\ndi fila"}
          detail={lossStreak > 0
            ? formatStreakRange(general?.longest_loss_streak?.started_at, general?.longest_loss_streak?.ended_at, { stacked: true })
            : null}
        />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(100).duration(280)} style={styles.streakPanel}>
        <MatchRecordCell
          label={"Vittoria\npiù larga"}
          icon="arrow-up-circle"
          color="#16a34a"
          record={general?.biggest_win}
          onPress={Number(general?.biggest_win?.match_id) > 0
            ? () => onPressMatch?.(Number(general.biggest_win.match_id))
            : null}
          showDivider
        />
        <MatchRecordCell
          label={"Sconfitta\npiù pesante"}
          icon="arrow-down-circle"
          color="#b91c1c"
          record={general?.heaviest_defeat}
          onPress={Number(general?.heaviest_defeat?.match_id) > 0
            ? () => onPressMatch?.(Number(general.heaviest_defeat.match_id))
            : null}
        />
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(120).duration(280)} style={styles.streakPanel}>
        <MatchRecordCell
          label="Partita con più gol"
          bonusType="most_goals"
          record={general?.highest_scoring_match}
          onPress={Number(general?.highest_scoring_match?.match_id) > 0
            ? () => onPressMatch?.(Number(general.highest_scoring_match.match_id))
            : null}
        />
      </Animated.View>
    </View>
  );
}

export const GROUP_STATS_BOARDS = [
  { key: 'scorers', label: 'Marcatori', shortLabel: 'Gol', pack: 'mci', icon: 'soccer', accent: '#15803d', empty: 'Nessun marcatore disponibile.' },
  { key: 'assistmen', label: 'Assistman', shortLabel: 'Assist', pack: 'mci', icon: 'shoe-cleat', accent: '#1d4ed8', empty: 'Nessun assist disponibile.' },
  { key: 'presences', label: 'Presenze', shortLabel: 'Presenze', pack: 'ion', icon: 'people', accent: '#667eea', empty: 'Nessuna presenza con voto nel periodo selezionato.' },
  { key: 'yellow_cards', label: 'Cartellini gialli', shortLabel: 'Gialli', pack: 'ion', icon: 'square', accent: '#ca8a04', bonusType: 'yellow_card', empty: 'Nessun cartellino giallo disponibile.' },
  { key: 'red_cards', label: 'Cartellini rossi', shortLabel: 'Rossi', pack: 'ion', icon: 'square', accent: '#dc2626', bonusType: 'red_card', empty: 'Nessun cartellino rosso disponibile.' },
  { key: 'penalty_goals', label: 'Rigori segnati', shortLabel: 'Rigori segnati', pack: 'ion', icon: 'disc', accent: '#2563eb', bonusType: 'penalty_goal', keepIconOnWhite: true, empty: 'Nessun rigore segnato disponibile.' },
  { key: 'penalty_saved', label: 'Rigori parati', shortLabel: 'Rigori parati', pack: 'ion', icon: 'hand-left-outline', accent: '#0f766e', bonusType: 'penalty_saved', keepIconOnWhite: true, empty: 'Nessun rigore parato disponibile.' },
  { key: 'clean_sheets', label: 'Clean sheet', shortLabel: 'Clean sheet', pack: 'mci', icon: 'hand-front-right', accent: '#16a34a', bonusType: 'clean_sheet', keepIconOnWhite: true, empty: 'Nessuna clean sheet disponibile.' },
  { key: 'match_wins', label: 'Partite vinte', shortLabel: 'Partite vinte', pack: 'ion', icon: 'checkmark-circle', accent: '#16a34a', empty: 'Nessuna partita vinta disponibile.' },
  { key: 'edition_wins', label: 'Edizioni vinte', shortLabel: 'Trofei', pack: 'ion', icon: 'trophy', accent: '#d97706', empty: 'Nessun trofeo vinto disponibile.' },
];

export const TEAM_STATS_BOARDS = GROUP_STATS_BOARDS.filter(
  (board) => board.key !== 'yellow_cards' && board.key !== 'red_cards'
);

export function mapOfficialStatsBoards(defs, dataByKey) {
  return (Array.isArray(defs) ? defs : []).map((def) => ({
    ...def,
    items: Array.isArray(dataByKey?.[def.key]) ? dataByKey[def.key] : [],
  }));
}

function sharePhotosAcrossBoards(boards) {
  const list = Array.isArray(boards) ? boards : [];
  const photoByPlayerId = new Map();
  const photoByCluster = new Map();
  const remember = (row) => {
    const photo = String(row?.photo_path || '').trim();
    if (!photo) return;
    const pid = Number(row.player_id);
    if (pid > 0) photoByPlayerId.set(pid, photo);
    const cid = Number(row.cluster_id);
    if (cid > 0) photoByCluster.set(cid, photo);
  };
  for (const board of list) {
    for (const row of Array.isArray(board.items) ? board.items : []) remember(row);
  }
  return list.map((board) => {
    const items = Array.isArray(board.items) ? board.items : [];
    let changed = false;
    const nextItems = items.map((row) => {
      const existing = String(row?.photo_path || '').trim();
      if (existing) return row;
      const pid = Number(row.player_id);
      const cid = Number(row.cluster_id);
      const photo =
        (pid > 0 ? photoByPlayerId.get(pid) : '')
        || (cid > 0 ? photoByCluster.get(cid) : '')
        || '';
      if (!photo) return row;
      changed = true;
      return { ...row, photo_path: photo };
    });
    return changed ? { ...board, items: nextItems } : board;
  });
}

export default function OfficialStatsExperience({
  loading = false,
  years = [],
  selectedYear,
  onSelectYear,
  boards = [],
  teamHighlights = null,
  general = null,
  outcomes = null,
  extraAfterOverview = null,
  onPressPlayer,
  onPressTeam,
  onPressMatch,
  competitionId = null,
  searchPlaceholder = 'Cerca giocatore o squadra',
  searchIncludesTeam = true,
  onScroll,
  onScrollBeginDrag,
  onScrollEndDrag,
  scrollRef,
  contentInsetTop = 0,
  contentMinHeight = 0,
  onScrollViewLayout,
}) {
  const internalScrollRef = useRef(null);
  const smoothScrollRafRef = useRef(null);
  const scrollYRef = useRef(0);
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const [query, setQuery] = useState('');
  const [selectedBoard, setSelectedBoard] = useState(boards[0]?.key || 'scorers');
  const [expanded, setExpanded] = useState(false);

  const setCombinedScrollRef = useCallback((node) => {
    internalScrollRef.current = node;
    if (typeof scrollRef === 'function') {
      scrollRef(node);
      return;
    }
    if (scrollRef && typeof scrollRef === 'object') {
      scrollRef.current = node;
    }
  }, [scrollRef]);

  const stopSmoothScroll = useCallback(() => {
    if (smoothScrollRafRef.current != null) {
      cancelAnimationFrame(smoothScrollRafRef.current);
      smoothScrollRafRef.current = null;
    }
  }, []);

  const scrollToLeaderboard = useCallback((animated = true) => {
    const node = internalScrollRef.current;
    if (!node?.scrollTo) return;
    const maxY = Math.max(0, contentHeightRef.current - viewportHeightRef.current);
    if (!(maxY > 0)) {
      if (node.scrollToEnd) node.scrollToEnd({ animated });
      return;
    }
    if (!animated) {
      stopSmoothScroll();
      node.scrollTo({ y: maxY, animated: false });
      scrollYRef.current = maxY;
      return;
    }
    stopSmoothScroll();
    const startY = Math.max(0, Math.min(scrollYRef.current, maxY));
    const delta = maxY - startY;
    if (delta <= 1) return;
    const duration = 780;
    const t0 = Date.now();
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const tick = () => {
      const elapsed = Date.now() - t0;
      const p = Math.max(0, Math.min(1, elapsed / duration));
      const y = startY + delta * easeOutCubic(p);
      node.scrollTo({ y, animated: false });
      scrollYRef.current = y;
      if (p < 1) {
        smoothScrollRafRef.current = requestAnimationFrame(tick);
      } else {
        smoothScrollRafRef.current = null;
      }
    };
    smoothScrollRafRef.current = requestAnimationFrame(tick);
  }, [stopSmoothScroll]);

  const selectBoardAndScroll = useCallback((key, shouldScroll = true) => {
    setSelectedBoard(key);
    setExpanded(false);
    if (!shouldScroll) return;
    requestAnimationFrame(() => {
      scrollToLeaderboard(true);
    });
  }, [scrollToLeaderboard]);

  useEffect(() => {
    setQuery('');
    setExpanded(false);
    setSelectedBoard(boards[0]?.key || 'scorers');
  }, [selectedYear]);

  useEffect(() => () => stopSmoothScroll(), [stopSmoothScroll]);

  const handleScrollViewLayout = useCallback((event) => {
    viewportHeightRef.current = Math.max(0, Number(event?.nativeEvent?.layout?.height || 0));
    onScrollViewLayout?.(event);
  }, [onScrollViewLayout]);

  const handleContentSizeChange = useCallback((_, h) => {
    contentHeightRef.current = Math.max(0, Number(h || 0));
  }, []);

  const handleScroll = useCallback((event) => {
    scrollYRef.current = Math.max(0, Number(event?.nativeEvent?.contentOffset?.y || 0));
    onScroll?.(event);
  }, [onScroll]);

  const handleScrollBeginDrag = useCallback((event) => {
    stopSmoothScroll();
    onScrollBeginDrag?.(event);
  }, [onScrollBeginDrag, stopSmoothScroll]);

  const handleScrollEndDrag = useCallback((event) => {
    onScrollEndDrag?.(event);
  }, [onScrollEndDrag]);

  const normalizedQuery = normalizeQuery(query);
  const searching = normalizedQuery.length > 0;
  const displayBoards = useMemo(() => sharePhotosAcrossBoards(boards), [boards]);
  const activeBoard = displayBoards.find((b) => b.key === selectedBoard) || displayBoards[0];
  const searchHits = useMemo(() => {
    if (!searching) return [];
    return displayBoards
      .map((board) => ({
        board,
        items: (Array.isArray(board.items) ? board.items : []).filter((row) =>
          rowMatchesQuery(row, normalizedQuery, searchIncludesTeam)
        ),
      }))
      .filter((hit) => hit.items.length > 0);
  }, [displayBoards, normalizedQuery, searching, searchIncludesTeam]);

  return (
    <View style={styles.root}>
      {contentInsetTop > 0 ? null : (
        <>
          <PeriodSelector years={years} selectedYear={selectedYear} onSelectYear={onSelectYear} />
          <StatsSearchBar
            value={query}
            onChange={(text) => {
              setQuery(text);
              setExpanded(false);
            }}
            placeholder={searchPlaceholder}
          />
          <TrendingPlayersStrip
            competitionId={competitionId}
            visible={!searching}
            onPressPlayer={onPressPlayer}
            showTeamName={searchIncludesTeam}
          />
          {!searching ? (
            <CategoryChips
              boards={displayBoards}
              selectedKey={activeBoard?.key}
              onSelect={(key) => selectBoardAndScroll(key, true)}
            />
          ) : null}
        </>
      )}

      {loading && contentInsetTop <= 0 ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color="#667eea" />
        </View>
      ) : (
        <ScrollView
          ref={setCombinedScrollRef}
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            contentInsetTop > 0 ? styles.scrollContentWithInset : null,
            contentMinHeight > 0 ? { minHeight: contentMinHeight } : null,
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onLayout={handleScrollViewLayout}
          onContentSizeChange={handleContentSizeChange}
          onScroll={handleScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          onScrollEndDrag={handleScrollEndDrag}
          scrollEventThrottle={16}
        >
          {contentInsetTop > 0 ? <View style={{ height: contentInsetTop }} pointerEvents="none" /> : null}
          <View style={contentInsetTop > 0 ? styles.insetCard : null}>
            {contentInsetTop > 0 ? (
              <>
                <PeriodSelector years={years} selectedYear={selectedYear} onSelectYear={onSelectYear} />
                <StatsSearchBar
                  value={query}
                  onChange={(text) => {
                    setQuery(text);
                    setExpanded(false);
                  }}
                  placeholder={searchPlaceholder}
                />
                <TrendingPlayersStrip
                  competitionId={competitionId}
                  visible={!searching}
                  onPressPlayer={onPressPlayer}
                  showTeamName={searchIncludesTeam}
                />
                {!searching ? (
                  <CategoryChips
                    boards={displayBoards}
                    selectedKey={activeBoard?.key}
                    onSelect={(key) => selectBoardAndScroll(key, true)}
                  />
                ) : null}
              </>
            ) : null}
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color="#667eea" />
              </View>
            ) : searching ? (
              searchHits.length === 0 ? (
                <Text style={styles.emptyText}>Nessun giocatore trovato.</Text>
              ) : (
                searchHits.map((hit, idx) => (
                  <Animated.View
                    key={`search-${hit.board.key}`}
                    entering={FadeIn.delay(idx * 40).duration(220)}
                    style={styles.searchGroup}
                  >
                    <View style={styles.boardHead}>
                      <View style={[styles.boardIcon, { backgroundColor: `${hit.board.accent}18` }]}>
                        <BoardGlyph board={hit.board} size={15} color={hit.board.accent} />
                      </View>
                      <Text style={styles.boardTitle}>{hit.board.label}</Text>
                      <Text style={styles.boardCount}>{hit.items.length}</Text>
                    </View>
                    <LeaderboardList
                      board={{ ...hit.board, items: hit.items }}
                      expanded
                      onToggleExpand={() => {}}
                      onPressPlayer={onPressPlayer}
                      query={normalizedQuery}
                      includeTeam={searchIncludesTeam}
                      animKey={`${selectedYear}-search-${hit.board.key}`}
                    />
                  </Animated.View>
                ))
              )
            ) : (
              <>
                {teamHighlights ? (
                  <View style={styles.overviewBlock}>
                    <GroupHighlights
                      highlights={teamHighlights}
                      onPressTeam={onPressTeam}
                      onPressMatch={onPressMatch}
                    />
                  </View>
                ) : null}
                {general ? (
                  <View style={styles.overviewBlock}>
                    <TeamGeneral general={general} outcomes={outcomes} onPressMatch={onPressMatch} />
                    {extraAfterOverview}
                  </View>
                ) : null}

                <View style={styles.playersSection}>
                  <View style={styles.playersSectionHead}>
                    <Text style={styles.playersSectionKicker}>Giocatori</Text>
                  </View>
                  <TeaserStrip
                    boards={displayBoards}
                    showTeamName={searchIncludesTeam}
                    onSelect={(key) => selectBoardAndScroll(key, true)}
                  />

                  {activeBoard ? (
                    <View style={styles.boardBlock}>
                      <View style={styles.boardHead}>
                        <View style={[styles.boardIcon, { backgroundColor: `${activeBoard.accent}18` }]}>
                          <BoardGlyph board={activeBoard} size={16} color={activeBoard.accent} />
                        </View>
                        <Text style={styles.boardTitle}>{activeBoard.label}</Text>
                      </View>
                      <LeaderboardList
                        board={activeBoard}
                        expanded={expanded}
                        onToggleExpand={() => setExpanded((v) => !v)}
                        onPressPlayer={onPressPlayer}
                        query=""
                        includeTeam={searchIncludesTeam}
                        animKey={`${selectedYear}-${activeBoard.key}`}
                      />
                    </View>
                  ) : null}
                </View>
              </>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  hScroll: { flexGrow: 0 },
  catScroll: { flexGrow: 0, marginBottom: 6 },
  chipRow: { gap: 8, paddingRight: 4, paddingBottom: 2 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 16, paddingTop: 4 },
  scrollContentWithInset: { paddingTop: 0, paddingBottom: 12 },
  insetCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ececec',
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 12,
    overflow: 'hidden',
  },
  periodWrap: { marginBottom: 2, position: 'relative' },
  periodControl: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 10,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  periodSeg: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  periodSegYear: { justifyContent: 'center' },
  periodSegActive: { backgroundColor: '#eef2ff' },
  periodSegText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  periodSegTextActive: { color: '#4f46e5' },
  periodDivider: { width: StyleSheet.hairlineWidth, backgroundColor: '#dbe3ef' },
  periodMenuRoot: { flex: 1 },
  periodMenuBackdrop: { ...StyleSheet.absoluteFillObject },
  periodMenu: {
    position: 'absolute',
    maxHeight: PERIOD_MENU_MAX_HEIGHT,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 10,
    backgroundColor: '#fff',
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  periodMenuScroll: { maxHeight: PERIOD_MENU_MAX_HEIGHT },
  periodMenuScrollContent: { paddingVertical: 4 },
  periodMenuItem: {
    minHeight: 40,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  periodMenuItemLast: { borderBottomWidth: 0 },
  periodMenuItemActive: { backgroundColor: '#eef2ff' },
  periodMenuItemText: { fontSize: 14, fontWeight: '600', color: '#334155' },
  periodMenuItemTextActive: { color: '#4f46e5', fontWeight: '700' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    marginBottom: 10,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchInput: { flex: 1, fontSize: 14, color: '#0f172a', paddingVertical: 0 },
  trendingWrap: {
    marginBottom: 10,
  },
  trendingLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  trendingSpinner: {
    alignSelf: 'flex-start',
    marginLeft: 4,
  },
  trendingRow: {
    gap: 8,
    paddingRight: 4,
  },
  trendingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 180,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e8edf3',
  },
  trendingPhoto: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  trendingPhotoFallback: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendingMeta: {
    flexShrink: 1,
    minWidth: 0,
  },
  trendingName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  trendingTeam: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 1,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  catChipText: { fontSize: 12, fontWeight: '800', color: '#334155' },
  catChipTextActive: { color: '#fff' },
  catCount: {
    minWidth: 18,
    paddingHorizontal: 5,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  catCountActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  catCountText: { fontSize: 10, fontWeight: '800', color: '#64748b' },
  catCountTextActive: { color: '#fff' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 160 },
  emptyText: { fontSize: 13, color: '#64748b', paddingVertical: 10 },
  overviewBlock: { marginBottom: 14 },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  kpiStack: { gap: 8 },
  goalsKpiPanel: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e8edf3',
    overflow: 'hidden',
    minHeight: 84,
  },
  goalsKpiCell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 14,
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  goalsKpiCellDivider: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#e2e8f0',
  },
  streakCellCompact: {
    paddingHorizontal: 4,
    paddingVertical: 12,
    gap: 8,
  },
  streakHeadCompact: {
    flexDirection: 'column',
    gap: 4,
  },
  streakBadgeCompact: {
    width: 24,
    height: 24,
    borderRadius: 7,
  },
  streakLabelCompact: {
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'center',
    flexShrink: 1,
  },
  streakValueCompact: {
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.5,
  },
  streakDetailCompact: {
    fontSize: 9,
    lineHeight: 10,
    minHeight: 30,
    includeFontPadding: false,
  },
  goalsKpiHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
  },
  goalsKpiBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#eef2f7',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    flexShrink: 0,
  },
  goalsKpiLabel: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    lineHeight: 14,
  },
  goalsKpiValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.8,
    lineHeight: 32,
    textAlign: 'center',
    width: '100%',
  },
  pitchHero: {
    borderRadius: 16,
    backgroundColor: '#14532d',
    overflow: 'hidden',
    position: 'relative',
    minHeight: 84,
    justifyContent: 'center',
  },
  pitchHeroBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    zIndex: 1,
  },
  pitchHeroLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  pitchHeroBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  pitchHeroLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  pitchHeroValue: {
    fontSize: 40,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -1,
    lineHeight: 44,
  },
  miniRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ececec',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  miniStat: { flex: 1, alignItems: 'center', gap: 4, minWidth: 0 },
  miniStatValue: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  miniStatLabel: { fontSize: 9, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', textAlign: 'center', lineHeight: 12 },
  miniStatTeam: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    gap: 3,
    maxWidth: '100%',
    paddingHorizontal: 2,
  },
  miniStatLogo: { width: 14, height: 14, flexShrink: 0 },
  miniStatLogoFallback: {
    width: 14,
    height: 14,
    borderRadius: 4,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  miniStatTeamName: {
    flexShrink: 1,
    flexGrow: 0,
    minWidth: 0,
    fontSize: 9,
    fontWeight: '700',
    color: '#475569',
    lineHeight: 12,
    includeFontPadding: false,
  },
  wdlCard: {
    marginTop: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ececec',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  wdlNumbers: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  wdlNum: { fontSize: 20, fontWeight: '800' },
  wdlTrack: { height: 8, borderRadius: 999, overflow: 'hidden', flexDirection: 'row', backgroundColor: '#e2e8f0' },
  wdlSeg: { height: '100%' },
  wdlLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  wdlLeg: { fontSize: 11, fontWeight: '700', color: '#64748b' },
  streakPanel: {
    flexDirection: 'row',
    marginTop: 8,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e8edf3',
    overflow: 'hidden',
    minHeight: 84,
  },
  streakValueBlock: {
    width: '100%',
    alignItems: 'center',
    gap: 4,
  },
  streakDetail: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    textAlign: 'center',
    minHeight: 13,
    includeFontPadding: false,
  },
  streakTeam: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: 4,
  },
  streakTeamName: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
    lineHeight: 12,
    includeFontPadding: false,
  },
  recordCellHit: { flex: 1, minWidth: 0 },
  recordHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
  },
  recordTitle: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    textAlign: 'center',
    lineHeight: 14,
  },
  recordScoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  recordLogo: { width: 24, height: 24 },
  recordLogoFallback: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordScore: { fontSize: 22, fontWeight: '800', color: '#0f172a', letterSpacing: -0.5 },
  recordNames: { marginTop: 4, fontSize: 10, fontWeight: '600', color: '#64748b', textAlign: 'center' },
  recordDate: { marginTop: 2, fontSize: 10, fontWeight: '600', color: '#94a3b8', textAlign: 'center', minHeight: 13 },
  teaserBlock: { marginBottom: 0 },
  teaserRow: { gap: 10, paddingRight: 4 },
  teaserCard: {
    width: 148,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e8edf3',
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  teaserCatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  teaserCatBadge: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teaserLabel: {
    flex: 1,
    fontSize: 10,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
  },
  teaserHero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  teaserPhotoWrap: {
    width: 56,
    height: 56,
    overflow: 'visible',
  },
  teaserPhotoBleed: {
    position: 'absolute',
    width: 72,
    height: 72,
    left: -8,
    top: -8,
  },
  teaserYearBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    zIndex: 2,
    minWidth: 26,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teaserYearBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.2,
  },
  teaserName: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  teaserTeam: { marginTop: 2, fontSize: 10, fontWeight: '600', color: '#94a3b8' },
  teaserValue: { fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  playersSection: {
    marginTop: 4,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: '#e8edf3',
  },
  playersSectionHead: { marginBottom: 12 },
  playersSectionKicker: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  playersSectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.5,
  },
  boardBlock: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e8edf3',
  },
  boardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  boardIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#1e293b' },
  boardCount: { fontSize: 12, fontWeight: '800', color: '#94a3b8' },
  searchGroup: { marginBottom: 16 },
  boardCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eef2f7',
  },
  lbRowLast: { borderBottomWidth: 0 },
  rankBadge: {
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rankBadgeCircle: { width: 24 },
  rankBadgeWide: {
    minWidth: 36,
    paddingHorizontal: 6,
  },
  rankBadgePlain: {
    backgroundColor: '#f8fafc',
  },
  rankBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    fontVariant: ['tabular-nums'],
  },
  lbMain: { flex: 1, minWidth: 0 },
  lbName: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  lbTeam: { marginTop: 1, fontSize: 11, fontWeight: '500', color: '#94a3b8' },
  lbValue: { fontSize: 16, fontWeight: '800', color: '#0f172a', minWidth: 28, textAlign: 'right' },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
  },
  expandText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
});

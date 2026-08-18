import React, { useEffect, useMemo, useRef, useState } from 'react';
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

function formatHighlightDate(value) {
  const d = parseAppDate(value);
  if (!d) return '';
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatStreakRange(startedAt, endedAt) {
  const start = formatHighlightDate(startedAt);
  const end = formatHighlightDate(endedAt);
  if (!start && !end) return '';
  if (start && end && start === end) return start;
  if (start && end) return `${start} – ${end}`;
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

function playerInitials(name) {
  const parts = String(name || '')
    .trim()
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
                          name={playerName}
                          accent={board.accent}
                          size={72}
                        />
                      </View>
                    ) : (
                      <PlayerAvatar
                        photoPath={top.photo_path}
                        name={playerName}
                        accent={board.accent}
                        size={56}
                      />
                    )}
                  </View>
                  <Text style={[styles.teaserValue, { color: board.accent }]}>{value}</Text>
                </View>
                <Text style={styles.teaserName} numberOfLines={1}>{playerName}</Text>
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

function HighlightCard({ item, onPressTeam, onPressMatch, index }) {
  if (!item) return null;
  const teamId = Number(item.team_id);
  const matchId = Number(item.match?.match_id);
  const canOpen = (item.match && matchId > 0) || teamId > 0;
  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, 7) * 40).duration(280)}
      style={[styles.hlCard, item.wide && styles.hlCardWide]}
    >
      <TouchableOpacity
        style={styles.hlCardInner}
        activeOpacity={canOpen ? 0.78 : 1}
        disabled={!canOpen}
        onPress={() => {
          if (item.match && matchId > 0) onPressMatch?.(matchId);
          else if (teamId > 0) onPressTeam?.(teamId, item.team_name);
        }}
      >
        <View style={[styles.hlIcon, { backgroundColor: item.iconBg }]}>
          {item.bonusType ? (
            <BonusIcon type={item.bonusType} size={15} />
          ) : (
            <Ionicons name={item.icon} size={15} color={item.accent} />
          )}
        </View>
        {item.label ? <Text style={styles.hlLabel}>{item.label}</Text> : null}
        {item.match ? (
          <View style={styles.hlMatch}>
            <View style={styles.hlMatchSide}>
              <TeamLogoImage
                logoUrl={item.match.home_team_logo_url}
                logoPath={item.match.home_team_logo_path}
                style={styles.hlLogoLg}
                fallbackStyle={styles.hlLogoLgFallback}
                fallbackIconSize={16}
              />
              <Text style={styles.hlMatchName} numberOfLines={1}>{item.match.home_team_name}</Text>
            </View>
            <View style={styles.hlScoreBox}>
              <Text style={styles.hlScore}>
                {Number(item.match.home_score || 0)}-{Number(item.match.away_score || 0)}
              </Text>
              <Text style={[styles.hlScoreSub, { color: item.accent }]}>
                {Number(item.match.total_goals || 0)} gol
              </Text>
            </View>
            <View style={styles.hlMatchSide}>
              <TeamLogoImage
                logoUrl={item.match.away_team_logo_url}
                logoPath={item.match.away_team_logo_path}
                style={styles.hlLogoLg}
                fallbackStyle={styles.hlLogoLgFallback}
                fallbackIconSize={16}
              />
              <Text style={styles.hlMatchName} numberOfLines={1}>{item.match.away_team_name}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.hlTeam}>
            <TeamLogoImage
              logoUrl={item.logoUrl}
              logoPath={item.logoPath}
              style={styles.hlLogo}
              fallbackStyle={styles.hlLogoFallback}
              fallbackIconSize={14}
            />
            <View style={styles.hlTeamText}>
              <Text style={styles.hlTeamName} numberOfLines={1}>{item.team_name}</Text>
              <Text style={styles.hlValue}>{item.value}</Text>
            </View>
          </View>
        )}
        {item.detail ? <Text style={styles.hlDetail} numberOfLines={1}>{item.detail}</Text> : null}
      </TouchableOpacity>
    </Animated.View>
  );
}

function GroupHighlights({ highlights, onPressTeam, onPressMatch }) {
  const h = highlights || {};
  const cards = [];
  if (h.highest_scoring_match) {
    cards.push({
      key: 'top-match',
      wide: true,
      icon: 'flash',
      accent: '#7c3aed',
      iconBg: '#f5f3ff',
      match: h.highest_scoring_match,
      label: 'Più gol',
      detail: formatHighlightDate(h.highest_scoring_match.kickoff_at),
    });
  }
  if (h.best_attack) {
    cards.push({
      key: 'attack',
      icon: 'football',
      accent: '#667eea',
      iconBg: '#eef2ff',
      team_id: h.best_attack.team_id,
      team_name: h.best_attack.team_name,
      logoUrl: h.best_attack.team_logo_url,
      logoPath: h.best_attack.team_logo_path,
      value: formatStatAvg(h.best_attack.avg),
      label: 'Attacco',
      detail: `${Number(h.best_attack.goals || 0)} gol · ${Number(h.best_attack.played || 0)} p`,
    });
  }
  if (h.best_defense) {
    cards.push({
      key: 'defense',
      icon: 'shield',
      accent: '#0d9488',
      iconBg: '#f0fdfa',
      team_id: h.best_defense.team_id,
      team_name: h.best_defense.team_name,
      logoUrl: h.best_defense.team_logo_url,
      logoPath: h.best_defense.team_logo_path,
      value: formatStatAvg(h.best_defense.avg),
      label: 'Difesa',
      detail: `${Number(h.best_defense.goals_conceded || 0)} subiti · ${Number(h.best_defense.played || 0)} p`,
    });
  }
  if (h.longest_win_streak) {
    cards.push({
      key: 'win-streak',
      icon: 'flame',
      accent: '#d97706',
      iconBg: '#fffbeb',
      team_id: h.longest_win_streak.team_id,
      team_name: h.longest_win_streak.team_name,
      logoUrl: h.longest_win_streak.team_logo_url,
      logoPath: h.longest_win_streak.team_logo_path,
      value: String(Number(h.longest_win_streak.value || 0)),
      label: 'Vittorie',
      detail: formatStreakRange(h.longest_win_streak.started_at, h.longest_win_streak.ended_at),
    });
  }
  if (h.longest_loss_streak) {
    cards.push({
      key: 'loss-streak',
      icon: 'trending-down',
      accent: '#64748b',
      iconBg: '#f8fafc',
      team_id: h.longest_loss_streak.team_id,
      team_name: h.longest_loss_streak.team_name,
      logoUrl: h.longest_loss_streak.team_logo_url,
      logoPath: h.longest_loss_streak.team_logo_path,
      value: String(Number(h.longest_loss_streak.value || 0)),
      label: 'Sconfitte',
      detail: formatStreakRange(h.longest_loss_streak.started_at, h.longest_loss_streak.ended_at),
    });
  }
  if (h.most_penalties_for) {
    cards.push({
      key: 'pen-for',
      bonusType: 'penalty_goal',
      icon: 'disc',
      accent: '#2563eb',
      iconBg: '#eff6ff',
      team_id: h.most_penalties_for.team_id,
      team_name: h.most_penalties_for.team_name,
      logoUrl: h.most_penalties_for.team_logo_url,
      logoPath: h.most_penalties_for.team_logo_path,
      value: String(Number(h.most_penalties_for.value || 0)),
      label: 'Rigori\na favore',
    });
  }
  if (h.most_penalties_against) {
    cards.push({
      key: 'pen-against',
      bonusType: 'penalty_missed',
      icon: 'alert-circle',
      accent: '#db2777',
      iconBg: '#fdf2f8',
      team_id: h.most_penalties_against.team_id,
      team_name: h.most_penalties_against.team_name,
      logoUrl: h.most_penalties_against.team_logo_url,
      logoPath: h.most_penalties_against.team_logo_path,
      value: String(Number(h.most_penalties_against.value || 0)),
      label: 'Rigori\na sfavore',
    });
  }
  if (h.most_yellow_cards) {
    cards.push({
      key: 'yellow',
      bonusType: 'yellow_card',
      icon: 'square',
      accent: '#ca8a04',
      iconBg: '#fefce8',
      team_id: h.most_yellow_cards.team_id,
      team_name: h.most_yellow_cards.team_name,
      logoUrl: h.most_yellow_cards.team_logo_url,
      logoPath: h.most_yellow_cards.team_logo_path,
      value: String(Number(h.most_yellow_cards.value || 0)),
      label: 'Gialli',
    });
  }
  if (h.most_red_cards) {
    cards.push({
      key: 'red',
      bonusType: 'red_card',
      icon: 'square',
      accent: '#dc2626',
      iconBg: '#fef2f2',
      team_id: h.most_red_cards.team_id,
      team_name: h.most_red_cards.team_name,
      logoUrl: h.most_red_cards.team_logo_url,
      logoPath: h.most_red_cards.team_logo_path,
      value: String(Number(h.most_red_cards.value || 0)),
      label: 'Rossi',
    });
  }
  if (cards.length === 0) {
    return <Text style={styles.emptyText}>Nessuna statistica di squadra disponibile.</Text>;
  }
  return (
    <View>
      <Text style={styles.sectionEyebrow}>Squadre</Text>
      <View style={styles.hlGrid}>
      {cards.map((card, idx) => (
        <HighlightCard
          key={card.key}
          item={card}
          index={idx}
          onPressTeam={onPressTeam}
          onPressMatch={onPressMatch}
        />
      ))}
      </View>
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

function StreakCell({ icon, color, value, valueColor, label, detail, showDivider }) {
  return (
    <View style={[styles.goalsKpiCell, showDivider && styles.goalsKpiCellDivider]}>
      <View style={styles.goalsKpiHead}>
        <View style={styles.goalsKpiBadge}>
          <Ionicons name={icon} size={15} color={color} />
        </View>
        <Text style={styles.goalsKpiLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {label}
        </Text>
      </View>
      <View style={styles.streakValueBlock}>
        <Text
          style={[styles.goalsKpiValue, valueColor ? { color: valueColor } : null]}
          numberOfLines={1}
        >
          {value}
        </Text>
        <Text style={styles.streakDetail} numberOfLines={1}>
          {detail || ' '}
        </Text>
      </View>
    </View>
  );
}

function MiniStat({ icon, color, value, label, bonusType }) {
  return (
    <View style={styles.miniStat}>
      {bonusType ? (
        <BonusIcon type={bonusType} size={15} />
      ) : (
        <Ionicons name={icon} size={14} color={color} />
      )}
      <Text style={styles.miniStatValue}>{value}</Text>
      <Text style={styles.miniStatLabel}>{label}</Text>
    </View>
  );
}

function MatchRecordCell({ icon, pack, color, bonusType, record, onPress, label, showDivider }) {
  const hasScore = record && Number.isFinite(Number(record.home_score)) && Number.isFinite(Number(record.away_score));
  const homeName = String(record?.home_team || record?.home_team_name || '').trim();
  const awayName = String(record?.away_team || record?.away_team_name || '').trim();
  const date = String(record?.date || '').trim() || formatHighlightDate(record?.kickoff_at);
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
          icon="flame"
          color="#16a34a"
          value={winStreak > 0 ? String(winStreak) : '–'}
          valueColor={winStreak > 0 ? '#16a34a' : '#94a3b8'}
          label="Vittorie di fila"
          detail={winStreak > 0
            ? formatStreakRange(general?.longest_win_streak?.started_at, general?.longest_win_streak?.ended_at)
            : null}
          showDivider
        />
        <StreakCell
          icon="trending-down"
          color="#b91c1c"
          value={lossStreak > 0 ? String(lossStreak) : '–'}
          valueColor={lossStreak > 0 ? '#b91c1c' : '#94a3b8'}
          label="Sconfitte di fila"
          detail={lossStreak > 0
            ? formatStreakRange(general?.longest_loss_streak?.started_at, general?.longest_loss_streak?.ended_at)
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
  { key: 'penalty_goals', label: 'Rigori segnati', shortLabel: 'Rigori', pack: 'ion', icon: 'disc', accent: '#2563eb', bonusType: 'penalty_goal', keepIconOnWhite: true, empty: 'Nessun rigore segnato disponibile.' },
  { key: 'penalty_saved', label: 'Rigori parati', shortLabel: 'Parate', pack: 'ion', icon: 'hand-left-outline', accent: '#0f766e', bonusType: 'penalty_saved', keepIconOnWhite: true, empty: 'Nessun rigore parato disponibile.' },
  { key: 'match_wins', label: 'Partite vinte', shortLabel: 'Vinte', pack: 'ion', icon: 'checkmark-circle', accent: '#16a34a', empty: 'Nessuna partita vinta disponibile.' },
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

function leaderboardBaseNameKey(name) {
  return String(name || '')
    .replace(/\s*\('\d{2}\)\s*$/u, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function sharePhotosAcrossBoards(boards) {
  const list = Array.isArray(boards) ? boards : [];
  const photoByPlayerId = new Map();
  const photoByCluster = new Map();
  const photosByName = new Map();
  const remember = (row) => {
    const photo = String(row?.photo_path || '').trim();
    if (!photo) return;
    const pid = Number(row.player_id);
    if (pid > 0) photoByPlayerId.set(pid, photo);
    const cid = Number(row.cluster_id);
    if (cid > 0) photoByCluster.set(cid, photo);
    const nameKey = leaderboardBaseNameKey(row.name);
    if (!nameKey) return;
    const seen = photosByName.get(nameKey) || new Set();
    seen.add(photo);
    photosByName.set(nameKey, seen);
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
      const namePhotos = photosByName.get(leaderboardBaseNameKey(row.name));
      const photo =
        (pid > 0 ? photoByPlayerId.get(pid) : '')
        || (cid > 0 ? photoByCluster.get(cid) : '')
        || (namePhotos && namePhotos.size === 1 ? [...namePhotos][0] : '')
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
  const [query, setQuery] = useState('');
  const [selectedBoard, setSelectedBoard] = useState(boards[0]?.key || 'scorers');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setQuery('');
    setExpanded(false);
    setSelectedBoard(boards[0]?.key || 'scorers');
  }, [selectedYear]);

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
          {!searching ? (
            <CategoryChips
              boards={displayBoards}
              selectedKey={activeBoard?.key}
              onSelect={(key) => {
                setSelectedBoard(key);
                setExpanded(false);
              }}
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
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            contentMinHeight > 0 ? { minHeight: contentMinHeight } : null,
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onLayout={onScrollViewLayout}
          onScroll={onScroll}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onScrollEndDrag}
          scrollEventThrottle={16}
        >
          {contentInsetTop > 0 ? <View style={{ height: contentInsetTop }} pointerEvents="none" /> : null}
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
              {!searching ? (
                <CategoryChips
                  boards={displayBoards}
                  selectedKey={activeBoard?.key}
                  onSelect={(key) => {
                    setSelectedBoard(key);
                    setExpanded(false);
                  }}
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
                  <Text style={styles.playersSectionKicker}>Classifiche</Text>
                  <Text style={styles.playersSectionTitle}>Giocatori</Text>
                </View>
                <TeaserStrip
                  boards={displayBoards}
                  showTeamName={searchIncludesTeam}
                  onSelect={(key) => {
                    setSelectedBoard(key);
                    setExpanded(false);
                  }}
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
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 16, paddingTop: 4 },
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
  hlGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  hlCard: {
    width: '48.6%',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ececec',
    borderRadius: 14,
  },
  hlCardWide: { width: '100%' },
  hlCardInner: { paddingHorizontal: 10, paddingVertical: 10 },
  hlIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  hlLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  hlTeam: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hlLogo: { width: 34, height: 34 },
  hlLogoFallback: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hlLogoLg: { width: 36, height: 36 },
  hlLogoLgFallback: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hlTeamText: { flex: 1, minWidth: 0 },
  hlTeamName: { fontSize: 12, fontWeight: '700', color: '#1e293b' },
  hlValue: { fontSize: 20, fontWeight: '800', color: '#111827', letterSpacing: -0.3 },
  hlDetail: { marginTop: 6, fontSize: 10, fontWeight: '600', color: '#94a3b8' },
  hlMatch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  hlMatchSide: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4 },
  hlMatchName: { fontSize: 11, fontWeight: '700', color: '#1e293b', textAlign: 'center' },
  hlScoreBox: { minWidth: 64, alignItems: 'center' },
  hlScore: { fontSize: 20, fontWeight: '800', color: '#111827', letterSpacing: -0.4 },
  hlScoreSub: { fontSize: 10, fontWeight: '800', marginTop: 1 },
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
  miniStat: { flex: 1, alignItems: 'center', gap: 4 },
  miniStatValue: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  miniStatLabel: { fontSize: 9, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', textAlign: 'center', lineHeight: 12 },
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
  },
  streakDetail: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    textAlign: 'center',
    minHeight: 13,
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
    paddingHorizontal: 12,
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

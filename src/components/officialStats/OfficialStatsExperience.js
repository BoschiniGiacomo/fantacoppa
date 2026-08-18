import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { PlayerPhotoImage, TeamLogoImage } from '../StableCachedImage';
import { parseAppDate } from '../../utils/dateTime';
import { buildCompetitionRanks, formatCompetitionRank } from '../../utils/standingsRanking';

export const ABSOLUTE_STATS_KEY = 'absolute';
export const STATS_LEADERBOARD_PREVIEW = 5;

const MEDAL = {
  1: { bg: '#fef3c7', fg: '#b45309', icon: 'medal' },
  2: { bg: '#e2e8f0', fg: '#475569', icon: 'medal' },
  3: { bg: '#ffedd5', fg: '#c2410c', icon: 'medal' },
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

function rowMatchesQuery(row, query) {
  if (!query) return true;
  const hay = normalizeQuery(`${row?.name || ''} ${row?.team_name || ''}`);
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

function IconGlyph({ pack = 'ion', name, size = 16, color }) {
  if (pack === 'mci') {
    return <MaterialCommunityIcons name={name} size={size} color={color} />;
  }
  return <Ionicons name={name} size={size} color={color} />;
}

function StatShareBar({ ratio, color }) {
  const progress = useSharedValue(0);
  const trackW = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(Math.min(1, Math.max(0, Number(ratio) || 0)), {
      duration: 480,
      easing: Easing.out(Easing.cubic),
    });
  }, [ratio, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: trackW.value * progress.value,
  }));

  return (
    <View
      style={styles.shareTrack}
      onLayout={(e) => {
        trackW.value = e.nativeEvent.layout.width;
      }}
    >
      <Animated.View style={[styles.shareFill, { backgroundColor: color }, fillStyle]} />
    </View>
  );
}

function RankBadge({ rank }) {
  const medal = MEDAL[rank];
  if (medal) {
    return (
      <View style={[styles.rankBadge, { backgroundColor: medal.bg }]}>
        <Ionicons name={medal.icon} size={13} color={medal.fg} />
      </View>
    );
  }
  return (
    <View style={styles.rankBadgePlain}>
      <Text style={styles.rankBadgeText}>{formatCompetitionRank(rank)}</Text>
    </View>
  );
}

function YearChipBar({ years, selectedYear, onSelectYear }) {
  const chips = useMemo(() => {
    const list = [{ key: ABSOLUTE_STATS_KEY, label: 'Assolute', value: ABSOLUTE_STATS_KEY }];
    (Array.isArray(years) ? years : []).forEach((y) => {
      list.push({ key: `y-${y}`, label: String(y), value: Number(y) });
    });
    return list;
  }, [years]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.hScroll}
      contentContainerStyle={styles.chipRow}
      keyboardShouldPersistTaps="handled"
    >
      {chips.map((chip) => {
        const active =
          chip.value === ABSOLUTE_STATS_KEY
            ? selectedYear === ABSOLUTE_STATS_KEY
            : selectedYear !== ABSOLUTE_STATS_KEY && Number(selectedYear) === Number(chip.value);
        const absolute = chip.value === ABSOLUTE_STATS_KEY;
        return (
          <TouchableOpacity
            key={chip.key}
            style={[
              styles.yearChip,
              absolute && styles.yearChipAbsolute,
              active && (absolute ? styles.yearChipAbsoluteActive : styles.yearChipActive),
            ]}
            onPress={() => onSelectYear?.(chip.value)}
            activeOpacity={0.8}
          >
            {absolute ? (
              <Ionicons name="sparkles" size={13} color={active ? '#fff' : '#b45309'} />
            ) : null}
            <Text
              style={[
                styles.yearChipText,
                absolute && styles.yearChipAbsoluteText,
                active && styles.yearChipTextActive,
              ]}
            >
              {chip.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

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
            <IconGlyph
              pack={board.pack}
              name={board.icon}
              size={14}
              color={active ? '#fff' : board.accent}
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
  animKey,
}) {
  const list = Array.isArray(board.items) ? board.items : [];
  const filtered = query ? list.filter((row) => rowMatchesQuery(row, query)) : list;
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
  const leaderValue = Math.max(1, Number(list[0]?.value || 0));

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
        const medal = MEDAL[rank];
        return (
          <Animated.View
            key={`${animKey}-${identity}`}
            entering={i < STATS_LEADERBOARD_PREVIEW
              ? FadeInDown.delay(Math.min(i, 6) * 40).duration(280)
              : undefined}
          >
            <TouchableOpacity
              style={[styles.lbRow, medal && { backgroundColor: medal.bg }]}
              activeOpacity={canOpen ? 0.72 : 1}
              disabled={!canOpen}
              onPress={() => onPressPlayer?.(row)}
            >
              <RankBadge rank={rank} />
              <View style={styles.lbPhotoWrap}>
                {row?.photo_path ? (
                  <PlayerPhotoImage photoPath={row.photo_path} style={styles.lbPhoto} />
                ) : (
                  <View style={[styles.lbPhotoFallback, { backgroundColor: `${board.accent}22` }]}>
                    <Text style={[styles.lbInitials, { color: board.accent }]}>{playerInitials(playerName)}</Text>
                  </View>
                )}
              </View>
              <View style={styles.lbMain}>
                <Text style={styles.lbName} numberOfLines={1}>{playerName}</Text>
                {teamName ? <Text style={styles.lbTeam} numberOfLines={1}>{teamName}</Text> : null}
                <StatShareBar ratio={value / leaderValue} color={board.accent} />
              </View>
              <Text style={[styles.lbValue, { color: board.accent }]}>{value}</Text>
            </TouchableOpacity>
          </Animated.View>
        );
      })}
      {canExpand ? (
        <TouchableOpacity style={styles.expandBtn} onPress={onToggleExpand} activeOpacity={0.75}>
          <Text style={styles.expandText}>
            {expanded ? 'Mostra meno' : `Altri ${filtered.length - STATS_LEADERBOARD_PREVIEW}`}
          </Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#667eea" />
        </TouchableOpacity>
      ) : null}
    </Animated.View>
  );
}

function TeaserStrip({ boards, onSelect }) {
  const teasers = boards
    .map((board) => {
      const top = Array.isArray(board.items) && board.items[0] ? board.items[0] : null;
      return top ? { board, top } : null;
    })
    .filter(Boolean);
  if (teasers.length === 0) return null;
  return (
    <View style={styles.teaserBlock}>
      <Text style={styles.sectionEyebrow}>In evidenza</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.teaserRow}
        keyboardShouldPersistTaps="handled"
      >
        {teasers.map(({ board, top }, idx) => (
          <Animated.View
            key={`teaser-${board.key}`}
            entering={FadeInDown.delay(idx * 35).duration(260)}
          >
            <TouchableOpacity
              style={styles.teaserCard}
              onPress={() => onSelect(board.key)}
              activeOpacity={0.8}
            >
              <View style={[styles.teaserIcon, { backgroundColor: `${board.accent}18` }]}>
                <IconGlyph pack={board.pack} name={board.icon} size={15} color={board.accent} />
              </View>
              <Text style={styles.teaserLabel} numberOfLines={1}>{board.shortLabel || board.label}</Text>
              <Text style={styles.teaserName} numberOfLines={1}>{String(top.name || '-')}</Text>
              <Text style={[styles.teaserValue, { color: board.accent }]}>{Number(top.value || 0)}</Text>
            </TouchableOpacity>
          </Animated.View>
        ))}
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
          <Ionicons name={item.icon} size={15} color={item.accent} />
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
      icon: 'disc',
      accent: '#2563eb',
      iconBg: '#eff6ff',
      team_id: h.most_penalties_for.team_id,
      team_name: h.most_penalties_for.team_name,
      logoUrl: h.most_penalties_for.team_logo_url,
      logoPath: h.most_penalties_for.team_logo_path,
      value: String(Number(h.most_penalties_for.value || 0)),
      label: 'Rigori +',
    });
  }
  if (h.most_penalties_against) {
    cards.push({
      key: 'pen-against',
      icon: 'alert-circle',
      accent: '#db2777',
      iconBg: '#fdf2f8',
      team_id: h.most_penalties_against.team_id,
      team_name: h.most_penalties_against.team_name,
      logoUrl: h.most_penalties_against.team_logo_url,
      logoPath: h.most_penalties_against.team_logo_path,
      value: String(Number(h.most_penalties_against.value || 0)),
      label: 'Rigori −',
    });
  }
  if (h.most_yellow_cards) {
    cards.push({
      key: 'yellow',
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

function KpiTile({ icon, pack, color, bg, value, hint, delay }) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(280)} style={[styles.kpiTile, { backgroundColor: bg }]}>
      <View style={[styles.kpiIcon, { backgroundColor: '#fff' }]}>
        <IconGlyph pack={pack} name={icon} size={15} color={color} />
      </View>
      <Text style={styles.kpiValue} numberOfLines={1}>{value}</Text>
      {hint ? <Text style={styles.kpiHint} numberOfLines={1}>{hint}</Text> : null}
    </Animated.View>
  );
}

function MiniStat({ icon, color, value, label }) {
  return (
    <View style={styles.miniStat}>
      <Ionicons name={icon} size={14} color={color} />
      <Text style={styles.miniStatValue}>{value}</Text>
      <Text style={styles.miniStatLabel}>{label}</Text>
    </View>
  );
}

function MatchRecordCard({ icon, accent, record, onPress, wide, label }) {
  const hasScore = record && Number.isFinite(Number(record.home_score)) && Number.isFinite(Number(record.away_score));
  const homeName = String(record?.home_team || record?.home_team_name || '').trim();
  const awayName = String(record?.away_team || record?.away_team_name || '').trim();
  const date = String(record?.date || '').trim() || formatHighlightDate(record?.kickoff_at);
  return (
    <TouchableOpacity
      style={[styles.recordCard, wide && styles.recordCardWide]}
      activeOpacity={onPress ? 0.78 : 1}
      disabled={!onPress}
      onPress={onPress}
    >
      <View style={[styles.recordIcon, { backgroundColor: `${accent}18` }]}>
        <Ionicons name={icon} size={14} color={accent} />
      </View>
      {label ? <Text style={styles.hlLabel}>{label}</Text> : null}
      {!hasScore ? (
        <Text style={styles.recordEmpty}>-</Text>
      ) : (
        <>
          <View style={styles.recordScoreRow}>
            <TeamLogoImage
              logoUrl={record.home_team_logo_url}
              logoPath={record.home_team_logo_path}
              style={styles.recordLogo}
              fallbackStyle={styles.recordLogoFallback}
              fallbackIconSize={12}
            />
            <Text style={styles.recordScore}>{Number(record.home_score)}-{Number(record.away_score)}</Text>
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
          ) : null}
          {date ? <Text style={styles.recordDate}>{date}</Text> : null}
        </>
      )}
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

  return (
    <View>
      <View style={styles.kpiGrid}>
        <KpiTile icon="calendar" color="#667eea" bg="#eef2ff" value={String(played)} hint="partite" delay={0} />
        <KpiTile
          pack="mci"
          icon="soccer"
          color="#15803d"
          bg="#ecfdf3"
          value={String(gf)}
          hint={played > 0 ? `${formatStatAvg(general?.goals_avg)} / p` : 'gol fatti'}
          delay={40}
        />
        <KpiTile
          icon="shield-outline"
          color="#b91c1c"
          bg="#fef2f2"
          value={String(ga)}
          hint={played > 0 ? `${formatStatAvg(general?.goals_conceded_avg)} / p` : 'gol subiti'}
          delay={80}
        />
        <KpiTile
          icon="swap-vertical"
          color="#0f766e"
          bg="#f0fdfa"
          value={`${gf - ga >= 0 ? '+' : ''}${gf - ga}`}
          hint="differenza"
          delay={120}
        />
      </View>

      <View style={styles.miniRow}>
        <MiniStat icon="square" color="#ca8a04" value={Number(general?.yellow_cards || 0)} label="Gialli" />
        <MiniStat icon="square" color="#dc2626" value={Number(general?.red_cards || 0)} label="Rossi" />
        <MiniStat icon="disc" color="#2563eb" value={Number(general?.penalties_for || 0)} label="Rigori +" />
        <MiniStat icon="alert-circle" color="#db2777" value={Number(general?.penalties_against || 0)} label="Rigori −" />
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

      <View style={styles.streakRow}>
        <View style={[styles.streakCard, { backgroundColor: '#fffbeb' }]}>
          <Ionicons name="flame" size={16} color="#d97706" />
          <Text style={styles.streakValue}>{winStreak > 0 ? winStreak : '-'}</Text>
          <Text style={styles.miniStatLabel}>Vittorie di fila</Text>
          {winStreak > 0 ? (
            <Text style={styles.streakDetail} numberOfLines={2}>
              {formatStreakRange(general?.longest_win_streak?.started_at, general?.longest_win_streak?.ended_at)}
            </Text>
          ) : null}
        </View>
        <View style={[styles.streakCard, { backgroundColor: '#f8fafc' }]}>
          <Ionicons name="trending-down" size={16} color="#64748b" />
          <Text style={styles.streakValue}>{lossStreak > 0 ? lossStreak : '-'}</Text>
          <Text style={styles.miniStatLabel}>Sconfitte di fila</Text>
          {lossStreak > 0 ? (
            <Text style={styles.streakDetail} numberOfLines={2}>
              {formatStreakRange(general?.longest_loss_streak?.started_at, general?.longest_loss_streak?.ended_at)}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.recordsGrid}>
        <MatchRecordCard
          label="Più larga"
          icon="trophy"
          accent="#15803d"
          record={general?.biggest_win}
          onPress={Number(general?.biggest_win?.match_id) > 0
            ? () => onPressMatch?.(Number(general.biggest_win.match_id))
            : null}
        />
        <MatchRecordCard
          label="Più pesante"
          icon="sad-outline"
          accent="#b91c1c"
          record={general?.heaviest_defeat}
          onPress={Number(general?.heaviest_defeat?.match_id) > 0
            ? () => onPressMatch?.(Number(general.heaviest_defeat.match_id))
            : null}
        />
        <MatchRecordCard
          wide
          label="Più gol"
          icon="flash"
          accent="#7c3aed"
          record={general?.highest_scoring_match}
          onPress={Number(general?.highest_scoring_match?.match_id) > 0
            ? () => onPressMatch?.(Number(general.highest_scoring_match.match_id))
            : null}
        />
      </View>
    </View>
  );
}

export const GROUP_STATS_BOARDS = [
  { key: 'scorers', label: 'Marcatori', shortLabel: 'Gol', pack: 'mci', icon: 'soccer', accent: '#15803d', empty: 'Nessun marcatore disponibile.' },
  { key: 'assistmen', label: 'Assistman', shortLabel: 'Assist', pack: 'mci', icon: 'shoe-cleat', accent: '#1d4ed8', empty: 'Nessun assist disponibile.' },
  { key: 'presences', label: 'Presenze', shortLabel: 'Pres.', pack: 'ion', icon: 'people', accent: '#667eea', empty: 'Nessuna presenza con voto nel periodo selezionato.' },
  { key: 'yellow_cards', label: 'Cartellini gialli', shortLabel: 'Gialli', pack: 'ion', icon: 'square', accent: '#ca8a04', empty: 'Nessun cartellino giallo disponibile.' },
  { key: 'red_cards', label: 'Cartellini rossi', shortLabel: 'Rossi', pack: 'ion', icon: 'square', accent: '#dc2626', empty: 'Nessun cartellino rosso disponibile.' },
  { key: 'penalty_goals', label: 'Rigori segnati', shortLabel: 'Rigori', pack: 'ion', icon: 'disc', accent: '#2563eb', empty: 'Nessun rigore segnato disponibile.' },
  { key: 'penalty_saved', label: 'Rigori parati', shortLabel: 'Parate', pack: 'ion', icon: 'hand-left-outline', accent: '#0f766e', empty: 'Nessun rigore parato disponibile.' },
  { key: 'match_wins', label: 'Partite vinte', shortLabel: 'Vinte', pack: 'ion', icon: 'trophy', accent: '#d97706', empty: 'Nessuna partita vinta disponibile.' },
  { key: 'edition_wins', label: 'Edizioni vinte', shortLabel: 'Coppe', pack: 'ion', icon: 'ribbon', accent: '#7c3aed', empty: 'Nessuna coppa vinta disponibile.' },
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
  const activeBoard = boards.find((b) => b.key === selectedBoard) || boards[0];
  const searchHits = useMemo(() => {
    if (!searching) return [];
    return boards
      .map((board) => ({
        board,
        items: (Array.isArray(board.items) ? board.items : []).filter((row) => rowMatchesQuery(row, normalizedQuery)),
      }))
      .filter((hit) => hit.items.length > 0);
  }, [boards, normalizedQuery, searching]);

  return (
    <View style={styles.root}>
      <YearChipBar years={years} selectedYear={selectedYear} onSelectYear={onSelectYear} />
      <StatsSearchBar
        value={query}
        onChange={(text) => {
          setQuery(text);
          setExpanded(false);
        }}
        placeholder="Cerca giocatore o squadra"
      />
      {!searching ? (
        <CategoryChips
          boards={boards}
          selectedKey={activeBoard?.key}
          onSelect={(key) => {
            setSelectedBoard(key);
            setExpanded(false);
          }}
        />
      ) : null}

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color="#667eea" />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {searching ? (
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
                      <IconGlyph pack={hit.board.pack} name={hit.board.icon} size={15} color={hit.board.accent} />
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

              <Text style={styles.sectionEyebrow}>Giocatori</Text>
              <TeaserStrip boards={boards} onSelect={(key) => {
                setSelectedBoard(key);
                setExpanded(false);
              }} />

              {activeBoard ? (
                <View>
                  <View style={styles.boardHead}>
                    <View style={[styles.boardIcon, { backgroundColor: `${activeBoard.accent}18` }]}>
                      <IconGlyph pack={activeBoard.pack} name={activeBoard.icon} size={16} color={activeBoard.accent} />
                    </View>
                    <Text style={styles.boardTitle}>{activeBoard.label}</Text>
                  </View>
                  <LeaderboardList
                    board={activeBoard}
                    expanded={expanded}
                    onToggleExpand={() => setExpanded((v) => !v)}
                    onPressPlayer={onPressPlayer}
                    query=""
                    animKey={`${selectedYear}-${activeBoard.key}`}
                  />
                </View>
              ) : null}
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
  yearChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  yearChipActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  yearChipAbsolute: { backgroundColor: '#fffbeb', borderColor: '#fde68a' },
  yearChipAbsoluteActive: { backgroundColor: '#d97706', borderColor: '#d97706' },
  yearChipText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  yearChipAbsoluteText: { color: '#b45309' },
  yearChipTextActive: { color: '#fff' },
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
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  kpiTile: {
    width: '48.6%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  kpiIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  kpiValue: { fontSize: 22, fontWeight: '800', color: '#0f172a', letterSpacing: -0.4 },
  kpiHint: { marginTop: 1, fontSize: 11, fontWeight: '700', color: '#64748b' },
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
  miniStatLabel: { fontSize: 9, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase' },
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
  streakRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  streakCard: {
    flex: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'flex-start',
    gap: 4,
  },
  streakValue: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  streakDetail: { fontSize: 10, fontWeight: '600', color: '#94a3b8' },
  recordsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8, marginTop: 8 },
  recordCard: {
    width: '48.6%',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ececec',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 92,
  },
  recordCardWide: { width: '100%' },
  recordIcon: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  recordEmpty: { fontSize: 16, fontWeight: '800', color: '#94a3b8' },
  recordScoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  recordLogo: { width: 22, height: 22 },
  recordLogoFallback: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordScore: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  recordNames: { marginTop: 4, fontSize: 10, fontWeight: '600', color: '#64748b', textAlign: 'center' },
  recordDate: { marginTop: 2, fontSize: 10, fontWeight: '600', color: '#94a3b8', textAlign: 'center' },
  teaserBlock: { marginBottom: 14 },
  teaserRow: { gap: 8, paddingRight: 4 },
  teaserCard: {
    width: 118,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ececec',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  teaserIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  teaserLabel: { fontSize: 10, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase' },
  teaserName: { marginTop: 2, fontSize: 12, fontWeight: '700', color: '#1e293b' },
  teaserValue: { marginTop: 2, fontSize: 18, fontWeight: '800' },
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
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  rankBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgePlain: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  rankBadgeText: { fontSize: 11, fontWeight: '800', color: '#64748b' },
  lbPhotoWrap: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden' },
  lbPhoto: { width: 32, height: 32, borderRadius: 16 },
  lbPhotoFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lbInitials: { fontSize: 10, fontWeight: '800' },
  lbMain: { flex: 1, minWidth: 0 },
  lbName: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  lbTeam: { fontSize: 10, color: '#64748b', marginTop: 1, marginBottom: 4 },
  lbValue: { fontSize: 16, fontWeight: '800', minWidth: 28, textAlign: 'right' },
  shareTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
    overflow: 'hidden',
    marginTop: 4,
  },
  shareFill: { height: '100%', borderRadius: 999 },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
  },
  expandText: { fontSize: 13, fontWeight: '800', color: '#667eea' },
});

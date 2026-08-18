import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { matchesService } from '../services/api';
import { TeamLogoImage, OfficialGroupLogoImage } from '../components/StableCachedImage';
import { EMPTY_OFFICIAL_KNOCKOUT, hasOfficialKnockoutBracket } from '../utils/knockoutBracket';
import OfficialKnockoutBracket from '../components/OfficialKnockoutBracket';
import { parseAppDate } from '../utils/dateTime';
import { matchDisplayScoreParts } from '../utils/matchDisplayScore';
import OfficialStatsExperience, {
  ABSOLUTE_STATS_KEY,
  GROUP_STATS_BOARDS,
  mapOfficialStatsBoards,
  StatsPeriodSelector,
} from '../components/officialStats/OfficialStatsExperience';

const EMPTY_TEAM_HIGHLIGHTS = {
  best_attack: null,
  best_defense: null,
  longest_win_streak: null,
  longest_loss_streak: null,
  highest_scoring_match: null,
  most_penalties_for: null,
  most_penalties_against: null,
  most_yellow_cards: null,
  most_red_cards: null,
};

const HALL_WINNERS_PREVIEW = 5;
const MATCH_LIST_ROW_HEIGHT = 127;
const MATCH_LIST_YEAR_HEIGHT = 34;
const MATCHES_LIST_CONTENT_PADDING_BOTTOM = 12;
const MATCHES_LIST_INITIAL_RENDER = 14;

function GroupLogo({ logoUrl, logoPath }) {
  return (
    <OfficialGroupLogoImage
      logoUrl={logoUrl}
      logoPath={logoPath}
      style={styles.logo}
      fallbackStyle={styles.logoFallback}
      fallbackIconSize={56}
    />
  );
}

function TeamRowLogo({ logoUrl, logoPath, style, fallbackStyle, fallbackIconSize }) {
  return (
    <TeamLogoImage
      logoUrl={logoUrl}
      logoPath={logoPath}
      style={style || styles.matchTeamLogo}
      fallbackStyle={fallbackStyle || styles.matchTeamLogoFallback}
      fallbackIconSize={fallbackIconSize}
    />
  );
}

function SeasonKnockoutLogo({ logoUrl, logoPath }) {
  return (
    <TeamLogoImage
      logoUrl={logoUrl}
      logoPath={logoPath}
      style={styles.seasonKnockoutLogo}
      fallbackStyle={styles.seasonKnockoutLogoFallback}
    />
  );
}

function SeasonKnockoutLogoAdapter({ logoUrl, logoPath }) {
  return <SeasonKnockoutLogo logoUrl={logoUrl} logoPath={logoPath} />;
}

function formatKickoffTime(iso) {
  const d = parseAppDate(iso);
  if (!d || Number.isNaN(d.getTime())) return '--:--';
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
}

const WEEKDAY_SHORT_IT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const MONTH_SHORT_IT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatMatchHeaderDate(iso, stageName) {
  const d = parseAppDate(iso);
  const stage = String(stageName || '').trim() || 'Partita';
  if (!d || Number.isNaN(d.getTime())) return stage;
  const now = new Date();
  const dayNow = startOfDay(now);
  const dayMatch = startOfDay(d);
  const diffDays = Math.round((dayMatch.getTime() - dayNow.getTime()) / (1000 * 60 * 60 * 24));
  let dateLabel = '';
  if (diffDays === 0) dateLabel = 'Oggi';
  else if (diffDays === -1) dateLabel = 'Ieri';
  else if (diffDays === 1) dateLabel = 'Domani';
  else {
    const wd = WEEKDAY_SHORT_IT[d.getDay()];
    const dm = d.getDate();
    const mon = MONTH_SHORT_IT[d.getMonth()];
    const y = d.getFullYear();
    dateLabel = y !== now.getFullYear() ? `${wd} ${dm} ${mon} ${y}` : `${wd} ${dm} ${mon}`;
  }
  return `${dateLabel} - ${stage}`;
}

function getMatchYear(iso) {
  const d = parseAppDate(iso);
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.getFullYear();
}

function getMatchStatusText(match) {
  const phase = String(match?.last_phase_type || '').trim();
  if (phase === 'match_end') {
    if (match?.is_walkover === true || match?.is_walkover === 1 || match?.is_walkover === '1') {
      return 'A tavolino';
    }
    return 'Partita\nterminata';
  }
  if (phase) return 'Partita in corso';
  return formatKickoffTime(match?.kickoff_at);
}

function TeamMatchScore({ score, shootoutScore }) {
  return (
    <View style={styles.matchScoreWrap}>
      <Text style={styles.matchScore}>{score}</Text>
      {shootoutScore != null ? (
        <>
          <View style={styles.matchShootoutDivider} />
          <Text style={styles.matchShootoutScore}>{shootoutScore}</Text>
        </>
      ) : null}
    </View>
  );
}

function buildMatchListItems(matches) {
  const list = Array.isArray(matches) ? matches : [];
  const items = [];
  list.forEach((m, idx) => {
    const matchYear = getMatchYear(m.kickoff_at);
    const previousMatchYear = idx > 0 ? getMatchYear(list[idx - 1]?.kickoff_at) : null;
    if (matchYear != null && matchYear !== previousMatchYear) {
      items.push({ type: 'year', key: `year-${matchYear}`, year: matchYear });
    }
    items.push({ type: 'match', key: `match-${m.id}`, match: m });
  });
  return items;
}

function computeMatchListLayouts(items) {
  let offset = 0;
  return items.map((item, index) => {
    const length = item.type === 'year' ? MATCH_LIST_YEAR_HEIGHT : MATCH_LIST_ROW_HEIGHT;
    const layout = { length, offset, index };
    offset += length;
    return layout;
  });
}

function resolveInitialMatchScrollIndex(items) {
  const now = Date.now();
  let idx = -1;
  items.forEach((item, i) => {
    if (item.type !== 'match') return;
    const d = parseAppDate(item.match?.kickoff_at);
    const t = d ? d.getTime() : NaN;
    if (Number.isFinite(t) && t <= now) idx = i;
  });
  return idx;
}

function computeMatchesListScrollOffset(targetIndex, layouts, viewportHeight) {
  if (targetIndex < 0 || !layouts.length) return 0;
  const anchorLayout = layouts[targetIndex];
  if (!anchorLayout) return 0;
  const lastLayout = layouts[layouts.length - 1];
  const contentHeight = lastLayout.offset + lastLayout.length + MATCHES_LIST_CONTENT_PADDING_BOTTOM;
  if (viewportHeight > 0) {
    const spaceBelow = Math.max(0, contentHeight - anchorLayout.offset);
    if (spaceBelow < viewportHeight) {
      return Math.max(0, contentHeight - viewportHeight);
    }
  }
  return anchorLayout.offset;
}

const GroupMatchRow = React.memo(function GroupMatchRow({ match, onPress }) {
  const isTerminated = String(match?.last_phase_type || '').trim() === 'match_end';
  const scoreParts = matchDisplayScoreParts(match);
  const hasScore = scoreParts.show;
  const statusText = getMatchStatusText(match);
  const showShootoutStatus = isTerminated && scoreParts.hasRig;

  return (
    <TouchableOpacity style={styles.matchRowCard} activeOpacity={0.75} onPress={() => onPress(match)}>
      <Text style={styles.matchTopMeta} numberOfLines={1}>
        {formatMatchHeaderDate(match.kickoff_at, match.match_stage)}
      </Text>
      <View style={styles.matchTopDivider} />
      <View style={styles.matchBodyRow}>
        <View style={styles.matchTeamsCol}>
          <View style={styles.matchTeamRow}>
            <TeamRowLogo logoUrl={match.home_team_logo_url} logoPath={match.home_team_logo_path} />
            <Text style={styles.matchTeamName} numberOfLines={1}>{match.home_team_name || '-'}</Text>
            {hasScore ? <TeamMatchScore score={scoreParts.listHome} shootoutScore={scoreParts.hasRig ? scoreParts.rigHome : null} /> : null}
          </View>
          <View style={[styles.matchTeamRow, styles.matchTeamRowSecond]}>
            <TeamRowLogo logoUrl={match.away_team_logo_url} logoPath={match.away_team_logo_path} />
            <Text style={styles.matchTeamName} numberOfLines={1}>{match.away_team_name || '-'}</Text>
            {hasScore ? <TeamMatchScore score={scoreParts.listAway} shootoutScore={scoreParts.hasRig ? scoreParts.rigAway : null} /> : null}
          </View>
        </View>
        <View style={styles.matchMetaCol}>
          <View style={[styles.matchMetaAccent, { backgroundColor: '#cbd5e1' }]} />
          <View style={styles.matchMetaTextWrap}>
            <Text style={styles.matchMetaText}>{statusText}</Text>
            {showShootoutStatus ? <Text style={styles.matchMetaShootoutText}>RIG.</Text> : null}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
});

function MatchYearDividerRow({ year }) {
  return (
    <View style={styles.matchYearDivider}>
      <View style={styles.matchYearDividerLine} />
      <Text style={styles.matchYearDividerText}>{year}</Text>
      <View style={styles.matchYearDividerLine} />
    </View>
  );
}

function MatchesLoadingSkeleton() {
  return (
    <View style={styles.matchesSkeletonWrap}>
      {Array.from({ length: 5 }, (_, i) => (
        <View key={`match-skeleton-${i}`} style={styles.matchRowSkeleton}>
          <View style={styles.skeletonLineShort} />
          <View style={styles.skeletonDivider} />
          <View style={styles.skeletonTeamRow}>
            <View style={styles.skeletonLogo} />
            <View style={styles.skeletonLineTeam} />
          </View>
          <View style={styles.skeletonTeamRow}>
            <View style={styles.skeletonLogo} />
            <View style={styles.skeletonLineTeam} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function OfficialGroupDetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const competitionId = Number(route?.params?.competitionId);
  const [activeTab, setActiveTab] = useState('matches');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [matchesListPositioned, setMatchesListPositioned] = useState(false);
  const [groupMatches, setGroupMatches] = useState([]);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonYears, setSeasonYears] = useState([]);
  const [selectedSeasonYear, setSelectedSeasonYear] = useState(null);
  const [seasonStandings, setSeasonStandings] = useState([]);
  const [seasonStandingsGroups, setSeasonStandingsGroups] = useState(null);
  const [seasonKnockout, setSeasonKnockout] = useState(EMPTY_OFFICIAL_KNOCKOUT);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsYears, setStatsYears] = useState([]);
  const [selectedStatsYear, setSelectedStatsYear] = useState(ABSOLUTE_STATS_KEY);
  const [statsScorers, setStatsScorers] = useState([]);
  const [statsAssistmen, setStatsAssistmen] = useState([]);
  const [statsPresences, setStatsPresences] = useState([]);
  const [statsYellowCards, setStatsYellowCards] = useState([]);
  const [statsRedCards, setStatsRedCards] = useState([]);
  const [statsPenaltyGoals, setStatsPenaltyGoals] = useState([]);
  const [statsPenaltySaved, setStatsPenaltySaved] = useState([]);
  const [statsMatchWins, setStatsMatchWins] = useState([]);
  const [statsEditionWins, setStatsEditionWins] = useState([]);
  const [statsTeamHighlights, setStatsTeamHighlights] = useState(EMPTY_TEAM_HIGHLIGHTS);
  const [hallLoading, setHallLoading] = useState(false);
  const [hallRanking, setHallRanking] = useState([]);
  const [hallWinnersByYear, setHallWinnersByYear] = useState([]);
  const [hallWineWinnersByYear, setHallWineWinnersByYear] = useState([]);
  const [hallWinnersExpanded, setHallWinnersExpanded] = useState(false);
  const [hallWineWinnersExpanded, setHallWineWinnersExpanded] = useState(false);
  const [hallRankingSort, setHallRankingSort] = useState('titles');
  const matchesListRef = useRef(null);
  const matchesLoadSeqRef = useRef(0);
  const seasonLoadSeqRef = useRef(0);
  const statsLoadSeqRef = useRef(0);
  const selectedSeasonYearRef = useRef(null);
  const selectedStatsYearRef = useRef(ABSOLUTE_STATS_KEY);
  const matchesViewportHeightRef = useRef(0);
  const initialMatchesScrollDoneRef = useRef(false);
  const pendingScrollIndexRef = useRef(null);

  const load = useCallback(async (showLoading = false) => {
    if (!competitionId) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      if (showLoading) setLoading(true);
      const res = await matchesService.getOfficialGroupDetail(competitionId);
      setData(res?.data || null);
    } finally {
      setLoading(false);
    }
  }, [competitionId]);

  // Solo al mount / cambio competitionId — niente secondo load al focus.
  useEffect(() => {
    void load(true);
  }, [load]);

  const loadGroupMatches = useCallback(async () => {
    if (!competitionId) return;
    matchesLoadSeqRef.current += 1;
    const seq = matchesLoadSeqRef.current;

    initialMatchesScrollDoneRef.current = false;
    setMatchesListPositioned(false);
    setMatchesLoading(true);
    try {
      const res = await matchesService.getOfficialGroupMatches(competitionId);
      if (seq !== matchesLoadSeqRef.current) return;

      const matches = Array.isArray(res?.data?.matches) ? res.data.matches : [];

      setGroupMatches(matches);
      pendingScrollIndexRef.current = resolveInitialMatchScrollIndex(buildMatchListItems(matches));
    } finally {
      if (seq === matchesLoadSeqRef.current) setMatchesLoading(false);
    }
  }, [competitionId]);

  useEffect(() => {
    if (!competitionId) return undefined;
    void loadGroupMatches();
    return () => {
      matchesLoadSeqRef.current += 1;
    };
  }, [competitionId, loadGroupMatches]);

  const loadSeasonStandings = useCallback(
    async (yearOverride = null) => {
      if (!competitionId) return;
      seasonLoadSeqRef.current += 1;
      const seq = seasonLoadSeqRef.current;
      const targetYear = yearOverride != null ? yearOverride : selectedSeasonYearRef.current;
      try {
        setSeasonLoading(true);
        const res = await matchesService.getOfficialGroupSeasonStandings(competitionId, targetYear);
        if (seq !== seasonLoadSeqRef.current) return;
        const years = Array.isArray(res?.data?.available_years) ? res.data.available_years : [];
        const standingsRows = Array.isArray(res?.data?.standings) ? res.data.standings : [];
        const groupsRaw = Array.isArray(res?.data?.standings_groups) ? res.data.standings_groups : null;
        const useTwoGroupTables = Boolean(groupsRaw && groupsRaw.length >= 2);
        const knockoutRows = res?.data?.knockout || { semifinals: [], final: null };
        const backendSelected = res?.data?.selected_year != null ? Number(res.data.selected_year) : null;
        setSeasonYears(years);
        setSeasonStandingsGroups(useTwoGroupTables ? groupsRaw : null);
        setSeasonStandings(useTwoGroupTables ? [] : standingsRows);
        setSeasonKnockout({
          quarterfinals: Array.isArray(knockoutRows?.quarterfinals) ? knockoutRows.quarterfinals : [],
          semifinals: Array.isArray(knockoutRows?.semifinals) ? knockoutRows.semifinals : [],
          final: knockoutRows?.final || null,
        });
        setSelectedSeasonYear((prev) => {
          if (yearOverride != null && Number.isFinite(Number(yearOverride))) return Number(yearOverride);
          if (backendSelected == null || !Number.isFinite(backendSelected)) return prev;
          return prev === backendSelected ? prev : backendSelected;
        });
      } catch (err) {
        if (seq !== seasonLoadSeqRef.current) return;
        console.error('Error loading group season standings:', err);
      } finally {
        if (seq === seasonLoadSeqRef.current) setSeasonLoading(false);
      }
    },
    [competitionId]
  );

  selectedSeasonYearRef.current = selectedSeasonYear;

  useEffect(() => {
    if (activeTab !== 'season') return;
    setSeasonPickerOpen(false);
    void loadSeasonStandings();
  }, [activeTab, loadSeasonStandings]);

  const loadGroupSeasonStats = useCallback(
    async (yearOverride = null) => {
      if (!competitionId) return;
      statsLoadSeqRef.current += 1;
      const seq = statsLoadSeqRef.current;
      const rawYear = yearOverride != null ? yearOverride : selectedStatsYearRef.current;
      const targetYear =
        rawYear === ABSOLUTE_STATS_KEY || String(rawYear || '').toLowerCase() === ABSOLUTE_STATS_KEY
          ? ABSOLUTE_STATS_KEY
          : rawYear;
      try {
        setStatsLoading(true);
        const res = await matchesService.getOfficialGroupSeasonStats(competitionId, targetYear);
        if (seq !== statsLoadSeqRef.current) return;
        const years = Array.isArray(res?.data?.available_years) ? res.data.available_years : [];
        const rawBackendSelected = res?.data?.selected_year;
        const backendSelected =
          String(rawBackendSelected || '').trim().toLowerCase() === ABSOLUTE_STATS_KEY
            ? ABSOLUTE_STATS_KEY
            : (rawBackendSelected != null ? Number(rawBackendSelected) : null);
        setStatsYears(years);
        setStatsScorers(Array.isArray(res?.data?.scorers) ? res.data.scorers : []);
        setStatsAssistmen(Array.isArray(res?.data?.assistmen) ? res.data.assistmen : []);
        setStatsPresences(Array.isArray(res?.data?.presences) ? res.data.presences : []);
        setStatsYellowCards(Array.isArray(res?.data?.yellow_cards) ? res.data.yellow_cards : []);
        setStatsRedCards(Array.isArray(res?.data?.red_cards) ? res.data.red_cards : []);
        setStatsPenaltyGoals(Array.isArray(res?.data?.penalty_goals) ? res.data.penalty_goals : []);
        setStatsPenaltySaved(Array.isArray(res?.data?.penalty_saved) ? res.data.penalty_saved : []);
        setStatsMatchWins(Array.isArray(res?.data?.match_wins) ? res.data.match_wins : []);
        setStatsEditionWins(Array.isArray(res?.data?.edition_wins) ? res.data.edition_wins : []);
        setStatsTeamHighlights(res?.data?.team_highlights && typeof res.data.team_highlights === 'object'
          ? { ...EMPTY_TEAM_HIGHLIGHTS, ...res.data.team_highlights }
          : EMPTY_TEAM_HIGHLIGHTS);
        setSelectedStatsYear((prev) => {
          if (yearOverride != null) {
            if (yearOverride === ABSOLUTE_STATS_KEY) return ABSOLUTE_STATS_KEY;
            if (Number.isFinite(Number(yearOverride))) return Number(yearOverride);
          }
          // Default tab Statistiche: resta su Assolute
          if (prev === ABSOLUTE_STATS_KEY || prev == null) return ABSOLUTE_STATS_KEY;
          if (backendSelected === ABSOLUTE_STATS_KEY) return ABSOLUTE_STATS_KEY;
          if (backendSelected == null || !Number.isFinite(backendSelected)) return prev;
          return prev === backendSelected ? prev : backendSelected;
        });
      } catch (err) {
        if (seq !== statsLoadSeqRef.current) return;
        console.error('Error loading group season stats:', err);
      } finally {
        if (seq === statsLoadSeqRef.current) setStatsLoading(false);
      }
    },
    [competitionId]
  );

  selectedStatsYearRef.current = selectedStatsYear;

  useEffect(() => {
    if (activeTab !== 'stats') return;
    void loadGroupSeasonStats();
  }, [activeTab, loadGroupSeasonStats]);

  const loadHallOfFame = useCallback(async () => {
    if (!competitionId) return;
    try {
      setHallLoading(true);
      const res = await matchesService.getOfficialGroupHallOfFame(competitionId);
      setHallRanking(Array.isArray(res?.data?.ranking) ? res.data.ranking : []);
      setHallWinnersByYear(Array.isArray(res?.data?.winners_by_year) ? res.data.winners_by_year : []);
      setHallWineWinnersByYear(
        Array.isArray(res?.data?.wine_winners_by_year) ? res.data.wine_winners_by_year : [],
      );
      setHallWinnersExpanded(false);
      setHallWineWinnersExpanded(false);
    } catch (err) {
      console.error('Error loading group hall of fame:', err);
      setHallRanking([]);
      setHallWinnersByYear([]);
      setHallWineWinnersByYear([]);
    } finally {
      setHallLoading(false);
    }
  }, [competitionId]);

  const openOfficialTeamDetail = useCallback((teamId, teamName) => {
    const tid = Number(teamId);
    if (!tid || tid <= 0 || !competitionId) return;
    const resolvedGroupName = String(
      data?.group?.name || route?.params?.groupName || '',
    ).trim();
    navigation.navigate('OfficialTeamDetail', {
      teamId: tid,
      competitionId,
      teamName: String(teamName || '').trim() || '-',
      groupName: resolvedGroupName || undefined,
    });
  }, [navigation, competitionId, data?.group?.name, route?.params?.groupName]);

  const openPlayerFromStatsRow = useCallback((row) => {
    const playerId = Number(row?.player_id);
    const leagueId = Number(row?.league_id);
    if (!playerId || !leagueId) return;
    navigation.navigate('PlayerStats', {
      playerId,
      leagueId,
      playerName: String(row?.name || '').trim() || undefined,
      playerPhotoPath: row?.photo_path || undefined,
      entrySource: 'official',
    });
  }, [navigation]);

  useEffect(() => {
    if (activeTab !== 'hall') return;
    void loadHallOfFame();
  }, [activeTab, loadHallOfFame]);

  const group = data?.group || {};
  const groupName = group.name || route?.params?.groupName || '-';

  const sortedHallRanking = useMemo(() => {
    const list = Array.isArray(hallRanking) ? [...hallRanking] : [];
    if (hallRankingSort === 'wine_trophies') {
      list.sort(
        (a, b) =>
          Number(b.wine_trophies || 0) - Number(a.wine_trophies || 0)
          || Number(b.titles || 0) - Number(a.titles || 0)
          || String(a.team_name || '').localeCompare(String(b.team_name || ''), 'it')
      );
    } else {
      list.sort(
        (a, b) =>
          Number(b.titles || 0) - Number(a.titles || 0)
          || Number(b.wine_trophies || 0) - Number(a.wine_trophies || 0)
          || String(a.team_name || '').localeCompare(String(b.team_name || ''), 'it')
      );
    }
    return list;
  }, [hallRanking, hallRankingSort]);

  const renderHallWinnersChronology = (items, title, expanded, onToggleExpand, listKey) => {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return null;
    const canExpand = list.length > HALL_WINNERS_PREVIEW;
    const visible = !canExpand || expanded ? list : list.slice(0, HALL_WINNERS_PREVIEW);
    return (
      <>
        <Text style={[styles.hallSectionTitle, styles.hallSectionTitleSpaced]}>{title}</Text>
        <View style={styles.hallYearsListWrap}>
          {visible.map((w, idx) => {
            const rowTeamId = Number(w?.team_id);
            const isLast = idx === visible.length - 1 && !canExpand;
            return (
              <View
                key={`${listKey}-${w.year}-${rowTeamId || idx}`}
                style={[styles.hallYearRow, isLast && styles.hallYearRowLast]}
              >
                <Text style={styles.hallYearLabel}>{w.year}</Text>
                <TouchableOpacity
                  style={styles.hallYearTeam}
                  activeOpacity={0.75}
                  disabled={!rowTeamId || rowTeamId <= 0}
                  onPress={() => openOfficialTeamDetail(rowTeamId, w.team_name)}
                >
                  <TeamRowLogo logoUrl={w.team_logo_url} logoPath={w.team_logo_path} />
                  <Text style={styles.hallYearTeamName} numberOfLines={1}>{w.team_name || '-'}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          {canExpand ? (
            <TouchableOpacity
              style={styles.hallChronologyExpandBtn}
              onPress={onToggleExpand}
              activeOpacity={0.7}
            >
              <Text style={styles.hallChronologyExpandText}>
                {expanded ? 'Mostra meno' : `Mostra tutti (${list.length})`}
              </Text>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#111827" />
            </TouchableOpacity>
          ) : null}
        </View>
      </>
    );
  };

  const statsBoards = useMemo(
    () => mapOfficialStatsBoards(GROUP_STATS_BOARDS, {
      scorers: statsScorers,
      assistmen: statsAssistmen,
      presences: statsPresences,
      yellow_cards: statsYellowCards,
      red_cards: statsRedCards,
      penalty_goals: statsPenaltyGoals,
      penalty_saved: statsPenaltySaved,
      match_wins: statsMatchWins,
      edition_wins: statsEditionWins,
    }),
    [
      statsScorers,
      statsAssistmen,
      statsPresences,
      statsYellowCards,
      statsRedCards,
      statsPenaltyGoals,
      statsPenaltySaved,
      statsMatchWins,
      statsEditionWins,
    ]
  );

  const matchListData = useMemo(() => buildMatchListItems(groupMatches), [groupMatches]);
  const matchListLayouts = useMemo(() => computeMatchListLayouts(matchListData), [matchListData]);
  const initialMatchScrollIndex = useMemo(() => resolveInitialMatchScrollIndex(matchListData), [matchListData]);

  const getMatchItemLayout = useCallback(
    (_, index) =>
      matchListLayouts[index] || {
        length: MATCH_LIST_ROW_HEIGHT,
        offset: index * MATCH_LIST_ROW_HEIGHT,
        index,
      },
    [matchListLayouts]
  );

  const tryApplyInitialMatchesScroll = useCallback(() => {
    if (initialMatchesScrollDoneRef.current) return;
    if (activeTab !== 'matches') return;
    if (!matchesListRef.current) return;
    if (matchListData.length === 0) {
      initialMatchesScrollDoneRef.current = true;
      setMatchesListPositioned(true);
      return;
    }
    if (matchesViewportHeightRef.current <= 0) return;

    const targetIndex = pendingScrollIndexRef.current ?? initialMatchScrollIndex;
    const offset = computeMatchesListScrollOffset(
      targetIndex,
      matchListLayouts,
      matchesViewportHeightRef.current
    );

    matchesListRef.current.scrollToOffset({ offset, animated: false });
    initialMatchesScrollDoneRef.current = true;
    pendingScrollIndexRef.current = null;
    setMatchesListPositioned(true);
  }, [activeTab, matchListData.length, initialMatchScrollIndex, matchListLayouts]);

  const handleMatchesListLayout = useCallback(
    (e) => {
      matchesViewportHeightRef.current = e.nativeEvent.layout.height;
      tryApplyInitialMatchesScroll();
    },
    [tryApplyInitialMatchesScroll]
  );

  const handleMatchesListContentSizeChange = useCallback(() => {
    tryApplyInitialMatchesScroll();
  }, [tryApplyInitialMatchesScroll]);

  useLayoutEffect(() => {
    if (activeTab !== 'matches' || matchesLoading) return;
    initialMatchesScrollDoneRef.current = false;
    if (matchListData.length === 0) {
      initialMatchesScrollDoneRef.current = true;
      setMatchesListPositioned(true);
      return;
    }
    setMatchesListPositioned(false);
    const raf = requestAnimationFrame(() => {
      tryApplyInitialMatchesScroll();
    });
    return () => cancelAnimationFrame(raf);
  }, [activeTab, matchesLoading, matchListData.length, tryApplyInitialMatchesScroll]);

  const handleGroupMatchPress = useCallback(
    (match) => {
      navigation.navigate('MatchDetail', {
        matchId: Number(match.id),
        from: 'official-group',
        competitionId,
        groupName,
      });
    },
    [navigation, competitionId, groupName]
  );

  const renderMatchListItem = useCallback(
    ({ item }) => {
      if (item.type === 'year') {
        return <MatchYearDividerRow year={item.year} />;
      }
      return <GroupMatchRow match={item.match} onPress={handleGroupMatchPress} />;
    },
    [handleGroupMatchPress]
  );

  const hasSeasonKnockoutBracket = hasOfficialKnockoutBracket(seasonKnockout);

  const seasonKnockoutBlockStyles = useMemo(
    () => ({
      knockoutSemiBlock: styles.seasonKnockoutSemiBlock,
      knockoutSemiLabelRow: styles.seasonKnockoutSemiLabelRow,
      knockoutSemiSmallLabel: styles.seasonKnockoutSemiSmallLabel,
      knockoutMatchStackMeasure: styles.seasonKnockoutMatchStackMeasure,
      knockoutTieStack: styles.seasonKnockoutTieStack,
      knockoutTwoLegScoreCols: styles.seasonKnockoutTwoLegScoreCols,
      knockoutLegColLabel: styles.seasonKnockoutLegColLabel,
      knockoutLegColLabelFallbackSlot: styles.seasonKnockoutLegColLabelFallbackSlot,
      knockoutMatchStack: styles.seasonKnockoutMatchStack,
      knockoutTeamBox: styles.seasonKnockoutTeamBox,
      knockoutTeamRow: styles.seasonKnockoutTeamRow,
      knockoutLogoPlaceholder: styles.seasonKnockoutLogoPlaceholder,
      knockoutTeamText: styles.seasonKnockoutTeamText,
      knockoutScoreBox: styles.seasonKnockoutScoreBox,
      knockoutScoreTextRow: styles.seasonKnockoutScoreTextRow,
      knockoutScoreText: styles.seasonKnockoutScoreText,
      knockoutShootoutDivider: styles.seasonKnockoutShootoutDivider,
      knockoutShootoutScoreText: styles.seasonKnockoutShootoutScoreText,
      knockoutAggregateText: styles.seasonKnockoutAggregateText,
    }),
    []
  );

  const seasonKnockoutLayout = useMemo(
    () => ({
      headerRow: styles.seasonKnockoutHeaderRow,
      columnTitle: styles.seasonKnockoutColumnTitle,
      columnTitleWide: styles.seasonKnockoutColumnTitleWide,
      columnTitleSpacer: styles.seasonKnockoutColumnTitleSpacer,
      columnTitleSpacerCompact: styles.seasonKnockoutColumnTitleSpacerCompact,
      stageColumnTitle: styles.seasonKnockoutStageColumnTitle,
      semiLabelRow: styles.seasonKnockoutSemiLabelRow,
      twoLegScoreCols: styles.seasonKnockoutTwoLegScoreCols,
      finalHeaderCol: styles.seasonKnockoutFinalHeaderCol,
      finalColStack: styles.seasonKnockoutFinalColStack,
      finalColBody: styles.seasonKnockoutFinalColBody,
      finalMatchWrap: styles.seasonKnockoutFinalMatchWrap,
      bracketRow: styles.seasonKnockoutBracketRow,
      bracketScroll: styles.seasonKnockoutBracketScroll,
      bracketScrollContent: styles.seasonKnockoutBracketScrollContent,
      stageCol: styles.seasonKnockoutSemisCol,
      stageColWide: styles.seasonKnockoutSemisColWide,
      stageColScroll: styles.seasonKnockoutStageColScroll,
      flowCol: styles.seasonKnockoutFlowCol,
      flowColTall: styles.seasonKnockoutFlowColTall,
      flowColCompact: styles.seasonKnockoutFlowColCompact,
      flowColStraightStack: styles.seasonKnockoutFlowStraightStack,
      flowColStraightStackTall: styles.seasonKnockoutFlowStraightStackTall,
      flowStraightHeaderSpacer: styles.seasonKnockoutFlowStraightHeaderSpacer,
      flowStraightTieSlot: styles.seasonKnockoutFlowStraightTieSlot,
      flowStraightTieSlotTall: styles.seasonKnockoutFlowStraightTieSlotTall,
      flowStraightFirstTieSlot: styles.seasonKnockoutFlowStraightFirstTieSlot,
      flowStraightSecondTieSlot: styles.seasonKnockoutFlowStraightSecondTieSlot,
      flowStraightSecondTieSlotTall: styles.seasonKnockoutFlowStraightSecondTieSlotTall,
      flowStraightLine: styles.seasonKnockoutFlowStraightLine,
      flowStraightLineTall: styles.seasonKnockoutFlowStraightLineTall,
      flowStraightLineCompact: styles.seasonKnockoutFlowStraightLineCompact,
      flowColSemiFinal: styles.seasonKnockoutFlowColSemiFinal,
      flowColSemiFinalTall: styles.seasonKnockoutFlowColSemiFinalTall,
      middleArmSemiFinal: styles.seasonKnockoutBracketMiddleArmSemiFinal,
      middleArmSemiFinalTall: styles.seasonKnockoutBracketMiddleArmSemiFinalTall,
      bracketTopArm: styles.seasonKnockoutBracketTopArm,
      bracketTopArmCompact: styles.seasonKnockoutBracketTopArmCompact,
      bracketTopArmCompactTall: styles.seasonKnockoutBracketTopArmCompactTall,
      bracketBottomArm: styles.seasonKnockoutBracketBottomArm,
      bracketBottomArmCompact: styles.seasonKnockoutBracketBottomArmCompact,
      bracketBottomArmCompactTall: styles.seasonKnockoutBracketBottomArmCompactTall,
      bracketVertical: styles.seasonKnockoutBracketVertical,
      bracketVerticalCompact: styles.seasonKnockoutBracketVerticalCompact,
      bracketVerticalCompactTall: styles.seasonKnockoutBracketVerticalCompactTall,
      bracketMiddleArm: styles.seasonKnockoutBracketMiddleArm,
      bracketMiddleArmCompact: styles.seasonKnockoutBracketMiddleArmCompact,
      bracketMiddleArmCompactTall: styles.seasonKnockoutBracketMiddleArmCompactTall,
      finalCol: styles.seasonKnockoutFinalCol,
      finalLabelRow: styles.seasonKnockoutFinalLabelRow,
      matchStackMeasure: styles.seasonKnockoutMatchStackMeasure,
      matchStack: styles.seasonKnockoutMatchStack,
      teamBox: styles.seasonKnockoutTeamBox,
      teamRow: styles.seasonKnockoutTeamRow,
      teamText: styles.seasonKnockoutTeamText,
      scoreBox: styles.seasonKnockoutScoreBox,
      logoPlaceholder: styles.seasonKnockoutLogoPlaceholder,
      logoSize: 30,
    }),
    []
  );

  const handleBackNavigation = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return true;
    }
    navigation.navigate('MainTabs', { screen: 'Partite' });
    return true;
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      const backSub = BackHandler.addEventListener('hardwareBackPress', () => handleBackNavigation());
      return () => backSub.remove();
    }, [handleBackNavigation])
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 6, 12) }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleBackNavigation}>
          <Ionicons name="arrow-back" size={20} color="#333" />
        </TouchableOpacity>
      </View>

      <View style={styles.heroCard}>
        {loading && !group.logo_path && !group.logo_url ? (
          <View style={styles.logoFallback}>
            <ActivityIndicator color="#667eea" />
          </View>
        ) : (
          <GroupLogo logoUrl={group.logo_url} logoPath={group.logo_path} />
        )}
        <Text style={styles.groupName} numberOfLines={2}>
          {groupName}
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsScrollContent}>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'matches' && styles.tabBtnActive]} onPress={() => setActiveTab('matches')}>
          <Text style={[styles.tabText, activeTab === 'matches' && styles.tabTextActive]}>Partite</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'season' && styles.tabBtnActive]} onPress={() => setActiveTab('season')}>
          <Text style={[styles.tabText, activeTab === 'season' && styles.tabTextActive]}>Stagione</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'stats' && styles.tabBtnActive]} onPress={() => setActiveTab('stats')}>
          <Text style={[styles.tabText, activeTab === 'stats' && styles.tabTextActive]}>Statistiche</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'hall' && styles.tabBtnActive]} onPress={() => setActiveTab('hall')}>
          <Text style={[styles.tabText, activeTab === 'hall' && styles.tabTextActive]}>Albo d&apos;oro</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={[styles.content, activeTab === 'hall' && styles.contentHall]}>
        {activeTab === 'matches' ? (
          <View style={[styles.card, styles.matchesCard]}>
            {matchesLoading ? (
              <MatchesLoadingSkeleton />
            ) : (
              <FlatList
                ref={matchesListRef}
                data={matchListData}
                keyExtractor={(item) => item.key}
                renderItem={renderMatchListItem}
                style={[styles.matchesList, !matchesListPositioned && styles.matchesListHidden]}
                contentContainerStyle={styles.matchesListContent}
                showsVerticalScrollIndicator={false}
                getItemLayout={getMatchItemLayout}
                onLayout={handleMatchesListLayout}
                onContentSizeChange={handleMatchesListContentSizeChange}
                initialNumToRender={MATCHES_LIST_INITIAL_RENDER}
                maxToRenderPerBatch={12}
                windowSize={9}
                removeClippedSubviews
                ListEmptyComponent={
                  <Text style={styles.placeholderText}>Nessuna partita disponibile.</Text>
                }
              />
            )}
          </View>
        ) : activeTab === 'season' ? (
          <ScrollView
            style={styles.seasonScroll}
            contentContainerStyle={[styles.seasonScrollContent, { paddingBottom: Math.max(insets.bottom, 5) }]}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.card, styles.seasonCard]}>
              <StatsPeriodSelector
                years={seasonYears}
                selectedYear={selectedSeasonYear}
                showAbsolute={false}
                style={styles.seasonPickerWrap}
                onSelectYear={(year) => {
                  setSelectedSeasonYear(year);
                  selectedSeasonYearRef.current = year;
                  void loadSeasonStandings(year);
                }}
              />
              {seasonLoading ? (
                <View style={styles.matchesLoadingBox}>
                  <ActivityIndicator color="#667eea" />
                </View>
              ) : (() => {
                const split = Array.isArray(seasonStandingsGroups) && seasonStandingsGroups.length >= 2;
                const blocks = split
                  ? seasonStandingsGroups.map((g, idx) => ({
                      label: String(g?.label || (idx === 0 ? 'Girone A' : 'Girone B')).trim() || (idx === 0 ? 'Girone A' : 'Girone B'),
                      standings: Array.isArray(g?.standings) ? g.standings : [],
                      key: `g-${g?.girone_index ?? idx}`,
                    }))
                  : [{ label: null, standings: seasonStandings, key: 'single' }];
                const anyRows = blocks.some((b) => (b.standings || []).length > 0);
                if (!anyRows) {
                  return <Text style={styles.placeholderText}>Nessuna classifica disponibile per la stagione selezionata.</Text>;
                }
                return (
                  <View style={styles.seasonStandingsTablesCol}>
                    {blocks.map((block) => (
                      <View key={block.key} style={styles.seasonStandingsTableBlock}>
                        {block.label ? <Text style={styles.seasonGironeTitle}>{block.label}</Text> : null}
                        <View style={styles.seasonTableWrap}>
                          <View style={styles.seasonTableHeader}>
                            <Text style={[styles.seasonTh, styles.seasonThPos, { textAlign: 'center' }]}>Pos.</Text>
                            <Text style={[styles.seasonTh, { flex: 1 }]}>Squadra</Text>
                            <Text style={[styles.seasonTh, styles.seasonThStat, { textAlign: 'center' }]}>PG</Text>
                            <Text style={[styles.seasonTh, styles.seasonThStat, { textAlign: 'center' }]}>GF</Text>
                            <Text style={[styles.seasonTh, styles.seasonThStat, { textAlign: 'center' }]}>GS</Text>
                            <Text style={[styles.seasonTh, styles.seasonThStat, { textAlign: 'center' }]}>DR</Text>
                            <Text style={[styles.seasonTh, styles.seasonThStat, styles.seasonThPt, { textAlign: 'center' }]}>PT</Text>
                          </View>
                          {block.standings.map((r, i) => {
                            const rowTeamId = Number(r?.team_id);
                            const isLastRow = i === block.standings.length - 1;
                            return (
                              <View key={`${block.key}-st-${i}`} style={[styles.seasonTableRow, isLastRow && styles.seasonTableRowLast]}>
                                <Text style={[styles.seasonTd, styles.seasonTdPos, { textAlign: 'center' }]}>{r.position}</Text>
                                <TouchableOpacity
                                  style={[styles.teamCell, styles.seasonTeamCell, { flex: 1 }]}
                                  activeOpacity={0.75}
                                  disabled={!rowTeamId || rowTeamId <= 0}
                                  onPress={() => {
                                    if (!rowTeamId || rowTeamId <= 0) return;
                                    navigation.navigate('OfficialTeamDetail', {
                                      teamId: rowTeamId,
                                      competitionId,
                                      teamName: String(r.team_name_display || r.team_name || '').trim() || '-',
                                      groupName: String(groupName || '').trim() || undefined,
                                    });
                                  }}
                                >
                                  <TeamRowLogo logoUrl={r.team_logo_url} logoPath={r.team_logo_path} />
                                  <Text style={[styles.seasonTd, styles.seasonTdTeamName]} numberOfLines={1} ellipsizeMode="tail">
                                    {r.team_name_display || r.team_name || '-'}
                                  </Text>
                                </TouchableOpacity>
                                <Text style={[styles.seasonTd, styles.seasonTdStat, { textAlign: 'center' }]}>{r.played}</Text>
                                <Text style={[styles.seasonTd, styles.seasonTdStat, { textAlign: 'center' }]}>{r.gf ?? 0}</Text>
                                <Text style={[styles.seasonTd, styles.seasonTdStat, { textAlign: 'center' }]}>{r.gs ?? r.ga ?? 0}</Text>
                                <Text style={[styles.seasonTd, styles.seasonTdStat, { textAlign: 'center' }]}>{r.goal_diff}</Text>
                                <Text style={[styles.seasonTd, styles.seasonTdStat, styles.seasonTdPt, { textAlign: 'center' }]}>{r.points}</Text>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    ))}
                  </View>
                );
              })()}
            </View>
            {!seasonLoading && hasSeasonKnockoutBracket ? (
              <View style={[styles.card, styles.seasonKnockoutCard]}>
                <Text style={styles.seasonKnockoutTitle}>Fasi finali</Text>
                <OfficialKnockoutBracket
                  knockout={seasonKnockout}
                  onPressMatch={(matchId) =>
                    navigation.navigate('MatchDetail', { matchId: Number(matchId), from: 'official-group-season' })
                  }
                  LogoComponent={SeasonKnockoutLogoAdapter}
                  tieBlockStyles={seasonKnockoutBlockStyles}
                  layoutStyles={seasonKnockoutLayout}
                />
              </View>
            ) : null}
          </ScrollView>
        ) : activeTab === 'stats' ? (
          <View style={[styles.card, styles.teamCard, styles.statsCard]}>
            <OfficialStatsExperience
              loading={statsLoading}
              years={statsYears}
              selectedYear={selectedStatsYear}
              onSelectYear={(value) => {
                setSelectedStatsYear(value);
                selectedStatsYearRef.current = value;
                void loadGroupSeasonStats(value);
              }}
              boards={statsBoards}
              teamHighlights={statsTeamHighlights}
              onPressPlayer={openPlayerFromStatsRow}
              onPressTeam={openOfficialTeamDetail}
              onPressMatch={(matchId) => navigation.navigate('MatchDetail', {
                matchId: Number(matchId),
                from: 'official-group',
                competitionId,
                groupName,
              })}
            />
          </View>
        ) : (
          <View style={[styles.teamCard, styles.hallCard]}>
            {hallLoading ? (
              <View style={styles.matchesLoadingBox}>
                <ActivityIndicator color="#667eea" />
              </View>
            ) : hallRanking.length === 0 && hallWinnersByYear.length === 0 && hallWineWinnersByYear.length === 0 ? (
              <Text style={styles.placeholderText}>Nessun vincitore di finale registrato.</Text>
            ) : (
              <ScrollView
                contentContainerStyle={[styles.hallScrollContent, { paddingBottom: Math.max(insets.bottom, 12) }]}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.hallSectionTitle}>Classifica titoli</Text>
                <View style={styles.hallTableWrap}>
                  <View style={[styles.seasonTableHeader, styles.hallTableHeader]}>
                    <Text style={[styles.seasonTh, styles.hallThPos, { textAlign: 'center' }]}>Pos.</Text>
                    <Text style={[styles.seasonTh, styles.hallThTeam, { flex: 1 }]}>Squadra</Text>
                    <TouchableOpacity
                      style={styles.hallSortableTh}
                      activeOpacity={0.7}
                      onPress={() => setHallRankingSort('titles')}
                    >
                      <View style={styles.hallSortableThInner}>
                        <Text
                          style={[
                            styles.seasonTh,
                            styles.hallThTitoli,
                            hallRankingSort === 'titles' && styles.hallThSortActive,
                            { textAlign: 'center' },
                          ]}
                          numberOfLines={2}
                        >
                          {groupName}
                        </Text>
                        {hallRankingSort === 'titles' ? (
                          <Ionicons name="caret-down" size={11} color="#4f46e5" style={styles.hallSortCaret} />
                        ) : null}
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.hallSortableThWine}
                      activeOpacity={0.7}
                      onPress={() => setHallRankingSort('wine_trophies')}
                    >
                      <View style={styles.hallSortableThInnerWine}>
                        <Text
                          style={[
                            styles.seasonTh,
                            styles.hallThWine,
                            hallRankingSort === 'wine_trophies' && styles.hallThSortActive,
                            { textAlign: 'center' },
                          ]}
                          numberOfLines={2}
                        >
                          Trofeo del Vino
                        </Text>
                        {hallRankingSort === 'wine_trophies' ? (
                          <Ionicons name="caret-down" size={11} color="#4f46e5" style={styles.hallSortCaret} />
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  </View>
                  {sortedHallRanking.map((r, i) => {
                    const rowTeamId = Number(r?.team_id);
                    return (
                    <View
                      key={`hall-rank-${String(r.team_name || i)}`}
                      style={[styles.seasonTableRow, styles.hallTableRow, i === sortedHallRanking.length - 1 && styles.seasonTableRowLast]}
                    >
                      <View style={styles.hallPosCol}>
                        <Text style={[styles.seasonTd, styles.hallTdPos]}>{i + 1}</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.teamCell, styles.hallTeamCell, { flex: 1 }]}
                        activeOpacity={0.75}
                        disabled={!rowTeamId || rowTeamId <= 0}
                        onPress={() => openOfficialTeamDetail(rowTeamId, r.team_name)}
                      >
                        <TeamRowLogo
                          logoUrl={r.team_logo_url}
                          logoPath={r.team_logo_path}
                          style={styles.hallTeamLogo}
                          fallbackStyle={styles.hallTeamLogoFallback}
                          fallbackIconSize={22}
                        />
                        <View style={styles.hallTeamTextCol}>
                          <Text style={styles.hallTeamName} numberOfLines={2} ellipsizeMode="tail">
                            {r.team_name || '-'}
                          </Text>
                          {Array.isArray(r.years) && r.years.length > 0 ? (
                            <Text style={styles.hallYearsText}>
                              {r.years.join(', ')}
                            </Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                      <View style={styles.hallMetricCol}>
                        <Text style={[styles.seasonTd, styles.hallTdTitoli]}>{r.titles ?? 0}</Text>
                      </View>
                      <View style={styles.hallMetricColWine}>
                        <Text style={[styles.seasonTd, styles.hallTdWine]}>{r.wine_trophies ?? 0}</Text>
                      </View>
                    </View>
                    );
                  })}
                </View>
                {renderHallWinnersChronology(
                  hallWinnersByYear,
                  `Cronologia vincitori ${groupName}`,
                  hallWinnersExpanded,
                  () => setHallWinnersExpanded((prev) => !prev),
                  'hall-champ',
                )}
                {renderHallWinnersChronology(
                  hallWineWinnersByYear,
                  'Cronologia vincitori Trofeo del Vino',
                  hallWineWinnersExpanded,
                  () => setHallWineWinnersExpanded((prev) => !prev),
                  'hall-wine',
                )}
              </ScrollView>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ececec',
    paddingHorizontal: 14,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroCard: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#ececec',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    minHeight: 150,
  },
  logo: { width: 92, height: 92 },
  logoFallback: {
    width: 92,
    height: 92,
    borderRadius: 16,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupName: { marginTop: 10, fontSize: 21, fontWeight: '800', color: '#222', textAlign: 'center' },
  tabsScroll: { marginTop: 8, maxHeight: 46 },
  tabsScrollContent: { paddingHorizontal: 12, paddingBottom: 4, gap: 8, alignItems: 'center' },
  tabBtn: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  tabBtnActive: { borderColor: '#667eea', backgroundColor: '#eef2ff' },
  tabText: { color: '#475569', fontWeight: '700', fontSize: 13 },
  tabTextActive: { color: '#667eea' },
  content: { flex: 1, paddingHorizontal: 12, paddingBottom: 12 },
  contentHall: { paddingBottom: 0 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ececec',
    padding: 16,
    minHeight: 130,
  },
  matchesCard: { flex: 1, minHeight: 0, paddingTop: 8, paddingBottom: 8, paddingHorizontal: 0 },
  teamCard: { flex: 1, minHeight: 0 },
  statsCard: { paddingHorizontal: 10, paddingTop: 12, paddingBottom: 12 },
  seasonCard: { flex: 1, minHeight: 0, paddingHorizontal: 8, paddingTop: 12, paddingBottom: 12 },
  seasonScroll: { flex: 1, marginHorizontal: -12 },
  seasonScrollContent: { paddingBottom: 8, paddingHorizontal: 12 },
  matchesLoadingBox: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  matchesSkeletonWrap: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 12 },
  matchRowSkeleton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ececec',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  skeletonLineShort: {
    width: '42%',
    height: 10,
    borderRadius: 5,
    backgroundColor: '#eef2f7',
    marginBottom: 10,
  },
  skeletonDivider: { height: 1, backgroundColor: '#f1f5f9', marginBottom: 12 },
  skeletonTeamRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  skeletonLogo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#eef2f7',
    marginRight: 10,
  },
  skeletonLineTeam: { flex: 1, height: 12, borderRadius: 6, backgroundColor: '#eef2f7' },
  matchesList: { flex: 1 },
  matchesListHidden: { opacity: 0 },
  matchesListContent: { paddingBottom: MATCHES_LIST_CONTENT_PADDING_BOTTOM, width: '100%' },
  placeholderText: { color: '#64748b', fontSize: 14, textAlign: 'center', marginTop: 8 },
  matchYearDivider: {
    height: MATCH_LIST_YEAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  matchYearDividerLine: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#cbd5e1' },
  matchYearDividerText: { marginHorizontal: 12, fontSize: 13, fontWeight: '900', color: '#334155', letterSpacing: 0.6 },
  matchRowCard: {
    height: MATCH_LIST_ROW_HEIGHT - 10,
    flexDirection: 'column',
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: '#ffffff',
  },
  matchTopMeta: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 8 },
  matchTopDivider: { height: 1, backgroundColor: '#e5e7eb', width: '100%', marginBottom: 8 },
  matchBodyRow: { flexDirection: 'row', alignItems: 'center', minHeight: 60 },
  matchTeamsCol: { flex: 1, gap: 4 },
  matchTeamRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  matchTeamRowSecond: { marginTop: 6, paddingTop: 6 },
  matchTeamLogo: { width: 24, height: 24 },
  matchTeamLogoFallback: { width: 24, height: 24, borderRadius: 6, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  matchTeamName: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600', color: '#1f2937' },
  matchScoreWrap: { minWidth: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
  matchScore: { textAlign: 'right', fontSize: 15, fontWeight: '800', color: '#0f172a' },
  matchShootoutDivider: { width: 1, height: 14, backgroundColor: '#d1d5db' },
  matchShootoutScore: { fontSize: 11, fontWeight: '800', color: '#9ca3af' },
  matchMetaCol: { minWidth: 118, paddingLeft: 4, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  matchMetaAccent: { width: 4, height: 60, borderRadius: 3, marginRight: 6, alignSelf: 'center' },
  matchMetaTextWrap: { minWidth: 92, alignItems: 'center', justifyContent: 'center' },
  matchMetaText: { fontSize: 12, fontWeight: '700', color: '#475569', textAlign: 'center', lineHeight: 16 },
  matchMetaShootoutText: { marginTop: 4, fontSize: 12, fontWeight: '900', color: '#0f172a', textAlign: 'center', letterSpacing: 0.4 },
  seasonPickerWrap: { marginBottom: 10 },
  seasonStandingsTablesCol: { gap: 14 },
  seasonStandingsTableBlock: { width: '100%' },
  seasonGironeTitle: { fontSize: 15, fontWeight: '800', color: '#111827', marginBottom: 8 },
  seasonTableWrap: {
    marginTop: 2,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    overflow: 'hidden',
  },
  seasonTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 4,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  seasonTh: { fontSize: 12, fontWeight: '700', color: '#475569' },
  seasonThPos: { width: 44 },
  seasonThStat: { width: 28 },
  seasonThPt: { color: '#334155' },
  seasonTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 4,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  seasonTableRowLast: { borderBottomWidth: 0 },
  seasonTd: { fontSize: 13, fontWeight: '400', color: '#1f2937' },
  seasonTdPos: { width: 44, fontWeight: '600' },
  seasonTdStat: { width: 28 },
  seasonTdPt: { fontWeight: '700' },
  seasonTdTeamName: { flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: '600' },
  teamCell: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  seasonTeamCell: { gap: 6 },
  seasonKnockoutCard: {
    marginTop: 12,
    marginHorizontal: -8,
    borderRadius: 12,
    paddingTop: 12,
    paddingHorizontal: 5,
    paddingBottom: 6,
  },
  seasonKnockoutTitle: { fontSize: 16, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 6 },
  seasonKnockoutHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  seasonKnockoutColumnTitle: { flex: 1.2, fontSize: 12, fontWeight: '800', color: '#6b7280', textTransform: 'uppercase' },
  seasonKnockoutStageColumnTitle: { fontSize: 12, fontWeight: '800', color: '#6b7280', textTransform: 'uppercase', marginBottom: 4, alignSelf: 'flex-start' },
  seasonKnockoutFinalHeaderCol: { flex: 1.08, alignSelf: 'flex-start', marginLeft: -2 },
  seasonKnockoutFinalColStack: { justifyContent: 'flex-start', paddingTop: 0, alignSelf: 'stretch' },
  seasonKnockoutFinalColBody: { paddingTop: 0, justifyContent: 'flex-start' },
  seasonKnockoutFinalMatchWrap: { flex: 1, justifyContent: 'center', paddingTop: 20, width: '100%' },
  seasonKnockoutColumnTitleWide: { flex: 1.35 },
  seasonKnockoutColumnTitleSpacer: { width: 56 },
  seasonKnockoutColumnTitleSpacerCompact: { width: 28 },
  seasonKnockoutBracketScroll: { marginHorizontal: -4 },
  seasonKnockoutBracketScrollContent: { paddingRight: 12, paddingBottom: 14 },
  seasonKnockoutBracketRow: { flexDirection: 'row', alignItems: 'stretch', gap: 0 },
  seasonKnockoutSemisCol: { flex: 1.2, gap: 10, alignSelf: 'flex-start', marginRight: -2 },
  seasonKnockoutStageColScroll: { width: 200, gap: 10, alignSelf: 'flex-start', marginRight: -2, flexShrink: 0 },
  seasonKnockoutSemisColWide: { flex: 1.35, marginRight: 0 },
  seasonKnockoutSemiBlock: { flexGrow: 0, flexShrink: 0 },
  seasonKnockoutFinalCol: { flex: 1.08, alignSelf: 'stretch', justifyContent: 'center', paddingTop: 20, marginLeft: -2 },
  seasonKnockoutSemiLabelRow: {
    marginBottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 6,
  },
  seasonKnockoutSemiSmallLabel: { fontSize: 11, fontWeight: '800', color: '#6b7280', textTransform: 'uppercase' },
  seasonKnockoutFlowCol: {
    width: 56,
    height: 112,
    marginTop: 46,
    position: 'relative',
  },
  seasonKnockoutFlowColTall: {
    height: 152,
    marginTop: 42,
  },
  seasonKnockoutFlowColCompact: { width: 28 },
  seasonKnockoutFlowColStraightStack: {
    width: 56,
    alignSelf: 'flex-start',
    gap: 10,
  },
  seasonKnockoutFlowColStraightStackTall: {},
  seasonKnockoutFlowStraightHeaderSpacer: { height: 22 },
  seasonKnockoutFlowStraightTieSlot: {
    minHeight: 76,
    justifyContent: 'center',
    alignItems: 'center',
  },
  seasonKnockoutFlowStraightFirstTieSlot: {
    justifyContent: 'flex-start',
    paddingTop: 50,
  },
  seasonKnockoutFlowStraightSecondTieSlot: {
    justifyContent: 'flex-start',
    paddingTop: 18,
  },
  seasonKnockoutFlowStraightSecondTieSlotTall: {
    paddingTop: 42,
  },
  seasonKnockoutFlowStraightTieSlotTall: { minHeight: 124 },
  seasonKnockoutFlowStraightLine: {
    height: 1,
    width: 32,
    backgroundColor: '#d1d5db',
  },
  seasonKnockoutFlowStraightLineTall: { width: 32 },
  seasonKnockoutFlowStraightLineCompact: { width: 18 },
  seasonKnockoutFlowColSemiFinal: { marginTop: 77 },
  seasonKnockoutFlowColSemiFinalTall: { marginTop: 73 },
  seasonKnockoutTieStack: { gap: 6, width: '100%' },
  seasonKnockoutTwoLegScoreCols: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  seasonKnockoutLegColLabelFallbackSlot: {
    minWidth: 20,
    alignItems: 'center',
  },
  seasonKnockoutLegColLabel: {
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '800',
    color: '#9ca3af',
  },
  seasonKnockoutAggregateText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    marginTop: 2,
    paddingHorizontal: 2,
  },
  seasonKnockoutBracketTopArm: { position: 'absolute', left: 6, top: 10, width: 32, height: 1, backgroundColor: '#d1d5db' },
  seasonKnockoutBracketBottomArm: { position: 'absolute', left: 6, bottom: 10, width: 32, height: 1, backgroundColor: '#d1d5db' },
  seasonKnockoutBracketVertical: { position: 'absolute', left: 38, top: 10, width: 1, height: 92, backgroundColor: '#d1d5db' },
  seasonKnockoutBracketMiddleArm: { position: 'absolute', left: 38, top: 56, width: 14, height: 1, backgroundColor: '#d1d5db' },
  seasonKnockoutBracketTopArmCompact: { left: 3, width: 14 },
  seasonKnockoutBracketTopArmCompactTall: { top: 4 },
  seasonKnockoutBracketBottomArmCompact: { left: 3, width: 14 },
  seasonKnockoutBracketBottomArmCompactTall: { bottom: 10 },
  seasonKnockoutBracketVerticalCompact: { left: 17 },
  seasonKnockoutBracketVerticalCompactTall: { top: 4, height: 138 },
  seasonKnockoutBracketMiddleArmCompact: { left: 17, width: 11 },
  seasonKnockoutBracketMiddleArmCompactTall: { top: 88 },
  seasonKnockoutBracketMiddleArmSemiFinal: { top: 61 },
  seasonKnockoutBracketMiddleArmSemiFinalTall: { top: 91 },
  seasonKnockoutFinalLabelRow: { height: 0, marginBottom: 0 },
  seasonKnockoutMatchStackMeasure: { width: '100%' },
  seasonKnockoutMatchStack: { gap: 6, width: '100%' },
  seasonKnockoutTeamRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 18 },
  seasonKnockoutLogo: { width: 30, height: 30 },
  seasonKnockoutLogoFallback: { width: 30, height: 30, borderRadius: 6, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  seasonKnockoutLogoPlaceholder: { width: 30, height: 30 },
  seasonKnockoutTeamBox: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 7,
    minHeight: 32,
    paddingVertical: 0,
    paddingLeft: 0,
    paddingRight: 6,
    backgroundColor: '#fff',
  },
  seasonKnockoutTeamText: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700', color: '#111827' },
  seasonKnockoutScoreBox: {
    minWidth: 20,
    height: 22,
    paddingHorizontal: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seasonKnockoutScoreTextRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seasonKnockoutScoreText: { fontSize: 12, fontWeight: '800', color: '#111827' },
  seasonKnockoutShootoutDivider: { width: 1, height: 10, backgroundColor: '#d1d5db' },
  seasonKnockoutShootoutScoreText: { fontSize: 8, fontWeight: '800', color: '#9ca3af' },
  teamSquadList: { flex: 1 },
  statsListContent: { paddingBottom: 12 },
  statsBlock: { marginBottom: 18 },
  statsBlockTitle: { fontSize: 15, fontWeight: '800', color: '#1e293b', marginBottom: 8 },
  statsSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 4,
  },
  statsSectionTitleSpaced: { marginTop: 6 },
  teamHlGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
  },
  teamHlCard: {
    width: '48.6%',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ececec',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  teamHlCardWide: {
    width: '100%',
    marginBottom: 2,
  },
  teamHlCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 8,
  },
  teamHlIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamHlLabel: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  teamHlTeamBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  teamHlLogo: {
    width: 36,
    height: 36,
  },
  teamHlLogoFallback: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamHlLogoLg: {
    width: 40,
    height: 40,
  },
  teamHlLogoLgFallback: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamHlTeamText: {
    flex: 1,
    minWidth: 0,
  },
  teamHlTeamName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  teamHlValue: {
    marginTop: 1,
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  teamHlUnit: {
    fontSize: 10,
    fontWeight: '700',
    color: '#667eea',
    marginTop: -1,
  },
  teamHlDetail: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
  },
  teamHlMatchBody: {
    paddingTop: 2,
  },
  teamHlMatchTeams: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  teamHlMatchSide: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 4,
  },
  teamHlMatchName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'center',
  },
  teamHlScoreBox: {
    minWidth: 72,
    alignItems: 'center',
  },
  teamHlScoreText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.4,
  },
  teamHlScoreSub: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7c3aed',
    marginTop: 1,
  },
  teamHlDetailCenter: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    textAlign: 'center',
  },
  statsTableWrap: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    overflow: 'hidden',
  },
  statsTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  statsTableHeaderRow: { backgroundColor: '#f8fafc', borderBottomColor: '#e5e7eb' },
  statsTableHeaderCell: { fontWeight: '800', color: '#64748b', fontSize: 11 },
  statsTableCell: { fontSize: 13, fontWeight: '600', color: '#1f2937' },
  statsTablePos: { width: 34, marginRight: 10, textAlign: 'center', flexShrink: 0 },
  statsTablePlayer: { flex: 1, minWidth: 0, flexShrink: 1 },
  statsTablePlayerCol: { flex: 1, minWidth: 0, paddingRight: 2, flexShrink: 1 },
  statsTablePlayerName: { fontSize: 13, fontWeight: '600', color: '#1f2937' },
  statsTablePlayerTeam: { fontSize: 10, color: '#64748b', marginTop: 1 },
  statsTableValue: { width: 52, minWidth: 52, textAlign: 'right', flexShrink: 0, fontWeight: '700' },
  statsTableExpandBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, borderBottomWidth: 0 },
  statsTableExpandText: { fontSize: 13, fontWeight: '700', color: '#111827' },
  hallScrollContent: { paddingBottom: 4 },
  hallCard: {
    flex: 1,
    minHeight: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingTop: 12,
    paddingBottom: 0,
  },
  hallSectionTitle: { fontSize: 15, fontWeight: '800', color: '#1e293b', marginBottom: 8 },
  hallSectionTitleSpaced: { marginTop: 18 },
  hallTableWrap: {
    marginTop: 2,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
    alignSelf: 'stretch',
  },
  hallTableHeader: {
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
  },
  hallThPos: { width: 38 },
  hallThTeam: { fontSize: 13 },
  hallSortableTh: { width: 72, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  hallSortableThWine: { width: 68, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  hallSortableThInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    maxWidth: 72,
  },
  hallSortableThInnerWine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    maxWidth: 68,
  },
  hallThTitoli: { flexShrink: 1, fontSize: 11, lineHeight: 13 },
  hallThWine: { flexShrink: 1, fontSize: 11, lineHeight: 13 },
  hallThSortActive: { color: '#4f46e5' },
  hallSortCaret: {
    marginTop: 1,
  },
  hallTableRow: {
    alignItems: 'stretch',
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  hallPosCol: {
    width: 38,
    flexShrink: 0,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hallTdPos: { fontWeight: '700', fontSize: 15, textAlign: 'center' },
  hallMetricCol: {
    width: 72,
    flexShrink: 0,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hallMetricColWine: {
    width: 68,
    flexShrink: 0,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hallTdTitoli: { fontWeight: '800', fontSize: 15, textAlign: 'center' },
  hallTdWine: { fontWeight: '800', fontSize: 15, textAlign: 'center' },
  hallTeamCell: { gap: 10, alignItems: 'center' },
  hallTeamLogo: { width: 36, height: 36 },
  hallTeamLogoFallback: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hallTeamTextCol: { flex: 1, minWidth: 0 },
  hallTeamName: { fontSize: 15, fontWeight: '700', color: '#1f2937', lineHeight: 19 },
  hallYearsText: { fontSize: 10, color: '#64748b', marginTop: 2, flexShrink: 1, lineHeight: 12 },
  hallYearsListWrap: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  hallChronologyExpandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eef2f7',
    backgroundColor: '#fff',
  },
  hallChronologyExpandText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },
  hallYearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 10,
    backgroundColor: '#fff',
  },
  hallYearRowLast: { borderBottomWidth: 0 },
  hallYearLabel: { width: 44, fontSize: 14, fontWeight: '800', color: '#334155' },
  hallYearTeam: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  hallYearTeamName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1f2937' },
});

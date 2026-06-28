import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Modal,
  Pressable,
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
import { TeamLogoImage } from '../components/StableCachedImage';
import { EMPTY_OFFICIAL_KNOCKOUT, hasOfficialKnockoutBracket } from '../utils/knockoutBracket';
import OfficialKnockoutBracket from '../components/OfficialKnockoutBracket';
import { parseAppDate } from '../utils/dateTime';

const SEASON_YEAR_PICKER_MAX_HEIGHT = 180;
const ABSOLUTE_STATS_KEY = 'absolute';
const STATS_LEADERBOARD_PREVIEW = 10;
const MATCH_LIST_ROW_HEIGHT = 127;
const MATCH_LIST_YEAR_HEIGHT = 34;
const MATCHES_LIST_CONTENT_PADDING_BOTTOM = 12;
const MATCHES_LIST_INITIAL_RENDER = 14;

function GroupLogo({ logoUrl, logoPath }) {
  return (
    <TeamLogoImage
      logoUrl={logoUrl}
      logoPath={logoPath}
      style={styles.logo}
      fallbackStyle={styles.logoFallback}
      fallbackIconSize={56}
    />
  );
}

function TeamRowLogo({ logoUrl, logoPath }) {
  return (
    <TeamLogoImage
      logoUrl={logoUrl}
      logoPath={logoPath}
      style={styles.matchTeamLogo}
      fallbackStyle={styles.matchTeamLogoFallback}
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

function SeasonYearPickerMenu({ open, onClose, anchorRef, options, onSelectOption }) {
  const [layout, setLayout] = useState(null);

  useEffect(() => {
    if (!open) {
      setLayout(null);
      return undefined;
    }
    let cancelled = false;
    const measureAnchor = () => {
      if (!anchorRef?.current) return;
      anchorRef.current.measureInWindow((x, y, width, height) => {
        if (cancelled) return;
        setLayout({ left: x, top: y + height + 2, width: Math.max(width, 120) });
      });
    };
    measureAnchor();
    const retryTimer = setTimeout(measureAnchor, 64);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [open, anchorRef, options.length]);

  if (!open || !layout) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.seasonPickerModalRoot}>
        <Pressable style={styles.seasonPickerModalBackdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Chiudi selezione anno" />
        <View style={[styles.seasonPickerDropdownModal, { top: layout.top, left: layout.left, width: layout.width }]}>
          <ScrollView
            style={styles.seasonPickerDropdownScroll}
            contentContainerStyle={styles.seasonPickerDropdownScrollContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            bounces={false}
            nestedScrollEnabled
          >
            {options.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.seasonPickerItem, item.active && styles.seasonPickerItemActive]}
                onPress={() => onSelectOption(item)}
                activeOpacity={0.8}
              >
                <Text style={[styles.seasonPickerItemText, item.active && styles.seasonPickerItemTextActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
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

function logOfficialGroupMatches(step, extra = {}) {
  if (!__DEV__) return;
  console.log('[OfficialGroupMatches][client]', step, extra);
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
  const hs = match.home_score != null ? Number(match.home_score) : isTerminated ? 0 : null;
  const as = match.away_score != null ? Number(match.away_score) : isTerminated ? 0 : null;
  const hasScore = Number.isFinite(hs) && Number.isFinite(as);
  const hps = match.home_shootout_score != null ? Number(match.home_shootout_score) : null;
  const aps = match.away_shootout_score != null ? Number(match.away_shootout_score) : null;
  const hasShootout = Number.isFinite(hps) && Number.isFinite(aps);
  const statusText = getMatchStatusText(match);
  const showShootoutStatus = isTerminated && hasShootout;

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
            {hasScore ? <TeamMatchScore score={hs} shootoutScore={hasShootout ? hps : null} /> : null}
          </View>
          <View style={[styles.matchTeamRow, styles.matchTeamRowSecond]}>
            <TeamRowLogo logoUrl={match.away_team_logo_url} logoPath={match.away_team_logo_path} />
            <Text style={styles.matchTeamName} numberOfLines={1}>{match.away_team_name || '-'}</Text>
            {hasScore ? <TeamMatchScore score={as} shootoutScore={hasShootout ? aps : null} /> : null}
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
  const [seasonPickerOpen, setSeasonPickerOpen] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsYears, setStatsYears] = useState([]);
  const [selectedStatsYear, setSelectedStatsYear] = useState(null);
  const [statsScorers, setStatsScorers] = useState([]);
  const [statsAssistmen, setStatsAssistmen] = useState([]);
  const [statsPresences, setStatsPresences] = useState([]);
  const [statsLeaderboardExpanded, setStatsLeaderboardExpanded] = useState({
    scorers: false,
    assistmen: false,
    presences: false,
  });
  const [statsPickerOpen, setStatsPickerOpen] = useState(false);
  const [hallLoading, setHallLoading] = useState(false);
  const [hallRanking, setHallRanking] = useState([]);
  const [hallWinnersByYear, setHallWinnersByYear] = useState([]);
  const matchesListRef = useRef(null);
  const matchesLoadSeqRef = useRef(0);
  const matchesViewportHeightRef = useRef(0);
  const initialMatchesScrollDoneRef = useRef(false);
  const pendingScrollIndexRef = useRef(null);
  const seasonPickerAnchorRef = useRef(null);
  const statsPickerAnchorRef = useRef(null);

  const load = useCallback(async (showLoading = false) => {
    if (!competitionId) return;
    try {
      if (showLoading) setLoading(true);
      const res = await matchesService.getOfficialGroupDetail(competitionId);
      setData(res?.data || null);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [competitionId]);

  useEffect(() => {
    void load(true);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load])
  );

  const loadGroupMatches = useCallback(async () => {
    if (!competitionId) return;
    matchesLoadSeqRef.current += 1;
    const seq = matchesLoadSeqRef.current;
    const t0 = Date.now();
    logOfficialGroupMatches('load_start', { competitionId, seq });

    initialMatchesScrollDoneRef.current = false;
    setMatchesListPositioned(false);
    setMatchesLoading(true);
    try {
      const res = await matchesService.getOfficialGroupMatches(competitionId);
      if (seq !== matchesLoadSeqRef.current) return;

      const matches = Array.isArray(res?.data?.matches) ? res.data.matches : [];
      logOfficialGroupMatches('load_done', {
        seq,
        count: matches.length,
        ms: Date.now() - t0,
      });

      setGroupMatches(matches);
      pendingScrollIndexRef.current = resolveInitialMatchScrollIndex(buildMatchListItems(matches));
    } catch (err) {
      logOfficialGroupMatches('load_error', {
        seq,
        ms: Date.now() - t0,
        message: err?.message || String(err),
      });
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
      try {
        setSeasonLoading(true);
        const targetYear = yearOverride != null ? yearOverride : selectedSeasonYear;
        const res = await matchesService.getOfficialGroupSeasonStandings(competitionId, targetYear);
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
          if (backendSelected == null || !Number.isFinite(backendSelected)) return prev;
          return prev === backendSelected ? prev : backendSelected;
        });
      } finally {
        setSeasonLoading(false);
      }
    },
    [competitionId, selectedSeasonYear]
  );

  useEffect(() => {
    if (activeTab !== 'season') return;
    setSeasonPickerOpen(false);
    void loadSeasonStandings();
  }, [activeTab, loadSeasonStandings]);

  const loadGroupSeasonStats = useCallback(
    async (yearOverride = null) => {
      if (!competitionId) return;
      try {
        setStatsLoading(true);
        const targetYear = yearOverride != null ? yearOverride : selectedStatsYear;
        const res = await matchesService.getOfficialGroupSeasonStats(competitionId, targetYear);
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
        setSelectedStatsYear((prev) => {
          if (backendSelected === ABSOLUTE_STATS_KEY) return ABSOLUTE_STATS_KEY;
          if (backendSelected == null || !Number.isFinite(backendSelected)) return prev;
          return prev === backendSelected ? prev : backendSelected;
        });
      } finally {
        setStatsLoading(false);
      }
    },
    [competitionId, selectedStatsYear]
  );

  useEffect(() => {
    if (activeTab !== 'stats') return;
    setStatsPickerOpen(false);
    void loadGroupSeasonStats();
  }, [activeTab, loadGroupSeasonStats]);

  const loadHallOfFame = useCallback(async () => {
    if (!competitionId) return;
    try {
      setHallLoading(true);
      const res = await matchesService.getOfficialGroupHallOfFame(competitionId);
      setHallRanking(Array.isArray(res?.data?.ranking) ? res.data.ranking : []);
      setHallWinnersByYear(Array.isArray(res?.data?.winners_by_year) ? res.data.winners_by_year : []);
    } finally {
      setHallLoading(false);
    }
  }, [competitionId]);

  useEffect(() => {
    if (activeTab !== 'hall') return;
    void loadHallOfFame();
  }, [activeTab, loadHallOfFame]);

  useEffect(() => {
    setStatsLeaderboardExpanded({ scorers: false, assistmen: false, presences: false });
  }, [selectedStatsYear]);

  const toggleStatsLeaderboard = (tableKey) => {
    setStatsLeaderboardExpanded((prev) => ({ ...prev, [tableKey]: !prev[tableKey] }));
  };

  const renderStatsLeaderboardTable = (items, valueLabel, emptyText, tableKey) => {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      return <Text style={styles.placeholderText}>{emptyText}</Text>;
    }
    const canExpand = list.length > STATS_LEADERBOARD_PREVIEW;
    const expanded = !!statsLeaderboardExpanded[tableKey];
    const visible = !canExpand || expanded ? list : list.slice(0, STATS_LEADERBOARD_PREVIEW);
    return (
      <>
        <View style={[styles.statsTableRow, styles.statsTableHeaderRow]}>
          <Text style={[styles.statsTableCell, styles.statsTablePos, styles.statsTableHeaderCell]}>Pos.</Text>
          <Text style={[styles.statsTableCell, styles.statsTablePlayer, styles.statsTableHeaderCell]}>Giocatore</Text>
          <Text style={[styles.statsTableCell, styles.statsTableValue, styles.statsTableHeaderCell]}>{valueLabel}</Text>
        </View>
        {visible.map((s, i) => (
          <View key={`${tableKey}-${i}`} style={styles.statsTableRow}>
            <Text style={[styles.statsTableCell, styles.statsTablePos]}>{i + 1}</Text>
            <Text style={[styles.statsTableCell, styles.statsTablePlayer]} numberOfLines={1}>
              {String(s?.name || '-')}
            </Text>
            <Text style={[styles.statsTableCell, styles.statsTableValue]}>{Number(s?.value || 0)}</Text>
          </View>
        ))}
        {canExpand ? (
          <TouchableOpacity style={styles.statsTableExpandBtn} onPress={() => toggleStatsLeaderboard(tableKey)} activeOpacity={0.7}>
            <Text style={styles.statsTableExpandText}>
              {expanded ? 'Mostra meno' : `Mostra tutti (${list.length})`}
            </Text>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#111827" />
          </TouchableOpacity>
        ) : null}
      </>
    );
  };

  const group = data?.group || {};
  const groupName = group.name || route?.params?.groupName || '-';

  const seasonYearOptions = useMemo(
    () =>
      (Array.isArray(seasonYears) ? seasonYears : []).map((y) => ({
        key: `season-year-${y}`,
        label: String(y),
        value: Number(y),
        active: Number(selectedSeasonYear) === Number(y),
      })),
    [seasonYears, selectedSeasonYear]
  );

  const statsYearOptions = useMemo(() => {
    const opts = [
      {
        key: 'stats-season-absolute',
        label: 'Assolute',
        value: ABSOLUTE_STATS_KEY,
        active: selectedStatsYear === ABSOLUTE_STATS_KEY,
      },
    ];
    (Array.isArray(statsYears) ? statsYears : []).forEach((y) => {
      opts.push({
        key: `stats-season-year-${y}`,
        label: String(y),
        value: Number(y),
        active: selectedStatsYear !== ABSOLUTE_STATS_KEY && Number(selectedStatsYear) === Number(y),
      });
    });
    return opts;
  }, [statsYears, selectedStatsYear]);

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

      <View style={styles.content}>
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
              <View ref={seasonPickerAnchorRef} style={styles.seasonPickerWrap} collapsable={false}>
                <TouchableOpacity style={styles.seasonPickerBtn} onPress={() => setSeasonPickerOpen((v) => !v)} activeOpacity={0.8}>
                  <Text style={styles.seasonPickerBtnText}>
                    {selectedSeasonYear != null ? String(selectedSeasonYear) : 'Seleziona anno'}
                  </Text>
                  <Ionicons name={seasonPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#475569" />
                </TouchableOpacity>
                <SeasonYearPickerMenu
                  open={seasonPickerOpen}
                  onClose={() => setSeasonPickerOpen(false)}
                  anchorRef={seasonPickerAnchorRef}
                  options={seasonYearOptions}
                  onSelectOption={(item) => {
                    setSeasonPickerOpen(false);
                    void loadSeasonStandings(item.value);
                  }}
                />
              </View>
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
                            <Text style={[styles.seasonTh, styles.seasonThPos, { textAlign: 'center' }]}>Pos</Text>
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
          <View style={[styles.card, styles.teamCard]}>
            <View ref={statsPickerAnchorRef} style={styles.seasonPickerWrap} collapsable={false}>
              <TouchableOpacity style={styles.seasonPickerBtn} onPress={() => setStatsPickerOpen((v) => !v)} activeOpacity={0.8}>
                <Text style={styles.seasonPickerBtnText}>
                  {selectedStatsYear === ABSOLUTE_STATS_KEY
                    ? 'Assolute'
                    : (selectedStatsYear != null ? String(selectedStatsYear) : 'Seleziona anno')}
                </Text>
                <Ionicons name={statsPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#475569" />
              </TouchableOpacity>
              <SeasonYearPickerMenu
                open={statsPickerOpen}
                onClose={() => setStatsPickerOpen(false)}
                anchorRef={statsPickerAnchorRef}
                options={statsYearOptions}
                onSelectOption={(item) => {
                  setStatsPickerOpen(false);
                  void loadGroupSeasonStats(item.value);
                }}
              />
            </View>
            {statsLoading ? (
              <View style={styles.matchesLoadingBox}>
                <ActivityIndicator color="#667eea" />
              </View>
            ) : (
              <ScrollView style={styles.teamSquadList} contentContainerStyle={styles.statsListContent} showsVerticalScrollIndicator={false}>
                <View style={styles.statsBlock}>
                  <Text style={styles.statsBlockTitle}>Marcatori</Text>
                  {renderStatsLeaderboardTable(statsScorers, 'Goal', 'Nessun marcatore disponibile.', 'scorers')}
                </View>
                <View style={styles.statsBlock}>
                  <Text style={styles.statsBlockTitle}>Assistman</Text>
                  {renderStatsLeaderboardTable(statsAssistmen, 'Assist', 'Nessun assist disponibile.', 'assistmen')}
                </View>
                <View style={styles.statsBlock}>
                  <Text style={styles.statsBlockTitle}>Presenze</Text>
                  {renderStatsLeaderboardTable(
                    statsPresences,
                    'Pres.',
                    'Nessuna presenza con voto nel periodo selezionato.',
                    'presences'
                  )}
                </View>
              </ScrollView>
            )}
          </View>
        ) : (
          <View style={[styles.card, styles.teamCard]}>
            {hallLoading ? (
              <View style={styles.matchesLoadingBox}>
                <ActivityIndicator color="#667eea" />
              </View>
            ) : hallRanking.length === 0 && hallWinnersByYear.length === 0 ? (
              <Text style={styles.placeholderText}>Nessun vincitore di finale registrato.</Text>
            ) : (
              <ScrollView contentContainerStyle={styles.hallScrollContent} showsVerticalScrollIndicator={false}>
                <Text style={styles.hallSectionTitle}>Classifica titoli</Text>
                <View style={styles.seasonTableWrap}>
                  <View style={styles.seasonTableHeader}>
                    <Text style={[styles.seasonTh, styles.seasonThPos, { textAlign: 'center' }]}>Pos</Text>
                    <Text style={[styles.seasonTh, { flex: 1 }]}>Squadra</Text>
                    <Text style={[styles.seasonTh, styles.seasonThStat, { textAlign: 'center' }]}>Titoli</Text>
                  </View>
                  {hallRanking.map((r, i) => (
                    <View key={`hall-rank-${i}`} style={[styles.seasonTableRow, i === hallRanking.length - 1 && styles.seasonTableRowLast]}>
                      <Text style={[styles.seasonTd, styles.seasonTdPos, { textAlign: 'center' }]}>{i + 1}</Text>
                      <View style={[styles.teamCell, styles.seasonTeamCell, { flex: 1 }]}>
                        <TeamRowLogo logoUrl={r.team_logo_url} logoPath={r.team_logo_path} />
                        <View style={styles.hallTeamTextCol}>
                          <Text style={[styles.seasonTd, styles.seasonTdTeamName]} numberOfLines={1}>
                            {r.team_name || '-'}
                          </Text>
                          {Array.isArray(r.years) && r.years.length > 0 ? (
                            <Text style={styles.hallYearsText} numberOfLines={1}>
                              {r.years.join(', ')}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      <Text style={[styles.seasonTd, styles.seasonTdStat, { textAlign: 'center' }]}>{r.titles}</Text>
                    </View>
                  ))}
                </View>
                {hallWinnersByYear.length > 0 ? (
                  <>
                    <Text style={[styles.hallSectionTitle, styles.hallSectionTitleSpaced]}>Vincitori per stagione</Text>
                    {hallWinnersByYear.map((w) => (
                      <View key={`hall-year-${w.year}`} style={styles.hallYearRow}>
                        <Text style={styles.hallYearLabel}>{w.year}</Text>
                        <View style={styles.hallYearTeam}>
                          <TeamRowLogo logoUrl={w.team_logo_url} logoPath={w.team_logo_path} />
                          <Text style={styles.hallYearTeamName} numberOfLines={1}>{w.team_name || '-'}</Text>
                        </View>
                      </View>
                    ))}
                  </>
                ) : null}
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
  seasonPickerWrap: { marginBottom: 10, position: 'relative' },
  seasonPickerBtn: {
    height: 38,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  seasonPickerBtnText: { fontSize: 14, fontWeight: '700', color: '#334155' },
  seasonPickerModalRoot: { flex: 1 },
  seasonPickerModalBackdrop: { ...StyleSheet.absoluteFillObject },
  seasonPickerDropdownModal: {
    position: 'absolute',
    height: SEASON_YEAR_PICKER_MAX_HEIGHT,
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
  seasonPickerDropdownScroll: { height: SEASON_YEAR_PICKER_MAX_HEIGHT },
  seasonPickerDropdownScrollContent: { paddingBottom: 4 },
  seasonPickerItem: { paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  seasonPickerItemActive: { backgroundColor: '#eef2ff' },
  seasonPickerItemText: { fontSize: 14, fontWeight: '600', color: '#334155' },
  seasonPickerItemTextActive: { color: '#4f46e5', fontWeight: '700' },
  seasonStandingsTablesCol: { gap: 14 },
  seasonStandingsTableBlock: { marginBottom: 4 },
  seasonGironeTitle: { fontSize: 14, fontWeight: '800', color: '#334155', marginBottom: 8 },
  seasonTableWrap: { marginTop: 2, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, overflow: 'hidden' },
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
  seasonTh: { fontSize: 11, fontWeight: '800', color: '#64748b' },
  seasonThPos: { width: 28 },
  seasonThStat: { width: 28 },
  seasonThPt: { width: 30 },
  seasonTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 4,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  seasonTableRowLast: { borderBottomWidth: 0 },
  seasonTd: { fontSize: 12, fontWeight: '600', color: '#1f2937' },
  seasonTdPos: { width: 28 },
  seasonTdStat: { width: 28 },
  seasonTdPt: { width: 30, fontWeight: '800' },
  seasonTdTeamName: { flex: 1, minWidth: 0 },
  teamCell: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  seasonTeamCell: { paddingRight: 4 },
  seasonKnockoutCard: { marginTop: 10, paddingHorizontal: 8, paddingTop: 12, paddingBottom: 12 },
  seasonKnockoutTitle: { fontSize: 15, fontWeight: '800', color: '#1e293b', marginBottom: 10 },
  seasonKnockoutSemiBlock: {},
  seasonKnockoutSemiLabelRow: {},
  seasonKnockoutSemiSmallLabel: {},
  seasonKnockoutMatchStackMeasure: {},
  seasonKnockoutTieStack: {},
  seasonKnockoutTwoLegScoreCols: {},
  seasonKnockoutLegColLabel: {},
  seasonKnockoutLegColLabelFallbackSlot: {},
  seasonKnockoutMatchStack: {},
  seasonKnockoutTeamBox: {},
  seasonKnockoutTeamRow: {},
  seasonKnockoutLogoPlaceholder: {},
  seasonKnockoutTeamText: {},
  seasonKnockoutScoreBox: {},
  seasonKnockoutScoreTextRow: {},
  seasonKnockoutScoreText: {},
  seasonKnockoutShootoutDivider: {},
  seasonKnockoutShootoutScoreText: {},
  seasonKnockoutAggregateText: {},
  seasonKnockoutHeaderRow: {},
  seasonKnockoutColumnTitle: {},
  seasonKnockoutColumnTitleWide: {},
  seasonKnockoutColumnTitleSpacer: {},
  seasonKnockoutColumnTitleSpacerCompact: {},
  seasonKnockoutStageColumnTitle: {},
  seasonKnockoutFinalHeaderCol: {},
  seasonKnockoutFinalColStack: {},
  seasonKnockoutFinalColBody: {},
  seasonKnockoutFinalMatchWrap: {},
  seasonKnockoutBracketRow: {},
  seasonKnockoutBracketScroll: {},
  seasonKnockoutBracketScrollContent: {},
  seasonKnockoutSemisCol: {},
  seasonKnockoutSemisColWide: {},
  seasonKnockoutStageColScroll: {},
  seasonKnockoutFlowCol: {},
  seasonKnockoutFlowColTall: {},
  seasonKnockoutFlowColCompact: {},
  seasonKnockoutFlowStraightStack: {},
  seasonKnockoutFlowStraightStackTall: {},
  seasonKnockoutFlowStraightHeaderSpacer: {},
  seasonKnockoutFlowStraightTieSlot: {},
  seasonKnockoutFlowStraightTieSlotTall: {},
  seasonKnockoutFlowStraightFirstTieSlot: {},
  seasonKnockoutFlowStraightSecondTieSlot: {},
  seasonKnockoutFlowStraightSecondTieSlotTall: {},
  seasonKnockoutFlowStraightLine: {},
  seasonKnockoutFlowStraightLineTall: {},
  seasonKnockoutFlowStraightLineCompact: {},
  seasonKnockoutFlowColSemiFinal: {},
  seasonKnockoutFlowColSemiFinalTall: {},
  seasonKnockoutBracketMiddleArmSemiFinal: {},
  seasonKnockoutBracketMiddleArmSemiFinalTall: {},
  seasonKnockoutBracketTopArm: {},
  seasonKnockoutBracketTopArmCompact: {},
  seasonKnockoutBracketTopArmCompactTall: {},
  seasonKnockoutBracketBottomArm: {},
  seasonKnockoutBracketBottomArmCompact: {},
  seasonKnockoutBracketBottomArmCompactTall: {},
  seasonKnockoutBracketVertical: {},
  seasonKnockoutBracketVerticalCompact: {},
  seasonKnockoutBracketVerticalCompactTall: {},
  seasonKnockoutBracketMiddleArm: {},
  seasonKnockoutBracketMiddleArmCompact: {},
  seasonKnockoutBracketMiddleArmCompactTall: {},
  seasonKnockoutFinalCol: {},
  seasonKnockoutFinalLabelRow: {},
  seasonKnockoutLogo: { width: 30, height: 30 },
  seasonKnockoutLogoFallback: { width: 30, height: 30, borderRadius: 6, backgroundColor: '#eef2ff' },
  teamSquadList: { flex: 1 },
  statsListContent: { paddingBottom: 12 },
  statsBlock: { marginBottom: 18 },
  statsBlockTitle: { fontSize: 15, fontWeight: '800', color: '#1e293b', marginBottom: 8 },
  statsTableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  statsTableHeaderRow: { backgroundColor: '#f8fafc', borderBottomColor: '#e5e7eb' },
  statsTableHeaderCell: { fontWeight: '800', color: '#64748b', fontSize: 11 },
  statsTableCell: { fontSize: 13, fontWeight: '600', color: '#1f2937' },
  statsTablePos: { width: 36 },
  statsTablePlayer: { flex: 1, minWidth: 0 },
  statsTableValue: { width: 52, textAlign: 'right' },
  statsTableExpandBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10 },
  statsTableExpandText: { fontSize: 13, fontWeight: '700', color: '#111827' },
  hallScrollContent: { paddingBottom: 12 },
  hallSectionTitle: { fontSize: 15, fontWeight: '800', color: '#1e293b', marginBottom: 8 },
  hallSectionTitleSpaced: { marginTop: 18 },
  hallTeamTextCol: { flex: 1, minWidth: 0 },
  hallYearsText: { fontSize: 10, color: '#64748b', marginTop: 1 },
  hallYearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 10,
  },
  hallYearLabel: { width: 44, fontSize: 14, fontWeight: '800', color: '#334155' },
  hallYearTeam: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  hallYearTeamName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1f2937' },
});

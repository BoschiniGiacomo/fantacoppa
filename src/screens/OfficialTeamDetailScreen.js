import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { matchesService } from '../services/api';
import { TeamLogoImage } from '../components/StableCachedImage';
import { EMPTY_OFFICIAL_KNOCKOUT, hasOfficialKnockoutBracket } from '../utils/knockoutBracket';
import OfficialKnockoutBracket from '../components/OfficialKnockoutBracket';
import OfficialTeamTrophyBoard from '../components/OfficialTeamTrophyBoard';
import { parseAppDate } from '../utils/dateTime';
import { buildCompetitionRanks, formatCompetitionRank } from '../utils/standingsRanking';
import { matchDisplayScoreParts, matchOutcomeScoreParts } from '../utils/matchDisplayScore';

function TeamLogo({ logoUrl, logoPath }) {
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

const SEASON_YEAR_PICKER_MAX_HEIGHT = 180;

const OFFICIAL_TEAM_TABS = ['matches', 'season', 'stats', 'team', 'trophies'];

function resolveRouteInitialTab(params) {
  const tab = String(params?.initialTab || '').trim();
  return OFFICIAL_TEAM_TABS.includes(tab) ? tab : null;
}

function resolveRouteInitialSeasonYear(params) {
  const year = Number(params?.initialSeasonYear);
  return Number.isFinite(year) && year > 0 ? Math.trunc(year) : null;
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
        setLayout({
          left: x,
          top: y + height + 2,
          width: Math.max(width, 120),
        });
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
        <View
          style={[
            styles.seasonPickerDropdownModal,
            { top: layout.top, left: layout.left, width: layout.width },
          ]}
        >
          <ScrollView
            style={styles.seasonPickerDropdownScroll}
            contentContainerStyle={styles.seasonPickerDropdownScrollContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            bounces={false}
            overScrollMode="always"
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

function formatFavoriteCount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.trunc(n));
  if (n < 1000000) return `${(n / 1000).toFixed(1).replace('.', ',')} K`;
  return `${(n / 1000000).toFixed(1).replace('.', ',')} M`;
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
    const includeYear = y !== now.getFullYear();
    dateLabel = includeYear ? `${wd} ${dm} ${mon} ${y}` : `${wd} ${dm} ${mon}`;
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

function normalizeNameForCompare(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getOutcomeAccentColor(match, watchedTeamName) {
  const parts = matchDisplayScoreParts(match);
  if (!parts.show) return '#cbd5e1';
  const { home: outcomeHome, away: outcomeAway } = matchOutcomeScoreParts(match);
  const w = normalizeNameForCompare(watchedTeamName);
  const home = normalizeNameForCompare(match?.home_team_name);
  const away = normalizeNameForCompare(match?.away_team_name);
  if (!w || (w !== home && w !== away)) return '#cbd5e1';
  if (outcomeHome === outcomeAway) return '#94a3b8';
  const watchedWon = (w === home && outcomeHome > outcomeAway) || (w === away && outcomeAway > outcomeHome);
  return watchedWon ? '#16a34a' : '#dc2626';
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

function SeasonKnockoutLogoAdapter({ logoUrl, logoPath }) {
  return <SeasonKnockoutLogo logoUrl={logoUrl} logoPath={logoPath} />;
}

const ROLE_COLORS = { P: '#0d6efd', D: '#198754', C: '#e6a800', A: '#dc3545' };
const DEFAULT_JERSEY_COLOR = '#a5b4fc';
const ROLE_ORDER = { P: 0, D: 1, C: 2, A: 3 };
const ABSOLUTE_STATS_KEY = 'absolute';

function renderOfficialMatchRecord(record, styles) {
  if (!record || typeof record !== 'object') {
    return (
      <View style={styles.statsRecordValue}>
        <Text style={styles.statsRecordEmpty}>-</Text>
      </View>
    );
  }
  const hs = Number(record.home_score);
  const as = Number(record.away_score);
  const date = String(record.date || '').trim();
  if (!Number.isFinite(hs) || !Number.isFinite(as)) {
    return (
      <View style={styles.statsRecordValue}>
        <Text style={styles.statsRecordEmpty}>-</Text>
      </View>
    );
  }
  return (
    <View style={styles.statsRecordValue}>
      <View style={styles.statsRecordScoreRow}>
        <TeamLogoImage
          logoUrl={record.home_team_logo_url}
          logoPath={record.home_team_logo_path}
          style={styles.statsRecordLogo}
          fallbackStyle={styles.statsRecordLogoFallback}
          fallbackIconSize={14}
        />
        <Text style={styles.statsRecordScore}>
          {hs} - {as}
        </Text>
        <TeamLogoImage
          logoUrl={record.away_team_logo_url}
          logoPath={record.away_team_logo_path}
          style={styles.statsRecordLogo}
          fallbackStyle={styles.statsRecordLogoFallback}
          fallbackIconSize={14}
        />
      </View>
      {date ? <Text style={styles.statsRecordDate}>{date}</Text> : null}
    </View>
  );
}

function isValidJerseyHex(s) {
  if (s == null || typeof s !== 'string') return false;
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(s.trim());
}

function jerseyToHex6(raw) {
  let hex = typeof raw === 'string' ? raw.trim() : '';
  if (!isValidJerseyHex(hex)) return null;
  if (hex.length === 4) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

function relativeLuminanceHex6(hex6) {
  const h = hex6.replace(/^#/, '');
  if (h.length !== 6) return 0.5;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return 0.5;
  const rs = (n >> 16) & 255;
  const gs = (n >> 8) & 255;
  const bs = n & 255;
  const lin = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rs) + 0.7152 * lin(gs) + 0.0722 * lin(bs);
}

const JERSEY_PRESET_FORCE_BLACK_NUMBER = new Set([
  '#c1121c',
  '#0857c3',
  '#38bdf8',
  '#f97316',
  '#f472b6',
  '#008450',
]);

function jerseyNumberColorForShirt(shirtHex6) {
  const expanded = jerseyToHex6(typeof shirtHex6 === 'string' ? shirtHex6 : '');
  const key = expanded ? expanded.toLowerCase() : '';
  if (key && JERSEY_PRESET_FORCE_BLACK_NUMBER.has(key)) return '#111827';
  const hex6 = expanded || DEFAULT_JERSEY_COLOR;
  return relativeLuminanceHex6(hex6) > 0.5 ? '#111827' : '#ffffff';
}

function isTeamShirtBlack(shirtHex6) {
  const h = shirtHex6.replace(/^#/, '');
  if (h.length !== 6) return false;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return false;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return relativeLuminanceHex6(shirtHex6) <= 0.12 && mx - mn <= 48 && mx <= 60;
}

function goalkeeperShirtHex(teamBaseHex6) {
  return isTeamShirtBlack(teamBaseHex6) ? '#ffffff' : '#000000';
}

export default function OfficialTeamDetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const teamId = Number(route?.params?.teamId);
  const competitionId = Number(route?.params?.competitionId);
  const routeInitialTab = resolveRouteInitialTab(route?.params);
  const [activeTab, setActiveTab] = useState(routeInitialTab || 'matches');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [teamMatches, setTeamMatches] = useState([]);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonYears, setSeasonYears] = useState([]);
  const [selectedSeasonYear, setSelectedSeasonYear] = useState(null);
  const [seasonStandings, setSeasonStandings] = useState([]);
  const [seasonStandingsGroups, setSeasonStandingsGroups] = useState(null);
  const [seasonKnockout, setSeasonKnockout] = useState(EMPTY_OFFICIAL_KNOCKOUT);
  const [seasonPickerOpen, setSeasonPickerOpen] = useState(false);
  const [teamSeasonLoading, setTeamSeasonLoading] = useState(false);
  const [teamSeasonYears, setTeamSeasonYears] = useState([]);
  const [selectedTeamSeasonYear, setSelectedTeamSeasonYear] = useState(null);
  const [teamSeasonSquad, setTeamSeasonSquad] = useState([]);
  const [teamSeasonJerseyColor, setTeamSeasonJerseyColor] = useState(DEFAULT_JERSEY_COLOR);
  const [teamSeasonLeagueId, setTeamSeasonLeagueId] = useState(null);
  const [statsSeasonLeagueId, setStatsSeasonLeagueId] = useState(null);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsYears, setStatsYears] = useState([]);
  const [selectedStatsYear, setSelectedStatsYear] = useState(ABSOLUTE_STATS_KEY);
  const [statsGeneral, setStatsGeneral] = useState({
    played: 0,
    goals: 0,
    goals_conceded: 0,
    yellow_cards: 0,
    red_cards: 0,
    biggest_win: null,
    heaviest_defeat: null,
  });
  const [statsOutcomes, setStatsOutcomes] = useState({ wins: 0, draws: 0, losses: 0, wins_pct: 0, draws_pct: 0, losses_pct: 0 });
  const [statsScorers, setStatsScorers] = useState([]);
  const [statsAssistmen, setStatsAssistmen] = useState([]);
  const [statsPresences, setStatsPresences] = useState([]);
  const [statsLeaderboardExpanded, setStatsLeaderboardExpanded] = useState({
    scorers: false,
    assistmen: false,
    presences: false,
  });
  const [statsPickerOpen, setStatsPickerOpen] = useState(false);
  const [outcomesOpponentsExpanded, setOutcomesOpponentsExpanded] = useState(false);
  const [outcomesOpponentsLoading, setOutcomesOpponentsLoading] = useState(false);
  const [outcomesOpponents, setOutcomesOpponents] = useState([]);
  const [outcomesOpponentsLoaded, setOutcomesOpponentsLoaded] = useState(false);
  const [outcomesOpponentsSort, setOutcomesOpponentsSort] = useState({ key: 'played', asc: false });
  const outcomesOpponentsLoadSeqRef = useRef(0);
  const [trophiesLoading, setTrophiesLoading] = useState(false);
  const [teamChampionships, setTeamChampionships] = useState([]);
  const [teamWineTrophies, setTeamWineTrophies] = useState([]);
  const [competitionName, setCompetitionName] = useState(
    () => String(route?.params?.groupName || '').trim(),
  );
  const [displayedFavoriteCount, setDisplayedFavoriteCount] = useState(0);
  const favoriteAnim = React.useRef(new Animated.Value(0)).current;
  const favoriteAnimListenerRef = React.useRef(null);
  const prevFavoriteCountRef = React.useRef(0);
  const matchesScrollRef = useRef(null);
  const [matchesViewportHeight, setMatchesViewportHeight] = useState(0);
  const [matchesContentHeight, setMatchesContentHeight] = useState(0);
  const itemLayoutsRef = useRef({});
  const [matchesTick, setMatchesTick] = useState(0);
  const initialScrollDoneRef = useRef(false);
  const seasonLoadSeqRef = useRef(0);
  const teamSeasonLoadSeqRef = useRef(0);
  const statsLoadSeqRef = useRef(0);
  const selectedSeasonYearRef = useRef(null);
  const selectedTeamSeasonYearRef = useRef(null);
  const selectedStatsYearRef = useRef(ABSOLUTE_STATS_KEY);
  const appliedInitialRouteKeyRef = useRef('');
  const seasonPickerAnchorRef = useRef(null);
  const statsPickerAnchorRef = useRef(null);
  const teamPickerAnchorRef = useRef(null);

  const load = useCallback(async (showLoading = false) => {
    if (!teamId || !competitionId) return;
    try {
      if (showLoading) setLoading(true);
      const res = await matchesService.getOfficialTeamDetail(teamId, competitionId);
      setData(res?.data || null);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [teamId, competitionId]);

  useEffect(() => {
    void load(true);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load])
  );

  const loadTeamMatches = useCallback(async () => {
    if (!teamId || !competitionId) return;
    try {
      setMatchesLoading(true);
      const res = await matchesService.getOfficialTeamMatches(teamId, competitionId);
      setTeamMatches(Array.isArray(res?.data?.matches) ? res.data.matches : []);
      itemLayoutsRef.current = {};
      initialScrollDoneRef.current = false;
      setMatchesTick((v) => v + 1);
    } finally {
      setMatchesLoading(false);
    }
  }, [teamId, competitionId]);

  useEffect(() => {
    if (activeTab !== 'matches') return;
    void loadTeamMatches();
  }, [activeTab, loadTeamMatches]);

  const loadSeasonStandings = useCallback(
    async (yearOverride = null) => {
      if (!teamId || !competitionId) return;
      seasonLoadSeqRef.current += 1;
      const seq = seasonLoadSeqRef.current;
      const targetYear = yearOverride != null ? yearOverride : selectedSeasonYearRef.current;
      try {
        setSeasonLoading(true);
        const res = await matchesService.getOfficialTeamSeasonStandings(teamId, competitionId, targetYear);
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
        console.error('Error loading team season standings:', err);
      } finally {
        if (seq === seasonLoadSeqRef.current) setSeasonLoading(false);
      }
    },
    [teamId, competitionId]
  );

  selectedSeasonYearRef.current = selectedSeasonYear;

  useEffect(() => {
    if (activeTab !== 'season') return;
    setSeasonPickerOpen(false);
    void loadSeasonStandings();
  }, [activeTab, loadSeasonStandings]);

  const loadTeamSeasonSquad = useCallback(
    async (yearOverride = null) => {
      if (!teamId || !competitionId) return;
      teamSeasonLoadSeqRef.current += 1;
      const seq = teamSeasonLoadSeqRef.current;
      const targetYear = yearOverride != null ? yearOverride : selectedTeamSeasonYearRef.current;
      try {
        setTeamSeasonLoading(true);
        const res = await matchesService.getOfficialTeamSeasonSquad(teamId, competitionId, targetYear);
        if (seq !== teamSeasonLoadSeqRef.current) return;
        const years = Array.isArray(res?.data?.available_years) ? res.data.available_years : [];
        const squad = Array.isArray(res?.data?.squad) ? res.data.squad : [];
        const backendSelected = res?.data?.selected_year != null ? Number(res.data.selected_year) : null;
        setTeamSeasonYears(years);
        setTeamSeasonSquad(squad);
        setTeamSeasonLeagueId(res?.data?.league_id != null ? Number(res.data.league_id) : null);
        setTeamSeasonJerseyColor(String(res?.data?.jersey_color || DEFAULT_JERSEY_COLOR));
        setSelectedTeamSeasonYear((prev) => {
          if (yearOverride != null && Number.isFinite(Number(yearOverride))) return Number(yearOverride);
          if (backendSelected == null || !Number.isFinite(backendSelected)) return prev;
          return prev === backendSelected ? prev : backendSelected;
        });
      } catch (err) {
        if (seq !== teamSeasonLoadSeqRef.current) return;
        console.error('Error loading team season squad:', err);
      } finally {
        if (seq === teamSeasonLoadSeqRef.current) setTeamSeasonLoading(false);
      }
    },
    [teamId, competitionId]
  );

  selectedTeamSeasonYearRef.current = selectedTeamSeasonYear;

  useEffect(() => {
    const nextTab = resolveRouteInitialTab(route?.params);
    const nextYear = resolveRouteInitialSeasonYear(route?.params);
    if (!nextTab) return;

    const routeKey = `${teamId}:${competitionId}:${nextTab}:${nextYear ?? ''}`;
    if (appliedInitialRouteKeyRef.current === routeKey) return;
    appliedInitialRouteKeyRef.current = routeKey;

    setActiveTab(nextTab);
    if (nextTab === 'team' && nextYear != null) {
      setSelectedTeamSeasonYear(nextYear);
      selectedTeamSeasonYearRef.current = nextYear;
      void loadTeamSeasonSquad(nextYear);
    }
  }, [route?.params?.initialTab, route?.params?.initialSeasonYear, teamId, competitionId, loadTeamSeasonSquad]);

  useEffect(() => {
    if (activeTab !== 'team') return;
    if (
      resolveRouteInitialTab(route?.params) === 'team'
      && resolveRouteInitialSeasonYear(route?.params) != null
    ) {
      return;
    }
    setTeamPickerOpen(false);
    void loadTeamSeasonSquad();
  }, [activeTab, loadTeamSeasonSquad, teamId, competitionId, route?.params?.initialTab, route?.params?.initialSeasonYear]);

  const loadTeamSeasonStats = useCallback(
    async (yearOverride = null) => {
      if (!teamId || !competitionId) return;
      statsLoadSeqRef.current += 1;
      const seq = statsLoadSeqRef.current;
      const rawYear = yearOverride != null ? yearOverride : selectedStatsYearRef.current;
      const targetYear =
        rawYear === ABSOLUTE_STATS_KEY || String(rawYear || '').toLowerCase() === ABSOLUTE_STATS_KEY
          ? ABSOLUTE_STATS_KEY
          : rawYear;
      try {
        setStatsLoading(true);
        const res = await matchesService.getOfficialTeamSeasonStats(teamId, competitionId, targetYear);
        if (seq !== statsLoadSeqRef.current) return;
        const years = Array.isArray(res?.data?.available_years) ? res.data.available_years : [];
        const rawBackendSelected = res?.data?.selected_year;
        const backendSelected =
          String(rawBackendSelected || '').trim().toLowerCase() === ABSOLUTE_STATS_KEY
            ? ABSOLUTE_STATS_KEY
            : (rawBackendSelected != null ? Number(rawBackendSelected) : null);
        setStatsYears(years);
        setStatsGeneral(res?.data?.general || {
          played: 0,
          goals: 0,
          goals_conceded: 0,
          yellow_cards: 0,
          red_cards: 0,
          biggest_win: null,
          heaviest_defeat: null,
        });
        setStatsOutcomes(res?.data?.outcomes || { wins: 0, draws: 0, losses: 0, wins_pct: 0, draws_pct: 0, losses_pct: 0 });
        setStatsScorers(Array.isArray(res?.data?.scorers) ? res.data.scorers : []);
        setStatsAssistmen(Array.isArray(res?.data?.assistmen) ? res.data.assistmen : []);
        setStatsPresences(Array.isArray(res?.data?.presences) ? res.data.presences : []);
        setStatsSeasonLeagueId(res?.data?.selected_league_id != null ? Number(res.data.selected_league_id) : null);
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
        console.error('Error loading team season stats:', err);
      } finally {
        if (seq === statsLoadSeqRef.current) setStatsLoading(false);
      }
    },
    [teamId, competitionId]
  );

  selectedStatsYearRef.current = selectedStatsYear;

  useEffect(() => {
    if (activeTab !== 'stats') return;
    setStatsPickerOpen(false);
    void loadTeamSeasonStats();
  }, [activeTab, loadTeamSeasonStats]);

  const loadTeamTrophies = useCallback(async () => {
    if (!teamId || !competitionId) return;
    try {
      setTrophiesLoading(true);
      const res = await matchesService.getOfficialTeamTrophies(teamId, competitionId);
      setTeamChampionships(Array.isArray(res?.data?.championships) ? res.data.championships : []);
      setTeamWineTrophies(Array.isArray(res?.data?.wine_trophies) ? res.data.wine_trophies : []);
      const apiGroupName = String(res?.data?.competition?.name || '').trim();
      if (apiGroupName) setCompetitionName(apiGroupName);
    } catch (err) {
      console.error('Error loading team trophies:', err);
      setTeamChampionships([]);
      setTeamWineTrophies([]);
    } finally {
      setTrophiesLoading(false);
    }
  }, [teamId, competitionId]);

  useEffect(() => {
    if (activeTab !== 'trophies') return;
    void loadTeamTrophies();
  }, [activeTab, loadTeamTrophies]);

  useEffect(() => {
    void loadTeamTrophies();
  }, [loadTeamTrophies]);

  useEffect(() => {
    setStatsLeaderboardExpanded({ scorers: false, assistmen: false, presences: false });
  }, [selectedStatsYear]);

  useEffect(() => {
    outcomesOpponentsLoadSeqRef.current += 1;
    setOutcomesOpponentsExpanded(false);
    setOutcomesOpponentsLoading(false);
    setOutcomesOpponents([]);
    setOutcomesOpponentsLoaded(false);
    setOutcomesOpponentsSort({ key: 'played', asc: false });
  }, [teamId, competitionId]);

  useEffect(() => {
    outcomesOpponentsLoadSeqRef.current += 1;
    setOutcomesOpponents([]);
    setOutcomesOpponentsLoaded(false);
    setOutcomesOpponentsLoading(false);
  }, [selectedStatsYear]);

  const loadOutcomesOpponents = useCallback(async () => {
    if (!teamId || !competitionId) return;
    const rawYear = selectedStatsYearRef.current;
    const targetYear =
      rawYear === ABSOLUTE_STATS_KEY || String(rawYear || '').toLowerCase() === ABSOLUTE_STATS_KEY
        ? ABSOLUTE_STATS_KEY
        : rawYear;
    outcomesOpponentsLoadSeqRef.current += 1;
    const seq = outcomesOpponentsLoadSeqRef.current;
    try {
      setOutcomesOpponentsLoading(true);
      const res = await matchesService.getOfficialTeamOpponentRecords(teamId, competitionId, targetYear);
      if (seq !== outcomesOpponentsLoadSeqRef.current) return;
      setOutcomesOpponents(Array.isArray(res?.data?.opponents) ? res.data.opponents : []);
      setOutcomesOpponentsLoaded(true);
    } catch (err) {
      if (seq !== outcomesOpponentsLoadSeqRef.current) return;
      console.error('Error loading team opponent records:', err);
      setOutcomesOpponents([]);
      setOutcomesOpponentsLoaded(true);
    } finally {
      if (seq === outcomesOpponentsLoadSeqRef.current) setOutcomesOpponentsLoading(false);
    }
  }, [teamId, competitionId]);

  const toggleOutcomesOpponents = useCallback(() => {
    setOutcomesOpponentsExpanded((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!outcomesOpponentsExpanded) return;
    if (outcomesOpponentsLoaded || outcomesOpponentsLoading) return;
    void loadOutcomesOpponents();
  }, [
    outcomesOpponentsExpanded,
    outcomesOpponentsLoaded,
    outcomesOpponentsLoading,
    loadOutcomesOpponents,
    selectedStatsYear,
  ]);

  const toggleOutcomesOpponentsSort = useCallback((key) => {
    setOutcomesOpponentsSort((prev) => {
      if (prev.key === key) return { key, asc: !prev.asc };
      const defaultAsc = key === 'name';
      return { key, asc: defaultAsc };
    });
  }, []);

  const STATS_LEADERBOARD_PREVIEW = 10;

  const toggleStatsLeaderboard = (tableKey) => {
    setStatsLeaderboardExpanded((prev) => ({ ...prev, [tableKey]: !prev[tableKey] }));
  };

  const openPlayerFromStatsRow = useCallback((row) => {
    const playerId = Number(row?.player_id);
    const leagueId = Number(row?.league_id) || Number(statsSeasonLeagueId) || Number(teamSeasonLeagueId);
    if (!playerId || !leagueId) return;
    navigation.navigate('PlayerStats', {
      playerId,
      leagueId,
      playerName: String(row?.name || '').trim() || undefined,
      playerPhotoPath: row?.photo_path || undefined,
      entrySource: 'official',
    });
  }, [navigation, statsSeasonLeagueId, teamSeasonLeagueId]);

  const renderStatsLeaderboardTable = (items, valueLabel, emptyText, tableKey) => {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      return <Text style={styles.placeholderText}>{emptyText}</Text>;
    }
    const canExpand = list.length > STATS_LEADERBOARD_PREVIEW;
    const expanded = !!statsLeaderboardExpanded[tableKey];
    const visible = !canExpand || expanded ? list : list.slice(0, STATS_LEADERBOARD_PREVIEW);
    const ranks = buildCompetitionRanks(list);
    return (
      <View style={styles.statsTableWrap}>
        <View style={[styles.statsTableRow, styles.statsTableHeaderRow]}>
          <Text style={[styles.statsTableCell, styles.statsTablePos, styles.statsTableHeaderCell]}>Pos.</Text>
          <Text style={[styles.statsTableCell, styles.statsTablePlayer, styles.statsTableHeaderCell]}>Giocatore</Text>
          <Text style={[styles.statsTableCell, styles.statsTableValue, styles.statsTableHeaderCell]} numberOfLines={1}>
            {valueLabel}
          </Text>
        </View>
        {visible.map((s, i) => {
          const playerName = String(s?.name || '-');
          const teamName = String(s?.team_name || '').trim();
          const playerId = Number(s?.player_id);
          const clusterId = Number(s?.cluster_id);
          const leagueId = Number(s?.league_id) || Number(statsSeasonLeagueId) || Number(teamSeasonLeagueId);
          const canOpenPlayer = playerId > 0 && leagueId > 0;
          const rowKey = clusterId > 0
            ? `${tableKey}-c-${clusterId}`
            : (playerId > 0 ? `${tableKey}-p-${playerId}` : `${tableKey}-${playerName}-${i}`);
          return (
            <TouchableOpacity
              key={rowKey}
              style={styles.statsTableRow}
              activeOpacity={canOpenPlayer ? 0.7 : 1}
              disabled={!canOpenPlayer}
              onPress={() => openPlayerFromStatsRow(s)}
            >
              <Text style={[styles.statsTableCell, styles.statsTablePos]}>{formatCompetitionRank(ranks[i])}</Text>
              <View style={styles.statsTablePlayerCol}>
                <Text style={styles.statsTablePlayerName} numberOfLines={1} ellipsizeMode="tail">
                  {playerName}
                </Text>
                {teamName ? (
                  <Text style={styles.statsTablePlayerTeam} numberOfLines={2} ellipsizeMode="tail">
                    {teamName}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.statsTableCell, styles.statsTableValue]}>{Number(s?.value || 0)}</Text>
            </TouchableOpacity>
          );
        })}
        {canExpand ? (
          <TouchableOpacity style={styles.statsTableExpandBtn} onPress={() => toggleStatsLeaderboard(tableKey)} activeOpacity={0.7}>
            <Text style={styles.statsTableExpandText}>
              {expanded ? 'Mostra meno' : `Mostra tutti (${list.length})`}
            </Text>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#111827" />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const team = data?.team || {};
  const favorites = data?.favorites || {};
  const notifications = data?.notifications || {};
  const teamName = team.name || route?.params?.teamName || '-';
  const favoriteCountText = formatFavoriteCount(displayedFavoriteCount);
  const sortedTeamSeasonSquad = useMemo(() => {
    const list = Array.isArray(teamSeasonSquad) ? [...teamSeasonSquad] : [];
    list.sort((a, b) => {
      const ra = ROLE_ORDER[String(a?.role || '').trim().toUpperCase()] ?? 99;
      const rb = ROLE_ORDER[String(b?.role || '').trim().toUpperCase()] ?? 99;
      if (ra !== rb) return ra - rb;
      const an = String(a?.name || `${a?.first_name || ''} ${a?.last_name || ''}`).trim();
      const bn = String(b?.name || `${b?.first_name || ''} ${b?.last_name || ''}`).trim();
      return an.localeCompare(bn, 'it');
    });
    return list;
  }, [teamSeasonSquad]);
  const sortedOutcomesOpponents = useMemo(() => {
    const list = Array.isArray(outcomesOpponents) ? [...outcomesOpponents] : [];
    const { key, asc } = outcomesOpponentsSort || { key: 'played', asc: false };
    const dir = asc ? 1 : -1;
    list.sort((a, b) => {
      if (key === 'name') {
        return dir * String(a?.name || '').localeCompare(String(b?.name || ''), 'it');
      }
      const av = Number(a?.[key] || 0);
      const bv = Number(b?.[key] || 0);
      if (av !== bv) return dir * (av - bv);
      return String(a?.name || '').localeCompare(String(b?.name || ''), 'it');
    });
    return list;
  }, [outcomesOpponents, outcomesOpponentsSort]);
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
  const teamYearOptions = useMemo(
    () =>
      (Array.isArray(teamSeasonYears) ? teamSeasonYears : []).map((y) => ({
        key: `team-season-year-${y}`,
        label: String(y),
        value: Number(y),
        active: Number(selectedTeamSeasonYear) === Number(y),
      })),
    [teamSeasonYears, selectedTeamSeasonYear]
  );
  const lastStartedIndex = useMemo(() => {
    if (!Array.isArray(teamMatches) || teamMatches.length === 0) return -1;
    const now = Date.now();
    let idx = -1;
    teamMatches.forEach((m, i) => {
      const d = parseAppDate(m.kickoff_at);
      const t = d ? d.getTime() : NaN;
      if (Number.isFinite(t) && t <= now) idx = i;
    });
    return idx;
  }, [teamMatches]);
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
      flowColStraightStack: styles.seasonKnockoutFlowColStraightStack,
      flowColStraightStackTall: styles.seasonKnockoutFlowColStraightStackTall,
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

  useEffect(() => {
    const target = Math.max(0, Number(team.favorite_count) || 0);
    const from = prevFavoriteCountRef.current;
    if (favoriteAnimListenerRef.current != null) {
      favoriteAnim.removeListener(favoriteAnimListenerRef.current);
      favoriteAnimListenerRef.current = null;
    }
    favoriteAnim.setValue(from);
    favoriteAnimListenerRef.current = favoriteAnim.addListener(({ value }) => {
      setDisplayedFavoriteCount(Math.max(0, Math.round(value)));
    });
    Animated.timing(favoriteAnim, {
      toValue: target,
      duration: 500,
      useNativeDriver: false,
    }).start(() => {
      setDisplayedFavoriteCount(target);
      prevFavoriteCountRef.current = target;
      if (favoriteAnimListenerRef.current != null) {
        favoriteAnim.removeListener(favoriteAnimListenerRef.current);
        favoriteAnimListenerRef.current = null;
      }
    });
    return () => {
      if (favoriteAnimListenerRef.current != null) {
        favoriteAnim.removeListener(favoriteAnimListenerRef.current);
        favoriteAnimListenerRef.current = null;
      }
    };
  }, [team.favorite_count, favoriteAnim]);

  const onToggleFavorite = async () => {
    if (!competitionId || !teamName || teamName === '-') return;
    await matchesService.setFavoriteTeam(competitionId, teamName, Number(favorites.team) !== 1);
    await load(false);
  };

  const onToggleNotifications = async () => {
    if (!competitionId || !teamName || teamName === '-') return;
    await matchesService.setTeamNotifications(competitionId, teamName, Number(notifications.enabled) !== 1);
    await load(false);
  };

  const handleBackNavigation = useCallback(() => {
    const state = navigation.getState();
    const prevRoute = state?.routes?.[Math.max(0, (state?.index || 0) - 1)]?.name;
    if (prevRoute === 'MatchDetail') {
      navigation.navigate('MainTabs', { screen: 'Partite' });
      return true;
    }
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

  useEffect(() => {
    if (activeTab !== 'matches') return;
    if (initialScrollDoneRef.current) return;
    if (!matchesScrollRef.current) return;
    if (matchesViewportHeight <= 0 || matchesContentHeight <= 0) return;
    if (!teamMatches.length) return;
    if (lastStartedIndex < 0) return;
    const anchorLayout = itemLayoutsRef.current[lastStartedIndex];
    if (!anchorLayout) return;
    const spaceFromAnchorToBottom = Math.max(0, matchesContentHeight - anchorLayout.y);
    if (spaceFromAnchorToBottom < matchesViewportHeight) {
      matchesScrollRef.current.scrollToEnd({ animated: false });
    } else {
      matchesScrollRef.current.scrollTo({ y: Math.max(0, anchorLayout.y), animated: false });
    }
    initialScrollDoneRef.current = true;
  }, [activeTab, matchesViewportHeight, matchesContentHeight, matchesTick, teamMatches, lastStartedIndex]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 6, 12) }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleBackNavigation}>
          <Ionicons name="arrow-back" size={20} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={onToggleNotifications}>
            <Ionicons name={Number(notifications.enabled) === 1 ? 'notifications' : 'notifications-outline'} size={20} color="#667eea" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.heroCard}>
        <TeamLogo logoUrl={team.logo_url} logoPath={team.logo_path} />
        <Text style={styles.teamName} numberOfLines={2}>
          {teamName}
        </Text>
        <TouchableOpacity style={styles.heroFavoriteCount} activeOpacity={0.75} onPress={onToggleFavorite}>
          <Ionicons name={Number(favorites.team) === 1 ? 'star' : 'star-outline'} size={30} color="#334155" />
          <View style={styles.heroFavoriteTextCol}>
            <Text style={styles.heroFavoriteCountText}>{favoriteCountText}</Text>
            <Text style={styles.heroFavoriteLabel}>Supporters</Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsScrollContent}>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'matches' && styles.tabBtnActive]} onPress={() => setActiveTab('matches')}><Text style={[styles.tabText, activeTab === 'matches' && styles.tabTextActive]}>Partite</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'season' && styles.tabBtnActive]} onPress={() => setActiveTab('season')}><Text style={[styles.tabText, activeTab === 'season' && styles.tabTextActive]}>Stagione</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'stats' && styles.tabBtnActive]} onPress={() => setActiveTab('stats')}><Text style={[styles.tabText, activeTab === 'stats' && styles.tabTextActive]}>Statistiche</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'team' && styles.tabBtnActive]} onPress={() => setActiveTab('team')}><Text style={[styles.tabText, activeTab === 'team' && styles.tabTextActive]}>Squadra</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, activeTab === 'trophies' && styles.tabBtnActive]} onPress={() => setActiveTab('trophies')}><Text style={[styles.tabText, activeTab === 'trophies' && styles.tabTextActive]}>Trofei</Text></TouchableOpacity>
      </ScrollView>

      <View style={styles.content}>
        {activeTab === 'matches' ? (
          <View style={[styles.card, styles.matchesCard]}>
            {matchesLoading ? (
              <View style={styles.matchesLoadingBox}>
                <ActivityIndicator color="#667eea" />
              </View>
            ) : (
              <ScrollView
                ref={matchesScrollRef}
                style={styles.matchesList}
                contentContainerStyle={styles.matchesListContent}
                onLayout={(e) => setMatchesViewportHeight(e.nativeEvent.layout.height)}
                onContentSizeChange={(_, h) => setMatchesContentHeight(h)}
                showsVerticalScrollIndicator={false}
              >
                {teamMatches.length === 0 ? (
                  <Text style={styles.placeholderText}>Nessuna partita disponibile.</Text>
                ) : (
                  teamMatches.map((m, idx) => {
                    const matchYear = getMatchYear(m.kickoff_at);
                    const previousMatchYear = idx > 0 ? getMatchYear(teamMatches[idx - 1]?.kickoff_at) : null;
                    const showYearDivider = matchYear != null && matchYear !== previousMatchYear;
                    const isTerminated = String(m?.last_phase_type || '').trim() === 'match_end';
                    const scoreParts = matchDisplayScoreParts(m);
                    const hasScore = scoreParts.show;
                    const statusText = getMatchStatusText(m);
                    const showShootoutStatus = isTerminated && scoreParts.hasRig;
                    const outcomeAccentColor = isTerminated ? getOutcomeAccentColor(m, teamName) : '#e2e8f0';
                    return (
                      <React.Fragment key={`team-match-wrap-${m.id}`}>
                        {showYearDivider ? (
                          <View style={styles.matchYearDivider}>
                            <View style={styles.matchYearDividerLine} />
                            <Text style={styles.matchYearDividerText}>{matchYear}</Text>
                            <View style={styles.matchYearDividerLine} />
                          </View>
                        ) : null}
                        <TouchableOpacity
                          key={`team-match-${m.id}`}
                          style={styles.matchRowCard}
                          activeOpacity={0.75}
                          onPress={() =>
                            navigation.navigate('MatchDetail', {
                              matchId: Number(m.id),
                              from: 'official-team',
                              teamId,
                              competitionId,
                              teamName,
                            })
                          }
                          onLayout={(e) => {
                            itemLayoutsRef.current[idx] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height };
                            setMatchesTick((v) => v + 1);
                          }}
                        >
                          <Text style={styles.matchTopMeta} numberOfLines={1}>
                            {formatMatchHeaderDate(m.kickoff_at, m.match_stage)}
                          </Text>
                          <View style={styles.matchTopDivider} />
                          <View style={styles.matchBodyRow}>
                            <View style={styles.matchTeamsCol}>
                              <View style={styles.matchTeamRow}>
                                <TeamRowLogo logoUrl={m.home_team_logo_url} logoPath={m.home_team_logo_path} />
                                <Text style={styles.matchTeamName} numberOfLines={1}>{m.home_team_name || '-'}</Text>
                                {hasScore ? <TeamMatchScore score={scoreParts.listHome} shootoutScore={scoreParts.hasRig ? scoreParts.rigHome : null} /> : null}
                              </View>
                              <View style={[styles.matchTeamRow, styles.matchTeamRowSecond]}>
                                <TeamRowLogo logoUrl={m.away_team_logo_url} logoPath={m.away_team_logo_path} />
                                <Text style={styles.matchTeamName} numberOfLines={1}>{m.away_team_name || '-'}</Text>
                                {hasScore ? <TeamMatchScore score={scoreParts.listAway} shootoutScore={scoreParts.hasRig ? scoreParts.rigAway : null} /> : null}
                              </View>
                            </View>
                            <View style={styles.matchMetaCol}>
                              <View style={[styles.matchMetaAccent, { backgroundColor: outcomeAccentColor }]} />
                              <View style={styles.matchMetaTextWrap}>
                                <Text style={styles.matchMetaText}>{statusText}</Text>
                                {showShootoutStatus ? <Text style={styles.matchMetaShootoutText}>RIG.</Text> : null}
                              </View>
                            </View>
                          </View>
                        </TouchableOpacity>
                      </React.Fragment>
                    );
                  })
                )}
              </ScrollView>
            )}
          </View>
        ) : activeTab === 'season' ? (
          <ScrollView
            style={styles.seasonScroll}
            contentContainerStyle={[styles.seasonScrollContent, { paddingBottom: Math.max(insets.bottom, 5)}]}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.card, styles.seasonCard]}>
              <View ref={seasonPickerAnchorRef} style={styles.seasonPickerWrap} collapsable={false}>
              <TouchableOpacity
                style={styles.seasonPickerBtn}
                onPress={() => setSeasonPickerOpen((v) => !v)}
                activeOpacity={0.8}
              >
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
                  setSelectedSeasonYear(item.value);
                  selectedSeasonYearRef.current = item.value;
                  void loadSeasonStandings(item.value);
                }}
              />
            </View>
            {seasonLoading ? (
              <View style={styles.matchesLoadingBox}>
                <ActivityIndicator color="#667eea" />
              </View>
            ) : (() => {
              const split =
                Array.isArray(seasonStandingsGroups) &&
                seasonStandingsGroups.length >= 2;
              const blocks = split
                ? seasonStandingsGroups.map((g, idx) => ({
                    label: String(g?.label || (idx === 0 ? 'Girone A' : 'Girone B')).trim() || (idx === 0 ? 'Girone A' : 'Girone B'),
                    standings: Array.isArray(g?.standings) ? g.standings : [],
                    key: `g-${g?.girone_index ?? idx}`,
                  }))
                : [{ label: null, standings: seasonStandings, key: 'single' }];
              const anyRows = blocks.some((b) => (b.standings || []).length > 0);
              if (!anyRows) {
                return (
                  <Text style={styles.placeholderText}>Nessuna classifica disponibile per la stagione selezionata.</Text>
                );
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
                          const isWatched = normalizeNameForCompare(r?.team_name) === normalizeNameForCompare(teamName);
                          const rowTeamId = Number(r?.team_id);
                          const isLastRow = i === block.standings.length - 1;
                          return (
                            <View
                              key={`${block.key}-st-${i}`}
                              style={[
                                styles.seasonTableRow,
                                isWatched && styles.seasonTableRowWatched,
                                isLastRow && styles.seasonTableRowLast,
                              ]}
                            >
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
                                <Text
                                  style={[styles.seasonTd, styles.seasonTdTeamName]}
                                  numberOfLines={1}
                                  ellipsizeMode="tail"
                                >
                                  {r.team_name_display || r.team_name || '-'}
                                </Text>
                              </TouchableOpacity>
                              <Text style={[styles.seasonTd, styles.seasonTdStat, { textAlign: 'center' }]}>{r.played}</Text>
                              <Text style={[styles.seasonTd, styles.seasonTdStat, { textAlign: 'center' }]}>{r.gf ?? 0}</Text>
                              <Text style={[styles.seasonTd, styles.seasonTdStat, { textAlign: 'center' }]}>{r.gs ?? r.ga ?? 0}</Text>
                              <Text style={[styles.seasonTd, styles.seasonTdStat, { textAlign: 'center' }]}>{r.goal_diff}</Text>
                              <Text style={[styles.seasonTd, styles.seasonTdStat, styles.seasonTdPt, { textAlign: 'center' }]}>
                                {r.points}
                              </Text>
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
                    navigation.navigate('MatchDetail', { matchId: Number(matchId), from: 'official-team-season' })
                  }
                  LogoComponent={SeasonKnockoutLogoAdapter}
                  tieBlockStyles={seasonKnockoutBlockStyles}
                  layoutStyles={seasonKnockoutLayout}
                />
              </View>
            ) : null}
          </ScrollView>
        ) : activeTab === 'trophies' ? (
          <View style={[styles.card, styles.trophiesCard]}>
            {trophiesLoading ? (
              <View style={[styles.matchesLoadingBox, styles.trophiesLoadingBox]}>
                <ActivityIndicator color="#c9a227" />
              </View>
            ) : (
              <ScrollView
                style={styles.trophiesList}
                contentContainerStyle={styles.trophiesScrollContent}
                showsVerticalScrollIndicator={false}
              >
                <OfficialTeamTrophyBoard
                  championships={teamChampionships}
                  wineTrophies={teamWineTrophies}
                  championshipTitle={competitionName}
                />
              </ScrollView>
            )}
          </View>
        ) : activeTab === 'stats' ? (
          <View style={[styles.card, styles.teamCard]}>
            <View ref={statsPickerAnchorRef} style={styles.seasonPickerWrap} collapsable={false}>
              <TouchableOpacity
                style={styles.seasonPickerBtn}
                onPress={() => setStatsPickerOpen((v) => !v)}
                activeOpacity={0.8}
              >
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
                  setSelectedStatsYear(item.value);
                  selectedStatsYearRef.current = item.value;
                  void loadTeamSeasonStats(item.value);
                }}
              />
            </View>

            {statsLoading ? (
              <View style={styles.matchesLoadingBox}>
                <ActivityIndicator color="#667eea" />
              </View>
            ) : (
              <ScrollView
                style={styles.teamSquadList}
                contentContainerStyle={styles.statsListContent}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.statsBlock}>
                  <Text style={styles.statsBlockTitle}>Generale</Text>
                  <View style={styles.statsValueRow}>
                    <Text style={styles.statsLabel}>Partite giocate</Text>
                    <Text style={styles.statsValue}>{Number(statsGeneral.played || 0)}</Text>
                  </View>
                  <View style={styles.statsValueRow}>
                    <Text style={styles.statsLabel}>Goal fatti</Text>
                    <Text style={styles.statsValue}>{Number(statsGeneral.goals || 0)}</Text>
                  </View>
                  <View style={styles.statsValueRow}>
                    <Text style={styles.statsLabel}>Goal subiti</Text>
                    <Text style={styles.statsValue}>{Number(statsGeneral.goals_conceded || 0)}</Text>
                  </View>
                  <View style={styles.statsValueRow}>
                    <Text style={styles.statsLabel}>Cartellini gialli/rossi</Text>
                    <Text style={styles.statsValue}>
                      {Number(statsGeneral.yellow_cards || 0)} / {Number(statsGeneral.red_cards || 0)}
                    </Text>
                  </View>
                  <View style={styles.statsRecordRow}>
                    <Text style={styles.statsRecordLabel} numberOfLines={1}>
                      Vittoria più larga
                    </Text>
                    {renderOfficialMatchRecord(statsGeneral.biggest_win, styles)}
                  </View>
                  <View style={styles.statsRecordRow}>
                    <Text style={styles.statsRecordLabel} numberOfLines={1}>
                      Sconfitta più pesante
                    </Text>
                    {renderOfficialMatchRecord(statsGeneral.heaviest_defeat, styles)}
                  </View>
                </View>

                <View style={styles.statsBlock}>
                  <Text style={styles.statsBlockTitle}>Risultati</Text>
                  <View style={styles.statsValueRow}>
                    <Text style={styles.statsLabel}>Vittorie</Text>
                    <Text style={styles.statsValue}>
                      {Number(statsOutcomes.wins || 0)} ({Number(statsOutcomes.wins_pct || 0)}%)
                    </Text>
                  </View>
                  <View style={styles.statsValueRow}>
                    <Text style={styles.statsLabel}>Pareggi</Text>
                    <Text style={styles.statsValue}>
                      {Number(statsOutcomes.draws || 0)} ({Number(statsOutcomes.draws_pct || 0)}%)
                    </Text>
                  </View>
                  <View style={styles.statsValueRow}>
                    <Text style={styles.statsLabel}>Sconfitte</Text>
                    <Text style={styles.statsValue}>
                      {Number(statsOutcomes.losses || 0)} ({Number(statsOutcomes.losses_pct || 0)}%)
                    </Text>
                  </View>

                  {outcomesOpponentsExpanded ? (
                    <View style={styles.outcomesOpponentsWrap}>
                      {outcomesOpponentsLoading ? (
                        <View style={styles.outcomesOpponentsLoading}>
                          <ActivityIndicator color="#667eea" size="small" />
                        </View>
                      ) : sortedOutcomesOpponents.length === 0 ? (
                        <Text style={[styles.placeholderText, styles.outcomesOpponentsEmpty]}>
                          Nessun avversario con partite conteggiate.
                        </Text>
                      ) : (
                        <View style={[styles.statsTableWrap, styles.outcomesOppTable]}>
                          <View style={[styles.statsTableRow, styles.statsTableHeaderRow, styles.outcomesOppHeaderRow]}>
                            {[
                              { key: 'name', label: 'Avversario', style: styles.outcomesOppThTeam },
                              { key: 'played', label: 'PG', style: styles.outcomesOppThNum },
                              { key: 'wins', label: 'V', style: styles.outcomesOppThNum },
                              { key: 'draws', label: 'P', style: styles.outcomesOppThNum },
                              { key: 'losses', label: 'S', style: styles.outcomesOppThNum },
                              { key: 'wins_pct', label: '%V', style: styles.outcomesOppThPct },
                            ].map((col) => {
                              const active = outcomesOpponentsSort.key === col.key;
                              return (
                                <TouchableOpacity
                                  key={col.key}
                                  style={[styles.outcomesOppSortableTh, col.style]}
                                  onPress={() => toggleOutcomesOpponentsSort(col.key)}
                                  activeOpacity={0.7}
                                >
                                  <Text
                                    style={[
                                      styles.statsTableHeaderCell,
                                      styles.outcomesOppHeaderText,
                                      active && styles.outcomesOppHeaderTextActive,
                                    ]}
                                    numberOfLines={1}
                                  >
                                    {col.label}
                                  </Text>
                                  {active ? (
                                    <Ionicons
                                      name={outcomesOpponentsSort.asc ? 'caret-up' : 'caret-down'}
                                      size={10}
                                      color="#4f46e5"
                                    />
                                  ) : null}
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                          {sortedOutcomesOpponents.map((row, i) => {
                            const oppId = Number(row?.team_id);
                            const canOpen = oppId > 0 && oppId !== Number(teamId);
                            return (
                              <TouchableOpacity
                                key={`opp-${row?.name || i}-${oppId || i}`}
                                style={[
                                  styles.statsTableRow,
                                  styles.outcomesOppRow,
                                  i === sortedOutcomesOpponents.length - 1 && styles.outcomesOppRowLast,
                                ]}
                                activeOpacity={canOpen ? 0.7 : 1}
                                disabled={!canOpen}
                                onPress={() => {
                                  if (!canOpen) return;
                                  navigation.navigate('OfficialTeamDetail', {
                                    teamId: oppId,
                                    competitionId,
                                    teamName: row?.name,
                                    groupName: competitionName || route?.params?.groupName,
                                  });
                                }}
                              >
                                <View style={styles.outcomesOppTeamCell}>
                                  <TeamLogoImage
                                    logoUrl={row?.team_logo_url}
                                    logoPath={row?.team_logo_path}
                                    style={styles.outcomesOppLogo}
                                    fallbackStyle={styles.outcomesOppLogoFallback}
                                    fallbackIconSize={12}
                                  />
                                  <Text style={styles.outcomesOppName} numberOfLines={1} ellipsizeMode="tail">
                                    {String(row?.name || '—')}
                                  </Text>
                                </View>
                                <Text style={[styles.statsTableCell, styles.outcomesOppNum]}>
                                  {Number(row?.played || 0)}
                                </Text>
                                <Text style={[styles.statsTableCell, styles.outcomesOppNum]}>
                                  {Number(row?.wins || 0)}
                                </Text>
                                <Text style={[styles.statsTableCell, styles.outcomesOppNum]}>
                                  {Number(row?.draws || 0)}
                                </Text>
                                <Text style={[styles.statsTableCell, styles.outcomesOppNum]}>
                                  {Number(row?.losses || 0)}
                                </Text>
                                <Text style={[styles.statsTableCell, styles.outcomesOppPct]}>
                                  {Number(row?.wins_pct || 0)}%
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  ) : null}

                  <TouchableOpacity
                    style={styles.statsTableExpandBtn}
                    onPress={toggleOutcomesOpponents}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.statsTableExpandText}>
                      {outcomesOpponentsExpanded ? 'Nascondi' : 'Esplora'}
                    </Text>
                    <Ionicons
                      name={outcomesOpponentsExpanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color="#111827"
                    />
                  </TouchableOpacity>
                </View>

                <View style={styles.statsLeaderboardBlock}>
                  <Text style={styles.statsLeaderboardTitle}>Marcatori</Text>
                  {renderStatsLeaderboardTable(statsScorers, 'Gol', 'Nessun marcatore disponibile.', 'scorers')}
                </View>

                <View style={styles.statsLeaderboardBlock}>
                  <Text style={styles.statsLeaderboardTitle}>Assistman</Text>
                  {renderStatsLeaderboardTable(statsAssistmen, 'Ass.', 'Nessun assist disponibile.', 'assistmen')}
                </View>

                <View style={styles.statsLeaderboardBlock}>
                  <Text style={styles.statsLeaderboardTitle}>Presenze</Text>
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
        ) : activeTab === 'team' ? (
          <View style={[styles.card, styles.teamCard]}>
            <View ref={teamPickerAnchorRef} style={styles.seasonPickerWrap} collapsable={false}>
              <TouchableOpacity
                style={styles.seasonPickerBtn}
                onPress={() => setTeamPickerOpen((v) => !v)}
                activeOpacity={0.8}
              >
                <Text style={styles.seasonPickerBtnText}>
                  {selectedTeamSeasonYear != null ? String(selectedTeamSeasonYear) : 'Seleziona anno'}
                </Text>
                <Ionicons name={teamPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#475569" />
              </TouchableOpacity>
              <SeasonYearPickerMenu
                open={teamPickerOpen}
                onClose={() => setTeamPickerOpen(false)}
                anchorRef={teamPickerAnchorRef}
                options={teamYearOptions}
                onSelectOption={(item) => {
                  setTeamPickerOpen(false);
                  setSelectedTeamSeasonYear(item.value);
                  selectedTeamSeasonYearRef.current = item.value;
                  void loadTeamSeasonSquad(item.value);
                }}
              />
            </View>

            {teamSeasonLoading ? (
              <View style={styles.matchesLoadingBox}>
                <ActivityIndicator color="#667eea" />
              </View>
            ) : sortedTeamSeasonSquad.length === 0 ? (
              <Text style={styles.placeholderText}>Nessun giocatore disponibile per la stagione selezionata.</Text>
            ) : (
              <ScrollView
                style={styles.teamSquadList}
                contentContainerStyle={styles.teamSquadListContent}
                showsVerticalScrollIndicator={false}
              >
                {sortedTeamSeasonSquad.map((p, i) => {
                  const role = String(p?.role || '').trim().toUpperCase();
                  const roleColor = ROLE_COLORS[role] || '#6b7280';
                  const teamShirtHex = jerseyToHex6(teamSeasonJerseyColor) || DEFAULT_JERSEY_COLOR;
                  const playerShirtHex = role === 'P' ? goalkeeperShirtHex(teamShirtHex) : teamShirtHex;
                  const playerNumberColor = jerseyNumberColorForShirt(playerShirtHex);
                  const playerName = String(p?.name || `${p?.first_name || ''} ${p?.last_name || ''}`).trim() || '-';
                  const shirtNumber =
                    p?.shirt_number != null && p?.shirt_number !== '' && !Number.isNaN(Number(p.shirt_number))
                      ? String(Number(p.shirt_number))
                      : '–';
                  const playerId = Number(p?.id || 0);
                  return (
                    <TouchableOpacity
                      key={`squad-${playerId || i}`}
                      style={styles.squadRow}
                      activeOpacity={0.75}
                      disabled={!playerId || !teamSeasonLeagueId}
                      onPress={() => {
                        if (!playerId || !teamSeasonLeagueId) return;
                        navigation.navigate('PlayerStats', {
                          playerId,
                          leagueId: Number(teamSeasonLeagueId),
                          playerName,
                          playerRole: role || undefined,
                          playerRating: p?.rating,
                          playerPhotoPath: p?.photo_path || undefined,
                          entrySource: 'official',
                        });
                      }}
                    >
                      <View style={styles.squadJerseyBadge}>
                        <MaterialCommunityIcons name="tshirt-crew" size={38} color={playerShirtHex} />
                        <Text style={[styles.squadJerseyNumber, { color: playerNumberColor }]}>{shirtNumber}</Text>
                      </View>
                      <Text style={styles.squadPlayerName} numberOfLines={2}>
                        {playerName}
                      </Text>
                      <View style={[styles.squadRolePill, { backgroundColor: roleColor }]}>
                        <Text style={styles.squadRolePillText}>{role || '–'}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.placeholderText}>Contenuto non disponibile.</Text>
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
    justifyContent: 'space-between',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  heroCard: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 0,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#ececec',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 170,
    position: 'relative',
  },
  logo: {
    width: 92,
    height: 92,
  },
  logoFallback: {
    width: 92,
    height: 92,
    borderRadius: 16,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamName: { marginTop: 10, fontSize: 21, fontWeight: '800', color: '#222', textAlign: 'center' },
  heroFavoriteCount: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  heroFavoriteTextCol: { justifyContent: 'center' },
  heroFavoriteCountText: { fontSize: 22, lineHeight: 24, fontWeight: '800', color: '#0f172a' },
  heroFavoriteLabel: { fontSize: 10, lineHeight: 12, fontWeight: '600', color: '#64748b' },
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
  matchesCard: {
    flex: 1,
    minHeight: 0,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 0,
  },
  teamCard: {
    flex: 1,
    minHeight: 0,
  },
  trophiesCard: {
    flex: 1,
    minHeight: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    overflow: 'hidden',
  },
  trophiesList: { flex: 1 },
  trophiesLoadingBox: { flex: 1, minHeight: 0 },
  trophiesScrollContent: {
    paddingBottom: 12,
    flexGrow: 1,
  },
  seasonCard: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 12,
  },
  seasonScroll: { flex: 1, marginHorizontal: -12 },
  seasonScrollContent: { paddingBottom: 8, paddingHorizontal: 12 },
  matchesLoadingBox: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  matchesList: { flex: 1 },
  matchesListContent: { paddingBottom: 12, width: '100%' },
  matchYearDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  matchYearDividerLine: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
  },
  matchYearDividerText: {
    marginHorizontal: 12,
    fontSize: 13,
    fontWeight: '900',
    color: '#334155',
    letterSpacing: 0.6,
  },
  matchRowCard: {
    flexDirection: 'column',
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: '#ffffff',
  },
  matchTopMeta: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 8,
  },
  matchTopDivider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    width: '100%',
    marginBottom: 8,
  },
  matchBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
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
  seasonPickerWrap: {
    marginBottom: 10,
    position: 'relative',
  },
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
  seasonPickerBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  seasonPickerModalRoot: {
    flex: 1,
  },
  seasonPickerModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
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
  seasonPickerDropdownScroll: {
    height: SEASON_YEAR_PICKER_MAX_HEIGHT,
  },
  seasonPickerDropdownScrollContent: {
    paddingBottom: 4,
  },
  seasonPickerItem: {
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  seasonPickerItemActive: {
    backgroundColor: '#eef2ff',
  },
  seasonPickerItemText: { fontSize: 14, fontWeight: '600', color: '#334155' },
  seasonPickerItemTextActive: { color: '#4f46e5', fontWeight: '700' },
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
  seasonTableRowWatched: {
    backgroundColor: '#e5e7eb',
  },
  seasonTableRowLast: {
    borderBottomWidth: 0,
  },
  teamCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  seasonTeamCell: { gap: 6 },
  seasonTd: { fontSize: 13, fontWeight: '400', color: '#1f2937' },
  seasonTdPos: { width: 44, fontWeight: '600' },
  seasonTdStat: { width: 28 },
  seasonTdPt: { fontWeight: '700' },
  seasonTdTeamName: { flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: '600' },
  seasonKnockoutCard: {
    marginTop: 12,
    marginHorizontal: -8,
    borderRadius: 12,
    paddingTop: 12,
    paddingHorizontal: 5,
    paddingBottom: 6,
  },
  seasonKnockoutTitle: { fontSize: 16, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 6 },
  seasonStandingsTablesCol: { gap: 14 },
  seasonStandingsTableBlock: { width: '100%' },
  seasonGironeTitle: { fontSize: 15, fontWeight: '800', color: '#111827', marginBottom: 8 },
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
  teamSquadListContent: { paddingBottom: 8, paddingTop: 2 },
  squadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 4,
    paddingVertical: 8,
    marginBottom: 2,
    backgroundColor: '#fff',
    gap: 12,
  },
  squadJerseyBadge: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  squadJerseyNumber: {
    position: 'absolute',
    top: 9,
    fontSize: 12,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    minWidth: 12,
  },
  squadRolePill: {
    minWidth: 28,
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  squadRolePillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  squadPlayerName: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '400',
    color: '#1f2937',
  },
  statsListContent: { paddingBottom: 12 },
  statsBlock: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  statsBlockTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 4,
  },
  outcomesOppTable: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  outcomesOpponentsWrap: {
    marginTop: 10,
  },
  outcomesOpponentsEmpty: {
    paddingBottom: 4,
  },
  outcomesOpponentsLoading: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outcomesOppHeaderRow: {
    paddingVertical: 7,
  },
  outcomesOppSortableTh: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  outcomesOppThTeam: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'flex-start',
    paddingRight: 4,
  },
  outcomesOppThNum: {
    width: 30,
    flexShrink: 0,
  },
  outcomesOppThPct: {
    width: 42,
    flexShrink: 0,
    justifyContent: 'center',
  },
  outcomesOppHeaderText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
  },
  outcomesOppHeaderTextActive: {
    color: '#4f46e5',
  },
  outcomesOppRow: {
    paddingVertical: 7,
  },
  outcomesOppRowLast: {
    borderBottomWidth: 0,
  },
  outcomesOppTeamCell: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 4,
  },
  outcomesOppLogo: {
    width: 20,
    height: 20,
  },
  outcomesOppLogoFallback: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outcomesOppName: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: '600',
    color: '#1f2937',
  },
  outcomesOppNum: {
    width: 30,
    textAlign: 'center',
    flexShrink: 0,
    fontSize: 12,
  },
  outcomesOppPct: {
    width: 42,
    textAlign: 'center',
    flexShrink: 0,
    fontSize: 12,
    fontWeight: '700',
  },
  statsLeaderboardBlock: { marginBottom: 18 },
  statsLeaderboardTitle: { fontSize: 15, fontWeight: '800', color: '#1e293b', marginBottom: 8 },
  statsBlockSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748b',
    marginBottom: 8,
    lineHeight: 17,
  },
  statsRow: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1f2937',
    lineHeight: 22,
  },
  statsValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 8,
  },
  statsRecordRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    paddingVertical: 4,
    gap: 4,
  },
  statsRecordLabel: {
    flexGrow: 0,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#1f2937',
    lineHeight: 22,
  },
  statsLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: '500',
    color: '#1f2937',
  },
  statsValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'right',
  },
  statsRecordValue: {
    flexGrow: 0,
    flexShrink: 0,
    marginLeft: 'auto',
    alignItems: 'center',
    minWidth: 88,
  },
  statsRecordScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 22,
  },
  statsRecordEmpty: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    lineHeight: 22,
    minWidth: 88,
  },
  statsRecordLogo: {
    width: 22,
    height: 22,
  },
  statsRecordLogoFallback: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRecordScore: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    minWidth: 40,
  },
  statsRecordDate: {
    fontSize: 11,
    fontWeight: '500',
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 2,
    alignSelf: 'stretch',
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
  statsTableValue: { width: 44, minWidth: 44, textAlign: 'right', flexShrink: 0, fontWeight: '700' },
  statsTableExpandBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, borderBottomWidth: 0 },
  statsTableExpandText: { fontSize: 13, fontWeight: '700', color: '#111827' },
  placeholderTitle: { fontSize: 17, fontWeight: '800', color: '#222', marginBottom: 6 },
  placeholderText: { fontSize: 14, color: '#64748b' },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MatchMinuteRing from '../components/MatchMinuteRing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { matchesService } from '../services/api';
import { matchDisplayScoreParts } from '../utils/matchDisplayScore';
import { fetchAndCacheStripTeams, refreshStripTeams } from '../services/matchesStripPrefetch';
import {
  peekStripTeamsMemory,
  readStripTeamsDisk,
  isStripTeamsFresh,
} from '../services/matchesStripTeamsCache';
import { PlayerPhotoImage, TeamLogoImage } from '../components/StableCachedImage';
import FollowTeamsPreferencesModal from '../components/FollowTeamsPreferencesModal';
import { useAuth } from '../context/AuthContext';
import { canOpenMatchManagement as roleCanOpenMatchManagement } from '../utils/userRoles';
import {
  computeLiveHeroClock,
  getLastLivePhaseEvent,
  matchListNeedsLiveTick,
} from '../utils/officialMatchLiveClock';
import { parseAppDate } from '../utils/dateTime';
import { trackOfficialPlayerProfileOpen } from '../utils/trackOfficialPlayerProfileOpen';

/** Elenco partite: poll veloce solo in finestra live / pre-kickoff. */
const MATCHES_LIST_POLL_MS_LIVE = 4000;
const MATCHES_LIST_PRE_KICKOFF_MS = 2 * 60 * 1000;
const MATCHES_LIST_POST_KICKOFF_GRACE_MS = 3 * 60 * 60 * 1000;
const MATCHES_SEARCH_DEBOUNCE_MS = 300;

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const MONTH_NAMES = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
function toDateKey(date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function withOffset(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

function dateFromKey(key) {
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return withOffset(0);
  return d;
}

function labelForDate(date) {
  const today = withOffset(0);
  const current = new Date(date);
  current.setHours(0, 0, 0, 0);
  const diffDays = Math.round((current.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === -1) return 'Ieri';
  if (diffDays === 0) return 'Oggi';
  if (diffDays === 1) return 'Domani';
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

function GroupTitleLogo({ logoUrl, logoPath }) {
  if (!logoUrl && !logoPath) return null;
  return (
    <TeamLogoImage
      logoUrl={logoUrl}
      logoPath={logoPath}
      style={styles.groupTitleLogo}
    />
  );
}

function TeamRowLogo({ logoUrl, logoPath }) {
  return (
    <TeamLogoImage
      logoUrl={logoUrl}
      logoPath={logoPath}
      style={styles.teamLogo}
      fallbackStyle={styles.teamLogoFallback}
    />
  );
}

function SearchPlayerCareerLogos({ teams }) {
  const list = Array.isArray(teams) ? teams.filter((t) => String(t?.name || '').trim()) : [];
  if (!list.length) {
    return <Ionicons name="person-outline" size={16} color="#cbd5e1" />;
  }
  return (
    <View style={styles.searchCareerLogos}>
      {list.map((team, index) => (
        <View
          key={`${team.name || 't'}-${index}`}
          style={[
            styles.searchCareerLogoWrap,
            index > 0 ? styles.searchCareerLogoOverlap : null,
            { zIndex: list.length - index },
          ]}
        >
          <TeamLogoImage
            logoUrl={team.logo_url}
            logoPath={team.logo_path}
            style={styles.searchCareerLogo}
            fallbackStyle={styles.searchCareerLogoFallback}
            fallbackIconSize={10}
          />
        </View>
      ))}
    </View>
  );
}

const LIST_RING_SIZE = 32;
const LIST_RING_STROKE = 2.5;
const LIST_RING_TRACK = '#e5e7eb';
const LIST_RING_PROGRESS = '#111827';

function matchHasStartedForList(match) {
  return getLastLivePhaseEvent(Array.isArray(match.live_phase_events) ? match.live_phase_events : []) != null;
}

function matchHasEndedForList(match) {
  const events = Array.isArray(match.live_phase_events) ? match.live_phase_events : [];
  return events.some((e) => e?.event_type === 'match_end');
}

function parseMatchKickoffMs(kickoffAt) {
  const d = parseAppDate(kickoffAt);
  if (!d || Number.isNaN(d.getTime())) return NaN;
  return d.getTime();
}

/**
 * Poll rete solo se c’è almeno una partita in diretta, oppure nella finestra
 * [kickoff − 2min, kickoff + 3h] senza match_end. Altrimenti stop (giornata morta / lontana).
 */
function shouldPollMatchesList(items, now = Date.now()) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return false;

  for (const m of list) {
    const ended = matchHasEndedForList(m);
    const started = matchHasStartedForList(m);
    if (started && !ended) return true;
    if (ended || started) continue;
    const kickMs = parseMatchKickoffMs(m?.kickoff_at);
    if (!Number.isFinite(kickMs)) continue;
    if (now >= kickMs - MATCHES_LIST_PRE_KICKOFF_MS && now <= kickMs + MATCHES_LIST_POST_KICKOFF_GRACE_MS) {
      return true;
    }
  }
  return false;
}

function mergeMatchesLiveListUpdate(prevItems, updates) {
  const prev = Array.isArray(prevItems) ? prevItems : [];
  const list = Array.isArray(updates) ? updates : [];
  if (!prev.length || !list.length) return prev;
  const byId = new Map();
  list.forEach((u) => {
    const id = Number(u?.id);
    if (Number.isFinite(id) && id > 0) byId.set(id, u);
  });
  if (!byId.size) return prev;
  return prev.map((m) => {
    const u = byId.get(Number(m.id));
    if (!u) return m;
    return {
      ...m,
      status: u.status != null ? u.status : m.status,
      home_score: u.home_score,
      away_score: u.away_score,
      live_home_score: u.live_home_score,
      live_away_score: u.live_away_score,
      home_shootout_score: u.home_shootout_score,
      away_shootout_score: u.away_shootout_score,
      home_pre_shootout_score: u.home_pre_shootout_score,
      away_pre_shootout_score: u.away_pre_shootout_score,
      last_phase_type: u.last_phase_type,
      last_phase_minute: u.last_phase_minute,
      live_phase_events: Array.isArray(u.live_phase_events) ? u.live_phase_events : m.live_phase_events,
      is_walkover: u.is_walkover != null ? u.is_walkover : m.is_walkover,
    };
  });
}

function MatchListMinuteRing({ minuteStr, progress }) {
  return (
    <View style={styles.matchListRingWrap}>
      <MatchMinuteRing
        size={LIST_RING_SIZE}
        stroke={LIST_RING_STROKE}
        trackColor={LIST_RING_TRACK}
        progressColor={LIST_RING_PROGRESS}
        progress={progress}
        minuteStr={minuteStr}
        minuteTextStyle={styles.matchListMinuteText}
      />
    </View>
  );
}

function MatchRowTimeArea({ match, tick, formatTimeFn }) {
  const events = Array.isArray(match.live_phase_events) ? match.live_phase_events : [];
  const lastPhase = getLastLivePhaseEvent(events);
  if (!lastPhase) {
    return <Text style={styles.matchRowKickoffTime}>{formatTimeFn(match.kickoff_at)}</Text>;
  }
  const clock = computeLiveHeroClock(events, match, tick, 0);
  if (clock.variant === 'running') {
    return <MatchListMinuteRing minuteStr={clock.minuteStr} progress={clock.ringProgress} />;
  }
  return (
    <Text style={styles.matchRowPhaseLabel} numberOfLines={1}>
      {clock.main}
    </Text>
  );
}

function MatchListMatchRow({ match, formatTimeFn, liveListTick, onPress, onToggleFavorite }) {
  const started = matchHasStartedForList(match);
  const scoreParts = matchDisplayScoreParts(match);
  const showScore = started || scoreParts.hasPre;
  return (
    <TouchableOpacity style={styles.matchRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.teamsCol}>
        <View style={styles.teamRow}>
          <TeamRowLogo logoUrl={match.home_team_logo_url} logoPath={match.home_team_logo_path} />
          <View style={styles.teamNameScoreBlock}>
            <View style={styles.teamNameCell}>
              <Text style={styles.teamNameInRow} numberOfLines={1} ellipsizeMode="tail">
                {match.home_team_name}
              </Text>
            </View>
            {showScore ? (
              <View style={styles.teamScoreCol}>
                <Text style={styles.teamScoreInRow}>{scoreParts.listHome}</Text>
                {scoreParts.hasRig ? (
                  <>
                    <View style={styles.teamShootoutDivider} />
                    <Text style={styles.teamShootoutScoreInRow}>{scoreParts.rigHome}</Text>
                  </>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.teamRow}>
          <TeamRowLogo logoUrl={match.away_team_logo_url} logoPath={match.away_team_logo_path} />
          <View style={styles.teamNameScoreBlock}>
            <View style={styles.teamNameCell}>
              <Text style={styles.teamNameInRow} numberOfLines={1} ellipsizeMode="tail">
                {match.away_team_name}
              </Text>
            </View>
            {showScore ? (
              <View style={styles.teamScoreCol}>
                <Text style={styles.teamScoreInRow}>{scoreParts.listAway}</Text>
                {scoreParts.hasRig ? (
                  <>
                    <View style={styles.teamShootoutDivider} />
                    <Text style={styles.teamShootoutScoreInRow}>{scoreParts.rigAway}</Text>
                  </>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </View>
      <View style={styles.matchMetaCol}>
        <View style={styles.matchMetaTimeSlot}>
          <MatchRowTimeArea match={match} tick={liveListTick} formatTimeFn={formatTimeFn} />
        </View>
        <TouchableOpacity
          onPress={onToggleFavorite}
          style={styles.matchFavBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name={Number(match.is_favorite_match) === 1 ? 'star' : 'star-outline'} size={16} color="#ffc107" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

export default function MatchesScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const { user, token, refreshSession } = useAuth();
  const superuserLevel = Number(user?.is_superuser || 0);
  const canOpenMatchManagement = roleCanOpenMatchManagement(superuserLevel);
  const [selectedDate, setSelectedDate] = useState(toDateKey(withOffset(0)));
  const selectedDateRef = useRef(selectedDate);
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [calendarPickerDate, setCalendarPickerDate] = useState(() => dateFromKey(selectedDate));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const lastLoadedDateRef = useRef(null);
  const [daysViewportWidth, setDaysViewportWidth] = useState(0);
  const [dayLayouts, setDayLayouts] = useState({});
  const daysScrollRef = useRef(null);
  const [followModalVisible, setFollowModalVisible] = useState(false);
  const [liveListTick, setLiveListTick] = useState(0);
  const [heartTeams, setHeartTeams] = useState(() => peekStripTeamsMemory() || []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchTeams, setSearchTeams] = useState([]);
  const [searchPlayers, setSearchPlayers] = useState([]);
  const [trendingPlayers, setTrendingPlayers] = useState([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const searchInputRef = useRef(null);
  const searchSeqRef = useRef(0);
  const trendingSeqRef = useRef(0);

  const onHeaderLayout = useCallback((event) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    setHeaderHeight((prev) => (prev === nextHeight ? prev : nextHeight));
  }, []);

  const loadStripTeams = useCallback(async (force = false) => {
    try {
      if (!force && isStripTeamsFresh()) {
        const mem = peekStripTeamsMemory();
        if (mem?.length) setHeartTeams(mem);
        return;
      }
      const teams = force
        ? await refreshStripTeams(token)
        : await fetchAndCacheStripTeams(token);
      setHeartTeams(teams);
    } catch (_) {}
  }, [token]);

  useEffect(() => {
    readStripTeamsDisk().then((cached) => {
      if (cached?.length) setHeartTeams(cached);
    });
  }, []);

  // Solo al focus: niente doppio mount+focus. Rete solo se cache strip scaduta.
  useFocusEffect(
    useCallback(() => {
      void loadStripTeams(false);
      // Ruolo admin/GM può essere cambiato da SuperUser: riallinea subito.
      refreshSession?.().catch(() => {});
    }, [loadStripTeams, refreshSession])
  );

  const selectDate = useCallback((dateKey) => {
    selectedDateRef.current = dateKey;
    setCalendarPickerDate(dateFromKey(dateKey));
    setSelectedDate(dateKey);
  }, []);

  const openCalendarPicker = useCallback(() => {
    setCalendarPickerDate(dateFromKey(selectedDateRef.current));
    setShowCalendarPicker(true);
  }, []);

  const days = useMemo(() => {
    const base = dateFromKey(selectedDate);
    const out = [];
    // Legacy: mostra oggi ±6 giorni
    for (let i = -6; i <= 6; i += 1) {
      const date = new Date(base);
      date.setDate(base.getDate() + i);
      out.push({ key: toDateKey(date), label: labelForDate(date) });
    }
    return out;
  }, [selectedDate]);

  const grouped = useMemo(() => {
    const map = new Map();
    items.forEach((m) => {
      const key = m.competition_name || 'Competizione';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(m);
    });
    return Array.from(map.entries()).map(([competition, matches]) => ({ competition, matches }));
  }, [items]);

  const favoriteMatches = useMemo(() => items.filter((m) => Number(m.is_favorite) === 1), [items]);

  const matchListNeedsTick = useMemo(
    () => items.some((m) => matchListNeedsLiveTick(m.live_phase_events)),
    [items]
  );

  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (!matchListNeedsTick) return undefined;
    const id = setInterval(() => setLiveListTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [matchListNeedsTick]);

  const regularGrouped = useMemo(() => {
    const regular = items.filter((m) => Number(m.is_favorite) !== 1);
    const map = new Map();
    regular.forEach((m) => {
      const compId = Number(m.competition_id) || 0;
      const key = compId > 0 ? `id:${compId}` : `name:${m.competition_name || 'Competizione'}`;
      if (!map.has(key)) {
        map.set(key, {
          competition: m.competition_name || 'Competizione',
          competitionId: compId > 0 ? compId : null,
          competitionLogoUrl: m.competition_logo_url || null,
          competitionLogoPath: m.competition_logo_path || null,
          matches: [],
        });
      }
      map.get(key).matches.push(m);
    });
    return Array.from(map.values());
  }, [items]);

  const load = useCallback(async (date, isRefresh = false) => {
    const requestDate = String(date || '').trim();
    // Refresh silenzioso solo se stiamo ricaricando la stessa data già mostrata.
    const silent = isRefresh && lastLoadedDateRef.current === requestDate;
    try {
      setError(null);
      if (!silent) setLoading(true);
      const res = await matchesService.getByDate(requestDate);
      const matches = Array.isArray(res?.data?.matches) ? res.data.matches : [];
      if (selectedDateRef.current !== requestDate) return;
      setItems(matches);
      lastLoadedDateRef.current = requestDate;
    } catch (e) {
      if (selectedDateRef.current !== requestDate) return;
      setItems([]);
      lastLoadedDateRef.current = null;
      setError(e?.response?.data?.message || e?.message || 'Errore caricamento partite');
    } finally {
      if (selectedDateRef.current === requestDate) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const loadLiveList = useCallback(async (date) => {
    const requestDate = String(date || '').trim();
    if (!requestDate) return;
    try {
      const res = await matchesService.getLiveListByDate(requestDate);
      if (selectedDateRef.current !== requestDate) return;
      const updates = Array.isArray(res?.data?.matches) ? res.data.matches : [];
      setItems((prev) => mergeMatchesLiveListUpdate(prev, updates));
    } catch {
      // Fallback: backend non aggiornato / errore → full list, così la live non si spegne.
      try {
        const res = await matchesService.getByDate(requestDate);
        if (selectedDateRef.current !== requestDate) return;
        const matches = Array.isArray(res?.data?.matches) ? res.data.matches : [];
        setItems(matches);
      } catch {
        /* prossimo tick ritenta */
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Anche con calendario aperto: la data va comunque caricata (iOS non chiude il picker da solo).
      const date = selectedDate;
      void load(date, true);

      if (showCalendarPicker) return undefined;

      const id = setInterval(() => {
        if (selectedDateRef.current !== date) return;
        if (!shouldPollMatchesList(itemsRef.current, Date.now())) return;
        void loadLiveList(date);
      }, MATCHES_LIST_POLL_MS_LIVE);

      return () => clearInterval(id);
    }, [selectedDate, load, loadLiveList, showCalendarPicker])
  );

  useEffect(() => {
    if (!isFocused) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !showCalendarPicker) load(selectedDate, true);
    });
    return () => sub.remove();
  }, [isFocused, selectedDate, load, showCalendarPicker]);

  const goToMatchDetail = (matchId) => {
    navigation.navigate('MatchDetail', { matchId, from: 'matches-main' });
  };

  const goToManageMatches = () => {
    navigation.navigate('ManageMatches');
  };

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchText('');
    setSearchQuery('');
    setSearchTeams([]);
    setSearchPlayers([]);
    setTrendingPlayers([]);
    setSearchLoading(false);
    setTrendingLoading(false);
  }, []);

  const toggleSearch = useCallback(() => {
    setSearchOpen((open) => {
      if (open) {
        closeSearch();
        return false;
      }
      setTimeout(() => searchInputRef.current?.focus(), 80);
      return true;
    });
  }, [closeSearch]);

  useEffect(() => {
    const trimmed = String(searchText || '').trim();
    const timer = setTimeout(() => setSearchQuery(trimmed), MATCHES_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (!searchOpen) return undefined;

    const q = String(searchQuery || '').trim();
    if (q.length < 2) {
      setSearchTeams([]);
      setSearchPlayers([]);
      setSearchLoading(false);
      return undefined;
    }

    searchSeqRef.current += 1;
    const seq = searchSeqRef.current;
    let cancelled = false;

    const run = async () => {
      try {
        setSearchLoading(true);
        const res = await matchesService.searchOfficial(q);
        if (cancelled || seq !== searchSeqRef.current) return;
        setSearchTeams(Array.isArray(res?.data?.teams) ? res.data.teams : []);
        setSearchPlayers(Array.isArray(res?.data?.players) ? res.data.players : []);
      } catch (_) {
        if (cancelled || seq !== searchSeqRef.current) return;
        setSearchTeams([]);
        setSearchPlayers([]);
      } finally {
        if (!cancelled && seq === searchSeqRef.current) {
          setSearchLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [searchOpen, searchQuery]);

  useEffect(() => {
    if (!searchOpen) return undefined;
    const q = String(searchQuery || '').trim();
    if (q.length > 0) {
      setTrendingPlayers([]);
      setTrendingLoading(false);
      return undefined;
    }

    trendingSeqRef.current += 1;
    const seq = trendingSeqRef.current;
    let cancelled = false;

    const run = async () => {
      try {
        setTrendingLoading(true);
        const res = await matchesService.getTrendingPlayers();
        if (cancelled || seq !== trendingSeqRef.current) return;
        setTrendingPlayers(Array.isArray(res?.data?.players) ? res.data.players : []);
      } catch (_) {
        if (cancelled || seq !== trendingSeqRef.current) return;
        setTrendingPlayers([]);
      } finally {
        if (!cancelled && seq === trendingSeqRef.current) {
          setTrendingLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [searchOpen, searchQuery]);

  const goToOfficialPlayer = useCallback((player) => {
    const playerId = Number(player?.player_id);
    const leagueId = Number(player?.league_id);
    if (!playerId || !leagueId) return;
    trackOfficialPlayerProfileOpen({
      playerId,
      leagueId,
      competitionId: player?.competition_id,
    });
    closeSearch();
    navigation.navigate('PlayerStats', {
      playerId,
      leagueId,
      playerName: String(player?.name || '').trim() || undefined,
      playerRole: player?.role || undefined,
      playerPhotoPath: player?.photo_path || undefined,
      entrySource: 'official',
    });
  }, [navigation, closeSearch]);

  const goToOfficialTeamFromSearch = useCallback((team) => {
    const teamId = Number(team?.team_id);
    const competitionId = Number(team?.competition_id);
    if (!teamId || !competitionId) return;
    closeSearch();
    navigation.navigate('OfficialTeamDetail', {
      teamId,
      competitionId,
      teamName: String(team?.name || '').trim() || undefined,
    });
  }, [navigation, closeSearch]);

  const showSearchResults = searchOpen && (searchLoading || searchQuery.trim().length >= 2);
  const showTrending = searchOpen && searchQuery.trim().length === 0;
  const showSearchPanel = showSearchResults || showTrending;
  const hasSearchResults = searchTeams.length > 0 || searchPlayers.length > 0;
  const hasTrending = trendingPlayers.length > 0;

  const onRefresh = () => {
    setRefreshing(true);
    load(selectedDate, true);
  };

  const handleCalendarChange = (event, pickedDate) => {
    if (Platform.OS === 'android') {
      setShowCalendarPicker(false);
      if (event?.type === 'dismissed') return;
      const nextDate = pickedDate || calendarPickerDate;
      if (!nextDate) return;
      setCalendarPickerDate(nextDate);
      selectDate(toDateKey(nextDate));
      return;
    }
    // iOS spinner: aggiorna la data in anteprima; chiusura esplicita con Fatto.
    if (!pickedDate) return;
    setCalendarPickerDate(pickedDate);
    selectDate(toDateKey(pickedDate));
  };

  const closeCalendarPicker = useCallback(() => {
    setShowCalendarPicker(false);
  }, []);

  useEffect(() => {
    const layout = dayLayouts[selectedDate];
    if (!layout || !daysViewportWidth || !daysScrollRef.current) return;
    const targetX = Math.max(0, layout.x + layout.width / 2 - daysViewportWidth / 2);
    daysScrollRef.current.scrollTo({ x: targetX, animated: true });
  }, [selectedDate, dayLayouts, daysViewportWidth]);

  const formatTime = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '--:--';
    return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
  };

  const toggleFavoriteMatch = async (match) => {
    try {
      await matchesService.setFavoriteMatch(match.id, Number(match.is_favorite_match) !== 1);
      await load(selectedDate, true);
    } catch (_) {}
  };

  const openFollowModal = () => {
    if (!token) return;
    setFollowModalVisible(true);
  };

  const onFollowPreferencesSaved = useCallback(async () => {
    await Promise.all([load(selectedDate, true), loadStripTeams(true)]);
  }, [load, selectedDate, loadStripTeams]);

  const hasFavoriteTeams = useMemo(
    () => heartTeams.some((t) => Number(t?.is_heart) === 1),
    [heartTeams]
  );

  return (
    <View style={styles.container}>
      <View
        style={[styles.header, { paddingTop: Math.max(insets.top + 6, 12) }]}
        onLayout={onHeaderLayout}
      >
        <Text style={[styles.headerTitle, searchOpen && styles.headerTitleCompact]} numberOfLines={1}>
          Partite
        </Text>
        <View style={styles.headerActions}>
          {searchOpen ? (
            <View style={styles.headerSearchInputWrap}>
              <TextInput
                ref={searchInputRef}
                style={styles.headerSearchInput}
                placeholder="Squadra o giocatore..."
                placeholderTextColor="#94a3b8"
                value={searchText}
                onChangeText={setSearchText}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
              />
              {searchText.length > 0 ? (
                <TouchableOpacity
                  onPress={() => setSearchText('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={16} color="#94a3b8" />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          <TouchableOpacity style={styles.headerEditBtn} onPress={toggleSearch} activeOpacity={0.8}>
            <Ionicons name={searchOpen ? 'close' : 'search-outline'} size={18} color="#667eea" />
          </TouchableOpacity>
          {canOpenMatchManagement ? (
            <TouchableOpacity
              style={styles.headerEditBtn}
              onPress={goToManageMatches}
              activeOpacity={0.8}
            >
              <Ionicons name="pencil-outline" size={18} color="#667eea" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {heartTeams.length > 0 && (
        <View style={styles.heartStripWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.heartStrip}
          >
            {heartTeams.map((t, idx) => {
              return (
                <TouchableOpacity
                  key={`heart-${t.team_id ?? idx}-${t.name}`}
                  style={styles.heartTeamItem}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (t.team_id && t.competition_id) {
                      navigation.navigate('OfficialTeamDetail', {
                        teamId: t.team_id,
                        competitionId: t.competition_id,
                        teamName: t.name,
                      });
                    }
                  }}
                >
                  <View style={styles.heartTeamCircleWrap}>
                    <View style={styles.heartTeamCircle}>
                      <TeamLogoImage
                        logoUrl={t.logo_url}
                        logoPath={t.logo_path}
                        style={styles.heartTeamLogo}
                        fallbackStyle={styles.heartTeamLogoFallback}
                        fallbackIconSize={28}
                      />
                    </View>
                    {Number(t.is_heart) === 1 && (
                      <View style={styles.heartBadge}>
                        <Ionicons name="star" size={17} color="#ffc107" />
                      </View>
                    )}
                  </View>
                  <Text style={styles.heartTeamName} numberOfLines={1} ellipsizeMode="tail">
                    {t.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
      <View style={styles.content}>
      <View style={styles.daysControlsRow}>
        <ScrollView
          ref={daysScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.daysRow}
          onLayout={(e) => setDaysViewportWidth(e.nativeEvent.layout.width)}
        >
          <TouchableOpacity
            style={styles.calendarBtn}
            onPress={openCalendarPicker}
          >
            <Ionicons name="calendar-outline" size={20} color="#667eea" />
          </TouchableOpacity>
          {days.map((d) => {
            const active = d.key === selectedDate;
            return (
              <TouchableOpacity
                key={d.key}
                style={[styles.dayChip, active && styles.dayChipActive]}
                onPress={() => selectDate(d.key)}
                onLayout={(e) => {
                  const { x, width } = e.nativeEvent.layout;
                  setDayLayouts((prev) => {
                    const current = prev[d.key];
                    if (current && current.x === x && current.width === width) return prev;
                    return { ...prev, [d.key]: { x, width } };
                  });
                }}
              >
                <Text style={[styles.dayText, active && styles.dayTextActive]}>{d.label}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={styles.calendarBtn}
            onPress={openCalendarPicker}
          >
            <Ionicons name="calendar-outline" size={20} color="#667eea" />
          </TouchableOpacity>
        </ScrollView>
      </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#667eea" />
          </View>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={{ paddingBottom: token ? 100 : 24 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {!error && grouped.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="football-outline" size={28} color="#888" />
                <Text style={styles.emptyText}>Nessuna partita per questa data</Text>
              </View>
            ) : null}
            {!error && favoriteMatches.length > 0 ? (
              <View style={styles.groupBox}>
                <View style={styles.favHeader}>
                  <Ionicons name="star" size={16} color="#ffc107" />
                  <Text style={styles.groupTitle}>Preferite</Text>
                </View>
                {favoriteMatches.map((m) => (
                  <MatchListMatchRow
                    key={`fav-match-${m.id}`}
                    match={m}
                    formatTimeFn={formatTime}
                    liveListTick={liveListTick}
                    onPress={() => goToMatchDetail(m.id)}
                    onToggleFavorite={() => toggleFavoriteMatch(m)}
                  />
                ))}
              </View>
            ) : null}
            {regularGrouped.map((group) => (
              <View key={group.competitionId || group.competition} style={styles.groupBox}>
                <TouchableOpacity
                  style={styles.groupTitleRow}
                  activeOpacity={group.competitionId ? 0.7 : 1}
                  disabled={!group.competitionId}
                  onPress={() => {
                    if (!group.competitionId) return;
                    navigation.navigate('OfficialGroupDetail', {
                      competitionId: group.competitionId,
                      groupName: group.competition,
                    });
                  }}
                >
                  <GroupTitleLogo
                    logoUrl={group.competitionLogoUrl}
                    logoPath={group.competitionLogoPath}
                  />
                  <Text
                    style={[styles.groupTitle, group.competitionId ? styles.groupTitleLink : null]}
                    numberOfLines={1}
                  >
                    {group.competition}
                  </Text>
                </TouchableOpacity>
                {group.matches.map((m) => (
                  <MatchListMatchRow
                    key={m.id}
                    match={m}
                    formatTimeFn={formatTime}
                    liveListTick={liveListTick}
                    onPress={() => goToMatchDetail(m.id)}
                    onToggleFavorite={() => toggleFavoriteMatch(m)}
                  />
                ))}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
      {showCalendarPicker ? (
        Platform.OS === 'ios' ? (
          <View style={styles.iosCalendarOverlay}>
            <Pressable style={styles.iosCalendarBackdrop} onPress={closeCalendarPicker} />
            <View style={[styles.iosCalendarSheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <View style={styles.iosCalendarHeader}>
                <Text style={styles.iosCalendarTitle}>Scegli data</Text>
                <TouchableOpacity onPress={closeCalendarPicker} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={styles.iosCalendarDone}>Fatto</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={calendarPickerDate}
                mode="date"
                display="spinner"
                onChange={handleCalendarChange}
              />
            </View>
          </View>
        ) : (
          <DateTimePicker
            value={calendarPickerDate}
            mode="date"
            display="default"
            onChange={handleCalendarChange}
          />
        )
      ) : null}

      {token && !hasFavoriteTeams ? (
        <TouchableOpacity style={styles.fabStar} onPress={openFollowModal} accessibilityLabel="Squadre preferite e notifiche">
          <Ionicons name="star" size={26} color="#fff" />
        </TouchableOpacity>
      ) : null}

      {showSearchPanel && headerHeight > 0 ? (
        <View style={[styles.searchResultsOverlay, { top: headerHeight }]} pointerEvents="box-none">
          <View style={styles.searchResultsPanel}>
            {showTrending ? (
              trendingLoading ? (
                <View style={styles.searchResultsLoading}>
                  <ActivityIndicator size="small" color="#667eea" />
                </View>
              ) : !hasTrending ? (
                <Text style={styles.searchResultsEmpty}>Digita almeno 2 caratteri per cercare</Text>
              ) : (
                <ScrollView
                  style={styles.searchResultsScroll}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={styles.searchSectionLabel}>Più cercati</Text>
                  {trendingPlayers.map((player) => (
                    <TouchableOpacity
                      key={`trend-${player.player_id}-${player.league_id}`}
                      style={styles.searchResultRow}
                      activeOpacity={0.75}
                      onPress={() => goToOfficialPlayer(player)}
                    >
                      <PlayerPhotoImage
                        photoPath={player.photo_path || undefined}
                        style={styles.searchPlayerPhoto}
                        fallbackStyle={styles.searchPlayerPhotoFallback}
                        fallbackIconSize={16}
                      />
                      <View style={styles.searchResultMeta}>
                        <Text style={styles.searchResultTitle} numberOfLines={1}>{player.name}</Text>
                        <Text style={styles.searchResultSubtitle} numberOfLines={1}>
                          {[player.team_name, player.competition_name].filter(Boolean).join(' · ') || 'Giocatore ufficiale'}
                        </Text>
                      </View>
                      <Ionicons name="trending-up" size={16} color="#cbd5e1" />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )
            ) : searchLoading ? (
              <View style={styles.searchResultsLoading}>
                <ActivityIndicator size="small" color="#667eea" />
              </View>
            ) : !hasSearchResults ? (
              <Text style={styles.searchResultsEmpty}>Nessun risultato</Text>
            ) : (
              <ScrollView
                style={styles.searchResultsScroll}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
              >
                {searchTeams.map((team) => (
                  <TouchableOpacity
                    key={`team-${team.team_id}-${team.competition_id}`}
                    style={styles.searchResultRow}
                    activeOpacity={0.75}
                    onPress={() => goToOfficialTeamFromSearch(team)}
                  >
                    <TeamRowLogo logoUrl={team.logo_url} logoPath={team.logo_path} />
                    <View style={styles.searchResultMeta}>
                      <Text style={styles.searchResultTitle} numberOfLines={1}>{team.name}</Text>
                      <Text style={styles.searchResultSubtitle} numberOfLines={1}>
                        {team.competition_name || 'Squadra ufficiale'}
                      </Text>
                    </View>
                    <Ionicons name="shield-outline" size={16} color="#cbd5e1" />
                  </TouchableOpacity>
                ))}
                {searchPlayers.map((player) => (
                  <TouchableOpacity
                    key={`player-${player.player_id}-${player.league_id}`}
                    style={styles.searchResultRow}
                    activeOpacity={0.75}
                    onPress={() => goToOfficialPlayer(player)}
                  >
                    <PlayerPhotoImage
                      photoPath={player.photo_path || undefined}
                      style={styles.searchPlayerPhoto}
                      fallbackStyle={styles.searchPlayerPhotoFallback}
                      fallbackIconSize={16}
                    />
                    <View style={styles.searchResultMeta}>
                      <Text style={styles.searchResultTitle} numberOfLines={1}>{player.name}</Text>
                      <Text style={styles.searchResultSubtitle} numberOfLines={1}>
                        {[player.team_name, player.competition_name].filter(Boolean).join(' · ') || 'Giocatore ufficiale'}
                      </Text>
                    </View>
                    <SearchPlayerCareerLogos teams={player.career_teams} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      ) : null}

      <FollowTeamsPreferencesModal
        visible={followModalVisible}
        onClose={() => setFollowModalVisible(false)}
        token={token}
        onSaved={onFollowPreferencesSaved}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ececec',
    paddingHorizontal: 14,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerTitle: { flexShrink: 1, fontSize: 24, fontWeight: '800', color: '#222' },
  headerTitleCompact: { fontSize: 20 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    flexShrink: 0,
  },
  headerSearchInputWrap: {
    width: 168,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerSearchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: '#1e293b',
    paddingVertical: 0,
  },
  headerEditBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#d8d8d8',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchResultsOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 100,
  },
  searchResultsPanel: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ececec',
    maxHeight: 280,
    paddingHorizontal: 10,
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  searchResultsScroll: {
    maxHeight: 260,
  },
  searchResultsLoading: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchResultsEmpty: {
    paddingVertical: 16,
    paddingHorizontal: 8,
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
  },
  searchSectionLabel: {
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 2,
    fontSize: 11,
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  searchResultMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  searchResultTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
  },
  searchResultSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
  },
  searchPlayerPhoto: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  searchPlayerPhotoFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchCareerLogos: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minWidth: 28,
    maxWidth: 96,
  },
  searchCareerLogoWrap: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchCareerLogoOverlap: {
    marginLeft: -8,
  },
  searchCareerLogo: {
    width: 28,
    height: 28,
  },
  searchCareerLogoFallback: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1 },
  daysControlsRow: {
    paddingHorizontal: 6,
  },
  calendarBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#d6d6d6',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
  },
  daysRow: { paddingHorizontal: 12, paddingTop: 2, paddingBottom: 6, gap: 8, alignItems: 'center' },
  dayChip: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignSelf: 'center',
  },
  dayChipActive: { borderColor: '#667eea', backgroundColor: '#eef2ff' },
  dayText: { color: '#475569', fontWeight: '700', fontSize: 13 },
  dayTextActive: { color: '#667eea' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { flex: 1, paddingHorizontal: 12 },
  errorText: { color: '#dc3545', margin: 12 },
  emptyBox: { marginTop: 36, alignItems: 'center', gap: 8 },
  emptyText: { color: '#666' },
  groupBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ececec',
  },
  groupTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  groupTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: '#111827' },
  groupTitleLink: { color: '#111827' },
  groupTitleLogo: { width: 22, height: 22, flexShrink: 0 },
  favHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f1f1',
    paddingVertical: 14,
    minHeight: 76,
  },
  teamsCol: { flex: 1, gap: 5 },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  /** Nome (flex) + colonna punteggio a larghezza fissa: gol allineati tra le due righe. */
  teamNameScoreBlock: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  teamNameCell: {
    flex: 1,
    minWidth: 0,
  },
  teamNameInRow: {
    width: '100%',
    color: '#222',
    fontSize: 14,
    fontWeight: '600',
  },
  teamScoreCol: {
    width: 40,
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingLeft: 4,
    flexDirection: 'row',
    gap: 2,
  },
  teamScoreInRow: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  teamShootoutDivider: { width: 1, height: 14, backgroundColor: '#d1d5db' },
  teamShootoutScoreInRow: { fontSize: 11, fontWeight: '800', color: '#9ca3af', fontVariant: ['tabular-nums'] },
  teamLogo: { width: 26, height: 26 },
  teamLogoFallback: { width: 26, height: 26, borderRadius: 6, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  matchMetaCol: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    minWidth: 156,
    paddingLeft: 6,
  },
  /** Centra cronometro / orario / PT–FT nella colonna, allineato alla stella a destra. */
  matchMetaTimeSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  matchFavBtn: { width: 36, justifyContent: 'center', alignItems: 'center' },
  matchRowKickoffTime: { color: '#111827', fontWeight: '800', fontSize: 14, textAlign: 'center' },
  matchRowPhaseLabel: {
    color: '#111827',
    fontWeight: '800',
    fontSize: 12,
    maxWidth: 96,
    textAlign: 'center',
  },
  matchListRingWrap: {
    width: LIST_RING_SIZE,
    height: LIST_RING_SIZE,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  matchListMinuteText: { fontSize: 11, fontWeight: '800', color: '#111827' },
  fabStar: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#667eea',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  heartStripWrap: {
    backgroundColor: '#f5f5f5',
  },
  heartStrip: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 16,
  },
  heartTeamItem: {
    alignItems: 'center',
    width: 72,
  },
  heartTeamCircleWrap: {
    position: 'relative',
  },
  heartTeamCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2.5,
    borderColor: '#667eea',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  heartBadge: {
    position: 'absolute',
    bottom: 0,
    right: -1,
  },
  heartTeamLogo: {
    width: 36,
    height: 36,
  },
  heartTeamLogoFallback: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartTeamName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#333',
    marginTop: 5,
    textAlign: 'center',
    maxWidth: 72,
  },
  iosCalendarOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 50,
  },
  iosCalendarBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  iosCalendarSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
  },
  iosCalendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  iosCalendarTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  iosCalendarDone: { fontSize: 16, fontWeight: '700', color: '#667eea' },
});


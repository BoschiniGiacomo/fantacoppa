import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MatchMinuteRing from '../components/MatchMinuteRing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { matchesService, publicAssetUrl } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  computeLiveHeroClock,
  getLastLivePhaseEvent,
  matchListNeedsLiveTick,
} from '../utils/officialMatchLiveClock';

/** Elenco partite: refresh mentre il tab è aperto (punteggi / fasi da altri client o da DB). */
const MATCHES_LIST_POLL_MS_LIVE = 4000;
const MATCHES_LIST_POLL_MS_IDLE = 12000;

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

function TeamRowLogo({ logoUrl, logoPath }) {
  const uri = logoUrl || publicAssetUrl(logoPath);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  if (!uri || failed) {
    return (
      <View style={styles.teamLogoFallback}>
        <Ionicons name="shield-outline" size={17} color="#667eea" />
      </View>
    );
  }
  return <Image source={{ uri }} style={styles.teamLogo} onError={() => setFailed(true)} resizeMode="contain" />;
}

const LIST_RING_SIZE = 32;
const LIST_RING_STROKE = 2.5;
const LIST_RING_TRACK = '#e5e7eb';
const LIST_RING_PROGRESS = '#111827';

function matchHasStartedForList(match) {
  return getLastLivePhaseEvent(Array.isArray(match.live_phase_events) ? match.live_phase_events : []) != null;
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
  const hs = Number(match.live_home_score);
  const as = Number(match.live_away_score);
  const homeScore = Number.isFinite(hs) ? hs : 0;
  const awayScore = Number.isFinite(as) ? as : 0;
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
            {started ? (
              <View style={styles.teamScoreCol}>
                <Text style={styles.teamScoreInRow}>{homeScore}</Text>
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
            {started ? (
              <View style={styles.teamScoreCol}>
                <Text style={styles.teamScoreInRow}>{awayScore}</Text>
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
  const { user, token } = useAuth();
  const superuserLevel = Number(user?.is_superuser || 0);
  const canOpenMatchManagement = superuserLevel === 1 || superuserLevel === 2;
  const [selectedDate, setSelectedDate] = useState(toDateKey(withOffset(0)));
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [daysViewportWidth, setDaysViewportWidth] = useState(0);
  const [dayLayouts, setDayLayouts] = useState({});
  const daysScrollRef = useRef(null);
  const [followModalVisible, setFollowModalVisible] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [followSaving, setFollowSaving] = useState(false);
  const [followDraft, setFollowDraft] = useState([]);
  const [followError, setFollowError] = useState(null);
  const [liveListTick, setLiveListTick] = useState(0);

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

  const matchesListPollMs = useMemo(
    () => (items.some((m) => matchHasStartedForList(m)) ? MATCHES_LIST_POLL_MS_LIVE : MATCHES_LIST_POLL_MS_IDLE),
    [items]
  );

  useEffect(() => {
    if (!matchListNeedsTick) return undefined;
    const id = setInterval(() => setLiveListTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [matchListNeedsTick]);

  const regularGrouped = useMemo(() => {
    const regular = items.filter((m) => Number(m.is_favorite) !== 1);
    const map = new Map();
    regular.forEach((m) => {
      const key = m.competition_name || 'Competizione';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(m);
    });
    return Array.from(map.entries()).map(([competition, matches]) => ({ competition, matches }));
  }, [items]);

  const load = useCallback(async (date, isRefresh = false) => {
    try {
      setError(null);
      if (!isRefresh) setLoading(true);
      const res = await matchesService.getByDate(date);
      setItems(Array.isArray(res?.data?.matches) ? res.data.matches : []);
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Errore caricamento partite');
    } finally {
      if (!isRefresh) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(selectedDate);
  }, [selectedDate, load]);

  useFocusEffect(
    useCallback(() => {
      load(selectedDate, true);
      const id = setInterval(() => load(selectedDate, true), matchesListPollMs);
      return () => clearInterval(id);
    }, [selectedDate, load, matchesListPollMs])
  );

  useEffect(() => {
    if (!isFocused) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load(selectedDate, true);
    });
    return () => sub.remove();
  }, [isFocused, selectedDate, load]);

  const goToMatchDetail = (matchId) => {
    navigation.navigate('MatchDetail', { matchId });
  };

  const goToManageMatches = () => {
    navigation.navigate('ManageMatches');
  };

  const onRefresh = () => {
    setRefreshing(true);
    load(selectedDate, true);
  };

  const handleCalendarChange = (event, pickedDate) => {
    if (Platform.OS === 'android') {
      setShowCalendarPicker(false);
      if (event?.type === 'dismissed') return;
    }
    if (!pickedDate) return;
    setSelectedDate(toDateKey(pickedDate));
  };

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

  const openFollowModal = async () => {
    if (!token) return;
    setFollowModalVisible(true);
    setFollowError(null);
    setFollowLoading(true);
    try {
      const res = await matchesService.getFollowSetup();
      const comps = Array.isArray(res?.data?.competitions) ? res.data.competitions : [];
      setFollowDraft(
        comps.map((c) => ({
          ...c,
          heart_team_names: [...(c.heart_team_names || [])],
          notify_team_names: [...(c.notify_team_names || [])],
        }))
      );
    } catch (e) {
      setFollowError(e?.response?.data?.message || e?.message || 'Impossibile caricare le preferenze');
      setFollowDraft([]);
    } finally {
      setFollowLoading(false);
    }
  };

  const toggleDraftHeart = (compId, teamName) => {
    setFollowDraft((prev) =>
      prev.map((c) => {
        if (c.id !== compId) return c;
        const has = (c.heart_team_names || []).includes(teamName);
        const next = has ? c.heart_team_names.filter((t) => t !== teamName) : [...(c.heart_team_names || []), teamName];
        return { ...c, heart_team_names: next };
      })
    );
  };

  const toggleDraftNotify = (compId, teamName) => {
    setFollowDraft((prev) =>
      prev.map((c) => {
        if (c.id !== compId) return c;
        const has = (c.notify_team_names || []).includes(teamName);
        const next = has ? c.notify_team_names.filter((t) => t !== teamName) : [...(c.notify_team_names || []), teamName];
        return { ...c, notify_team_names: next };
      })
    );
  };

  const saveFollowPreferences = async () => {
    if (!token) return;
    setFollowSaving(true);
    setFollowError(null);
    try {
      await matchesService.saveFollowPreferences({
        competitions: followDraft.map((c) => ({
          official_group_id: c.id,
          heart_team_names: c.heart_team_names || [],
          notify_team_names: c.notify_team_names || [],
        })),
      });
      setFollowModalVisible(false);
      await load(selectedDate, true);
    } catch (e) {
      setFollowError(e?.response?.data?.message || e?.message || 'Salvataggio non riuscito');
    } finally {
      setFollowSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 6, 12) }]}>
        <Text style={styles.headerTitle}>Partite</Text>
        {canOpenMatchManagement ? (
          <TouchableOpacity
            style={styles.headerEditBtn}
            onPress={goToManageMatches}
          >
            <Ionicons name="pencil-outline" size={18} color="#667eea" />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerEditBtnPlaceholder} />
        )}
      </View>

      <View style={[styles.content, { paddingTop: 10 }]}>
      <View style={styles.daysControlsRow}>
        <ScrollView
          ref={daysScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.daysRow}
          onLayout={(e) => setDaysViewportWidth(e.nativeEvent.layout.width)}
        >
          <TouchableOpacity style={styles.calendarBtn} onPress={() => setShowCalendarPicker(true)}>
            <Ionicons name="calendar-outline" size={20} color="#667eea" />
          </TouchableOpacity>
          {days.map((d) => {
            const active = d.key === selectedDate;
            return (
              <TouchableOpacity
                key={d.key}
                style={[styles.dayChip, active && styles.dayChipActive]}
                onPress={() => setSelectedDate(d.key)}
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
          <TouchableOpacity style={styles.calendarBtn} onPress={() => setShowCalendarPicker(true)}>
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
              <View key={group.competition} style={styles.groupBox}>
                <Text style={styles.groupTitle}>{group.competition}</Text>
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
        <DateTimePicker
          value={dateFromKey(selectedDate)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleCalendarChange}
        />
      ) : null}

      {token ? (
        <TouchableOpacity style={styles.fabStar} onPress={openFollowModal} accessibilityLabel="Squadre preferite e notifiche">
          <Ionicons name="star" size={26} color="#fff" />
        </TouchableOpacity>
      ) : null}

      <Modal visible={followModalVisible} transparent animationType="fade" onRequestClose={() => setFollowModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxHeight: '85%' }]}>
            <Text style={styles.modalTitle}>Squadre preferite</Text>
            {followLoading ? (
              <ActivityIndicator style={{ marginVertical: 24 }} color="#667eea" />
            ) : (
              <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
                {followError ? <Text style={styles.errorText}>{followError}</Text> : null}
                {followDraft.map((c) => (
                  <View key={`follow-comp-${c.id}`} style={styles.followCompBlock}>
                    <Text style={styles.followCompTitle}>{c.name}</Text>
                    {(c.teams || []).length === 0 ? (
                      <Text style={styles.mutedSmall}>Nessuna squadra in elenco</Text>
                    ) : (
                      (c.teams || []).map((tname) => {
                        const isHeart = (c.heart_team_names || []).includes(tname);
                        const isNotify = (c.notify_team_names || []).includes(tname);
                        return (
                          <View key={`${c.id}-${tname}`} style={styles.followTeamRow}>
                            <Text style={styles.followTeamName} numberOfLines={1}>
                              {tname}
                            </Text>
                            <View style={styles.followIcons}>
                              <TouchableOpacity
                                style={[styles.followIconBtn, isHeart && styles.followIconBtnActive]}
                                onPress={() => toggleDraftHeart(c.id, tname)}
                              >
                                <Ionicons name={isHeart ? 'star' : 'star-outline'} size={22} color={isHeart ? '#ffc107' : '#888'} />
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.followIconBtn, isNotify && styles.followIconBtnActive]}
                                onPress={() => toggleDraftNotify(c.id, tname)}
                              >
                                <Ionicons name={isNotify ? 'notifications' : 'notifications-outline'} size={22} color={isNotify ? '#667eea' : '#888'} />
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })
                    )}
                  </View>
                ))}
              </ScrollView>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtnSecondary} onPress={() => setFollowModalVisible(false)} disabled={followSaving}>
                <Text style={styles.modalBtnSecondaryText}>Chiudi</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnPrimary, followSaving && styles.modalBtnDisabled]}
                onPress={saveFollowPreferences}
                disabled={followLoading || followSaving}
              >
                <Text style={styles.modalBtnPrimaryText}>{followSaving ? 'Salvo…' : 'Salva'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#222' },
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
  headerEditBtnPlaceholder: { width: 34, height: 34 },
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
  daysRow: { paddingHorizontal: 12, paddingVertical: 6, gap: 8, alignItems: 'center' },
  dayChip: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignSelf: 'center',
  },
  dayChipActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  dayText: { color: '#333', fontWeight: '600' },
  dayTextActive: { color: '#fff' },
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
  groupTitle: { fontSize: 15, fontWeight: '700', color: '#333', marginBottom: 8 },
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
    width: 36,
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingLeft: 10,
  },
  teamScoreInRow: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  teamLogo: { width: 26, height: 26, borderRadius: 6, backgroundColor: '#f7f7f7' },
  teamLogoFallback: { width: 26, height: 26, borderRadius: 6, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  matchMetaCol: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    minWidth: 168,
    paddingLeft: 8,
  },
  /** Centra cronometro / orario / PT–FT nella colonna, allineato alla stella a destra. */
  matchMetaTimeSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 88,
  },
  matchFavBtn: { width: 36, justifyContent: 'center', alignItems: 'center' },
  matchRowKickoffTime: { color: '#111827', fontWeight: '800', fontSize: 14, textAlign: 'center' },
  matchRowPhaseLabel: {
    color: '#111827',
    fontWeight: '800',
    fontSize: 12,
    maxWidth: 104,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modalBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#222', marginBottom: 6 },
  modalHint: { fontSize: 12, color: '#666', marginBottom: 12, lineHeight: 18 },
  modalScroll: { flexGrow: 0 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  modalBtnSecondary: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  modalBtnSecondaryText: { fontWeight: '700', color: '#444' },
  modalBtnPrimary: { backgroundColor: '#667eea', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10 },
  modalBtnPrimaryText: { fontWeight: '700', color: '#fff' },
  modalBtnDisabled: { opacity: 0.55 },
  followCompBlock: { borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 12, marginTop: 8 },
  followCompTitle: { fontSize: 14, fontWeight: '800', color: '#333', marginBottom: 8 },
  followTeamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  followTeamName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#222', marginRight: 8 },
  followIcons: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  followIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  followIconBtnActive: { backgroundColor: '#f0f4ff' },
  mutedSmall: { fontSize: 12, color: '#999' },
});


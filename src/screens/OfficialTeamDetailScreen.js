import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, BackHandler, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { matchesService, publicAssetUrl } from '../services/api';
import { parseAppDate } from '../utils/dateTime';

function TeamLogo({ logoUrl, logoPath }) {
  const uri = logoUrl || publicAssetUrl(logoPath);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  if (!uri || failed) {
    return (
      <View style={styles.logoFallback}>
        <Ionicons name="shield-outline" size={56} color="#667eea" />
      </View>
    );
  }
  return <Image source={{ uri }} style={styles.logo} onError={() => setFailed(true)} resizeMode="contain" />;
}

function formatFavoriteCount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.trunc(n));
  if (n < 1000000) return `${(n / 1000).toFixed(1).replace('.', ',')} K`;
  return `${(n / 1000000).toFixed(1).replace('.', ',')} M`;
}

function TeamRowLogo({ logoUrl, logoPath }) {
  const uri = logoUrl || publicAssetUrl(logoPath);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  if (!uri || failed) {
    return (
      <View style={styles.matchTeamLogoFallback}>
        <Ionicons name="shield-outline" size={16} color="#667eea" />
      </View>
    );
  }
  return <Image source={{ uri }} style={styles.matchTeamLogo} onError={() => setFailed(true)} resizeMode="contain" />;
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

function getMatchStatusText(match) {
  const phase = String(match?.last_phase_type || '').trim();
  if (phase === 'match_end') return 'Partita\nterminata';
  if (phase) return 'Partita in corso';
  return formatKickoffTime(match?.kickoff_at);
}

function normalizeNameForCompare(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getOutcomeAccentColor(match, watchedTeamName) {
  const hs = Number(match?.home_score);
  const as = Number(match?.away_score);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return '#cbd5e1';
  const w = normalizeNameForCompare(watchedTeamName);
  const home = normalizeNameForCompare(match?.home_team_name);
  const away = normalizeNameForCompare(match?.away_team_name);
  if (!w || (w !== home && w !== away)) return '#cbd5e1';
  if (hs === as) return '#94a3b8';
  const watchedWon = (w === home && hs > as) || (w === away && as > hs);
  return watchedWon ? '#16a34a' : '#dc2626';
}

const ROLE_COLORS = { P: '#0d6efd', D: '#198754', C: '#e6a800', A: '#dc3545' };
const DEFAULT_JERSEY_COLOR = '#a5b4fc';
const ROLE_ORDER = { P: 0, D: 1, C: 2, A: 3 };
const ABSOLUTE_STATS_KEY = 'absolute';

export default function OfficialTeamDetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const teamId = Number(route?.params?.teamId);
  const competitionId = Number(route?.params?.competitionId);
  const [activeTab, setActiveTab] = useState('matches');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [teamMatches, setTeamMatches] = useState([]);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonYears, setSeasonYears] = useState([]);
  const [selectedSeasonYear, setSelectedSeasonYear] = useState(null);
  const [seasonStandings, setSeasonStandings] = useState([]);
  const [seasonPickerOpen, setSeasonPickerOpen] = useState(false);
  const [teamSeasonLoading, setTeamSeasonLoading] = useState(false);
  const [teamSeasonYears, setTeamSeasonYears] = useState([]);
  const [selectedTeamSeasonYear, setSelectedTeamSeasonYear] = useState(null);
  const [teamSeasonSquad, setTeamSeasonSquad] = useState([]);
  const [teamSeasonJerseyColor, setTeamSeasonJerseyColor] = useState(DEFAULT_JERSEY_COLOR);
  const [teamSeasonLeagueId, setTeamSeasonLeagueId] = useState(null);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsYears, setStatsYears] = useState([]);
  const [selectedStatsYear, setSelectedStatsYear] = useState(null);
  const [statsGeneral, setStatsGeneral] = useState({ played: 0, goals: 0, goals_conceded: 0, yellow_cards: 0, red_cards: 0 });
  const [statsOutcomes, setStatsOutcomes] = useState({ wins: 0, draws: 0, losses: 0, wins_pct: 0, draws_pct: 0, losses_pct: 0 });
  const [statsScorers, setStatsScorers] = useState([]);
  const [statsAssistmen, setStatsAssistmen] = useState([]);
  const [statsPickerOpen, setStatsPickerOpen] = useState(false);
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
      try {
        setSeasonLoading(true);
        const targetYear = yearOverride != null ? yearOverride : selectedSeasonYear;
        const res = await matchesService.getOfficialTeamSeasonStandings(teamId, competitionId, targetYear);
        const years = Array.isArray(res?.data?.available_years) ? res.data.available_years : [];
        const standingsRows = Array.isArray(res?.data?.standings) ? res.data.standings : [];
        const backendSelected = res?.data?.selected_year != null ? Number(res.data.selected_year) : null;
        setSeasonYears(years);
        setSeasonStandings(standingsRows);
        setSelectedSeasonYear((prev) => {
          if (backendSelected == null || !Number.isFinite(backendSelected)) return prev;
          return prev === backendSelected ? prev : backendSelected;
        });
      } finally {
        setSeasonLoading(false);
      }
    },
    [teamId, competitionId, selectedSeasonYear]
  );

  useEffect(() => {
    if (activeTab !== 'season') return;
    setSeasonPickerOpen(false);
    void loadSeasonStandings();
  }, [activeTab, loadSeasonStandings]);

  const loadTeamSeasonSquad = useCallback(
    async (yearOverride = null) => {
      if (!teamId || !competitionId) return;
      try {
        setTeamSeasonLoading(true);
        const targetYear = yearOverride != null ? yearOverride : selectedTeamSeasonYear;
        const res = await matchesService.getOfficialTeamSeasonSquad(teamId, competitionId, targetYear);
        const years = Array.isArray(res?.data?.available_years) ? res.data.available_years : [];
        const squad = Array.isArray(res?.data?.squad) ? res.data.squad : [];
        const backendSelected = res?.data?.selected_year != null ? Number(res.data.selected_year) : null;
        setTeamSeasonYears(years);
        setTeamSeasonSquad(squad);
        setTeamSeasonLeagueId(res?.data?.league_id != null ? Number(res.data.league_id) : null);
        setTeamSeasonJerseyColor(String(res?.data?.jersey_color || DEFAULT_JERSEY_COLOR));
        setSelectedTeamSeasonYear((prev) => {
          if (backendSelected == null || !Number.isFinite(backendSelected)) return prev;
          return prev === backendSelected ? prev : backendSelected;
        });
      } finally {
        setTeamSeasonLoading(false);
      }
    },
    [teamId, competitionId, selectedTeamSeasonYear]
  );

  useEffect(() => {
    if (activeTab !== 'team') return;
    setTeamPickerOpen(false);
    void loadTeamSeasonSquad();
  }, [activeTab, loadTeamSeasonSquad]);

  const loadTeamSeasonStats = useCallback(
    async (yearOverride = null) => {
      if (!teamId || !competitionId) return;
      try {
        setStatsLoading(true);
        const targetYear = yearOverride != null ? yearOverride : selectedStatsYear;
        const res = await matchesService.getOfficialTeamSeasonStats(teamId, competitionId, targetYear);
        const years = Array.isArray(res?.data?.available_years) ? res.data.available_years : [];
        const rawBackendSelected = res?.data?.selected_year;
        const backendSelected =
          String(rawBackendSelected || '').trim().toLowerCase() === ABSOLUTE_STATS_KEY
            ? ABSOLUTE_STATS_KEY
            : (rawBackendSelected != null ? Number(rawBackendSelected) : null);
        setStatsYears(years);
        setStatsGeneral(res?.data?.general || { played: 0, goals: 0, goals_conceded: 0, yellow_cards: 0, red_cards: 0 });
        setStatsOutcomes(res?.data?.outcomes || { wins: 0, draws: 0, losses: 0, wins_pct: 0, draws_pct: 0, losses_pct: 0 });
        setStatsScorers(Array.isArray(res?.data?.scorers) ? res.data.scorers : []);
        setStatsAssistmen(Array.isArray(res?.data?.assistmen) ? res.data.assistmen : []);
        setSelectedStatsYear((prev) => {
          if (backendSelected === ABSOLUTE_STATS_KEY) return ABSOLUTE_STATS_KEY;
          if (backendSelected == null || !Number.isFinite(backendSelected)) return prev;
          return prev === backendSelected ? prev : backendSelected;
        });
      } finally {
        setStatsLoading(false);
      }
    },
    [teamId, competitionId, selectedStatsYear]
  );

  useEffect(() => {
    if (activeTab !== 'stats') return;
    setStatsPickerOpen(false);
    void loadTeamSeasonStats();
  }, [activeTab, loadTeamSeasonStats]);

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
                    const hs = m.home_score != null ? Number(m.home_score) : null;
                    const as = m.away_score != null ? Number(m.away_score) : null;
                    const hasScore = Number.isFinite(hs) && Number.isFinite(as);
                    const statusText = getMatchStatusText(m);
                    const isTerminated = statusText.includes('\n');
                    const outcomeAccentColor = isTerminated ? getOutcomeAccentColor(m, teamName) : '#e2e8f0';
                    return (
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
                              {hasScore ? <Text style={styles.matchScore}>{hs}</Text> : null}
                            </View>
                            <View style={[styles.matchTeamRow, styles.matchTeamRowSecond]}>
                              <TeamRowLogo logoUrl={m.away_team_logo_url} logoPath={m.away_team_logo_path} />
                              <Text style={styles.matchTeamName} numberOfLines={1}>{m.away_team_name || '-'}</Text>
                              {hasScore ? <Text style={styles.matchScore}>{as}</Text> : null}
                            </View>
                          </View>
                          <View style={styles.matchMetaCol}>
                            <View style={[styles.matchMetaAccent, { backgroundColor: outcomeAccentColor }]} />
                            <Text style={styles.matchMetaText}>{getMatchStatusText(m)}</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            )}
          </View>
        ) : activeTab === 'season' ? (
          <View style={styles.card}>
            <View style={styles.seasonPickerWrap}>
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
              {seasonPickerOpen ? (
                <View style={styles.seasonPickerDropdown}>
                  <ScrollView style={styles.seasonPickerDropdownScroll} nestedScrollEnabled>
                    {seasonYears.map((y) => {
                      const active = Number(selectedSeasonYear) === Number(y);
                      return (
                        <TouchableOpacity
                          key={`season-year-${y}`}
                          style={[styles.seasonPickerItem, active && styles.seasonPickerItemActive]}
                          onPress={() => {
                            setSeasonPickerOpen(false);
                            void loadSeasonStandings(Number(y));
                          }}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.seasonPickerItemText, active && styles.seasonPickerItemTextActive]}>{y}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
            </View>
            {seasonLoading ? (
              <View style={styles.matchesLoadingBox}>
                <ActivityIndicator color="#667eea" />
              </View>
            ) : seasonStandings.length === 0 ? (
              <Text style={styles.placeholderText}>Nessuna classifica disponibile per la stagione selezionata.</Text>
            ) : (
              <View style={styles.seasonTableWrap}>
                <View style={styles.seasonTableHeader}>
                  <Text style={[styles.seasonTh, { width: 38, textAlign: 'center' }]}>Pos</Text>
                  <Text style={[styles.seasonTh, { flex: 1 }]}>Squadra</Text>
                  <Text style={[styles.seasonTh, { width: 40, textAlign: 'center' }]}>PG</Text>
                  <Text style={[styles.seasonTh, { width: 40, textAlign: 'center' }]}>DR</Text>
                  <Text style={[styles.seasonTh, { width: 40, textAlign: 'center' }]}>Pt</Text>
                </View>
                {seasonStandings.map((r, i) => {
                  const isWatched = normalizeNameForCompare(r?.team_name) === normalizeNameForCompare(teamName);
                  const rowTeamId = Number(r?.team_id);
                  return (
                    <View key={`season-st-${i}`} style={[styles.seasonTableRow, isWatched && styles.seasonTableRowWatched]}>
                      <Text style={[styles.seasonTd, { width: 38, textAlign: 'center' }]}>{r.position}</Text>
                      <TouchableOpacity
                        style={[styles.teamCell, { flex: 1 }]}
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
                        <Text style={[styles.seasonTd, styles.seasonTdTeamName]} numberOfLines={2}>
                          {r.team_name_display || r.team_name || '-'}
                        </Text>
                      </TouchableOpacity>
                      <Text style={[styles.seasonTd, { width: 40, textAlign: 'center' }]}>{r.played}</Text>
                      <Text style={[styles.seasonTd, { width: 40, textAlign: 'center' }]}>{r.goal_diff}</Text>
                      <Text style={[styles.seasonTd, { width: 40, textAlign: 'center' }]}>{r.points}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        ) : activeTab === 'stats' ? (
          <View style={[styles.card, styles.teamCard]}>
            <View style={styles.seasonPickerWrap}>
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
              {statsPickerOpen ? (
                <View style={styles.seasonPickerDropdown}>
                  <ScrollView style={styles.seasonPickerDropdownScroll} nestedScrollEnabled>
                    <TouchableOpacity
                      key="stats-season-absolute"
                      style={[
                        styles.seasonPickerItem,
                        selectedStatsYear === ABSOLUTE_STATS_KEY && styles.seasonPickerItemActive,
                      ]}
                      onPress={() => {
                        setStatsPickerOpen(false);
                        void loadTeamSeasonStats(ABSOLUTE_STATS_KEY);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.seasonPickerItemText,
                          selectedStatsYear === ABSOLUTE_STATS_KEY && styles.seasonPickerItemTextActive,
                        ]}
                      >
                        Assolute
                      </Text>
                    </TouchableOpacity>
                    {statsYears.map((y) => {
                      const active = selectedStatsYear !== ABSOLUTE_STATS_KEY && Number(selectedStatsYear) === Number(y);
                      return (
                        <TouchableOpacity
                          key={`stats-season-year-${y}`}
                          style={[styles.seasonPickerItem, active && styles.seasonPickerItemActive]}
                          onPress={() => {
                            setStatsPickerOpen(false);
                            void loadTeamSeasonStats(Number(y));
                          }}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.seasonPickerItemText, active && styles.seasonPickerItemTextActive]}>{y}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
            </View>

            {statsLoading ? (
              <View style={styles.matchesLoadingBox}>
                <ActivityIndicator color="#667eea" />
              </View>
            ) : (
              <ScrollView style={styles.teamSquadList} contentContainerStyle={styles.statsListContent} showsVerticalScrollIndicator={false}>
                <View style={styles.statsBlock}>
                  <Text style={styles.statsBlockTitle}>Generale</Text>
                  <View style={styles.statsValueRow}>
                    <Text style={styles.statsLabel}>Partite giocate</Text>
                    <Text style={styles.statsValue}>{Number(statsGeneral.played || 0)}</Text>
                  </View>
                  <View style={styles.statsValueRow}>
                    <Text style={styles.statsLabel}>Gol</Text>
                    <Text style={styles.statsValue}>{Number(statsGeneral.goals || 0)}</Text>
                  </View>
                  <View style={styles.statsValueRow}>
                    <Text style={styles.statsLabel}>Gol subiti</Text>
                    <Text style={styles.statsValue}>{Number(statsGeneral.goals_conceded || 0)}</Text>
                  </View>
                  <View style={styles.statsValueRow}>
                    <Text style={styles.statsLabel}>Cartellini Gialli/Rossi</Text>
                    <Text style={styles.statsValue}>
                      {Number(statsGeneral.yellow_cards || 0)} / {Number(statsGeneral.red_cards || 0)}
                    </Text>
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
                </View>

                <View style={styles.statsBlock}>
                  <Text style={styles.statsBlockTitle}>Marcatori</Text>
                  {(statsScorers || []).length === 0 ? (
                    <Text style={styles.placeholderText}>Nessun marcatore disponibile.</Text>
                  ) : (
                    <>
                      <View style={[styles.statsTableRow, styles.statsTableHeaderRow]}>
                        <Text style={[styles.statsTableCell, styles.statsTablePos, styles.statsTableHeaderCell]}>Pos.</Text>
                        <Text style={[styles.statsTableCell, styles.statsTablePlayer, styles.statsTableHeaderCell]}>Giocatore</Text>
                        <Text style={[styles.statsTableCell, styles.statsTableValue, styles.statsTableHeaderCell]}>Goal</Text>
                      </View>
                      {statsScorers.map((s, i) => (
                        <View key={`sc-${i}`} style={styles.statsTableRow}>
                          <Text style={[styles.statsTableCell, styles.statsTablePos]}>{i + 1}</Text>
                          <Text style={[styles.statsTableCell, styles.statsTablePlayer]} numberOfLines={1}>
                            {String(s?.name || '-')}
                          </Text>
                          <Text style={[styles.statsTableCell, styles.statsTableValue]}>{Number(s?.value || 0)}</Text>
                        </View>
                      ))}
                    </>
                  )}
                </View>

                <View style={styles.statsBlock}>
                  <Text style={styles.statsBlockTitle}>Assistman</Text>
                  {(statsAssistmen || []).length === 0 ? (
                    <Text style={styles.placeholderText}>Nessun assist disponibile.</Text>
                  ) : (
                    <>
                      <View style={[styles.statsTableRow, styles.statsTableHeaderRow]}>
                        <Text style={[styles.statsTableCell, styles.statsTablePos, styles.statsTableHeaderCell]}>Pos.</Text>
                        <Text style={[styles.statsTableCell, styles.statsTablePlayer, styles.statsTableHeaderCell]}>Giocatore</Text>
                        <Text style={[styles.statsTableCell, styles.statsTableValue, styles.statsTableHeaderCell]}>Goal</Text>
                      </View>
                      {statsAssistmen.map((s, i) => (
                        <View key={`as-${i}`} style={styles.statsTableRow}>
                          <Text style={[styles.statsTableCell, styles.statsTablePos]}>{i + 1}</Text>
                          <Text style={[styles.statsTableCell, styles.statsTablePlayer]} numberOfLines={1}>
                            {String(s?.name || '-')}
                          </Text>
                          <Text style={[styles.statsTableCell, styles.statsTableValue]}>{Number(s?.value || 0)}</Text>
                        </View>
                      ))}
                    </>
                  )}
                </View>
              </ScrollView>
            )}
          </View>
        ) : activeTab === 'team' ? (
          <View style={[styles.card, styles.teamCard]}>
            <View style={styles.seasonPickerWrap}>
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
              {teamPickerOpen ? (
                <View style={styles.seasonPickerDropdown}>
                  <ScrollView style={styles.seasonPickerDropdownScroll} nestedScrollEnabled>
                    {teamSeasonYears.map((y) => {
                      const active = Number(selectedTeamSeasonYear) === Number(y);
                      return (
                        <TouchableOpacity
                          key={`team-season-year-${y}`}
                          style={[styles.seasonPickerItem, active && styles.seasonPickerItemActive]}
                          onPress={() => {
                            setTeamPickerOpen(false);
                            void loadTeamSeasonSquad(Number(y));
                          }}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.seasonPickerItemText, active && styles.seasonPickerItemTextActive]}>{y}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
            </View>

            {teamSeasonLoading ? (
              <View style={styles.matchesLoadingBox}>
                <ActivityIndicator color="#667eea" />
              </View>
            ) : sortedTeamSeasonSquad.length === 0 ? (
              <Text style={styles.placeholderText}>Nessun giocatore disponibile per la stagione selezionata.</Text>
            ) : (
              <ScrollView style={styles.teamSquadList} contentContainerStyle={styles.teamSquadListContent} showsVerticalScrollIndicator={false}>
                {sortedTeamSeasonSquad.map((p, i) => {
                  const role = String(p?.role || '').trim().toUpperCase();
                  const roleColor = ROLE_COLORS[role] || '#6b7280';
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
                        });
                      }}
                    >
                      <View style={styles.squadJerseyBadge}>
                        <MaterialCommunityIcons name="tshirt-crew" size={38} color={teamSeasonJerseyColor || DEFAULT_JERSEY_COLOR} />
                        <Text style={styles.squadJerseyNumber}>{shirtNumber}</Text>
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
            <Text style={styles.placeholderTitle}>
              {activeTab === 'stats' ? 'Statistiche' : 'Squadra'}
            </Text>
            <Text style={styles.placeholderText}>Contenuto in preparazione.</Text>
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
    borderRadius: 16,
    backgroundColor: '#f8fafc',
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
  matchesLoadingBox: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  matchesList: { flex: 1 },
  matchesListContent: { paddingBottom: 12, width: '100%' },
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
  matchTeamLogo: { width: 24, height: 24, borderRadius: 6, backgroundColor: '#f7f7f7' },
  matchTeamLogoFallback: { width: 24, height: 24, borderRadius: 6, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  matchTeamName: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600', color: '#1f2937' },
  matchScore: { width: 24, textAlign: 'right', fontSize: 15, fontWeight: '800', color: '#0f172a' },
  matchMetaCol: { minWidth: 118, paddingLeft: 4, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  matchMetaAccent: { width: 4, height: 60, borderRadius: 3, marginRight: 6, alignSelf: 'center' },
  matchMetaText: { fontSize: 12, fontWeight: '700', color: '#475569', textAlign: 'center', lineHeight: 16, minWidth: 92 },
  seasonPickerWrap: {
    marginBottom: 10,
    position: 'relative',
    zIndex: 20,
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
  seasonPickerDropdown: {
    position: 'absolute',
    top: 44,
    left: 0,
    right: 0,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 10,
    backgroundColor: '#fff',
    maxHeight: 180,
    zIndex: 30,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  seasonPickerDropdownScroll: { maxHeight: 180 },
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
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  seasonTh: { fontSize: 12, fontWeight: '800', color: '#475569' },
  seasonTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  seasonTableRowWatched: {
    backgroundColor: '#e5e7eb',
  },
  teamCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  seasonTd: { fontSize: 13, fontWeight: '700', color: '#1f2937' },
  seasonTdTeamName: { flex: 1, minWidth: 0 },
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
  statsListContent: { paddingBottom: 8, paddingTop: 2 },
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
    marginBottom: 6,
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
  statsTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingVertical: 7,
  },
  statsTableHeaderRow: {
    borderBottomColor: '#e2e8f0',
    paddingBottom: 8,
    marginBottom: 2,
  },
  statsTableCell: {
    fontSize: 13,
    color: '#1f2937',
  },
  statsTableHeaderCell: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
  },
  statsTablePos: {
    width: 34,
  },
  statsTablePlayer: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
    fontWeight: '500',
  },
  statsTableValue: {
    width: 46,
    textAlign: 'right',
    fontWeight: '700',
  },
  placeholderTitle: { fontSize: 17, fontWeight: '800', color: '#222', marginBottom: 6 },
  placeholderText: { fontSize: 14, color: '#64748b' },
});

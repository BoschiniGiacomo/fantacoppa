import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Dimensions,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { leagueService, formationService } from '../services/api';
import { PlayerPhotoImage } from '../components/StableCachedImage';
import {
  peekLeagueDetail,
  peekStandingsFull,
  peekFormationMatchdays,
  setLeagueDetail,
  setStandingsFull,
  setFormationMatchdays,
} from '../services/leagueWarmCache';
import { useFocusEffect } from '@react-navigation/native';
import BonusIcon from '../components/BonusIcon';
import { formatVoteRating } from '../utils/voteRating';
import { getFormationSlotVisual } from '../utils/formationDisplay';
import { buildCompetitionRankMap, toFiniteNumber } from '../utils/standingsRanking';
import { buildFieldSurnameCountMap, getFieldPlayerLabel } from '../utils/fieldPlayerLabel';

const ROLE_COLORS = { P: '#0d6efd', D: '#198754', C: '#e6a817', A: '#dc3545' };

const ALL_MODULES = {
  '1-1-1': [1,1,1], '1-1-2': [1,1,2], '1-2-1': [1,2,1], '2-1-1': [2,1,1],
  '1-2-2': [1,2,2], '2-2-1': [2,2,1], '2-1-2': [2,1,2], '3-1-1': [3,1,1],
  '2-2-2': [2,2,2], '3-2-1': [3,2,1], '2-3-1': [2,3,1], '1-3-2': [1,3,2], '3-1-2': [3,1,2],
  '3-2-2': [3,2,2], '2-3-2': [2,3,2], '2-2-3': [2,2,3], '4-2-1': [4,2,1], '3-3-1': [3,3,1],
  '3-3-2': [3,3,2], '3-2-3': [3,2,3], '2-3-3': [2,3,3], '4-2-2': [4,2,2],
  '3-3-3': [3,3,3], '4-2-3': [4,2,3], '3-4-2': [3,4,2], '5-2-2': [5,2,2],
  '4-3-2': [4,3,2], '3-5-1': [3,5,1], '4-4-1': [4,4,1],
  '4-4-2': [4,4,2], '4-3-3': [4,3,3], '3-5-2': [3,5,2], '4-5-1': [4,5,1], '5-3-2': [5,3,2],
  '5-4-1': [5,4,1], '5-2-3': [5,2,3], '3-4-3': [3,4,3],
};
const MINI_FIELD_H = 410;

const midTruncate = (str, max = 8) => {
  if (!str || str.length <= max) return str || '';
  const tail = 3;
  const head = max - tail - 2;
  return str.slice(0, head) + '..' + str.slice(-tail);
};

function matchesStandingsSearch(item, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item?.team_name,
    item?.username,
    item?.coach_name,
  ]
    .map((s) => String(s || '').toLowerCase())
    .join(' ');
  return haystack.includes(q);
}

function pickDefaultMatchday(matchdays, matchdayStatuses = []) {
  const mdList = Array.isArray(matchdays) ? matchdays : [];
  if (mdList.length <= 0) return null;

  const statusList = Array.isArray(matchdayStatuses) ? matchdayStatuses : [];
  if (statusList.length <= 0) {
    return Number(mdList[mdList.length - 1]?.giornata || null);
  }

  const sortedStatuses = [...statusList].sort(
    (a, b) => Number(a?.giornata || 0) - Number(b?.giornata || 0)
  );
  const withCalculated = sortedStatuses.filter((s) => Number(s?.is_calculated || 0) === 1);
  if (withCalculated.length > 0) {
    return Number(withCalculated[withCalculated.length - 1]?.giornata || null);
  }

  const withVotes = sortedStatuses.filter((s) => Number(s?.has_votes || 0) === 1);
  if (withVotes.length > 0) {
    return Number(withVotes[withVotes.length - 1]?.giornata || null);
  }

  return Number(mdList[mdList.length - 1]?.giornata || null);
}

/** Messaggio sotto la classifica “per giornata” quando non ci sono titolari da mostrare (evita “nessuna formazione inviata” fuorviante). */
function getStandingsEmptyFormationCopy(formationData, league, selectedMatchday) {
  if (Number(league?.auto_lineup_mode) === 1) {
    return 'Formazione automatica con i migliori per ruolo.';
  }
  const data = formationData && typeof formationData === 'object' ? formationData : {};
  const squad = Number(data.squad_players_count);
  const needRaw = data.required_titolari ?? league?.numero_titolari;
  const need = Math.max(1, Number(needRaw) || 10);
  const firstSaved = data.first_saved_lineup_giornata;
  const isCalculated = data.is_matchday_calculated === true;
  const sel = Number(selectedMatchday);

  if (Number.isFinite(squad) && squad >= 0 && squad < need) {
    return `Rosa insufficiente: servono almeno ${need} giocatori in rosa per poter schierare la formazione. Al momento ne hai ${squad}.`;
  }
  if (
    isCalculated &&
    firstSaved != null &&
    Number.isFinite(Number(firstSaved)) &&
    Number.isFinite(sel) &&
    sel < Number(firstSaved)
  ) {
    return `Per questa giornata non risulta una formazione schierata: la prima volta che compaiono titolari salvati è dalla ${firstSaved}ª giornata.`;
  }
  return 'Nessuna formazione inviata per questa giornata.';
}

export default function StandingsScreen({ route, navigation }) {
  const { user } = useAuth();
  const { leagueId } = route.params || {};
  const insets = useSafeAreaInsets();
  const [league, setLeague] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('generale');
  const [standings, setStandings] = useState([]);
  const [matchdays, setMatchdays] = useState([]);
  const [selectedMatchday, setSelectedMatchday] = useState(null);
  const [matchdayResults, setMatchdayResults] = useState([]);
  const [loadingMatchdayResults, setLoadingMatchdayResults] = useState(false);
  const [expandedFormations, setExpandedFormations] = useState({});
  const [formations, setFormations] = useState({});
  const [loadingFormations, setLoadingFormations] = useState({});
  const [formationViewMode, setFormationViewMode] = useState({});
  const [toastMsg, setToastMsg] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const scrollRef = useRef(null);
  const scrollToMePendingRef = useRef(true);
  const myUserId = Number(user?.id) || 0;

  const filteredStandings = useMemo(
    () => standings.filter((item) => matchesStandingsSearch(item, searchQuery)),
    [standings, searchQuery]
  );
  const filteredMatchdayResults = useMemo(
    () => matchdayResults.filter((item) => matchesStandingsSearch(item, searchQuery)),
    [matchdayResults, searchQuery]
  );
  const generalRankById = useMemo(
    () =>
      buildCompetitionRankMap(standings, {
        getId: (item) => item?.id,
        getScore: (item) => toFiniteNumber(item?.punteggio),
      }),
    [standings]
  );
  const matchdayRankById = useMemo(
    () =>
      buildCompetitionRankMap(matchdayResults, {
        getId: (item) => item?.id,
        getScore: (item) => toFiniteNumber(item?.punteggio),
      }),
    [matchdayResults]
  );

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useFocusEffect(
    useCallback(() => {
      scrollToMePendingRef.current = true;
      setSearchQuery('');
      setActiveTab('generale');
      loadData();
    }, [leagueId])
  );

  useEffect(() => {
    if (activeTab === 'giornata' && selectedMatchday) {
      scrollToMePendingRef.current = true;
      setSearchQuery('');
      loadMatchdayResults();
      setExpandedFormations({});
      setFormations({});
      setLoadingFormations({});
      setFormationViewMode({});
    }
  }, [activeTab, selectedMatchday]);

  const handleMyCardLayout = useCallback((userId, event) => {
    if (!scrollToMePendingRef.current || !myUserId || searchQuery.trim()) return;
    if (Number(userId) !== myUserId) return;
    scrollToMePendingRef.current = false;
    const y = event?.nativeEvent?.layout?.y ?? 0;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 20), animated: false });
    });
  }, [myUserId, searchQuery]);

  const handleTabChange = (tab) => {
    if (tab === activeTab) return;
    scrollToMePendingRef.current = true;
    setSearchQuery('');
    setActiveTab(tab);
  };

  const loadData = async () => {
    const warmL = peekLeagueDetail(leagueId);
    const warmStand = peekStandingsFull(leagueId);
    const warmMd = peekFormationMatchdays(leagueId);
    const hasWarm = warmStand != null && warmMd != null;

    if (hasWarm) {
      if (warmL != null) setLeague(warmL);
      const standingsData = warmStand;
      if (Array.isArray(standingsData)) setStandings(standingsData);
      else if (standingsData && typeof standingsData === 'object') setStandings(Object.values(standingsData));
      else setStandings([]);
      setMatchdays(Array.isArray(warmMd) ? warmMd : []);
      const mdArr = Array.isArray(warmMd) ? warmMd : [];
      if (mdArr.length > 0 && !selectedMatchday) {
        setSelectedMatchday(mdArr[mdArr.length - 1].giornata);
      }
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const [leagueRes, standingsRes, matchdaysRes, statusRes] = await Promise.all([
        leagueService.getById(leagueId),
        leagueService.getStandingsFull(leagueId),
        formationService.getMatchdays(leagueId),
        leagueService.getMatchdayStatus(leagueId).catch(() => ({ data: [] })),
      ]);
      const leagueData = Array.isArray(leagueRes.data) ? leagueRes.data[0] : leagueRes.data;
      setLeague(leagueData);
      if (leagueData && typeof leagueData === 'object') setLeagueDetail(leagueId, leagueData);

      const standingsData = standingsRes.data;
      if (Array.isArray(standingsData)) setStandings(standingsData);
      else if (standingsData && typeof standingsData === 'object') setStandings(Object.values(standingsData));
      else setStandings([]);
      setStandingsFull(leagueId, standingsRes.data);

      const matchdaysData = matchdaysRes.data;
      const mdList = Array.isArray(matchdaysData) ? matchdaysData : [];
      setMatchdays(mdList);
      setFormationMatchdays(leagueId, mdList);
      const defaultMatchday = pickDefaultMatchday(mdList, statusRes?.data || []);
      if (defaultMatchday) setSelectedMatchday(defaultMatchday);
    } catch (error) {
      console.error('Error loading standings:', error);
      if (!hasWarm) showToast('Impossibile caricare la classifica');
      else showToast('Impossibile aggiornare la classifica');
    } finally {
      setLoading(false);
    }
  };

  const loadMatchdayResults = async () => {
    setLoadingMatchdayResults(true);
    try {
      const resultsRes = await leagueService.getMatchdayResults(leagueId, selectedMatchday);
      const resultsData = resultsRes.data;
      let rows = [];
      if (Array.isArray(resultsData)) rows = resultsData;
      else if (resultsData && typeof resultsData === 'object') rows = Object.values(resultsData);
      setMatchdayResults(rows);

    } catch (error) {
      console.error('Error loading matchday results:', error);
      setMatchdayResults([]);
    } finally {
      setLoadingMatchdayResults(false);
    }
  };

  const toggleFormation = async (userId) => {
    const isExpanded = expandedFormations[userId];
    if (isExpanded) {
      setExpandedFormations(prev => ({ ...prev, [userId]: false }));
    } else {
      setExpandedFormations(prev => ({ ...prev, [userId]: true }));
      if (!selectedMatchday || loadingFormations[userId]) return;

      if (formations[userId]) return;

      setLoadingFormations(prev => ({ ...prev, [userId]: true }));
      try {
        const formationRes = await leagueService.getMatchdayFormation(leagueId, selectedMatchday, userId);
        const data = formationRes.data;
        setFormations(prev => ({ ...prev, [userId]: data }));
      } catch (error) {
        console.error('Error loading formation:', error);
        showToast('Impossibile caricare la formazione');
      } finally {
        setLoadingFormations(prev => ({ ...prev, [userId]: false }));
      }
    }
  };

  const getPositionStyle = (pos) => {
    if (pos === 1) return { bg: '#FFD700', text: '#7a6200' };
    if (pos === 2) return { bg: '#e0e0e0', text: '#555' };
    if (pos === 3) return { bg: '#e8c8a0', text: '#6d4c23' };
    return { bg: '#f0f0f0', text: '#666' };
  };

  const formatRating = (rating) => formatVoteRating(rating);

  const renderStandingsItem = (item, position) => {
    const isMe = item?.id === user?.id;
    const posStyle = getPositionStyle(position);
    const punteggio = typeof item?.punteggio === 'number' ? item.punteggio : (parseFloat(item?.punteggio) || 0);
    const mediaPunti = typeof item?.media_punti === 'number' ? item.media_punti : (parseFloat(item?.media_punti) || undefined);
    const isExpanded = expandedFormations[item?.id] || false;
    const formationData = formations[item?.id];
    const isLoadingFormation = loadingFormations[item?.id];

    return (
      <View
        key={item?.id || position}
        style={[styles.card, isMe && styles.myCard]}
        onLayout={isMe ? (e) => handleMyCardLayout(item?.id, e) : undefined}
      >
        <TouchableOpacity
          onPress={() => { if (activeTab === 'giornata') toggleFormation(item?.id); }}
          activeOpacity={activeTab === 'giornata' ? 0.7 : 1}
          disabled={activeTab !== 'giornata'}
        >
          <View style={styles.cardRow}>
            {/* Posizione */}
            <View style={[styles.posBadge, { backgroundColor: posStyle.bg }]}>
              <Text style={[styles.posText, { color: posStyle.text }]}>{position}</Text>
            </View>

            {/* Info squadra */}
            <View style={styles.cardInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.cardTeamName} numberOfLines={1}>{item?.team_name || item?.username || 'N/A'}</Text>
                {isMe && (
                  <View style={styles.meBadge}><Text style={styles.meBadgeText}>Tu</Text></View>
                )}
              </View>
              {!!item?.coach_name && (
                <Text style={styles.cardCoach} numberOfLines={1}>{item.coach_name}</Text>
              )}
            </View>

            {/* Punteggi */}
            <View style={styles.cardScores}>
              <Text style={styles.scoreMain}>{punteggio.toFixed(2)}</Text>
              <Text style={styles.scoreLabel}>{activeTab === 'giornata' ? 'Punti' : 'Tot.'}</Text>
            </View>
            {activeTab === 'generale' && mediaPunti !== undefined && !isNaN(mediaPunti) && (
              <View style={styles.cardScores}>
                <Text style={[styles.scoreMain, { color: '#6c757d', fontSize: 15 }]}>{mediaPunti.toFixed(2)}</Text>
                <Text style={styles.scoreLabel}>Media</Text>
              </View>
            )}

            {/* Expand icon */}
            {activeTab === 'giornata' && (
              <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color="#bbb" style={{ marginLeft: 4 }} />
            )}
          </View>
        </TouchableOpacity>

        {/* Formazione espansa */}
        {activeTab === 'giornata' && isExpanded && (
          <View style={styles.formationBox}>
            {isLoadingFormation ? (
              <View style={styles.formationLoading}>
                <ActivityIndicator size="small" color="#667eea" />
                <Text style={styles.formationLoadingText}>Caricamento...</Text>
              </View>
            ) : formationData && formationData.formation && formationData.formation.length > 0 ? (
              <View>
                {/* Tab icons campo / lista (solo se non auto-lineup) */}
                {formationData.modulo && ALL_MODULES[formationData.modulo] && (
                  <View style={styles.fViewTabs}>
                    <TouchableOpacity
                      style={[styles.fViewTab, (formationViewMode[item?.id] || 'field') === 'field' && styles.fViewTabActive]}
                      onPress={() => setFormationViewMode(prev => ({ ...prev, [item?.id]: 'field' }))}
                    >
                      <MaterialCommunityIcons name="soccer-field" size={20} color={(formationViewMode[item?.id] || 'field') === 'field' ? '#667eea' : '#bbb'} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.fViewTab, formationViewMode[item?.id] === 'list' && styles.fViewTabActive]}
                      onPress={() => setFormationViewMode(prev => ({ ...prev, [item?.id]: 'list' }))}
                    >
                      <Ionicons name="list" size={18} color={formationViewMode[item?.id] === 'list' ? '#667eea' : '#bbb'} />
                    </TouchableOpacity>
                  </View>
                )}

                {/* FIELD VIEW */}
                {(formationViewMode[item?.id] || 'field') === 'field' && formationData.modulo && ALL_MODULES[formationData.modulo] ? (() => {
                  const parts = ALL_MODULES[formationData.modulo];
                  const [d, c, a] = parts;
                  const players = formationData.formation;
                  const surnameCountMap = buildFieldSurnameCountMap(
                    [{ slots: players }],
                    (row) => row.slots
                  );
                  const rows = [
                    { role: 'A', slots: players.slice(1 + d + c, 1 + d + c + a) },
                    { role: 'C', slots: players.slice(1 + d, 1 + d + c) },
                    { role: 'D', slots: players.slice(1, 1 + d) },
                    { role: 'P', slots: [players[0]] },
                  ];
                  const slotSize = 68;
                  return (
                    <View style={styles.miniField}>
                      <View style={styles.miniFieldCenter} />
                      <View style={styles.miniFieldCircle} />
                      <View style={styles.miniFieldAreaTop} />
                      <View style={styles.miniFieldAreaBottom} />
                      {rows.map((row, ri) => {
                        const cnt = row.slots.length;
                        const topPct = ri === 0 ? 4
                          : ri === 1 ? (cnt <= 4 ? 32 : 28)
                          : ri === 2 ? 56 : 80;
                        const slotMarginH = cnt >= 7 ? -10 : cnt >= 6 ? -8 : cnt >= 5 ? -3 : 0;
                        return (
                          <View key={ri} style={[styles.miniFieldRow, { top: `${topPct}%` }, cnt >= 5 && { justifyContent: 'center', marginHorizontal: 4 }, cnt === 4 && { justifyContent: 'center', gap: 2 }]}>
                            {row.slots.map((p, si) => {
                              if (!p) return <View key={si} style={{ width: slotSize, height: slotSize }} />;
                              const vis = getFormationSlotVisual(p);
                              const fieldLabel = getFieldPlayerLabel(vis, surnameCountMap, midTruncate);
                              const roleColor = ROLE_COLORS[vis.role] || '#999';
                              const hasPhoto = !!vis.photo_path;

                              let yOffset = 0;
                              if (cnt >= 5) {
                                const center = (cnt - 1) / 2;
                                const dist = Math.abs(si - center) / center;
                                const up = cnt >= 7 ? -125 : cnt >= 6 ? -115 : -105;
                                const down = cnt >= 7 ? 18 : cnt >= 6 ? 16 : 14;
                                yOffset = Math.round(up * dist + down * (1 - dist));
                              }

                              const bonusItems = [];
                              if (formationData.bonus_enabled) {
                                const bs = formationData.bonus_settings || {};
                                if (p.goals > 0 && bs.enable_goal) bonusItems.push({ type: 'goal', count: p.goals });
                                if (p.assists > 0 && bs.enable_assist) bonusItems.push({ type: 'assist', count: p.assists });
                                if (p.yellow_cards > 0 && bs.enable_yellow_card) bonusItems.push({ type: 'yellow_card', count: p.yellow_cards });
                                if (p.red_cards > 0 && bs.enable_red_card) bonusItems.push({ type: 'red_card', count: p.red_cards });
                                if (p.goals_conceded > 0 && bs.enable_goals_conceded) bonusItems.push({ type: 'goals_conceded', count: p.goals_conceded });
                                if (p.own_goals > 0 && bs.enable_own_goal) bonusItems.push({ type: 'own_goal', count: p.own_goals });
                                if (p.penalty_missed > 0 && bs.enable_penalty_missed) bonusItems.push({ type: 'penalty_missed', count: p.penalty_missed });
                                if (p.penalty_saved > 0 && bs.enable_penalty_saved) bonusItems.push({ type: 'penalty_saved', count: p.penalty_saved });
                                if (p.clean_sheet > 0 && bs.enable_clean_sheet) bonusItems.push({ type: 'clean_sheet', count: p.clean_sheet });
                                if (p.pallone_fuori > 0 && bs.enable_pallone_fuori) bonusItems.push({ type: 'pallone_fuori', count: p.pallone_fuori });
                                if (p.briso > 0 && bs.enable_briso) bonusItems.push({ type: 'briso', count: p.briso });
                                if (p.no_divisa > 0 && bs.enable_no_divisa) bonusItems.push({ type: 'no_divisa', count: p.no_divisa });
                              }

                              return (
                                <View key={p.id || si} style={[styles.miniSlotWrap, ...(slotMarginH !== 0 ? [{ marginHorizontal: slotMarginH }] : []), ...(yOffset !== 0 ? [{ marginTop: yOffset }] : [])]}>
                                  <View style={[styles.miniSlotOuter, { width: slotSize, height: slotSize }]}>
                                    <View
                                      style={[
                                        styles.miniSlot,
                                        {
                                          width: slotSize, height: slotSize, borderRadius: slotSize / 2,
                                          borderColor: roleColor,
                                          backgroundColor: hasPhoto ? 'transparent' : roleColor,
                                        },
                                        hasPhoto && { borderWidth: 0 },
                                      ]}
                                    >
                                      {hasPhoto ? (
                                        <View
                                          style={[
                                            styles.miniSlotPhotoClip,
                                            { width: slotSize, height: slotSize, borderRadius: slotSize / 2 },
                                          ]}
                                        >
                                          <PlayerPhotoImage
                                            photoPath={vis.photo_path}
                                            style={{ width: slotSize * 0.90, height: slotSize * 0.90, position: 'absolute', top: -slotSize * 0.11 }}
                                          />
                                        </View>
                                      ) : (
                                        <>
                                          <Text style={styles.miniSlotName} numberOfLines={1}>{fieldLabel}</Text>
                                          <Text style={styles.miniSlotTeam} numberOfLines={1}>{midTruncate(vis.team_name, 9)}</Text>
                                        </>
                                      )}
                                      {hasPhoto && (
                                        <View style={[styles.miniSlotNameBadge, { backgroundColor: roleColor }]}>
                                          <Text style={styles.miniSlotNameBadgeText} numberOfLines={1}>{fieldLabel}</Text>
                                        </View>
                                      )}
                                    </View>
                                    {bonusItems.length > 0 && (
                                      <View style={[styles.fieldBonusCol, cnt === 1 && styles.fieldBonusColGk]}>
                                        {bonusItems.map((b, idx) => (
                                          <View key={idx} style={styles.fieldBonusChip}>
                                            <BonusIcon type={b.type} size={17} />
                                            {b.count > 1 && <Text style={styles.fieldBonusCount}>x{b.count}</Text>}
                                          </View>
                                        ))}
                                      </View>
                                    )}
                                  </View>
                                  <View style={styles.fieldVotesBox}>
                                    <Text style={styles.fieldVoteBase}>{formatRating(p.rating)}</Text>
                                    <View style={styles.fieldVoteSep} />
                                    <Text style={styles.fieldVoteFinal}>{formatRating(p.final_rating)}</Text>
                                  </View>
                                </View>
                              );
                            })}
                          </View>
                        );
                      })}
                    </View>
                  );
                })() : (
                  /* LIST VIEW */
                  <View>
                    {formationData.formation.map((player, index) => {
                      if (!player) return (
                        <View key={`empty-${index}`} style={styles.playerRow}>
                          <Text style={{ color: '#bbb', fontStyle: 'italic' }}>-</Text>
                        </View>
                      );

                      const vis = getFormationSlotVisual(player);
                      const bonusItems = [];
                      if (formationData.bonus_enabled) {
                        const bs = formationData.bonus_settings || {};
                        if (player.goals > 0 && bs.enable_goal) bonusItems.push({ type: 'goal', count: player.goals });
                        if (player.assists > 0 && bs.enable_assist) bonusItems.push({ type: 'assist', count: player.assists });
                        if (player.yellow_cards > 0 && bs.enable_yellow_card) bonusItems.push({ type: 'yellow_card', count: player.yellow_cards });
                        if (player.red_cards > 0 && bs.enable_red_card) bonusItems.push({ type: 'red_card', count: player.red_cards });
                        if (player.goals_conceded > 0 && bs.enable_goals_conceded) bonusItems.push({ type: 'goals_conceded', count: player.goals_conceded });
                        if (player.own_goals > 0 && bs.enable_own_goal) bonusItems.push({ type: 'own_goal', count: player.own_goals });
                        if (player.penalty_missed > 0 && bs.enable_penalty_missed) bonusItems.push({ type: 'penalty_missed', count: player.penalty_missed });
                        if (player.penalty_saved > 0 && bs.enable_penalty_saved) bonusItems.push({ type: 'penalty_saved', count: player.penalty_saved });
                        if (player.clean_sheet > 0 && bs.enable_clean_sheet) bonusItems.push({ type: 'clean_sheet', count: player.clean_sheet });
                        if (player.pallone_fuori > 0 && bs.enable_pallone_fuori) bonusItems.push({ type: 'pallone_fuori', count: player.pallone_fuori });
                        if (player.briso > 0 && bs.enable_briso) bonusItems.push({ type: 'briso', count: player.briso });
                        if (player.no_divisa > 0 && bs.enable_no_divisa) bonusItems.push({ type: 'no_divisa', count: player.no_divisa });
                      }

                      return (
                        <View key={player.id || index} style={styles.playerRow}>
                          <View style={[styles.roleDot, { backgroundColor: ROLE_COLORS[vis.role] || '#999' }]}>
                            <Text style={styles.roleDotText}>{vis.role || '-'}</Text>
                          </View>
                          <Text style={styles.playerName} numberOfLines={1}>
                            {vis.first_name} {vis.last_name}
                          </Text>
                          {bonusItems.length > 0 && (
                            <View style={styles.bonusRow}>
                              {bonusItems.map((b, idx) => (
                                <View key={idx} style={styles.bonusChip}>
                                  <BonusIcon type={b.type} size={12} />
                                  {b.count > 1 && <Text style={styles.bonusCount}>×{b.count}</Text>}
                                </View>
                              ))}
                            </View>
                          )}
                          <View style={styles.votesBox}>
                            <Text style={styles.voteBase}>{formatRating(player.rating)}</Text>
                            <Text style={styles.voteSep}>|</Text>
                            <Text style={styles.voteFinal}>{formatRating(player.final_rating)}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
                {formationData.formation_recovered && (
                  <Text style={styles.recoveredFormationNote}>
                    Formazione recuperata dal sistema
                  </Text>
                )}
              </View>
            ) : (
              <Text style={styles.noFormation}>
                {getStandingsEmptyFormationCopy(formationData, league, selectedMatchday)}
              </Text>
            )}
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.headerTitle}>Classifica</Text>
        {league && <Text style={styles.headerSub}>{league.name}</Text>}
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'generale' && styles.tabActive]}
          onPress={() => handleTabChange('generale')}
        >
          <Ionicons name="trophy" size={16} color={activeTab === 'generale' ? '#667eea' : '#999'} />
          <Text style={[styles.tabLabel, activeTab === 'generale' && styles.tabLabelActive]}>Generale</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'giornata' && styles.tabActive]}
          onPress={() => handleTabChange('giornata')}
        >
          <Ionicons name="calendar" size={16} color={activeTab === 'giornata' ? '#667eea' : '#999'} />
          <Text style={[styles.tabLabel, activeTab === 'giornata' && styles.tabLabelActive]}>Per Giornata</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cerca squadra, allenatore o utente..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClearBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={20} color="#999" />
          </TouchableOpacity>
        )}
      </View>

      {activeTab === 'giornata' && matchdays.length > 0 && (
        <View style={styles.mdSelectorWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.mdSelector}
            contentContainerStyle={styles.mdSelectorContent}
          >
            {matchdays.map((md) => (
              <TouchableOpacity
                key={md.giornata}
                style={[styles.mdChip, selectedMatchday === md.giornata && styles.mdChipActive]}
                onPress={() => {
                  if (selectedMatchday !== md.giornata) {
                    scrollToMePendingRef.current = true;
                    setSearchQuery('');
                    setSelectedMatchday(md.giornata);
                  }
                }}
              >
                <Text style={[styles.mdChipText, selectedMatchday === md.giornata && styles.mdChipTextActive]}>
                  {md.giornata}ª G
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 80 }]}
      >
        {activeTab === 'generale' ? (
          standings.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="trophy-outline" size={52} color="#d0d0d0" />
              <Text style={styles.emptyTitle}>Nessuna classifica</Text>
              <Text style={styles.emptySubtext}>Non ci sono ancora dati disponibili</Text>
            </View>
          ) : filteredStandings.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="search-outline" size={52} color="#d0d0d0" />
              <Text style={styles.emptyTitle}>Nessuna squadra trovata</Text>
              <Text style={styles.emptySubtext}>Prova con nome squadra, allenatore o utente</Text>
            </View>
          ) : (
            filteredStandings.map((item) => {
              const position = generalRankById.get(String(item.id)) || 0;
              return renderStandingsItem(item, position);
            })
          )
        ) : selectedMatchday ? (
          <View>
            <Text style={styles.mdTitle}>{selectedMatchday}ª Giornata</Text>
            {loadingMatchdayResults ? (
              <View style={styles.matchdayLoadingBox}>
                <ActivityIndicator size="small" color="#667eea" />
                <Text style={styles.matchdayLoadingText}>Caricamento risultati...</Text>
              </View>
            ) : !matchdayResults || !Array.isArray(matchdayResults) || matchdayResults.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="calendar-outline" size={52} color="#d0d0d0" />
                <Text style={styles.emptyTitle}>Nessun risultato</Text>
                <Text style={styles.emptySubtext}>Non ci sono ancora voti per questa giornata</Text>
              </View>
            ) : filteredMatchdayResults.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="search-outline" size={52} color="#d0d0d0" />
                <Text style={styles.emptyTitle}>Nessuna squadra trovata</Text>
                <Text style={styles.emptySubtext}>Prova con nome squadra, allenatore o utente</Text>
              </View>
            ) : (
              filteredMatchdayResults.map((item) => {
                const position = matchdayRankById.get(String(item.id)) || 0;
                return renderStandingsItem(item, position);
              })
            )}
          </View>
        ) : null}
      </ScrollView>

      {toastMsg && (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  /* Header */
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#333', lineHeight: 28 },
  headerSub: { fontSize: 14, color: '#666', marginTop: 4 },

  /* Tabs */
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: '#667eea' },
  tabLabel: { fontSize: 13, fontWeight: '500', color: '#999' },
  tabLabelActive: { color: '#667eea', fontWeight: '700' },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
    color: '#333',
  },
  searchClearBtn: { marginLeft: 4 },

  /* Scroll */
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 12, paddingHorizontal: 16 },

  /* Matchday selector */
  mdSelectorWrapper: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    paddingVertical: 8,
  },
  mdSelector: { flexGrow: 0 },
  mdSelectorContent: { gap: 6, paddingHorizontal: 16, paddingRight: 16 },
  mdChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  mdChipActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  mdChipText: { fontSize: 13, fontWeight: '600', color: '#667eea' },
  mdChipTextActive: { color: '#fff' },
  mdTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2c3e50',
    marginBottom: 10,
  },

  /* Card classifica */
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  myCard: { borderWidth: 1.5, borderColor: '#667eea' },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  posBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  posText: { fontSize: 14, fontWeight: '700' },
  cardInfo: { flex: 1, marginRight: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTeamName: { fontSize: 14, fontWeight: '700', color: '#2c3e50', flexShrink: 1 },
  meBadge: { backgroundColor: '#667eea', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  meBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  cardCoach: { fontSize: 12, color: '#999', marginTop: 1 },
  cardScores: { alignItems: 'center', minWidth: 44, marginLeft: 4 },
  scoreMain: { fontSize: 17, fontWeight: '700', color: '#667eea' },
  scoreLabel: { fontSize: 10, color: '#aaa', marginTop: 1 },

  /* Formazione espansa */
  formationBox: {
    backgroundColor: '#fafafa',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    marginHorizontal: -6,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  formationLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  formationLoadingText: { fontSize: 13, color: '#999' },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  roleDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  roleDotText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  playerName: { flex: 1, fontSize: 13, fontWeight: '500', color: '#2c3e50' },
  bonusRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginRight: 6 },
  bonusChip: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  bonusCount: { fontSize: 10, color: '#666', fontWeight: '600' },
  votesBox: { flexDirection: 'row', alignItems: 'center', minWidth: 56, justifyContent: 'flex-end' },
  voteBase: { fontSize: 13, fontWeight: '600', color: '#333' },
  voteSep: { fontSize: 12, color: '#ccc', marginHorizontal: 2 },
  voteFinal: { fontSize: 13, fontWeight: '700', color: '#2e7d32' },

  matchdayLoadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 8,
  },
  matchdayLoadingText: {
    fontSize: 13,
    color: '#777',
    fontWeight: '500',
  },
  noFormation: { fontSize: 13, color: '#999', fontStyle: 'italic', textAlign: 'center', paddingVertical: 14 },
  recoveredFormationNote: {
    marginTop: 8,
    fontSize: 12,
    color: '#666',
    textAlign: 'right',
    fontStyle: 'italic',
  },

  /* Formation view tabs */
  fViewTabs: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  fViewTab: { flex: 1, paddingVertical: 6, borderRadius: 8, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  fViewTabActive: { backgroundColor: '#e8ecff' },

  /* Mini field */
  miniField: { height: MINI_FIELD_H, backgroundColor: '#2e8b57', borderRadius: 8, position: 'relative', overflow: 'hidden', marginHorizontal: -10 },
  miniFieldCenter: { position: 'absolute', top: '49%', left: 0, right: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  miniFieldCircle: { position: 'absolute', top: '50%', left: '50%', width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', marginLeft: -30, marginTop: -30 },
  miniFieldAreaTop: { position: 'absolute', top: 0, left: '25%', right: '25%', height: 30, borderWidth: 2, borderTopWidth: 0, borderColor: 'rgba(255,255,255,0.18)', borderBottomLeftRadius: 6, borderBottomRightRadius: 6 },
  miniFieldAreaBottom: { position: 'absolute', bottom: 0, left: '25%', right: '25%', height: 30, borderWidth: 2, borderBottomWidth: 0, borderColor: 'rgba(255,255,255,0.18)', borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  miniFieldRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center' },
  miniSlot: { borderWidth: 2, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 2, elevation: 3 },
  miniSlotName: { color: '#fff', fontWeight: '700', fontSize: 10, textAlign: 'center' },
  miniSlotTeam: { color: 'rgba(255,255,255,0.75)', fontSize: 7, textAlign: 'center', marginTop: 1 },
  miniSlotOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 2, alignItems: 'center', borderBottomLeftRadius: 999, borderBottomRightRadius: 999 },
  miniSlotOverlayText: { color: '#fff', fontSize: 9, fontWeight: '700', textAlign: 'center' },
  miniSlotWrap: { alignItems: 'center', overflow: 'visible' },
  miniSlotOuter: { position: 'relative', overflow: 'visible' },
  miniSlotPhotoClip: { overflow: 'hidden', justifyContent: 'flex-end' },
  miniSlotNameBadge: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: +1,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 7,
    alignItems: 'center',
  },
  miniSlotNameBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
  },
  fieldBonusCol: {
    position: 'absolute',
    top: -4,
    left: '100%',
    marginLeft: -10,
    flexDirection: 'column',
    gap: 1,
    alignItems: 'flex-start',
    zIndex: 4,
  },
  fieldBonusColGk: { marginLeft: 6 },
  fieldBonusChip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 6, paddingHorizontal: 2, paddingVertical: 1 },
  fieldBonusCount: { color: '#333', fontSize: 9, fontWeight: '700', marginLeft: 1 },
  fieldVotesBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 6, marginTop: -2, paddingHorizontal: 4, paddingVertical: 1 },
  fieldVoteBase: { fontSize: 9, fontWeight: '600', color: '#333' },
  fieldVoteSep: { width: 1, height: 10, backgroundColor: '#ccc', marginHorizontal: 3 },
  fieldVoteFinal: { fontSize: 9, fontWeight: '700', color: '#2e7d32' },

  /* Empty */
  emptyBox: { alignItems: 'center', paddingVertical: 50 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#999', marginTop: 12 },
  emptySubtext: { fontSize: 13, color: '#bbb', marginTop: 4, textAlign: 'center', paddingHorizontal: 40 },

  /* Toast */
  toast: {
    position: 'absolute', top: 100, left: 20, right: 20,
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 10, zIndex: 999,
  },
  toastError: { backgroundColor: '#e53935' },
  toastSuccess: { backgroundColor: '#2e7d32' },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
});

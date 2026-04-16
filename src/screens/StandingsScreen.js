import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { leagueService, formationService } from '../services/api';
import { useFocusEffect } from '@react-navigation/native';
import BonusIcon from '../components/BonusIcon';

const ROLE_COLORS = { P: '#0d6efd', D: '#198754', C: '#e6a817', A: '#dc3545' };

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
  const [expandedFormations, setExpandedFormations] = useState({});
  const [formations, setFormations] = useState({});
  const [loadingFormations, setLoadingFormations] = useState({});
  const [toastMsg, setToastMsg] = useState(null);

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useFocusEffect(
    useCallback(() => {
      setActiveTab('generale');
      loadData();
    }, [leagueId])
  );

  useEffect(() => {
    if (activeTab === 'giornata' && selectedMatchday) {
      loadMatchdayResults();
      setExpandedFormations({});
      setFormations({});
      setLoadingFormations({});
    }
  }, [activeTab, selectedMatchday]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [leagueRes, standingsRes, matchdaysRes] = await Promise.all([
        leagueService.getById(leagueId),
        leagueService.getStandingsFull(leagueId),
        formationService.getMatchdays(leagueId),
      ]);
      const leagueData = Array.isArray(leagueRes.data) ? leagueRes.data[0] : leagueRes.data;
      setLeague(leagueData);

      const standingsData = standingsRes.data;
      if (Array.isArray(standingsData)) setStandings(standingsData);
      else if (standingsData && typeof standingsData === 'object') setStandings(Object.values(standingsData));
      else setStandings([]);

      const matchdaysData = matchdaysRes.data;
      setMatchdays(Array.isArray(matchdaysData) ? matchdaysData : []);

      if (matchdaysRes.data && matchdaysRes.data.length > 0) {
        setSelectedMatchday(matchdaysRes.data[matchdaysRes.data.length - 1].giornata);
      }
    } catch (error) {
      console.error('Error loading standings:', error);
      showToast('Impossibile caricare la classifica');
    } finally {
      setLoading(false);
    }
  };

  const loadMatchdayResults = async () => {
    try {
      const resultsRes = await leagueService.getMatchdayResults(leagueId, selectedMatchday);
      const resultsData = resultsRes.data;
      if (Array.isArray(resultsData)) setMatchdayResults(resultsData);
      else if (resultsData && typeof resultsData === 'object') setMatchdayResults(Object.values(resultsData));
      else setMatchdayResults([]);
    } catch (error) {
      console.error('Error loading matchday results:', error);
      setMatchdayResults([]);
    }
  };

  const toggleFormation = async (userId) => {
    const isExpanded = expandedFormations[userId];
    if (isExpanded) {
      setExpandedFormations(prev => ({ ...prev, [userId]: false }));
    } else {
      setExpandedFormations(prev => ({ ...prev, [userId]: true }));
      if (!formations[userId] && !loadingFormations[userId] && selectedMatchday) {
        setLoadingFormations(prev => ({ ...prev, [userId]: true }));
        try {
          const formationRes = await leagueService.getMatchdayFormation(leagueId, selectedMatchday, userId);
          setFormations(prev => ({ ...prev, [userId]: formationRes.data }));
        } catch (error) {
          console.error('Error loading formation:', error);
          showToast('Impossibile caricare la formazione');
        } finally {
          setLoadingFormations(prev => ({ ...prev, [userId]: false }));
        }
      }
    }
  };

  const getPositionStyle = (pos) => {
    if (pos === 1) return { bg: '#FFD700', text: '#7a6200' };
    if (pos === 2) return { bg: '#e0e0e0', text: '#555' };
    if (pos === 3) return { bg: '#e8c8a0', text: '#6d4c23' };
    return { bg: '#f0f0f0', text: '#666' };
  };

  const formatRating = (rating) => {
    if (rating === null || rating === undefined) return '-';
    if (rating === Math.floor(rating) + 0.25 || rating === Math.floor(rating) + 0.75) return rating.toFixed(2);
    return rating.toFixed(1);
  };

  const renderStandingsItem = (item, position) => {
    const isMe = item?.id === user?.id;
    const posStyle = getPositionStyle(position);
    const punteggio = typeof item?.punteggio === 'number' ? item.punteggio : (parseFloat(item?.punteggio) || 0);
    const mediaPunti = typeof item?.media_punti === 'number' ? item.media_punti : (parseFloat(item?.media_punti) || undefined);
    const isExpanded = expandedFormations[item?.id] || false;
    const formationData = formations[item?.id];
    const isLoadingFormation = loadingFormations[item?.id];

    return (
      <View key={item?.id || position} style={[styles.card, isMe && styles.myCard]}>
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
              <Text style={styles.cardUsername}>{item?.username || 'N/A'}</Text>
            </View>

            {/* Punteggi */}
            <View style={styles.cardScores}>
              <Text style={styles.scoreMain}>{punteggio.toFixed(1)}</Text>
              <Text style={styles.scoreLabel}>{activeTab === 'giornata' ? 'Punti' : 'Tot.'}</Text>
            </View>
            {activeTab === 'generale' && mediaPunti !== undefined && !isNaN(mediaPunti) && (
              <View style={styles.cardScores}>
                <Text style={[styles.scoreMain, { color: '#6c757d', fontSize: 15 }]}>{mediaPunti.toFixed(1)}</Text>
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
                {formationData.formation.map((player, index) => {
                  if (!player) return (
                    <View key={`empty-${index}`} style={styles.playerRow}>
                      <Text style={{ color: '#bbb', fontStyle: 'italic' }}>-</Text>
                    </View>
                  );

                  // Raccogli bonus/malus
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
                  }

                  return (
                    <View key={player.id || index} style={styles.playerRow}>
                      <View style={[styles.roleDot, { backgroundColor: ROLE_COLORS[player.role] || '#999' }]}>
                        <Text style={styles.roleDotText}>{player.role || '-'}</Text>
                      </View>
                      <Text style={styles.playerName} numberOfLines={1}>
                        {player.first_name} {player.last_name}
                      </Text>
                      {/* Bonus icons inline */}
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
                      {/* Voti */}
                      <View style={styles.votesBox}>
                        <Text style={styles.voteBase}>{formatRating(player.rating)}</Text>
                        <Text style={styles.voteSep}>|</Text>
                        <Text style={styles.voteFinal}>{formatRating(player.final_rating)}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.noFormation}>
                {league?.auto_lineup_mode
                  ? 'Formazione automatica con i migliori per ruolo.'
                  : 'Nessuna formazione inviata'}
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
          onPress={() => setActiveTab('generale')}
        >
          <Ionicons name="trophy" size={16} color={activeTab === 'generale' ? '#667eea' : '#999'} />
          <Text style={[styles.tabLabel, activeTab === 'generale' && styles.tabLabelActive]}>Generale</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'giornata' && styles.tabActive]}
          onPress={() => setActiveTab('giornata')}
        >
          <Ionicons name="calendar" size={16} color={activeTab === 'giornata' ? '#667eea' : '#999'} />
          <Text style={[styles.tabLabel, activeTab === 'giornata' && styles.tabLabelActive]}>Per Giornata</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
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
          ) : (
            standings.map((item, index) => renderStandingsItem(item, index + 1))
          )
        ) : (
          <View>
            {/* Selettore giornata */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mdSelector} contentContainerStyle={styles.mdSelectorContent}>
              {matchdays.map((md) => (
                <TouchableOpacity
                  key={md.giornata}
                  style={[styles.mdChip, selectedMatchday === md.giornata && styles.mdChipActive]}
                  onPress={() => setSelectedMatchday(md.giornata)}
                >
                  <Text style={[styles.mdChipText, selectedMatchday === md.giornata && styles.mdChipTextActive]}>
                    {md.giornata}ª G
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Risultati */}
            {selectedMatchday && (
              <View>
                <Text style={styles.mdTitle}>{selectedMatchday}ª Giornata</Text>
                {!matchdayResults || !Array.isArray(matchdayResults) || matchdayResults.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Ionicons name="calendar-outline" size={52} color="#d0d0d0" />
                    <Text style={styles.emptyTitle}>Nessun risultato</Text>
                    <Text style={styles.emptySubtext}>Non ci sono ancora voti per questa giornata</Text>
                  </View>
                ) : (
                  matchdayResults.map((item, index) => renderStandingsItem(item, index + 1))
                )}
              </View>
            )}
          </View>
        )}
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

  /* Scroll */
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 12, paddingHorizontal: 16 },

  /* Matchday selector */
  mdSelector: { marginBottom: 10 },
  mdSelectorContent: { gap: 6, paddingRight: 16 },
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
  cardUsername: { fontSize: 12, color: '#999', marginTop: 1 },
  cardScores: { alignItems: 'center', minWidth: 44, marginLeft: 4 },
  scoreMain: { fontSize: 17, fontWeight: '700', color: '#667eea' },
  scoreLabel: { fontSize: 10, color: '#aaa', marginTop: 1 },

  /* Formazione espansa */
  formationBox: {
    backgroundColor: '#fafafa',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
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
  noFormation: { fontSize: 13, color: '#999', fontStyle: 'italic', textAlign: 'center', paddingVertical: 14 },

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

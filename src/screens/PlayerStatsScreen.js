import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { playerStatsService } from '../services/api';
import BonusIcon from '../components/BonusIcon';

const ROLE_COLORS = {
  P: '#0d6efd',
  D: '#198754',
  C: '#e6a817',
  A: '#dc3545',
};

const ROLE_NAMES = {
  P: 'Portiere',
  D: 'Difensore',
  C: 'Centrocampista',
  A: 'Attaccante',
};

export default function PlayerStatsScreen({ route, navigation }) {
  const { playerId, leagueId, playerName, playerRole, playerRating } = route.params || {};
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState('league');
  const [leagueStats, setLeagueStats] = useState(null);
  const [aggregatedStats, setAggregatedStats] = useState(null);
  const [loadingLeague, setLoadingLeague] = useState(true);
  const [loadingAggregated, setLoadingAggregated] = useState(false);
  const [hasOfficialGroup, setHasOfficialGroup] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useEffect(() => {
    loadLeagueStats();
    checkOfficialGroup();
  }, [playerId, leagueId]);

  const checkOfficialGroup = async () => {
    try {
      setLoadingAggregated(true);
      const response = await playerStatsService.getPlayerAggregatedStats(playerId, leagueId);
      setAggregatedStats(response.data.stats);
      setHasOfficialGroup(true);
    } catch (error) {
      setHasOfficialGroup(false);
    } finally {
      setLoadingAggregated(false);
    }
  };

  const loadLeagueStats = async () => {
    try {
      setLoadingLeague(true);
      const response = await playerStatsService.getPlayerStats(playerId, leagueId);
      setLeagueStats(response.data);
    } catch (error) {
      showToast('Impossibile caricare le statistiche del giocatore');
      console.error(error);
    } finally {
      setLoadingLeague(false);
    }
  };

  const loadAggregatedStats = async () => {
    if (aggregatedStats) return;
    try {
      setLoadingAggregated(true);
      const response = await playerStatsService.getPlayerAggregatedStats(playerId, leagueId);
      setAggregatedStats(response.data.stats);
      setHasOfficialGroup(true);
    } catch (error) {
      showToast('Impossibile caricare le statistiche aggregate');
      console.error(error);
    } finally {
      setLoadingAggregated(false);
    }
  };

  const renderStats = (stats, isLoading) => {
    if (isLoading) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      );
    }

    // Valori sicuri con default a 0
    const s = stats || {};
    const v = (val) => (typeof val === 'number' ? val : (parseFloat(val) || 0));

    return (
      <View>
        {/* Medie */}
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Rendimento</Text>
          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <Text style={styles.tileValue}>{v(s.avg_rating).toFixed(2)}</Text>
              <Text style={styles.tileLabel}>Media Voto</Text>
            </View>
            <View style={styles.tileSep} />
            <View style={styles.tile}>
              <Text style={[styles.tileValue, { color: '#667eea' }]}>{v(s.avg_rating_with_bonus).toFixed(2)}</Text>
              <Text style={styles.tileLabel}>Media con Bonus</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <Text style={styles.tileValue}>{v(s.games_played)}</Text>
              <Text style={styles.tileLabel}>Presenze</Text>
            </View>
            <View style={styles.tileSep} />
            <View style={styles.tile}>
              <Text style={styles.tileValue}>{v(s.games_with_rating)}</Text>
              <Text style={styles.tileLabel}>Con Voto</Text>
            </View>
          </View>
        </View>

        {/* Sezione portiere (solo per ruolo P) */}
        {playerRole === 'P' && (
          <View style={styles.card}>
            <Text style={styles.cardSectionTitle}>Statistiche Portiere</Text>
            <View style={styles.bmGrid}>
              {[
                { key: 'clean_sheet', value: v(s.total_clean_sheets), label: 'Clean sheet' },
                { key: 'penalty_saved', value: v(s.total_penalty_saved), label: 'Rig. parati' },
                { key: 'goals_conceded', value: v(s.total_goals_conceded), label: 'Goal subiti' },
              ].map(item => (
                <View key={item.key} style={styles.bmItem}>
                  <View style={styles.bmIconCircle}>
                    <BonusIcon type={item.key} size={20} />
                  </View>
                  <Text style={styles.bmValue}>{item.value}</Text>
                  <Text style={styles.bmLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Bonus */}
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Bonus</Text>
          <View style={styles.bmGrid}>
            {[
              { key: 'goal', value: v(s.total_goals), label: 'Goal' },
              { key: 'assist', value: v(s.total_assists), label: 'Assist' },
              // Per non-portieri mostra rig. parati e clean sheet solo se > 0
              ...(playerRole !== 'P' && v(s.total_penalty_saved) > 0
                ? [{ key: 'penalty_saved', value: v(s.total_penalty_saved), label: 'Rig. parati' }] : []),
              ...(playerRole !== 'P' && v(s.total_clean_sheets) > 0
                ? [{ key: 'clean_sheet', value: v(s.total_clean_sheets), label: 'Clean sheet' }] : []),
            ].map(item => (
              <View key={item.key} style={styles.bmItem}>
                <View style={styles.bmIconCircle}>
                  <BonusIcon type={item.key} size={20} />
                </View>
                <Text style={styles.bmValue}>{item.value}</Text>
                <Text style={styles.bmLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Malus */}
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Malus</Text>
          <View style={styles.bmGrid}>
            {[
              { key: 'yellow_card', value: v(s.total_yellow_cards), label: 'Gialli' },
              { key: 'red_card', value: v(s.total_red_cards), label: 'Rossi' },
              { key: 'own_goal', value: v(s.total_own_goals), label: 'Autogoal' },
              { key: 'penalty_missed', value: v(s.total_penalty_missed), label: 'Rig. sbagliati' },
              // Per non-portieri mostra goal subiti solo se > 0
              ...(playerRole !== 'P' && v(s.total_goals_conceded) > 0
                ? [{ key: 'goals_conceded', value: v(s.total_goals_conceded), label: 'Goal subiti' }] : []),
            ].map(item => (
              <View key={item.key} style={styles.bmItem}>
                <View style={styles.bmIconCircle}>
                  <BonusIcon type={item.key} size={20} />
                </View>
                <Text style={styles.bmValue}>{item.value}</Text>
                <Text style={styles.bmLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color="#333" />
        </TouchableOpacity>

        <View style={[styles.roleBadge, { backgroundColor: ROLE_COLORS[playerRole] || '#999' }]}>  
          <Text style={styles.roleBadgeText}>{playerRole}</Text>
        </View>

        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>{playerName || 'Giocatore'}</Text>
          <Text style={styles.headerMeta}>
            {ROLE_NAMES[playerRole] || playerRole}  ·  {playerRating?.toFixed(1) || '0.0'} {playerRating === 1 ? 'credito' : 'crediti'}
          </Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'league' && styles.tabActive]}
          onPress={() => setActiveTab('league')}
        >
          <Ionicons name="trophy" size={16} color={activeTab === 'league' ? '#667eea' : '#999'} />
          <Text style={[styles.tabLabel, activeTab === 'league' && styles.tabLabelActive]}>Lega</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'total' && styles.tabActive,
            !hasOfficialGroup && styles.tabDisabled,
          ]}
          onPress={() => {
            if (hasOfficialGroup) {
              setActiveTab('total');
              loadAggregatedStats();
            }
          }}
          disabled={!hasOfficialGroup}
        >
          <Ionicons name="stats-chart" size={16} color={activeTab === 'total' && hasOfficialGroup ? '#667eea' : '#999'} />
          <Text style={[styles.tabLabel, activeTab === 'total' && hasOfficialGroup && styles.tabLabelActive]}>
            Totali
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + insets.bottom }]}
      >
        {activeTab === 'league' && renderStats(leagueStats?.stats, loadingLeague)}

        {activeTab === 'total' && (
          <>
            {!hasOfficialGroup && (
              <View style={styles.infoBanner}>
                <Ionicons name="information-circle" size={18} color="#667eea" />
                <Text style={styles.infoBannerText}>
                  Statistiche totali disponibili solo per leghe ufficiali con gruppo.
                </Text>
              </View>
            )}
            {hasOfficialGroup && renderStats(aggregatedStats, loadingAggregated)}
          </>
        )}
      </ScrollView>

      {toastMsg && (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    gap: 10,
  },
  backBtn: {
    padding: 4,
  },
  roleBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleBadgeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  headerInfo: {
    flex: 1,
  },
  headerName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2c3e50',
    marginBottom: 2,
  },
  headerMeta: {
    fontSize: 13,
    color: '#888',
  },

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
  tabActive: {
    borderBottomColor: '#667eea',
  },
  tabDisabled: {
    opacity: 0.4,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#999',
  },
  tabLabelActive: {
    color: '#667eea',
    fontWeight: '700',
  },

  /* Scroll */
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },

  /* Card */
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 14,
  },
  tileRow: {
    flexDirection: 'row',
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  tileSep: {
    width: 1,
    backgroundColor: '#eee',
  },
  tileValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2c3e50',
    marginBottom: 2,
  },
  tileLabel: {
    fontSize: 11,
    color: '#999',
  },
  divider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginVertical: 12,
  },

  /* Bonus / Malus grid */
  bmGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: 14,
  },
  bmItem: {
    alignItems: 'center',
    gap: 4,
    width: '25%',
  },
  bmIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  bmValue: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2c3e50',
  },
  bmLabel: {
    fontSize: 10,
    color: '#999',
    textAlign: 'center',
  },

  /* Info banner */
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef0fb',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
    gap: 10,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#4a5568',
    lineHeight: 18,
  },

  /* Empty / Loading */
  loadingBox: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 50,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#999',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#bbb',
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 40,
  },

  /* Toast */
  toast: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 999,
  },
  toastError: { backgroundColor: '#e53935' },
  toastSuccess: { backgroundColor: '#2e7d32' },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
});

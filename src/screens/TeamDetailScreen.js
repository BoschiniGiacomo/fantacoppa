import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Image,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useOnboarding } from '../context/OnboardingContext';
import { teamsService, formationService } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { publicAssetUrl } from '../services/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { defaultLogosMap } from '../constants/defaultLogos';
import { syncSubmittedFormationOnboarding } from '../utils/formationSubmission';

const ROLE_COLORS = {
  P: '#0d6efd',
  D: '#198754',
  C: '#e6a817',
  A: '#dc3545',
};

const ROLE_ORDER = ['P', 'D', 'C', 'A'];

export default function TeamDetailScreen({ route, navigation }) {
  const { user } = useAuth();
  const { markDone } = useOnboarding();
  const { leagueId, userId } = route.params || {};
  const insets = useSafeAreaInsets();
  const [team, setTeam] = useState(null);
  const [squad, setSquad] = useState([]);
  const [results, setResults] = useState([]);
  const [activeTab, setActiveTab] = useState('squad');
  const [loading, setLoading] = useState(true);
  const [toastMsg, setToastMsg] = useState(null);

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useFocusEffect(
    useCallback(() => {
      loadTeamDetail();
    }, [leagueId, userId])
  );

  const loadTeamDetail = async () => {
    try {
      try {
        await syncSubmittedFormationOnboarding({ leagueId, formationService, markDone });
      } catch (_) {}
      const response = await teamsService.getTeamDetail(leagueId, userId);
      const payload = response?.data || {};

      // Compat: alcuni backend rispondono con { team, squad, results },
      // altri con oggetto team "piatto" + players.
      const teamData = payload?.team || payload;
      const squadData = Array.isArray(payload?.squad)
        ? payload.squad
        : (Array.isArray(payload?.players) ? payload.players : []);
      const resultsData = Array.isArray(payload?.results) ? payload.results : [];

      const normalizedTeam = teamData && typeof teamData === 'object'
        ? {
            ...teamData,
            budget: Number.isFinite(Number(teamData?.budget)) ? Number(teamData.budget) : 0,
          }
        : null;

      setTeam(normalizedTeam);
      setSquad(squadData);
      setResults(resultsData);
    } catch (error) {
      showToast('Impossibile caricare i dettagli della squadra');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Raggruppa giocatori per ruolo
  const groupedSquad = ROLE_ORDER.map(role => ({
    role,
    players: squad.filter(p => p.role === role),
  })).filter(g => g.players.length > 0);

  const getRoleName = (role) => {
    switch (role) {
      case 'P': return 'Portieri';
      case 'D': return 'Difensori';
      case 'C': return 'Centrocampisti';
      case 'A': return 'Attaccanti';
      default: return role;
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  if (!team) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="alert-circle-outline" size={48} color="#ccc" />
        <Text style={styles.errorText}>Squadra non trovata</Text>
      </View>
    );
  }

  const teamLogo = (team.team_logo && team.team_logo.trim() !== '') ? team.team_logo : 'default_1';
  const isDefaultLogo = teamLogo.startsWith('default_');

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.headerTitle}>Dettagli Squadra</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 80 + insets.bottom }]}
      >
        {/* === Card info squadra === */}
        <View style={styles.teamCard}>
          <View style={styles.teamCardRow}>
            {/* Logo */}
            {isDefaultLogo ? (
              <View style={[styles.logo, { backgroundColor: (defaultLogosMap[teamLogo]?.color || '#667eea') + '20' }]}>
                <Text style={styles.logoEmoji}>{defaultLogosMap[teamLogo]?.emoji || '⚽'}</Text>
              </View>
            ) : (
              <Image
                source={{ uri: publicAssetUrl(teamLogo) }}
                style={styles.logo}
                onError={() => {}}
              />
            )}

            {/* Info */}
            <View style={styles.teamCardInfo}>
              <Text style={styles.teamName} numberOfLines={1}>{team.team_name || 'Senza nome'}</Text>
              <Text style={styles.coachName} numberOfLines={1}>{team.coach_name || 'N/A'}</Text>
              <Text style={styles.username} numberOfLines={1}>{team.username}</Text>
            </View>

            {/* Budget */}
            <View style={styles.budgetBox}>
              <Text style={styles.budgetValue}>{team.budget?.toFixed(0) || '0'}</Text>
              <Text style={styles.budgetLabel}>{team.budget === 1 ? 'credito' : 'crediti'}</Text>
            </View>
          </View>
        </View>

        {/* === Tabs === */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'squad' && styles.tabActive]}
            onPress={() => setActiveTab('squad')}
          >
            <Ionicons name="people" size={18} color={activeTab === 'squad' ? '#667eea' : '#999'} />
            <Text style={[styles.tabLabel, activeTab === 'squad' && styles.tabLabelActive]}>
              Rosa
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'results' && styles.tabActive]}
            onPress={() => setActiveTab('results')}
          >
            <Ionicons name="stats-chart" size={18} color={activeTab === 'results' ? '#667eea' : '#999'} />
            <Text style={[styles.tabLabel, activeTab === 'results' && styles.tabLabelActive]}>
              Risultati
            </Text>
          </TouchableOpacity>
        </View>

        {/* === Tab: Rosa === */}
        {activeTab === 'squad' && (
          <View>
            {groupedSquad.length > 0 ? (
              groupedSquad.map(group => (
                <View key={group.role} style={styles.roleSection}>
                  {/* Header ruolo */}
                  <View style={styles.roleSectionHeader}>
                    <View style={[styles.roleDot, { backgroundColor: ROLE_COLORS[group.role] || '#999' }]} />
                    <Text style={styles.roleSectionTitle}>{getRoleName(group.role)}</Text>
                    <Text style={styles.roleSectionCount}>{group.players.length}</Text>
                  </View>

                  {/* Giocatori */}
                  {group.players.map(player => (
                    <TouchableOpacity
                      key={player.id}
                      style={styles.playerRow}
                      onPress={() => navigation.navigate('PlayerStats', {
                        playerId: player.id,
                        leagueId,
                        playerName: `${player.first_name} ${player.last_name}`,
                        playerRole: player.role,
                        playerRating: player.rating,
                      })}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.roleBadge, { backgroundColor: ROLE_COLORS[player.role] || '#999' }]}>
                        <Text style={styles.roleBadgeText}>{player.role}</Text>
                      </View>
                      <View style={styles.playerInfo}>
                        <Text style={styles.playerName} numberOfLines={1}>
                          {player.first_name} {player.last_name}
                        </Text>
                        {player.team_name ? (
                          <Text style={styles.playerTeam} numberOfLines={1}>{player.team_name}</Text>
                        ) : null}
                      </View>
                      <Text style={styles.playerRating}>{player.rating?.toFixed(1) || '-'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))
            ) : (
              <View style={styles.emptyContainer}>
                <Ionicons name="people-outline" size={52} color="#d0d0d0" />
                <Text style={styles.emptyTitle}>Rosa vuota</Text>
                <Text style={styles.emptySubtext}>Questa squadra non ha ancora acquistato giocatori</Text>
              </View>
            )}
          </View>
        )}

        {/* === Tab: Risultati === */}
        {activeTab === 'results' && (
          <View>
            {results.length > 0 ? (
              results.map(item => {
                const pts = typeof item.punteggio_giornata === 'number'
                  ? item.punteggio_giornata
                  : (parseFloat(item.punteggio_giornata) || 0);

                return (
                  <View key={item.giornata} style={styles.resultRow}>
                    <View style={[styles.resultBorder, { backgroundColor: '#667eea' }]} />
                    <View style={styles.resultBody}>
                      <View style={styles.resultTop}>
                        <Text style={styles.resultTitle}>{item.giornata}ª Giornata</Text>
                        <Text style={styles.resultPts}>{pts.toFixed(1)}</Text>
                      </View>
                      {item.deadline && (
                        <View style={styles.resultMeta}>
                          <Ionicons name="time-outline" size={13} color="#999" />
                          <Text style={styles.resultDate}>
                            {new Date(item.deadline).toLocaleDateString('it-IT', {
                              day: '2-digit', month: 'short', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyContainer}>
                <Ionicons name="stats-chart-outline" size={52} color="#d0d0d0" />
                <Text style={styles.emptyTitle}>Nessun risultato</Text>
                <Text style={styles.emptySubtext}>Non ci sono ancora giornate giocate</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    fontSize: 15,
    color: '#999',
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    lineHeight: 28,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 12,
    paddingHorizontal: 16,
  },

  /* ===== Team card ===== */
  teamCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  teamCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logo: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    marginRight: 14,
  },
  logoEmoji: {
    fontSize: 26,
  },
  teamCardInfo: {
    flex: 1,
    marginRight: 10,
  },
  teamName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2c3e50',
    marginBottom: 2,
  },
  coachName: {
    fontSize: 13,
    color: '#6c757d',
    marginBottom: 1,
  },
  username: {
    fontSize: 12,
    color: '#aaa',
  },
  budgetBox: {
    alignItems: 'center',
    paddingLeft: 10,
  },
  budgetValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2e7d32',
  },
  budgetLabel: {
    fontSize: 10,
    color: '#388e3c',
    marginTop: 1,
  },

  /* ===== Tabs ===== */
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eee',
    overflow: 'hidden',
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
  tabLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#999',
  },
  tabLabelActive: {
    color: '#667eea',
    fontWeight: '700',
  },

  /* ===== Rosa ===== */
  roleSection: {
    marginBottom: 14,
  },
  roleSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  roleDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  roleSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  roleSectionCount: {
    fontSize: 12,
    color: '#aaa',
    fontWeight: '600',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  roleBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  playerInfo: {
    flex: 1,
    marginRight: 8,
  },
  playerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2c3e50',
  },
  playerTeam: {
    fontSize: 12,
    color: '#999',
    marginTop: 1,
  },
  playerRating: {
    fontSize: 14,
    fontWeight: '700',
    color: '#667eea',
    marginRight: 6,
  },

  /* ===== Risultati ===== */
  resultRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  resultBorder: {
    width: 4,
  },
  resultBody: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  resultTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2c3e50',
  },
  resultPts: {
    fontSize: 17,
    fontWeight: '700',
    color: '#667eea',
  },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  resultDate: {
    fontSize: 12,
    color: '#999',
  },

  /* ===== Empty ===== */
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
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

  /* ===== Toast ===== */
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

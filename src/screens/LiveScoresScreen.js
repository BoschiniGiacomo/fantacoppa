import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { publicAssetUrl } from '../services/api';
import { leagueService } from '../services/api';
import { defaultLogosMap } from '../constants/defaultLogos';
import { parseAppDate } from '../utils/dateTime';

const getRoleColor = (role) => {
  const colors = { P: '#0d6efd', D: '#198754', C: '#e6a800', A: '#dc3545' };
  return colors[role] || '#6c757d';
};

export default function LiveScoresScreen({ route, navigation }) {
  const { leagueId, leagueName, giornata: initialGiornata } = route.params || {};
  const insets = useSafeAreaInsets();
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedTeams, setExpandedTeams] = useState({});
  const [currentGiornata, setCurrentGiornata] = useState(initialGiornata);
  const [availableMatchdays, setAvailableMatchdays] = useState([]);
  const parseDeadlineDate = (value) => parseAppDate(value);

  const loadLiveData = async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      const res = await leagueService.getLiveScores(leagueId, currentGiornata);
      setLiveData(res.data);
    } catch (error) {
      console.error('Error loading live scores:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Carica le giornate live disponibili (non calcolate, con voti, deadline passata)
  const loadAvailableMatchdays = async () => {
    try {
      const statusRes = await leagueService.getMatchdayStatus(leagueId);
      const statuses = statusRes?.data || [];
      const now = new Date();
      const liveDays = statuses
        .filter((m) => {
          const d = parseDeadlineDate(m?.deadline);
          return m.has_votes && !m.is_calculated && d && d < now;
        })
        .sort((a, b) => a.giornata - b.giornata); // ordine crescente G1, G2, G3...
      setAvailableMatchdays(liveDays);
    } catch (e) {
      console.log('Could not load available matchdays:', e);
    }
  };

  // Polling every 15 seconds
  useFocusEffect(
    useCallback(() => {
      loadAvailableMatchdays();
      loadLiveData();
      const interval = setInterval(() => loadLiveData(true), 15000);
      return () => clearInterval(interval);
    }, [leagueId, currentGiornata])
  );

  const toggleTeam = (userId) => {
    setExpandedTeams(prev => ({ ...prev, [userId]: !prev[userId] }));
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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveLabel}>LIVE</Text>
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>{leagueName}</Text>
          <Text style={styles.headerSubtitle}>{currentGiornata}ª Giornata</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      {/* Selettore giornate live */}
      {availableMatchdays.length > 1 && (
        <View style={styles.matchdaySelectorWrapper}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.matchdaySelector}
        >
          {availableMatchdays.map((m) => {
            const isActive = m.giornata === currentGiornata;
            return (
              <TouchableOpacity
                key={m.giornata}
                onPress={() => {
                  if (!isActive) {
                    setCurrentGiornata(m.giornata);
                    setExpandedTeams({});
                  }
                }}
                activeOpacity={0.7}
                style={[
                  styles.matchdayChip,
                  isActive && styles.matchdayChipActive,
                ]}
              >
                <Text style={[
                  styles.matchdayChipText,
                  isActive && styles.matchdayChipTextActive,
                ]}>
                  {m.giornata}ª G
                </Text>
                <Text style={[
                  styles.matchdayChipSub,
                  isActive && styles.matchdayChipSubActive,
                ]}>
                  ({m.votes_count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        </View>
      )}

      {/* Calculated warning */}
      {liveData?.is_calculated && (
        <View style={styles.calcBanner}>
          <Ionicons name="checkmark-circle" size={16} color="#198754" />
          <Text style={styles.calcBannerText}>
            {currentGiornata}ª Giornata già calcolata il {new Date(liveData.calculated_at).toLocaleDateString('it-IT')}
          </Text>
        </View>
      )}

      {!liveData?.is_calculated && (
        <View style={styles.notCalcBanner}>
          <Ionicons name="time-outline" size={16} color="#e6a800" />
          <Text style={styles.notCalcBannerText}>Punteggi provvisori - {currentGiornata}ª giornata non ancora calcolata</Text>
        </View>
      )}

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadLiveData(true); }} />}
      >
        {(liveData?.results || []).map((team, index) => {
          const isExpanded = !!expandedTeams[team.user_id];
          return (
            <View key={team.user_id} style={styles.teamCard}>
              <TouchableOpacity
                style={styles.teamHeader}
                onPress={() => toggleTeam(team.user_id)}
                activeOpacity={0.7}
              >
                <View style={styles.teamPos}>
                  <Text style={styles.teamPosText}>{index + 1}</Text>
                </View>
                {(() => {
                  const tLogo = team.team_logo && team.team_logo.trim() !== '' ? team.team_logo : 'default_1';
                  return tLogo.startsWith('default_') ? (
                    <View style={[styles.teamLogoWrap, { backgroundColor: (defaultLogosMap[tLogo]?.color || '#667eea') + '20' }]}>
                      <Text style={styles.teamLogoEmoji}>{defaultLogosMap[tLogo]?.emoji || '⚽'}</Text>
                    </View>
                  ) : (
                    <Image source={{ uri: publicAssetUrl(tLogo) }} style={styles.teamLogoWrap} />
                  );
                })()}
                <View style={styles.teamInfo}>
                  <Text style={styles.teamName} numberOfLines={1}>{team.team_name || team.username}</Text>
                  <Text style={styles.teamUser}>{team.username}</Text>
                </View>
                <Text style={styles.teamScore}>{team.punteggio}</Text>
                <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color="#999" />
              </TouchableOpacity>

              {isExpanded && team.players && team.players.length > 0 && (
                <View style={styles.playersContainer}>
                  {team.players.map(p => (
                    <View key={p.player_id} style={styles.playerRow}>
                      <View style={[styles.roleStripe, { backgroundColor: getRoleColor(p.player_role) }]} />
                      <View style={[styles.roleBadge, { backgroundColor: getRoleColor(p.player_role) }]}>
                        <Text style={styles.roleBadgeText}>{p.player_role}</Text>
                      </View>
                      <Text style={styles.playerName} numberOfLines={1}>{p.player_name}</Text>
                      <Text style={styles.playerRating}>{p.rating > 0 ? p.rating.toFixed(1) : 'S.V.'}</Text>
                      {p.bonus_total !== 0 && (
                        <Text style={[styles.playerBonus, p.bonus_total > 0 ? styles.bonusPositive : styles.bonusNegative]}>
                          {p.bonus_total > 0 ? '+' : ''}{p.bonus_total.toFixed(1)}
                        </Text>
                      )}
                      <Text style={styles.playerTotal}>{p.total_score.toFixed(1)}</Text>
                    </View>
                  ))}
                </View>
              )}

              {isExpanded && (!team.players || team.players.length === 0) && (
                <View style={styles.noPlayersContainer}>
                  <Text style={styles.noPlayersText}>Nessun titolare con voto</Text>
                </View>
              )}
            </View>
          );
        })}

        {(!liveData?.results || liveData.results.length === 0) && (
          <View style={styles.emptyContainer}>
            <Ionicons name="football-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>Nessun dato disponibile</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: {
    padding: 8,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2e7d32',
  },
  liveLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2e7d32',
    letterSpacing: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#999',
  },
  matchdaySelectorWrapper: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  matchdaySelector: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
    alignItems: 'center',
  },
  matchdayChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#f0f0f0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  matchdayChipActive: {
    backgroundColor: '#2e7d32',
  },
  matchdayChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#555',
  },
  matchdayChipTextActive: {
    color: '#fff',
  },
  matchdayChipSub: {
    fontSize: 10,
    color: '#999',
  },
  matchdayChipSubActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  calcBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  calcBannerText: {
    fontSize: 12,
    color: '#198754',
    fontWeight: '500',
  },
  notCalcBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3cd',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  notCalcBannerText: {
    fontSize: 12,
    color: '#856404',
    fontWeight: '500',
  },
  content: {
    flex: 1,
    padding: 12,
  },
  teamCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
  },
  teamPos: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamPosText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  teamLogoWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamLogoEmoji: {
    fontSize: 15,
  },
  teamInfo: {
    flex: 1,
  },
  teamName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  teamUser: {
    fontSize: 11,
    color: '#999',
  },
  teamScore: {
    fontSize: 18,
    fontWeight: '800',
    color: '#333',
    marginRight: 4,
  },
  playersContainer: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f8f8f8',
  },
  roleStripe: {
    width: 3,
    height: 24,
    borderRadius: 1.5,
    marginRight: 8,
  },
  roleBadge: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  playerName: {
    flex: 1,
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
  },
  playerRating: {
    fontSize: 13,
    fontWeight: '600',
    color: '#667eea',
    width: 32,
    textAlign: 'center',
  },
  playerBonus: {
    fontSize: 11,
    fontWeight: '600',
    width: 36,
    textAlign: 'center',
  },
  bonusPositive: {
    color: '#198754',
  },
  bonusNegative: {
    color: '#dc3545',
  },
  playerTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    width: 38,
    textAlign: 'right',
  },
  noPlayersContainer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    alignItems: 'center',
  },
  noPlayersText: {
    fontSize: 13,
    color: '#999',
    fontStyle: 'italic',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 12,
  },
});

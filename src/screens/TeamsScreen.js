import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Image,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useOnboarding } from '../context/OnboardingContext';
import { teamsService, leagueService, formationService } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { publicAssetUrl } from '../services/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { defaultLogosMap } from '../constants/defaultLogos';
import { syncSubmittedFormationOnboarding } from '../utils/formationSubmission';

export default function TeamsScreen({ route, navigation }) {
  const { user } = useAuth();
  const { markDone } = useOnboarding();
  const { leagueId } = route.params || {};
  const insets = useSafeAreaInsets();
  const [teams, setTeams] = useState([]);
  const [league, setLeague] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  const safeNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  
  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [leagueId])
  );

  const loadData = async () => {
    try {
      await syncSubmittedFormationOnboarding({ leagueId, formationService, markDone });
    } catch (_) {}
    await Promise.all([loadTeams(), loadLeague()]);
  };

  const loadLeague = async () => {
    try {
      const res = await leagueService.getById(leagueId);
      const leagueData = Array.isArray(res.data) ? res.data[0] : res.data;
      setLeague(leagueData);
    } catch (error) {
      console.error('Error loading league:', error);
    }
  };

  const loadTeams = async () => {
    try {
      const response = await teamsService.getTeams(leagueId);
      const rows = Array.isArray(response.data) ? response.data : [];
      const normalized = rows.map((row) => ({
        ...row,
        budget: safeNumber(row?.budget, 0),
      }));
      setTeams(normalized);
    } catch (error) {
      showToast('Impossibile caricare le squadre');
      console.error(error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadTeams();
  };

  const filteredTeams = useMemo(() => {
    if (!searchQuery.trim()) return teams;
    const query = searchQuery.toLowerCase().trim();
    return teams.filter(team =>
      team.team_name?.toLowerCase().includes(query) ||
      team.coach_name?.toLowerCase().includes(query) ||
      team.username?.toLowerCase().includes(query)
    );
  }, [teams, searchQuery]);

  const handleTeamPress = (team) => {
    navigation.navigate('TeamDetail', { leagueId, userId: team.id });
  };

  const renderTeamItem = ({ item, index }) => {
    const teamLogo = item.team_logo || 'default_1';
    const isDefaultLogo = teamLogo.startsWith('default_');
    const isMe = item.id === user?.id;
    const budgetValue = safeNumber(item?.budget, 0);

    return (
      <TouchableOpacity
        style={[styles.teamCard, isMe && styles.myTeamCard]}
        onPress={() => handleTeamPress(item)}
        activeOpacity={0.7}
      >
        {/* Logo */}
        {isDefaultLogo ? (
          <View style={[styles.logoCircle, { backgroundColor: (defaultLogosMap[teamLogo]?.color || '#667eea') + '20' }]}>
            <Text style={styles.logoEmoji}>{defaultLogosMap[teamLogo]?.emoji || '⚽'}</Text>
          </View>
        ) : (
          <Image
            source={{ uri: publicAssetUrl(teamLogo) }}
            style={styles.logoCircle}
            onError={() => {}}
          />
        )}

        {/* Info centrale */}
        <View style={styles.teamBody}>
          <View style={styles.teamNameRow}>
            <Text style={styles.teamName} numberOfLines={1}>{item.team_name || 'Senza nome'}</Text>
            {isMe && (
              <View style={styles.meBadge}>
                <Text style={styles.meBadgeText}>Tu</Text>
              </View>
            )}
          </View>
          <Text style={styles.coachName} numberOfLines={1}>
            {item.coach_name || 'N/A'}
          </Text>
          <View style={styles.teamMeta}>
            <Text style={styles.username} numberOfLines={1}>{item.username}</Text>
            <View style={styles.budgetChip}>
              <Text style={styles.budgetText}>{budgetValue.toFixed(0)} {budgetValue === 1 ? 'credito' : 'crediti'}</Text>
            </View>
          </View>
        </View>

        {/* Freccia */}
        <Ionicons name="chevron-forward" size={18} color="#ccc" />
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Squadre</Text>
        {league && <Text style={styles.leagueName}>{league.name}</Text>}
      </View>

      {/* Barra ricerca + contatore */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#999" />
        <TextInput
          style={styles.searchInput}
          placeholder="Cerca squadra, allenatore o utente..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          placeholderTextColor="#aaa"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close-circle" size={18} color="#bbb" />
          </TouchableOpacity>
        )}
      </View>

      {/* Contatore */}
      {teams.length > 0 && (
        <View style={styles.countRow}>
          <View style={styles.countChip}>
            <Ionicons name="people-outline" size={14} color="#667eea" />
            <Text style={styles.countText}>{filteredTeams.length} squadr{filteredTeams.length === 1 ? 'a' : 'e'}</Text>
          </View>
        </View>
      )}

      <FlatList
        data={filteredTeams}
        renderItem={renderTeamItem}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={[styles.listContent, { paddingBottom: 60 + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={52} color="#d0d0d0" />
            <Text style={styles.emptyTitle}>
              {searchQuery.trim() ? 'Nessun risultato' : 'Nessuna squadra'}
            </Text>
            <Text style={styles.emptySubtext}>
              {searchQuery.trim()
                ? 'Prova con un altro termine di ricerca'
                : 'Non ci sono ancora squadre in questa lega'}
            </Text>
          </View>
        }
      />

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
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    lineHeight: 28,
  },
  leagueName: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },

  /* Ricerca */
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eee',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 10,
    color: '#333',
  },

  /* Contatore */
  countRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 2,
  },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef0fb',
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 12,
    gap: 6,
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#667eea',
  },

  /* Lista */
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },

  /* Card squadra */
  teamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  myTeamCard: {
    borderWidth: 1.5,
    borderColor: '#667eea',
  },

  /* Logo */
  logoCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    marginRight: 12,
  },
  logoEmoji: {
    fontSize: 22,
  },

  /* Info */
  teamBody: {
    flex: 1,
    marginRight: 8,
  },
  teamNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  teamName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2c3e50',
    flexShrink: 1,
  },
  meBadge: {
    backgroundColor: '#667eea',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  meBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  coachName: {
    fontSize: 13,
    color: '#6c757d',
    marginBottom: 4,
  },
  teamMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  username: {
    fontSize: 12,
    color: '#999',
    flexShrink: 1,
  },
  budgetChip: {
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  budgetText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2e7d32',
  },

  /* Empty state */
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#999',
    marginTop: 14,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#bbb',
    marginTop: 6,
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

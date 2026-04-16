import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { leagueService } from '../services/api';
import { registerPushTokenIfPermitted, syncLeagueNotifications } from '../services/notificationService';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { hiddenLeagues, consumePendingToast } from '../utils/dashboardEvents';

export default function DashboardScreen({ navigation, route }) {
  const { user } = useAuth();
  const [leagues, setLeagues] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  // Ricarica i dati quando la schermata torna in focus + polling ogni 15s
  useFocusEffect(
    useCallback(() => {
      loadLeagues();
      const interval = setInterval(() => {
        loadLeagues();
      }, 15000);
      return () => clearInterval(interval);
    }, [])
  );

  const loadLeagues = async () => {
    registerPushTokenIfPermitted().catch(() => {});
    // Controlla se c'è un toast pendente da mostrare
    const toast = consumePendingToast();
    if (toast) showToast(toast.text, toast.type);
    try {
      const response = await leagueService.getAll();
      // Filtra le leghe appena abbandonate (in attesa che l'API completi)
      const raw = response?.data;
      const data = Array.isArray(raw) ? raw : [];
      const normalized = data.map((league) => ({
        ...league,
        favorite: Number(league?.favorite) === 1 || league?.favorite === true,
        archived: Number(league?.archived) === 1 || league?.archived === true,
        notifications_enabled: Number(league?.notifications_enabled) === 1 || league?.notifications_enabled === true,
      }));
      const filtered = hiddenLeagues.size > 0
        ? normalized.filter(l => !hiddenLeagues.has(l.id))
        : normalized;
      setLeagues(filtered);
      syncLeagueNotifications(filtered).catch((e) => console.log('Notifications sync failed', e?.message || e));
    } catch (error) {
      showToast('Impossibile caricare le leghe');
      console.error(error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadLeagues();
  };

  // Filtra le leghe in base alla ricerca
  const filteredLeagues = useMemo(() => {
    const list = Array.isArray(leagues) ? leagues : [];
    if (!searchQuery.trim()) {
      return list;
    }
    const query = searchQuery.toLowerCase().trim();
    return list.filter((league) =>
      league?.name && String(league.name).toLowerCase().includes(query)
    );
  }, [leagues, searchQuery]);

  // Separa leghe preferite, archiviate e normali
  const favoriteLeagues = useMemo(() => {
    return filteredLeagues.filter(league => league.favorite && !league.archived);
  }, [filteredLeagues]);

  const archivedLeagues = useMemo(() => {
    return filteredLeagues.filter(league => league.archived);
  }, [filteredLeagues]);

  const normalLeagues = useMemo(() => {
    return filteredLeagues.filter(league => !league.favorite && !league.archived);
  }, [filteredLeagues]);

  const toggleFavorite = async (leagueId, currentFavorite) => {
    try {
      const league = leagues.find(l => l.id === leagueId);
      await leagueService.updatePrefs(leagueId, {
        favorite: !currentFavorite ? 1 : 0,
        archived: league?.archived ? 1 : 0,
        notifications_enabled: league?.notifications_enabled === false ? 0 : 1,
      });
      // Ricarica le leghe
      loadLeagues();
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Impossibile aggiornare le preferenze';
      showToast(errorMessage);
      console.error('Toggle favorite error:', error);
    }
  };

  const toggleArchived = async (leagueId, currentArchived) => {
    try {
      // Se archivia, rimuovi dai preferiti
      const league = leagues.find(l => l.id === leagueId);
      await leagueService.updatePrefs(leagueId, {
        favorite: currentArchived ? (league?.favorite ? 1 : 0) : 0,
        archived: !currentArchived ? 1 : 0,
        notifications_enabled: league?.notifications_enabled === false ? 0 : 1,
      });
      // Ricarica le leghe
      loadLeagues();
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Impossibile aggiornare le preferenze';
      showToast(errorMessage);
      console.error('Toggle archived error:', error);
    }
  };

  const toggleNotifications = async (leagueId, currentEnabled) => {
    try {
      const league = leagues.find(l => l.id === leagueId);
      await leagueService.updatePrefs(leagueId, {
        favorite: league?.favorite ? 1 : 0,
        archived: league?.archived ? 1 : 0,
        notifications_enabled: currentEnabled ? 0 : 1,
      });
      loadLeagues();
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Impossibile aggiornare notifiche lega';
      showToast(errorMessage);
      console.error('Toggle notifications error:', error);
    }
  };

  const handleLeaguePress = (league) => {
    navigation.navigate('League', { leagueId: league.id });
  };

  const renderLeagueItem = ({ item }) => (
    <TouchableOpacity
      style={styles.leagueCard}
      onPress={() => handleLeaguePress(item)}
    >
      <View style={styles.leagueHeader}>
        <Ionicons name="trophy" size={24} color="#ffc107" />
        <Text style={styles.leagueName}>{item.name}</Text>
        <View style={styles.leagueActions}>
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              toggleFavorite(item.id, item.favorite);
            }}
            style={styles.actionButton}
          >
            <Ionicons
              name={item.favorite ? "star" : "star-outline"}
              size={20}
              color={item.favorite ? "#ffc107" : "#666"}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              toggleArchived(item.id, item.archived);
            }}
            style={styles.actionButton}
          >
            <Ionicons
              name={item.archived ? "archive" : "archive-outline"}
              size={20}
              color={item.archived ? "#666" : "#666"}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              toggleNotifications(item.id, !!item.notifications_enabled);
            }}
            style={styles.actionButton}
          >
            <Ionicons
              name={item.notifications_enabled ? "notifications-outline" : "notifications-off-outline"}
              size={20}
              color={item.notifications_enabled ? "#667eea" : "#999"}
            />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.leagueInfo}>
        <View style={styles.leagueBadgeContainer}>
          {item.role === 'admin' && (
            <View style={[styles.leagueBadge, styles.adminBadge]}>
              <Text style={[styles.leagueBadgeText, { color: '#fff' }]}>Admin</Text>
            </View>
          )}
        </View>
        <View style={styles.usersContainer}>
          <Ionicons name="people-outline" size={16} color="#999" />
          <Text style={styles.usersValue}>{Number(item?.user_count ?? item?.member_count ?? 0) || 0}</Text>
        </View>
      </View>
      <View style={styles.leagueFooter}>
        <View style={styles.matchdayContainer}>
          <View style={styles.matchdayLeft}>
            <Ionicons name="calendar-outline" size={16} color="#999" />
            <Text style={styles.leagueMatchday}>
              {item.current_matchday ? `${item.current_matchday}ª giornata` : 'Non iniziata'}
            </Text>
          </View>
          <View style={styles.verticalDivider} />
          <View style={styles.formationContainer}>
            <Text style={styles.formationLabel}>Auto-formazione</Text>
            <Text style={[styles.formationValue, (item.auto_lineup_mode === 1 || item.auto_lineup_mode === true) ? styles.formationYes : styles.formationNo]}>
              {(item.auto_lineup_mode === 1 || item.auto_lineup_mode === true) ? 'Sì' : 'No'}
            </Text>
          </View>
          <View style={styles.verticalDivider} />
          <View style={styles.marketContainer}>
            <Text style={styles.marketLabel}>Mercato</Text>
            <Text style={[styles.marketValue, item.market_locked === 1 ? styles.marketClosed : styles.marketOpen]}>
              {item.market_locked === 1 ? 'Chiuso' : 'Aperto'}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderSection = (title, data, icon, isCollapsible = false, expanded = true, onToggle = null) => {
    if (data.length === 0) return null;
    
    if (isCollapsible && !expanded) {
      return (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={onToggle}
          >
            <Ionicons name={icon} size={20} color="#667eea" />
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={styles.sectionCount}>({data.length})</Text>
            <Ionicons name="chevron-down" size={20} color="#666" style={styles.chevron} />
          </TouchableOpacity>
        </View>
      );
    }
    
    return (
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={isCollapsible ? onToggle : undefined}
          disabled={!isCollapsible}
        >
          <Ionicons name={icon} size={20} color="#667eea" />
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionCount}>({data.length})</Text>
          {isCollapsible && (
            <Ionicons name="chevron-up" size={20} color="#666" style={styles.chevron} />
          )}
        </TouchableOpacity>
        {expanded && data.map((league) => (
          <View key={league.id}>
            {renderLeagueItem({ item: league })}
          </View>
        ))}
      </View>
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
      <View style={styles.header}>
        <Text style={styles.title}>Le Mie Leghe</Text>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Cerca leghe..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            placeholderTextColor="#999"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
              <Ionicons name="close-circle" size={20} color="#999" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {favoriteLeagues.length > 0 && renderSection('Preferite', favoriteLeagues, 'star')}
        {normalLeagues.length > 0 && renderSection('Tutte le Leghe', normalLeagues, 'trophy')}
        {archivedLeagues.length > 0 && renderSection(
          'Archiviate',
          archivedLeagues,
          'archive',
          true,
          archivedExpanded,
          () => setArchivedExpanded(!archivedExpanded)
        )}

        {filteredLeagues.length === 0 && (
          <View style={styles.emptyContainer}>
            <Ionicons name="trophy-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>
              {searchQuery.trim() ? 'Nessuna lega trovata' : 'Nessuna lega trovata'}
            </Text>
            <Text style={styles.emptySubtext}>
              {searchQuery.trim()
                ? 'Prova con un altro nome'
                : 'Crea o unisciti a una lega per iniziare'}
            </Text>
            {!searchQuery.trim() && (
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => {
                  navigation.navigate('Leghe');
                }}
              >
                <Text style={styles.emptyButtonText}>Cerca Leghe</Text>
              </TouchableOpacity>
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
  },
  header: {
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
    color: '#333',
  },
  clearButton: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 15,
  },
  section: {
    marginBottom: 25,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  chevron: {
    marginLeft: 'auto',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 8,
  },
  sectionCount: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
  },
  leagueCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  leagueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  leagueName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 10,
    flex: 1,
  },
  leagueActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 4,
  },
  leagueInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  leagueBadgeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  leagueBadge: {
    backgroundColor: '#e0e0e0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
    marginBottom: 4,
  },
  adminBadge: {
    backgroundColor: '#667eea',
  },
  leagueBadgeText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '600',
  },
  leagueFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  matchdayContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  matchdayLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  verticalDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#ddd',
  },
  formationContainer: {
    alignItems: 'center',
  },
  leagueMatchday: {
    fontSize: 14,
    color: '#999',
    fontWeight: '500',
  },
  formationLabel: {
    fontSize: 11,
    color: '#999',
    fontWeight: '400',
  },
  formationValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  formationYes: {
    color: '#198754',
  },
  formationNo: {
    color: '#dc3545',
  },
  marketContainer: {
    alignItems: 'center',
  },
  marketLabel: {
    fontSize: 11,
    color: '#999',
    fontWeight: '400',
  },
  marketValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  marketOpen: {
    color: '#198754',
  },
  marketClosed: {
    color: '#dc3545',
  },
  usersContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  usersValue: {
    fontSize: 14,
    color: '#999',
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    color: '#999',
    marginTop: 16,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#ccc',
    marginTop: 8,
    marginBottom: 20,
  },
  emptyButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 10,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
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
  toastError: {
    backgroundColor: '#e53935',
  },
  toastSuccess: {
    backgroundColor: '#2e7d32',
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
});

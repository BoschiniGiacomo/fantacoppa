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
  Modal,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { leagueService } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

export default function LeaguesScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [allLeagues, setAllLeagues] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [accessCode, setAccessCode] = useState('');
  const [joining, setJoining] = useState(false);
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
    try {
      const response = await leagueService.getAllLeagues();
      const raw = response?.data;
      setAllLeagues(Array.isArray(raw) ? raw : []);
    } catch (error) {
      showToast('Impossibile caricare le leghe');
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
    const list = (Array.isArray(allLeagues) ? allLeagues : []).filter(
      (league) => Number(league?.is_joined || 0) !== 1
    );
    if (!searchQuery.trim()) {
      return list;
    }
    const query = searchQuery.toLowerCase().trim();
    return list.filter(
      (league) => league?.name && String(league.name).toLowerCase().includes(query)
    );
  }, [allLeagues, searchQuery]);

  const handleLeaguePress = (league) => {
    setSelectedLeague(league);
    setAccessCode('');
    setJoinModalVisible(true);
  };

  const handleJoin = async () => {
    if (!selectedLeague) return;

    // Valida il codice di accesso se la lega è privata
    if (selectedLeague.access_code) {
      if (!accessCode || accessCode.trim() === '') {
        showToast('Inserisci il codice di accesso per unirti a questa lega');
        return;
      }
    }

    setJoining(true);
    try {
      const response = await leagueService.join(selectedLeague.id, accessCode || null);
      
      // Controlla se la lega richiede approvazione
      if (response?.data?.requires_approval) {
        setJoinModalVisible(false);
        setSelectedLeague(null);
        setAccessCode('');
        showToast(response.data.message || 'Richiesta di iscrizione inviata. In attesa di approvazione.', 'success');
        return;
      }
      
      const joinedLeagueId = response?.data?.leagueId || selectedLeague.id;
      
      setJoinModalVisible(false);
      setSelectedLeague(null);
      setAccessCode('');
      
      // Naviga direttamente alla lega appena unita
      navigation.navigate('League', { leagueId: joinedLeagueId });
    } catch (error) {
      let errorMessage = 'Errore durante l\'unione alla lega';
      
      if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.status === 400) {
        errorMessage = error.response?.data?.message || 'Codice di accesso errato';
      } else if (error.message && !error.message.includes('AxiosError')) {
        errorMessage = error.message;
      }
      
      showToast(errorMessage);
    } finally {
      setJoining(false);
    }
  };

  const renderLeagueItem = ({ item }) => (
    <TouchableOpacity
      style={styles.leagueCard}
      onPress={() => handleLeaguePress(item)}
    >
      <View style={styles.leagueHeader}>
        <Ionicons name="trophy" size={24} color="#ffc107" />
        <Text style={styles.leagueName}>{item.name}</Text>
        <View style={styles.usersContainer}>
          <Ionicons name="people-outline" size={16} color="#999" />
          <Text style={styles.usersValue}>{item.user_count || 0}</Text>
        </View>
      </View>
      <View style={styles.leagueInfo}>
        <View style={styles.leagueBadgeContainer}>
          {item.access_code ? (
            <View style={[styles.leagueBadge, styles.privateBadge]}>
              <Ionicons name="lock-closed" size={12} color="#fff" />
              <Text style={[styles.leagueBadgeText, { color: '#fff', marginLeft: 4 }]}>Privata</Text>
            </View>
          ) : (
            <View style={[styles.leagueBadge, styles.publicBadge]}>
              <Text style={[styles.leagueBadgeText, { color: '#198754' }]}>Pubblica</Text>
            </View>
          )}
        </View>
        <View style={styles.joinContainer}>
          <Ionicons name="add-circle" size={20} color="#667eea" />
          <Text style={styles.joinText}>Unisciti</Text>
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
        <Text style={styles.title}>Crea o unisciti a una lega</Text>
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

      <FlatList
        data={filteredLeagues}
        renderItem={renderLeagueItem}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="trophy-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>
              {searchQuery.trim() ? 'Nessuna lega trovata' : 'Nessuna lega disponibile'}
            </Text>
            <Text style={styles.emptySubtext}>
              {searchQuery.trim() 
                ? 'Prova con un altro nome' 
                : 'Crea una nuova lega per iniziare'}
            </Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CreateLeague')}
      >
        <Ionicons name="add" size={32} color="#fff" />
      </TouchableOpacity>

      {/* Modal per unirsi */}
      <Modal
        visible={joinModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setJoinModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Icona decorativa */}
            <View style={styles.modalIconWrap}>
              <Ionicons name="enter-outline" size={32} color="#667eea" />
            </View>

            <Text style={styles.modalTitle}>Unisciti alla Lega</Text>
            <Text style={styles.modalLeagueName}>{selectedLeague?.name}</Text>

            {selectedLeague?.access_code ? (
              <View style={styles.inputGroup}>
                <View style={styles.inputWrapper}>
                  <Ionicons name="lock-closed-outline" size={18} color="#999" style={{ marginRight: 10 }} />
                  <TextInput
                    style={styles.inputInline}
                    placeholder="Codice di accesso"
                    placeholderTextColor="#bbb"
                    value={accessCode}
                    onChangeText={setAccessCode}
                    autoCapitalize="characters"
                  />
                </View>
              </View>
            ) : (
              <View style={styles.infoBox}>
                <Ionicons name="globe-outline" size={16} color="#667eea" />
                <Text style={styles.infoBoxText}>Lega pubblica, accesso libero</Text>
              </View>
            )}

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setJoinModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.joinBtn, joining && styles.buttonDisabled]}
                onPress={handleJoin}
                disabled={joining}
              >
                {joining ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="enter-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={styles.joinBtnText}>Unisciti</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
        {toastMsg && (
          <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
            <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
            <Text style={styles.toastText}>{toastMsg.text}</Text>
          </View>
        )}
      </Modal>

      {!joinModalVisible && toastMsg && (
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
  listContent: {
    padding: 15,
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
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  leagueName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 10,
    flex: 1,
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
  privateBadge: {
    backgroundColor: '#667eea',
    flexDirection: 'row',
    alignItems: 'center',
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
  publicBadge: {
    backgroundColor: '#d1e7dd',
    borderColor: '#198754',
  },
  joinContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  joinText: {
    fontSize: 16,
    color: '#667eea',
    fontWeight: '600',
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    width: '85%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 12,
  },
  modalIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#eef0ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  modalLeagueName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#667eea',
    marginBottom: 20,
    textAlign: 'center',
  },
  inputGroup: {
    width: '100%',
    marginBottom: 20,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  inputInline: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    paddingVertical: 12,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef0ff',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 8,
    marginBottom: 20,
    width: '100%',
  },
  infoBoxText: {
    fontSize: 13,
    color: '#667eea',
    fontWeight: '500',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  cancelBtnText: {
    color: '#555',
    fontSize: 15,
    fontWeight: '600',
  },
  joinBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#667eea',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  joinBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
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
  },
  fab: {
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

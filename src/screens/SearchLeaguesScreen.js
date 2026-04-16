import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { leagueService } from '../services/api';
import { Ionicons } from '@expo/vector-icons';

export default function SearchLeaguesScreen({ navigation }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [leagues, setLeagues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [accessCode, setAccessCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  
  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useEffect(() => {
    if (searchQuery.length >= 2) {
      searchLeagues();
    } else {
      setLeagues([]);
    }
  }, [searchQuery]);

  const searchLeagues = async () => {
    setLoading(true);
    try {
      const response = await leagueService.search(searchQuery);
      const raw = Array.isArray(response?.data) ? response.data : [];
      setLeagues(raw.filter((league) => Number(league?.is_joined || 0) !== 1));
    } catch (error) {
      console.error('Search error:', error);
      setLeagues([]);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinPress = (league) => {
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
      // Gestisci l'errore senza mostrare l'AxiosError nella console
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
      onPress={() => handleJoinPress(item)}
    >
      <View style={styles.leagueHeader}>
        <Ionicons name="trophy-outline" size={24} color="#ffc107" />
        <Text style={styles.leagueName}>{item.name}</Text>
      </View>
      <View style={styles.leagueInfo}>
        <View style={styles.leagueBadge}>
          <Text style={styles.leagueBadgeText}>ID: {item.id}</Text>
        </View>
        {item.access_code && (
          <View style={[styles.leagueBadge, styles.privateBadge]}>
            <Ionicons name="lock-closed" size={12} color="#fff" />
            <Text style={[styles.leagueBadgeText, { color: '#fff', marginLeft: 4 }]}>Privata</Text>
          </View>
        )}
      </View>
      <View style={styles.leagueFooter}>
        <Ionicons name="add-circle-outline" size={20} color="#667eea" />
        <Text style={styles.joinText}>Unisciti</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Cerca Leghe</Text>
        <Text style={styles.subtitle}>Unisciti a una lega esistente</Text>
      </View>

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cerca per nome lega..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
            <Ionicons name="close-circle" size={20} color="#999" />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      ) : leagues.length === 0 && searchQuery.length >= 2 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="search-outline" size={64} color="#ccc" />
          <Text style={styles.emptyText}>Nessuna lega trovata</Text>
          <Text style={styles.emptySubtext}>Prova con un altro nome</Text>
        </View>
      ) : searchQuery.length < 2 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="search-outline" size={64} color="#ccc" />
          <Text style={styles.emptyText}>Inizia a cercare</Text>
          <Text style={styles.emptySubtext}>Inserisci almeno 2 caratteri per cercare</Text>
        </View>
      ) : (
        <FlatList
          data={leagues}
          renderItem={renderLeagueItem}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Modal per unirsi */}
      <Modal
        visible={joinModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setJoinModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
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
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 15,
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
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    marginBottom: 12,
  },
  leagueName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 10,
    flex: 1,
  },
  leagueInfo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  leagueBadge: {
    backgroundColor: '#e0e0e0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  privateBadge: {
    backgroundColor: '#667eea',
  },
  leagueBadgeText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '600',
  },
  leagueFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
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


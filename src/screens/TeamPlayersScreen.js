import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { leagueService } from '../services/api';

export default function TeamPlayersScreen({ route, navigation }) {
  const { leagueId, teamId, teamName } = route.params || {};
  const insets = useSafeAreaInsets();
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState('P');
  const [rating, setRating] = useState('');
  const [shirtNumber, setShirtNumber] = useState('');
  const [toastMsg, setToastMsg] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  
  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useEffect(() => {
    loadPlayers();
  }, [leagueId, teamId]);

  const onRefresh = () => {
    setRefreshing(true);
    loadPlayers();
  };

  const loadPlayers = async () => {
    try {
      setLoading(true);
      const res = await leagueService.getTeamPlayers(leagueId, teamId);
      console.log('Players response:', res);
      let playersData = res.data;
      if (!Array.isArray(playersData)) {
        if (playersData && typeof playersData === 'object') {
          playersData = Object.values(playersData);
        } else {
          playersData = [];
        }
      }
      setPlayers(playersData);
    } catch (error) {
      console.error('Error loading players:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Impossibile caricare i giocatori';
      showToast(errorMessage);
      setPlayers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleEditPlayer = (player) => {
    setEditingPlayer(player);
    setFirstName(player.first_name || '');
    setLastName(player.last_name || '');
    setRole(player.role || 'P');
    setRating(String(player.rating || ''));
    setShirtNumber(player.shirt_number === null || typeof player.shirt_number === 'undefined' ? '' : String(player.shirt_number));
    setShowEditModal(true);
  };

  const handleSavePlayer = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      showToast('Nome e cognome sono obbligatori');
      return;
    }
    if (!rating || isNaN(parseFloat(rating))) {
      showToast('La valutazione deve essere un numero valido');
      return;
    }
    if (!['P', 'D', 'C', 'A'].includes(role)) {
      showToast('Ruolo non valido');
      return;
    }

    try {
      setSaving(true);
      await leagueService.updatePlayer(leagueId, teamId, editingPlayer.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        role: role,
        rating: parseFloat(rating),
        shirt_number: shirtNumber === '' ? null : Number(shirtNumber),
      });
      showToast('Giocatore aggiornato con successo!', 'success');
      setShowEditModal(false);
      loadPlayers();
    } catch (error) {
      console.error('Error saving player:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Errore durante l\'aggiornamento del giocatore';
      showToast(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlayer = async (playerId, playerName) => {
    setConfirmModal({
      title: 'Conferma eliminazione',
      message: `Sei sicuro di voler eliminare ${playerName}?`,
      confirmText: 'Elimina',
      destructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          setDeletingId(playerId);
          await leagueService.deletePlayer(leagueId, teamId, playerId);
          showToast('Giocatore eliminato con successo!', 'success');
          loadPlayers();
        } catch (error) {
          console.error('Error deleting player:', error);
          const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Errore durante l\'eliminazione del giocatore';
          showToast(errorMessage);
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  const renderRightActions = (progress, dragX, player) => {
    const scale = dragX.interpolate({
      inputRange: [-100, 0],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    });
    return (
      <View style={styles.actionsContainer}>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => handleEditPlayer(player)}
        >
          <Ionicons name="pencil" size={20} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => handleDeletePlayer(player.id, `${player.first_name} ${player.last_name}`)}
        >
          {deletingId === player.id ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name="trash" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'P': return '🧤';
      case 'D': return '🛡️';
      case 'C': return '⚽';
      case 'A': return '🎯';
      default: return '👤';
    }
  };

  const getRoleLabel = (role) => {
    switch (role) {
      case 'P': return 'Portiere';
      case 'D': return 'Difensore';
      case 'C': return 'Centrocampista';
      case 'A': return 'Attaccante';
      default: return role;
    }
  };

  if (loading && players.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color="#667eea" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{teamName || 'Giocatori'}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#667eea" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{teamName || 'Giocatori'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {!Array.isArray(players) || players.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>Nessun giocatore presente</Text>
          </View>
        ) : (
          <View style={styles.playersList}>
            {players.map((player) => (
              <Swipeable
                key={player.id}
                renderRightActions={(progress, dragX) => renderRightActions(progress, dragX, player)}
                overshootRight={false}
              >
                <View style={styles.playerItem}>
                  <View style={styles.playerInfo}>
                    <Text style={styles.playerName}>
                      {player.first_name} {player.last_name}
                    </Text>
                    <View style={styles.playerDetails}>
                      <View style={styles.roleBadge}>
                        <Text style={styles.roleIcon}>{getRoleIcon(player.role)}</Text>
                        <Text style={styles.roleText}>{getRoleLabel(player.role)}</Text>
                      </View>
                      <View style={styles.ratingBadge}>
                        <Text style={styles.ratingText}>⭐ {player.rating || '0.0'}</Text>
                      </View>
                      <View style={styles.numberBadge}>
                        <Text style={styles.numberText}>#{player.shirt_number ?? '-'}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </Swipeable>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Edit Modal */}
      <Modal
        visible={showEditModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowEditModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Modifica Giocatore</Text>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Nome</Text>
              <TextInput
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Nome"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Cognome</Text>
              <TextInput
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Cognome"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Ruolo</Text>
              <View style={styles.roleSelector}>
                {['P', 'D', 'C', 'A'].map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.roleOption, role === r && styles.roleOptionActive]}
                    onPress={() => setRole(r)}
                  >
                    <Text style={[styles.roleOptionText, role === r && styles.roleOptionTextActive]}>
                      {getRoleLabel(r)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Valutazione</Text>
              <TextInput
                style={styles.input}
                value={rating}
                onChangeText={setRating}
                placeholder="0.0"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Numero maglia</Text>
              <TextInput
                style={styles.input}
                value={shirtNumber}
                onChangeText={setShirtNumber}
                placeholder="es. 10"
                keyboardType="number-pad"
              />
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.cancelButton, saving && styles.buttonDisabled]}
                onPress={() => setShowEditModal(false)}
                disabled={saving}
              >
                <Text style={styles.cancelButtonText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, saving && styles.buttonDisabled]}
                onPress={handleSavePlayer}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Salva</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {toastMsg && (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      )}
      <Modal visible={!!confirmModal} transparent={true} animationType="fade" onRequestClose={() => setConfirmModal(null)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmContent}>
            <View style={styles.confirmIconWrap}>
              <Ionicons name={confirmModal?.destructive ? 'warning' : 'information-circle'} size={40} color={confirmModal?.destructive ? '#e53935' : '#667eea'} />
            </View>
            <Text style={styles.confirmTitle}>{confirmModal?.title}</Text>
            <Text style={styles.confirmMessage}>{confirmModal?.message}</Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity style={styles.confirmBtnCancel} onPress={() => setConfirmModal(null)}>
                <Text style={styles.confirmBtnCancelText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtnAction, confirmModal?.destructive && { backgroundColor: '#e53935' }]} onPress={() => confirmModal?.onConfirm?.()}>
                <Text style={styles.confirmBtnActionText}>{confirmModal?.confirmText || 'Conferma'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#777',
    marginTop: 16,
  },
  playersList: {
    padding: 16,
  },
  playerItem: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  playerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  playerDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e9eef6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleIcon: {
    fontSize: 16,
    marginRight: 4,
  },
  roleText: {
    fontSize: 12,
    color: '#667eea',
    fontWeight: '600',
  },
  ratingBadge: {
    backgroundColor: '#fff3cd',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  ratingText: {
    fontSize: 12,
    color: '#856404',
    fontWeight: '600',
  },
  numberBadge: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  numberText: {
    fontSize: 12,
    color: '#2e7d32',
    fontWeight: '700',
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  editButton: {
    backgroundColor: '#ffc107',
    justifyContent: 'center',
    alignItems: 'center',
    width: 70,
    height: '100%',
    borderRadius: 8,
    marginRight: 8,
  },
  deleteButton: {
    backgroundColor: '#dc3545',
    justifyContent: 'center',
    alignItems: 'center',
    width: 70,
    height: '100%',
    borderRadius: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    width: '90%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f9f9f9',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#333',
  },
  roleSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  roleOption: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f9f9f9',
    alignItems: 'center',
  },
  roleOptionActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  roleOptionText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
  },
  roleOptionTextActive: {
    color: '#fff',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#ccc',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: 'bold',
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#667eea',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
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
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    alignItems: 'center',
  },
  confirmIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff5f5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  confirmTitle: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8, textAlign: 'center' },
  confirmMessage: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  confirmButtons: { flexDirection: 'row', gap: 12, width: '100%' },
  confirmBtnCancel: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#f0f0f0' },
  confirmBtnCancelText: { color: '#333', fontSize: 16, fontWeight: '600' },
  confirmBtnAction: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#667eea' },
  confirmBtnActionText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});


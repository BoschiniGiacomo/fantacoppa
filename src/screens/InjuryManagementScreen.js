import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { leagueService } from '../services/api';

function fullName(p) {
  return `${p?.first_name || ''} ${p?.last_name || ''}`.trim();
}

export default function InjuryManagementScreen({ route, navigation }) {
  const { leagueId } = route.params || {};
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [pickerType, setPickerType] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedInjured, setSelectedInjured] = useState(null);
  const [selectedReplacement, setSelectedReplacement] = useState(null);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newRole, setNewRole] = useState('D');
  const [newTeamId, setNewTeamId] = useState(null);
  const [newRating, setNewRating] = useState('');

  const showToast = (text, type = 'error') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 2500);
  };

  const loadPlayers = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await leagueService.getPlayersOptions(leagueId);
      const rows = Array.isArray(res?.data) ? res.data : [];
      setPlayers(rows);
    } catch (_) {
      showToast('Errore caricamento giocatori');
      setPlayers([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadTeams = async () => {
    try {
      const res = await leagueService.getTeams(leagueId);
      const rows = Array.isArray(res?.data) ? res.data : [];
      setTeams(rows);
      if (!newTeamId && rows.length > 0) {
        setNewTeamId(Number(rows[0].id));
      }
    } catch (_) {
      setTeams([]);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadPlayers();
      loadTeams();
    }, [leagueId])
  );

  const injuredPlayers = useMemo(
    () => players.filter((p) => Number(p?.is_injured || 0) === 1),
    [players]
  );

  const replacementMap = useMemo(() => {
    const out = {};
    players.forEach((p) => { out[Number(p.id)] = p; });
    return out;
  }, [players]);

  const selectableInjured = useMemo(
    () => players.slice().sort((a, b) => fullName(a).localeCompare(fullName(b))),
    [players]
  );

  const selectableReplacement = useMemo(
    () =>
      players
        .filter((p) => Number(p.id) !== Number(selectedInjured?.id || 0) && Number(p?.is_injured || 0) !== 1)
        .sort((a, b) => fullName(a).localeCompare(fullName(b))),
    [players, selectedInjured]
  );

  const filteredPickerRows = useMemo(() => {
    const list = pickerType === 'injured' ? selectableInjured : selectableReplacement;
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => `${fullName(p)} ${p?.role || ''} ${p?.team_name || ''}`.toLowerCase().includes(q));
  }, [pickerType, search, selectableInjured, selectableReplacement]);

  const onRefresh = async () => {
    try {
      setRefreshing(true);
      await loadPlayers(true);
    } finally {
      setRefreshing(false);
    }
  };

  const saveInjury = async () => {
    if (!selectedInjured || !selectedReplacement) {
      showToast('Seleziona infortunato e sostituto');
      return;
    }
    try {
      setSaving(true);
      const res = await leagueService.applyInjuryReplacement(
        leagueId,
        selectedInjured.id,
        selectedReplacement.id
      );
      const data = res?.data || {};
      showToast(
        `Applicato: +${Number(data.replacements_added || 0)} squadre, già presente in ${Number(data.already_had_replacement || 0)}`,
        'success'
      );
      setSelectedInjured(null);
      setSelectedReplacement(null);
      await loadPlayers(true);
    } catch (error) {
      showToast(error?.response?.data?.message || 'Errore salvataggio infortunio');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateReplacement = async () => {
    if (!newFirstName.trim() || !newLastName.trim()) {
      showToast('Inserisci nome e cognome');
      return;
    }
    if (!newTeamId) {
      showToast('Seleziona la squadra del nuovo giocatore');
      return;
    }
    const parsedRating = newRating === '' ? 0 : Number(newRating);
    if (!Number.isFinite(parsedRating) || parsedRating < 0) {
      showToast('Valore crediti non valido');
      return;
    }
    try {
      setSaving(true);
      await leagueService.addPlayer(leagueId, Number(newTeamId), {
        first_name: newFirstName.trim(),
        last_name: newLastName.trim(),
        role: newRole,
        rating: parsedRating,
      });
      await loadPlayers(true);
      const refreshed = await leagueService.getPlayersOptions(leagueId);
      const refreshedRows = Array.isArray(refreshed?.data) ? refreshed.data : [];
      const created = refreshedRows
        .filter((p) => Number(p?.team_id || 0) === Number(newTeamId))
        .find((p) => fullName(p).toLowerCase() === `${newFirstName.trim()} ${newLastName.trim()}`.toLowerCase() && String(p?.role || '') === newRole);
      if (created) setSelectedReplacement(created);
      setShowCreateModal(false);
      setNewFirstName('');
      setNewLastName('');
      setNewRole('D');
      setNewRating('');
      showToast('Nuovo sostituto creato', 'success');
    } catch (error) {
      showToast(error?.response?.data?.message || 'Errore creazione sostituto');
    } finally {
      setSaving(false);
    }
  };

  const clearInjury = async (player) => {
    try {
      setSaving(true);
      await leagueService.updatePlayer(leagueId, player.team_id, player.id, {
        is_injured: 0,
        injury_replacement_player_id: null,
      });
      showToast('Infortunio rimosso', 'success');
      await loadPlayers(true);
    } catch (error) {
      showToast(error?.response?.data?.message || 'Errore rimozione infortunio');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#667eea" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Gestione Infortuni</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#667eea" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Gestione Infortuni</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#667eea']} />}
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nuovo infortunio</Text>
          <Text style={styles.cardHint}>Seleziona giocatore infortunato e sostituto, poi salva o applica subito alle rose.</Text>

          <TouchableOpacity style={styles.selectBtn} onPress={() => { setPickerType('injured'); setSearch(''); }}>
            <Text style={styles.selectBtnLabel}>Giocatore infortunato</Text>
            <Text style={styles.selectBtnValue}>{selectedInjured ? `${fullName(selectedInjured)} (${selectedInjured.role})` : 'Seleziona'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.selectBtn} onPress={() => { setPickerType('replacement'); setSearch(''); }} disabled={!selectedInjured}>
            <Text style={styles.selectBtnLabel}>Sostituto</Text>
            <Text style={styles.selectBtnValue}>{selectedReplacement ? `${fullName(selectedReplacement)} (${selectedReplacement.role})` : 'Seleziona'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickCreateBtn, (!selectedInjured || saving) && styles.btnDisabled]}
            disabled={!selectedInjured || saving}
            onPress={() => setShowCreateModal(true)}
          >
            <Ionicons name="person-add-outline" size={16} color="#667eea" />
            <Text style={styles.quickCreateBtnText}>Crea nuovo sostituto</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.primaryBtn, (!selectedInjured || !selectedReplacement || saving) && styles.btnDisabled]}
            disabled={!selectedInjured || !selectedReplacement || saving}
            onPress={saveInjury}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Salva + Applica</Text>}
          </TouchableOpacity>
          <Text style={styles.actionsHint}>
            L'infortunio viene sempre salvato e applicato subito alle rose che avevano il giocatore infortunato.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Elenco infortunati ({injuredPlayers.length})</Text>
          {injuredPlayers.length === 0 ? (
            <Text style={styles.emptyText}>Nessun giocatore infortunato</Text>
          ) : (
            injuredPlayers.map((p) => {
              const replacement = replacementMap[Number(p.injury_replacement_player_id || 0)];
              return (
                <View key={p.id} style={styles.injuryRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.injuryName}>{fullName(p)} ({p.role})</Text>
                    <Text style={styles.injuryMeta}>
                      Sostituto: {replacement ? `${fullName(replacement)} (${replacement.role})` : 'non impostato'}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.removeBtn} onPress={() => clearInjury(p)} disabled={saving}>
                    <Ionicons name="close-circle-outline" size={18} color="#fff" />
                    <Text style={styles.removeBtnText}>Rimuovi</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <Modal visible={!!pickerType} transparent animationType="fade" onRequestClose={() => setPickerType(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{pickerType === 'injured' ? 'Seleziona infortunato' : 'Seleziona sostituto'}</Text>
              <TouchableOpacity onPress={() => setPickerType(null)}>
                <Ionicons name="close" size={22} color="#777" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="Cerca giocatore..."
              value={search}
              onChangeText={setSearch}
            />
            <ScrollView style={{ maxHeight: 360 }}>
              {filteredPickerRows.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.optionRow}
                  onPress={() => {
                    if (pickerType === 'injured') {
                      setSelectedInjured(p);
                      setSelectedReplacement(null);
                    } else {
                      setSelectedReplacement(p);
                    }
                    setPickerType(null);
                  }}
                >
                  <Text style={styles.optionName}>{fullName(p)} ({p.role})</Text>
                  <Text style={styles.optionTeam}>{p.team_name || '-'}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showCreateModal} transparent animationType="fade" onRequestClose={() => setShowCreateModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nuovo sostituto</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={22} color="#777" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="Nome"
              value={newFirstName}
              onChangeText={setNewFirstName}
            />
            <TextInput
              style={[styles.searchInput, { marginTop: 0 }]}
              placeholder="Cognome"
              value={newLastName}
              onChangeText={setNewLastName}
            />
            <TextInput
              style={[styles.searchInput, { marginTop: 0 }]}
              placeholder="Valore crediti (es. 7.5)"
              value={newRating}
              onChangeText={setNewRating}
              keyboardType="decimal-pad"
            />
            <Text style={styles.selectBtnLabel}>Ruolo</Text>
            <View style={styles.roleRow}>
              {['P', 'D', 'C', 'A'].map((r) => {
                const active = newRole === r;
                return (
                  <TouchableOpacity
                    key={r}
                    style={[styles.roleChip, active && styles.roleChipActive]}
                    onPress={() => setNewRole(r)}
                  >
                    <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>{r}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[styles.selectBtnLabel, { marginTop: 6 }]}>Squadra</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }}>
              {teams.map((t) => {
                const active = Number(newTeamId) === Number(t.id);
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.teamChip, active && styles.teamChipActive]}
                    onPress={() => setNewTeamId(Number(t.id))}
                  >
                    <Text style={[styles.teamChipText, active && styles.teamChipTextActive]}>{t.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.modalActionBtn} onPress={handleCreateReplacement} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Crea e usa come sostituto</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {toast && (
        <View style={[styles.toast, toast.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fc' },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eceff5',
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#2d3552' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
  card: {
    marginHorizontal: 14,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#edf0f7',
  },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#2d3552' },
  cardHint: { fontSize: 12, color: '#6f7695', marginTop: 6, marginBottom: 10 },
  selectBtn: {
    borderWidth: 1,
    borderColor: '#e3e7f2',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    backgroundColor: '#fafbff',
  },
  selectBtnLabel: { fontSize: 12, color: '#7a81a2' },
  selectBtnValue: { fontSize: 14, fontWeight: '700', color: '#2d3552', marginTop: 2 },
  quickCreateBtn: {
    borderWidth: 1,
    borderColor: '#d7def1',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
    backgroundColor: '#f8faff',
  },
  quickCreateBtnText: { color: '#667eea', fontWeight: '700' },
  primaryBtn: { flex: 1, borderRadius: 10, backgroundColor: '#667eea', alignItems: 'center', paddingVertical: 11 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  actionsHint: { marginTop: 8, fontSize: 12, color: '#7680a4', lineHeight: 17 },
  btnDisabled: { opacity: 0.5 },
  emptyText: { marginTop: 10, color: '#8d95b5' },
  injuryRow: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#ebeef8',
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  injuryName: { fontSize: 14, fontWeight: '700', color: '#2d3552' },
  injuryMeta: { marginTop: 3, fontSize: 12, color: '#6f7695' },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e65050',
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 8,
  },
  removeBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: '90%', backgroundColor: '#fff', borderRadius: 14, padding: 14 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#2d3552' },
  searchInput: {
    marginTop: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e4e8f3',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
  },
  optionRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f3f8' },
  optionName: { fontSize: 14, color: '#2d3552', fontWeight: '600' },
  optionTeam: { fontSize: 12, color: '#7a81a2', marginTop: 2 },
  roleRow: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 10 },
  roleChip: {
    minWidth: 42,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe1f1',
    backgroundColor: '#f8f9ff',
  },
  roleChipActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  roleChipText: { color: '#556080', fontWeight: '700' },
  roleChipTextActive: { color: '#fff' },
  teamChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe1f1',
    marginRight: 8,
    backgroundColor: '#f8f9ff',
  },
  teamChipActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  teamChipText: { color: '#556080', fontSize: 12, fontWeight: '600' },
  teamChipTextActive: { color: '#fff' },
  modalActionBtn: {
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  toastSuccess: { backgroundColor: '#1e8e5a' },
  toastError: { backgroundColor: '#dc4b4b' },
  toastText: { color: '#fff', fontWeight: '700' },
});

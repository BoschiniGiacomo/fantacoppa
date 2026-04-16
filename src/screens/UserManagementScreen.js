import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { leagueService, marketService } from '../services/api';
import { hideLeague, showDashboardError } from '../utils/dashboardEvents';

export default function UserManagementScreen({ route, navigation }) {
  const { leagueId, userRole } = route.params;
  const insets = useSafeAreaInsets();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [leaveInfo, setLeaveInfo] = useState(null);
  const [leaveInfoLoading, setLeaveInfoLoading] = useState(false);
  const [showNewAdminModal, setShowNewAdminModal] = useState(false);
  const [selectedNewAdminId, setSelectedNewAdminId] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null); // { title, message, confirmText, onConfirm, destructive }
  const [toastMsg, setToastMsg] = useState(null); // { text, type: 'success' | 'error' }
  const [changingRole, setChangingRole] = useState(null);
  const [savedRoleMemberId, setSavedRoleMemberId] = useState(null);
  const [removingUser, setRemovingUser] = useState(null);
  const [league, setLeague] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilters, setRoleFilters] = useState({
    user: true,
    pagellatore: true,
    admin: true,
  });
  const [sortBy, setSortBy] = useState('nome'); // 'nome', 'squadra', 'allenatore'
  const [activeTab, setActiveTab] = useState('members'); // 'members', 'requests'
  const [requireJoinApproval, setRequireJoinApproval] = useState(false);
  const [joinRequests, setJoinRequests] = useState([]);
  const [loadingJoinRequests, setLoadingJoinRequests] = useState(false);

  const isAdmin = userRole === 'admin';

  // Filtra e ordina i membri
  const filteredMembers = useMemo(() => {
    let result = [...members];

    // Applica filtro di ricerca
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter((member) => {
        const username = (member.username || '').toLowerCase();
        const teamName = (member.team_name || '').toLowerCase();
        const coachName = (member.coach_name || '').toLowerCase();
        return username.includes(query) || teamName.includes(query) || coachName.includes(query);
      });
    }

    // Applica filtri ruolo
    result = result.filter((member) => {
      const role = member.role || 'user';
      return roleFilters[role] === true;
    });

    // Applica ordinamento
    result.sort((a, b) => {
      let aValue = '';
      let bValue = '';
      
      switch (sortBy) {
        case 'nome':
          aValue = (a.username || '').toLowerCase();
          bValue = (b.username || '').toLowerCase();
          break;
        case 'squadra':
          aValue = (a.team_name || '').toLowerCase();
          bValue = (b.team_name || '').toLowerCase();
          break;
        case 'allenatore':
          aValue = (a.coach_name || '').toLowerCase();
          bValue = (b.coach_name || '').toLowerCase();
          break;
        default:
          return 0;
      }
      
      if (aValue < bValue) return -1;
      if (aValue > bValue) return 1;
      return 0;
    });

    return result;
  }, [members, searchQuery, roleFilters, sortBy]);

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useEffect(() => {
    loadMembers();
    loadLeaveInfo();
    loadLeague();
    if (isAdmin) {
      loadApprovalSetting();
    }
  }, [leagueId]);

  const loadLeague = async () => {
    try {
      const res = await leagueService.getById(leagueId);
      const leagueData = Array.isArray(res.data) ? res.data[0] : res.data;
      setLeague(leagueData);
    } catch (error) {
      console.error('Error loading league:', error);
    }
  };

  const loadApprovalSetting = async () => {
    try {
      const res = await marketService.getSettings(leagueId);
      const approvalEnabled = res.data.require_approval === 1 || res.data.require_approval === '1';
      setRequireJoinApproval(approvalEnabled);
      if (approvalEnabled) {
        loadJoinRequests();
      }
    } catch (error) {
      console.error('Error loading approval setting:', error);
    }
  };

  const loadJoinRequests = async () => {
    try {
      setLoadingJoinRequests(true);
      const res = await leagueService.getJoinRequests(leagueId);
      setJoinRequests(res.data.requests || []);
    } catch (error) {
      console.error('Error loading join requests:', error);
    } finally {
      setLoadingJoinRequests(false);
    }
  };

  const handleApproveRequest = async (requestId) => {
    try {
      await leagueService.approveJoinRequest(leagueId, requestId);
      setJoinRequests(prev => prev.filter(r => r.id !== requestId));
      showToast('Richiesta approvata', 'success');
      // Ricarica membri dopo approvazione
      loadMembers();
    } catch (error) {
      console.error('Error approving request:', error);
      showToast('Errore nell\'approvazione della richiesta');
    }
  };

  const handleRejectRequest = async (requestId) => {
    try {
      await leagueService.rejectJoinRequest(leagueId, requestId);
      setJoinRequests(prev => prev.filter(r => r.id !== requestId));
      showToast('Richiesta rifiutata', 'success');
    } catch (error) {
      console.error('Error rejecting request:', error);
      showToast('Errore nel rifiuto della richiesta');
    }
  };

  const loadMembers = async () => {
    try {
      setLoading(true);
      const res = await leagueService.getMembers(leagueId);
      // Assicurati che members sia sempre un array
      let membersData = res.data;
      if (!Array.isArray(membersData)) {
        console.warn('Members data is not an array:', typeof membersData, membersData);
        if (membersData && typeof membersData === 'object' && !membersData.message) {
          // Se è un oggetto (ma non un errore), prova a convertirlo
          membersData = Object.values(membersData);
        } else {
          // Se è un errore o altro, usa array vuoto
          membersData = [];
        }
      }

      // Se non è admin, mostra solo l'utente corrente
      if (!isAdmin) {
        membersData = membersData.filter((m) => m && m.is_current_user);
      }

      setMembers(membersData);
    } catch (error) {
      console.error('Error loading members:', error);
      showToast('Impossibile caricare i membri della lega');
      setMembers([]); // Imposta array vuoto in caso di errore
    } finally {
      setLoading(false);
    }
  };

  const loadLeaveInfo = async () => {
    try {
      setLeaveInfoLoading(true);
      const res = await leagueService.leaveLeagueInfo(leagueId);
      setLeaveInfo(res.data);
    } catch (error) {
      console.error('Error loading leave info:', error);
    } finally {
      setLeaveInfoLoading(false);
    }
  };

  const handleChangeRole = async (memberId, newRole) => {
    try {
      setChangingRole(memberId);
      await leagueService.changeRole(leagueId, memberId, newRole);
      setSavedRoleMemberId(memberId);
      setTimeout(() => {
        setSavedRoleMemberId(null);
      }, 2000);
      loadMembers();
    } catch (error) {
      // Estrai solo il messaggio di errore dall'API, senza mostrare i dettagli tecnici di AxiosError
      let errorMessage = 'Errore durante il cambio ruolo';
      
      if (error.response?.data) {
        // L'API restituisce gli errori in diversi formati
        if (error.response.data.error) {
          errorMessage = error.response.data.error;
        } else if (error.response.data.message) {
          errorMessage = error.response.data.message;
        } else if (typeof error.response.data === 'string') {
          errorMessage = error.response.data;
        }
      }
      
      // Non mostrare mai i dettagli tecnici di AxiosError
      showToast(errorMessage);
    } finally {
      setChangingRole(null);
    }
  };

  const handleRemoveUser = (user) => {
    setConfirmModal({
      title: 'Rimuovi utente',
      message: `Sei sicuro di voler rimuovere "${user.username}" dalla lega? Verranno eliminati anche i suoi giocatori acquistati e il budget associato.`,
      confirmText: 'Rimuovi',
      destructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          setRemovingUser(user.user_id);
          await leagueService.removeUser(leagueId, user.user_id);
          showToast('Utente rimosso dalla lega con tutti i dati.', 'success');
          loadMembers();
        } catch (error) {
          console.error('Error removing user:', error);
          const errorMessage = error.response?.data?.error || error.message || 'Errore durante la rimozione';
          showToast(errorMessage);
        } finally {
          setRemovingUser(null);
        }
      },
    });
  };

  const handleLeaveLeague = () => {
    if (!leaveInfo) {
      showToast('Impossibile ottenere le informazioni per lasciare la lega');
      return;
    }

    if (leaveInfo.only_user) {
      // Ultimo utente: elimina tutta la lega
      setConfirmModal({
        title: 'Eliminazione lega',
        message: 'Sei l\'ultimo utente della lega. Abbandonando, verrà eliminata completamente insieme a tutti i suoi dati. Questa azione è irreversibile.',
        confirmText: 'Elimina lega',
        destructive: true,
        onConfirm: () => confirmLeaveLeague(null),
      });
    } else if (leaveInfo.only_admin) {
      // Ultimo admin: chiedi di nominare un nuovo admin
      if (leaveInfo.other_members && leaveInfo.other_members.length > 0) {
        setShowNewAdminModal(true);
      } else {
        showToast('Non ci sono altri membri a cui assegnare il ruolo di admin');
      }
    } else {
      // Utente normale: conferma
      setConfirmModal({
        title: 'Abbandona lega',
        message: 'Sei sicuro di voler abbandonare la lega? Tutti i tuoi dati relativi a questa lega verranno eliminati.',
        confirmText: 'Abbandona',
        destructive: true,
        onConfirm: () => confirmLeaveLeague(null),
      });
    }
  };

  const confirmLeaveLeague = async (newAdminId) => {
    setConfirmModal(null);
    const successMsg = newAdminId
      ? 'Hai lasciato la lega e nominato un nuovo admin.'
      : 'Hai lasciato la lega con successo.';
    // Nascondi la lega PRIMA di navigare (sincrono, variabile globale)
    hideLeague(leagueId, successMsg);
    // Naviga subito alla home
    navigation.navigate('MainTabs', { screen: 'Dashboard' });
    // Chiama l'API in background
    try {
      await leagueService.leaveLeague(leagueId, newAdminId);
    } catch (error) {
      console.error('Error leaving league:', error);
      showDashboardError(error.response?.data?.error || 'Errore durante l\'abbandono della lega');
    }
  };

  const handleSelectNewAdmin = () => {
    if (!selectedNewAdminId) {
      showToast('Seleziona un nuovo admin');
      return;
    }
    setShowNewAdminModal(false);
    setConfirmModal({
      title: 'Abbandona lega',
      message: 'Sei sicuro di voler abbandonare la lega? Tutti i tuoi dati relativi a questa lega verranno eliminati.',
      confirmText: 'Abbandona',
      destructive: true,
      onConfirm: () => confirmLeaveLeague(selectedNewAdminId),
    });
  };

  const getRoleBadge = (role) => {
    switch (role) {
      case 'admin':
        return { label: 'Admin', color: '#667eea', icon: 'star' };
      case 'pagellatore':
        return { label: 'Pagellatore', color: '#f59e0b', icon: 'pencil' };
      default:
        return { label: 'Utente', color: '#10b981', icon: 'person' };
    }
  };

  const renderMemberItem = (member) => {
    const roleBadge = getRoleBadge(member.role);
    const isCurrentUser = Number(member?.is_current_user) === 1 || member?.is_current_user === true;
    const hasTeamName = String(member?.team_name || '').trim().length > 0;

    return (
      <View key={member.id} style={styles.memberItem}>
        <View style={styles.memberInfo}>
          <View style={styles.memberHeaderRow}>
            <Text style={styles.memberUsername}>{member.username}</Text>
            {isAdmin && !isCurrentUser && (
              <TouchableOpacity
                style={styles.removeButtonCompact}
                onPress={() => handleRemoveUser(member)}
                disabled={removingUser === member.user_id}
              >
                {removingUser === member.user_id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="person-remove" size={16} color="#fff" />
                )}
              </TouchableOpacity>
            )}
            {isCurrentUser && (
              <TouchableOpacity
                style={styles.leaveButtonCompact}
                onPress={handleLeaveLeague}
                disabled={leaveInfoLoading}
              >
                {leaveInfoLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="exit-outline" size={16} color="#fff" />
                )}
              </TouchableOpacity>
            )}
          </View>
          {hasTeamName && (
            <Text style={styles.memberTeam}>
              {member.team_name} - {member.coach_name}
            </Text>
          )}
        </View>
        {isAdmin && (
          <View style={styles.memberActions}>
            <View style={styles.roleSelector}>
              <TouchableOpacity
                style={[
                  styles.roleOption,
                  member.role === 'user' && [styles.roleOptionActive, { backgroundColor: getRoleBadge('user').color }],
                ]}
                onPress={() => handleChangeRole(member.id, 'user')}
                disabled={changingRole === member.id}
              >
                {member.role === 'user' && (
                  <Ionicons name={getRoleBadge('user').icon} size={12} color="#fff" style={{ marginRight: 4 }} />
                )}
                <Text
                  style={[
                    styles.roleOptionText,
                    member.role === 'user' && styles.roleOptionTextActive,
                  ]}
                >
                  Utente
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.roleOption,
                  member.role === 'pagellatore' && [styles.roleOptionActive, { backgroundColor: getRoleBadge('pagellatore').color }],
                ]}
                onPress={() => handleChangeRole(member.id, 'pagellatore')}
                disabled={changingRole === member.id}
              >
                {member.role === 'pagellatore' && (
                  <Ionicons name={getRoleBadge('pagellatore').icon} size={12} color="#fff" style={{ marginRight: 4 }} />
                )}
                <Text
                  style={[
                    styles.roleOptionText,
                    member.role === 'pagellatore' && styles.roleOptionTextActive,
                  ]}
                >
                  Pagellatore
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.roleOption,
                  member.role === 'admin' && [styles.roleOptionActive, { backgroundColor: getRoleBadge('admin').color }],
                ]}
                onPress={() => handleChangeRole(member.id, 'admin')}
                disabled={changingRole === member.id}
              >
                {member.role === 'admin' && (
                  <Ionicons name={getRoleBadge('admin').icon} size={12} color="#fff" style={{ marginRight: 4 }} />
                )}
                <Text
                  style={[
                    styles.roleOptionText,
                    member.role === 'admin' && styles.roleOptionTextActive,
                  ]}
                >
                  Admin
                </Text>
              </TouchableOpacity>
            </View>
            {savedRoleMemberId === member.id && (
              <View style={styles.roleSavedIndicator}>
                <Ionicons name="checkmark-circle" size={20} color="#198754" />
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.title}>Gestione Utenti</Text>
        <View style={styles.backButton} />
      </View>

      {/* Tab Utenti / Richieste */}
      {isAdmin && requireJoinApproval && (
        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'members' && styles.tabItemActive]}
            onPress={() => setActiveTab('members')}
          >
            <Ionicons name="people-outline" size={16} color={activeTab === 'members' ? '#fff' : '#666'} style={{ marginRight: 5 }} />
            <Text style={[styles.tabItemText, activeTab === 'members' && styles.tabItemTextActive]}>
              Utenti
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'requests' && styles.tabItemActive]}
            onPress={() => { setActiveTab('requests'); loadJoinRequests(); }}
          >
            <Ionicons name="hourglass-outline" size={16} color={activeTab === 'requests' ? '#fff' : '#666'} style={{ marginRight: 5 }} />
            <Text style={[styles.tabItemText, activeTab === 'requests' && styles.tabItemTextActive]}>
              Richieste
            </Text>
            {joinRequests.length > 0 && (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{joinRequests.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      )}

      {activeTab === 'members' && (
      <>
      {/* Barra di ricerca */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cerca per nome, squadra o allenatore..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
            <Ionicons name="close-circle" size={20} color="#666" />
          </TouchableOpacity>
        )}
      </View>

      {/* Filtri ruolo e ordinamento */}
      <View style={styles.filtersContainer}>
        {/* Filtri ruolo */}
        <View style={styles.roleFiltersContainer}>
          <Ionicons name="filter" size={14} color="#666" style={{ marginRight: 4 }} />
          <Text style={styles.filterLabel}>Ruoli:</Text>
          <TouchableOpacity
            style={[styles.roleFilterChip, roleFilters.user && { backgroundColor: getRoleBadge('user').color }]}
            onPress={() => setRoleFilters({...roleFilters, user: !roleFilters.user})}
          >
            <Ionicons 
              name={getRoleBadge('user').icon} 
              size={12} 
              color={roleFilters.user ? '#fff' : getRoleBadge('user').color} 
              style={{ marginRight: 3 }}
            />
            <Text style={[styles.roleFilterText, roleFilters.user && styles.roleFilterTextActive]}>
              Utente
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.roleFilterChip, { backgroundColor: roleFilters.pagellatore ? getRoleBadge('pagellatore').color : '#f0f0f0' }]}
            onPress={() => setRoleFilters({...roleFilters, pagellatore: !roleFilters.pagellatore})}
          >
            <Ionicons 
              name={getRoleBadge('pagellatore').icon} 
              size={12} 
              color={roleFilters.pagellatore ? '#fff' : getRoleBadge('pagellatore').color} 
              style={{ marginRight: 3 }}
            />
            <Text style={[styles.roleFilterText, roleFilters.pagellatore && styles.roleFilterTextActive]}>
              Pagellatore
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.roleFilterChip, { backgroundColor: roleFilters.admin ? getRoleBadge('admin').color : '#f0f0f0' }]}
            onPress={() => setRoleFilters({...roleFilters, admin: !roleFilters.admin})}
          >
            <Ionicons 
              name={getRoleBadge('admin').icon} 
              size={12} 
              color={roleFilters.admin ? '#fff' : getRoleBadge('admin').color} 
              style={{ marginRight: 3 }}
            />
            <Text style={[styles.roleFilterText, roleFilters.admin && styles.roleFilterTextActive]}>
              Admin
            </Text>
          </TouchableOpacity>
        </View>

        {/* Ordinamento */}
        <View style={styles.sortContainer}>
          <Ionicons name="swap-vertical" size={14} color="#666" style={{ marginRight: 4 }} />
          <Text style={styles.filterLabel}>Ordina:</Text>
          <View style={styles.sortOptions}>
            <TouchableOpacity
              style={[styles.sortOption, sortBy === 'nome' && styles.sortOptionActive]}
              onPress={() => setSortBy('nome')}
            >
              <Text style={[styles.sortOptionText, sortBy === 'nome' && styles.sortOptionTextActive]}>
                Nome utente
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortOption, sortBy === 'squadra' && styles.sortOptionActive]}
              onPress={() => setSortBy('squadra')}
            >
              <Text style={[styles.sortOptionText, sortBy === 'squadra' && styles.sortOptionTextActive]}>
                Squadra
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortOption, sortBy === 'allenatore' && styles.sortOptionActive]}
              onPress={() => setSortBy('allenatore')}
            >
              <Text style={[styles.sortOptionText, sortBy === 'allenatore' && styles.sortOptionTextActive]}>
                Allenatore
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      ) : (
        <ScrollView 
          style={styles.content} 
          contentContainerStyle={[styles.contentContainer, { paddingBottom: insets.bottom + 20 }]}
        >
          {!filteredMembers || filteredMembers.length === 0 ? (
            <View style={styles.centerContainer}>
              <Text style={styles.emptyText}>
                {searchQuery ? 'Nessun utente trovato' : 'Nessun utente nella lega'}
              </Text>
            </View>
          ) : (
            Array.isArray(filteredMembers) && filteredMembers.map((member) => (
              <View key={member.id || member.user_id}>
                {renderMemberItem(member)}
              </View>
            ))
          )}
        </ScrollView>
      )}
      </>
      )}

      {/* Tab Richieste pendenti */}
      {activeTab === 'requests' && (
        <ScrollView
          style={styles.content}
          contentContainerStyle={[styles.contentContainer, { paddingBottom: insets.bottom + 20 }]}
        >
          {loadingJoinRequests ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#667eea" />
            </View>
          ) : joinRequests.length === 0 ? (
            <View style={styles.centerContainer}>
              <Ionicons name="checkmark-circle-outline" size={48} color="#ccc" />
              <Text style={[styles.emptyText, { marginTop: 12 }]}>Nessuna richiesta in attesa</Text>
            </View>
          ) : (
            joinRequests.map((req) => (
              <View key={req.id} style={styles.requestCard}>
                <View style={styles.requestInfo}>
                  <View style={styles.requestAvatarWrap}>
                    <Ionicons name="person-circle-outline" size={40} color="#667eea" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.requestUsername}>{req.username}</Text>
                    <Text style={styles.requestDate}>
                      {req.requested_at ? new Date(req.requested_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                    </Text>
                  </View>
                </View>
                <View style={styles.requestActions}>
                  <TouchableOpacity
                    style={styles.requestApproveBtn}
                    onPress={() => handleApproveRequest(req.id)}
                  >
                    <Ionicons name="checkmark" size={16} color="#fff" />
                    <Text style={styles.requestBtnText}>Approva</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.requestRejectBtn}
                    onPress={() => handleRejectRequest(req.id)}
                  >
                    <Ionicons name="close" size={16} color="#fff" />
                    <Text style={styles.requestBtnText}>Rifiuta</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* Modal per selezionare nuovo admin */}
      <Modal
        visible={showNewAdminModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowNewAdminModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Seleziona nuovo admin</Text>
            <Text style={styles.modalSubtitle}>
              Devi nominare un nuovo admin prima di poter abbandonare la lega.
            </Text>
            <ScrollView style={styles.modalList}>
              {leaveInfo?.other_members?.map((member) => (
                <TouchableOpacity
                  key={member.user_id}
                  style={[
                    styles.modalItem,
                    selectedNewAdminId === member.user_id && styles.modalItemSelected,
                  ]}
                  onPress={() => setSelectedNewAdminId(member.user_id)}
                >
                  <Text style={styles.modalItemText}>{member.username}</Text>
                  {selectedNewAdminId === member.user_id && (
                    <Ionicons name="checkmark-circle" size={24} color="#667eea" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => {
                  setShowNewAdminModal(false);
                  setSelectedNewAdminId(null);
                }}
              >
                <Text style={styles.modalButtonTextCancel}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonConfirm]}
                onPress={handleSelectNewAdmin}
              >
                <Text style={styles.modalButtonTextConfirm}>Conferma</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal di conferma personalizzato */}
      <Modal
        visible={!!confirmModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setConfirmModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalContent}>
            <View style={styles.confirmIconWrap}>
              <Ionicons
                name={confirmModal?.destructive ? 'warning' : 'information-circle'}
                size={40}
                color={confirmModal?.destructive ? '#e53935' : '#667eea'}
              />
            </View>
            <Text style={styles.confirmTitle}>{confirmModal?.title}</Text>
            <Text style={styles.confirmMessage}>{confirmModal?.message}</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => setConfirmModal(null)}
              >
                <Text style={styles.modalButtonTextCancel}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, confirmModal?.destructive ? styles.confirmButtonDestructive : styles.modalButtonConfirm]}
                onPress={() => confirmModal?.onConfirm?.()}
              >
                <Text style={styles.modalButtonTextConfirm}>{confirmModal?.confirmText || 'Conferma'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Toast feedback */}
      {toastMsg && (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons
            name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'}
            size={18}
            color="#fff"
          />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
    textAlign: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    padding: 0,
  },
  clearButton: {
    marginLeft: 8,
    padding: 4,
  },
  filtersContainer: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  roleFiltersContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: 6,
    marginBottom: 10,
  },
  filterLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
    marginRight: 2,
  },
  roleFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  roleFilterText: {
    fontSize: 11,
    color: '#666',
    fontWeight: '500',
  },
  roleFilterTextActive: {
    color: '#fff',
  },
  sortContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  sortOptions: {
    flexDirection: 'row',
    gap: 4,
  },
  sortOption: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  sortOptionActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  sortOptionText: {
    fontSize: 11,
    color: '#666',
    fontWeight: '500',
  },
  sortOptionTextActive: {
    color: '#fff',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
  },
  memberItem: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  memberInfo: {
    marginBottom: 8,
  },
  memberHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  memberUsername: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
  },
  memberTeam: {
    fontSize: 13,
    color: '#666',
  },
  memberActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  roleSelector: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  roleOptionActive: {
    // backgroundColor viene impostato dinamicamente in base al ruolo
  },
  roleOptionText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  roleOptionTextActive: {
    color: '#fff',
  },
  roleSavedIndicator: {
    marginLeft: 4,
  },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ef4444',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  removeButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  removeButtonCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef4444',
    padding: 6,
    borderRadius: 6,
    marginLeft: 8,
  },
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ef4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  leaveButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  leaveButtonCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef4444',
    padding: 6,
    borderRadius: 6,
    marginLeft: 8,
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
    padding: 20,
    width: '90%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  modalList: {
    maxHeight: 300,
  },
  modalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    marginBottom: 8,
  },
  modalItemSelected: {
    backgroundColor: '#e0e7ff',
    borderWidth: 2,
    borderColor: '#667eea',
  },
  modalItemText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#f0f0f0',
  },
  modalButtonConfirm: {
    backgroundColor: '#667eea',
  },
  modalButtonTextCancel: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextConfirm: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Modal conferma personalizzato
  confirmModalContent: {
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
  confirmTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmMessage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 4,
  },
  confirmButtonDestructive: {
    backgroundColor: '#e53935',
  },
  // Toast
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
  // Tab bar
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    gap: 8,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  tabItemActive: {
    backgroundColor: '#667eea',
  },
  tabItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  tabItemTextActive: {
    color: '#fff',
  },
  tabBadge: {
    backgroundColor: '#e53935',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
    paddingHorizontal: 5,
  },
  tabBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  // Request cards
  requestCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  requestInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  requestAvatarWrap: {
    marginRight: 10,
  },
  requestUsername: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  requestDate: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 10,
  },
  requestApproveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#28a745',
    borderRadius: 8,
    paddingVertical: 8,
    gap: 5,
  },
  requestRejectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dc3545',
    borderRadius: 8,
    paddingVertical: 8,
    gap: 5,
  },
  requestBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});


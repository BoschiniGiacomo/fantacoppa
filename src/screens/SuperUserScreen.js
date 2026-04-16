import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  TextInput,
  Modal,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { superuserService } from '../services/api';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SuperUserScreen() {
  const { user } = useAuth();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState('users'); // 'users', 'leagues', 'officials', 'clusters'
  const [users, setUsers] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [officialGroups, setOfficialGroups] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingLeagues, setLoadingLeagues] = useState(false);
  const [loadingOfficialGroups, setLoadingOfficialGroups] = useState(false);
  const [refreshingUsers, setRefreshingUsers] = useState(false);
  const [refreshingLeagues, setRefreshingLeagues] = useState(false);
  const [refreshingOfficialGroups, setRefreshingOfficialGroups] = useState(false);
  const [sortColumn, setSortColumn] = useState('is_online'); // 'username', 'last_login', 'is_online', 'is_superuser'
  const [sortDirection, setSortDirection] = useState('desc'); // 'asc', 'desc' - 'desc' per mostrare prima gli online
  const [searchText, setSearchText] = useState('');
  const [filterOfficialOnly, setFilterOfficialOnly] = useState(false);
  const [showOfficialGroupModal, setShowOfficialGroupModal] = useState(false);
  const [selectedLeagueForOfficial, setSelectedLeagueForOfficial] = useState(null);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [selectedGroupForEdit, setSelectedGroupForEdit] = useState(null);
  const [showGroupDetailModal, setShowGroupDetailModal] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  
  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };
  
  // Player cluster management
  const [clusters, setClusters] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showClusterModal, setShowClusterModal] = useState(false);
  const [clusterFilterStatus, setClusterFilterStatus] = useState(null); // null, 'pending', 'approved', 'rejected'
  const [showCreateClusterModal, setShowCreateClusterModal] = useState(false);
  const [searchPlayersQuery, setSearchPlayersQuery] = useState('');
  const [searchedPlayers, setSearchedPlayers] = useState([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [selectedPlayersForCluster, setSelectedPlayersForCluster] = useState([]);
  
  // Approved clusters grouped by player
  const [approvedClustersByPlayer, setApprovedClustersByPlayer] = useState([]);
  const [loadingApprovedClusters, setLoadingApprovedClusters] = useState(false);
  const [refreshingApprovedClusters, setRefreshingApprovedClusters] = useState(false);
  const [showPlayerClusterDetail, setShowPlayerClusterDetail] = useState(false);
  const [selectedPlayerCluster, setSelectedPlayerCluster] = useState(null);
  const [availablePlayersToAdd, setAvailablePlayersToAdd] = useState([]);
  const [loadingAvailablePlayers, setLoadingAvailablePlayers] = useState(false);
  const [showAddPlayers, setShowAddPlayers] = useState(false);
  const [hasAvailablePlayers, setHasAvailablePlayers] = useState(false);
  const [officialGroupsDisabled, setOfficialGroupsDisabled] = useState(false);
  
  const isSuperuser = !!(user?.is_superuser === true || user?.is_superuser === 1 || user?.is_superuser === '1');
  const isFeatureDisabledError = (error) => Number(error?.response?.status) === 410;
  
  // Verifica permessi
  useEffect(() => {
    if (!isSuperuser) {
      showToast('Non hai i permessi per accedere a questa sezione');
      setTimeout(() => navigation.goBack(), 2500);
    }
  }, [isSuperuser, navigation]);
  
  // Carica utenti
  const loadUsers = async () => {
    if (!isSuperuser) return;
    try {
      setLoadingUsers(true);
      const response = await superuserService.getUsers();
      setUsers(response.data || []);
    } catch (error) {
      console.error('Error loading users:', error);
      showToast('Impossibile caricare gli utenti');
    } finally {
      setLoadingUsers(false);
      setRefreshingUsers(false);
    }
  };
  
  // Carica leghe
  const loadLeagues = async () => {
    if (!isSuperuser) return;
    try {
      setLoadingLeagues(true);
      const response = await superuserService.getLeagues();
      const raw = response?.data;
      setLeagues(Array.isArray(raw) ? raw : []);
    } catch (error) {
      console.error('Error loading leagues:', error);
      showToast('Impossibile caricare le leghe');
    } finally {
      setLoadingLeagues(false);
      setRefreshingLeagues(false);
    }
  };
  
  // Carica gruppi ufficiali
  const loadOfficialGroups = async () => {
    if (!isSuperuser) return;
    try {
      setLoadingOfficialGroups(true);
      const response = await superuserService.getOfficialGroups();
      setOfficialGroups(response.data || []);
      setOfficialGroupsDisabled(false);
    } catch (error) {
      if (isFeatureDisabledError(error)) {
        setOfficialGroups([]);
        setOfficialGroupsDisabled(true);
        return;
      }
      console.error('Error loading official groups:', error);
      showToast('Impossibile caricare i gruppi ufficiali');
    } finally {
      setLoadingOfficialGroups(false);
      setRefreshingOfficialGroups(false);
    }
  };
  
  // Carica suggerimenti cluster per un gruppo
  const loadClusterSuggestions = async (groupId) => {
    if (!isSuperuser || !groupId) return;
    try {
      setLoadingSuggestions(true);
      const response = await superuserService.getPlayerClusterSuggestions(groupId);
      setSuggestions(response.data.suggestions || []);
    } catch (error) {
      console.error('Error loading cluster suggestions:', error);
      showToast('Impossibile caricare i suggerimenti');
    } finally {
      setLoadingSuggestions(false);
    }
  };
  
  // Carica cluster per un gruppo
  const loadClusters = async (groupId, status = null) => {
    if (!isSuperuser || !groupId) return;
    try {
      setLoadingClusters(true);
      const response = await superuserService.getPlayerClusters(groupId, status);
      setClusters(response.data.clusters || []);
    } catch (error) {
      console.error('Error loading clusters:', error);
      showToast('Impossibile caricare i cluster');
    } finally {
      setLoadingClusters(false);
    }
  };
  
  // Carica tutti i cluster approvati raggruppati per giocatore
  const loadApprovedClustersByPlayer = async () => {
    if (!isSuperuser) return;
    try {
      setLoadingApprovedClusters(true);
      
      // Carica tutti i gruppi ufficiali
      const groupsResponse = await superuserService.getOfficialGroups();
      const groups = groupsResponse.data || [];
      
      // Carica i cluster approvati per ogni gruppo
      const allClusters = [];
      for (const group of groups) {
        try {
          const clustersResponse = await superuserService.getPlayerClusters(group.id, 'approved');
          const clusters = clustersResponse.data?.clusters || [];
          // Aggiungi informazioni sul gruppo a ogni cluster
          clusters.forEach(cluster => {
            cluster.group_name = group.name;
            cluster.group_id = group.id;
          });
          allClusters.push(...clusters);
        } catch (error) {
          console.error(`Error loading clusters for group ${group.id}:`, error);
        }
      }
      
      // Raggruppa per giocatore (nome)
      const playersMap = new Map();
      
      for (const cluster of allClusters) {
        // Per ogni cluster, ottieni i giocatori
        // I cluster hanno una struttura con players array
        if (cluster.players && Array.isArray(cluster.players)) {
          cluster.players.forEach(player => {
            const playerName = `${player.first_name} ${player.last_name}`;
            
            if (!playersMap.has(playerName)) {
              playersMap.set(playerName, {
                name: playerName,
                leagues: [],
                clusters: []
              });
            }
            
            const playerData = playersMap.get(playerName);
            // Aggiungi lega se non esiste già
            if (!playerData.leagues.some(l => l.id === player.league_id)) {
              playerData.leagues.push({
                id: player.league_id,
                name: player.league_name,
                group_name: cluster.group_name,
                group_id: cluster.group_id
              });
            }
            
            // Aggiungi cluster se non esiste già
            if (!playerData.clusters.some(c => c.id === cluster.id)) {
              playerData.clusters.push({
                id: cluster.id,
                group_name: cluster.group_name,
                created_at: cluster.created_at
              });
            }
          });
        }
      }
      
      // Converti Map in array e ordina per nome
      const playersArray = Array.from(playersMap.values()).sort((a, b) => 
        a.name.localeCompare(b.name)
      );
      
      setApprovedClustersByPlayer(playersArray);
    } catch (error) {
      if (isFeatureDisabledError(error)) {
        setApprovedClustersByPlayer([]);
        setOfficialGroupsDisabled(true);
        return;
      }
      console.error('Error loading approved clusters:', error);
      showToast('Impossibile caricare i cluster approvati');
    } finally {
      setLoadingApprovedClusters(false);
      setRefreshingApprovedClusters(false);
    }
  };
  
  // Crea cluster da suggerimento
  const handleCreateClusterFromSuggestion = async (player1, player2, groupId) => {
    try {
      await superuserService.createPlayerCluster({
        official_group_id: groupId,
        player_ids: [player1.id, player2.id],
        suggested_by_system: true,
        status: 'pending'
      });
      showToast('Cluster creato e in attesa di approvazione', 'success');
      await loadClusters(groupId, clusterFilterStatus);
      await loadClusterSuggestions(groupId);
    } catch (error) {
      console.error('Error creating cluster:', error);
      showToast(error.response?.data?.message || 'Errore durante la creazione del cluster');
    }
  };
  
  // Approva cluster
  const handleApproveCluster = async (clusterId, groupId) => {
    try {
      await superuserService.approvePlayerCluster(clusterId);
      showToast('Cluster approvato', 'success');
      await loadClusters(groupId, clusterFilterStatus);
    } catch (error) {
      console.error('Error approving cluster:', error);
      showToast(error.response?.data?.message || 'Errore durante l\'approvazione');
    }
  };
  
  // Rifiuta cluster
  const handleRejectCluster = async (clusterId, groupId) => {
    try {
      await superuserService.rejectPlayerCluster(clusterId);
      showToast('Cluster rifiutato', 'success');
      await loadClusters(groupId, clusterFilterStatus);
    } catch (error) {
      console.error('Error rejecting cluster:', error);
      showToast(error.response?.data?.message || 'Errore durante il rifiuto');
    }
  };
  
  // Cerca giocatori
  const searchPlayers = async (groupId, query, leagueId = null) => {
    if (!isSuperuser || !groupId) return;
    try {
      setLoadingPlayers(true);
      const response = await superuserService.searchPlayers(groupId, query, leagueId);
      setSearchedPlayers(response.data.players || []);
    } catch (error) {
      console.error('Error searching players:', error);
      showToast('Impossibile cercare i giocatori');
    } finally {
      setLoadingPlayers(false);
    }
  };
  
  // Verifica se ci sono giocatori disponibili da aggiungere
  const checkAvailablePlayers = async (playerName, groupId, existingLeagueIds) => {
    if (!isSuperuser || !groupId || !playerName) {
      setHasAvailablePlayers(false);
      return;
    }
    try {
      // Estrai nome e cognome dal nome completo
      const nameParts = playerName.trim().split(' ');
      if (nameParts.length < 2) {
        setHasAvailablePlayers(false);
        return;
      }
      
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ');
      
      // Cerca giocatori con lo stesso nome nelle leghe del gruppo
      const response = await superuserService.searchPlayers(groupId, `${firstName} ${lastName}`);
      const allPlayers = response.data.players || [];
      
      // Filtra solo quelli che non sono già nelle leghe del giocatore cluster
      const availablePlayers = allPlayers.filter(player => {
        // Costruisci il nome completo del giocatore
        const playerFullName = `${player.first_name || ''} ${player.last_name || ''}`.trim();
        // Verifica che il nome corrisponda esattamente
        if (playerFullName.toLowerCase() !== playerName.toLowerCase()) {
          return false;
        }
        // Verifica che non sia già in una lega del cluster
        return !existingLeagueIds.includes(player.league_id);
      });
      
      const hasAvailable = availablePlayers.length > 0;
      setHasAvailablePlayers(hasAvailable);
      
    } catch (error) {
      console.error('Error checking available players:', error);
      setHasAvailablePlayers(false);
    }
  };
  
  // Cerca altre copie del giocatore nelle leghe del gruppo
  const searchAvailablePlayersForCluster = async (playerName, groupId, existingLeagueIds) => {
    if (!isSuperuser || !groupId || !playerName) return;
    try {
      setLoadingAvailablePlayers(true);
      
      // Estrai nome e cognome dal nome completo
      const nameParts = playerName.trim().split(' ');
      if (nameParts.length < 2) {
        setAvailablePlayersToAdd([]);
        setShowAddPlayers(true);
        return;
      }
      
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ');
      
      // Cerca giocatori con lo stesso nome nelle leghe del gruppo
      const response = await superuserService.searchPlayers(groupId, `${firstName} ${lastName}`);
      const allPlayers = response.data.players || [];
      
      // Filtra solo quelli che non sono già nelle leghe del giocatore cluster
      const availablePlayers = allPlayers.filter(player => {
        // Costruisci il nome completo del giocatore
        const playerFullName = `${player.first_name || ''} ${player.last_name || ''}`.trim();
        // Verifica che il nome corrisponda esattamente
        if (playerFullName.toLowerCase() !== playerName.toLowerCase()) {
          return false;
        }
        // Verifica che non sia già in una lega del cluster
        return !existingLeagueIds.includes(player.league_id);
      });
      
      setAvailablePlayersToAdd(availablePlayers);
      setShowAddPlayers(true);
      const hasAvailable = availablePlayers.length > 0;
      setHasAvailablePlayers(hasAvailable);
    } catch (error) {
      console.error('Error searching available players:', error);
      showToast('Impossibile cercare i giocatori disponibili');
    } finally {
      setLoadingAvailablePlayers(false);
    }
  };
  
  // Aggiungi giocatore al cluster approvato
  const handleAddPlayerToApprovedCluster = async (playerToAdd) => {
    if (!selectedPlayerCluster || !playerToAdd) return;
    
    try {
      // Trova il cluster approvato del giocatore (il primo cluster approvato)
      const playerCluster = selectedPlayerCluster.clusters && selectedPlayerCluster.clusters.length > 0 
        ? selectedPlayerCluster.clusters[0] 
        : null;
      
      if (!playerCluster || !playerCluster.id) {
        showToast('Cluster non trovato');
        return;
      }
      
      // Aggiungi il giocatore al cluster
      await superuserService.addPlayerToCluster(playerCluster.id, playerToAdd.id);
      
      showToast('Giocatore aggiunto al cluster', 'success');
      
      // Ricarica i dati
      await loadApprovedClustersByPlayer();
      
      // Aggiorna il giocatore selezionato dopo il reload
      setTimeout(async () => {
        const updatedPlayers = await (async () => {
          try {
            const groupsResponse = await superuserService.getOfficialGroups();
            const groups = groupsResponse.data || [];
            const allClusters = [];
            for (const group of groups) {
              try {
                const clustersResponse = await superuserService.getPlayerClusters(group.id, 'approved');
                const clusters = clustersResponse.data?.clusters || [];
                clusters.forEach(cluster => {
                  cluster.group_name = group.name;
                  cluster.group_id = group.id;
                });
                allClusters.push(...clusters);
              } catch (error) {
                console.error(`Error loading clusters for group ${group.id}:`, error);
              }
            }
            
            const playersMap = new Map();
            for (const cluster of allClusters) {
              if (cluster.players && Array.isArray(cluster.players)) {
                cluster.players.forEach(player => {
                  const playerName = `${player.first_name} ${player.last_name}`;
                  if (!playersMap.has(playerName)) {
                    playersMap.set(playerName, {
                      name: playerName,
                      leagues: [],
                      clusters: []
                    });
                  }
                  const playerData = playersMap.get(playerName);
                  if (!playerData.leagues.some(l => l.id === player.league_id)) {
                    playerData.leagues.push({
                      id: player.league_id,
                      name: player.league_name,
                      group_name: cluster.group_name,
                      group_id: cluster.group_id
                    });
                  }
                  if (!playerData.clusters.some(c => c.id === cluster.id)) {
                    playerData.clusters.push({
                      id: cluster.id,
                      group_name: cluster.group_name,
                      created_at: cluster.created_at
                    });
                  }
                });
              }
            }
            return Array.from(playersMap.values()).sort((a, b) => a.name.localeCompare(b.name));
          } catch (error) {
            console.error('Error reloading players:', error);
            return [];
          }
        })();
        
        const updatedPlayer = updatedPlayers.find(p => p.name === selectedPlayerCluster.name);
        if (updatedPlayer) {
          setSelectedPlayerCluster(updatedPlayer);
        }
      }, 500);
      
      // Rimuovi il giocatore dalla lista disponibili
      setAvailablePlayersToAdd(prev => {
        const updated = prev.filter(p => p.id !== playerToAdd.id);
        // Se non ci sono più giocatori disponibili, chiudi la sezione e nascondi il pulsante
        if (updated.length === 0) {
          setShowAddPlayers(false);
          setHasAvailablePlayers(false);
        }
        return updated;
      });
    } catch (error) {
      console.error('Error adding player to cluster:', error);
      showToast(error.response?.data?.message || 'Errore durante l\'aggiunta del giocatore');
    }
  };
  
  // Crea cluster manuale
  const handleCreateManualCluster = async (groupId) => {
    if (selectedPlayersForCluster.length < 2) {
      showToast('Seleziona almeno 2 giocatori');
      return;
    }
    try {
      await superuserService.createPlayerCluster({
        official_group_id: groupId,
        player_ids: selectedPlayersForCluster.map(p => p.id),
        suggested_by_system: false,
        status: 'pending'
      });
      showToast('Cluster creato e in attesa di approvazione', 'success');
      setShowCreateClusterModal(false);
      setSelectedPlayersForCluster([]);
      setSearchPlayersQuery('');
      await loadClusters(groupId, clusterFilterStatus);
    } catch (error) {
      console.error('Error creating manual cluster:', error);
      showToast(error.response?.data?.message || 'Errore durante la creazione del cluster');
    }
  };
  
  // Aggiungi giocatore a cluster esistente
  const handleAddPlayerToCluster = async (clusterId, playerId, groupId) => {
    try {
      await superuserService.addPlayerToCluster(clusterId, playerId);
      showToast('Giocatore aggiunto al cluster', 'success');
      await loadClusters(groupId, clusterFilterStatus);
    } catch (error) {
      console.error('Error adding player to cluster:', error);
      showToast(error.response?.data?.message || 'Errore durante l\'aggiunta');
    }
  };
  
  // Carica dati quando cambia tab
  useEffect(() => {
    if (isSuperuser) {
      if (activeTab === 'users') {
        loadUsers();
      } else if (activeTab === 'leagues') {
        loadLeagues();
      } else if (activeTab === 'officials') {
        loadOfficialGroups();
      }
    }
  }, [activeTab, isSuperuser]);
  
  // Toggle superuser status
  const handleToggleSuperuser = async (userId, currentStatus) => {
    setConfirmModal({
      title: currentStatus ? 'Rimuovi Super User' : 'Rendi Super User',
      message: `Sei sicuro di voler ${currentStatus ? 'rimuovere' : 'assegnare'} i privilegi di super user a questo utente?`,
      confirmText: 'Conferma',
      destructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await superuserService.toggleSuperuser(userId);
          await loadUsers();
          showToast(currentStatus ? 'Super user rimosso' : 'Utente reso super user', 'success');
        } catch (error) {
          console.error('Error toggling superuser:', error);
          showToast(error.response?.data?.message || 'Errore durante l\'operazione');
        }
      },
    });
  };
  
  // Elimina lega
  const handleDeleteLeague = (leagueId, leagueName) => {
    setConfirmModal({
      title: 'Elimina Lega',
      message: `Sei sicuro di voler eliminare la lega "${leagueName}"? Questa azione è irreversibile.`,
      confirmText: 'Elimina',
      destructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await superuserService.deleteLeague(leagueId);
          await loadLeagues();
          showToast('Lega eliminata con successo', 'success');
        } catch (error) {
          console.error('Error deleting league:', error);
          showToast(error.response?.data?.message || 'Errore durante l\'eliminazione');
        }
      },
    });
  };
  
  // Entra in lega come admin
  const handleJoinLeagueAsAdmin = async (leagueId) => {
    try {
      await superuserService.joinLeagueAsAdmin(leagueId);
      showToast('Aggiunto come admin alla lega', 'success');
      setTimeout(() => navigation.navigate('League', { leagueId }), 1500);
    } catch (error) {
      console.error('Error joining league as admin:', error);
      showToast(error.response?.data?.message || 'Errore durante l\'operazione');
    }
  };
  
  // Gestisce il click sul checkbox "ufficiale" di una lega
  const handleToggleLeagueOfficial = async (league) => {
    if (league.is_official) {
      setConfirmModal({
        title: 'Rimuovi Lega Ufficiale',
        message: `Sei sicuro di voler rimuovere "${league.name}" dallo stato ufficiale?`,
        confirmText: 'Rimuovi',
        destructive: true,
        onConfirm: async () => {
          setConfirmModal(null);
          try {
            await superuserService.setLeagueOfficial(league.id, { is_official: false });
            await loadLeagues();
            await loadOfficialGroups();
          } catch (error) {
            console.error('Error removing official status:', error);
            showToast(error.response?.data?.message || 'Errore durante l\'operazione');
          }
        },
      });
    } else {
      // Apri modal per selezionare/creare gruppo
      setSelectedLeagueForOfficial(league);
      setShowOfficialGroupModal(true);
      // Carica i gruppi se non sono già stati caricati
      if (!officialGroupsDisabled && officialGroups.length === 0) {
        loadOfficialGroups();
      }
    }
  };
  
  // Gestisce la selezione di un gruppo per una lega
  const handleSelectGroupForLeague = async (groupId) => {
    if (!selectedLeagueForOfficial) return;
    
    try {
      await superuserService.setLeagueOfficial(selectedLeagueForOfficial.id, {
        is_official: true,
        official_group_id: groupId,
      });
      setShowOfficialGroupModal(false);
      setSelectedLeagueForOfficial(null);
      await loadLeagues();
      await loadOfficialGroups();
    } catch (error) {
      console.error('Error setting league official:', error);
      if (isFeatureDisabledError(error)) {
        setOfficialGroupsDisabled(true);
      } else {
        showToast(error.response?.data?.message || 'Errore durante l\'operazione');
      }
    }
  };
  
  // Crea un nuovo gruppo ufficiale
  const handleCreateOfficialGroup = async () => {
    if (!newGroupName.trim()) {
      showToast('Il nome del gruppo è obbligatorio');
      return;
    }
    
    try {
      const response = await superuserService.createOfficialGroup({
        name: newGroupName.trim(),
        description: newGroupDescription.trim() || null,
      });
      setShowCreateGroupModal(false);
      setNewGroupName('');
      setNewGroupDescription('');
      await loadOfficialGroups();
      // Se c'era una lega selezionata, assegnala al nuovo gruppo
      if (selectedLeagueForOfficial && response.data?.id) {
        await handleSelectGroupForLeague(response.data.id);
      }
    } catch (error) {
      console.error('Error creating official group:', error);
      showToast(error.response?.data?.message || 'Errore durante la creazione del gruppo');
    }
  };
  
  // Gestisce il toggle "visibile per collegamento"
  const handleToggleVisibleForLinking = async (league) => {
    try {
      await superuserService.toggleVisibleForLinking(league.id);
      await loadLeagues();
    } catch (error) {
      console.error('Error toggling visible for linking:', error);
      showToast(error.response?.data?.message || 'Errore durante l\'operazione');
    }
  };
  
  // Filtra le leghe (ufficiali o tutte)
  const filteredLeagues = useMemo(() => {
    const list = Array.isArray(leagues) ? leagues : [];
    if (!filterOfficialOnly) return list;
    return list.filter((league) => league.is_official);
  }, [leagues, filterOfficialOnly]);
  
  // Formatta data/ora
  const formatDateTime = (dateString) => {
    if (!dateString) return 'Mai';
    const date = new Date(dateString);
    return date.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  
  // Verifica se utente è online (attività < 5 minuti)
  const isUserOnline = (lastActivity) => {
    if (!lastActivity) return false;
    const lastActivityTime = new Date(lastActivity).getTime();
    const now = Date.now();
    return (now - lastActivityTime) < 300000; // 5 minuti
  };
  
  // Gestisce l'ordinamento
  const handleSort = (column) => {
    if (sortColumn === column) {
      // Se già ordinato per questa colonna, inverte la direzione
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Nuova colonna, ordine crescente di default
      setSortColumn(column);
      setSortDirection('asc');
    }
  };
  
  // Ordina e filtra gli utenti
  const sortedUsers = useMemo(() => {
    let filtered = users;
    
    // Filtra per nome utente e/o email
    if (searchText.trim()) {
      const searchLower = searchText.toLowerCase().trim();
      filtered = users.filter(user => {
        const usernameMatch = (user.username || '').toLowerCase().includes(searchLower);
        const emailMatch = (user.email || '').toLowerCase().includes(searchLower);
        return usernameMatch || emailMatch;
      });
    }
    
    // Ordina
    if (!sortColumn) return filtered;
    
    const sorted = [...filtered].sort((a, b) => {
      let aVal, bVal;
      
      switch (sortColumn) {
        case 'username':
          aVal = (a.username || '').toLowerCase();
          bVal = (b.username || '').toLowerCase();
          break;
        case 'last_login':
          aVal = a.last_login ? new Date(a.last_login).getTime() : 0;
          bVal = b.last_login ? new Date(b.last_login).getTime() : 0;
          break;
        case 'is_online':
          aVal = a.is_online ? 1 : 0;
          bVal = b.is_online ? 1 : 0;
          break;
        case 'is_superuser':
          aVal = a.is_superuser ? 1 : 0;
          bVal = b.is_superuser ? 1 : 0;
          break;
        default:
          return 0;
      }
      
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return sorted;
  }, [users, sortColumn, sortDirection, searchText]);
  
  if (!isSuperuser) {
    return null; // Non mostrare nulla se non è superuser
  }
  
  const renderUserItem = ({ item }) => {
    const isSuper = Number(item?.is_superuser || 0) > 0;
    return (
    <View style={styles.userItem}>
      {/* Colonna 1: Nome utente e email */}
      <View style={[styles.userInfoColumn, styles.columnWithPadding]}>
        <View style={styles.userHeader}>
          <Text style={styles.userName}>{item.username}</Text>
          {isSuper && (
            <View style={styles.superuserBadge}>
              <Text style={styles.superuserBadgeText}>SU</Text>
            </View>
          )}
        </View>
        <Text style={styles.userEmail} numberOfLines={1} ellipsizeMode="tail">{item.email}</Text>
      </View>
      
      {/* Colonna 2: Ultimo accesso */}
      <View style={styles.lastAccessColumn}>
        <Text style={styles.lastAccessText}>{formatDateTime(item.last_login)}</Text>
      </View>
      
      {/* Colonna 3: Stato */}
      <View style={styles.statusColumn}>
        <View style={[styles.statusIndicator, item.is_online && styles.statusIndicatorOnline]} />
        <Text style={styles.userStatus}>
          {item.is_online ? 'Online' : 'Offline'}
        </Text>
      </View>
      
      {/* Colonna 4: Pulsante Super User */}
      <View style={[styles.buttonColumn, styles.columnWithPaddingRight]}>
        <TouchableOpacity
          style={[styles.toggleSuperuserButton, isSuper && styles.toggleSuperuserButtonActive]}
          onPress={() => handleToggleSuperuser(item.id, item.is_superuser)}
        >
          <Ionicons 
            name={isSuper ? "star" : "star-outline"} 
            size={16} 
            color={isSuper ? '#fff' : '#667eea'} 
          />
        </TouchableOpacity>
      </View>
    </View>
  );
  };
  
  const renderLeagueItem = ({ item }) => {
    const isOfficial = Number(item?.is_official || 0) > 0;
    return (
    <View style={styles.leagueItem}>
      <View style={styles.leagueInfo}>
        <View style={styles.leagueNameRow}>
          <Text style={styles.leagueName}>{item.name}</Text>
          <TouchableOpacity
            onPress={() => handleToggleLeagueOfficial(item)}
            style={styles.officialCheckbox}
          >
            <Ionicons 
              name={isOfficial ? "checkmark-circle" : "ellipse-outline"} 
              size={24} 
              color={isOfficial ? "#667eea" : "#ccc"} 
            />
          </TouchableOpacity>
        </View>
        {isOfficial && item.official_group_name && (
          <Text style={styles.leagueOfficialGroup}>
            Gruppo: {item.official_group_name}
          </Text>
        )}
        {isOfficial && (
          <TouchableOpacity
            onPress={() => handleToggleVisibleForLinking(item)}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: 8,
              marginBottom: 4,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 8,
              backgroundColor: item.is_visible_for_linking ? '#e8f5e9' : '#f5f5f5',
              borderWidth: 1,
              borderColor: item.is_visible_for_linking ? '#a5d6a7' : '#ddd',
              alignSelf: 'flex-start',
            }}
          >
            <Ionicons 
              name={item.is_visible_for_linking ? "eye" : "eye-off-outline"} 
              size={18} 
              color={item.is_visible_for_linking ? "#2e7d32" : "#888"} 
            />
            <Text style={{ 
              fontSize: 13, 
              fontWeight: '600',
              color: item.is_visible_for_linking ? "#2e7d32" : "#888", 
              marginLeft: 6,
            }}>
              {item.is_visible_for_linking ? 'Visibile per collegamento' : 'Non visibile per collegamento'}
            </Text>
            <Ionicons 
              name={item.is_visible_for_linking ? "toggle" : "toggle-outline"} 
              size={22} 
              color={item.is_visible_for_linking ? "#2e7d32" : "#bbb"} 
              style={{ marginLeft: 8 }}
            />
          </TouchableOpacity>
        )}
        <Text style={styles.leagueDetails}>
          {item.member_count} membri • {item.access_code ? 'Privata' : 'Pubblica'}
        </Text>
        <Text style={styles.leagueCreated}>
          Creata: {formatDateTime(item.created_at)}
        </Text>
      </View>
      <View style={styles.leagueActions}>
        <TouchableOpacity
          style={styles.leagueActionButton}
          onPress={() => navigation.navigate('League', { leagueId: item.id })}
        >
          <Ionicons name="eye" size={18} color="#667eea" />
          <Text style={styles.leagueActionText}>Vedi</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.leagueActionButton, styles.leagueActionButtonAdmin]}
          onPress={() => handleJoinLeagueAsAdmin(item.id)}
        >
          <Ionicons name="shield" size={18} color="#28a745" />
          <Text style={[styles.leagueActionText, styles.leagueActionTextAdmin]}>Admin</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.leagueActionButton, styles.leagueActionButtonDanger]}
          onPress={() => handleDeleteLeague(item.id, item.name)}
        >
          <Ionicons name="trash" size={18} color="#dc3545" />
          <Text style={[styles.leagueActionText, styles.leagueActionTextDanger]}>Elimina</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
  };
  
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#667eea" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Super User</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'users' && styles.tabActive]}
          onPress={() => setActiveTab('users')}
        >
          <Ionicons 
            name={activeTab === 'users' ? "people" : "people-outline"} 
            size={20} 
            color={activeTab === 'users' ? '#fff' : '#666'} 
          />
          <Text style={[styles.tabText, activeTab === 'users' && styles.tabTextActive]}>
            Utenti
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'leagues' && styles.tabActive]}
          onPress={() => setActiveTab('leagues')}
        >
          <Ionicons 
            name={activeTab === 'leagues' ? "trophy" : "trophy-outline"} 
            size={20} 
            color={activeTab === 'leagues' ? '#fff' : '#666'} 
          />
          <Text style={[styles.tabText, activeTab === 'leagues' && styles.tabTextActive]}>
            Leghe
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'officials' && styles.tabActive]}
          onPress={() => setActiveTab('officials')}
        >
          <Ionicons 
            name={activeTab === 'officials' ? "ribbon" : "ribbon-outline"} 
            size={20} 
            color={activeTab === 'officials' ? '#fff' : '#666'} 
          />
          <Text style={[styles.tabText, activeTab === 'officials' && styles.tabTextActive]}>
            Ufficiali
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'clusters' && styles.tabActive]}
          onPress={() => {
            setActiveTab('clusters');
            if (approvedClustersByPlayer.length === 0) {
              loadApprovedClustersByPlayer();
            }
          }}
        >
          <Ionicons 
            name={activeTab === 'clusters' ? "people" : "people-outline"} 
            size={20} 
            color={activeTab === 'clusters' ? '#fff' : '#666'} 
          />
          <Text style={[styles.tabText, activeTab === 'clusters' && styles.tabTextActive]}>
            Cluster
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tab Content */}
      <View style={styles.content}>
        {activeTab === 'users' && (
          <>
            {/* Barra di ricerca */}
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Cerca per nome utente o email..."
                placeholderTextColor="#999"
                value={searchText}
                onChangeText={setSearchText}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchText.length > 0 && (
                <TouchableOpacity onPress={() => setSearchText('')} style={styles.clearButton}>
                  <Ionicons name="close-circle" size={20} color="#999" />
                </TouchableOpacity>
              )}
            </View>
            {loadingUsers ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#667eea" />
              </View>
            ) : (
              <>
                {/* Header colonne */}
                <View style={styles.columnsHeader}>
                  <TouchableOpacity 
                    style={[styles.userInfoColumn, styles.columnWithPadding, styles.sortableColumn]}
                    onPress={() => handleSort('username')}
                  >
                    <Text style={styles.columnHeaderText}>Utente</Text>
                    {sortColumn === 'username' && (
                      <Ionicons 
                        name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'} 
                        size={14} 
                        color="#667eea" 
                      />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.lastAccessColumn, styles.sortableColumn]}
                    onPress={() => handleSort('last_login')}
                  >
                    <Text style={styles.columnHeaderText}>Ultimo accesso</Text>
                    {sortColumn === 'last_login' && (
                      <Ionicons 
                        name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'} 
                        size={14} 
                        color="#fff" 
                      />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.statusColumn, styles.sortableColumn]}
                    onPress={() => handleSort('is_online')}
                  >
                    <Text style={styles.columnHeaderText}>Stato</Text>
                    {sortColumn === 'is_online' && (
                      <Ionicons 
                        name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'} 
                        size={14} 
                        color="#fff" 
                      />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.buttonColumnHeader, styles.columnWithPaddingRight, styles.sortableColumn]}
                    onPress={() => handleSort('is_superuser')}
                  >
                    <Text style={styles.columnHeaderText}>Super User</Text>
                    {sortColumn === 'is_superuser' && (
                      <Ionicons 
                        name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'} 
                        size={14} 
                        color="#fff" 
                      />
                    )}
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={sortedUsers}
                  keyExtractor={(item) => item.id.toString()}
                  renderItem={renderUserItem}
                  refreshControl={
                    <RefreshControl refreshing={refreshingUsers} onRefresh={() => {
                      setRefreshingUsers(true);
                      loadUsers();
                    }} />
                  }
                  ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                      <Ionicons name="people-outline" size={48} color="#ccc" />
                      <Text style={styles.emptyText}>Nessun utente trovato</Text>
                    </View>
                  }
                  contentContainerStyle={styles.listContent}
                />
              </>
            )}
          </>
        )}

        {activeTab === 'leagues' && (
          <>
            {/* Filtro leghe ufficiali */}
            <View style={styles.filterContainer}>
              <TouchableOpacity
                style={[styles.filterButton, filterOfficialOnly && styles.filterButtonActive]}
                onPress={() => setFilterOfficialOnly(!filterOfficialOnly)}
              >
                <Ionicons 
                  name={filterOfficialOnly ? "checkbox" : "square-outline"} 
                  size={20} 
                  color={filterOfficialOnly ? "#667eea" : "#666"} 
                />
                <Text style={[styles.filterText, filterOfficialOnly && styles.filterTextActive]}>
                  Solo Leghe Ufficiali
                </Text>
              </TouchableOpacity>
            </View>
            {loadingLeagues ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#667eea" />
              </View>
            ) : (
              <FlatList
                data={filteredLeagues}
                keyExtractor={(item) => item.id.toString()}
                renderItem={renderLeagueItem}
                refreshControl={
                  <RefreshControl refreshing={refreshingLeagues} onRefresh={() => {
                    setRefreshingLeagues(true);
                    loadLeagues();
                  }} />
                }
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Ionicons name="trophy-outline" size={48} color="#ccc" />
                    <Text style={styles.emptyText}>
                      {filterOfficialOnly ? 'Nessuna lega ufficiale trovata' : 'Nessuna lega trovata'}
                    </Text>
                  </View>
                }
                contentContainerStyle={styles.listContent}
              />
            )}
          </>
        )}

        {activeTab === 'officials' && (
          <>
            {loadingOfficialGroups ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#667eea" />
              </View>
            ) : (
              <FlatList
                data={officialGroups}
                keyExtractor={(item) => item.id.toString()}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.officialGroupItem}
                    onPress={async () => {
                      try {
                        const response = await superuserService.getOfficialGroupLeagues(item.id);
                        setSelectedGroupForEdit({ ...item, leagues: response.data.leagues || [] });
                        setShowGroupDetailModal(true);
                      } catch (error) {
                        console.error('Error loading group leagues:', error);
                        showToast('Impossibile caricare le leghe del gruppo');
                      }
                    }}
                  >
                    <View style={styles.officialGroupInfo}>
                      <Text style={styles.officialGroupName}>{item.name}</Text>
                      {item.description && (
                        <Text style={styles.officialGroupDescription}>{item.description}</Text>
                      )}
                      <Text style={styles.officialGroupStats}>
                        {item.league_count} leghe • Creato da {item.created_by_username} • {formatDateTime(item.created_at)}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#ccc" />
                  </TouchableOpacity>
                )}
                refreshControl={
                  <RefreshControl refreshing={refreshingOfficialGroups} onRefresh={() => {
                    setRefreshingOfficialGroups(true);
                    loadOfficialGroups();
                  }} />
                }
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Ionicons name="ribbon-outline" size={48} color="#ccc" />
                    <Text style={styles.emptyText}>Nessun gruppo ufficiale trovato</Text>
                  </View>
                }
                contentContainerStyle={styles.listContent}
              />
            )}
          </>
        )}

        {activeTab === 'clusters' && (
          <>
            {loadingApprovedClusters ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#667eea" />
              </View>
            ) : (
              <FlatList
                data={approvedClustersByPlayer}
                keyExtractor={(item, index) => `player-${index}-${item.name}`}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.playerClusterItem}
                    onPress={async () => {
                      setSelectedPlayerCluster(item);
                      setShowPlayerClusterDetail(true);
                      // Verifica se ci sono giocatori disponibili
                      if (item.leagues.length > 0) {
                        const groupId = item.leagues[0]?.group_id;
                        const existingLeagueIds = item.leagues.map(l => l.id);
                        if (groupId) {
                          await checkAvailablePlayers(item.name, groupId, existingLeagueIds);
                        }
                      }
                    }}
                  >
                    <View style={styles.playerClusterInfo}>
                      <Text style={styles.playerClusterName}>{item.name}</Text>
                      <Text style={styles.playerClusterLeaguesCount}>
                        {item.leagues.length} {item.leagues.length === 1 ? 'lega' : 'leghe'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#999" />
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Ionicons name="people-outline" size={64} color="#ccc" />
                    <Text style={styles.emptyText}>Nessun cluster approvato</Text>
                    <Text style={styles.emptySubtext}>
                      I giocatori approvati come cluster appariranno qui
                    </Text>
                  </View>
                }
                refreshControl={
                  <RefreshControl
                    refreshing={refreshingApprovedClusters}
                    onRefresh={() => {
                      setRefreshingApprovedClusters(true);
                      loadApprovedClustersByPlayer();
                    }}
                  />
                }
                contentContainerStyle={styles.listContent}
              />
            )}
          </>
        )}
      </View>

      {/* Modal per selezionare/creare gruppo ufficiale */}
      <Modal
        visible={showOfficialGroupModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowOfficialGroupModal(false);
          setSelectedLeagueForOfficial(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Gestisci Lega Ufficiale</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowOfficialGroupModal(false);
                  setSelectedLeagueForOfficial(null);
                }}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            {selectedLeagueForOfficial && (
              <Text style={styles.modalSubtitle}>
                Seleziona il gruppo per "{selectedLeagueForOfficial.name}"
              </Text>
            )}
            
            <ScrollView style={styles.modalScrollView}>
              {officialGroups.map((group) => (
                <TouchableOpacity
                  key={group.id}
                  style={styles.groupOptionItem}
                  onPress={() => handleSelectGroupForLeague(group.id)}
                >
                  <View style={styles.groupOptionInfo}>
                    <Text style={styles.groupOptionName}>{group.name}</Text>
                    {group.description && (
                      <Text style={styles.groupOptionDescription}>{group.description}</Text>
                    )}
                    <Text style={styles.groupOptionStats}>
                      {group.league_count} leghe
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#667eea" />
                </TouchableOpacity>
              ))}
              
              <TouchableOpacity
                style={styles.createGroupButton}
                onPress={() => setShowCreateGroupModal(true)}
              >
                <Ionicons name="add-circle" size={24} color="#667eea" />
                <Text style={styles.createGroupButtonText}>Crea Nuovo Gruppo</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal per creare nuovo gruppo */}
      <Modal
        visible={showCreateGroupModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowCreateGroupModal(false);
          setNewGroupName('');
          setNewGroupDescription('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Crea Nuovo Gruppo</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowCreateGroupModal(false);
                  setNewGroupName('');
                  setNewGroupDescription('');
                }}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalScrollView}>
              <View style={styles.modalInputContainer}>
                <Text style={styles.modalLabel}>Nome Gruppo *</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Es: Coppa dei cantoni"
                  value={newGroupName}
                  onChangeText={setNewGroupName}
                />
              </View>
              
              <View style={styles.modalInputContainer}>
                <Text style={styles.modalLabel}>Descrizione</Text>
                <TextInput
                  style={[styles.modalInput, styles.modalTextArea]}
                  placeholder="Descrizione opzionale del gruppo"
                  value={newGroupDescription}
                  onChangeText={setNewGroupDescription}
                  multiline
                  numberOfLines={3}
                />
              </View>
              
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={handleCreateOfficialGroup}
              >
                <Text style={styles.modalButtonText}>Crea Gruppo</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal per dettagli gruppo ufficiale */}
      <Modal
        visible={showGroupDetailModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowGroupDetailModal(false);
          setSelectedGroupForEdit(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedGroupForEdit?.name || 'Gruppo Ufficiale'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowGroupDetailModal(false);
                  setSelectedGroupForEdit(null);
                }}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            {selectedGroupForEdit && (
              <ScrollView style={styles.modalScrollView} contentContainerStyle={{ paddingBottom: 20 }}>
                {selectedGroupForEdit.description && (
                  <Text style={styles.groupDetailDescription}>
                    {selectedGroupForEdit.description}
                  </Text>
                )}
                
                <Text style={styles.groupDetailSectionTitle}>
                  Leghe del Gruppo ({selectedGroupForEdit.leagues?.length || 0})
                </Text>
                
                {selectedGroupForEdit.leagues && selectedGroupForEdit.leagues.length > 0 ? (
                  selectedGroupForEdit.leagues.map((league) => (
                    <View key={league.id} style={styles.groupLeagueItem}>
                      <Text style={styles.groupLeagueName}>{league.name}</Text>
                      <Text style={styles.groupLeagueDetails}>
                        {league.member_count} membri • {formatDateTime(league.created_at)}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.groupDetailEmpty}>
                    Nessuna lega in questo gruppo
                  </Text>
                )}
                
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonSecondary]}
                  onPress={async () => {
                    setShowClusterModal(true);
                    try {
                      await loadClusterSuggestions(selectedGroupForEdit.id);
                      await loadClusters(selectedGroupForEdit.id, null);
                    } catch (error) {
                      console.error('Error in cluster button handler:', error);
                    }
                  }}
                >
                  <Ionicons name="people" size={18} color="#667eea" />
                  <Text style={[styles.modalButtonText, { color: '#667eea' }]}>Gestisci Cluster Giocatori</Text>
                </TouchableOpacity>
                
                <View style={styles.groupDetailActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonDanger]}
                    onPress={() => {
                      setConfirmModal({
                        title: 'Elimina Gruppo',
                        message: `Sei sicuro di voler eliminare il gruppo "${selectedGroupForEdit.name}"? Le leghe perderanno lo stato ufficiale.`,
                        confirmText: 'Elimina',
                        destructive: true,
                        onConfirm: async () => {
                          setConfirmModal(null);
                          try {
                            await superuserService.deleteOfficialGroup(selectedGroupForEdit.id);
                            setShowGroupDetailModal(false);
                            setSelectedGroupForEdit(null);
                            await loadOfficialGroups();
                            await loadLeagues();
                            showToast('Gruppo eliminato con successo', 'success');
                          } catch (error) {
                            console.error('Error deleting group:', error);
                            showToast(error.response?.data?.message || 'Errore durante l\'eliminazione');
                          }
                        },
                      });
                    }}
                  >
                    <Ionicons name="trash" size={18} color="#fff" />
                    <Text style={styles.modalButtonText}>Elimina Gruppo</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal per gestire cluster giocatori */}
      <Modal
        visible={showClusterModal && selectedGroupForEdit !== null}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowClusterModal(false);
          setClusterFilterStatus(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Gestisci Cluster</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowClusterModal(false);
                  setClusterFilterStatus(null);
                }}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            {selectedGroupForEdit && (
              <View style={{ flex: 1 }}>
                {/* Filtri status */}
                <View style={styles.clusterFilters}>
                  <TouchableOpacity
                    style={[styles.clusterFilterButton, clusterFilterStatus === null && styles.clusterFilterButtonActive]}
                    onPress={() => {
                      setClusterFilterStatus(null);
                      loadClusters(selectedGroupForEdit.id, null);
                    }}
                  >
                    <Text style={[styles.clusterFilterText, clusterFilterStatus === null && styles.clusterFilterTextActive]}>Tutti</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.clusterFilterButton, clusterFilterStatus === 'pending' && styles.clusterFilterButtonActive]}
                    onPress={() => {
                      setClusterFilterStatus('pending');
                      loadClusters(selectedGroupForEdit.id, 'pending');
                    }}
                  >
                    <Text style={[styles.clusterFilterText, clusterFilterStatus === 'pending' && styles.clusterFilterTextActive]}>In Attesa</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.clusterFilterButton, clusterFilterStatus === 'approved' && styles.clusterFilterButtonActive]}
                    onPress={() => {
                      setClusterFilterStatus('approved');
                      loadClusters(selectedGroupForEdit.id, 'approved');
                    }}
                  >
                    <Text style={[styles.clusterFilterText, clusterFilterStatus === 'approved' && styles.clusterFilterTextActive]}>Approvati</Text>
                  </TouchableOpacity>
                </View>
                
                <ScrollView 
                  style={styles.modalScrollView}
                >
                  {/* Suggerimenti automatici */}
                  {clusterFilterStatus === null && (
                    <>
                      <Text style={styles.clusterSectionTitle}>Suggerimenti Automatici</Text>
                      {loadingSuggestions ? (
                        <ActivityIndicator size="small" color="#667eea" style={{ padding: 20 }} />
                      ) : suggestions.length > 0 ? (
                        suggestions.map((suggestion, index) => (
                          <View key={index} style={styles.suggestionItem}>
                            <View style={styles.suggestionPlayers}>
                              <Text style={styles.suggestionPlayerName}>{suggestion.player_1.name}</Text>
                              <Text style={styles.suggestionLeague}>{suggestion.player_1.league_name}</Text>
                              <Text style={styles.suggestionArrow}>⇄</Text>
                              <Text style={styles.suggestionPlayerName}>{suggestion.player_2.name}</Text>
                              <Text style={styles.suggestionLeague}>{suggestion.player_2.league_name}</Text>
                            </View>
                            <TouchableOpacity
                              style={styles.suggestionButton}
                              onPress={() => handleCreateClusterFromSuggestion(suggestion.player_1, suggestion.player_2, selectedGroupForEdit.id)}
                            >
                              <Ionicons name="checkmark" size={18} color="#4CAF50" />
                              <Text style={styles.suggestionButtonText}>Approva</Text>
                            </TouchableOpacity>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.clusterEmptyText}>Nessun suggerimento disponibile</Text>
                      )}
                      
                      <TouchableOpacity
                        style={[styles.modalButton, styles.modalButtonPrimary, { marginTop: 16 }]}
                        onPress={() => {
                          setShowCreateClusterModal(true);
                          searchPlayers(selectedGroupForEdit.id, '');
                        }}
                      >
                        <Ionicons name="add" size={18} color="#fff" />
                        <Text style={styles.modalButtonText}>Crea Cluster Manuale</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  
                  {/* Cluster esistenti */}
                  <Text style={styles.clusterSectionTitle}>
                    Cluster ({clusters.length})
                  </Text>
                  {loadingClusters ? (
                    <ActivityIndicator size="small" color="#667eea" />
                  ) : clusters.length > 0 ? (
                    clusters.map((cluster) => (
                      <View key={cluster.id} style={styles.clusterItem}>
                        <View style={styles.clusterInfo}>
                          <View style={styles.clusterHeader}>
                            <Text style={styles.clusterStatus}>
                              {cluster.status === 'approved' ? '✓ Approvato' : 
                               cluster.status === 'pending' ? '⏳ In Attesa' : '✗ Rifiutato'}
                            </Text>
                            <Text style={styles.clusterPlayersCount}>
                              {cluster.players_count} giocatori
                            </Text>
                          </View>
                          {cluster.players && cluster.players.map((player, idx) => (
                            <View key={idx} style={styles.clusterPlayer}>
                              <Text style={styles.clusterPlayerName}>
                                {player.full_name}
                              </Text>
                              <Text style={styles.clusterPlayerLeague}>
                                {player.league_name} • {player.role}
                              </Text>
                            </View>
                          ))}
                        </View>
                        {cluster.status === 'pending' && (
                          <View style={styles.clusterActions}>
                            <TouchableOpacity
                              style={styles.clusterActionButton}
                              onPress={() => handleApproveCluster(cluster.id, selectedGroupForEdit.id)}
                            >
                              <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.clusterActionButton}
                              onPress={() => handleRejectCluster(cluster.id, selectedGroupForEdit.id)}
                            >
                              <Ionicons name="close-circle" size={20} color="#F44336" />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    ))
                  ) : (
                    <Text style={styles.clusterEmptyText}>Nessun cluster trovato</Text>
                  )}
                </ScrollView>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal per creare cluster manuale */}
      <Modal
        visible={showCreateClusterModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowCreateClusterModal(false);
          setSelectedPlayersForCluster([]);
          setSearchPlayersQuery('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Crea Cluster Manuale</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowCreateClusterModal(false);
                  setSelectedPlayersForCluster([]);
                  setSearchPlayersQuery('');
                }}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            {selectedGroupForEdit && (
              <View style={{ flex: 1 }}>
                <View style={styles.modalInputContainer}>
                  <Text style={styles.modalLabel}>Cerca Giocatore</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Nome giocatore..."
                    value={searchPlayersQuery}
                    onChangeText={(text) => {
                      setSearchPlayersQuery(text);
                      if (text.length > 2) {
                        searchPlayers(selectedGroupForEdit.id, text);
                      } else {
                        setSearchedPlayers([]);
                      }
                    }}
                  />
                </View>
                
                <ScrollView style={styles.modalScrollView}>
                  {loadingPlayers ? (
                    <ActivityIndicator size="small" color="#667eea" />
                  ) : searchedPlayers.length > 0 ? (
                    searchedPlayers.map((player) => {
                      const isSelected = selectedPlayersForCluster.some(p => p.id === player.id);
                      return (
                        <TouchableOpacity
                          key={player.id}
                          style={[styles.searchPlayerItem, isSelected && styles.searchPlayerItemSelected]}
                          onPress={() => {
                            if (isSelected) {
                              setSelectedPlayersForCluster(selectedPlayersForCluster.filter(p => p.id !== player.id));
                            } else {
                              setSelectedPlayersForCluster([...selectedPlayersForCluster, player]);
                            }
                          }}
                        >
                          <View style={styles.searchPlayerInfo}>
                            <Text style={styles.searchPlayerName}>{player.full_name}</Text>
                            <Text style={styles.searchPlayerDetails}>
                              {player.league_name} • {player.role} • {player.rating.toFixed(1)} {player.rating === 1 ? 'credito' : 'crediti'}
                            </Text>
                          </View>
                          {isSelected && (
                            <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
                          )}
                        </TouchableOpacity>
                      );
                    })
                  ) : (
                    <Text style={styles.clusterEmptyText}>
                      {searchPlayersQuery.length > 2 ? 'Nessun giocatore trovato' : 'Cerca un giocatore per iniziare'}
                    </Text>
                  )}
                  
                  {selectedPlayersForCluster.length > 0 && (
                    <>
                      <Text style={styles.clusterSectionTitle}>
                        Giocatori Selezionati ({selectedPlayersForCluster.length})
                      </Text>
                      {selectedPlayersForCluster.map((player) => (
                        <View key={player.id} style={styles.selectedPlayerItem}>
                          <Text style={styles.selectedPlayerName}>{player.full_name}</Text>
                          <Text style={styles.selectedPlayerDetails}>
                            {player.league_name} • {player.role}
                          </Text>
                        </View>
                      ))}
                    </>
                  )}
                </ScrollView>
                
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonPrimary, { marginTop: 16 }]}
                  onPress={() => handleCreateManualCluster(selectedGroupForEdit.id)}
                  disabled={selectedPlayersForCluster.length < 2}
                >
                  <Text style={styles.modalButtonText}>
                    Crea Cluster ({selectedPlayersForCluster.length} giocatori)
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal Dettagli Giocatore Cluster */}
      <Modal
        visible={showPlayerClusterDetail}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowPlayerClusterDetail(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedPlayerCluster?.name || 'Dettagli Giocatore'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowPlayerClusterDetail(false);
                  setSelectedPlayerCluster(null);
                  setShowAddPlayers(false);
                  setAvailablePlayersToAdd([]);
                  setHasAvailablePlayers(false);
                }}
              >
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            
            {selectedPlayerCluster && (
              <ScrollView style={styles.modalScrollView} contentContainerStyle={{ paddingBottom: 20 }}>
                {/* Sezione giocatori disponibili da aggiungere */}
                {showAddPlayers && availablePlayersToAdd.length > 0 && (
                  <View style={styles.groupDetailSection}>
                    <Text style={styles.groupDetailSectionTitle}>
                      Giocatori Disponibili ({availablePlayersToAdd.length})
                    </Text>
                    {availablePlayersToAdd.map((player, index) => {
                      const playerFullName = `${player.first_name || ''} ${player.last_name || ''}`.trim() || player.name;
                      return (
                        <View key={index} style={styles.availablePlayerItem}>
                          <View style={styles.availablePlayerInfo}>
                            <Text style={styles.availablePlayerName}>{playerFullName}</Text>
                            <Text style={styles.availablePlayerLeague}>{player.league_name}</Text>
                          </View>
                          <TouchableOpacity
                            style={styles.addToClusterButton}
                            onPress={() => handleAddPlayerToApprovedCluster(player)}
                          >
                            <Ionicons name="checkmark" size={20} color="#4CAF50" />
                            <Text style={styles.addToClusterButtonText}>Aggiungi</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                )}
                
                {showAddPlayers && availablePlayersToAdd.length === 0 && !loadingAvailablePlayers && (
                  <View style={styles.groupDetailSection}>
                    <Text style={styles.groupDetailEmpty}>
                      Nessun altro giocatore trovato con lo stesso nome
                    </Text>
                  </View>
                )}
                
                <View style={styles.groupDetailSection}>
                  <Text style={styles.groupDetailSectionTitle}>
                    Leghe ({selectedPlayerCluster.leagues.length})
                  </Text>
                  {selectedPlayerCluster.leagues.length > 0 ? (
                    selectedPlayerCluster.leagues.map((league, index) => (
                      <View key={index} style={styles.groupLeagueItem}>
                        <Text style={styles.groupLeagueName}>{league.name}</Text>
                        <Text style={styles.groupLeagueDetails}>
                          {league.group_name}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.groupDetailEmpty}>
                      Nessuna lega trovata
                    </Text>
                  )}
                </View>
              </ScrollView>
            )}
            
            {/* Floating Action Button per aggiungere giocatori */}
            {selectedPlayerCluster && hasAvailablePlayers && (
              <TouchableOpacity
                style={styles.fab}
                onPress={() => {
                  const groupId = selectedPlayerCluster.leagues[0]?.group_id;
                  const existingLeagueIds = selectedPlayerCluster.leagues.map(l => l.id);
                  if (groupId) {
                    searchAvailablePlayersForCluster(selectedPlayerCluster.name, groupId, existingLeagueIds);
                  }
                }}
                disabled={loadingAvailablePlayers}
              >
                {loadingAvailablePlayers ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="add" size={28} color="#fff" />
                )}
              </TouchableOpacity>
            )}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
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
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  tabContainer: {
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
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 6,
  },
  tabActive: {
    backgroundColor: '#667eea',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
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
  listContent: {
    padding: 16,
    paddingTop: 0,
    paddingLeft: 0,
    paddingRight: 0,
  },
  columnsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 0,
    paddingRight: 0,
    paddingVertical: 12,
    backgroundColor: '#667eea',
    borderBottomWidth: 1,
    borderBottomColor: '#5a6fd8',
    gap: 8,
  },
  columnHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
    textTransform: 'uppercase',
  },
  sortableColumn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 16,
    paddingRight: 0,
    paddingLeft: 0,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    marginLeft: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    gap: 8,
  },
  userInfoColumn: {
    flex: 2,
    minWidth: 120,
  },
  columnWithPadding: {
    paddingLeft: 16,
  },
  columnWithPaddingRight: {
    paddingRight: 16,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  superuserBadge: {
    backgroundColor: '#ffc107',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  superuserBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#333',
  },
  userEmail: {
    fontSize: 11,
    color: '#666',
  },
  lastAccessColumn: {
    flex: 0.9,
    minWidth: 75,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  lastAccessText: {
    fontSize: 10,
    color: '#666',
  },
  statusColumn: {
    flex: 0.8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 60,
  },
  buttonColumn: {
    flex: 1.5,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonColumnHeader: {
    flex: 1.5,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ccc',
    marginBottom: 4,
  },
  statusIndicatorOnline: {
    backgroundColor: '#28a745',
  },
  userStatus: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  toggleSuperuserButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 13,
    paddingVertical: 13,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#667eea',
    minWidth: 42,
    minHeight: 42,
    overflow: 'hidden',
  },
  toggleSuperuserButtonActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  toggleSuperuserText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#667eea',
  },
  toggleSuperuserTextActive: {
    color: '#fff',
  },
  leagueItem: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  leagueInfo: {
    marginBottom: 12,
    flex: 1,
  },
  leagueNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  leagueName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  officialCheckbox: {
    padding: 4,
    marginLeft: 8,
  },
  leagueOfficialGroup: {
    fontSize: 12,
    color: '#667eea',
    fontWeight: '500',
    marginBottom: 4,
  },
  leagueDetails: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  leagueCreated: {
    fontSize: 12,
    color: '#999',
  },
  leagueActions: {
    flexDirection: 'row',
    gap: 8,
  },
  leagueActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#667eea',
    gap: 4,
    flex: 1,
    justifyContent: 'center',
  },
  leagueActionButtonAdmin: {
    borderColor: '#28a745',
  },
  leagueActionButtonDanger: {
    borderColor: '#dc3545',
  },
  leagueActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#667eea',
  },
  leagueActionTextAdmin: {
    color: '#28a745',
  },
  leagueActionTextDanger: {
    color: '#dc3545',
  },
  errorsPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  errorsPlaceholderText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
    marginBottom: 8,
  },
  errorsPlaceholderSubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 16,
  },
  playerClusterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  playerClusterInfo: {
    flex: 1,
  },
  playerClusterName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  playerClusterLeaguesCount: {
    fontSize: 13,
    color: '#666',
  },
  modalHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addPlayerButton: {
    padding: 4,
  },
  availablePlayerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  availablePlayerInfo: {
    flex: 1,
  },
  availablePlayerName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  availablePlayerLeague: {
    fontSize: 13,
    color: '#666',
  },
  addToClusterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#e8f5e9',
    gap: 6,
  },
  addToClusterButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4CAF50',
  },
  filterContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterButtonActive: {
    // Stile attivo
  },
  filterText: {
    fontSize: 14,
    color: '#666',
  },
  filterTextActive: {
    color: '#667eea',
    fontWeight: '600',
  },
  officialGroupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  officialGroupInfo: {
    flex: 1,
  },
  officialGroupName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  officialGroupDescription: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  officialGroupStats: {
    fontSize: 12,
    color: '#999',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 100,
    flex: 1,
    position: 'relative',
    overflow: 'visible',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    paddingHorizontal: 16,
    paddingTop: 8,
    marginBottom: 16,
  },
  modalScrollView: {
    flex: 1,
    maxHeight: 600,
  },
  modalInputContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#fff',
  },
  modalTextArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 8,
    marginHorizontal: 16,
    marginTop: 8,
    gap: 8,
  },
  modalButtonPrimary: {
    backgroundColor: '#667eea',
  },
  modalButtonSecondary: {
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#667eea',
  },
  modalButtonDanger: {
    backgroundColor: '#dc3545',
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  groupOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  groupOptionInfo: {
    flex: 1,
  },
  groupOptionName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  groupOptionDescription: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  groupOptionStats: {
    fontSize: 12,
    color: '#999',
  },
  createGroupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#f0f4ff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    gap: 8,
  },
  createGroupButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#667eea',
  },
  groupDetailDescription: {
    fontSize: 14,
    color: '#666',
    paddingHorizontal: 16,
    marginBottom: 16,
    lineHeight: 20,
  },
  groupDetailSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  groupLeagueItem: {
    padding: 16,
    backgroundColor: '#f9f9f9',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
  },
  groupLeagueName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  groupLeagueDetails: {
    fontSize: 13,
    color: '#666',
  },
  groupDetailEmpty: {
    fontSize: 14,
    color: '#999',
    paddingHorizontal: 16,
    paddingVertical: 20,
    textAlign: 'center',
  },
  groupDetailActions: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  // Cluster styles
  clusterFilters: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    gap: 8,
  },
  clusterFilterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  clusterFilterButtonActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  clusterFilterText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  clusterFilterTextActive: {
    color: '#fff',
  },
  clusterSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
  },
  suggestionItem: {
    padding: 16,
    backgroundColor: '#f9f9f9',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  suggestionPlayers: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  suggestionPlayerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  suggestionLeague: {
    fontSize: 12,
    color: '#666',
  },
  suggestionArrow: {
    fontSize: 16,
    color: '#667eea',
    marginHorizontal: 4,
  },
  suggestionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#e8f5e9',
    gap: 4,
  },
  suggestionButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4CAF50',
  },
  clusterItem: {
    padding: 16,
    backgroundColor: '#f9f9f9',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  clusterInfo: {
    flex: 1,
  },
  clusterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  clusterStatus: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  clusterPlayersCount: {
    fontSize: 12,
    color: '#999',
  },
  clusterPlayer: {
    paddingVertical: 4,
  },
  clusterPlayerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  clusterPlayerLeague: {
    fontSize: 12,
    color: '#666',
  },
  clusterActions: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: 8,
  },
  clusterActionButton: {
    padding: 4,
  },
  clusterEmptyText: {
    fontSize: 14,
    color: '#999',
    paddingHorizontal: 16,
    paddingVertical: 20,
    textAlign: 'center',
  },
  searchPlayerItem: {
    padding: 16,
    backgroundColor: '#f9f9f9',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  searchPlayerItemSelected: {
    backgroundColor: '#e8f5e9',
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  searchPlayerInfo: {
    flex: 1,
  },
  searchPlayerName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  searchPlayerDetails: {
    fontSize: 12,
    color: '#666',
  },
  selectedPlayerItem: {
    padding: 12,
    backgroundColor: '#e8f5e9',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
  },
  selectedPlayerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  selectedPlayerDetails: {
    fontSize: 12,
    color: '#666',
  },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#667eea',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    zIndex: 1000,
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


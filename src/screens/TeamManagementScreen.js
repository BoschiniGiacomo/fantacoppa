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
  Linking,
  Platform,
  Modal,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { leagueService, publicAssetUrl } from '../services/api';

/** Preset per colore maglia (formazioni partite). */
const OFFICIAL_JERSEY_COLOR_PRESETS = [
  '#c1121c',
  '#0857C3',
  '#38bdf8',
  '#f97316',
  '#ffc72c',
  '#008450',
  '#7c3aed',
  '#111827',
  '#ffffff',
];

function jerseyDraftPreviewHex(draft) {
  const t = (draft || '').trim();
  if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(t)) return '#a5b4fc';
  if (t.length === 4) {
    return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`;
  }
  return t;
}

function isJerseyWhiteHexString(hex) {
  if (!hex || typeof hex !== 'string') return false;
  const h = hex.trim().toLowerCase();
  return h === '#fff' || h === '#ffffff';
}

/** Logo squadra ufficiale: `logo_url` dall’API o `publicAssetUrl(logo_path)`. */
function OfficialTeamRowLogo({ logoUrl, logoPath, style, fallbackStyle }) {
  const logoPathUri = logoPath ? publicAssetUrl(logoPath) : null;
  const logoUrlUri = logoUrl ? publicAssetUrl(logoUrl) : null;
  // Niente fallback Altervista: tutto deve arrivare dal backend nuovo.
  const candidates = [logoPathUri, logoUrlUri].filter(Boolean);
  const [uriIndex, setUriIndex] = useState(0);
  const [cacheBust, setCacheBust] = useState(() => `${Date.now()}`);
  useEffect(() => {
    setUriIndex(0);
    setCacheBust(`${Date.now()}`);
  }, [logoPathUri, logoUrlUri]);

  const rawUri = candidates[uriIndex] || null;
  const uri = rawUri ? `${rawUri}${rawUri.includes('?') ? '&' : '?'}v=${encodeURIComponent(cacheBust)}` : null;
  if (!uri) {
    return (
      <View style={fallbackStyle}>
        <Ionicons name="shield" size={16} color="#667eea" />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={style}
      onError={() => {
        if (uriIndex < candidates.length - 1) {
          setUriIndex((i) => i + 1);
        }
      }}
    />
  );
}

export default function TeamManagementScreen({ route, navigation }) {
  const { leagueId } = route.params || {};
  const insets = useSafeAreaInsets();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [expandedTeamId, setExpandedTeamId] = useState(null);
  const [teamPlayers, setTeamPlayers] = useState({}); // { teamId: [players] }
  const [loadingPlayers, setLoadingPlayers] = useState({}); // { teamId: boolean }
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingPlayerId, setDeletingPlayerId] = useState(null);
  const [uploadingTeamLogoId, setUploadingTeamLogoId] = useState(null);
  const [jerseyColorModalTeam, setJerseyColorModalTeam] = useState(null);
  const [jerseyColorDraft, setJerseyColorDraft] = useState('');
  const [savingJerseyColor, setSavingJerseyColor] = useState(false);
  const [playerSort, setPlayerSort] = useState({}); // { teamId: 'role' | 'name' | 'surname' }
  
  // Form fields per modifica giocatore
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState('P');
  const [rating, setRating] = useState('');
  const [shirtNumber, setShirtNumber] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  
  // Form fields per aggiunta nuovo giocatore
  const [newPlayerFirstName, setNewPlayerFirstName] = useState('');
  const [newPlayerLastName, setNewPlayerLastName] = useState('');
  const [newPlayerRole, setNewPlayerRole] = useState('P');
  const [newPlayerRating, setNewPlayerRating] = useState('');
  const [newPlayerTeamId, setNewPlayerTeamId] = useState(null);
  const [addingPlayer, setAddingPlayer] = useState(false);
  
  // Stati per le tendine
  const [showAddTeamForm, setShowAddTeamForm] = useState(false);
  const [showAddPlayerForm, setShowAddPlayerForm] = useState(false);
  
  // Stato per il modal di selezione squadra
  const [showTeamSelectModal, setShowTeamSelectModal] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  
  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useEffect(() => {
    loadTeams();
  }, [leagueId]);

  // (debug removed for cleanliness)

  const loadTeams = async () => {
    try {
      setLoading(true);
      const res = await leagueService.getTeams(leagueId);
      
      // Assicurati che teams sia sempre un array
      let teamsData = res.data;
      if (!Array.isArray(teamsData)) {
        if (teamsData && typeof teamsData === 'object') {
          teamsData = Object.values(teamsData);
        } else {
          teamsData = [];
        }
      }
      // Fallback robusto: se API non fornisce player_count, calcolalo dai player del team.
      const missingCountTeams = teamsData.filter((t) => typeof t?.player_count === 'undefined');
      if (missingCountTeams.length > 0) {
        const counts = await Promise.all(
          missingCountTeams.map(async (t) => {
            try {
              const teamId = Number(t?.id);
              if (!Number.isFinite(teamId) || teamId <= 0) return { teamId, count: 0 };
              const pRes = await leagueService.getTeamPlayers(leagueId, teamId);
              const arr = Array.isArray(pRes?.data)
                ? pRes.data
                : (pRes?.data && typeof pRes.data === 'object' ? Object.values(pRes.data) : []);
              return { teamId, count: arr.length };
            } catch (_) {
              return { teamId: Number(t?.id || 0), count: 0 };
            }
          })
        );
        const mapCount = new Map(counts.map((c) => [c.teamId, c.count]));
        teamsData = teamsData.map((t) => ({
          ...t,
          player_count: Number(
            typeof t?.player_count !== 'undefined'
              ? t.player_count
              : (mapCount.get(Number(t?.id)) ?? 0)
          ),
        }));
      } else {
        teamsData = teamsData.map((t) => ({ ...t, player_count: Number(t?.player_count || 0) }));
      }

      setTeams(teamsData);
    } catch (error) {
      console.error('Error loading teams:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Impossibile caricare le squadre';
      showToast(errorMessage);
      setTeams([]); // Imposta array vuoto in caso di errore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleAddTeam = async () => {
    if (!teamName.trim()) {
      showToast('Inserisci un nome per la squadra');
      return;
    }

    try {
      setAdding(true);
      await leagueService.addTeam(leagueId, teamName.trim());
      setTeamName('');
      showToast('Squadra aggiunta con successo', 'success');
      await loadTeams();
    } catch (error) {
      console.error('Error adding team:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Impossibile aggiungere la squadra';
      showToast(errorMessage);
    } finally {
      setAdding(false);
    }
  };

  const handleDownloadTemplate = async (type) => {
    try {
      setDownloading(true);
      const response = type === 'teams' 
        ? await leagueService.downloadTemplateTeams(leagueId)
        : await leagueService.downloadTemplatePlayers(leagueId);
      
      const text = await response.text();
      const filename = type === 'teams' ? 'template_squadre.csv' : 'template_giocatori.csv';
      const file = new File(Paths.document, filename);
      file.write(text);
      
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/csv',
        dialogTitle: `Salva ${filename}`,
      });
    } catch (error) {
      console.error('Error downloading template:', error);
      showToast(error.message || 'Impossibile scaricare il template');
    } finally {
      setDownloading(false);
    }
  };

  const handleExport = async (type) => {
    try {
      setDownloading(true);
      const response = type === 'teams'
        ? await leagueService.exportTeams(leagueId)
        : await leagueService.exportPlayers(leagueId);
      
      const text = await response.text();
      const filename = type === 'teams' 
        ? `squadre_lega_${leagueId}.csv`
        : `giocatori_lega_${leagueId}.csv`;
      const file = new File(Paths.document, filename);
      file.write(text);
      
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/csv',
        dialogTitle: `Salva ${filename}`,
      });
    } catch (error) {
      console.error('Error exporting:', error);
      showToast(error.message || 'Impossibile esportare i dati');
    } finally {
      setDownloading(false);
    }
  };

  const handleImportCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });
      
      // Nuova API: result.canceled + result.assets[]
      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }
      
      const picked = result.assets[0];
      setImporting(true);
      
      const res = await leagueService.importCSV(leagueId, picked.uri, picked.name);
      
      const message = res.message || 'Import completato';
      const imported = res.imported || 0;
      const skipped = res.skipped || 0;
      const errors = res.errors || [];
      
      let alertMessage = `${message}\n\nImportati: ${imported}\nSaltati: ${skipped}`;
      if (errors.length > 0) {
        alertMessage += `\n\nErrori (primi 10):\n${errors.slice(0, 10).join('\n')}`;
      }
      
      showToast(alertMessage, 'success');
      await loadTeams();
    } catch (error) {
      console.error('Error importing CSV:', error);
      showToast(error.message || 'Impossibile importare il file CSV');
    } finally {
      setImporting(false);
    }
  };

  const handleSaveJerseyColor = async () => {
    if (!jerseyColorModalTeam) return;
    try {
      setSavingJerseyColor(true);
      const raw = jerseyColorDraft.trim();
      await leagueService.updateOfficialTeamJerseyColor(leagueId, jerseyColorModalTeam.id, raw === '' ? '' : raw);
      showToast('Colore maglia salvato', 'success');
      setJerseyColorModalTeam(null);
      await loadTeams();
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Errore salvataggio colore';
      showToast(errorMessage);
    } finally {
      setSavingJerseyColor(false);
    }
  };

  const handleDeleteTeam = async (teamId, teamName) => {
    setConfirmModal({
      title: 'Conferma eliminazione',
      message: `Sei sicuro di voler eliminare la squadra "${teamName}"? Verranno eliminati anche tutti i giocatori associati.`,
      confirmText: 'Elimina',
      destructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          setDeletingId(teamId);
          await leagueService.deleteTeam(leagueId, teamId);
          showToast('Squadra eliminata con successo', 'success');
          await loadTeams();
        } catch (error) {
          console.error('Error deleting team:', error);
          const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Impossibile eliminare la squadra';
          showToast(errorMessage);
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  const renderRightActions = (team) => {
    return (
      <TouchableOpacity
        style={styles.deleteAction}
        onPress={() => handleDeleteTeam(team.id, team.name)}
        disabled={deletingId === team.id}
      >
        {deletingId === team.id ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Ionicons name="trash" size={24} color="#fff" />
            <Text style={styles.deleteActionText}>Elimina</Text>
          </>
        )}
      </TouchableOpacity>
    );
  };

  const toggleTeam = async (teamId) => {
    if (expandedTeamId === teamId) {
      // Chiudi la tendina
      setExpandedTeamId(null);
    } else {
      // Apri la tendina e carica i giocatori se non già caricati
      setExpandedTeamId(teamId);
      if (!teamPlayers[teamId]) {
        await loadTeamPlayers(teamId);
      }
    }
  };

  const loadTeamPlayers = async (teamId) => {
    try {
      setLoadingPlayers(prev => ({ ...prev, [teamId]: true }));
      const res = await leagueService.getTeamPlayers(leagueId, teamId);
      let playersData = res.data;
      if (!Array.isArray(playersData)) {
        if (playersData && typeof playersData === 'object') {
          playersData = Object.values(playersData);
        } else {
          playersData = [];
        }
      }
      playersData = playersData.map((p) => {
        const normalizedRating = Number(
          p?.rating ??
          p?.valutazione ??
          p?.credits ??
          0
        );
        const normalizedShirt = p?.shirt_number ?? p?.numero_maglia ?? null;
        return {
          ...p,
          rating: Number.isFinite(normalizedRating) ? normalizedRating : 0,
          shirt_number: normalizedShirt,
        };
      });
      setTeamPlayers(prev => ({ ...prev, [teamId]: playersData }));
    } catch (error) {
      console.error('Error loading players:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Impossibile caricare i giocatori';
      showToast(errorMessage);
      setTeamPlayers(prev => ({ ...prev, [teamId]: [] }));
    } finally {
      setLoadingPlayers(prev => ({ ...prev, [teamId]: false }));
    }
  };

  const handleAddPlayer = async () => {
    if (!newPlayerFirstName.trim() || !newPlayerLastName.trim()) {
      showToast('Inserisci nome e cognome del giocatore');
      return;
    }
    if (!newPlayerTeamId) {
      showToast('Seleziona una squadra');
      return;
    }
    if (!newPlayerRating || isNaN(parseFloat(newPlayerRating))) {
      showToast('Inserisci una valutazione valida');
      return;
    }

    try {
      setAddingPlayer(true);
      await leagueService.addPlayer(leagueId, newPlayerTeamId, {
        first_name: newPlayerFirstName.trim(),
        last_name: newPlayerLastName.trim(),
        role: newPlayerRole,
        rating: parseFloat(newPlayerRating),
      });
      
      showToast('Giocatore aggiunto con successo!', 'success');
      
      // Reset form
      setNewPlayerFirstName('');
      setNewPlayerLastName('');
      setNewPlayerRole('P');
      setNewPlayerRating('');
      setNewPlayerTeamId(null);
      
      // Ricarica le squadre per aggiornare i conteggi
      await loadTeams();
      
      // Se la squadra è espansa, ricarica anche i giocatori
      if (expandedTeamId === newPlayerTeamId) {
        await loadTeamPlayers(newPlayerTeamId);
      }
    } catch (error) {
      console.error('Error adding player:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Errore durante l\'aggiunta del giocatore';
      showToast(errorMessage);
    } finally {
      setAddingPlayer(false);
    }
  };

  const handleEditPlayer = (player, teamId) => {
    const ratingValue = player.rating !== null && player.rating !== undefined 
      ? String(player.rating) 
      : '0.0';
    
    setFirstName(player.first_name || '');
    setLastName(player.last_name || '');
    setRole(player.role || 'P');
    setRating(ratingValue);
    setShirtNumber(player.shirt_number === null || typeof player.shirt_number === 'undefined' ? '' : String(player.shirt_number));
    setSelectedTeamId(teamId);
    
    const playerWithTeamId = { ...player, teamId };
    setEditingPlayer(playerWithTeamId);
    setShowEditModal(true);
  };

  const handleSavePlayer = async () => {
    if (!editingPlayer) {
      showToast('Nessun giocatore selezionato');
      return;
    }

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
      const originalTeamId = editingPlayer.teamId;
      const savedPlayerId = editingPlayer.id;
      const newTeamId = selectedTeamId || originalTeamId;
      
      const dataToSave = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        role: role,
        rating: parseFloat(rating),
        shirt_number: shirtNumber === '' ? null : Number(shirtNumber),
      };
      
      // Aggiungi team_id solo se è stato modificato
      if (newTeamId !== originalTeamId) {
        dataToSave.team_id = newTeamId;
      }
      
      const response = await leagueService.updatePlayer(leagueId, originalTeamId, savedPlayerId, dataToSave);
      await loadTeamPlayers(originalTeamId);
      
      // Controlla se il messaggio indica che non ci sono modifiche
      const responseMessage = response?.data?.message || '';
      if (responseMessage.includes('Nessuna modifica necessaria')) {
        // Non mostrare alert, semplicemente chiudi il modal
        setShowEditModal(false);
        setEditingPlayer(null);
        setFirstName('');
        setLastName('');
        setRole('P');
        setRating('');
        setShirtNumber('');
      } else {
        showToast(responseMessage || 'Giocatore aggiornato con successo!', 'success');
        setShowEditModal(false);
        setEditingPlayer(null);
        setFirstName('');
        setLastName('');
        setRole('P');
        setRating('');
        setShirtNumber('');
        setSelectedTeamId(null);
        
        // Ricarica anche le squadre per aggiornare il conteggio
        await loadTeams();
        
        // Se il giocatore è stato spostato in un'altra squadra, ricarica entrambe le squadre
        if (newTeamId !== originalTeamId) {
          await loadTeamPlayers(originalTeamId);
          await loadTeamPlayers(newTeamId);
          // Se la nuova squadra è espansa, assicurati che sia visibile
          if (expandedTeamId === originalTeamId) {
            setExpandedTeamId(newTeamId);
          }
        } else {
          // Ricarica i giocatori della squadra corrente
          await loadTeamPlayers(originalTeamId);
        }
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Errore durante l\'aggiornamento del giocatore';
      // Non mostrare errore se il messaggio indica che non ci sono modifiche
      if (!errorMessage.includes('Nessuna modifica')) {
        showToast(errorMessage);
      } else {
        // Se non ci sono modifiche, chiudi semplicemente il modal
        setShowEditModal(false);
        setEditingPlayer(null);
        setFirstName('');
        setLastName('');
        setRole('P');
        setRating('');
        setShirtNumber('');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlayer = async (playerId, playerName, teamId) => {
    setConfirmModal({
      title: 'Conferma eliminazione',
      message: `Sei sicuro di voler eliminare ${playerName}?`,
      confirmText: 'Elimina',
      destructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          setDeletingPlayerId(playerId);
          await leagueService.deletePlayer(leagueId, teamId, playerId);
          showToast('Giocatore eliminato con successo!', 'success');
          await loadTeamPlayers(teamId);
          await loadTeams();
        } catch (error) {
          console.error('Error deleting player:', error);
          const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Errore durante l\'eliminazione del giocatore';
          showToast(errorMessage);
        } finally {
          setDeletingPlayerId(null);
        }
      },
    });
  };

  const getRoleColor = (r) => {
    const colors = { P: '#0d6efd', D: '#198754', C: '#e6a800', A: '#dc3545' };
    return colors[r] || '#999';
  };

  const getRoleIonicon = (r) => {
    switch (r) {
      case 'P': return 'hand-left';
      case 'D': return 'shield';
      case 'C': return 'flash';
      case 'A': return 'flame';
      default: return 'person';
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

  const roleOrder = { P: 0, D: 1, C: 2, A: 3 };

  const sortPlayers = (players, teamId) => {
    const mode = playerSort[teamId] || 'role';
    const sorted = [...players];
    if (mode === 'name') {
      sorted.sort((a, b) => (a.first_name || '').localeCompare(b.first_name || ''));
    } else if (mode === 'surname') {
      sorted.sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''));
    } else {
      sorted.sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9));
    }
    return sorted;
  };

  const renderPlayerItem = (player, teamId) => {
    return (
      <Swipeable
        key={player.id}
        renderRightActions={() => (
          <View style={styles.playerActionsContainer}>
            <TouchableOpacity
              style={styles.playerEditButton}
              onPress={() => handleEditPlayer(player, teamId)}
            >
              <Ionicons name="pencil" size={16} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.playerDeleteButton}
              onPress={() => handleDeletePlayer(player.id, `${player.first_name} ${player.last_name}`, teamId)}
            >
              {deletingPlayerId === player.id ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="trash" size={16} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        )}
        overshootRight={false}
      >
        <View style={styles.playerItem}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 4, height: 32, borderRadius: 2, backgroundColor: getRoleColor(player.role), marginRight: 10 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.playerName}>
                {player.first_name} {player.last_name}
              </Text>
              <View style={styles.playerDetails}>
                <View style={[styles.roleBadge, { backgroundColor: getRoleColor(player.role) + '18' }]}>
                  <Ionicons name={getRoleIonicon(player.role)} size={12} color={getRoleColor(player.role)} style={{ marginRight: 4 }} />
                  <Text style={[styles.roleText, { color: getRoleColor(player.role) }]}>{getRoleLabel(player.role)}</Text>
                </View>
                <View style={styles.ratingBadge}>
                  <Text style={styles.ratingText}>
                    {Number.isFinite(Number(player?.rating)) ? Number(player.rating).toFixed(1) : '0.0'}
                  </Text>
                </View>
                <View style={styles.ratingBadge}>
                  <Text style={styles.ratingText}>#{player?.shirt_number ?? '-'}</Text>
                </View>
              </View>
            </View>
            <Ionicons name="chevron-back" size={14} color="#ccc" style={{ marginLeft: 4 }} />
          </View>
        </View>
      </Swipeable>
    );
  };

  const renderTeamItem = (team) => {
    const isExpanded = expandedTeamId === team.id;
    const players = teamPlayers[team.id] || [];
    const isLoading = loadingPlayers[team.id];
    const hasTeamLogo = !!(team.logo_url || team.logo_path);

    const handleUploadTeamLogo = async () => {
      try {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          showToast('Concedi accesso alla galleria per selezionare un logo');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaType?.Images || 'images',
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
        if (result.canceled || !result.assets || result.assets.length === 0) return;
        const picked = result.assets[0];
        const imageUri = picked.uri;
        const fileSizeBytes = Number(picked?.fileSize || 0);
        const sizeMb = fileSizeBytes > 0 ? fileSizeBytes / (1024 * 1024) : 0;
        if (sizeMb > 2) {
          showToast('Il file è troppo grande. Massimo 2MB');
          return;
        }
        setUploadingTeamLogoId(team.id);
        await leagueService.uploadOfficialTeamLogo(leagueId, team.id, imageUri);
        showToast('Logo squadra aggiornato', 'success');
        await loadTeams();
      } catch (error) {
        const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Errore caricamento logo';
        showToast(errorMessage);
      } finally {
        setUploadingTeamLogoId(null);
      }
    };

    const openJerseyColorModal = () => {
      setJerseyColorDraft(team.jersey_color || '');
      setJerseyColorModalTeam(team);
    };

    const handleRemoveTeamLogo = async () => {
      if (!hasTeamLogo) return;
      setConfirmModal({
        title: 'Rimuovi logo squadra',
        message: `Vuoi rimuovere il logo di "${team.name}"?`,
        confirmText: 'Rimuovi',
        destructive: true,
        onConfirm: async () => {
          setConfirmModal(null);
          try {
            setUploadingTeamLogoId(team.id);
            await leagueService.removeOfficialTeamLogo(leagueId, team.id);
            showToast('Logo squadra rimosso', 'success');
            await loadTeams();
          } catch (error) {
            const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Errore rimozione logo';
            showToast(errorMessage);
          } finally {
            setUploadingTeamLogoId(null);
          }
        },
      });
    };

    return (
      <View key={team.id} style={styles.teamContainer}>
        <Swipeable
          renderRightActions={() => renderRightActions(team)}
          overshootRight={false}
        >
          <TouchableOpacity
            style={[styles.teamItem, isExpanded && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomColor: '#eee' }]}
            onPress={() => toggleTeam(team.id)}
            activeOpacity={0.7}
          >
            <OfficialTeamRowLogo
              logoUrl={team.logo_url}
              logoPath={team.logo_path}
              style={styles.teamLogo}
              fallbackStyle={styles.teamLogoFallback}
            />
            <Text style={styles.teamName} numberOfLines={1}>{team.name}</Text>
            <TouchableOpacity
              style={styles.jerseyColorSwatchBtn}
              onPress={openJerseyColorModal}
              accessibilityLabel="Colore maglia formazioni"
            >
              <View
                style={[
                  styles.jerseyColorSwatchInner,
                  team.jersey_color ? { backgroundColor: team.jersey_color } : styles.jerseyColorSwatchPlaceholder,
                  isJerseyWhiteHexString(team.jersey_color) && styles.jerseyColorSwatchInnerWhite,
                ]}
              />
            </TouchableOpacity>
            <TouchableOpacity style={styles.teamLogoActionBtn} onPress={handleUploadTeamLogo}>
              {uploadingTeamLogoId === team.id ? (
                <ActivityIndicator size="small" color="#667eea" />
              ) : (
                <Ionicons name="camera-outline" size={14} color="#667eea" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.teamLogoActionBtn, !hasTeamLogo && styles.teamLogoActionBtnDisabled]}
              onPress={handleRemoveTeamLogo}
              disabled={!hasTeamLogo || uploadingTeamLogoId === team.id}
            >
              <Ionicons name="trash-outline" size={14} color={!hasTeamLogo ? '#bbb' : '#dc3545'} />
            </TouchableOpacity>
            <View style={styles.playerCountBadge}>
              <Text style={styles.playerCountText}>{Number(team?.player_count || 0)}</Text>
            </View>
            <Ionicons 
              name={isExpanded ? "chevron-down" : "chevron-forward"} 
              size={16} 
              color="#b0b0b0" 
            />
          </TouchableOpacity>
        </Swipeable>
        
        {isExpanded && (
          <View style={styles.playersContainer}>
            {isLoading ? (
              <View style={styles.playersLoading}>
                <ActivityIndicator size="small" color="#667eea" />
                <Text style={styles.playersLoadingText}>Caricamento giocatori...</Text>
              </View>
            ) : players.length === 0 ? (
              <View style={styles.playersEmpty}>
                <Text style={styles.playersEmptyText}>Nessun giocatore presente</Text>
              </View>
            ) : (
              <>
                <View style={styles.sortBar}>
                  {[
                    { key: 'role', label: 'Ruolo', icon: 'layers-outline' },
                    { key: 'name', label: 'Nome', icon: 'text-outline' },
                    { key: 'surname', label: 'Cognome', icon: 'person-outline' },
                  ].map((s) => {
                    const active = (playerSort[team.id] || 'role') === s.key;
                    return (
                      <TouchableOpacity
                        key={s.key}
                        style={[styles.sortChip, active && styles.sortChipActive]}
                        onPress={() => setPlayerSort(prev => ({ ...prev, [team.id]: s.key }))}
                        activeOpacity={0.7}
                      >
                        <Ionicons name={s.icon} size={12} color={active ? '#fff' : '#999'} />
                        <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>{s.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {sortPlayers(players, team.id).map((player) => renderPlayerItem(player, team.id))}
              </>
            )}
          </View>
        )}
      </View>
    );
  };

  if (loading && teams.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color="#667eea" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Gestione Squadre</Text>
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
        <Text style={styles.headerTitle}>Gestione Squadre</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={loadTeams} colors={['#667eea']} tintColor="#667eea" />
        }
      >
        {/* Form aggiunta squadra - Tendina */}
        <View style={styles.accordionContainer}>
          <TouchableOpacity
            style={styles.accordionHeader}
            onPress={() => setShowAddTeamForm(!showAddTeamForm)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="shield-outline" size={18} color="#667eea" />
              <Text style={styles.accordionTitle}>Aggiungi Squadra</Text>
            </View>
            <Ionicons 
              name={showAddTeamForm ? "chevron-down" : "chevron-forward"} 
              size={18} 
              color="#b0b0b0" 
            />
          </TouchableOpacity>
          {showAddTeamForm && (
            <View style={styles.accordionContent}>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  value={teamName}
                  onChangeText={setTeamName}
                  placeholder="Nome squadra"
                  onSubmitEditing={handleAddTeam}
                />
                <TouchableOpacity
                  style={[styles.addButton, adding && styles.addButtonDisabled]}
                  onPress={handleAddTeam}
                  disabled={adding}
                >
                  {adding ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="add" size={20} color="#fff" />
                      <Text style={styles.addButtonText}>Aggiungi</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Form aggiunta giocatore - Tendina */}
        <View style={styles.accordionContainer}>
          <TouchableOpacity
            style={styles.accordionHeader}
            onPress={() => setShowAddPlayerForm(!showAddPlayerForm)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="person-add-outline" size={18} color="#667eea" />
              <Text style={styles.accordionTitle}>Aggiungi Giocatore</Text>
            </View>
            <Ionicons 
              name={showAddPlayerForm ? "chevron-down" : "chevron-forward"} 
              size={18} 
              color="#b0b0b0" 
            />
          </TouchableOpacity>
          {showAddPlayerForm && (
            <View style={styles.accordionContent}>
              {/* Selezione squadra */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>Squadra</Text>
                <TouchableOpacity
                  style={styles.selectInput}
                  onPress={() => setShowTeamSelectModal(true)}
                >
                  <Text style={[styles.selectInputText, !newPlayerTeamId && styles.selectInputPlaceholder]}>
                    {newPlayerTeamId 
                      ? teams.find(t => t.id === newPlayerTeamId)?.name || 'Seleziona squadra'
                      : 'Seleziona squadra'}
                  </Text>
                  <Ionicons name="chevron-down" size={20} color="#667eea" />
                </TouchableOpacity>
              </View>

              {/* Nome e cognome */}
              <View style={styles.inputRow}>
                <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                  <Text style={styles.label}>Nome</Text>
                  <TextInput
                    style={styles.input}
                    value={newPlayerFirstName}
                    onChangeText={setNewPlayerFirstName}
                    placeholder="Nome"
                    autoCapitalize="words"
                  />
                </View>
                <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                  <Text style={styles.label}>Cognome</Text>
                  <TextInput
                    style={styles.input}
                    value={newPlayerLastName}
                    onChangeText={setNewPlayerLastName}
                    placeholder="Cognome"
                    autoCapitalize="words"
                  />
                </View>
              </View>

              {/* Ruolo e valutazione */}
              <View style={styles.inputRow}>
                <View style={[styles.formGroup, { flex: 2, marginRight: 8 }]}>
                  <Text style={styles.label}>Ruolo</Text>
                  <View style={styles.roleSelector}>
                    {['P', 'D', 'C', 'A'].map((r) => (
                      <TouchableOpacity
                        key={r}
                        style={[styles.roleOption, newPlayerRole === r && styles.roleOptionActive]}
                        onPress={() => setNewPlayerRole(r)}
                      >
                        <Text style={[styles.roleOptionText, newPlayerRole === r && styles.roleOptionTextActive]}>
                          {r}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                  <Text style={styles.label}>Valutazione</Text>
                  <TextInput
                    style={styles.inputNarrow}
                    value={newPlayerRating}
                    onChangeText={setNewPlayerRating}
                    placeholder="0.0"
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[styles.addButton, (addingPlayer || !newPlayerTeamId) && styles.addButtonDisabled]}
                onPress={handleAddPlayer}
                disabled={addingPlayer || !newPlayerTeamId}
              >
                {addingPlayer ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="person-add" size={20} color="#fff" />
                    <Text style={styles.addButtonText}>Aggiungi Giocatore</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Sezione CSV */}
        <View style={styles.csvSection}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Ionicons name="document-text-outline" size={18} color="#667eea" />
            <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Importa/Esporta CSV</Text>
          </View>
          
          <View style={styles.csvButtons}>
            <TouchableOpacity
              style={[styles.csvButton, styles.templateButton]}
              onPress={() => handleDownloadTemplate('teams')}
              disabled={downloading}
            >
              <Ionicons name="download-outline" size={18} color="#667eea" />
              <Text style={styles.csvButtonText}>Template Squadre</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.csvButton, styles.templateButton]}
              onPress={() => handleDownloadTemplate('players')}
              disabled={downloading}
            >
              <Ionicons name="download-outline" size={18} color="#28a745" />
              <Text style={styles.csvButtonText}>Template Giocatori</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.csvButtons}>
            <TouchableOpacity
              style={[styles.csvButton, styles.exportButton]}
              onPress={() => handleExport('teams')}
              disabled={downloading}
            >
              <Ionicons name="download" size={18} color="#fff" />
              <Text style={[styles.csvButtonText, styles.exportButtonText]}>Esporta Squadre</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.csvButton, styles.exportButton, { backgroundColor: '#28a745' }]}
              onPress={() => handleExport('players')}
              disabled={downloading}
            >
              <Ionicons name="download" size={18} color="#fff" />
              <Text style={[styles.csvButtonText, styles.exportButtonText]}>Esporta Giocatori</Text>
            </TouchableOpacity>
          </View>
          
          <TouchableOpacity
            style={[styles.csvButton, styles.importButton]}
            onPress={handleImportCSV}
            disabled={importing || downloading}
          >
            {importing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                <Text style={[styles.csvButtonText, styles.importButtonText]}>Importa CSV</Text>
              </>
            )}
          </TouchableOpacity>
          
          <Text style={styles.csvHelperText}>
            Carica un file CSV di squadre o giocatori. Il tipo verrà riconosciuto automaticamente.
          </Text>
        </View>

        {/* Lista squadre */}
        <View style={styles.teamsList}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Ionicons name="people-outline" size={18} color="#667eea" />
            <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Squadre ({Array.isArray(teams) ? teams.length : 0})</Text>
          </View>
          {!Array.isArray(teams) || teams.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={48} color="#ccc" />
              <Text style={styles.emptyText}>Nessuna squadra presente</Text>
              <Text style={styles.emptySubtext}>Aggiungi una squadra usando il form sopra</Text>
            </View>
          ) : (
            teams.map((team) => renderTeamItem(team))
          )}
        </View>
      </ScrollView>

      <Modal
        visible={!!jerseyColorModalTeam}
        transparent
        animationType="fade"
        onRequestClose={() => !savingJerseyColor && setJerseyColorModalTeam(null)}
      >
        <View style={styles.jerseyColorModalOverlay}>
          <View style={styles.jerseyColorModalCard}>
            <Text style={styles.jerseyColorModalTitle}>Colore maglia</Text>
            <Text style={styles.jerseyColorModalSubtitle} numberOfLines={2}>
              {jerseyColorModalTeam?.name} — usato nelle formazioni del dettaglio partita
            </Text>
            <Text style={styles.jerseyColorModalLabel}>Anteprima</Text>
            <View style={styles.jerseyColorPreviewRow}>
              <View
                style={[
                  styles.jerseyColorPreviewBadge,
                  isJerseyWhiteHexString(jerseyDraftPreviewHex(jerseyColorDraft)) && styles.jerseyColorPreviewBadgeWhiteShirt,
                ]}
              >
                <MaterialCommunityIcons name="tshirt-crew" size={40} color={jerseyDraftPreviewHex(jerseyColorDraft)} />
              </View>
            </View>
            <Text style={styles.jerseyColorModalLabel}>Preset</Text>
            <View style={styles.jerseyColorPresetRow}>
              {OFFICIAL_JERSEY_COLOR_PRESETS.map((hex) => (
                <TouchableOpacity
                  key={hex}
                  style={[
                    styles.jerseyColorPresetDot,
                    { backgroundColor: hex },
                    isJerseyWhiteHexString(hex) && styles.jerseyColorPresetDotWhite,
                  ]}
                  onPress={() => setJerseyColorDraft(hex)}
                />
              ))}
            </View>
            <Text style={styles.jerseyColorModalLabel}>Codice (#RGB o #RRGGBB)</Text>
            <TextInput
              style={styles.jerseyColorInput}
              value={jerseyColorDraft}
              onChangeText={setJerseyColorDraft}
              placeholder="#667eea"
              placeholderTextColor="#aaa"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.jerseyColorResetBtn}
              onPress={() => setJerseyColorDraft('')}
              disabled={savingJerseyColor}
            >
              <Text style={styles.jerseyColorResetBtnText}>Usa colore predefinito app</Text>
            </TouchableOpacity>
            <View style={styles.jerseyColorModalActions}>
              <TouchableOpacity
                style={styles.jerseyColorModalCancel}
                onPress={() => setJerseyColorModalTeam(null)}
                disabled={savingJerseyColor}
              >
                <Text style={styles.jerseyColorModalCancelText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.jerseyColorModalSave}
                onPress={handleSaveJerseyColor}
                disabled={savingJerseyColor}
              >
                {savingJerseyColor ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.jerseyColorModalSaveText}>Salva</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Team Select Modal */}
      <Modal
        visible={showTeamSelectModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowTeamSelectModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.selectModalContainer}>
            <View style={styles.selectModalHeader}>
              <Text style={styles.selectModalTitle}>Seleziona Squadra</Text>
              <TouchableOpacity
                onPress={() => setShowTeamSelectModal(false)}
                style={styles.selectModalCloseButton}
              >
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.selectModalList}>
              {teams.length === 0 ? (
                <View style={styles.selectModalEmpty}>
                  <Text style={styles.selectModalEmptyText}>Nessuna squadra disponibile</Text>
                </View>
              ) : (
                teams.map((team) => (
                  <TouchableOpacity
                    key={team.id}
                    style={[
                      styles.selectModalOption,
                      newPlayerTeamId === team.id && styles.selectModalOptionActive
                    ]}
                    onPress={() => {
                      setNewPlayerTeamId(team.id);
                      setShowTeamSelectModal(false);
                    }}
                  >
                    <Text style={[
                      styles.selectModalOptionText,
                      newPlayerTeamId === team.id && styles.selectModalOptionTextActive
                    ]}>
                      {team.name}
                    </Text>
                    {newPlayerTeamId === team.id && (
                      <Ionicons name="checkmark" size={20} color="#667eea" />
                    )}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit Modal */}
      <Modal
        key={editingPlayer?.id || 'new'}
        visible={showEditModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setShowEditModal(false);
          setEditingPlayer(null);
          setFirstName('');
          setLastName('');
          setRole('P');
          setRating('');
          setSelectedTeamId(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Modifica Giocatore</Text>
            {editingPlayer && (
              <>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Nome</Text>
                  <TextInput
                    style={styles.inputLarge}
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="Nome"
                    autoCapitalize="words"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Cognome</Text>
                  <TextInput
                    style={styles.inputLarge}
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Cognome"
                    autoCapitalize="words"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Squadra</Text>
                  <View style={styles.teamPickerContainer}>
                    {teams.length === 0 ? (
                      <Text style={styles.pickerPlaceholder}>Nessuna squadra disponibile</Text>
                    ) : (
                      <ScrollView style={styles.teamPickerScroll} horizontal showsHorizontalScrollIndicator={false}>
                        {teams.map((team) => (
                          <TouchableOpacity
                            key={team.id}
                            style={[
                              styles.teamPickerOption,
                              selectedTeamId === team.id && styles.teamPickerOptionActive
                            ]}
                            onPress={() => setSelectedTeamId(team.id)}
                          >
                            <Text style={[
                              styles.teamPickerOptionText,
                              selectedTeamId === team.id && styles.teamPickerOptionTextActive
                            ]}>
                              {team.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                  </View>
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
                          {r}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Valutazione</Text>
                  <TextInput
                    style={styles.inputLarge}
                    value={rating}
                    onChangeText={setRating}
                    placeholder="0.0"
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Numero maglia</Text>
                  <TextInput
                    style={styles.inputLarge}
                    value={shirtNumber}
                    onChangeText={setShirtNumber}
                    placeholder="es. 10"
                    keyboardType="number-pad"
                  />
                </View>
              </>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.cancelButton, saving && styles.buttonDisabled]}
                onPress={() => {
                  setShowEditModal(false);
                  setEditingPlayer(null);
                  setFirstName('');
                  setLastName('');
                  setRole('P');
                  setRating('');
                  setShirtNumber('');
                  setSelectedTeamId(null);
                }}
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
  // ── Base ──
  container: { flex: 1, backgroundColor: '#f2f3f7' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1 },

  // ── Header ──
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#f2f3f7' },
  backButton: { padding: 8 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#333' },

  // ── Accordion (aggiungi squadra / giocatore) ──
  accordionContainer: { backgroundColor: '#fff', marginHorizontal: 14, marginTop: 10, borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  accordionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: '#fff' },
  accordionTitle: { fontSize: 15, fontWeight: '700', color: '#333' },
  accordionContent: { padding: 14, paddingTop: 0, borderTopWidth: 1, borderTopColor: '#f0f0f0' },

  // ── Section titles ──
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 10 },

  // ── Input / forms ──
  inputContainer: { flexDirection: 'row', gap: 8 },
  inputRow: { flexDirection: 'row', gap: 8 },
  formGroup: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6 },
  input: { flex: 1, backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 10, padding: 11, fontSize: 15, color: '#333' },
  inputLarge: { backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 10, padding: 14, fontSize: 16, color: '#333', minHeight: 48 },
  inputNarrow: { backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 10, padding: 11, fontSize: 15, color: '#333', textAlign: 'center' },
  selectInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 10, padding: 11, minHeight: 44 },
  selectInputText: { fontSize: 15, color: '#333', flex: 1 },
  selectInputPlaceholder: { color: '#bbb' },

  // ── Buttons ──
  addButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#667eea', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, gap: 6, shadowColor: '#667eea', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 3 },
  addButtonDisabled: { opacity: 0.6 },
  addButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // ── Role selector ──
  roleSelector: { flexDirection: 'row', gap: 6 },
  roleOption: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e8e8e8', backgroundColor: '#f8f9fa', alignItems: 'center' },
  roleOptionActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  roleOptionText: { fontSize: 14, color: '#555', fontWeight: '600' },
  roleOptionTextActive: { color: '#fff' },

  // ── CSV section ──
  csvSection: { backgroundColor: '#fff', marginHorizontal: 14, marginTop: 10, padding: 14, borderRadius: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  csvButtons: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  csvButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10, gap: 6 },
  templateButton: { backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e8e8e8' },
  exportButton: { backgroundColor: '#667eea' },
  importButton: { backgroundColor: '#17a2b8', marginTop: 4, borderRadius: 10 },
  csvButtonText: { fontSize: 12, fontWeight: '600', color: '#555' },
  exportButtonText: { color: '#fff' },
  importButtonText: { color: '#fff' },
  csvHelperText: { fontSize: 11, color: '#999', marginTop: 6 },

  // ── Teams list ──
  teamsList: { paddingHorizontal: 14, paddingTop: 10 },
  teamContainer: { marginBottom: 8 },
  teamItem: { backgroundColor: '#fff', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderWidth: 1, borderColor: '#e8e8e8' },
  teamLogo: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#f7f7f7' },
  teamLogoFallback: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#f0f0ff', alignItems: 'center', justifyContent: 'center' },
  teamName: { fontSize: 15, fontWeight: '700', color: '#333', flex: 1 },
  teamLogoActionBtn: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  teamLogoActionBtnDisabled: { opacity: 0.5 },
  jerseyColorSwatchBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  jerseyColorSwatchInner: { width: 16, height: 16, borderRadius: 8 },
  jerseyColorSwatchInnerWhite: { borderWidth: 1.5, borderColor: '#1a1a1a' },
  jerseyColorSwatchPlaceholder: { backgroundColor: '#e8eaf6', borderWidth: 1, borderColor: '#c7cad8' },
  jerseyColorModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  jerseyColorModalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 360,
  },
  jerseyColorModalTitle: { fontSize: 18, fontWeight: '800', color: '#222' },
  jerseyColorModalSubtitle: { fontSize: 13, color: '#666', marginTop: 6, marginBottom: 14 },
  jerseyColorModalLabel: { fontSize: 12, fontWeight: '700', color: '#888', marginBottom: 8, marginTop: 4 },
  jerseyColorPreviewRow: { alignItems: 'center', marginBottom: 8 },
  jerseyColorPreviewBadge: { height: 52, justifyContent: 'center', alignItems: 'center' },
  jerseyColorPreviewBadgeWhiteShirt: {
    borderWidth: 2,
    borderColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  jerseyColorPresetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  jerseyColorPresetDot: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' },
  jerseyColorPresetDotWhite: { borderWidth: 2, borderColor: '#1a1a1a' },
  jerseyColorInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#222',
    marginBottom: 10,
  },
  jerseyColorResetBtn: { paddingVertical: 8, marginBottom: 8 },
  jerseyColorResetBtnText: { fontSize: 14, color: '#667eea', fontWeight: '600' },
  jerseyColorModalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  jerseyColorModalCancel: { paddingVertical: 12, paddingHorizontal: 16 },
  jerseyColorModalCancelText: { fontSize: 15, color: '#666', fontWeight: '600' },
  jerseyColorModalSave: {
    backgroundColor: '#667eea',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  jerseyColorModalSaveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  playerCountBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f0ff', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, gap: 4 },
  playerCountText: { fontSize: 12, color: '#667eea', fontWeight: '700' },
  deleteAction: { backgroundColor: '#e53935', justifyContent: 'center', alignItems: 'center', width: 90, borderRadius: 12, marginLeft: 8, gap: 4 },
  deleteActionText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // ── Empty state ──
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 15, color: '#888', marginTop: 14, fontWeight: '600' },
  emptySubtext: { fontSize: 13, color: '#bbb', marginTop: 6 },

  // ── Sort bar (per team) ──
  sortBar: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  sortChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: '#eee' },
  sortChipActive: { backgroundColor: '#667eea' },
  sortChipText: { fontSize: 11, fontWeight: '600', color: '#999' },
  sortChipTextActive: { color: '#fff' },

  // ── Players (expanded) ──
  playersContainer: { backgroundColor: '#f8f9fa', paddingHorizontal: 14, paddingVertical: 8, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, marginTop: -1 },
  playersLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 10 },
  playersLoadingText: { fontSize: 13, color: '#999' },
  playersEmpty: { padding: 20, alignItems: 'center' },
  playersEmptyText: { fontSize: 13, color: '#999' },
  playerItem: { backgroundColor: '#fff', padding: 10, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#f0f0f0' },
  playerInfo: { flex: 1 },
  playerName: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 4 },
  playerDetails: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roleBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  roleText: { fontSize: 10, fontWeight: '700' },
  ratingBadge: { backgroundColor: '#fff8e1', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  ratingText: { fontSize: 10, color: '#b8860b', fontWeight: '700' },
  playerActionsContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  playerEditButton: { backgroundColor: '#ffa726', justifyContent: 'center', alignItems: 'center', width: 52, height: '100%', borderRadius: 10, marginRight: 4 },
  playerDeleteButton: { backgroundColor: '#e53935', justifyContent: 'center', alignItems: 'center', width: 52, height: '100%', borderRadius: 10 },

  // ── Edit modal ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalContainer: { backgroundColor: '#fff', borderRadius: 18, padding: 20, width: '90%', maxWidth: 400 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 18, textAlign: 'center' },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, gap: 10 },
  cancelButton: { flex: 1, backgroundColor: '#f0f0f0', paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  cancelButtonText: { color: '#333', fontSize: 15, fontWeight: '600' },
  saveButton: { flex: 1, backgroundColor: '#667eea', paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  saveButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },

  // ── Team picker (in modal) ──
  teamPickerContainer: { marginTop: 4 },
  teamPickerScroll: { maxHeight: 60 },
  teamPickerOption: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#e8e8e8', backgroundColor: '#f8f9fa', marginRight: 8 },
  teamPickerOptionActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  teamPickerOptionText: { fontSize: 13, color: '#555', fontWeight: '600' },
  teamPickerOptionTextActive: { color: '#fff' },
  pickerPlaceholder: { fontSize: 13, color: '#bbb', paddingVertical: 10 },

  // ── Select modal (team) ──
  selectModalContainer: { backgroundColor: '#fff', borderRadius: 18, width: '90%', maxWidth: 400, maxHeight: '70%' },
  selectModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  selectModalTitle: { fontSize: 17, fontWeight: '700', color: '#333' },
  selectModalCloseButton: { padding: 4 },
  selectModalList: { maxHeight: 400 },
  selectModalOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: '#f8f8f8' },
  selectModalOptionActive: { backgroundColor: '#f5f7ff' },
  selectModalOptionText: { fontSize: 15, color: '#333' },
  selectModalOptionTextActive: { color: '#667eea', fontWeight: '700' },
  selectModalEmpty: { padding: 40, alignItems: 'center' },
  selectModalEmptyText: { fontSize: 13, color: '#bbb' },

  // ── Toast ──
  toast: { position: 'absolute', top: 100, left: 20, right: 20, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 10, zIndex: 999 },
  toastError: { backgroundColor: '#e53935' },
  toastSuccess: { backgroundColor: '#2e7d32' },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },

  // ── Confirm modal ──
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  confirmContent: { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '85%', alignItems: 'center' },
  confirmIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff5f5', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  confirmTitle: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 8, textAlign: 'center' },
  confirmMessage: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  confirmButtons: { flexDirection: 'row', gap: 12, width: '100%' },
  confirmBtnCancel: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#f0f0f0' },
  confirmBtnCancelText: { color: '#333', fontSize: 15, fontWeight: '600' },
  confirmBtnAction: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#667eea' },
  confirmBtnActionText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});


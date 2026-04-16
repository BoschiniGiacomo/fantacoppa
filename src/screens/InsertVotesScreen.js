import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import BonusIcon from '../components/BonusIcon';
import { useOnboarding } from '../context/OnboardingContext';
import { leagueService, formationService } from '../services/api';
import { syncSubmittedFormationOnboarding } from '../utils/formationSubmission';

// ==========================================
// Componente PlayerRow memoizzato
// Si ri-renderizza SOLO se cambiano i suoi props (playerVote)
// ==========================================
const PlayerRow = memo(({ player, playerVote, bonusSettings, bonusEnabled, onUpdateRating, onSetRating, onToggleSV, onUpdateBonus, onIncrementBonus, onDecrementBonus, inputRef, onSubmitNext, rowRef, onInputFocus }) => {
  const pv = playerVote;
  const isSV = pv.rating === 0;
  const ratingDisplay = isSV ? '' : pv.rating.toFixed(2);

  // Stato locale per il testo durante l'editing - permette input intermedi come "6." o "6.5"
  const [editingText, setEditingText] = useState(null);
  const [showRow2, setShowRow2] = useState(false);
  const isEditing = editingText !== null;

  const getRoleColor = (role) => {
    const colors = { P: '#0d6efd', D: '#198754', C: '#e6a800', A: '#dc3545' };
    return colors[role] || '#6c757d';
  };
  const roleColor = getRoleColor(player.role);

  const handleFocus = () => {
    // Mostra il valore corrente senza zeri finali (es. "6" invece di "6.00")
    if (isSV) {
      setEditingText('');
    } else {
      const val = pv.rating;
      setEditingText(val % 1 === 0 ? val.toString() : val.toString());
    }
    // Scrolla per rendere visibile questo input sopra la tastiera
    if (onInputFocus) onInputFocus(player.id);
  };

  const handleChangeText = (text) => {
    // Sostituisci virgola con punto per input decimale
    text = text.replace(',', '.');
    // Permetti solo input numerici parziali validi (es. "", "6", "6.", "6.5")
    if (text === '' || /^\d*\.?\d{0,2}$/.test(text)) {
      setEditingText(text);
    }
  };

  const handleBlur = () => {
    if (editingText !== null) {
      onSetRating(player.id, editingText);
      setEditingText(null);
    }
  };

  // Mostra il testo in editing se attivo, altrimenti il valore formattato
  const displayValue = isEditing ? editingText : ratingDisplay;

  return (
    <View ref={rowRef} style={styles.playerRow}>
      <View style={styles.playerTopRow}>
        <View style={[styles.roleBadgeMini, { backgroundColor: roleColor }]}>
          <Text style={styles.roleBadgeMiniText}>{player.role}</Text>
        </View>
        <Text style={styles.playerName} numberOfLines={1}>
          {player.first_name} {player.last_name}
        </Text>

        <TouchableOpacity
          style={[styles.svBtn, isSV && styles.svBtnActive]}
          onPress={() => onToggleSV(player.id)}
        >
          <Text style={[styles.svBtnText, isSV && styles.svBtnTextActive]}>S.V.</Text>
        </TouchableOpacity>

        <View style={styles.ratingGroup}>
          <TouchableOpacity
            style={[styles.ratingBtn, styles.ratingBtnMinus]}
            onPress={() => onUpdateRating(player.id, -0.25)}
          >
            <Text style={styles.ratingBtnText}>-</Text>
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={[styles.ratingInput, isSV && styles.ratingInputSV]}
            value={displayValue}
            onFocus={handleFocus}
            onChangeText={handleChangeText}
            onBlur={handleBlur}
            placeholder={isSV ? 'S.V.' : '6.00'}
            placeholderTextColor={isSV ? '#dc3545' : '#bbb'}
            keyboardType="decimal-pad"
            returnKeyType="next"
            onSubmitEditing={() => { handleBlur(); onSubmitNext(); }}
            blurOnSubmit={false}
            selectTextOnFocus
          />
          <TouchableOpacity
            style={[styles.ratingBtn, styles.ratingBtnPlus]}
            onPress={() => onUpdateRating(player.id, 0.25)}
          >
            <Text style={styles.ratingBtnText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {bonusEnabled && !isSV && (() => {
        const isGK = player.role === 'P';

        // Ordine completo: primi 5 = riga 1, resto = riga 2
        const allItems = isGK
          ? [
              // Riga 1
              { type: 'toggle', key: 'clean_sheet', enable: 'enable_clean_sheet', field: 'clean_sheet', icon: 'clean_sheet', activeStyle: styles.cardToggleGreenActive },
              { type: 'counter', key: 'goals_conceded', enable: 'enable_goals_conceded', field: 'goals_conceded', icon: 'goals_conceded' },
              { type: 'counter', key: 'penalty_saved', enable: 'enable_penalty_saved', field: 'penalty_saved', icon: 'penalty_saved' },
              { type: 'toggle', key: 'yellow_card', enable: 'enable_yellow_card', field: 'yellow_cards', icon: 'yellow_card', activeStyle: styles.cardToggleYellowActive },
              { type: 'toggle', key: 'red_card', enable: 'enable_red_card', field: 'red_cards', icon: 'red_card', activeStyle: styles.cardToggleRedActive },
              // Riga 2
              { type: 'counter', key: 'goal', enable: 'enable_goal', field: 'goals', icon: 'goal' },
              { type: 'counter', key: 'assist', enable: 'enable_assist', field: 'assists', icon: 'assist' },
              { type: 'counter', key: 'own_goal', enable: 'enable_own_goal', field: 'own_goals', icon: 'own_goal' },
              { type: 'counter', key: 'penalty_missed', enable: 'enable_penalty_missed', field: 'penalty_missed', icon: 'penalty_missed' },
            ]
          : [
              // Riga 1
              { type: 'counter', key: 'goal', enable: 'enable_goal', field: 'goals', icon: 'goal' },
              { type: 'counter', key: 'assist', enable: 'enable_assist', field: 'assists', icon: 'assist' },
              { type: 'counter', key: 'own_goal', enable: 'enable_own_goal', field: 'own_goals', icon: 'own_goal' },
              { type: 'toggle', key: 'yellow_card', enable: 'enable_yellow_card', field: 'yellow_cards', icon: 'yellow_card', activeStyle: styles.cardToggleYellowActive },
              { type: 'toggle', key: 'red_card', enable: 'enable_red_card', field: 'red_cards', icon: 'red_card', activeStyle: styles.cardToggleRedActive },
              // Riga 2
              { type: 'counter', key: 'penalty_missed', enable: 'enable_penalty_missed', field: 'penalty_missed', icon: 'penalty_missed' },
              { type: 'counter', key: 'goals_conceded', enable: 'enable_goals_conceded', field: 'goals_conceded', icon: 'goals_conceded' },
              { type: 'counter', key: 'penalty_saved', enable: 'enable_penalty_saved', field: 'penalty_saved', icon: 'penalty_saved' },
              { type: 'toggle', key: 'clean_sheet', enable: 'enable_clean_sheet', field: 'clean_sheet', icon: 'clean_sheet', activeStyle: styles.cardToggleGreenActive },
            ];

        // Filtra solo quelli abilitati
        const enabled = allItems.filter(item => bonusSettings[item.enable]);

        // Split dinamico: calcola quanti items entrano in riga 1
        // Counter ~68px, Toggle ~28px, ExpandBtn ~27px, gap 3px per item
        const COUNTER_W = 71; // 68 + gap
        const TOGGLE_W = 31;  // 28 + gap
        const EXPAND_W = 27;
        const MAX_ROW_W = 310; // larghezza utile approssimata

        const MAX_ROW_ITEMS = 5;
        let row1Count = 0;
        let usedWidth = 0;
        for (let i = 0; i < enabled.length && row1Count < MAX_ROW_ITEMS; i++) {
          const itemW = enabled[i].type === 'counter' ? COUNTER_W : TOGGLE_W;
          const widthWithExpand = usedWidth + itemW + (i < enabled.length - 1 ? EXPAND_W : 0);
          if (i > 0 && widthWithExpand > MAX_ROW_W) break;
          usedWidth += itemW;
          row1Count++;
        }
        // Se tutti entrano, niente riga 2
        if (row1Count >= enabled.length) row1Count = enabled.length;

        const row1 = enabled.slice(0, row1Count);
        const row2 = enabled.slice(row1Count);

        const renderItem = (item) => {
          if (item.type === 'toggle') {
            return (
              <TouchableOpacity
                key={item.key}
                style={[styles.cardToggle, pv[item.field] && item.activeStyle]}
                onPress={() => onUpdateBonus(player.id, item.field, !pv[item.field])}
              >
                <BonusIcon type={item.icon} size={16} inactive={!pv[item.field]} />
              </TouchableOpacity>
            );
          }
          return (
            <View key={item.key} style={styles.bonusInlineItem}>
              <BonusIcon type={item.icon} size={14} />
              <TouchableOpacity style={styles.bonusMiniBtn} onPress={() => onDecrementBonus(player.id, item.field)}>
                <Text style={styles.bonusMiniBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.bonusInlineValue}>{pv[item.field] || 0}</Text>
              <TouchableOpacity style={styles.bonusMiniBtn} onPress={() => onIncrementBonus(player.id, item.field)}>
                <Text style={styles.bonusMiniBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          );
        };

        // Controlla se qualche bonus della riga 2 ha un valore > 0
        const row2HasValues = row2.some(item => pv[item.field] > 0);

        return (
          <View>
            <View style={styles.bonusInlineRow}>
              {row1.map(renderItem)}
              {row2.length > 0 && (
                <TouchableOpacity
                  style={styles.bonusExpandBtn}
                  onPress={() => setShowRow2(!showRow2)}
                >
                  <Ionicons name={showRow2 ? 'chevron-up' : 'ellipsis-horizontal'} size={14} color="#999" />
                  {!showRow2 && row2HasValues && <View style={styles.bonusExpandDot} />}
                </TouchableOpacity>
              )}
            </View>
            {showRow2 && row2.length > 0 && (
              <View style={styles.bonusInlineRow}>{row2.map(renderItem)}</View>
            )}
          </View>
        );
      })()}
    </View>
  );
}, (prev, next) => {
  // Custom comparator: solo se il voto del giocatore cambia, ri-renderizza
  return prev.playerVote === next.playerVote && prev.bonusEnabled === next.bonusEnabled;
});

// ==========================================
// Componente principale
// ==========================================
export default function InsertVotesScreen({ route, navigation }) {
  const { leagueId } = route.params || {};
  const { markDone } = useOnboarding();
  const insets = useSafeAreaInsets();

  const [matchdays, setMatchdays] = useState([]);
  const [selectedMatchday, setSelectedMatchday] = useState(null);
  const [teams, setTeams] = useState([]);
  const [votes, setVotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bonusSettings, setBonusSettings] = useState(null);
  const [lastMatchdayWithVotes, setLastMatchdayWithVotes] = useState(null);
  const [saveFeedback, setSaveFeedback] = useState('');
  const [expandedTeams, setExpandedTeams] = useState({});
  const [unsavedModal, setUnsavedModal] = useState(false);
  const [savingAndLeaving, setSavingAndLeaving] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const pendingNavAction = useRef(null);
  const isInitialLoadRef = useRef(true);
  const inputRefsMap = useRef({}); // { playerId: TextInput ref }
  const playerRowRefsMap = useRef({}); // { playerId: View ref }
  const scrollViewRef = useRef(null);
  const savedVotesSnapshot = useRef(''); // JSON snapshot of last saved votes
  const scrollViewLayoutHeight = useRef(0); // altezza visibile dello ScrollView

  useEffect(() => {
    isInitialLoadRef.current = true;
    loadInitialData();
  }, [leagueId]);

  useEffect(() => {
    if (selectedMatchday && matchdays.length > 0) {
      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
        return;
      }
      loadPlayersAndVotes();
    }
  }, [selectedMatchday]);

  useFocusEffect(
    useCallback(() => {
      // Ricarica bonus settings ogni volta che la schermata torna in focus
      leagueService.getBonusSettings(leagueId)
        .then(res => { if (res.data) setBonusSettings(res.data); })
        .catch(() => {});
      // Ricarica anche i voti
      if (selectedMatchday && teams.length > 0) {
        leagueService.getVotesForMatchday(leagueId, selectedMatchday)
          .then(res => setVotes(res.data || {}))
          .catch(() => {});
      }
    }, [leagueId, selectedMatchday])
  );

  const loadInitialData = async () => {
    try {
      setLoading(true);
      try {
        await syncSubmittedFormationOnboarding({ leagueId, formationService, markDone });
      } catch (_) {}
      const matchdaysRes = await leagueService.getVotesMatchdays(leagueId);
      const bonusSettingsRes = await leagueService.getBonusSettings(leagueId).catch(() => ({ data: null }));

      const matchdaysData = matchdaysRes.data?.matchdays || [];
      setMatchdays(matchdaysData);
      setLastMatchdayWithVotes(matchdaysRes.data?.last_matchday_with_votes);

      if (bonusSettingsRes.data) {
        setBonusSettings(bonusSettingsRes.data);
      } else {
        setBonusSettings({
          enable_bonus_malus: 1,
          enable_goal: 1, bonus_goal: 3.0,
          enable_assist: 1, bonus_assist: 1.0,
          enable_yellow_card: 1, malus_yellow_card: -0.5,
          enable_red_card: 1, malus_red_card: -1.0,
        });
      }

      if (matchdaysData.length > 0) {
        const defaultMatchday = matchdaysRes.data?.last_matchday_with_votes || matchdaysData[0].giornata;
        try {
          await loadPlayersAndVotesForMatchday(defaultMatchday);
        } catch (error) {
          console.error('Error loading players and votes:', error);
        }
        setSelectedMatchday(defaultMatchday);
      } else {
        setLoading(false);
      }
    } catch (error) {
      console.error('Error loading initial data:', error);
      showToast('Impossibile caricare i dati: ' + (error.response?.data?.error || error.message));
      setLoading(false);
    }
  };

  const loadPlayersAndVotesForMatchday = async (matchday) => {
    try {
      const [playersRes, votesRes] = await Promise.all([
        leagueService.getVotesPlayers(leagueId),
        leagueService.getVotesForMatchday(leagueId, matchday).catch(() => ({ data: {} })),
      ]);
      const teamsData = playersRes.data || [];
      setTeams(teamsData);
      // Squadre chiuse di default
      const expanded = {};
      teamsData.forEach(t => { expanded[t.id] = false; });
      setExpandedTeams(expanded);
      const loadedVotes = votesRes.data || {};
      setVotes(loadedVotes);
      savedVotesSnapshot.current = JSON.stringify(loadedVotes);
    } catch (error) {
      console.error('Error loading players and votes:', error);
      showToast('Impossibile caricare i giocatori');
      throw error;
    }
  };

  const loadPlayersAndVotes = async () => {
    if (!selectedMatchday) return;
    try {
      setLoading(true);
      await loadPlayersAndVotesForMatchday(selectedMatchday);
    } catch (error) {
      // handled
    } finally {
      setLoading(false);
    }
  };

  // --- Callbacks memoizzati per evitare re-render dei PlayerRow ---
  const updateRating = useCallback((playerId, change) => {
    setVotes(prev => {
      const current = prev[playerId] || { rating: 0, goals: 0, assists: 0, yellow_cards: 0, red_cards: 0 };
      const currentRating = current.rating || 0;

      if (currentRating === 0) {
        if (change < 0) return prev;
        return { ...prev, [playerId]: { ...current, rating: 6.0 } };
      }

      let newRating = currentRating + change;
      if (newRating < 1) newRating = 0;
      else if (newRating > 10) newRating = 10;
      else newRating = Math.round(newRating * 4) / 4;

      return {
        ...prev,
        [playerId]: {
          ...current, rating: newRating,
          goals: newRating === 0 ? 0 : current.goals,
          assists: newRating === 0 ? 0 : current.assists,
          yellow_cards: newRating === 0 ? 0 : current.yellow_cards,
          red_cards: newRating === 0 ? 0 : current.red_cards,
        }
      };
    });
  }, []);

  const setRatingValue = useCallback((playerId, value) => {
    if (value === '' || value === null) {
      setVotes(prev => {
        const current = prev[playerId] || { rating: 0, goals: 0, assists: 0, yellow_cards: 0, red_cards: 0 };
        return { ...prev, [playerId]: { ...current, rating: 0 } };
      });
      return;
    }
    let rating = parseFloat(value);
    if (isNaN(rating)) return;
    if (rating < 1) rating = 0;
    if (rating > 10) rating = 10;
    rating = Math.round(rating * 4) / 4;

    setVotes(prev => {
      const current = prev[playerId] || { rating: 0, goals: 0, assists: 0, yellow_cards: 0, red_cards: 0 };
      return {
        ...prev,
        [playerId]: {
          ...current, rating,
          goals: rating === 0 ? 0 : current.goals,
          assists: rating === 0 ? 0 : current.assists,
          yellow_cards: rating === 0 ? 0 : current.yellow_cards,
          red_cards: rating === 0 ? 0 : current.red_cards,
        }
      };
    });
  }, []);

  const toggleSV = useCallback((playerId) => {
    const EMPTY_VOTE = { rating: 0, goals: 0, assists: 0, yellow_cards: 0, red_cards: 0, goals_conceded: 0, own_goals: 0, penalty_missed: 0, penalty_saved: 0, clean_sheet: 0 };
    setVotes(prev => {
      const current = prev[playerId] || EMPTY_VOTE;
      const isSV = current.rating === 0;
      return {
        ...prev,
        [playerId]: {
          ...current, rating: isSV ? 6.0 : 0,
          goals: 0, assists: 0, yellow_cards: 0, red_cards: 0,
          goals_conceded: 0, own_goals: 0, penalty_missed: 0, penalty_saved: 0, clean_sheet: 0,
        }
      };
    });
  }, []);

  const EMPTY_VOTE = { rating: 0, goals: 0, assists: 0, yellow_cards: 0, red_cards: 0, goals_conceded: 0, own_goals: 0, penalty_missed: 0, penalty_saved: 0, clean_sheet: 0 };

  const updateBonus = useCallback((playerId, field, value) => {
    setVotes(prev => {
      const current = prev[playerId] || EMPTY_VOTE;
      if (current.rating === 0) return prev;
      return { ...prev, [playerId]: { ...current, [field]: value } };
    });
  }, []);

  const incrementBonus = useCallback((playerId, field) => {
    setVotes(prev => {
      const current = prev[playerId] || EMPTY_VOTE;
      if (current.rating === 0) return prev;
      return { ...prev, [playerId]: { ...current, [field]: (current[field] || 0) + 1 } };
    });
  }, []);

  const decrementBonus = useCallback((playerId, field) => {
    setVotes(prev => {
      const current = prev[playerId] || EMPTY_VOTE;
      if (current.rating === 0) return prev;
      const val = (current[field] || 0) - 1;
      return { ...prev, [playerId]: { ...current, [field]: val < 0 ? 0 : val } };
    });
  }, []);

  // --- Save ---
  const handleSave = useCallback(async (teamId = null) => {
    try {
      setSaving(true);
      const currentVotes = votesRef.current;
      const currentTeams = teamsRef.current;
      const ratingsToSave = {};

      // Determina quali giocatori includere
      const playersToSave = [];
      if (teamId) {
        const team = currentTeams.find(t => t.id === teamId);
        if (team) playersToSave.push(...team.players);
      } else {
        currentTeams.forEach(t => playersToSave.push(...t.players));
      }

      // Per OGNI giocatore visibile: salva il voto corrente o 0 (S.V.)
      playersToSave.forEach(player => {
        const vote = currentVotes[player.id];
        const rating = (vote && vote.rating !== undefined && vote.rating !== null && vote.rating !== '')
          ? vote.rating : 0;
        ratingsToSave[player.id] = {
          rating,
          goals: vote?.goals || 0,
          assists: vote?.assists || 0,
          yellow_cards: vote?.yellow_cards ? 1 : 0,
          red_cards: vote?.red_cards ? 1 : 0,
          goals_conceded: vote?.goals_conceded || 0,
          own_goals: vote?.own_goals || 0,
          penalty_missed: vote?.penalty_missed || 0,
          penalty_saved: vote?.penalty_saved || 0,
          clean_sheet: vote?.clean_sheet ? 1 : 0,
        };
      });

      // Debug: log dei voti che stiamo salvando
      const allEntries = Object.entries(ratingsToSave).map(([id, v]) => `${id}=${v.rating}`);
      console.log(`[SAVE_VOTES] teamId=${teamId} total=${Object.keys(ratingsToSave).length} voti=[${allEntries.join(', ')}]`);

      await leagueService.saveVotes(leagueId, selectedMatchdayRef.current, ratingsToSave, teamId);

      setSaveFeedback(teamId ? 'Voti squadra salvati!' : 'Tutti i voti salvati!');
      setTimeout(() => setSaveFeedback(''), 2500);

      const votesRes = await leagueService.getVotesForMatchday(leagueId, selectedMatchdayRef.current).catch(() => ({ data: {} }));
      const newVotes = votesRes.data || {};
      // Debug: verifica che i voti dal server corrispondano a quelli salvati
      const allAfter = Object.entries(newVotes).map(([id, v]) => `${id}=${v.rating}`);
      console.log(`[RELOAD_VOTES] total=${Object.keys(newVotes).length} voti=[${allAfter.join(', ')}]`);
      setVotes(newVotes);
      savedVotesSnapshot.current = JSON.stringify(newVotes);
    } catch (error) {
      console.error('Error saving votes:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Errore durante il salvataggio';
      showToast(errorMessage);
    } finally {
      setSaving(false);
    }
  }, [leagueId]);

  // Refs per accedere ai valori correnti nei callback memoizzati
  const votesRef = useRef(votes);
  votesRef.current = votes;
  const teamsRef = useRef(teams);
  teamsRef.current = teams;
  const selectedMatchdayRef = useRef(selectedMatchday);
  selectedMatchdayRef.current = selectedMatchday;

  // --- Unsaved changes detection ---
  const hasUnsavedChanges = useCallback(() => {
    return JSON.stringify(votesRef.current) !== savedVotesSnapshot.current;
  }, []);

  // Blocca navigazione se ci sono modifiche non salvate
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!hasUnsavedChanges()) return;
      e.preventDefault();
      pendingNavAction.current = e.data.action;
      setUnsavedModal(true);
    });
    return unsubscribe;
  }, [navigation, hasUnsavedChanges]);

  const handleDiscardAndLeave = useCallback(() => {
    setUnsavedModal(false);
    if (pendingNavAction.current) {
      navigation.dispatch(pendingNavAction.current);
      pendingNavAction.current = null;
    }
  }, [navigation]);

  const handleSaveAndLeave = useCallback(async () => {
    setSavingAndLeaving(true);
    try {
      await handleSave();
      setUnsavedModal(false);
      if (pendingNavAction.current) {
        navigation.dispatch(pendingNavAction.current);
        pendingNavAction.current = null;
      }
    } catch (err) {
      // salvataggio fallito, resta sulla pagina
    } finally {
      setSavingAndLeaving(false);
    }
  }, [handleSave, navigation]);

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  // --- Helpers ---
  const getRoleColor = (role) => {
    const colors = { P: '#0d6efd', D: '#198754', C: '#e6a800', A: '#dc3545' };
    return colors[role] || '#6c757d';
  };

  const bonusEnabled = bonusSettings && bonusSettings.enable_bonus_malus && (
    bonusSettings.enable_goal || bonusSettings.enable_assist ||
    bonusSettings.enable_yellow_card || bonusSettings.enable_red_card
  );

  const matchdayHasVotes = (giornata) => {
    return lastMatchdayWithVotes && giornata <= lastMatchdayWithVotes;
  };

  const getTeamVotedCount = (team) => {
    let voted = 0;
    team.players.forEach(p => {
      const v = votes[p.id];
      if (v && v.rating > 0) voted++;
    });
    return voted;
  };

  // Lista piatta ordinata di tutti i player ID (per navigazione next)
  const allPlayerIds = teams.reduce((acc, team) => {
    team.players.forEach(p => acc.push(p.id));
    return acc;
  }, []);

  const allPlayerIdsRef = useRef(allPlayerIds);
  allPlayerIdsRef.current = allPlayerIds;

  const expandedTeamsRef = useRef(expandedTeams);
  expandedTeamsRef.current = expandedTeams;

  // Trova la squadra di un giocatore
  const findTeamForPlayer = useCallback((playerId) => {
    return teamsRef.current.find(t => t.players.some(p => p.id === playerId));
  }, []);

  const focusNextPlayer = useCallback((currentPlayerId) => {
    const ids = allPlayerIdsRef.current;
    const idx = ids.indexOf(currentPlayerId);
    if (idx < 0 || idx >= ids.length - 1) return;

    // Cerca il prossimo giocatore che appartiene a una squadra aperta
    let targetId = null;
    for (let i = idx + 1; i < ids.length; i++) {
      const team = findTeamForPlayer(ids[i]);
      if (team && expandedTeamsRef.current[team.id]) {
        targetId = ids[i];
        break;
      }
    }
    if (!targetId) return;

    const nextInput = inputRefsMap.current[targetId];
    if (nextInput) nextInput.focus();
    const nextRowView = playerRowRefsMap.current[targetId];
    if (nextRowView && scrollViewRef.current) {
      nextRowView.measureLayout(
        scrollViewRef.current.getInnerViewRef ? scrollViewRef.current.getInnerViewRef() : scrollViewRef.current,
        (x, y) => {
          const visibleH = scrollViewLayoutHeight.current || 300;
          const rowHeight = 60;
          const margin = 30;
          const scrollTarget = y - visibleH + rowHeight + margin;
          scrollViewRef.current.scrollTo({ y: Math.max(0, scrollTarget), animated: true });
        },
        () => {}
      );
    }
  }, [findTeamForPlayer]);

  // Funzioni per creare/ottenere ref per un player
  const getInputRef = useCallback((playerId) => {
    return (ref) => { inputRefsMap.current[playerId] = ref; };
  }, []);

  const getRowRef = useCallback((playerId) => {
    return (ref) => { playerRowRefsMap.current[playerId] = ref; };
  }, []);

  // Scrolla per rendere visibile l'input del giocatore appena sopra la tastiera
  const scrollToPlayer = useCallback((playerId) => {
    const rowView = playerRowRefsMap.current[playerId];
    if (rowView && scrollViewRef.current) {
      // Delay per aspettare che la tastiera si apra e il layout si aggiorni
      setTimeout(() => {
        rowView.measureLayout(
          scrollViewRef.current.getInnerViewRef ? scrollViewRef.current.getInnerViewRef() : scrollViewRef.current,
          (x, y) => {
            // Posiziona la riga nella parte bassa dell'area visibile (appena sopra la tastiera)
            const visibleH = scrollViewLayoutHeight.current || 300;
            const rowHeight = 60; // altezza approssimativa di una riga giocatore
            const margin = 30; // margine dal bordo inferiore
            const scrollTarget = y - visibleH + rowHeight + margin;
            scrollViewRef.current.scrollTo({ y: Math.max(0, scrollTarget), animated: true });
          },
          () => {}
        );
      }, 350);
    }
  }, []);

  const toggleTeam = useCallback((teamId) => {
    setExpandedTeams(prev => ({ ...prev, [teamId]: !prev[teamId] }));
  }, []);

  // Controlla se una squadra ha voti già salvati (nel snapshot iniziale)
  const teamHasSavedVotes = useCallback((team) => {
    try {
      const saved = JSON.parse(savedVotesSnapshot.current || '{}');
      return team.players.some(p => {
        const sv = saved[p.id];
        return sv && sv.rating > 0;
      });
    } catch { return false; }
  }, []);

  // --- Render team ---
  const renderTeam = (team) => {
    const votedCount = getTeamVotedCount(team);
    const totalPlayers = team.players.length;
    const isExpanded = !!expandedTeams[team.id];
    const hasSaved = teamHasSavedVotes(team);

    return (
      <View key={team.id} style={[styles.teamCard, hasSaved ? styles.teamCardSaved : styles.teamCardUnsaved]}>
        <TouchableOpacity style={styles.teamHeader} onPress={() => toggleTeam(team.id)} activeOpacity={0.7}>
          <View style={styles.teamHeaderLeft}>
            <Ionicons name="shirt-outline" size={18} color={hasSaved ? '#198754' : '#667eea'} />
            <Text style={styles.teamName} numberOfLines={1}>{team.name}</Text>
          </View>
          <View style={styles.teamHeaderRight}>
            <View style={[styles.progressBadge, hasSaved && styles.progressBadgeSaved]}>
              <Text style={[styles.progressText, hasSaved && styles.progressTextSaved]}>{votedCount}/{totalPlayers}</Text>
            </View>
            <TouchableOpacity
              style={[
                styles.saveTeamBtn,
                { backgroundColor: hasSaved ? '#198754' : '#e6a800' },
                saving && { opacity: 0.5 },
              ]}
              onPress={(e) => { e.stopPropagation(); handleSave(team.id); }}
              disabled={saving}
            >
              <Ionicons name={hasSaved ? 'checkmark' : 'save-outline'} size={15} color="#fff" />
            </TouchableOpacity>
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color="#999"
            />
          </View>
        </TouchableOpacity>
        {isExpanded && (
        <View style={styles.playersContainer}>
          {team.players.map(player => {
            const pv = votes[player.id] || { rating: 0, goals: 0, assists: 0, yellow_cards: 0, red_cards: 0 };
            return (
              <PlayerRow
                key={player.id}
                player={player}
                playerVote={pv}
                bonusSettings={bonusSettings}
                bonusEnabled={bonusEnabled}
                onUpdateRating={updateRating}
                onSetRating={setRatingValue}
                onToggleSV={toggleSV}
                onUpdateBonus={updateBonus}
                onIncrementBonus={incrementBonus}
                onDecrementBonus={decrementBonus}
                inputRef={getInputRef(player.id)}
                rowRef={getRowRef(player.id)}
                onSubmitNext={() => focusNextPlayer(player.id)}
                onInputFocus={scrollToPlayer}
              />
            );
          })}
        </View>
        )}
      </View>
    );
  };

  // --- Loading ---
  if (loading && teams.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Inserisci Voti</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Inserisci Voti</Text>
        {selectedMatchday && (
          <Text style={styles.headerSubtitle}>Giornata {selectedMatchday}</Text>
        )}
      </View>

      <View style={styles.matchdayBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.matchdayScrollContent}>
          {matchdays.map(md => {
            const isActive = selectedMatchday === md.giornata;
            const hasVotes = matchdayHasVotes(md.giornata);
            return (
              <TouchableOpacity
                key={md.giornata}
                style={[styles.matchdayPill, isActive && styles.matchdayPillActive]}
                onPress={() => setSelectedMatchday(md.giornata)}
              >
                <Text style={[styles.matchdayPillText, isActive && styles.matchdayPillTextActive]}>
                  {md.giornata}
                </Text>
                {hasVotes && !isActive && <View style={styles.matchdayDot} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.content}
          contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onLayout={(e) => { scrollViewLayoutHeight.current = e.nativeEvent.layout.height; }}
        >
          {selectedMatchday && teams.length > 0 ? (
            <View style={styles.teamsWrapper}>
              {teams.map(team => renderTeam(team))}
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="calendar-outline" size={48} color="#ccc" />
              <Text style={styles.emptyText}>Seleziona una giornata</Text>
              <Text style={styles.emptySubtext}>Scegli una giornata dal menu sopra per iniziare</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal voti non salvati */}
      <Modal
        visible={unsavedModal}
        transparent
        animationType="fade"
        onRequestClose={() => !savingAndLeaving && setUnsavedModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="alert-circle" size={30} color="#e6a800" />
            </View>
            <Text style={styles.modalTitle}>Voti non salvati</Text>
            <Text style={styles.modalDesc}>
              Hai delle modifiche non salvate. Cosa vuoi fare?
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalBtnOutline}
                onPress={() => setUnsavedModal(false)}
                disabled={savingAndLeaving}
              >
                <Text style={styles.modalBtnOutlineText}>Resta</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtnDanger}
                onPress={handleDiscardAndLeave}
                disabled={savingAndLeaving}
              >
                <Ionicons name="trash-outline" size={15} color="#fff" />
                <Text style={styles.modalBtnDangerText}>Esci</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnPrimary, savingAndLeaving && { opacity: 0.6 }]}
                onPress={handleSaveAndLeave}
                disabled={savingAndLeaving}
              >
                {savingAndLeaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="save" size={15} color="#fff" />
                    <Text style={styles.modalBtnPrimaryText}>Salva</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {saveFeedback !== '' && (
        <View style={[styles.saveFeedback, { bottom: insets.bottom + 60 }]}>
          <Ionicons name="checkmark-circle" size={20} color="#198754" />
          <Text style={styles.saveFeedbackText}>{saveFeedback}</Text>
        </View>
      )}

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
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  matchdayBar: {
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  matchdayScrollContent: {
    gap: 6,
    paddingHorizontal: 2,
  },
  matchdayPill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
  },
  matchdayPillActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  matchdayPillText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#555',
  },
  matchdayPillTextActive: {
    color: '#fff',
  },
  matchdayDot: {
    position: 'absolute',
    bottom: 3,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#198754',
  },
  content: {
    flex: 1,
  },
  teamsWrapper: {
    padding: 10,
  },
  teamCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  teamCardSaved: {
    borderLeftWidth: 3,
    borderLeftColor: '#198754',
  },
  teamCardUnsaved: {
    borderLeftWidth: 3,
    borderLeftColor: '#e6a800',
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#f8f9fb',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  teamHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  teamName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
    flex: 1,
  },
  teamHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressBadge: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  progressBadgeSaved: {
    backgroundColor: '#198754',
  },
  progressText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#198754',
  },
  progressTextSaved: {
    color: '#fff',
  },
  saveTeamBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playersContainer: {},
  playerRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f2f2f2',
  },
  playerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roleBadgeMini: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBadgeMiniText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 11,
  },
  playerName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  svBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#ddd',
    backgroundColor: '#f9f9f9',
  },
  svBtnActive: {
    backgroundColor: '#fdecea',
    borderColor: '#dc3545',
  },
  svBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#999',
  },
  svBtnTextActive: {
    color: '#dc3545',
  },
  ratingGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingBtnMinus: {
    backgroundColor: '#dc3545',
  },
  ratingBtnPlus: {
    backgroundColor: '#198754',
  },
  ratingBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: -1,
  },
  ratingInput: {
    width: 52,
    height: 28,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    backgroundColor: '#f9f9f9',
    paddingVertical: 0,
    paddingHorizontal: 2,
    color: '#333',
  },
  ratingInputSV: {
    backgroundColor: '#fef0ef',
    borderColor: '#f5c6cb',
  },
  bonusInlineRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginHorizontal: 2,
    gap: 3,
  },
  bonusInlineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#f8f9fa',
    borderRadius: 6,
    paddingHorizontal: 3,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#eee',
  },
  bonusMiniBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#e9ecef',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bonusMiniBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#555',
    marginTop: -1,
  },
  bonusInlineValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#333',
    minWidth: 12,
    textAlign: 'center',
  },
  bonusExpandBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bonusExpandDot: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#667eea',
  },
  cardToggle: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardToggleYellowActive: {
    borderColor: '#ffc107',
    backgroundColor: '#fff8e1',
  },
  cardToggleRedActive: {
    borderColor: '#dc3545',
    backgroundColor: '#fdecea',
  },
  cardToggleGreenActive: {
    borderColor: '#198754',
    backgroundColor: '#e8f5e9',
  },
  cardIcon: {
    width: 12,
    height: 16,
    borderRadius: 2,
  },
  saveFeedback: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f5e9',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 10,
  },
  saveFeedbackText: {
    color: '#198754',
    fontSize: 14,
    fontWeight: '700',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  // Modal voti non salvati
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 320,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  modalIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fff8e1',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalDesc: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 22,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  modalBtnOutline: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnOutlineText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  modalBtnDanger: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#dc3545',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  modalBtnDangerText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  modalBtnPrimary: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#198754',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  modalBtnPrimaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
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

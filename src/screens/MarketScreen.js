import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Image,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useOnboarding } from '../context/OnboardingContext';
import { marketService, squadService } from '../services/api';
import { PlayerPhotoImage } from '../components/StableCachedImage';
import { peekMarketBootstrapDefault, setMarketBootstrapDefault, invalidateLeagueWarmCache } from '../services/leagueWarmCache';
import { Ionicons } from '@expo/vector-icons';

export default function MarketScreen({ route, navigation }) {
  const { user } = useAuth();
  const { updateAutoDetect, markDone } = useOnboarding();
  const insets = useSafeAreaInsets();
  const leagueId = route?.params?.leagueId || 1;
  const initialRole = route?.params?.role || '';
  const [league, setLeague] = useState(null);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchText, setSearchText] = useState('');
  const [selectedRole, setSelectedRole] = useState(initialRole);
  const [budget, setBudget] = useState(0);
  const [marketBlocked, setMarketBlocked] = useState(false);
  const [marketBlockReason, setMarketBlockReason] = useState('none'); // none | global | user
  const [roleLimits, setRoleLimits] = useState({ P: 3, D: 8, C: 8, A: 6 });
  const [ownedCounts, setOwnedCounts] = useState({ P: 0, D: 0, C: 0, A: 0 });
  const [sortBy, setSortBy] = useState('rating'); // 'rating', 'name', 'team'
  const [sortAsc, setSortAsc] = useState(false); // false = decrescente, true = crescente
  const [buyFeedback, setBuyFeedback] = useState('');
  const [releaseFeedback, setReleaseFeedback] = useState('');
  const [errorToast, setErrorToast] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [buyingPlayer, setBuyingPlayer] = useState(null); // id del giocatore in acquisto
  const [confirmPlayer, setConfirmPlayer] = useState(null);
  const [removing, setRemoving] = useState(false);
  const debounceRef = useRef(null);

  const roles = [
    { key: '', label: 'Tutti', icon: 'list' },
    { key: 'P', label: 'P', fullLabel: 'Portieri', icon: 'shield' },
    { key: 'D', label: 'D', fullLabel: 'Difensori', icon: 'shield-checkmark' },
    { key: 'C', label: 'C', fullLabel: 'Centrocampisti', icon: 'flash' },
    { key: 'A', label: 'A', fullLabel: 'Attaccanti', icon: 'flame' },
  ];

  const getRoleColor = (role) => {
    const colors = { P: '#0d6efd', D: '#198754', C: '#e6a800', A: '#dc3545' };
    return colors[role] || '#666';
  };

  // Debounce ricerca
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(searchText);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchText]);

  // Aggiorna il filtro ruolo quando si arriva da SquadScreen con un ruolo preselezionato
  useEffect(() => {
    const role = route?.params?.role;
    if (role !== undefined) {
      setSelectedRole(role);
    }
  }, [route?.params?.role]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [leagueId])
  );

  const applyBootstrapData = (data) => {
    const playersList = Array.isArray(data.players) ? data.players : [];
    setPlayers(playersList);
    const budgetValue = data?.budget ?? 0;
    setBudget(typeof budgetValue === 'number' ? budgetValue : parseFloat(budgetValue) || 0);
    setMarketBlocked(Boolean(data.market_blocked || data.blocked));
    setMarketBlockReason(String(data.block_reason || 'none'));
    if (data.league && typeof data.league === 'object') {
      setLeague(data.league);
    }
    const limits = data?.role_limits || {};
    setRoleLimits({
      P: Number(limits.P || 0) || 3,
      D: Number(limits.D || 0) || 8,
      C: Number(limits.C || 0) || 8,
      A: Number(limits.A || 0) || 6,
    });
    const counts = data?.owned_counts || {};
    setOwnedCounts({
      P: Number(counts.P || 0),
      D: Number(counts.D || 0),
      C: Number(counts.C || 0),
      A: Number(counts.A || 0),
    });
  };

  const loadData = async () => {
    const warm = peekMarketBootstrapDefault(leagueId);
    if (warm != null) {
      applyBootstrapData(warm);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const bootstrapRes = await marketService.getBootstrap(leagueId, {});
      const data = bootstrapRes?.data || {};
      applyBootstrapData(data);
      setMarketBootstrapDefault(leagueId, data);
    } catch (error) {
      console.error('Error loading market data:', error);
      if (warm == null) {
        showError('Impossibile caricare i dati del mercato');
        setBudget(0);
        setPlayers([]);
        setMarketBlocked(false);
        setMarketBlockReason('none');
      } else {
        showError('Impossibile aggiornare i dati del mercato');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    invalidateLeagueWarmCache(leagueId);
    loadData();
  };

  const showError = (msg) => {
    setErrorToast(msg);
    setTimeout(() => setErrorToast(''), 2500);
  };

  const handleBuyPlayer = async (player) => {
    if (Number(player?.is_injured || 0) === 1) {
      showError('Giocatore infortunato non acquistabile');
      return;
    }
    // Blocca acquisti multipli simultanei
    if (buyingPlayer) return;
    if (marketBlocked) {
      showError(
        marketBlockReason === 'user'
          ? 'Sei bloccato dal mercato per questa lega'
          : 'Il mercato è attualmente bloccato dall\'amministratore'
      );
      return;
    }
    const budgetValue = typeof budget === 'number' ? budget : 0;
    if (budgetValue < player.rating) {
      showError(`Budget insufficiente: servono ${player.rating} ${player.rating === 1 ? 'credito' : 'crediti'}, ne hai ${budgetValue.toFixed(2)}`);
      return;
    }
    // Controlla limite ruolo
    if (ownedCounts[player.role] >= roleLimits[player.role]) {
      const roleNames = { P: 'Portieri', D: 'Difensori', C: 'Centrocampisti', A: 'Attaccanti' };
      showError(`Limite ${roleNames[player.role]} raggiunto (${roleLimits[player.role]}/${roleLimits[player.role]})`);
      return;
    }
    setBuyingPlayer(player.id);
    try {
      await marketService.buyPlayer(leagueId, player.id);
      // Aggiorna ottimisticamente: marca il giocatore come owned nella lista
      setPlayers(prev => prev.map(p => p.id === player.id ? { ...p, owned: true, directly_owned: 1 } : p));
      // Aggiorna conteggi e budget
      const newCounts = { ...ownedCounts, [player.role]: ownedCounts[player.role] + 1 };
      setOwnedCounts(newCounts);
      setBudget(prev => (typeof prev === 'number' ? prev - player.rating : prev));
      // Aggiorna onboarding
      const allFull = ['P', 'D', 'C', 'A'].every(r => newCounts[r] >= roleLimits[r]);
      updateAutoDetect({ squadFull: allFull, squadEmpty: false });
      setBuyFeedback(`${player.first_name} ${player.last_name} acquistato!`);
      setTimeout(() => setBuyFeedback(''), 2000);
      setBuyingPlayer(null);
      // Ricarica roster completo (senza filtro ruolo): altrimenti `players` resta solo sul ruolo
      // corrente e cambiando filtro ruolo la lista risulta vuota fino al refresh manuale.
      invalidateLeagueWarmCache(leagueId);
      marketService
        .getBootstrap(leagueId, {})
        .then((bootstrapRes) => {
          const data = bootstrapRes?.data || {};
          applyBootstrapData(data);
          setMarketBootstrapDefault(leagueId, data);
        })
        .catch(() => {});
    } catch (error) {
      showError(error.response?.data?.message || 'Errore durante l\'acquisto');
      setBuyingPlayer(null);
      try {
        await refreshMarketBootstrap();
      } catch (_) {
        // ignore
      }
    }
  };

  const handleRemovePlayer = (player) => {
    if (Number(player?.is_injured || 0) === 1) return;
    if (buyingPlayer || removing) return;
    if (marketBlocked) {
      showError(
        marketBlockReason === 'user'
          ? 'Sei bloccato dal mercato per questa lega'
          : 'Il mercato è attualmente bloccato dall\'amministratore'
      );
      return;
    }
    if (Number(player?.directly_owned || 0) !== 1) return;
    setConfirmPlayer(player);
  };

  const refreshMarketBootstrap = async () => {
    invalidateLeagueWarmCache(leagueId);
    const bootstrapRes = await marketService.getBootstrap(leagueId, {});
    const data = bootstrapRes?.data || {};
    applyBootstrapData(data);
    setMarketBootstrapDefault(leagueId, data);
    const counts = data?.owned_counts || {};
    const limits = data?.role_limits || roleLimits;
    const newCounts = {
      P: Number(counts.P || 0),
      D: Number(counts.D || 0),
      C: Number(counts.C || 0),
      A: Number(counts.A || 0),
    };
    const allFull = ['P', 'D', 'C', 'A'].every((r) => newCounts[r] >= (limits[r] || roleLimits[r]));
    updateAutoDetect({ squadFull: allFull, squadEmpty: newCounts.P + newCounts.D + newCounts.C + newCounts.A === 0 });
    return data;
  };

  const isPlayerStillOwned = (playerId, data) => {
    const pid = Number(playerId);
    const list = Array.isArray(data?.players) ? data.players : players;
    return list.some(
      (p) => Number(p.id) === pid && (Number(p.directly_owned || 0) === 1 || Number(p.owned || 0) === 1)
    );
  };

  const confirmRemovePlayer = async () => {
    if (!confirmPlayer || removing) return;
    const removed = confirmPlayer;
    const removedId = removed.id;
    setConfirmPlayer(null);
    setRemoving(true);
    let success = false;
    try {
      const res = await squadService.removePlayer(leagueId, removedId);
      const removeData = res?.data || {};
      success = true;
      if (typeof removeData.budget === 'number') setBudget(removeData.budget);
      if (removeData.formation_starter_removed) {
        showToast('Formazione aggiornata: completa i titolari mancanti', 'success');
      }
      if (!removeData.already_removed) {
        setReleaseFeedback(`${removed.first_name} ${removed.last_name} svincolato!`);
        setTimeout(() => setReleaseFeedback(''), 2000);
      }
      setPlayers((prev) =>
        prev.map((p) =>
          Number(p.id) === Number(removedId) ? { ...p, owned: false, directly_owned: 0 } : p
        )
      );
    } catch (error) {
      const isTimeout = error?.code === 'ECONNABORTED';
      let data = null;
      try {
        data = await refreshMarketBootstrap();
      } catch (_) {
        // ignore
      }
      const stillOwned = isPlayerStillOwned(removedId, data);
      if (!stillOwned) {
        success = true;
        if (!isTimeout) {
          showToast(`${removed.first_name} ${removed.last_name} svincolato`, 'success');
        } else {
          setReleaseFeedback(`${removed.first_name} ${removed.last_name} svincolato!`);
          setTimeout(() => setReleaseFeedback(''), 2000);
        }
      } else {
        showError(
          isTimeout
            ? 'Operazione lenta: riprova tra qualche secondo'
            : (error.response?.data?.message || 'Errore durante lo svincolo')
        );
      }
    } finally {
      setRemoving(false);
      if (success) {
        try {
          await refreshMarketBootstrap();
        } catch (_) {
          // ignore
        }
      }
    }
  };

  // Filtro + ordinamento locale
  const sortedPlayers = useMemo(() => {
    let filtered = players;
    if (selectedRole) {
      filtered = filtered.filter((p) => p.role === selectedRole);
    }
    const q = String(searchQuery || '').trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((p) => {
        const full = `${p.first_name || ''} ${p.last_name || ''} ${p.team_name || ''}`.toLowerCase();
        return full.includes(q);
      });
    }
    const sorted = [...filtered];
    const dir = sortAsc ? 1 : -1;
    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => dir * (a.last_name || '').localeCompare(b.last_name || ''));
        break;
      case 'team':
        sorted.sort((a, b) => dir * (a.team_name || '').localeCompare(b.team_name || ''));
        break;
      case 'rating':
      default:
        sorted.sort((a, b) => dir * ((a.rating || 0) - (b.rating || 0)));
        break;
    }
    return sorted;
  }, [players, sortBy, sortAsc, selectedRole, searchQuery]);

  const budgetValue = typeof budget === 'number' ? budget : 0;
  const initialBudget = league?.initial_budget || league?.budget || 500;
  const budgetUsed = initialBudget - budgetValue;
  const budgetPercent = initialBudget > 0 ? Math.max(0, Math.min(100, (budgetValue / initialBudget) * 100)) : 0;

  const abbreviateName = (firstName, lastName) => {
    const full = `${firstName} ${lastName}`;
    if (full.length <= 22) return full;
    const parts = firstName.split(/\s+/);
    if (parts.length > 1) {
      const abbr = parts.map(p => p.slice(0, 3) + '.').join(' ');
      if (`${abbr} ${lastName}`.length <= 22) return `${abbr} ${lastName}`;
      const abbrShort = parts.map(p => p.charAt(0) + '.').join(' ');
      return `${abbrShort} ${lastName}`;
    }
    return `${firstName.slice(0, 3)}. ${lastName}`;
  };

  const renderPlayer = useCallback(({ item }) => {
    const cantAfford = budgetValue < item.rating;
    const roleColor = getRoleColor(item.role);
    const roleFull = ownedCounts[item.role] >= roleLimits[item.role];
    const isInjured = Number(item?.is_injured || 0) === 1;
    const canRelease = item.owned && Number(item?.directly_owned || 0) === 1 && !isInjured;
    const releaseDisabled = marketBlocked || !!buyingPlayer || removing;
    const displayName = abbreviateName(item.first_name || '', item.last_name || '');

    return (
      <TouchableOpacity
        style={[
          styles.playerCard,
          item.owned && styles.playerCardOwned,
          isInjured && styles.playerCardInjured,
        ]}
        onPress={() => navigation.navigate('PlayerStats', {
          playerId: item.id,
          leagueId: league?.id,
          playerName: `${item.first_name} ${item.last_name}`,
          playerRole: item.role,
          playerRating: item.rating,
          entrySource: 'league',
        })}
        activeOpacity={0.7}
      >
        {/* Striscia laterale ruolo */}
        <View style={[styles.roleStripe, { backgroundColor: roleColor }]} />
        <View style={styles.playerContent}>
          {item.photo_path ? (
            <View style={styles.playerPhotoCol}>
              <PlayerPhotoImage photoPath={item.photo_path} style={styles.playerPhotoBadge} />
              <View style={[styles.playerPhotoRoleOverlay, { backgroundColor: roleColor }]}>
                <Text style={styles.playerPhotoRoleText}>{item.role}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.roleBadgeCol}>
              <View style={[styles.roleBadgeMini, { backgroundColor: roleColor }]}>
                <Text style={styles.roleBadgeMiniText}>{item.role}</Text>
              </View>
            </View>
          )}
          {/* Info giocatore */}
          <View style={styles.playerInfo}>
            <Text style={styles.playerName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.playerTeam} numberOfLines={1}>{item.team_name}</Text>
          </View>
          {/* Prezzo + azione */}
          <View style={styles.playerRight}>
            <Text style={[styles.playerRating, cantAfford && !item.owned && styles.playerRatingRed]}>
              {item.rating}
            </Text>
            {isInjured ? (
              <View style={styles.injuredActionBadge}>
                <Ionicons name="bandage" size={24} color="#fff" />
              </View>
            ) : canRelease ? (
              <TouchableOpacity
                style={[styles.removeButton, releaseDisabled && styles.removeButtonDisabled]}
                onPress={(e) => {
                  e.stopPropagation();
                  handleRemovePlayer(item);
                }}
                disabled={releaseDisabled}
              >
                <Ionicons name="trash-outline" size={16} color="#fff" />
              </TouchableOpacity>
            ) : item.owned ? (
              <View style={styles.ownedBadge}>
                <Ionicons name="checkmark-circle" size={18} color="#198754" />
              </View>
            ) : (
              <TouchableOpacity
                style={[
                  styles.buyButton,
                  (marketBlocked || cantAfford || roleFull || buyingPlayer) && styles.buyButtonDisabled,
                ]}
                onPress={(e) => {
                  e.stopPropagation();
                  handleBuyPlayer(item);
                }}
                disabled={marketBlocked || cantAfford || roleFull || !!buyingPlayer}
              >
                <Ionicons name="add" size={18} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [budgetValue, ownedCounts, roleLimits, marketBlocked, marketBlockReason, buyingPlayer, removing, league?.id, navigation]);

  const getItemLayout = useCallback((_, index) => ({ length: 64, offset: 64 * index, index }), []);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header compatto */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1 }} />
          <View style={{ flex: 2, alignItems: 'center' }}>
            <Text style={styles.headerTitle}>Mercato</Text>
            {league && <Text style={styles.leagueName}>{league.name}</Text>}
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            {marketBlocked && (
              <View style={styles.blockedBadge}>
                <Ionicons name="lock-closed" size={14} color="#fff" />
                <Text style={styles.blockedText}>Bloccato</Text>
              </View>
            )}
          </View>
        </View>
        {/* Budget con barra di progresso */}
        <View style={styles.budgetSection}>
          <View style={styles.budgetRow}>
            <Ionicons name="cash-outline" size={18} color="#198754" />
            <Text style={styles.budgetAmount}>{budgetValue.toFixed(2)}</Text>
            <Text style={styles.budgetTotal}>/ {initialBudget}</Text>
          </View>
          <View style={styles.budgetBarBg}>
            <View style={[styles.budgetBarFill, { width: `${budgetPercent}%` }]} />
          </View>
        </View>
      </View>

      {/* Filtri */}
      <View style={styles.filters}>
        {/* Barra ricerca + icona filtro */}
        <View style={styles.searchRow}>
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={18} color="#999" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Cerca giocatore..."
              placeholderTextColor="#999"
              value={searchText}
              onChangeText={setSearchText}
            />
            {searchText !== '' && (
              <TouchableOpacity onPress={() => { setSearchText(''); setSearchQuery(''); }} style={styles.clearButton}>
                <Ionicons name="close-circle" size={20} color="#999" />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={[styles.filterToggleBtn, showFilters && styles.filterToggleBtnActive]}
            onPress={() => setShowFilters(!showFilters)}
          >
            <Ionicons name="options-outline" size={20} color={showFilters ? '#fff' : '#667eea'} />
          </TouchableOpacity>
        </View>

        {/* Pannello filtri/ordinamento (collassabile) */}
        {showFilters && (
          <View style={styles.filterPanel}>
            {/* Sezione Ruolo */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Ruolo</Text>
              <View style={styles.roleFilters}>
                {roles.map((role) => {
                  const isActive = selectedRole === role.key;
                  const roleColor = role.key ? getRoleColor(role.key) : '#667eea';
                  return (
                    <TouchableOpacity
                      key={role.key || 'all'}
                      style={[
                        styles.roleFilter,
                        isActive && { backgroundColor: roleColor, borderColor: roleColor },
                      ]}
                      onPress={() => setSelectedRole(role.key)}
                    >
                      <Text style={[
                        styles.roleFilterText,
                        isActive && styles.roleFilterTextActive,
                      ]}>
                        {role.key ? role.label : 'Tutti'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Separatore */}
            <View style={styles.filterDivider} />

            {/* Sezione Ordina */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Ordina per</Text>
              <View style={styles.sortRow}>
                {[  
                  { key: 'rating', label: 'Prezzo' },
                  { key: 'name', label: 'Nome' },
                  { key: 'team', label: 'Squadra' },
                ].map(s => {
                  const isActive = sortBy === s.key;
                  return (
                    <TouchableOpacity
                      key={s.key}
                      style={[styles.sortPill, isActive && styles.sortPillActive]}
                      onPress={() => {
                        if (isActive) {
                          setSortAsc(!sortAsc);
                        } else {
                          setSortBy(s.key);
                          setSortAsc(s.key === 'rating' ? false : true);
                        }
                      }}
                    >
                      <Text style={[styles.sortPillText, isActive && styles.sortPillTextActive]}>
                        {s.label}
                      </Text>
                      {isActive && (
                        <Ionicons
                          name={sortAsc ? 'arrow-up' : 'arrow-down'}
                          size={12}
                          color="#667eea"
                          style={{ marginLeft: 2 }}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        )}

        {/* Contatori rosa per ruolo - sempre visibili */}
        <View style={styles.roleCountRow}>
          {['P', 'D', 'C', 'A'].map((r) => {
            const owned = ownedCounts[r];
            const limit = roleLimits[r];
            const isFull = owned >= limit;
            const color = getRoleColor(r);
            return (
              <View key={r} style={styles.roleCountItem}>
                <View style={[styles.roleCountDot, { backgroundColor: color }]} />
                <Text style={[styles.roleCountLabel, isFull && { fontWeight: 'bold', color: '#333' }]}>
                  {owned}/{limit}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Overlay mercato bloccato */}
      {marketBlocked && (
        <View style={styles.blockedOverlayBar}>
          <Ionicons name="lock-closed" size={14} color="#856404" />
          <Text style={styles.blockedOverlayText}>
            {marketBlockReason === 'user'
              ? 'Sei bloccato dal mercato in questa lega'
              : 'Il mercato è bloccato dall\'amministratore'}
          </Text>
        </View>
      )}

      {/* Lista giocatori */}
      <FlatList
        data={sortedPlayers}
        renderItem={renderPlayer}
        keyExtractor={(item) => item.id.toString()}
        getItemLayout={getItemLayout}
        removeClippedSubviews={true}
        maxToRenderPerBatch={15}
        windowSize={11}
        initialNumToRender={12}
        contentContainerStyle={[styles.listContent, { paddingBottom: 80 + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#667eea" />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="search-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>Nessun giocatore trovato</Text>
            <Text style={styles.emptyHint}>Prova a cambiare filtri o ricerca</Text>
          </View>
        }
      />

      {/* Modal conferma svincolo */}
      <Modal
        visible={confirmPlayer !== null}
        transparent
        animationType="fade"
        onRequestClose={() => !removing && setConfirmPlayer(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="person-remove" size={28} color="#dc3545" />
            </View>
            <Text style={styles.modalTitle}>Svincolare giocatore?</Text>
            {confirmPlayer && (
              <View style={styles.modalPlayerInfo}>
                <View style={[styles.modalRoleBadge, { backgroundColor: getRoleColor(confirmPlayer.role) }]}>
                  <Text style={styles.modalRoleBadgeText}>{confirmPlayer.role}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalPlayerName}>
                    {confirmPlayer.first_name} {confirmPlayer.last_name}
                  </Text>
                  <Text style={styles.modalPlayerTeam}>{confirmPlayer.team_name}</Text>
                </View>
                <Text style={styles.modalPlayerRating}>{confirmPlayer.rating}</Text>
              </View>
            )}
            <Text style={styles.modalDesc}>
              Il giocatore verrà rimosso dalla rosa e il budget verrà riaccreditato.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setConfirmPlayer(null)}
                disabled={removing}
              >
                <Text style={styles.modalCancelText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalRemoveBtn, removing && { opacity: 0.6 }]}
                onPress={confirmRemovePlayer}
                disabled={removing}
              >
                {removing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="trash-outline" size={16} color="#fff" />
                    <Text style={styles.modalRemoveText}>Svincola</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Toast feedback acquisto - overlay in basso sopra tab bar */}
      {buyFeedback !== '' && (
        <View style={[styles.buyFeedback, { bottom: insets.bottom + 70 }]}>
          <Ionicons name="checkmark-circle" size={18} color="#198754" />
          <Text style={styles.buyFeedbackText}>{buyFeedback}</Text>
        </View>
      )}

      {releaseFeedback !== '' && (
        <View style={[styles.buyFeedback, { bottom: insets.bottom + 70 }]}>
          <Ionicons name="checkmark-circle" size={18} color="#198754" />
          <Text style={styles.buyFeedbackText}>{releaseFeedback}</Text>
        </View>
      )}

      {/* Toast errore */}
      {errorToast !== '' && (
        <View style={styles.errorToast}>
          <Ionicons name="alert-circle" size={18} color="#fff" />
          <Text style={styles.errorToastText}>{errorToast}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f4f7',
  },
  playerCardInjured: {
    borderColor: '#ffd6d6',
    backgroundColor: '#fff8f8',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f2f4f7',
  },
  injuredActionBadge: {
    marginTop: 2,
    backgroundColor: '#e65050',
    borderRadius: 18,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  // Header
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
  },
  leagueName: {
    fontSize: 13,
    color: '#888',
    marginTop: 1,
    textAlign: 'center',
  },
  blockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dc3545',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 4,
    marginTop: 2,
  },
  blockedText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  // Budget
  budgetSection: {
    marginTop: 10,
  },
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginBottom: 6,
  },
  budgetAmount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#198754',
    marginLeft: 4,
  },
  budgetTotal: {
    fontSize: 13,
    color: '#999',
    fontWeight: '500',
  },
  budgetBarBg: {
    height: 5,
    backgroundColor: '#e9ecef',
    borderRadius: 3,
    overflow: 'hidden',
  },
  budgetBarFill: {
    height: '100%',
    backgroundColor: '#198754',
    borderRadius: 3,
  },
  // Filtri
  filters: {
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 38,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  filterToggleBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  filterToggleBtnActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    padding: 0,
  },
  clearButton: {
    marginLeft: 6,
    padding: 2,
  },
  filterPanel: {
    backgroundColor: '#f9f9fb',
    borderRadius: 10,
    padding: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#eeeeee',
  },
  filterSection: {
    gap: 6,
  },
  filterSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  filterDivider: {
    height: 1,
    backgroundColor: '#e8e8e8',
    marginVertical: 10,
  },
  roleFilters: {
    flexDirection: 'row',
    gap: 6,
  },
  roleFilter: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    borderWidth: 1.5,
    borderColor: '#e8e8e8',
  },
  roleFilterText: {
    fontSize: 12,
    color: '#555',
    fontWeight: '700',
  },
  roleFilterTextActive: {
    color: '#fff',
  },
  roleCountRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 6,
  },
  roleCountItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  roleCountDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  roleCountLabel: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
  },
  // Ordinamento
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
  },
  sortPillActive: {
    backgroundColor: '#667eea18',
  },
  sortPillText: {
    fontSize: 11,
    color: '#999',
    fontWeight: '600',
  },
  sortPillTextActive: {
    color: '#667eea',
  },
  // Blocked overlay bar
  blockedOverlayBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff3cd',
    paddingVertical: 6,
    gap: 6,
  },
  blockedOverlayText: {
    fontSize: 12,
    color: '#856404',
    fontWeight: '600',
  },
  // Feedback acquisto
  buyFeedback: {
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
  buyFeedbackText: {
    color: '#198754',
    fontSize: 14,
    fontWeight: '700',
  },
  // Toast errore
  errorToast: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    backgroundColor: '#e53935',
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
  errorToastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  // Lista
  listContent: {
    padding: 12,
  },
  // Card giocatore
  playerCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
    overflow: 'hidden',
  },
  playerCardOwned: {
    backgroundColor: '#f0faf4',
  },
  roleStripe: {
    width: 4,
  },
  playerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingLeft: 8,
    paddingRight: 12,
    minHeight: 64,
  },
  playerInfo: {
    flex: 1,
    marginRight: 8,
    marginLeft: 10,
    justifyContent: 'left',
    alignItems: 'flex-start',
  },
  playerPhotoCol: {
    width: 56,
    height: 56,
    position: 'relative',
  },
  playerPhotoBadge: {
    width: 56,
    height: 56,
  },
  playerPhotoRoleOverlay: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  playerPhotoRoleText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  roleBadgeCol: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  playerTeam: {
    fontSize: 12,
    color: '#888',
  },
  playerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playerRating: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#667eea',
    minWidth: 30,
    textAlign: 'right',
  },
  playerRatingRed: {
    color: '#dc3545',
  },
  ownedBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#dc3545',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonDisabled: {
    backgroundColor: '#ccc',
  },
  buyButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#198754',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buyButtonDisabled: {
    backgroundColor: '#ccc',
  },
  // Empty
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 12,
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 13,
    color: '#bbb',
    marginTop: 4,
  },
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
    maxWidth: 340,
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
    backgroundColor: '#fdecea',
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
    marginBottom: 16,
  },
  modalPlayerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  modalRoleBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRoleBadgeText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  modalPlayerName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  modalPlayerTeam: {
    fontSize: 12,
    color: '#888',
    marginTop: 1,
  },
  modalPlayerRating: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#667eea',
  },
  modalDesc: {
    fontSize: 13,
    color: '#777',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  modalRemoveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#dc3545',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  modalRemoveText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});

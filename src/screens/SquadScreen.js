import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useOnboarding } from '../context/OnboardingContext';
import { squadService, marketService, leagueService, formationService } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { syncSubmittedFormationOnboarding } from '../utils/formationSubmission';

export default function SquadScreen({ route, navigation }) {
  const { user } = useAuth();
  const { markDone, updateAutoDetect } = useOnboarding();
  const insets = useSafeAreaInsets();
  const leagueId = route?.params?.leagueId || 1;

  // Segna la rosa come visitata per l'onboarding
  useEffect(() => {
    markDone('visited_rosa');
  }, []);
  const [league, setLeague] = useState(null);
  const [squad, setSquad] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [budget, setBudget] = useState(0);
  const [totalValue, setTotalValue] = useState(0);
  const [roleLimits, setRoleLimits] = useState({});
  const [marketBlocked, setMarketBlocked] = useState(false);
  const [removeFeedback, setRemoveFeedback] = useState('');
  const [confirmPlayer, setConfirmPlayer] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  const roles = ['P', 'D', 'C', 'A'];
  const roleNames = {
    P: 'Portieri',
    D: 'Difensori',
    C: 'Centrocampisti',
    A: 'Attaccanti',
  };

  const loadData = useCallback(async () => {
    try {
      const [squadRes, limitsRes, blockedRes, leagueRes, budgetRes] = await Promise.all([
        squadService.getSquad(leagueId),
        squadService.getRoleLimits(leagueId),
        marketService.isBlocked(leagueId),
        leagueService.getById(leagueId).catch(() => ({ data: null })),
        marketService.getBudget(leagueId).catch(() => ({ data: { budget: 0 } })),
      ]);
      const players = Array.isArray(squadRes?.data?.players)
        ? squadRes.data.players
        : (Array.isArray(squadRes?.data?.squad) ? squadRes.data.squad : []);
      setSquad(players);

      // Budget: usa endpoint dedicato market/budget (fonte affidabile)
      const budgetValue = budgetRes?.data?.budget ?? squadRes?.data?.budget ?? 0;
      setBudget(typeof budgetValue === 'number' ? budgetValue : parseFloat(budgetValue) || 0);

      // Valore rosa: somma rating dei giocatori caricati
      const computedTotalValue = players.reduce((sum, p) => {
        const rating = Number(p?.rating);
        return sum + (Number.isFinite(rating) ? rating : 0);
      }, 0);
      setTotalValue(computedTotalValue);
      setRoleLimits(limitsRes.data || {});
      setMarketBlocked(blockedRes?.data?.blocked || false);
      if (leagueRes?.data) {
        const leagueData = Array.isArray(leagueRes.data) ? leagueRes.data[0] : leagueRes.data;
        setLeague(leagueData);
      }

      try {
        await syncSubmittedFormationOnboarding({ leagueId, formationService, markDone });
      } catch (_) {}
    } catch (error) {
      console.error('Error loading squad data:', error);
      showToast('Impossibile caricare la rosa');
      setBudget(0);
      setTotalValue(0);
      setSquad([]);
      setMarketBlocked(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [leagueId]);

  // Ricarica dati al focus sulla schermata
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Aggiorna onboarding: rosa completa quando tutti gli slot di ogni ruolo sono pieni
  useEffect(() => {
    if (!roleLimits || Object.keys(roleLimits).length === 0) return;
    const allFull = ['P', 'D', 'C', 'A'].every(r => {
      const limit = roleLimits[r] || 0;
      const owned = squad.filter(p => p.role === r).length;
      return limit > 0 && owned >= limit;
    });
    updateAutoDetect({ squadFull: allFull, squadEmpty: squad.length === 0 });
  }, [squad, roleLimits]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleRemovePlayer = (player) => {
    if (marketBlocked) {
      showToast('Il mercato è attualmente bloccato dall\'amministratore, non puoi rimuovere giocatori');
      return;
    }
    setConfirmPlayer(player);
  };

  const confirmRemovePlayer = async () => {
    if (!confirmPlayer) return;
    setRemoving(true);
    try {
      await squadService.removePlayer(leagueId, confirmPlayer.id);
      setRemoveFeedback(`${confirmPlayer.first_name} ${confirmPlayer.last_name} rimosso`);
      setTimeout(() => setRemoveFeedback(''), 2000);
      setConfirmPlayer(null);
      loadData();
    } catch (error) {
      showToast(error.response?.data?.message || 'Errore durante la rimozione');
    } finally {
      setRemoving(false);
    }
  };

  const getRoleColor = (role) => {
    const colors = {
      P: '#0d6efd',
      D: '#198754',
      C: '#e6a800',
      A: '#dc3545',
    };
    return colors[role] || '#666';
  };

  const getPlayersByRole = (role) => {
    return squad.filter((p) => p.role === role);
  };


  // Budget values
  const initialBudget = league?.initial_budget || league?.budget || 500;
  const budgetValue = typeof budget === 'number' ? budget : 0;
  const budgetPercent = initialBudget > 0 ? Math.max(0, Math.min(100, (budgetValue / initialBudget) * 100)) : 0;

  const renderRoleSection = (role) => {
    const players = getPlayersByRole(role);
    const count = players.length;
    const limit = roleLimits[role] || 0;
    const roleColor = getRoleColor(role);
    const isRoleFull = limit > 0 && count >= limit;

    return (
      <View key={role} style={styles.roleSection}>
        <View style={[styles.roleHeader, { backgroundColor: roleColor }]}>
          <View style={styles.roleHeaderLeft}>
            <Ionicons
              name={role === 'P' ? 'hand-left' : role === 'D' ? 'shield' : role === 'C' ? 'flash' : 'flame'}
              size={18}
              color="#fff"
            />
            <Text style={styles.roleHeaderText}>{roleNames[role]}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.roleHeaderCount}>
              {count}/{limit}
            </Text>
            {!isRoleFull && (
              <TouchableOpacity
                onPress={() => navigation.navigate('Market', { leagueId, role })}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="add-circle" size={22} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        </View>
        {players.length === 0 ? (
          <TouchableOpacity
            style={styles.emptyRole}
            onPress={() => navigation.navigate('Market', { leagueId, role })}
            activeOpacity={0.7}
          >
            <Ionicons name="add-circle-outline" size={22} color="#667eea" />
            <Text style={[styles.emptyRoleText, { color: '#667eea', marginTop: 4 }]}>Vai al mercato</Text>
          </TouchableOpacity>
        ) : (
          players.map((player) => (
            <TouchableOpacity
              key={player.id}
              style={styles.playerCard}
              onPress={() => navigation.navigate('PlayerStats', {
                playerId: player.id,
                leagueId: league?.id || leagueId,
                playerName: `${player.first_name} ${player.last_name}`,
                playerRole: player.role,
                playerRating: player.rating,
              })}
              activeOpacity={0.7}
            >
              <View style={[styles.roleStripe, { backgroundColor: roleColor }]} />
              <View style={styles.playerContent}>
                <View style={styles.playerInfo}>
                  <View style={styles.playerNameRow}>
                    <View style={[styles.roleBadgeMini, { backgroundColor: roleColor }]}>
                      <Text style={styles.roleBadgeMiniText}>{player.role}</Text>
                    </View>
                    <Text style={styles.playerName} numberOfLines={1}>
                      {player.first_name} {player.last_name}
                    </Text>
                  </View>
                  <Text style={styles.playerTeam} numberOfLines={1}>{player.team_name}</Text>
                </View>
                <View style={styles.playerRight}>
                  <Text style={styles.playerRating}>{player.rating}</Text>
                  {!marketBlocked && (
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleRemovePlayer(player);
                      }}
                    >
                      <Ionicons name="trash-outline" size={16} color="#fff" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
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
      {/* Header compatto */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1 }} />
          <View style={{ flex: 2, alignItems: 'center' }}>
            <Text style={styles.headerTitle}>Mia Rosa</Text>
            {league && <Text style={styles.leagueName}>{league.name}</Text>}
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            {marketBlocked && (
              <View style={styles.blockedBadge}>
                <Ionicons name="lock-closed" size={14} color="#fff" />
                <Text style={styles.blockedBadgeText}>Bloccato</Text>
              </View>
            )}
          </View>
        </View>

        {/* Budget con barra di progresso */}
        <View style={styles.budgetSection}>
          <View style={styles.budgetRow}>
            <Ionicons name="cash-outline" size={18} color="#198754" />
            <Text style={styles.budgetAmount}>{budgetValue.toFixed(0)}</Text>
            <Text style={styles.budgetTotal}>/ {initialBudget}</Text>
            <View style={styles.budgetDivider} />
            <Ionicons name="trending-up" size={16} color="#667eea" />
            <Text style={styles.totalValueAmount}>{(typeof totalValue === 'number' ? totalValue : 0).toFixed(0)}</Text>
            <Text style={styles.totalValueLabel}>valore</Text>
          </View>
          <View style={styles.budgetBarBg}>
            <View style={[styles.budgetBarFill, { width: `${budgetPercent}%` }]} />
          </View>
        </View>
      </View>

      {/* Contatori ruolo sempre visibili */}
      <View style={styles.roleCountSection}>
        {roles.map((r) => {
          const owned = getPlayersByRole(r).length;
          const limit = roleLimits[r] || 0;
          const isFull = owned >= limit && limit > 0;
          const color = getRoleColor(r);
          return (
            <View key={r} style={styles.roleCountItem}>
              <View style={[styles.roleCountDot, { backgroundColor: color }]} />
              <Text style={[styles.roleCountLabel, isFull && { fontWeight: 'bold', color: '#333' }]}>
                {owned}/{limit}
              </Text>
              {!isFull && (
                <View style={styles.roleCountBadge}>
                  <Text style={styles.roleCountBadgeText}>!</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* Market blocked bar */}
      {marketBlocked && (
        <View style={styles.blockedOverlayBar}>
          <Ionicons name="lock-closed" size={14} color="#856404" />
          <Text style={styles.blockedOverlayText}>Mercato bloccato - non puoi rimuovere giocatori</Text>
        </View>
      )}

      <FlatList
        data={roles}
        renderItem={({ item }) => renderRoleSection(item)}
        keyExtractor={(item) => item}
        contentContainerStyle={[styles.listContent, { paddingBottom: 80 + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>La tua rosa è vuota</Text>
            <Text style={styles.emptySubtext}>
              Vai al mercato per acquistare giocatori
            </Text>
          </View>
        }
      />

      {/* Modal conferma rimozione */}
      <Modal
        visible={confirmPlayer !== null}
        transparent
        animationType="fade"
        onRequestClose={() => !removing && setConfirmPlayer(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {/* Icona */}
            <View style={styles.modalIconWrap}>
              <Ionicons name="person-remove" size={28} color="#dc3545" />
            </View>

            {/* Titolo */}
            <Text style={styles.modalTitle}>Rimuovere giocatore?</Text>

            {/* Info giocatore */}
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

            {/* Descrizione */}
            <Text style={styles.modalDesc}>
              Il giocatore verrà rimosso anche da tutte le tue formazioni e il budget verrà riaccreditato.
            </Text>

            {/* Pulsanti */}
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
                    <Text style={styles.modalRemoveText}>Rimuovi</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Toast feedback rimozione */}
      {removeFeedback !== '' && (
        <View style={[styles.removeFeedback, { bottom: insets.bottom + 70 }]}>
          <Ionicons name="checkmark-circle" size={20} color="#198754" />
          <Text style={styles.removeFeedbackText}>{removeFeedback}</Text>
        </View>
      )}

      {/* Toast messaggi */}
      {toastMsg && (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      )}

      {/* Modal conferma generico */}
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
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  blockedBadgeText: {
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
  budgetDivider: {
    width: 1,
    height: 14,
    backgroundColor: '#ddd',
    marginHorizontal: 8,
    alignSelf: 'center',
  },
  totalValueAmount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#667eea',
    marginLeft: 4,
  },
  totalValueLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: '500',
    marginLeft: 2,
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
  // Contatori ruolo
  roleCountSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
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
  // Lista
  listContent: {
    padding: 12,
  },
  // Sezioni ruolo
  roleSection: {
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
  roleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  roleHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  roleHeaderText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  roleHeaderCount: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  roleCountBadge: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#e53935',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  roleCountBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
  },
  emptyRole: {
    padding: 16,
    alignItems: 'center',
  },
  emptyRoleText: {
    color: '#999',
    fontSize: 13,
  },
  // Player card
  playerCard: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  roleStripe: {
    width: 4,
  },
  playerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  playerInfo: {
    flex: 1,
    marginRight: 8,
  },
  playerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
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
    flex: 1,
  },
  playerTeam: {
    fontSize: 12,
    color: '#888',
    marginLeft: 28,
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
  removeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#dc3545',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Toast
  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 100,
    zIndex: 1000,
    flexDirection: 'row',
    alignItems: 'center',
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
  toastError: {
    backgroundColor: '#e53935',
  },
  toastSuccess: {
    backgroundColor: '#198754',
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  confirmContent: {
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
  confirmIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 14,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  confirmMessage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmBtnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  confirmBtnAction: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  // Toast feedback
  removeFeedback: {
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
  removeFeedbackText: {
    color: '#198754',
    fontSize: 14,
    fontWeight: '700',
  },
  // Modal conferma rimozione
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
  // Empty
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
});

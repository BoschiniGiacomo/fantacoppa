import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { leagueService } from '../services/api';
import { FantasyTeamLogoImage, PlayerPhotoImage } from '../components/StableCachedImage';
import { defaultLogosMap } from '../constants/defaultLogos';
import { parseAppDate } from '../utils/dateTime';
import BonusIcon from '../components/BonusIcon';
import AppLoadingFullScreenModal from '../components/AppLoadingFullScreenModal';
import { useAppLoadingMedia } from '../context/AppLoadingMediaContext';
import { formatVoteRating, normalizeVoteRating } from '../utils/voteRating';
import { getFormationSlotVisual } from '../utils/formationDisplay';

const ROLE_COLORS = { P: '#0d6efd', D: '#198754', C: '#e6a817', A: '#dc3545' };

const getRoleColor = (role) => {
  const colors = { P: '#0d6efd', D: '#198754', C: '#e6a800', A: '#dc3545' };
  return colors[role] || '#6c757d';
};

const ALL_MODULES = {
  '1-1-1': [1,1,1], '1-1-2': [1,1,2], '1-2-1': [1,2,1], '2-1-1': [2,1,1],
  '1-2-2': [1,2,2], '2-2-1': [2,2,1], '2-1-2': [2,1,2], '3-1-1': [3,1,1],
  '2-2-2': [2,2,2], '3-2-1': [3,2,1], '2-3-1': [2,3,1], '1-3-2': [1,3,2], '3-1-2': [3,1,2],
  '3-2-2': [3,2,2], '2-3-2': [2,3,2], '2-2-3': [2,2,3], '4-2-1': [4,2,1], '3-3-1': [3,3,1],
  '3-3-2': [3,3,2], '3-2-3': [3,2,3], '2-3-3': [2,3,3], '4-2-2': [4,2,2],
  '3-3-3': [3,3,3], '4-2-3': [4,2,3], '3-4-2': [3,4,2], '5-2-2': [5,2,2],
  '4-3-2': [4,3,2], '3-5-1': [3,5,1], '4-4-1': [4,4,1],
  '4-4-2': [4,4,2], '4-3-3': [4,3,3], '3-5-2': [3,5,2], '4-5-1': [4,5,1], '5-3-2': [5,3,2],
  '5-4-1': [5,4,1], '5-2-3': [5,2,3], '3-4-3': [3,4,3],
};
const MINI_FIELD_H = 410;

const midTruncate = (str, max = 8) => {
  if (!str || str.length <= max) return str || '';
  const tail = 3;
  const head = max - tail - 2;
  return str.slice(0, head) + '..' + str.slice(-tail);
};

const formatRating = (v) => formatVoteRating(v);

export default function LiveScoresScreen({ route, navigation }) {
  const { leagueId, leagueName, giornata: initialGiornata } = route.params || {};
  const insets = useSafeAreaInsets();
  const { uri: loadingMediaUri, type: loadingMediaType } = useAppLoadingMedia();
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedTeams, setExpandedTeams] = useState({});
  const [currentGiornata, setCurrentGiornata] = useState(initialGiornata);
  const [availableMatchdays, setAvailableMatchdays] = useState([]);
  const [formations, setFormations] = useState({});
  const [formationViewMode, setFormationViewMode] = useState({});
  const [loadingFormation, setLoadingFormation] = useState({});
  const parseDeadlineDate = (value) => parseAppDate(value);

  const loadLiveData = async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      const res = await leagueService.getLiveScores(leagueId, currentGiornata);
      setLiveData(res.data);
    } catch (error) {
      console.error('Error loading live scores:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Carica le giornate live disponibili (non calcolate, con voti, deadline passata)
  const loadAvailableMatchdays = async () => {
    try {
      const statusRes = await leagueService.getMatchdayStatus(leagueId);
      const statuses = statusRes?.data || [];
      const now = new Date();
      const liveDays = statuses
        .filter((m) => {
          const d = parseDeadlineDate(m?.deadline);
          return m.has_votes && !m.is_calculated && d && d < now;
        })
        .sort((a, b) => a.giornata - b.giornata); // ordine crescente G1, G2, G3...
      setAvailableMatchdays(liveDays);
    } catch (e) {
      console.log('Could not load available matchdays:', e);
    }
  };

  // Polling every 15 seconds
  useFocusEffect(
    useCallback(() => {
      loadAvailableMatchdays();
      loadLiveData();
      const interval = setInterval(() => loadLiveData(true), 15000);
      return () => clearInterval(interval);
    }, [leagueId, currentGiornata])
  );

  const toggleTeam = async (userId) => {
    const willExpand = !expandedTeams[userId];
    setExpandedTeams(prev => ({ ...prev, [userId]: willExpand }));
    if (willExpand && !formations[userId]) {
      setLoadingFormation(prev => ({ ...prev, [userId]: true }));
      try {
        const res = await leagueService.getMatchdayFormation(leagueId, currentGiornata, userId);
        setFormations(prev => ({ ...prev, [userId]: res.data }));
      } catch (e) {
        console.error('Error loading formation:', e);
      } finally {
        setLoadingFormation(prev => ({ ...prev, [userId]: false }));
      }
    }
  };

  if (loading) {
    return (
      <AppLoadingFullScreenModal
        visible
        uri={loadingMediaUri}
        mediaType={loadingMediaType}
        progress={1}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveLabel}>LIVE</Text>
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>{leagueName}</Text>
          <Text style={styles.headerSubtitle}>{currentGiornata}ª Giornata</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      {/* Selettore giornate live */}
      {availableMatchdays.length > 1 && (
        <View style={styles.matchdaySelectorWrapper}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.matchdaySelector}
        >
          {availableMatchdays.map((m) => {
            const isActive = m.giornata === currentGiornata;
            return (
              <TouchableOpacity
                key={m.giornata}
                onPress={() => {
                  if (!isActive) {
                    setCurrentGiornata(m.giornata);
                    setExpandedTeams({});
                    setFormations({});
                    setFormationViewMode({});
                  }
                }}
                activeOpacity={0.7}
                style={[
                  styles.matchdayChip,
                  isActive && styles.matchdayChipActive,
                ]}
              >
                <Text style={[
                  styles.matchdayChipText,
                  isActive && styles.matchdayChipTextActive,
                ]}>
                  {m.giornata}ª G
                </Text>
                <Text style={[
                  styles.matchdayChipSub,
                  isActive && styles.matchdayChipSubActive,
                ]}>
                  ({m.votes_count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        </View>
      )}

      {/* Calculated warning */}
      {liveData?.is_calculated && (
        <View style={styles.calcBanner}>
          <Ionicons name="checkmark-circle" size={16} color="#198754" />
          <Text style={styles.calcBannerText}>
            {currentGiornata}ª Giornata già calcolata il {new Date(liveData.calculated_at).toLocaleDateString('it-IT')}
          </Text>
        </View>
      )}

      {!liveData?.is_calculated && (
        <View style={styles.notCalcBanner}>
          <Ionicons name="time-outline" size={16} color="#e6a800" />
          <Text style={styles.notCalcBannerText}>Punteggi provvisori - {currentGiornata}ª giornata non ancora calcolata</Text>
        </View>
      )}

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadLiveData(true); }} />}
      >
        {(liveData?.results || []).map((team, index) => {
          const isExpanded = !!expandedTeams[team.user_id];
          return (
            <View key={team.user_id} style={styles.teamCard}>
              <TouchableOpacity
                style={styles.teamHeader}
                onPress={() => toggleTeam(team.user_id)}
                activeOpacity={0.7}
              >
                <View style={styles.teamPos}>
                  <Text style={styles.teamPosText}>{index + 1}</Text>
                </View>
                {(() => {
                  const tLogo = team.team_logo && team.team_logo.trim() !== '' ? team.team_logo : 'default_1';
                  return tLogo.startsWith('default_') ? (
                    <View style={[styles.teamLogoWrap, { backgroundColor: (defaultLogosMap[tLogo]?.color || '#667eea') + '20' }]}>
                      <Text style={styles.teamLogoEmoji}>{defaultLogosMap[tLogo]?.emoji || '⚽'}</Text>
                    </View>
                  ) : (
                    <FantasyTeamLogoImage teamLogo={tLogo} style={styles.teamLogoWrap} />
                  );
                })()}
                <View style={styles.teamInfo}>
                  <Text style={styles.teamName} numberOfLines={1}>{team.team_name || team.username}</Text>
                  <Text style={styles.teamUser}>{team.username}</Text>
                </View>
                <Text style={styles.teamScore}>{team.punteggio}</Text>
                <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color="#999" />
              </TouchableOpacity>

              {isExpanded && (() => {
                const fData = formations[team.user_id];
                const isLoadingF = loadingFormation[team.user_id];
                const viewMode = formationViewMode[team.user_id] || 'field';

                if (isLoadingF) {
                  return (
                    <View style={styles.formationLoading}>
                      <ActivityIndicator size="small" color="#667eea" />
                      <Text style={styles.formationLoadingText}>Caricamento...</Text>
                    </View>
                  );
                }

                if (fData && fData.formation && fData.formation.length > 0) {
                  return (
                    <View style={styles.formationBox}>
                      {fData.modulo && ALL_MODULES[fData.modulo] && (
                        <View style={styles.fViewTabs}>
                          <TouchableOpacity
                            style={[styles.fViewTab, viewMode === 'field' && styles.fViewTabActive]}
                            onPress={() => setFormationViewMode(prev => ({ ...prev, [team.user_id]: 'field' }))}
                          >
                            <MaterialCommunityIcons name="soccer-field" size={20} color={viewMode === 'field' ? '#667eea' : '#bbb'} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.fViewTab, viewMode === 'list' && styles.fViewTabActive]}
                            onPress={() => setFormationViewMode(prev => ({ ...prev, [team.user_id]: 'list' }))}
                          >
                            <Ionicons name="list" size={18} color={viewMode === 'list' ? '#667eea' : '#bbb'} />
                          </TouchableOpacity>
                        </View>
                      )}

                      {/* FIELD VIEW */}
                      {viewMode === 'field' && fData.modulo && ALL_MODULES[fData.modulo] ? (() => {
                        const parts = ALL_MODULES[fData.modulo];
                        const [d, c, a] = parts;
                        const players = fData.formation;
                        const rows = [
                          { role: 'A', slots: players.slice(1 + d + c, 1 + d + c + a) },
                          { role: 'C', slots: players.slice(1 + d, 1 + d + c) },
                          { role: 'D', slots: players.slice(1, 1 + d) },
                          { role: 'P', slots: [players[0]] },
                        ];
                        const slotSize = 68;
                        return (
                          <View style={styles.miniField}>
                            <View style={styles.miniFieldCenter} />
                            <View style={styles.miniFieldCircle} />
                            <View style={styles.miniFieldAreaTop} />
                            <View style={styles.miniFieldAreaBottom} />
                            {rows.map((row, ri) => {
                              const cnt = row.slots.length;
                              const topPct = ri === 0 ? 4
                                : ri === 1 ? (cnt <= 4 ? 32 : 28)
                                : ri === 2 ? 56 : 80;
                              const slotMarginH = cnt >= 7 ? -10 : cnt >= 6 ? -8 : cnt >= 5 ? -3 : 0;
                              return (
                                <View key={ri} style={[styles.miniFieldRow, { top: `${topPct}%` }, cnt >= 5 && { justifyContent: 'center', marginHorizontal: 4 }, cnt === 4 && { justifyContent: 'center', gap: 2 }]}>
                                  {row.slots.map((p, si) => {
                                    if (!p) return <View key={si} style={{ width: slotSize, height: slotSize }} />;
                                    const vis = getFormationSlotVisual(p);
                                    const roleColor = ROLE_COLORS[vis.role] || '#999';
                                    const hasPhoto = !!vis.photo_path;
                                    const hasVote = normalizeVoteRating(p.rating || 0) > 0 || Number(p.final_rating || 0) > 0;

                                    let yOffset = 0;
                                    if (cnt >= 5) {
                                      const center = (cnt - 1) / 2;
                                      const dist = Math.abs(si - center) / center;
                                      const up = cnt >= 7 ? -125 : cnt >= 6 ? -115 : -105;
                                      const down = cnt >= 7 ? 18 : cnt >= 6 ? 16 : 14;
                                      yOffset = Math.round(up * dist + down * (1 - dist));
                                    }

                                    const bonusItems = [];
                                    if (fData.bonus_enabled) {
                                      const bs = fData.bonus_settings || {};
                                      if (p.goals > 0 && bs.enable_goal) bonusItems.push({ type: 'goal', count: p.goals });
                                      if (p.assists > 0 && bs.enable_assist) bonusItems.push({ type: 'assist', count: p.assists });
                                      if (p.yellow_cards > 0 && bs.enable_yellow_card) bonusItems.push({ type: 'yellow_card', count: p.yellow_cards });
                                      if (p.red_cards > 0 && bs.enable_red_card) bonusItems.push({ type: 'red_card', count: p.red_cards });
                                      if (p.goals_conceded > 0 && bs.enable_goals_conceded) bonusItems.push({ type: 'goals_conceded', count: p.goals_conceded });
                                      if (p.own_goals > 0 && bs.enable_own_goal) bonusItems.push({ type: 'own_goal', count: p.own_goals });
                                      if (p.penalty_missed > 0 && bs.enable_penalty_missed) bonusItems.push({ type: 'penalty_missed', count: p.penalty_missed });
                                      if (p.penalty_saved > 0 && bs.enable_penalty_saved) bonusItems.push({ type: 'penalty_saved', count: p.penalty_saved });
                                      if (p.clean_sheet > 0 && bs.enable_clean_sheet) bonusItems.push({ type: 'clean_sheet', count: p.clean_sheet });
                                      if (p.pallone_fuori > 0 && bs.enable_pallone_fuori) bonusItems.push({ type: 'pallone_fuori', count: p.pallone_fuori });
                                      if (p.briso > 0 && bs.enable_briso) bonusItems.push({ type: 'briso', count: p.briso });
                                      if (p.no_divisa > 0 && bs.enable_no_divisa) bonusItems.push({ type: 'no_divisa', count: p.no_divisa });
                                    }

                                    return (
                                      <View key={p.id || si} style={[styles.miniSlotWrap, ...(slotMarginH !== 0 ? [{ marginHorizontal: slotMarginH }] : []), ...(yOffset !== 0 ? [{ marginTop: yOffset }] : [])]}>
                                        <View style={[styles.miniSlotOuter, { width: slotSize, height: slotSize, opacity: hasVote ? 1 : 0.5 }]}>
                                          <View
                                            style={[
                                              styles.miniSlot,
                                              {
                                                width: slotSize, height: slotSize, borderRadius: slotSize / 2,
                                                borderColor: roleColor,
                                                backgroundColor: hasPhoto ? 'transparent' : roleColor,
                                              },
                                              hasPhoto && { borderWidth: 0 },
                                            ]}
                                          >
                                            {hasPhoto ? (
                                              <View
                                                style={[
                                                  styles.miniSlotPhotoClip,
                                                  { width: slotSize, height: slotSize, borderRadius: slotSize / 2 },
                                                ]}
                                              >
                                                <PlayerPhotoImage
                                                  photoPath={vis.photo_path}
                                                  style={{ width: slotSize * 0.90, height: slotSize * 0.90, position: 'absolute', top: -slotSize * 0.11 }}
                                                />
                                                <View style={[styles.miniSlotOverlay, { backgroundColor: roleColor }]}>
                                                  <Text style={styles.miniSlotOverlayText}>{midTruncate(vis.last_name)}</Text>
                                                </View>
                                              </View>
                                            ) : (
                                              <>
                                                <Text style={styles.miniSlotName} numberOfLines={1}>{midTruncate(vis.last_name, 10)}</Text>
                                                <Text style={styles.miniSlotTeam} numberOfLines={1}>{midTruncate(vis.team_name, 9)}</Text>
                                              </>
                                            )}
                                          </View>
                                          {bonusItems.length > 0 && (
                                            <View style={[styles.fieldBonusCol, cnt === 1 && { right: -22 }]}>
                                              {bonusItems.map((b, idx) => (
                                                <View key={idx} style={styles.fieldBonusChip}>
                                                  <BonusIcon type={b.type} size={17} />
                                                  {b.count > 1 && <Text style={styles.fieldBonusCount}>x{b.count}</Text>}
                                                </View>
                                              ))}
                                            </View>
                                          )}
                                        </View>
                                        <View style={styles.fieldVotesBox}>
                                          <Text style={styles.fieldVoteBase}>{formatRating(p.rating)}</Text>
                                          <View style={styles.fieldVoteSep} />
                                          <Text style={styles.fieldVoteFinal}>{formatRating(p.final_rating)}</Text>
                                        </View>
                                      </View>
                                    );
                                  })}
                                </View>
                              );
                            })}
                          </View>
                        );
                      })() : (
                        /* LIST VIEW */
                        <View>
                          {fData.formation.map((player, index) => {
                            if (!player) return (
                              <View key={`empty-${index}`} style={styles.fPlayerRow}>
                                <Text style={{ color: '#bbb', fontStyle: 'italic' }}>-</Text>
                              </View>
                            );

                            const vis = getFormationSlotVisual(player);
                            const hasVote = normalizeVoteRating(player.rating || 0) > 0 || Number(player.final_rating || 0) > 0;
                            const bonusItems = [];
                            if (fData.bonus_enabled) {
                              const bs = fData.bonus_settings || {};
                              if (player.goals > 0 && bs.enable_goal) bonusItems.push({ type: 'goal', count: player.goals });
                              if (player.assists > 0 && bs.enable_assist) bonusItems.push({ type: 'assist', count: player.assists });
                              if (player.yellow_cards > 0 && bs.enable_yellow_card) bonusItems.push({ type: 'yellow_card', count: player.yellow_cards });
                              if (player.red_cards > 0 && bs.enable_red_card) bonusItems.push({ type: 'red_card', count: player.red_cards });
                              if (player.goals_conceded > 0 && bs.enable_goals_conceded) bonusItems.push({ type: 'goals_conceded', count: player.goals_conceded });
                              if (player.own_goals > 0 && bs.enable_own_goal) bonusItems.push({ type: 'own_goal', count: player.own_goals });
                              if (player.penalty_missed > 0 && bs.enable_penalty_missed) bonusItems.push({ type: 'penalty_missed', count: player.penalty_missed });
                              if (player.penalty_saved > 0 && bs.enable_penalty_saved) bonusItems.push({ type: 'penalty_saved', count: player.penalty_saved });
                              if (player.clean_sheet > 0 && bs.enable_clean_sheet) bonusItems.push({ type: 'clean_sheet', count: player.clean_sheet });
                              if (player.pallone_fuori > 0 && bs.enable_pallone_fuori) bonusItems.push({ type: 'pallone_fuori', count: player.pallone_fuori });
                              if (player.briso > 0 && bs.enable_briso) bonusItems.push({ type: 'briso', count: player.briso });
                              if (player.no_divisa > 0 && bs.enable_no_divisa) bonusItems.push({ type: 'no_divisa', count: player.no_divisa });
                            }

                            return (
                              <View key={player.id || index} style={[styles.fPlayerRow, !hasVote && { opacity: 0.5 }]}>
                                <View style={[styles.fRoleDot, { backgroundColor: ROLE_COLORS[vis.role] || '#999' }]}>
                                  <Text style={styles.fRoleDotText}>{vis.role || '-'}</Text>
                                </View>
                                <Text style={styles.fPlayerName} numberOfLines={1}>
                                  {vis.first_name} {vis.last_name}
                                </Text>
                                {bonusItems.length > 0 && (
                                  <View style={styles.fBonusRow}>
                                    {bonusItems.map((b, idx) => (
                                      <View key={idx} style={styles.fBonusChip}>
                                        <BonusIcon type={b.type} size={12} />
                                        {b.count > 1 && <Text style={styles.fBonusCount}>×{b.count}</Text>}
                                      </View>
                                    ))}
                                  </View>
                                )}
                                <View style={styles.fVotesBox}>
                                  <Text style={styles.fVoteBase}>{formatRating(player.rating)}</Text>
                                  <Text style={styles.fVoteSep}>|</Text>
                                  <Text style={styles.fVoteFinal}>{formatRating(player.final_rating)}</Text>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                }

                return (
                  <View style={styles.noPlayersContainer}>
                    <Text style={styles.noPlayersText}>Nessun titolare con voto</Text>
                  </View>
                );
              })()}
            </View>
          );
        })}

        {(!liveData?.results || liveData.results.length === 0) && (
          <View style={styles.emptyContainer}>
            <Ionicons name="football-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>Nessun dato disponibile</Text>
          </View>
        )}
      </ScrollView>
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: {
    padding: 8,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2e7d32',
  },
  liveLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2e7d32',
    letterSpacing: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#999',
  },
  matchdaySelectorWrapper: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  matchdaySelector: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
    alignItems: 'center',
  },
  matchdayChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#f0f0f0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  matchdayChipActive: {
    backgroundColor: '#2e7d32',
  },
  matchdayChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#555',
  },
  matchdayChipTextActive: {
    color: '#fff',
  },
  matchdayChipSub: {
    fontSize: 10,
    color: '#999',
  },
  matchdayChipSubActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  calcBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  calcBannerText: {
    fontSize: 12,
    color: '#198754',
    fontWeight: '500',
  },
  notCalcBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3cd',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  notCalcBannerText: {
    fontSize: 12,
    color: '#856404',
    fontWeight: '500',
  },
  content: {
    flex: 1,
    padding: 12,
  },
  teamCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
  },
  teamPos: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamPosText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  teamLogoWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamLogoEmoji: {
    fontSize: 15,
  },
  teamInfo: {
    flex: 1,
  },
  teamName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  teamUser: {
    fontSize: 11,
    color: '#999',
  },
  teamScore: {
    fontSize: 18,
    fontWeight: '800',
    color: '#333',
    marginRight: 4,
  },
  playersContainer: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f8f8f8',
  },
  roleStripe: {
    width: 3,
    height: 24,
    borderRadius: 1.5,
    marginRight: 8,
  },
  roleBadge: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  playerName: {
    flex: 1,
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
  },
  playerRating: {
    fontSize: 13,
    fontWeight: '600',
    color: '#667eea',
    width: 32,
    textAlign: 'center',
  },
  playerBonus: {
    fontSize: 11,
    fontWeight: '600',
    width: 36,
    textAlign: 'center',
  },
  bonusPositive: {
    color: '#198754',
  },
  bonusNegative: {
    color: '#dc3545',
  },
  playerTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    width: 38,
    textAlign: 'right',
  },
  noPlayersContainer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    alignItems: 'center',
  },
  noPlayersText: {
    fontSize: 13,
    color: '#999',
    fontStyle: 'italic',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 12,
  },

  /* Formation box */
  formationBox: {
    backgroundColor: '#fafafa',
    borderRadius: 8,
    padding: 10,
    marginTop: 0,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  formationLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  formationLoadingText: { fontSize: 13, color: '#999' },

  /* Formation view tabs */
  fViewTabs: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  fViewTab: { flex: 1, paddingVertical: 6, borderRadius: 8, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  fViewTabActive: { backgroundColor: '#e8ecff' },

  /* Mini field */
  miniField: { height: MINI_FIELD_H, backgroundColor: '#2e8b57', borderRadius: 8, position: 'relative', overflow: 'hidden', marginHorizontal: -10 },
  miniFieldCenter: { position: 'absolute', top: '49%', left: 0, right: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  miniFieldCircle: { position: 'absolute', top: '50%', left: '50%', width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', marginLeft: -30, marginTop: -30 },
  miniFieldAreaTop: { position: 'absolute', top: 0, left: '25%', right: '25%', height: 30, borderWidth: 2, borderTopWidth: 0, borderColor: 'rgba(255,255,255,0.18)', borderBottomLeftRadius: 6, borderBottomRightRadius: 6 },
  miniFieldAreaBottom: { position: 'absolute', bottom: 0, left: '25%', right: '25%', height: 30, borderWidth: 2, borderBottomWidth: 0, borderColor: 'rgba(255,255,255,0.18)', borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  miniFieldRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center' },
  miniSlot: { borderWidth: 2, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 2, elevation: 3 },
  miniSlotName: { color: '#fff', fontWeight: '700', fontSize: 10, textAlign: 'center' },
  miniSlotTeam: { color: 'rgba(255,255,255,0.75)', fontSize: 7, textAlign: 'center', marginTop: 1 },
  miniSlotOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 2, alignItems: 'center', borderBottomLeftRadius: 999, borderBottomRightRadius: 999 },
  miniSlotOverlayText: { color: '#fff', fontSize: 9, fontWeight: '700', textAlign: 'center' },
  miniSlotWrap: { alignItems: 'center', overflow: 'visible' },
  miniSlotOuter: { position: 'relative', overflow: 'visible' },
  miniSlotPhotoClip: { overflow: 'hidden', justifyContent: 'flex-end' },
  fieldBonusCol: { position: 'absolute', top: -4, right: -6, flexDirection: 'column', gap: 1, alignItems: 'flex-start', zIndex: 4 },
  fieldBonusChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 6, paddingHorizontal: 2, paddingVertical: 1 },
  fieldBonusCount: { color: '#333', fontSize: 9, fontWeight: '700', marginLeft: 1 },
  fieldVotesBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 6, marginTop: -2, paddingHorizontal: 4, paddingVertical: 1 },
  fieldVoteBase: { fontSize: 9, fontWeight: '600', color: '#333' },
  fieldVoteSep: { width: 1, height: 10, backgroundColor: '#ccc', marginHorizontal: 3 },
  fieldVoteFinal: { fontSize: 9, fontWeight: '700', color: '#2e7d32' },

  /* Formation list view */
  fPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  fRoleDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  fRoleDotText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  fPlayerName: { flex: 1, fontSize: 13, fontWeight: '500', color: '#2c3e50' },
  fBonusRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginRight: 6 },
  fBonusChip: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  fBonusCount: { fontSize: 10, color: '#666', fontWeight: '600' },
  fVotesBox: { flexDirection: 'row', alignItems: 'center', minWidth: 56, justifyContent: 'flex-end' },
  fVoteBase: { fontSize: 13, fontWeight: '600', color: '#333' },
  fVoteSep: { fontSize: 12, color: '#ccc', marginHorizontal: 2 },
  fVoteFinal: { fontSize: 13, fontWeight: '700', color: '#2e7d32' },
});

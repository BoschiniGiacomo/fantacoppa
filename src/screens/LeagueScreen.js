import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useOnboarding } from '../context/OnboardingContext';
import { leagueService, formationService } from '../services/api';
import { peekDashboard, setDashboard } from '../services/leagueWarmCache';
import { Ionicons } from '@expo/vector-icons';
import { publicAssetUrl } from '../services/api';
import TeamInfoModal from '../components/TeamInfoModal';
import { defaultLogosMap } from '../constants/defaultLogos';
import { syncSubmittedFormationOnboarding } from '../utils/formationSubmission';
import { parseAppDate } from '../utils/dateTime';

export default function LeagueScreen({ route, navigation }) {
  const { user } = useAuth();
  const { updateAutoDetect, markDone } = useOnboarding();
  const { leagueId } = route.params;
  const insets = useSafeAreaInsets();
  const [league, setLeague] = useState(null);
  const [userStats, setUserStats] = useState(null);
  const [userScores, setUserScores] = useState([]);
  const [topStandings, setTopStandings] = useState([]);
  const [userTeamInfo, setUserTeamInfo] = useState(null); // team_name e coach_name
  const [loading, setLoading] = useState(true);
  const [showTeamInfoModal, setShowTeamInfoModal] = useState(false);
  const [defaultTeamName, setDefaultTeamName] = useState('');
  const [defaultCoachName, setDefaultCoachName] = useState('');
  const [squadPlayersCount, setSquadPlayersCount] = useState(0);
  const [marketPlayersCount, setMarketPlayersCount] = useState(0);
  const [liveMatchday, setLiveMatchday] = useState(null);
  const [nextDeadline, setNextDeadline] = useState(null);       // { deadline: string, giornata: number }
  const [deadlineCountdown, setDeadlineCountdown] = useState(null); // { days, hours, mins, secs }
  const [toastMsg, setToastMsg] = useState(null);
  const parseDeadlineDate = (value) => parseAppDate(value);

  const normalizeUserScores = (rawScores) => {
    if (!Array.isArray(rawScores)) return [];
    return rawScores
      .map((entry, idx) => {
        // New format: { giornata, punteggio }
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          const giornata = Number(entry.giornata || idx + 1);
          const punteggio = Number(entry.punteggio || 0);
          return {
            giornata: Number.isFinite(giornata) && giornata > 0 ? giornata : idx + 1,
            punteggio: Number.isFinite(punteggio) ? punteggio : 0,
          };
        }
        // Legacy format: [63.25, 42, 0]
        const numeric = Number(entry);
        return {
          giornata: idx + 1,
          punteggio: Number.isFinite(numeric) ? numeric : 0,
        };
      })
      .filter((s) => Number.isFinite(Number(s?.giornata)) && Number(s.giornata) > 0);
  };

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  // Ricarica i dati quando la schermata torna in focus (es. dopo aver modificato team_name/coach_name)
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [leagueId])
  );

  // Countdown timer per la prossima scadenza formazione
  useEffect(() => {
    if (!nextDeadline) { setDeadlineCountdown(null); return; }
    const tick = () => {
      const deadlineDate = parseDeadlineDate(nextDeadline.deadline);
      if (!deadlineDate) { setDeadlineCountdown(null); setNextDeadline(null); return false; }
      const diff = deadlineDate.getTime() - Date.now();
      if (diff <= 0) { setDeadlineCountdown(null); setNextDeadline(null); return false; }
      setDeadlineCountdown({
        days:  Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        mins:  Math.floor((diff % 3600000) / 60000),
        secs:  Math.floor((diff % 60000) / 1000),
      });
      return true;
    };
    if (!tick()) return;
    const id = setInterval(() => { if (!tick()) clearInterval(id); }, 1000);
    return () => clearInterval(id);
  }, [nextDeadline]);

  // Aggiorna lo stato di onboarding con i dati auto-detect
  const hasDefaultNamesCheck = userTeamInfo && 
    userTeamInfo.team_name && 
    userTeamInfo.coach_name &&
    /^Squadra\s*\d+$/i.test(userTeamInfo.team_name.trim()) &&
    /^Allenatore\s*\d+$/i.test(userTeamInfo.coach_name.trim());

  useEffect(() => {
    updateAutoDetect({
      hasDefaultNames: !!hasDefaultNamesCheck,
      squadEmpty: squadPlayersCount === 0,
      marketAvailable: marketPlayersCount > 0,
    });
  }, [hasDefaultNamesCheck, squadPlayersCount, marketPlayersCount]);

  const loadData = async () => {
    const applyFromPayload = (payload) => {
      const payloadObj = payload && typeof payload === 'object' ? payload : {};
      const leagueData = payloadObj?.league && typeof payloadObj.league === 'object'
        ? payloadObj.league
        : { id: Number(leagueId), name: 'Lega' };
      const leagueName = String(leagueData.name || '').trim();
      const safeLeague = { ...leagueData, name: leagueName || `Lega ${leagueId}` };
      const isSuperuserViewer = String(safeLeague?.role || '') === 'superuser_viewer';
      const teamInfo = payloadObj?.user_team_info || {};
      const safeTeamLogo = String(teamInfo.team_logo || safeLeague.team_logo || 'default_1').trim() || 'default_1';

      setLeague(safeLeague);
      setUserTeamInfo({
        team_name: String(teamInfo.team_name || safeLeague.team_name || '').trim(),
        coach_name: String(teamInfo.coach_name || safeLeague.coach_name || '').trim(),
        team_logo: safeTeamLogo,
      });
      updateAutoDetect({ autoLineupMode: !!safeLeague.auto_lineup_mode });

      if (payloadObj.needs_info && !isSuperuserViewer) {
        setDefaultTeamName(String(payloadObj.default_team_name || '').trim());
        setDefaultCoachName(String(payloadObj.default_coach_name || '').trim());
        setShowTeamInfoModal(true);
      } else {
        setShowTeamInfoModal(false);
      }

      setLoading(false);

      requestAnimationFrame(() => {
        const top = Array.isArray(payloadObj.top_standings) ? payloadObj.top_standings : [];
        setTopStandings(top.slice(0, 5));

        const us = payloadObj.user_stats;
        setUserStats(us ? {
          position: Number(us.position || 0),
          totalPoints: Number(Number(us.totalPoints || 0).toFixed(1)),
          avgPoints: Number(Number(us.avgPoints || 0).toFixed(2)),
        } : null);

        const scoresNorm = normalizeUserScores(Array.isArray(payloadObj.user_scores) ? payloadObj.user_scores : []);
        if (scoresNorm.length >= 5) setUserScores(scoresNorm.slice(-5).reverse());
        else setUserScores(scoresNorm);

        setSquadPlayersCount(Number(payloadObj.squad_players_count || 0));
        setMarketPlayersCount(Number(payloadObj.market_players_count || 0));
        setLiveMatchday(Number(payloadObj.live_matchday || 0) || null);

        const isAutoLineupMode = Number(safeLeague?.auto_lineup_mode || 0) === 1;
        if (isAutoLineupMode) {
          setNextDeadline(null);
        } else {
          const nd = payloadObj?.next_deadline;
          setNextDeadline(
            nd && nd.deadline
              ? { giornata: Number(nd.giornata || 0), deadline: String(nd.deadline) }
              : null
          );
        }

        updateAutoDetect({
          squadFull: !!payloadObj.squad_full,
        });
      });
    };

    const t0 = Date.now();
    console.log(`[PERF][LeagueHome] loadData START (leagueId=${leagueId})`);

    const warm = peekDashboard(leagueId);
    if (warm != null) {
      console.log(`[PERF][LeagueHome] warm cache HIT — skip loading spinner`);
      applyFromPayload(warm);
    } else {
      console.log(`[PERF][LeagueHome] warm cache MISS — showing spinner`);
      setLoading(true);
    }

    try {
      const tApi = Date.now();
      const res = await leagueService.getDashboardData(leagueId);
      const tApiEnd = Date.now();
      const payloadSize = JSON.stringify(res?.data)?.length ?? 0;
      console.log(`[PERF][LeagueHome] GET /dashboard-data: ${tApiEnd - tApi}ms (payload: ${payloadSize} bytes)`);
      const payload = res?.data || {};
      applyFromPayload(payload);
      setDashboard(leagueId, payload);

      try {
        const tOnb = Date.now();
        await syncSubmittedFormationOnboarding({ leagueId, formationService, markDone });
        console.log(`[PERF][LeagueHome] syncOnboarding: ${Date.now() - tOnb}ms`);
      } catch (_) {}
    } catch (error) {
      if (warm == null) {
        showToast('Impossibile caricare i dati della lega');
        console.error('Error loading league data:', error);
        console.error('Error details:', error.response?.data || error.message);
        setTopStandings([]);
        setSquadPlayersCount(0);
        setMarketPlayersCount(0);
      } else {
        showToast('Impossibile aggiornare i dati della lega');
        console.error('Error loading league data:', error);
      }
      setLoading(false);
    } finally {
      console.log(`[PERF][LeagueHome] loadData TOTAL: ${Date.now() - t0}ms`);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  // Gestisci il caso in cui league è un array (problema noto: API restituisce array invece di oggetto)
  let displayLeague = league;
  if (Array.isArray(league)) {
    console.warn('League state is an array, searching for league with ID:', leagueId);
    const foundLeague = league.find(l => l && l.id === parseInt(leagueId));
    if (foundLeague) {
      displayLeague = foundLeague;
      console.log('Found league in array:', foundLeague.name);
    } else {
      console.error('League not found in array, using first item');
      displayLeague = league[0] || null;
    }
  }

  if (!displayLeague) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Lega non trovata</Text>
      </View>
    );
  }

  // Debug: log dello stato della lega prima del render
  //console.log('Rendering with league state:', JSON.stringify(league, null, 2));
  //console.log('League is array?', Array.isArray(league));
  const displayName = (displayLeague && displayLeague.name) ? displayLeague.name : 'Lega';

  // Verifica se i nomi sono ancora i valori di default
  const hasDefaultNames = userTeamInfo && 
    userTeamInfo.team_name && 
    userTeamInfo.coach_name &&
    /^Squadra\s*\d+$/i.test(userTeamInfo.team_name.trim()) &&
    /^Allenatore\s*\d+$/i.test(userTeamInfo.coach_name.trim());
  const isAutoLineupMode = Number(displayLeague?.auto_lineup_mode || 0) === 1;

  // Medaglie top 3
  const medalColors = ['#ffc107', '#adb5bd', '#cd7f32']; // oro, argento, bronzo

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 60 + insets.bottom }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header: nome lega ── */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Text style={styles.headerTitle}>{displayName}</Text>
      </View>

      {/* ── Card squadra + statistiche ── */}
      {userTeamInfo && (
        <View style={styles.teamCard}>
          <View style={styles.teamRow}>
            {/* Logo */}
            {userTeamInfo.team_logo ? (
              userTeamInfo.team_logo.startsWith('default_') ? (
                <View style={[styles.teamLogo, styles.teamLogoDefault, { backgroundColor: (defaultLogosMap[userTeamInfo.team_logo]?.color || '#667eea') + '20' }]}>
                  <Text style={styles.teamLogoEmoji}>{defaultLogosMap[userTeamInfo.team_logo]?.emoji || '⚽'}</Text>
                </View>
              ) : (
                <Image
                  source={{ uri: publicAssetUrl(userTeamInfo.team_logo) }}
                  style={styles.teamLogo}
                  onError={() => {}}
                />
              )
            ) : (
              <View style={[styles.teamLogo, styles.teamLogoPlaceholder]}>
                <Ionicons name="shirt-outline" size={28} color="#ccc" />
              </View>
            )}
            {/* Nome + coach */}
            <View style={styles.teamText}>
              {userTeamInfo.team_name ? <Text style={styles.teamName} numberOfLines={1}>{userTeamInfo.team_name}</Text> : null}
              {userTeamInfo.coach_name ? <Text style={styles.coachName} numberOfLines={1}>{userTeamInfo.coach_name}</Text> : null}
            </View>
          </View>
          {/* Statistiche inline */}
          {userStats && (
            <View style={styles.statsRow}>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>{userStats.position}°</Text>
                <Text style={styles.statLabel}>Posizione</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCell}>
                <Text style={styles.statValue}>{userStats.totalPoints}</Text>
                <Text style={styles.statLabel}>Punti</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCell}>
                <Text style={styles.statValue}>{userStats.avgPoints}</Text>
                <Text style={styles.statLabel}>Media</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ── Avvisi setup ── */}
      {(hasDefaultNames || squadPlayersCount === 0) && (
        <View style={styles.tipsWrap}>
          {hasDefaultNames && (
            <TouchableOpacity style={[styles.tipBanner, { backgroundColor: '#fff8e1' }]} activeOpacity={0.7} onPress={() => navigation.navigate('Settings', { leagueId, section: 'team' })}>
              <Ionicons name="pencil-outline" size={16} color="#c8a000" />
              <View style={styles.tipTextWrap}>
                <Text style={[styles.tipTitle, { color: '#7a6100' }]}>Personalizza la tua squadra</Text>
                <Text style={[styles.tipDesc, { color: '#9a8200' }]}>Dai un nome unico e scegli il tuo allenatore</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#c8a000" />
            </TouchableOpacity>
          )}
          {squadPlayersCount === 0 && (
            <TouchableOpacity style={[styles.tipBanner, { backgroundColor: '#fff3e0' }]} activeOpacity={0.7} onPress={() => navigation.navigate('Market', { leagueId })}>
              <Ionicons name="cart-outline" size={16} color="#bf5500" />
              <View style={styles.tipTextWrap}>
                <Text style={[styles.tipTitle, { color: '#7a3d00' }]}>Costruisci la tua squadra</Text>
                <Text style={[styles.tipDesc, { color: '#a35200' }]}>La rosa è vuota — vai al mercato!</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#bf5500" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Banner Live ── */}
      {liveMatchday && (
        <TouchableOpacity style={styles.liveBanner} activeOpacity={0.7} onPress={() => navigation.navigate('LiveScores', { leagueId, leagueName: displayName, giornata: liveMatchday })}>
          <View style={styles.liveDot} />
          <Text style={styles.liveBannerText}>Live — {liveMatchday}ª Giornata</Text>
          <Ionicons name="chevron-forward" size={16} color="#2e7d32" />
        </TouchableOpacity>
      )}

      {/* ── Banner scadenza formazione ── */}
      {!isAutoLineupMode && nextDeadline && deadlineCountdown && (
        <TouchableOpacity style={styles.fdBanner} activeOpacity={0.7} onPress={() => navigation.navigate('Formation', { leagueId })}>
          <View style={styles.fdLeft}>
            <Ionicons name="football-outline" size={20} color="#667eea" />
            <View>
              <Text style={styles.fdTitle}>Formazione {nextDeadline.giornata}ª G</Text>
              <Text style={styles.fdDate}>
                {(() => {
                  const d = parseDeadlineDate(nextDeadline.deadline);
                  if (!d) return 'Data non disponibile';
                  return `${d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })} alle ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
                })()}
              </Text>
            </View>
          </View>
          <View style={styles.fdRight}>
            <View style={styles.fdCountdown}>
              {(() => {
                const c = deadlineCountdown;
                const totalMins = c.days * 1440 + c.hours * 60 + c.mins;
                const showSecs = totalMins < 5;
                const urgent = totalMins < 60;
                const parts = [];
                if (c.days > 0) parts.push({ val: c.days, u: 'g' });
                if (c.hours > 0 || c.days > 0) parts.push({ val: c.hours, u: 'h' });
                parts.push({ val: c.mins, u: 'm' });
                if (showSecs) parts.push({ val: c.secs, u: 's' });
                return parts.map(p => (
                  <View key={p.u} style={styles.fdCell}>
                    <Text style={[styles.fdNum, urgent && styles.fdNumUrgent]}>{p.val}</Text>
                    <Text style={[styles.fdUnit, urgent && styles.fdUnitUrgent]}>{p.u}</Text>
                  </View>
                ));
              })()}
            </View>
            <Ionicons name="chevron-forward" size={16} color="#999" />
          </View>
        </TouchableOpacity>
      )}

      {/* ── Classifica ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Top 5 Classifica</Text>
        {topStandings.length > 0 ? (
          topStandings.slice(0, 5).map((team, index) => {
            const tName = team.team_name || team.username || 'Squadra';
            const pts = parseFloat(team.punteggio || 0).toFixed(1);
            const isMe = team.id === user?.id;
            const tLogo = team.team_logo && team.team_logo.trim() !== '' ? team.team_logo : 'default_1';
            return (
              <View key={team.id ? `t-${team.id}` : `t-${index}`} style={[styles.rankRow, isMe && styles.rankRowMe, index === 0 && { borderTopWidth: 0 }]}>
                {index < 3 ? (
                  <View style={[styles.medalCircle, { backgroundColor: medalColors[index] + '25' }]}>
                    <Ionicons name={index === 0 ? "trophy" : "medal-outline"} size={14} color={medalColors[index]} />
                  </View>
                ) : (
                  <View style={styles.posCircle}>
                    <Text style={styles.posNum}>{index + 1}</Text>
                  </View>
                )}
                {tLogo.startsWith('default_') ? (
                  <View style={[styles.rankLogo, { backgroundColor: (defaultLogosMap[tLogo]?.color || '#667eea') + '20' }]}>
                    <Text style={styles.rankLogoEmoji}>{defaultLogosMap[tLogo]?.emoji || '⚽'}</Text>
                  </View>
                ) : (
                  <Image source={{ uri: publicAssetUrl(tLogo) }} style={styles.rankLogo} />
                )}
                <Text style={[styles.rankName, isMe && styles.rankNameMe]} numberOfLines={1}>{tName}</Text>
                <Text style={styles.rankPts}>{pts}</Text>
              </View>
            );
          })
        ) : (
          <Text style={styles.emptyText}>Nessun dato disponibile</Text>
        )}
      </View>

      {/* ── Ultime giornate ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ultime giornate</Text>
        {userScores.length > 0 ? (
          <View style={styles.scoresRow}>
            {userScores.map((score, index) => (
              <View key={`s-${score.giornata}-${index}`} style={styles.scoreChip}>
                <Text style={styles.scoreGiornata}>{score.giornata}ª</Text>
                <Text style={styles.scorePts}>{parseFloat(score.punteggio || 0).toFixed(1)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.scoresRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <View key={`empty-score-${n}`} style={[styles.scoreChip, styles.scoreChipEmpty]}>
                <Text style={styles.scoreGiornata}>{n}ª</Text>
                <Text style={styles.scorePtsEmpty}>-</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Modal per inserire nome squadra e allenatore */}
      <TeamInfoModal
        visible={showTeamInfoModal}
        leagueId={leagueId}
        defaultTeamName={defaultTeamName}
        defaultCoachName={defaultCoachName}
        onSave={async (teamName, coachName) => {
          setShowTeamInfoModal(false);
          setUserTeamInfo((prev) => ({
            team_name: teamName,
            coach_name: coachName,
            team_logo: prev?.team_logo || 'default_1',
          }));
          await loadData();
        }}
        onClose={() => {}}
      />

      {toastMsg && (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // ── Base ──
  container: { flex: 1, backgroundColor: '#f2f3f7' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: '#dc3545' },

  // ── Header ──
  header: { paddingHorizontal: 16, paddingBottom: 10, alignItems: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#333', textAlign: 'center' },

  // ── Team card ──
  teamCard: {
    backgroundColor: '#fff', marginHorizontal: 14, marginTop: 12, borderRadius: 14,
    padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  teamLogo: {
    width: 60, height: 60, borderRadius: 30, borderWidth: 1.5,
    borderColor: '#e8e8e8', backgroundColor: '#fff',
  },
  teamLogoDefault: { alignItems: 'center', justifyContent: 'center' },
  teamLogoEmoji: { fontSize: 30 },
  teamLogoPlaceholder: {
    borderStyle: 'dashed', borderColor: '#ddd', backgroundColor: '#fafafa',
    alignItems: 'center', justifyContent: 'center',
  },
  teamText: { flex: 1 },
  teamName: { fontSize: 18, fontWeight: '700', color: '#222' },
  coachName: { fontSize: 13, color: '#888', marginTop: 2 },
  // Stats inline
  statsRow: {
    flexDirection: 'row', marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: '#f0f0f0',
  },
  statCell: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800', color: '#667eea' },
  statLabel: { fontSize: 11, color: '#999', fontWeight: '600', marginTop: 3, textTransform: 'uppercase' },
  statDivider: { width: 1, backgroundColor: '#f0f0f0', marginVertical: 2 },

  // ── Tips / avvisi ──
  tipsWrap: { marginHorizontal: 14, marginTop: 10, gap: 8 },
  tipBanner: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, gap: 10 },
  tipTextWrap: { flex: 1 },
  tipTitle: { fontSize: 13, fontWeight: '600', marginBottom: 1 },
  tipDesc: { fontSize: 12, lineHeight: 16 },

  // ── Live banner ──
  liveBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#e8f5e9', marginHorizontal: 14, marginTop: 10,
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12,
    borderWidth: 1, borderColor: '#a5d6a7', gap: 8,
  },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#2e7d32' },
  liveBannerText: { fontSize: 14, fontWeight: '700', color: '#2e7d32', flex: 1 },

  // ── Formation deadline banner ──
  fdBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#f5f7ff', marginHorizontal: 14, marginTop: 10,
    paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12,
    borderWidth: 1, borderColor: '#e0e5ff',
  },
  fdLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  fdTitle: { fontSize: 13, fontWeight: '700', color: '#333' },
  fdDate: { fontSize: 11, color: '#888', marginTop: 1 },
  fdRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fdCountdown: { flexDirection: 'row', alignItems: 'baseline', gap: 1 },
  fdCell: { flexDirection: 'row', alignItems: 'baseline' },
  fdNum: { fontSize: 17, fontWeight: '800', color: '#333', fontVariant: ['tabular-nums'] },
  fdNumUrgent: { color: '#e53935' },
  fdUnit: { fontSize: 11, color: '#999', fontWeight: '700', marginRight: 3 },
  fdUnitUrgent: { color: '#e57373' },

  // ── Card generico (classifica, giornate) ──
  card: {
    backgroundColor: '#fff', marginHorizontal: 14, marginTop: 12, borderRadius: 14,
    padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 12 },

  // ── Classifica ──
  rankRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#f4f4f4',
  },
  rankRowMe: { backgroundColor: '#f5f7ff', marginHorizontal: -16, paddingHorizontal: 16, borderRadius: 8 },
  medalCircle: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  posCircle: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#f4f4f4', alignItems: 'center', justifyContent: 'center',
  },
  posNum: { fontSize: 12, fontWeight: '700', color: '#888' },
  rankLogo: { width: 28, height: 28, borderRadius: 14, marginLeft: 8, borderWidth: 1, borderColor: '#eee', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  rankLogoEmoji: { fontSize: 14 },
  rankName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#333', marginLeft: 8 },
  rankNameMe: { color: '#667eea', fontWeight: '700' },
  rankPts: { fontSize: 15, fontWeight: '800', color: '#198754', fontVariant: ['tabular-nums'] },
  emptyText: { fontSize: 13, color: '#bbb', textAlign: 'center', paddingVertical: 16 },

  // ── Ultime giornate ──
  scoresRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  scoreChip: {
    flex: 1, alignItems: 'center', backgroundColor: '#f8f9fa',
    borderRadius: 10, paddingVertical: 10,
  },
  scoreGiornata: { fontSize: 11, fontWeight: '700', color: '#999', marginBottom: 4 },
  scorePts: { fontSize: 17, fontWeight: '800', color: '#198754' },

  // ── Toast ──
  toast: {
    position: 'absolute', top: 100, left: 20, right: 20, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row',
    alignItems: 'center', gap: 10, shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25,
    shadowRadius: 8, elevation: 10, zIndex: 999,
  },
  toastError: { backgroundColor: '#e53935' },
  toastSuccess: { backgroundColor: '#2e7d32' },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
});

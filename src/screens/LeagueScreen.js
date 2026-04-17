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
import { leagueService, squadService, marketService, formationService } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { publicAssetUrl } from '../services/api';
import TeamInfoModal from '../components/TeamInfoModal';
import { defaultLogosMap } from '../constants/defaultLogos';
import { syncSubmittedFormationOnboarding } from '../utils/formationSubmission';

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
      const diff = new Date(nextDeadline.deadline).getTime() - Date.now();
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
    try {
      // Prima verifica se l'utente ha bisogno di inserire team_name e coach_name
      try {
        console.log('=== CHECK TEAM INFO ===');
        console.log('League ID:', leagueId);
        const teamInfoCheck = await leagueService.checkTeamInfo(leagueId);
        console.log('Team info check response:', JSON.stringify(teamInfoCheck.data, null, 2));
        
        if (teamInfoCheck.data && teamInfoCheck.data.needs_info) {
          console.log('User needs to provide team info');
          console.log('Default team name:', teamInfoCheck.data.default_team_name);
          console.log('Default coach name:', teamInfoCheck.data.default_coach_name);
          // Evita falso "Lega non trovata" mentre mostriamo la modal dati squadra.
          setLeague((prev) => (
            prev && !Array.isArray(prev)
              ? prev
              : { id: Number(leagueId), name: 'Lega' }
          ));
          
          setDefaultTeamName(teamInfoCheck.data.default_team_name || '');
          setDefaultCoachName(teamInfoCheck.data.default_coach_name || '');
          setShowTeamInfoModal(true);
          setLoading(false);
          console.log('Team info modal should be visible now');
          return; // Non caricare altri dati finché non vengono inseriti team_name e coach_name
        }
      } catch (error) {
        console.error('Error checking team info:', error);
        console.error('Error details:', error.response?.data || error.message);
        // Continua comunque a caricare i dati
      }

      const [leagueRes, standingsFullRes, userStatsRes, squadRes, marketRes, roleLimitsRes] = await Promise.all([
        leagueService.getById(leagueId).catch(err => {
          console.error('Error getting league:', err);
          return { data: { id: leagueId, name: 'Lega' } };
        }),
        leagueService.getStandingsFull(leagueId).catch(err => {
          console.error('Error getting full standings:', err);
          return { data: [] };
        }),
        leagueService.getUserStats(leagueId).catch(() => ({ data: null })), // Per gli ultimi 5 punteggi
        squadService.getSquad(leagueId).catch(() => ({ data: { squad: [] } })), // Per conteggio giocatori rosa
        marketService.getPlayers(leagueId).catch(() => ({ data: [] })), // Per conteggio giocatori mercato
        squadService.getRoleLimits(leagueId).catch(() => ({ data: {} })), // Per limiti ruolo
      ]);
      
      //console.log('League response:', JSON.stringify(leagueRes, null, 2));
      //console.log('League response data:', JSON.stringify(leagueRes.data, null, 2));
      
      // Imposta sempre i dati della lega se disponibili
      if (leagueRes && leagueRes.data) {
        let leagueData = leagueRes.data;
        
        // Se la risposta è un array, prendi la prima lega con l'ID corretto
        if (Array.isArray(leagueData)) {
          console.warn('API returned an array instead of a single object, searching for league with ID:', leagueId);
          const foundLeague = leagueData.find(l => l && l.id === parseInt(leagueId));
          if (foundLeague) {
            leagueData = foundLeague;
            console.log('Found league in array:', leagueData.name);
          } else {
            console.error('League not found in array. Requested ID:', leagueId, 'Available IDs:', leagueData.map(l => l?.id).filter(Boolean));
            // NON usare un fallback errato - mostra errore invece
            showToast(`Lega con ID ${leagueId} non trovata. Potresti non essere ancora iscritto a questa lega.`);
            setLoading(false);
            return;
          }
        }
        
        console.log('Full league data:', JSON.stringify(leagueData, null, 2));
        
        // Assicurati che il nome sia presente - prova anche campi alternativi
        const leagueName = leagueData.name || leagueData.league_name || leagueData.leagueName || null;
        if (!leagueName || leagueName === '' || leagueName === null) {
          console.warn('League name is missing! League data:', leagueData);
          // Prova a recuperare il nome dalla dashboard se disponibile
          leagueData.name = 'Lega ' + leagueId;
        } else {
          // Assicurati che il nome sia una stringa valida
          leagueData.name = String(leagueName).trim();
        }
   
        // Assicurati di settare un oggetto, non un array
        if (!Array.isArray(leagueData)) {
          setLeague(leagueData);
          
          // Aggiorna onboarding: modalità formazione automatica
          updateAutoDetect({ autoLineupMode: !!(leagueData.auto_lineup_mode) });
          
          // Se team_name, coach_name o team_logo sono presenti nei dati della lega, usali per userTeamInfo
          // (questo è utile quando si torna da Settings dopo aver modificato i dati)
          // Il logo personalizzato ha precedenza sul default
          // Assicurati che team_logo sia sempre impostato (default_1 solo se mancante/null/vuoto)
          // Il logo personalizzato ha sempre precedenza
          const teamLogo = (leagueData.team_logo && leagueData.team_logo.trim() !== '') ? leagueData.team_logo : 'default_1';
          setUserTeamInfo({
            team_name: leagueData.team_name || '',
            coach_name: leagueData.coach_name || '',
            team_logo: teamLogo, // team_logo può essere un percorso personalizzato o 'default_X'
          });
        } else {
          console.error('Trying to set league with an array! Using fallback.');
          setLeague({ id: leagueId, name: 'Lega' });
        }
      } else {
        console.error('League data is null or undefined');
        // Prova a recuperare almeno l'ID dalla route
        setLeague({ id: leagueId, name: 'Lega' });
      }
      
      // Top 5 classifica - prendi i primi 5 dalla classifica completa
      const fullStandingsData = standingsFullRes.data;
      const fallbackTeamInfo = {
        team_name: (leagueRes?.data?.team_name || '').trim?.() || league?.team_name || '',
        coach_name: (leagueRes?.data?.coach_name || '').trim?.() || league?.coach_name || '',
        team_logo: (leagueRes?.data?.team_logo && String(leagueRes.data.team_logo).trim() !== '')
          ? String(leagueRes.data.team_logo)
          : (league?.team_logo || 'default_1'),
      };
      let top5 = [];
      if (Array.isArray(fullStandingsData) && fullStandingsData.length > 0) {
        top5 = fullStandingsData.slice(0, 5); // I primi 5 sono già ordinati per punteggio
      } else {
        console.log('Full standings is not an array or is empty');
      }
      setTopStandings(top5);
      
      if (Array.isArray(fullStandingsData) && fullStandingsData.length > 0 && user?.id) {
        // Trova l'utente nella classifica
        const userIndex = fullStandingsData.findIndex(team => team.id === user.id);
        
        if (userIndex !== -1) {
          const userTeam = fullStandingsData[userIndex];
          
          const position = userIndex + 1;
          const totalPoints = parseFloat(userTeam.punteggio || 0);
          const avgPoints = parseFloat(userTeam.media_punti || 0);
          const giornateConVoti = userTeam.giornate_con_voti || 0;
          const teamName = userTeam.team_name || '';
          const coachName = userTeam.coach_name || userTeam.username || '';
          
          setUserStats({
            position: position,
            totalPoints: totalPoints.toFixed(1),
            avgPoints: avgPoints.toFixed(2),
          });
          
          // Imposta info squadra
          // NON sovrascrivere team_logo se è già stato impostato da leagueData (può essere personalizzato)
          // Usa il logo già impostato in userTeamInfo (da leagueData) se esiste, altrimenti usa league?.team_logo
          setUserTeamInfo(prev => {
            const existingLogo = prev?.team_logo; // Logo già impostato da leagueData (può essere personalizzato)
            const leagueLogo = league?.team_logo || 'default_1'; // Logo da league state (fallback)
            const finalLogo = existingLogo || leagueLogo; // Usa quello esistente se c'è, altrimenti quello da league
            
            return {
              team_name: teamName,
              coach_name: coachName,
              team_logo: finalLogo, // Mantieni il logo personalizzato se esiste già
            };
          });
          
          // Ultimi 5 punteggi - usa getUserStats se disponibile
          if (userStatsRes && userStatsRes.data && userStatsRes.data.scores && Array.isArray(userStatsRes.data.scores)) {
            const scores = normalizeUserScores(userStatsRes.data.scores);
            
            // Mostra solo se ci sono almeno 1 punteggio (max 5)
            if (scores.length > 0) {
              // Se ci sono 5 o più, prendi le ultime 5 e inverti l'ordine (ultima a sinistra)
              // Se ci sono meno di 5, prendi tutte in ordine crescente (1, 2, 3...)
              let scoresToSet;
              if (scores.length >= 5) {
                scoresToSet = scores.slice(-5).reverse(); // Ultime 5, ordine decrescente
              } else {
                scoresToSet = scores; // Tutte in ordine crescente
              }
              setUserScores(scoresToSet);
            } else {
              console.log('Nessun punteggio disponibile - array vuoto o nessun punteggio > 0');
              setUserScores([]);
            }
          } else {
            console.log('userStatsRes non contiene scores validi');
            setUserScores([]);
          }
        } else {
          console.log('User not found in standings');
          setUserStats(null);
          setUserTeamInfo((prev) => ({
            team_name: prev?.team_name || fallbackTeamInfo.team_name,
            coach_name: prev?.coach_name || fallbackTeamInfo.coach_name,
            team_logo: prev?.team_logo || fallbackTeamInfo.team_logo,
          }));
          setUserScores([]);
        }
      } else {
        console.log('Full standings not available or user not logged in');
        setUserStats(null);
        setUserTeamInfo((prev) => ({
          team_name: prev?.team_name || fallbackTeamInfo.team_name,
          coach_name: prev?.coach_name || fallbackTeamInfo.coach_name,
          team_logo: prev?.team_logo || fallbackTeamInfo.team_logo,
        }));
        // Prova comunque a recuperare i punteggi
        console.log('=== FALLBACK: Recupero punteggi ===');
        if (userStatsRes && userStatsRes.data && userStatsRes.data.scores && Array.isArray(userStatsRes.data.scores)) {
          const scores = normalizeUserScores(userStatsRes.data.scores);
          console.log('Scores trovati nel fallback:', scores.length);
          if (scores.length > 0) {
            const last5Scores = scores.slice(-5).reverse();
            setUserScores(last5Scores);
          } else {
            setUserScores([]);
          }
        } else {
          console.log('Nessun punteggio nel fallback');
          setUserScores([]);
        }
      }
      console.log('=== FINE DEBUG STATISTICHE UTENTE ===');
      
      // Conta i giocatori nella rosa
      const squadData = squadRes?.data;
      const playersArray = squadData?.players || squadData?.squad || [];
      const squadCount = Array.isArray(playersArray) ? playersArray.length : 0;
      setSquadPlayersCount(squadCount);
      
      // Conta i giocatori disponibili nel mercato
      const marketData = marketRes?.data || [];
      const marketCount = Array.isArray(marketData) ? marketData.length : 0;
      setMarketPlayersCount(marketCount);

      // Calcola se la rosa è completa (tutti gli slot pieni per ogni ruolo)
      const limits = roleLimitsRes?.data || {};
      if (limits && Object.keys(limits).length > 0 && Array.isArray(playersArray)) {
        const allFull = ['P', 'D', 'C', 'A'].every(r => {
          const limit = limits[r] || 0;
          const owned = playersArray.filter(p => p.role === r).length;
          return limit > 0 && owned >= limit;
        });
        updateAutoDetect({ squadFull: allFull });
      }

      // Controlla se c'è una giornata live:
      // la giornata con deadline nel passato più vicina a oggi, non calcolata, con almeno un voto
      try {
        const statusRes = await leagueService.getMatchdayStatus(leagueId);
        const statuses = statusRes?.data || [];
        const now = new Date();
        
        // Filtra: deadline passata, ha voti, non calcolata
        const liveCandidate = statuses
          .filter(m => m.has_votes && !m.is_calculated && m.deadline && new Date(m.deadline) < now)
          .sort((a, b) => new Date(b.deadline) - new Date(a.deadline)); // più recente prima
        
        setLiveMatchday(liveCandidate.length > 0 ? liveCandidate[0].giornata : null);
      } catch (e) {
        console.log('Could not load matchday status:', e);
        setLiveMatchday(null);
      }

      const isAutoLineupMode = Number(leagueRes?.data?.auto_lineup_mode || 0) === 1;

      // Prossima scadenza formazione + check badge (solo se formazione NON automatica)
      if (isAutoLineupMode) {
        setNextDeadline(null);
      } else {
        try {
          const mdRes = await formationService.getMatchdays(leagueId);
          const mds = mdRes?.data || [];
          const now = new Date();
          const future = mds
            .filter(m => m.deadline && new Date(m.deadline) > now)
            .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
          if (future.length > 0) {
            setNextDeadline({ deadline: future[0].deadline, giornata: future[0].giornata });
          } else {
            setNextDeadline(null);
          }

          try {
            await syncSubmittedFormationOnboarding({ leagueId, formationService, markDone });
          } catch (_) {}
        } catch (e) {
          console.log('Could not load formation deadlines:', e);
          setNextDeadline(null);
        }
      }

    } catch (error) {
      showToast('Impossibile caricare i dati della lega');
      console.error('Error loading league data:', error);
      console.error('Error details:', error.response?.data || error.message);
      setTopStandings([]);
      setSquadPlayersCount(0);
      setMarketPlayersCount(0);
    } finally {
      setLoading(false);
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
                {new Date(nextDeadline.deadline).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}
                {' alle '}
                {new Date(nextDeadline.deadline).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
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

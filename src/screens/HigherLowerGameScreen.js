import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { matchesService, minigamesService } from '../services/api';
import { getMenuOfficialGroup } from '../utils/menuOfficialGroupSettings';
import { HIGHER_LOWER_GAME_KEY, getMetricValue } from '../minigames/higherLower/metrics';
import {
  createInitialRound,
  evaluateGuess,
  advanceRound,
  filterPlayablePlayers,
} from '../minigames/higherLower/engine';
import { getLocalBest, setLocalBest, mergeBest } from '../minigames/higherLower/storage';
import MinigamePlayerAvatar from '../minigames/higherLower/MinigamePlayerAvatar';
import HigherLowerInfoModal from '../minigames/higherLower/HigherLowerInfoModal';

function PlayerCard({
  player,
  metric,
  showValue,
  valueOverride,
  highlight,
  valueScale,
}) {
  const value = valueOverride != null ? valueOverride : getMetricValue(player, metric);
  return (
    <View style={[styles.card, highlight === 'win' && styles.cardWin, highlight === 'lose' && styles.cardLose]}>
      <MinigamePlayerAvatar photoPath={player?.photo_path} name={player?.name} size={96} />
      <View style={styles.cardTextCol}>
        <Text style={styles.cardName} numberOfLines={2}>{player?.name || '—'}</Text>
        <View style={styles.metricChip}>
          <Text style={styles.metricChipText}>{metric?.unitLabel || 'stat'}</Text>
        </View>
        {showValue ? (
          <Animated.Text
            style={[
              styles.cardValue,
              valueScale ? { transform: [{ scale: valueScale }] } : null,
            ]}
          >
            {value}
          </Animated.Text>
        ) : (
          <Text style={styles.cardValueHidden}>??</Text>
        )}
      </View>
    </View>
  );
}

export default function HigherLowerGameScreen({ navigation, route }) {
  const routeGroupId = Number(route?.params?.groupId) || null;
  const routeGroupName = route?.params?.groupName || '';

  const [groupId, setGroupId] = useState(routeGroupId);
  const [groupName, setGroupName] = useState(routeGroupName);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pool, setPool] = useState([]);
  const [round, setRound] = useState(null);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [phase, setPhase] = useState('guess'); // guess | reveal | gameover
  const [lastResult, setLastResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const valueScale = useRef(new Animated.Value(1)).current;
  const streakScale = useRef(new Animated.Value(1)).current;
  const recentRef = useRef([]);

  const bounceValue = useCallback(() => {
    valueScale.setValue(0.6);
    Animated.spring(valueScale, {
      toValue: 1,
      friction: 5,
      tension: 140,
      useNativeDriver: true,
    }).start();
  }, [valueScale]);

  const bounceStreak = useCallback(() => {
    streakScale.setValue(0.85);
    Animated.sequence([
      Animated.timing(streakScale, {
        toValue: 1.18,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(streakScale, {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }),
    ]).start();
  }, [streakScale]);

  const bootstrapRound = useCallback((players) => {
    const initial = createInitialRound(players);
    if (!initial) {
      setError('Servono almeno due giocatori con statistiche per giocare.');
      setRound(null);
      return;
    }
    recentRef.current = initial.recentEntityIds || [];
    setRound(initial);
    setStreak(0);
    setPhase('guess');
    setLastResult(null);
    setError(null);
  }, []);

  const loadPack = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let gid = groupId;
      let gname = groupName;
      if (!gid) {
        const menu = await getMenuOfficialGroup();
        if (!menu?.id) throw new Error('Gruppo ufficiale non configurato');
        gid = menu.id;
        gname = menu.name;
        setGroupId(gid);
        setGroupName(gname);
      }

      const [packRes, localBest] = await Promise.all([
        matchesService.getHigherLowerPack(gid),
        getLocalBest(gid),
      ]);
      let serverBest = 0;
      try {
        const bestRes = await minigamesService.getBest(HIGHER_LOWER_GAME_KEY, gid);
        serverBest = Number(bestRes?.data?.best_score) || 0;
      } catch (_) {}

      const mergedBest = await mergeBest(gid, Math.max(localBest, serverBest));
      setBest(mergedBest);

      const players = filterPlayablePlayers(packRes?.data?.players || []);
      setPool(players);
      bootstrapRound(players);
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Errore caricamento gioco');
    } finally {
      setLoading(false);
    }
  }, [groupId, groupName, bootstrapRound]);

  useEffect(() => {
    loadPack();
  }, [loadPack]);

  const persistBestIfNeeded = useCallback(async (score) => {
    if (!groupId || score <= 0) return;
    const nextLocal = await setLocalBest(groupId, score);
    setBest((prev) => Math.max(prev, nextLocal, score));
    if (score > best || score >= nextLocal) {
      try {
        const res = await minigamesService.submitBest(HIGHER_LOWER_GAME_KEY, groupId, score);
        const serverBest = Number(res?.data?.best_score) || score;
        setBest((prev) => Math.max(prev, serverBest));
        await mergeBest(groupId, serverBest);
      } catch (_) {}
    }
  }, [groupId, best]);

  const onGuess = async (guess) => {
    if (phase !== 'guess' || busy || !round) return;
    setBusy(true);
    const result = evaluateGuess(guess, round.cardA, round.cardB, round.metric);
    setLastResult(result);
    setPhase('reveal');
    bounceValue();

    if (result.correct) {
      const nextStreak = streak + 1;
      setStreak(nextStreak);
      bounceStreak();
      if (nextStreak > best) {
        setBest(nextStreak);
        void persistBestIfNeeded(nextStreak);
      }

      setTimeout(() => {
        const next = advanceRound(pool, round.cardB, recentRef.current);
        if (!next) {
          setPhase('gameover');
          setBusy(false);
          void persistBestIfNeeded(nextStreak);
          return;
        }
        recentRef.current = next.recentEntityIds || [];
        setRound(next);
        setLastResult(null);
        setPhase('guess');
        setBusy(false);
      }, 900);
    } else {
      void persistBestIfNeeded(streak);
      setTimeout(() => {
        setPhase('gameover');
        setBusy(false);
      }, 1000);
    }
  };

  const onReplay = () => {
    bootstrapRound(pool);
  };

  const prompt = round?.metric?.prompt || 'Higher or Lower';
  const bHighlight = lastResult
    ? (lastResult.correct ? 'win' : 'lose')
    : null;

  const headerSubtitle = useMemo(() => {
    if (groupName) return groupName;
    return 'Statistiche ufficiali';
  }, [groupName]);

  const infoBtn = (
    <TouchableOpacity
      onPress={() => setInfoOpen(true)}
      hitSlop={12}
      style={styles.backBtn}
      accessibilityLabel="Come si gioca a Higher or Lower"
      accessibilityRole="button"
    >
      <Ionicons name="information-circle-outline" size={22} color="#94a3b8" />
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Higher or Lower</Text>
          {infoBtn}
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#667eea" />
          <Text style={styles.loadingText}>Carico i giocatori…</Text>
        </View>
        <HigherLowerInfoModal visible={infoOpen} onClose={() => setInfoOpen(false)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Higher or Lower</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{headerSubtitle}</Text>
        </View>
        {infoBtn}
      </View>

      <View style={styles.scoreBar}>
        <View style={styles.scoreCell}>
          <Text style={styles.scoreLabel}>Streak</Text>
          <Animated.Text style={[styles.scoreValue, { transform: [{ scale: streakScale }] }]}>
            {streak}
          </Animated.Text>
        </View>
        <View style={styles.scoreDivider} />
        <View style={styles.scoreCell}>
          <Text style={styles.scoreLabel}>Record</Text>
          <Text style={styles.scoreValue}>{best}</Text>
        </View>
      </View>

      {error || !round ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error || 'Nessuna partita disponibile'}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={loadPack}>
            <Text style={styles.primaryBtnText}>Riprova</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.playArea}>
          <Text style={styles.prompt}>{prompt}</Text>

          <View style={styles.cardsBlock}>
            <PlayerCard
              player={round.cardA}
              metric={round.metric}
              showValue
            />

            <View style={styles.vsRow}>
              <View style={styles.vsLine} />
              <Text style={styles.vsText}>o</Text>
              <View style={styles.vsLine} />
            </View>

            <PlayerCard
              player={round.cardB}
              metric={round.metric}
              showValue={phase !== 'guess'}
              highlight={bHighlight}
              valueScale={phase !== 'guess' ? valueScale : null}
            />
          </View>

          {phase === 'guess' ? (
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.guessBtn, styles.higherBtn]}
                activeOpacity={0.88}
                onPress={() => onGuess('higher')}
                disabled={busy}
              >
                <Ionicons name="arrow-up" size={22} color="#fff" />
                <Text style={styles.guessBtnText}>Higher</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.guessBtn, styles.lowerBtn]}
                activeOpacity={0.88}
                onPress={() => onGuess('lower')}
                disabled={busy}
              >
                <Ionicons name="arrow-down" size={22} color="#fff" />
                <Text style={styles.guessBtnText}>Lower</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.feedbackRow}>
              <Text style={[styles.feedbackText, lastResult?.correct ? styles.okText : styles.koText]}>
                {lastResult?.correct ? 'Corretto!' : 'Sbagliato'}
              </Text>
            </View>
          )}
        </View>
      )}

      <Modal visible={phase === 'gameover'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Partita finita</Text>
            <Text style={styles.modalScoreLabel}>Punteggio</Text>
            <Text style={styles.modalScore}>{streak}</Text>
            <Text style={styles.modalRecord}>Record: {best}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={onReplay} activeOpacity={0.9}>
              <Text style={styles.primaryBtnText}>Rigioca</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => navigation.navigate('MinigamesHub')}
            >
              <Text style={styles.secondaryBtnText}>Torna ai minigiochi</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <HigherLowerInfoModal visible={infoOpen} onClose={() => setInfoOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ececec',
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  headerSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  scoreBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8edf3',
    overflow: 'hidden',
  },
  scoreCell: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  scoreDivider: { width: 1, backgroundColor: '#e8edf3' },
  scoreLabel: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  scoreValue: { marginTop: 2, fontSize: 26, fontWeight: '800', color: '#111827' },
  playArea: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  prompt: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 10,
  },
  cardsBlock: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 0,
  },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#ececec',
    minHeight: 120,
  },
  cardWin: { borderColor: '#86efac', backgroundColor: '#f0fdf4' },
  cardLose: { borderColor: '#fca5a5', backgroundColor: '#fef2f2' },
  cardTextCol: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 18, fontWeight: '800', color: '#111827' },
  metricChip: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#eef2ff',
  },
  metricChipText: { fontSize: 11, fontWeight: '700', color: '#667eea', textTransform: 'uppercase' },
  cardValue: { marginTop: 10, fontSize: 40, fontWeight: '900', color: '#111827' },
  cardValueHidden: { marginTop: 10, fontSize: 40, fontWeight: '900', color: '#cbd5e1' },
  vsRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 10, gap: 10 },
  vsLine: { flex: 1, height: 1, backgroundColor: '#e2e8f0' },
  vsText: { fontSize: 13, fontWeight: '800', color: '#94a3b8' },
  actions: {
    marginTop: 12,
    marginBottom: 2,
    gap: 10,
  },
  guessBtn: {
    height: 54,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  higherBtn: { backgroundColor: '#16a34a' },
  lowerBtn: { backgroundColor: '#dc2626' },
  guessBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  feedbackRow: {
    marginTop: 12,
    marginBottom: 2,
    minHeight: 118,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackText: { fontSize: 18, fontWeight: '800' },
  okText: { color: '#16a34a' },
  koText: { color: '#dc2626' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { marginTop: 12, color: '#64748b' },
  errorText: { color: '#b91c1c', textAlign: 'center', marginBottom: 16 },
  primaryBtn: {
    backgroundColor: '#667eea',
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryBtn: { marginTop: 12, alignItems: 'center', paddingVertical: 10 },
  secondaryBtnText: { color: '#667eea', fontWeight: '700', fontSize: 15 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 22,
    alignItems: 'center',
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#111827' },
  modalScoreLabel: { marginTop: 14, fontSize: 13, color: '#94a3b8', fontWeight: '600' },
  modalScore: { fontSize: 48, fontWeight: '900', color: '#667eea' },
  modalRecord: { marginBottom: 18, color: '#64748b', fontWeight: '600' },
});

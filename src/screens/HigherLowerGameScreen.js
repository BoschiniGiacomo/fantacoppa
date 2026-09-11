import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { minigamesService } from '../services/api';
import { getMenuOfficialGroup } from '../utils/menuOfficialGroupSettings';
import { HIGHER_LOWER_GAME_KEY, getMetricValue, buildComparePrompt } from '../minigames/higherLower/metrics';
import {
  createInitialRound,
  evaluateGuess,
  advanceRound,
  filterPlayablePlayers,
} from '../minigames/higherLower/engine';
import { getLocalBest, setLocalBest, mergeBest } from '../minigames/higherLower/storage';
import MinigamePlayerAvatar from '../minigames/higherLower/MinigamePlayerAvatar';
import HigherLowerInfoModal from '../minigames/higherLower/HigherLowerInfoModal';
import HigherLowerLogo from '../minigames/higherLower/HigherLowerLogo';
import {
  peekHigherLowerPack,
  peekHigherLowerGroupMaxYear,
  fetchHigherLowerPackCached,
} from '../minigames/higherLower/packCache';
import { getSistemaSettings, getVisibleMinigames } from '../utils/sistemaSettings';

function PlayerCard({
  player,
  metric,
  showValue,
  valueOverride,
  highlight,
  valueScale,
  countUp = false,
}) {
  const target = valueOverride != null ? valueOverride : getMetricValue(player, metric);
  const targetNum = Number(target) || 0;
  const [displayValue, setDisplayValue] = useState(showValue && countUp ? 0 : targetNum);
  const countAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!showValue) {
      setDisplayValue(0);
      countAnim.setValue(0);
      return undefined;
    }

    if (!countUp) {
      setDisplayValue(targetNum);
      countAnim.setValue(targetNum);
      return undefined;
    }

    countAnim.setValue(0);
    setDisplayValue(0);
    const listenerId = countAnim.addListener(({ value }) => {
      setDisplayValue(Math.round(value));
    });

    const duration = Math.min(820, Math.max(420, 340 + Math.abs(targetNum) * 10));
    const anim = Animated.timing(countAnim, {
      toValue: targetNum,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished) setDisplayValue(targetNum);
    });

    return () => {
      anim.stop();
      countAnim.removeListener(listenerId);
    };
  }, [showValue, countUp, targetNum, countAnim]);

  return (
    <View
      style={[
        styles.card,
        highlight === 'win' && styles.cardWin,
        highlight === 'lose' && styles.cardLose,
      ]}
    >
      <View style={styles.cardMediaCol}>
        <MinigamePlayerAvatar
          photoPath={player?.photo_path}
          name={player?.name}
          size={72}
        />
      </View>
      <View style={styles.cardTextCol}>
        <Text
          style={styles.cardName}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {player?.name || '—'}
        </Text>
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
            {displayValue}
          </Animated.Text>
        ) : (
          <Text style={styles.cardValueHidden}>??</Text>
        )}
      </View>
    </View>
  );
}

function SkeletonBlock({ style }) {
  return <View style={[styles.skelBlock, style]} />;
}

function GuessButtons({ disabled = false, onHigher, onLower }) {
  return (
    <View style={styles.actions}>
      <TouchableOpacity
        style={[styles.guessBtn, styles.higherBtn, disabled && styles.guessBtnDisabled]}
        activeOpacity={0.88}
        onPress={onHigher}
        disabled={disabled}
      >
        <Ionicons name="arrow-up" size={22} color="#fff" />
        <Text style={styles.guessBtnText}>Higher</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.guessBtn, styles.lowerBtn, disabled && styles.guessBtnDisabled]}
        activeOpacity={0.88}
        onPress={onLower}
        disabled={disabled}
      >
        <Text style={styles.guessBtnText}>Lower</Text>
        <Ionicons name="arrow-down" size={22} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

function HigherLowerSkeleton() {
  return (
    <View style={styles.playArea}>
      <SkeletonBlock style={styles.skelPrompt} />
      <View style={styles.cardsBlock}>
        <View style={[styles.card, styles.skelCard]}>
          <View style={styles.cardMediaCol}>
            <SkeletonBlock style={styles.skelAvatar} />
          </View>
          <View style={styles.cardTextCol}>
            <SkeletonBlock style={styles.skelName} />
            <SkeletonBlock style={styles.skelChip} />
            <SkeletonBlock style={styles.skelValue} />
          </View>
        </View>
        <View style={styles.vsRow}>
          <View style={styles.vsLine} />
          <Text style={styles.vsText}>O</Text>
          <View style={styles.vsLine} />
        </View>
        <View style={[styles.card, styles.skelCard]}>
          <View style={styles.cardMediaCol}>
            <SkeletonBlock style={styles.skelAvatar} />
          </View>
          <View style={styles.cardTextCol}>
            <SkeletonBlock style={styles.skelName} />
            <SkeletonBlock style={styles.skelChip} />
            <SkeletonBlock style={[styles.skelValue, { width: 72 }]} />
          </View>
        </View>
      </View>
      <GuessButtons disabled />
      <Text style={styles.skelHint}>Carico i giocatori…</Text>
    </View>
  );
}

export default function HigherLowerGameScreen({ navigation, route }) {
  const routeGroupId = Number(route?.params?.groupId) || null;
  const routeGroupName = route?.params?.groupName || '';

  const [groupId, setGroupId] = useState(routeGroupId);
  const [groupName, setGroupName] = useState(routeGroupName);
  const cachedStart = routeGroupId ? peekHigherLowerPack(routeGroupId) : null;
  const [loading, setLoading] = useState(!(cachedStart?.length >= 2));
  const [error, setError] = useState(null);
  const [pool, setPool] = useState(cachedStart || []);
  const [round, setRound] = useState(null);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [phase, setPhase] = useState('guess'); // guess | reveal | gameover
  const [lastResult, setLastResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [soloMinigame, setSoloMinigame] = useState(
    () => route?.params?.soloMinigame === true,
  );

  const valueScale = useRef(new Animated.Value(1)).current;
  const streakScale = useRef(new Animated.Value(1)).current;
  const vsBadgeScale = useRef(new Animated.Value(1)).current;
  const streakInY = useRef(new Animated.Value(22)).current;
  const streakInOpacity = useRef(new Animated.Value(0)).current;
  const recentRef = useRef([]);
  const poolRef = useRef(pool);
  const phaseRef = useRef(phase);
  const bestRef = useRef(0);
  const recordAtStartRef = useRef(0);
  const groupMaxYearRef = useRef(
    routeGroupId ? peekHigherLowerGroupMaxYear(routeGroupId) : null,
  );
  const [showStreakInBadge, setShowStreakInBadge] = useState(false);
  const [streakPopValue, setStreakPopValue] = useState(0);

  useEffect(() => { poolRef.current = pool; }, [pool]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { bestRef.current = best; }, [best]);

  const bounceValue = useCallback(() => {
    valueScale.setValue(0.45);
    Animated.timing(valueScale, {
      toValue: 1,
      duration: 780,
      easing: Easing.out(Easing.back(1.15)),
      useNativeDriver: true,
    }).start();
  }, [valueScale]);

  const bounceVsBadge = useCallback(() => {
    vsBadgeScale.setValue(0.35);
    Animated.spring(vsBadgeScale, {
      toValue: 1,
      friction: 5,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [vsBadgeScale]);

  const revealStreakInBadge = useCallback((n) => {
    setStreakPopValue(n);
    setShowStreakInBadge(true);
    streakInY.setValue(22);
    streakInOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(streakInOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(streakInY, {
        toValue: 0,
        friction: 7,
        tension: 88,
        useNativeDriver: true,
      }),
    ]).start();
  }, [streakInY, streakInOpacity]);

  const bounceStreak = useCallback(() => {
    streakScale.setValue(0.85);
    Animated.sequence([
      Animated.timing(streakScale, {
        toValue: 1.18,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(streakScale, {
        toValue: 1,
        friction: 5,
        useNativeDriver: true,
      }),
    ]).start();
  }, [streakScale]);

  const bootstrapRound = useCallback((players) => {
    const initial = createInitialRound(players, {
      groupMaxYear: groupMaxYearRef.current,
    });
    if (!initial) {
      setError('Servono almeno due giocatori con statistiche per giocare.');
      setRound(null);
      return false;
    }
    recordAtStartRef.current = bestRef.current;
    recentRef.current = initial.recentEntityIds || [];
    setRound(initial);
    setStreak(0);
    setPhase('guess');
    setLastResult(null);
    setBusy(false);
    setError(null);
    setShowStreakInBadge(false);
    setStreakPopValue(0);
    vsBadgeScale.setValue(1);
    streakInY.setValue(22);
    streakInOpacity.setValue(0);
    return true;
  }, [vsBadgeScale, streakInY, streakInOpacity]);

  const loadPack = useCallback(async () => {
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

      const keepCurrentRound =
        (poolRef.current?.length || 0) >= 2
        && phaseRef.current !== 'gameover'
        && phaseRef.current !== 'reveal';

      const cached = peekHigherLowerPack(gid);
      if (cached?.length >= 2) {
        groupMaxYearRef.current = peekHigherLowerGroupMaxYear(gid);
        setPool(cached);
        poolRef.current = cached;
        if (!keepCurrentRound) bootstrapRound(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }

      const [players, localBest] = await Promise.all([
        fetchHigherLowerPackCached(gid, { force: !!cached }),
        getLocalBest(gid),
      ]);

      let serverBest = 0;
      try {
        const bestRes = await minigamesService.getBest(HIGHER_LOWER_GAME_KEY, gid);
        serverBest = Number(bestRes?.data?.best_score) || 0;
      } catch (_) {}

      const mergedBest = await mergeBest(gid, Math.max(localBest, serverBest));
      bestRef.current = mergedBest;
      setBest(mergedBest);

      groupMaxYearRef.current = peekHigherLowerGroupMaxYear(gid);
      const playable = filterPlayablePlayers(players);
      setPool(playable);
      poolRef.current = playable;
      if (!keepCurrentRound || phaseRef.current === 'gameover') {
        bootstrapRound(playable);
      } else {
        // Round già avviato da cache: allinea il record di riferimento
        recordAtStartRef.current = mergedBest;
      }
    } catch (e) {
      if (!(peekHigherLowerPack(groupId)?.length >= 2)) {
        setError(e?.response?.data?.message || e?.message || 'Errore caricamento gioco');
      }
    } finally {
      setLoading(false);
    }
  }, [groupId, groupName, bootstrapRound]);

  useEffect(() => {
    const cached = peekHigherLowerPack(routeGroupId);
    if (cached?.length >= 2) bootstrapRound(cached);
    loadPack();
    getSistemaSettings()
      .then((sistema) => {
        const visible = getVisibleMinigames(sistema);
        setSoloMinigame(visible.length === 1);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (phaseRef.current !== 'gameover') return undefined;
      const players = poolRef.current;
      if (players?.length >= 2) bootstrapRound(players);
      return undefined;
    }, [bootstrapRound]),
  );

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
    setShowStreakInBadge(false);
    const result = evaluateGuess(guess, round.cardA, round.cardB, round.metric);
    setLastResult(result);
    setPhase('reveal');
    bounceValue();
    bounceVsBadge();

    if (result.correct) {
      const nextStreak = streak + 1;
      setStreak(nextStreak);
      bounceStreak();
      if (nextStreak > best) {
        setBest(nextStreak);
        void persistBestIfNeeded(nextStreak);
      }

      setTimeout(() => {
        revealStreakInBadge(nextStreak);
      }, 980);

      setTimeout(() => {
        const next = advanceRound(
          pool,
          round.cardB,
          recentRef.current,
          round?.metric?.key || null,
          nextStreak,
          { groupMaxYear: groupMaxYearRef.current },
        );
        if (!next) {
          setPhase('gameover');
          setBusy(false);
          void persistBestIfNeeded(nextStreak);
          return;
        }
        recentRef.current = next.recentEntityIds || [];
        setRound(next);
        setLastResult(null);
        setShowStreakInBadge(false);
        setPhase('guess');
        setBusy(false);
        vsBadgeScale.setValue(1);
        streakInY.setValue(22);
        streakInOpacity.setValue(0);
      }, 2700);
    } else {
      void persistBestIfNeeded(streak);
      setTimeout(() => {
        setPhase('gameover');
        setBusy(false);
      }, 1450);
    }
  };

  const onReplay = () => {
    bootstrapRound(pool);
  };

  const goToHub = () => {
    if (pool.length >= 2) bootstrapRound(pool);
    else {
      setPhase('guess');
      setLastResult(null);
      setBusy(false);
    }
    navigation.navigate('MinigamesHub');
  };

  const goToHome = () => {
    if (pool.length >= 2) bootstrapRound(pool);
    else {
      setPhase('guess');
      setLastResult(null);
      setBusy(false);
    }
    navigation.navigate('MainTabs', { screen: 'Partite' });
  };

  const prompt = round
    ? buildComparePrompt(round.metric, round.cardA)
    : 'Higher or Lower';
  const bHighlight = lastResult
    ? (lastResult.correct ? 'win' : 'lose')
    : null;

  const recordAtStart = recordAtStartRef.current;
  const scoreVsRecord =
    streak > recordAtStart ? 'up' : streak < recordAtStart ? 'down' : 'tie';

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

  const showSkeleton = loading && !round;

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
            {showSkeleton ? '—' : streak}
          </Animated.Text>
        </View>
        <View style={styles.scoreDivider} />
        <View style={styles.scoreCell}>
          <Text style={styles.scoreLabel}>Record</Text>
          <Text style={styles.scoreValue}>{best || (showSkeleton ? '—' : 0)}</Text>
        </View>
      </View>

      {showSkeleton ? (
        <HigherLowerSkeleton />
      ) : error || !round ? (
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
              <Animated.View
                style={[
                  styles.vsBadge,
                  phase !== 'guess' && lastResult?.correct && styles.vsBadgeOk,
                  phase !== 'guess' && lastResult && !lastResult.correct && styles.vsBadgeKo,
                  { transform: [{ scale: vsBadgeScale }] },
                ]}
              >
                {phase === 'guess' || !lastResult ? (
                  <Text style={styles.vsText}>O</Text>
                ) : lastResult.correct && showStreakInBadge ? (
                  <Animated.Text
                    style={[
                      styles.vsStreakText,
                      {
                        opacity: streakInOpacity,
                        transform: [{ translateY: streakInY }],
                      },
                    ]}
                  >
                    {streakPopValue}
                  </Animated.Text>
                ) : lastResult.correct ? (
                  <Ionicons name="checkmark" size={28} color="#fff" />
                ) : (
                  <Ionicons name="close" size={28} color="#fff" />
                )}
              </Animated.View>
              <View style={styles.vsLine} />
            </View>

            <PlayerCard
              player={round.cardB}
              metric={round.metric}
              showValue={phase !== 'guess'}
              highlight={bHighlight}
              valueScale={phase !== 'guess' ? valueScale : null}
              countUp={phase !== 'guess'}
            />
          </View>

          {phase === 'guess' ? (
            <GuessButtons
              disabled={busy}
              onHigher={() => onGuess('higher')}
              onLower={() => onGuess('lower')}
            />
          ) : (
            <View style={styles.feedbackRow}>
              {!lastResult?.correct ? (
                <Text style={[styles.feedbackText, styles.koText]}>Sbagliato</Text>
              ) : null}
            </View>
          )}
        </View>
      )}

      <Modal visible={phase === 'gameover'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalAccentRow}>
              <View style={styles.modalAccentGreen} />
              <View style={styles.modalAccentRed} />
            </View>

            <View style={styles.modalLogoWrap}>
              <HigherLowerLogo size={56} />
            </View>

            <Text style={styles.modalTitle}>Serie terminata</Text>

            <View style={styles.modalScoreBox}>
              <Text style={styles.modalScoreLabel}>Punteggio</Text>
              <View style={styles.modalScoreRow}>
                <Text style={styles.modalScore}>{streak}</Text>
                {scoreVsRecord === 'up' ? (
                  <View style={[styles.modalScoreTrend, styles.modalScoreTrendUp]}>
                    <Ionicons name="arrow-up" size={22} color="#16a34a" />
                  </View>
                ) : scoreVsRecord === 'down' ? (
                  <View style={[styles.modalScoreTrend, styles.modalScoreTrendDown]}>
                    <Ionicons name="arrow-down" size={22} color="#dc2626" />
                  </View>
                ) : (
                  <Text style={styles.modalScoreTie}>—</Text>
                )}
              </View>
              <Text style={styles.modalRecord}>Record: {best}</Text>
            </View>

            <TouchableOpacity style={styles.modalReplayBtn} onPress={onReplay} activeOpacity={0.9}>
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.modalReplayBtnText}>Rigioca</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={soloMinigame ? goToHome : goToHub}
            >
              <Text style={styles.secondaryBtnText}>
                {soloMinigame ? 'Torna alle partite' : 'Torna ai minigiochi'}
              </Text>
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
    overflow: 'visible',
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
    overflow: 'visible',
  },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#ececec',
    minHeight: 120,
    overflow: 'visible',
  },
  cardMediaCol: {
    width: 80,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  cardWin: { borderColor: '#86efac', backgroundColor: '#f0fdf4' },
  cardLose: { borderColor: '#fca5a5', backgroundColor: '#fef2f2' },
  cardTextCol: { flex: 1, minWidth: 0, zIndex: 1 },
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
  vsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
    gap: 10,
    zIndex: 3,
  },
  vsLine: { flex: 1, height: 1, backgroundColor: '#e2e8f0' },
  vsBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  vsBadgeOk: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
  },
  vsBadgeKo: {
    backgroundColor: '#dc2626',
    borderColor: '#dc2626',
  },
  vsText: { fontSize: 20, fontWeight: '800', color: '#94a3b8' },
  vsStreakText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  actions: {
    marginTop: 8,
    marginBottom: 4,
    height: 100,
    justifyContent: 'flex-start',
  },
  guessBtn: {
    height: 54,
    width: '64%',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 4,
  },
  higherBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#16a34a',
    zIndex: 2,
  },
  lowerBtn: {
    alignSelf: 'flex-end',
    backgroundColor: '#dc2626',
    marginTop: -10,
    zIndex: 1,
  },
  guessBtnDisabled: {
    opacity: 0.45,
  },
  guessBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  feedbackRow: {
    marginTop: 8,
    marginBottom: 4,
    height: 100,
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
    backgroundColor: '#111827',
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryBtn: { marginTop: 10, alignItems: 'center', paddingVertical: 10 },
  secondaryBtnText: { color: '#64748b', fontWeight: '700', fontSize: 15 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingTop: 0,
    paddingHorizontal: 22,
    paddingBottom: 20,
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  modalAccentRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    height: 5,
    marginBottom: 18,
  },
  modalAccentGreen: { flex: 1, backgroundColor: '#22c55e' },
  modalAccentRed: { flex: 1, backgroundColor: '#ef4444' },
  modalLogoWrap: {
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: -0.3,
  },
  modalSubtitle: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
  },
  modalScoreBox: {
    marginTop: 18,
    marginBottom: 18,
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#eef2ff',
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  modalScoreLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  modalScoreRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalScore: {
    fontSize: 52,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  modalScoreTrend: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScoreTrendUp: {
    backgroundColor: '#dcfce7',
  },
  modalScoreTrendDown: {
    backgroundColor: '#fee2e2',
  },
  modalScoreTie: {
    fontSize: 34,
    fontWeight: '800',
    color: '#94a3b8',
    marginTop: 4,
    lineHeight: 36,
  },
  modalRecord: {
    marginTop: 6,
    color: '#64748b',
    fontWeight: '600',
    fontSize: 14,
  },
  modalReplayBtn: {
    alignSelf: 'stretch',
    height: 50,
    borderRadius: 14,
    backgroundColor: '#16a34a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 4,
  },
  modalReplayBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  skelBlock: { backgroundColor: '#e8edf3', borderRadius: 8 },
  skelCard: { borderColor: '#e8edf3' },
  skelPrompt: { alignSelf: 'center', width: '62%', height: 16, marginBottom: 10, borderRadius: 8 },
  skelAvatar: { width: 72, height: 72, borderRadius: 36 },
  skelName: { width: '78%', height: 16, borderRadius: 8 },
  skelChip: { width: 72, height: 18, marginTop: 8, borderRadius: 8 },
  skelValue: { width: 56, height: 34, marginTop: 10, borderRadius: 8 },
  skelBtn: { width: '64%', height: 54, borderRadius: 16, backgroundColor: '#e2e8f0' },
  skelHint: {
    marginTop: 10,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
});

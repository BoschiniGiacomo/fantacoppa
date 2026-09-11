import { METRICS, getMetricValue } from './metrics';

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function filterPlayablePlayers(players) {
  return (players || []).filter((p) => {
    if (!p || !String(p.name || '').trim()) return false;
    const total =
      (Number(p.goals) || 0)
      + (Number(p.appearances) || 0)
      + (Number(p.trophies) || 0)
      + (Number(p.editions_played) || 0)
      + (Number(p.teams_count) || 0);
    return total > 0;
  });
}

/**
 * Sceglie un avversario con valore diverso sulla metrica (mai a parità).
 * Preferisce chi non è nei recenti; se necessario rilassa il filtro recenti.
 */
export function pickOpponent(pool, cardA, metric, recentEntityIds = []) {
  const aId = Number(cardA?.entity_id);
  const aVal = getMetricValue(cardA, metric);
  const recent = new Set((recentEntityIds || []).map(Number));

  const different = (pool || []).filter((p) => {
    const id = Number(p.entity_id);
    if (!Number.isFinite(id) || id === aId) return false;
    return getMetricValue(p, metric) !== aVal;
  });
  if (!different.length) return null;

  const fresh = different.filter((p) => !recent.has(Number(p.entity_id)));
  const poolToUse = fresh.length ? fresh : different;
  return poolToUse[Math.floor(Math.random() * poolToUse.length)];
}

function tryBuildRound(pool, cardA, recentEntityIds = [], excludeMetricKey = null) {
  if (!cardA) return null;

  const metricAttempts = shuffleInPlace(
    METRICS.filter((m) => !(excludeMetricKey && m.key === excludeMetricKey))
  );
  // Se serve, riprova anche la metrica esclusa come ultima chance
  if (excludeMetricKey) {
    const excluded = METRICS.find((m) => m.key === excludeMetricKey);
    if (excluded) metricAttempts.push(excluded);
  }

  for (const metric of metricAttempts) {
    const cardB = pickOpponent(pool, cardA, metric, recentEntityIds);
    if (!cardB) continue;
    if (getMetricValue(cardA, metric) === getMetricValue(cardB, metric)) continue;
    return { cardA, cardB, metric };
  }
  return null;
}

export function createInitialRound(players) {
  const pool = filterPlayablePlayers(players);
  if (pool.length < 2) return null;

  const shuffled = shuffleInPlace([...pool]);
  for (let i = 0; i < shuffled.length; i += 1) {
    const cardA = shuffled[i];
    const built = tryBuildRound(pool, cardA, [cardA.entity_id]);
    if (!built) continue;
    return {
      ...built,
      recentEntityIds: [built.cardA.entity_id, built.cardB.entity_id],
    };
  }
  return null;
}

/**
 * Higher = B > A; Lower = B < A (parità non ammessa in round validi).
 */
export function evaluateGuess(guess, cardA, cardB, metric) {
  const aVal = getMetricValue(cardA, metric);
  const bVal = getMetricValue(cardB, metric);
  const correct = guess === 'higher' ? bVal > aVal : bVal < aVal;
  return {
    correct,
    aVal,
    bVal,
    guess,
  };
}

export function advanceRound(pool, currentB, recentEntityIds = [], previousMetricKey = null) {
  const players = filterPlayablePlayers(pool);
  if (players.length < 2 || !currentB) return null;

  const nextRecent = [...(recentEntityIds || []), currentB.entity_id].slice(-8);
  const built = tryBuildRound(players, currentB, nextRecent, previousMetricKey);
  if (!built) return null;

  return {
    cardA: built.cardA,
    cardB: built.cardB,
    metric: built.metric,
    recentEntityIds: [...nextRecent, built.cardB.entity_id].slice(-8),
  };
}

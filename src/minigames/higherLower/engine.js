import { METRICS, getMetricValue, pickRandomMetric } from './metrics';

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
 * Preferisce coppie con valori diversi sulla metrica.
 */
export function pickOpponent(pool, cardA, metric, recentEntityIds = []) {
  const aId = Number(cardA?.entity_id);
  const aVal = getMetricValue(cardA, metric);
  const recent = new Set((recentEntityIds || []).map(Number));

  const candidates = (pool || []).filter((p) => {
    const id = Number(p.entity_id);
    if (!Number.isFinite(id) || id === aId) return false;
    if (recent.has(id)) return false;
    return true;
  });

  const different = candidates.filter((p) => getMetricValue(p, metric) !== aVal);
  const poolToUse = different.length >= 3 ? different : (candidates.length ? candidates : []);
  if (!poolToUse.length) {
    // fallback: chiunque tranne A
    const fallback = (pool || []).filter((p) => Number(p.entity_id) !== aId);
    if (!fallback.length) return null;
    return fallback[Math.floor(Math.random() * fallback.length)];
  }
  return poolToUse[Math.floor(Math.random() * poolToUse.length)];
}

export function createInitialRound(players) {
  const pool = filterPlayablePlayers(players);
  if (pool.length < 2) return null;

  const shuffled = shuffleInPlace([...pool]);
  const cardA = shuffled[0];
  const metric = pickRandomMetric(METRICS, cardA);
  const cardB = pickOpponent(pool, cardA, metric, [cardA.entity_id]);
  if (!cardB) return null;

  return {
    cardA,
    cardB,
    metric,
    recentEntityIds: [cardA.entity_id, cardB.entity_id],
  };
}

/**
 * Higher = B > A; Lower = B <= A (minore o uguale).
 */
export function evaluateGuess(guess, cardA, cardB, metric) {
  const aVal = getMetricValue(cardA, metric);
  const bVal = getMetricValue(cardB, metric);
  const correct = guess === 'higher' ? bVal > aVal : bVal <= aVal;
  return {
    correct,
    aVal,
    bVal,
    guess,
  };
}

export function advanceRound(pool, currentB, recentEntityIds = []) {
  const players = filterPlayablePlayers(pool);
  if (players.length < 2 || !currentB) return null;

  const metric = pickRandomMetric(METRICS, currentB);
  const nextRecent = [...(recentEntityIds || []), currentB.entity_id].slice(-8);
  const cardB = pickOpponent(players, currentB, metric, nextRecent);
  if (!cardB) return null;

  return {
    cardA: currentB,
    cardB,
    metric,
    recentEntityIds: [...nextRecent, cardB.entity_id].slice(-8),
  };
}

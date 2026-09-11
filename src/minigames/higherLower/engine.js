import { METRICS, getMetricValue } from './metrics';

/** Quanti entity_id evitare di ripescare (poi si rilassa). */
export const RECENT_WINDOW = 15;
/** Ogni N risposte corrette sale di un tier di difficoltà. */
export const TIER_EVERY = 5;

/**
 * Fasce di delta relativo |a-b| / (max-min metrica).
 * Tier 0 = gap larghi (facile); tier alti = gap stretti (difficile).
 * Parametri regolabili dopo playtest.
 */
export const GAP_BANDS = [
  { min: 0.42, max: 1.0 }, // 0–4
  { min: 0.28, max: 0.58 }, // 5–9
  { min: 0.18, max: 0.40 }, // 10–14
  { min: 0.10, max: 0.26 }, // 15–19
  { min: 0.05, max: 0.16 }, // 20+
];

/** Anni di “vecchiaia” per normalizzare la familiarità (recency → 0). */
const RECENCY_SPAN_YEARS = 8;

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

export function getDifficultyTier(streak) {
  const s = Math.max(0, Number(streak) || 0);
  return Math.min(GAP_BANDS.length - 1, Math.floor(s / TIER_EVERY));
}

export function getGapBand(streak) {
  return GAP_BANDS[getDifficultyTier(streak)];
}

function resolveGroupMaxYear(pool, explicitMax) {
  if (Number.isFinite(Number(explicitMax))) return Number(explicitMax);
  let max = null;
  for (const p of pool || []) {
    const y = Number(p?.last_edition_year);
    if (!Number.isFinite(y)) continue;
    if (max == null || y > max) max = y;
  }
  return max;
}

/** 1 = giocato di recente (più familiare/facile), 0 = anni fa / sconosciuto. */
export function recencyScore(player, groupMaxYear) {
  const y = Number(player?.last_edition_year);
  if (!Number.isFinite(y) || !Number.isFinite(groupMaxYear)) return 0.5;
  const age = Math.max(0, groupMaxYear - y);
  return Math.max(0, Math.min(1, 1 - age / RECENCY_SPAN_YEARS));
}

export function buildMetricRanges(pool) {
  const ranges = Object.create(null);
  for (const metric of METRICS) {
    let min = Infinity;
    let max = -Infinity;
    for (const p of pool || []) {
      const v = getMetricValue(p, metric);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      ranges[metric.key] = { min: 0, max: 0, span: 1 };
    } else {
      ranges[metric.key] = { min, max, span: Math.max(1, max - min) };
    }
  }
  return ranges;
}

function relativeGapFromValues(aVal, bVal, span) {
  return Math.abs(aVal - bVal) / Math.max(1, span);
}

function gapFitScore(relGap, band) {
  if (relGap >= band.min && relGap <= band.max) {
    const mid = (band.min + band.max) / 2;
    const half = Math.max(0.01, (band.max - band.min) / 2);
    return 1 - (Math.abs(relGap - mid) / half) * 0.2;
  }
  if (relGap < band.min) {
    return Math.max(0, 0.4 - (band.min - relGap) * 2.2);
  }
  return Math.max(0, 0.4 - (relGap - band.max) * 1.6);
}

function expandBand(band, step) {
  if (step <= 0) return band;
  const loosen = 0.08 * step;
  return {
    min: Math.max(0.02, band.min - loosen),
    max: Math.min(1, band.max + loosen * 1.4),
  };
}

function weightedPick(scored) {
  if (!scored.length) return null;
  const top = scored.slice(0, Math.min(12, scored.length));
  let total = 0;
  const weights = top.map((row) => {
    const w = Math.max(0.05, row.score) ** 2;
    total += w;
    return w;
  });
  let r = Math.random() * total;
  for (let i = 0; i < top.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return top[i];
  }
  return top[0];
}

/**
 * Score combinato: gap (fascia di difficoltà) + familiarità (recency).
 * Early game → preferisce giocatori recenti; late → più oscuri.
 */
function scorePair({
  relGap,
  band,
  recencyA,
  recencyB,
  tier,
  jitter,
}) {
  const gapScore = gapFitScore(relGap, band);
  const familiarity = (recencyA + recencyB) / 2;
  const difficulty01 = tier / Math.max(1, GAP_BANDS.length - 1);
  const recencyFit = difficulty01 < 0.45
    ? familiarity
    : (1 - familiarity);
  return gapScore * 0.7 + recencyFit * 0.24 + jitter * 0.06;
}

/** Quanti candidati bastano per uscire presto (varietà + velocità). */
const EARLY_EXIT_COUNT = 14;
/** Seed massimi per il round iniziale. */
const INITIAL_SEED_TRIES = 6;

/**
 * Sceglie metrica + avversario in base allo streak.
 * - Mai valori pari
 * - Evita ultima metrica (rilassa solo se necessario)
 * - Evita ultimi RECENT_WINDOW entity (rilassa se necessario)
 * - Delta relativo nella fascia del tier, con allargamento progressivo
 */
export function pickOpponent(pool, cardA, recentEntityIds = [], options = {}) {
  const {
    streak = 0,
    excludeMetricKey = null,
    groupMaxYear = null,
    ranges: rangesOpt = null,
    earlyExitCount = EARLY_EXIT_COUNT,
  } = options;

  const aId = Number(cardA?.entity_id);
  if (!Number.isFinite(aId)) return null;

  const players = [];
  for (let i = 0; i < (pool || []).length; i += 1) {
    const p = pool[i];
    const id = Number(p?.entity_id);
    if (Number.isFinite(id) && id !== aId) players.push(p);
  }
  if (!players.length) return null;

  // Ordine random → early-exit non biasa sempre gli stessi id.
  shuffleInPlace(players);

  const ranges = rangesOpt || buildMetricRanges(pool);
  const tier = getDifficultyTier(streak);
  const baseBand = GAP_BANDS[tier];
  const maxYear = resolveGroupMaxYear(pool, groupMaxYear);
  const recencyA = recencyScore(cardA, maxYear);
  const recent = new Set((recentEntityIds || []).map(Number));

  const metricsPreferred = shuffleInPlace(
    METRICS.filter((m) => !(excludeMetricKey && m.key === excludeMetricKey)),
  );
  const metricsFallback = excludeMetricKey
    ? [...metricsPreferred, ...METRICS.filter((m) => m.key === excludeMetricKey)]
    : metricsPreferred;

  const aVals = Object.create(null);
  const spans = Object.create(null);
  for (const metric of METRICS) {
    aVals[metric.key] = getMetricValue(cardA, metric);
    spans[metric.key] = ranges[metric.key]?.span || 1;
  }

  const stages = [
    { allowRecent: false, bandStep: 0, allowExcludedMetric: false },
    { allowRecent: false, bandStep: 1, allowExcludedMetric: false },
    { allowRecent: true, bandStep: 1, allowExcludedMetric: false },
    { allowRecent: true, bandStep: 2, allowExcludedMetric: false },
    { allowRecent: true, bandStep: 3, allowExcludedMetric: true },
    { allowRecent: true, bandStep: 99, allowExcludedMetric: true },
  ];

  for (const stage of stages) {
    const band = stage.bandStep >= 99
      ? { min: 0.001, max: 1 }
      : expandBand(baseBand, stage.bandStep);
    const metrics = stage.allowExcludedMetric ? metricsFallback : metricsPreferred;
    if (!metrics.length) continue;

    const scored = [];
    metricLoop: for (const metric of metrics) {
      const aVal = aVals[metric.key];
      const span = spans[metric.key];
      for (let i = 0; i < players.length; i += 1) {
        const candidate = players[i];
        const id = Number(candidate.entity_id);
        if (!stage.allowRecent && recent.has(id)) continue;
        const bVal = getMetricValue(candidate, metric);
        if (bVal === aVal) continue;
        const relGap = relativeGapFromValues(aVal, bVal, span);
        if (stage.bandStep < 99 && (relGap < band.min || relGap > band.max)) continue;

        scored.push({
          cardB: candidate,
          metric,
          score: scorePair({
            relGap,
            band,
            recencyA,
            recencyB: recencyScore(candidate, maxYear),
            tier,
            jitter: Math.random(),
          }),
        });

        if (scored.length >= earlyExitCount) break metricLoop;
      }
    }

    if (!scored.length) continue;
    scored.sort((x, y) => y.score - x.score);
    const pick = weightedPick(scored);
    if (pick) return { cardB: pick.cardB, metric: pick.metric };
  }

  return null;
}

function tryBuildRound(pool, cardA, recentEntityIds = [], options = {}) {
  if (!cardA) return null;
  const picked = pickOpponent(pool, cardA, recentEntityIds, options);
  if (!picked) return null;
  return { cardA, cardB: picked.cardB, metric: picked.metric };
}

/**
 * Round iniziale veloce: pochi seed “recenti” + early-exit su candidati.
 * Evita di scansionare tutto il pool × tutte le metriche × tutti gli stage.
 */
export function createInitialRound(players, options = {}) {
  const pool = filterPlayablePlayers(players);
  if (pool.length < 2) return null;

  const ranges = buildMetricRanges(pool);
  const groupMaxYear = resolveGroupMaxYear(pool, options.groupMaxYear);

  // Campione misto: metà pool shuffled basta per scegliere seed familiari.
  const sampleSize = Math.min(pool.length, 36);
  const sample = shuffleInPlace([...pool]).slice(0, sampleSize);
  sample.sort((a, b) => {
    const dr = recencyScore(b, groupMaxYear) - recencyScore(a, groupMaxYear);
    return dr !== 0 ? dr : Math.random() - 0.5;
  });

  const seedCount = Math.min(INITIAL_SEED_TRIES, sample.length);
  const sharedOpts = {
    streak: 0,
    excludeMetricKey: null,
    groupMaxYear,
    ranges,
    earlyExitCount: 10,
  };

  for (let i = 0; i < seedCount; i += 1) {
    const cardA = sample[i];
    const built = tryBuildRound(pool, cardA, [cardA.entity_id], sharedOpts);
    if (!built) continue;
    return {
      ...built,
      recentEntityIds: [built.cardA.entity_id, built.cardB.entity_id],
    };
  }

  // Fallback raro: prova ancora qualche seed random dal pool intero.
  const fallback = shuffleInPlace([...pool]).slice(0, 4);
  for (const cardA of fallback) {
    const built = tryBuildRound(pool, cardA, [cardA.entity_id], {
      ...sharedOpts,
      earlyExitCount: EARLY_EXIT_COUNT,
    });
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

export function advanceRound(pool, currentB, recentEntityIds = [], previousMetricKey = null, streak = 0, options = {}) {
  const players = filterPlayablePlayers(pool);
  if (players.length < 2 || !currentB) return null;

  const ranges = buildMetricRanges(players);
  const groupMaxYear = resolveGroupMaxYear(players, options.groupMaxYear);
  const nextRecent = [...(recentEntityIds || []), currentB.entity_id].slice(-RECENT_WINDOW);
  const built = tryBuildRound(players, currentB, nextRecent, {
    streak,
    excludeMetricKey: previousMetricKey,
    groupMaxYear,
    ranges,
  });
  if (!built) return null;

  return {
    cardA: built.cardA,
    cardB: built.cardB,
    metric: built.metric,
    recentEntityIds: [...nextRecent, built.cardB.entity_id].slice(-RECENT_WINDOW),
  };
}

export function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Competition ranking (1,2,2,4) based on descending score.
 * Keeps source order for tied scores.
 */
export function buildCompetitionRankMap(rows, { getId, getScore }) {
  const rankMap = new Map();
  if (!Array.isArray(rows) || rows.length <= 0) return rankMap;

  let lastScore = null;
  let currentRank = 0;

  rows.forEach((row, idx) => {
    const score = toFiniteNumber(getScore(row));
    if (idx === 0 || score !== lastScore) {
      currentRank = idx + 1;
      lastScore = score;
    }
    const id = getId(row);
    if (id != null) {
      rankMap.set(String(id), currentRank);
    }
  });

  return rankMap;
}

/** Ranks paralleli all'array (es. 1,2,2,4) per classifiche già ordinate per punteggio desc. */
export function buildCompetitionRanks(rows, { getScore = (row) => row?.value } = {}) {
  if (!Array.isArray(rows) || rows.length <= 0) return [];

  const ranks = [];
  let lastScore = null;
  let currentRank = 0;

  rows.forEach((row, idx) => {
    const score = toFiniteNumber(getScore(row));
    if (idx === 0 || score !== lastScore) {
      currentRank = idx + 1;
      lastScore = score;
    }
    ranks.push(currentRank);
  });

  return ranks;
}

export function formatCompetitionRank(rank) {
  const n = Number(rank);
  if (!Number.isFinite(n) || n <= 0) return '–';
  return `${n}°`;
}

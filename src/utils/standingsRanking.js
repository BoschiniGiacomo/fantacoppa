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

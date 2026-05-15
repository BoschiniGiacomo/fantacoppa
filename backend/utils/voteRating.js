/**
 * Voti reali a step 0.25 (come in Inserisci voti).
 * Normalizza lettura/scrittura per evitare 7.3 al posto di 7.25 (float / arrotondamenti legacy).
 */
function normalizeVoteRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 4) / 4;
}

function formatVoteRating(value, { empty = '-' } = {}) {
  const n = normalizeVoteRating(value);
  if (n <= 0) return empty;
  return n.toFixed(2);
}

module.exports = { normalizeVoteRating, formatVoteRating };

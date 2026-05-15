/** Voti reali a step 0.25 — allineato a Inserisci voti e backend. */
export function normalizeVoteRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 4) / 4;
}

export function formatVoteRating(value, { empty = '-' } = {}) {
  const n = normalizeVoteRating(value);
  if (n <= 0) return empty;
  return n.toFixed(2);
}

/** Voti reali a step 0.25 — allineato a Inserisci voti e backend. */
export const SV_VOTE_RATING = -0.25;

export function isSvVoteRating(value) {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n - SV_VOTE_RATING) < 0.001;
}

export function isNdVoteRating(value) {
  const n = Number(value);
  return Number.isFinite(n) && !isSvVoteRating(n) && n <= 0;
}

export function isPresenceVoteRating(value) {
  if (isSvVoteRating(value)) return true;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

export function isScoredVoteRating(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

export function normalizeVoteRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (isSvVoteRating(n)) return SV_VOTE_RATING;
  if (n <= 0) return 0;
  return Math.round(n * 4) / 4;
}

export function formatVoteRating(value, { empty = '-' } = {}) {
  if (isSvVoteRating(value)) return 'S.V.';
  const n = normalizeVoteRating(value);
  if (n <= 0) return empty;
  return n.toFixed(2);
}

/** Leghe con reference_year <= 2005: voti più liberi (bonus con S.V., MVP non obbligatorio). */
export function isLegacyFlexibleVotesYear(year) {
  const y = Number(year);
  return Number.isFinite(y) && y > 0 && y <= 2005;
}

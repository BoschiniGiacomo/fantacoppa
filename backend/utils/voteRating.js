/**
 * Voti reali a step 0.25 (come in Inserisci voti).
 * -0.25 = S.V. (senza voto, conta come presenza nelle leghe ufficiali).
 * 0 = N.D. (non disponibile).
 */
const SV_VOTE_RATING = -0.25;

function isSvVoteRating(value) {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n - SV_VOTE_RATING) < 0.001;
}

function isNdVoteRating(value) {
  const n = Number(value);
  return Number.isFinite(n) && !isSvVoteRating(n) && n <= 0;
}

function isPresenceVoteRating(value) {
  if (isSvVoteRating(value)) return true;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function isScoredVoteRating(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function normalizeVoteRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (isSvVoteRating(n)) return SV_VOTE_RATING;
  if (n <= 0) return 0;
  return Math.round(n * 4) / 4;
}

function formatVoteRating(value, { empty = '-' } = {}) {
  if (isSvVoteRating(value)) return 'S.V.';
  const n = normalizeVoteRating(value);
  if (n <= 0) return empty;
  return n.toFixed(2);
}

/** Leghe con reference_year <= 2005: voti più liberi (bonus con S.V., MVP non obbligatorio). */
function isLegacyFlexibleVotesYear(year) {
  const y = Number(year);
  return Number.isFinite(y) && y > 0 && y <= 2005;
}

/** SQL: voto che conta come presenza (voto reale o S.V.). */
const SQL_WHERE_PRESENCE_VOTE = '(pr.rating > 0 OR ABS(pr.rating + 0.25) < 0.001)';

/** SQL: voto numerico per medie (esclude S.V. e N.D.). */
const SQL_WHERE_SCORED_VOTE = 'pr.rating > 0';

module.exports = {
  SV_VOTE_RATING,
  isSvVoteRating,
  isNdVoteRating,
  isPresenceVoteRating,
  isScoredVoteRating,
  normalizeVoteRating,
  formatVoteRating,
  isLegacyFlexibleVotesYear,
  SQL_WHERE_PRESENCE_VOTE,
  SQL_WHERE_SCORED_VOTE,
};

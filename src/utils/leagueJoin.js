/** True se la lega richiede un codice (senza esporre il codice reale). */
export function leagueHasAccessCode(league) {
  if (!league) return false;
  if (Number(league.has_access_code) === 1 || league.has_access_code === true) return true;
  return String(league.access_code || '').trim().length > 0;
}

/** True se l'ingresso richiede approvazione admin. */
export function leagueRequiresApproval(league) {
  if (!league) return false;
  return Number(league.require_approval) === 1 || league.require_approval === true;
}

/** True se la risposta join è una richiesta in attesa (non iscrizione immediata). */
export function isJoinPendingResponse(response) {
  const data = response?.data || {};
  return (
    Number(response?.status) === 202
    || data.pending === true
    || data.requires_approval === true
  );
}

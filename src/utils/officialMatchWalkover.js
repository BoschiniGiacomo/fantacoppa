/** Etichetta UI per vittoria a tavolino (3 goal al min. 0 senza marcatore). */
export const OFFICIAL_WALKOVER_END_LABEL = 'A tavolino';

export const OFFICIAL_MATCH_END_LABEL = 'Fine partita';

function isRegularGoalEventType(eventType) {
  const t = String(eventType || '').trim();
  return t === 'goal' || t === 'penalty_goal';
}

function parseEventPayload(ev) {
  let payload = ev?.payload ?? ev?.payload_json;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }
  return payload && typeof payload === 'object' ? payload : {};
}

/** Goal con marcatore (colonna o payload): i goal a tavolino non lo hanno. */
export function goalEventHasScorer(ev) {
  const pid = Number(ev?.player_id);
  if (Number.isFinite(pid) && pid > 0) return true;
  const payload = parseEventPayload(ev);
  const payloadPid = Number(payload?.player_id);
  if (Number.isFinite(payloadPid) && payloadPid > 0) return true;
  return String(payload?.player_name ?? '').trim().length > 0;
}

function isWalkoverMinute(minute) {
  const m = Number(minute);
  return Number.isFinite(m) && m === 0;
}

/** Partita chiusa con 3 goal/penalty_goal al minuto 0 senza marcatore associato. */
export function isOfficialWalkoverMatch(match, events) {
  if (match?.is_walkover === true || match?.is_walkover === 1 || match?.is_walkover === '1') {
    return true;
  }
  const list = Array.isArray(events) ? events : [];
  if (!list.some((e) => String(e?.event_type) === 'match_end')) return false;
  const goals = list.filter((e) => e && isRegularGoalEventType(e.event_type));
  if (goals.length !== 3) return false;
  if (!goals.every((e) => isWalkoverMinute(e.minute))) return false;
  return goals.every((e) => !goalEventHasScorer(e));
}

export function isOfficialMatchEnded(match) {
  return String(match?.last_phase_type || '').trim() === 'match_end';
}

/** Etichetta fine partita in hero / lista / timeline (non i pulsanti admin). */
export function getOfficialMatchEndDisplayLabel(match, events, defaultLabel = OFFICIAL_MATCH_END_LABEL) {
  if (defaultLabel === OFFICIAL_MATCH_END_LABEL && isOfficialWalkoverMatch(match, events)) {
    return OFFICIAL_WALKOVER_END_LABEL;
  }
  return defaultLabel;
}

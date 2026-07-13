const { query } = require('../config/database');

function isRegularGoalEventType(eventType) {
  const t = String(eventType || '').trim();
  return t === 'goal' || t === 'penalty_goal';
}

function parseEventPayloadJson(ev) {
  let payload = ev?.payload_json ?? ev?.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }
  return payload && typeof payload === 'object' ? payload : {};
}

function goalEventHasScorer(ev) {
  const pid = Number(ev?.player_id);
  if (Number.isFinite(pid) && pid > 0) return true;
  const payload = parseEventPayloadJson(ev);
  const payloadPid = Number(payload?.player_id);
  if (Number.isFinite(payloadPid) && payloadPid > 0) return true;
  return String(payload?.player_name ?? '').trim().length > 0;
}

function isWalkoverMinute(minute) {
  const m = Number(minute);
  return Number.isFinite(m) && m === 0;
}

/** 3 goal/penalty_goal al minuto 0 senza marcatore, partita chiusa con match_end. */
function computeIsWalkoverFromEvents(events) {
  const list = Array.isArray(events) ? events : [];
  if (!list.some((e) => String(e?.event_type) === 'match_end')) return false;
  const goals = list.filter((e) => e && isRegularGoalEventType(e.event_type));
  if (goals.length !== 3) return false;
  if (!goals.every((e) => isWalkoverMinute(e.minute))) return false;
  return goals.every((e) => !goalEventHasScorer(e));
}

async function isOfficialMatchWalkover(matchId) {
  const mid = Number(matchId);
  if (!Number.isFinite(mid) || mid <= 0) return false;

  const rows = await query(
    `SELECT event_type, minute, player_id, payload_json
     FROM official_match_events
     WHERE match_id = ?
     ORDER BY minute ASC NULLS LAST, id ASC`,
    [mid]
  );

  return computeIsWalkoverFromEvents(rows || []);
}

module.exports = {
  computeIsWalkoverFromEvents,
  isOfficialMatchWalkover,
  goalEventHasScorer,
};

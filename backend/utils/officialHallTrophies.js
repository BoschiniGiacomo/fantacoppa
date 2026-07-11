const { query } = require('../config/database');

const HALL_CAMPIONATO_FINAL_STAGE_ID = 3;
const HALL_WINE_TROPHY_STAGE_ID = 6;

function isRegularGoalEventType(eventType) {
  const t = String(eventType || '').trim();
  return t === 'goal' || t === 'penalty_goal';
}

function determineKnockoutMatchWinner(match) {
  if (!match) return null;
  const hs = match.home_score != null ? Number(match.home_score) : null;
  const as = match.away_score != null ? Number(match.away_score) : null;
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  const hps = match.home_shootout_score != null ? Number(match.home_shootout_score) : null;
  const aps = match.away_shootout_score != null ? Number(match.away_shootout_score) : null;
  const outcomeHome = hs === as && Number.isFinite(hps) && Number.isFinite(aps) ? hps : hs;
  const outcomeAway = hs === as && Number.isFinite(hps) && Number.isFinite(aps) ? aps : as;
  if (outcomeHome > outcomeAway) {
    return {
      team_id: match.home_team_id != null ? Number(match.home_team_id) : null,
    };
  }
  if (outcomeAway > outcomeHome) {
    return {
      team_id: match.away_team_id != null ? Number(match.away_team_id) : null,
    };
  }
  return null;
}

function buildHallMatchFromRow(row, evRows) {
  if (!row) return null;
  let hs = row.home_score != null ? Number(row.home_score) : null;
  let as = row.away_score != null ? Number(row.away_score) : null;
  let hps = null;
  let aps = null;
  const homeId = Number(row.home_team_id);
  const awayId = Number(row.away_team_id);

  let homeGoals = 0;
  let awayGoals = 0;
  let homeShootout = 0;
  let awayShootout = 0;
  let hasGoalEvents = false;
  let hasShootout = false;

  for (const e of evRows || []) {
    const evTeamId = Number(e.team_id);
    const byTeamId = Number.isFinite(evTeamId) && evTeamId > 0;
    if (e.event_type === 'shootout_goal') {
      hasShootout = true;
      if (byTeamId) {
        if (evTeamId === homeId) homeShootout += 1;
        if (evTeamId === awayId) awayShootout += 1;
      } else {
        if (e.team_side === 'home') homeShootout += 1;
        if (e.team_side === 'away') awayShootout += 1;
      }
    } else if (isRegularGoalEventType(e.event_type)) {
      hasGoalEvents = true;
      if (byTeamId) {
        if (evTeamId === homeId) homeGoals += 1;
        if (evTeamId === awayId) awayGoals += 1;
      } else {
        if (e.team_side === 'home') homeGoals += 1;
        if (e.team_side === 'away') awayGoals += 1;
      }
    } else if (e.event_type === 'own_goal') {
      hasGoalEvents = true;
      if (byTeamId) {
        if (evTeamId === homeId) awayGoals += 1;
        if (evTeamId === awayId) homeGoals += 1;
      } else {
        if (e.team_side === 'home') awayGoals += 1;
        if (e.team_side === 'away') homeGoals += 1;
      }
    }
  }

  if (hasGoalEvents) {
    hs = homeGoals;
    as = awayGoals;
  }
  if (hasShootout) {
    hps = homeShootout;
    aps = awayShootout;
  }

  return {
    id: Number(row.id),
    home_team_id: homeId,
    away_team_id: awayId,
    home_score: Number.isFinite(hs) ? hs : null,
    away_score: Number.isFinite(as) ? as : null,
    home_shootout_score: Number.isFinite(hps) && Number.isFinite(aps) ? hps : null,
    away_shootout_score: Number.isFinite(hps) && Number.isFinite(aps) ? aps : null,
  };
}

async function fetchMatchEndedIds(matchIds) {
  const ids = (Array.isArray(matchIds) ? matchIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return new Set();
  const ph = ids.map(() => '?').join(', ');
  const rows = await query(
    `SELECT DISTINCT match_id FROM official_match_events WHERE match_id IN (${ph}) AND event_type = 'match_end'`,
    ids
  );
  return new Set((rows || []).map((r) => Number(r.match_id)).filter((id) => id > 0));
}

async function listOfficialGroupSeasonLeagues(competitionId) {
  return await query(
    `SELECT l.id AS league_id, NULLIF(to_jsonb(l)->>'reference_year','')::int AS reference_year
     FROM leagues l
     WHERE l.official_group_id = ?
       AND COALESCE(l.is_official, 0) = 1
     ORDER BY NULLIF(to_jsonb(l)->>'reference_year','')::int DESC NULLS LAST, l.id DESC`,
    [competitionId]
  );
}

async function fetchHallFinalMatchesByLeagueStage(competitionId, leagueIds) {
  const compId = Number(competitionId);
  const lids = [...new Set((leagueIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  const out = new Map();
  if (!compId || !lids.length) return out;

  const ph = lids.map(() => '?').join(', ');
  const rows = await query(
    `
    SELECT
      m.id,
      COALESCE(m.league_id, ht.league_id) AS canon_league_id,
      NULLIF(to_jsonb(m)->>'match_stage_id','')::int AS stage_id,
      m.home_team_id,
      m.away_team_id,
      m.home_score,
      m.away_score,
      m.kickoff_at
    FROM official_matches m
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.competition_id = ?
      AND NULLIF(to_jsonb(m)->>'match_stage_id','')::int IN (?, ?)
      AND (
        m.league_id IN (${ph})
        OR (
          m.league_id IS NULL
          AND ht.league_id IN (${ph})
          AND at.league_id IN (${ph})
        )
      )
    ORDER BY canon_league_id ASC, stage_id ASC, m.kickoff_at DESC NULLS LAST, m.id DESC
    `,
    [compId, HALL_CAMPIONATO_FINAL_STAGE_ID, HALL_WINE_TROPHY_STAGE_ID, ...lids, ...lids, ...lids]
  );

  const picks = new Map();
  for (const row of rows || []) {
    const lid = Number(row.canon_league_id);
    const sid = Number(row.stage_id);
    if (!lids.includes(lid) || (sid !== HALL_CAMPIONATO_FINAL_STAGE_ID && sid !== HALL_WINE_TROPHY_STAGE_ID)) continue;
    const key = `${lid}:${sid}`;
    if (!picks.has(key)) picks.set(key, row);
  }

  const matchIds = [...picks.values()].map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0);
  if (!matchIds.length) return out;

  const endedIds = await fetchMatchEndedIds(matchIds);
  const evByMatch = new Map();
  const phMatches = matchIds.map(() => '?').join(', ');
  const evRows = await query(
    `SELECT match_id, event_type, team_side, team_id
     FROM official_match_events
     WHERE match_id IN (${phMatches})
     ORDER BY id ASC`,
    matchIds
  );
  for (const e of evRows || []) {
    const mid = Number(e.match_id);
    if (!evByMatch.has(mid)) evByMatch.set(mid, []);
    evByMatch.get(mid).push(e);
  }

  for (const [key, row] of picks) {
    const mid = Number(row.id);
    if (!endedIds.has(mid)) continue;
    const built = buildHallMatchFromRow(row, evByMatch.get(mid) || []);
    if (built) out.set(key, built);
  }
  return out;
}

function buildPlayerTeamByLeagueId(editionRows) {
  const map = new Map();
  for (const row of editionRows || []) {
    const leagueId = Number(row.league_id);
    const teamId = Number(row.team_id);
    if (!Number.isFinite(leagueId) || leagueId <= 0) continue;
    if (!Number.isFinite(teamId) || teamId <= 0) continue;
    map.set(leagueId, teamId);
  }
  return map;
}

/**
 * Conta i trofei vinti dal giocatore: per ogni stagione visibile del cluster,
 * verifica se la squadra di appartenenza coincide con la vincitrice della finale.
 */
async function computePlayerOfficialTrophies(competitionId, editionRows) {
  const groupId = Number(competitionId);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return { championships: 0, wine_trophies: 0 };
  }

  const playerTeamByLeague = buildPlayerTeamByLeagueId(editionRows);
  if (!playerTeamByLeague.size) {
    return { championships: 0, wine_trophies: 0 };
  }

  const leagues = await listOfficialGroupSeasonLeagues(groupId);
  const leagueIds = (leagues || [])
    .map((row) => Number(row.league_id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!leagueIds.length) {
    return { championships: 0, wine_trophies: 0 };
  }

  const finals = await fetchHallFinalMatchesByLeagueStage(groupId, leagueIds);
  let championships = 0;
  let wineTrophies = 0;

  for (const row of leagues || []) {
    const leagueId = Number(row.league_id);
    if (!Number.isFinite(leagueId) || leagueId <= 0) continue;

    const playerTeamId = playerTeamByLeague.get(leagueId);
    if (!playerTeamId) continue;

    const champMatch = finals.get(`${leagueId}:${HALL_CAMPIONATO_FINAL_STAGE_ID}`) || null;
    const champWinner = determineKnockoutMatchWinner(champMatch);
    if (champWinner?.team_id && Number(champWinner.team_id) === Number(playerTeamId)) {
      championships += 1;
    }

    const wineMatch = finals.get(`${leagueId}:${HALL_WINE_TROPHY_STAGE_ID}`) || null;
    const wineWinner = determineKnockoutMatchWinner(wineMatch);
    if (wineWinner?.team_id && Number(wineWinner.team_id) === Number(playerTeamId)) {
      wineTrophies += 1;
    }
  }

  return { championships, wine_trophies: wineTrophies };
}

module.exports = {
  HALL_CAMPIONATO_FINAL_STAGE_ID,
  HALL_WINE_TROPHY_STAGE_ID,
  computePlayerOfficialTrophies,
  determineKnockoutMatchWinner,
  fetchHallFinalMatchesByLeagueStage,
  listOfficialGroupSeasonLeagues,
};

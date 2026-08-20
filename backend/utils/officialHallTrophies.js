const { query } = require('../config/database');
const {
  determineKnockoutMatchWinner,
  buildHallMatchFromRow,
} = require('./officialMatchOutcome');
const { SQL_WHERE_PRESENCE_VOTE } = require('./voteRating');

const HALL_CAMPIONATO_FINAL_STAGE_ID = 3;
const HALL_WINE_TROPHY_STAGE_ID = 6;

function compareByGoalDiffThenScored(a, b) {
  if ((b.gd || 0) !== (a.gd || 0)) return (b.gd || 0) - (a.gd || 0);
  return (b.gf || 0) - (a.gf || 0);
}

function computeTriangularWinner(matches) {
  const list = Array.isArray(matches) ? matches : [];
  if (list.length !== 3) return null;

  const table = new Map();
  const ensureTeam = (teamId, teamName, logoPath) => {
    const tid = Number(teamId);
    if (!(tid > 0)) return null;
    if (!table.has(tid)) {
      table.set(tid, {
        team_id: tid,
        team_name: teamName != null ? String(teamName) : null,
        logo_path: logoPath || null,
        pts: 0,
        gf: 0,
        ga: 0,
        gd: 0,
      });
    }
    const row = table.get(tid);
    if (!row.team_name && teamName) row.team_name = String(teamName);
    if (!row.logo_path && logoPath) row.logo_path = logoPath;
    return row;
  };

  for (const m of list) {
    const hs = Number(m?.home_score);
    const as = Number(m?.away_score);
    const home = ensureTeam(m?.home_team_id, m?.home_team_name, m?.home_team_logo_path);
    const away = ensureTeam(m?.away_team_id, m?.away_team_name, m?.away_team_logo_path);
    if (!home || !away) continue;
    if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;

    home.gf += hs;
    home.ga += as;
    away.gf += as;
    away.ga += hs;

    if (hs > as) home.pts += 3;
    else if (as > hs) away.pts += 3;
    else {
      home.pts += 1;
      away.pts += 1;
    }
  }

  const rows = [...table.values()].map((r) => ({ ...r, gd: Number(r.gf || 0) - Number(r.ga || 0) }));
  if (rows.length < 2) return null;
  rows.sort((a, b) => (b.pts - a.pts) || compareByGoalDiffThenScored(a, b));
  const topPts = Number(rows[0]?.pts || 0);
  const tied = rows.filter((r) => Number(r.pts) === topPts);
  if (tied.length === 1) return tied[0];

  // Scontro diretto tra 2 squadre a pari punti
  if (tied.length === 2) {
    const [a, b] = tied;
    const direct = list.find((m) => {
      const h = Number(m?.home_team_id);
      const aw = Number(m?.away_team_id);
      return (h === a.team_id && aw === b.team_id) || (h === b.team_id && aw === a.team_id);
    });
    if (direct) {
      const hs = Number(direct.home_score);
      const as = Number(direct.away_score);
      if (Number.isFinite(hs) && Number.isFinite(as) && hs !== as) {
        const winnerId = hs > as ? Number(direct.home_team_id) : Number(direct.away_team_id);
        const winner = tied.find((r) => Number(r.team_id) === winnerId);
        if (winner) return winner;
      }
    }
  }

  tied.sort(compareByGoalDiffThenScored);
  return tied[0] || null;
}

function resolveWineWinnerFromMatches(matches) {
  const list = Array.isArray(matches) ? matches : [];
  if (!list.length) return null;
  if (list.length === 1) return determineKnockoutMatchWinner(list[0]);
  const triWinner = computeTriangularWinner(list);
  if (!triWinner?.team_id) return null;
  return {
    team_id: Number(triWinner.team_id),
    team_name: triWinner.team_name || null,
    logo_path: triWinner.logo_path || null,
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
       AND COALESCE(l.is_official_squad_public, 0) = 1
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

  const grouped = new Map();
  for (const row of rows || []) {
    const lid = Number(row.canon_league_id);
    const sid = Number(row.stage_id);
    if (!lids.includes(lid) || (sid !== HALL_CAMPIONATO_FINAL_STAGE_ID && sid !== HALL_WINE_TROPHY_STAGE_ID)) continue;
    const key = `${lid}:${sid}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const matchIds = [...grouped.values()]
    .flat()
    .map((r) => Number(r.id))
    .filter((id) => Number.isFinite(id) && id > 0);
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

  for (const [key, stageRows] of grouped) {
    const builtList = [];
    for (const row of stageRows || []) {
      const mid = Number(row.id);
      if (!endedIds.has(mid)) continue;
      const built = buildHallMatchFromRow(row, evByMatch.get(mid) || []);
      if (built) builtList.push(built);
    }
    if (builtList.length) out.set(key, builtList);
  }
  return out;
}

function buildPlayerEditionByLeagueId(editionRows) {
  const map = new Map();
  for (const row of editionRows || []) {
    const leagueId = Number(row.league_id);
    const teamId = Number(row.team_id);
    const playerId = Number(row.player_id);
    if (!Number.isFinite(leagueId) || leagueId <= 0) continue;
    if (!Number.isFinite(teamId) || teamId <= 0) continue;
    if (!Number.isFinite(playerId) || playerId <= 0) continue;
    map.set(leagueId, { teamId, playerId });
  }
  return map;
}

/** Espande ogni league_id al set di id dove possono stare i voti (parent + figli linked). */
async function expandLeagueIdsForRatings(leagueIds) {
  const lids = [...new Set((leagueIds || []).map(Number).filter((id) => id > 0))];
  const byInput = new Map();
  if (!lids.length) return { allIds: [], byInput };

  const ph = lids.map(() => '?').join(', ');
  const metaRows = await query(
    `SELECT id, COALESCE(NULLIF(linked_to_league_id, 0), id) AS eff
     FROM leagues
     WHERE id IN (${ph})`,
    lids,
  );

  const effByInput = new Map();
  const effSet = new Set();
  for (const row of metaRows || []) {
    const id = Number(row.id);
    const eff = Number(row.eff);
    if (!(id > 0) || !(eff > 0)) continue;
    effByInput.set(id, eff);
    effSet.add(eff);
  }

  const byEff = new Map();
  for (const eff of effSet) byEff.set(eff, new Set([eff]));

  if (effSet.size) {
    const effPh = [...effSet].map(() => '?').join(', ');
    const childRows = await query(
      `SELECT id, linked_to_league_id
       FROM leagues
       WHERE linked_to_league_id IN (${effPh})`,
      [...effSet],
    );
    for (const row of childRows || []) {
      const eff = Number(row.linked_to_league_id);
      const id = Number(row.id);
      if (!byEff.has(eff) || !(id > 0)) continue;
      byEff.get(eff).add(id);
    }
  }

  for (const lid of lids) {
    const eff = effByInput.get(lid) || lid;
    byInput.set(lid, [...(byEff.get(eff) || new Set([lid]))]);
  }

  const allIds = [...new Set([...byInput.values()].flat())];
  return { allIds, byInput };
}

/**
 * Ritorna Set di editionLeagueId in cui il player dell'edizione ha almeno
 * una presenza (voto numerico o S.V.) nella lega (o leghe collegate voti).
 */
async function fetchEditionLeaguesWithPresence(editionByLeague) {
  const withPresence = new Set();
  const entries = [...(editionByLeague || new Map()).entries()];
  if (!entries.length) return withPresence;

  const editionLeagueIds = entries.map(([leagueId]) => leagueId);
  const { allIds: ratingLeagueIds, byInput } = await expandLeagueIdsForRatings(editionLeagueIds);
  const playerIds = [...new Set(entries.map(([, e]) => Number(e.playerId)).filter((id) => id > 0))];
  if (!ratingLeagueIds.length || !playerIds.length) return withPresence;

  const pPh = playerIds.map(() => '?').join(', ');
  const lPh = ratingLeagueIds.map(() => '?').join(', ');
  const rows = await query(
    `SELECT DISTINCT pr.player_id, pr.league_id
     FROM player_ratings pr
     WHERE pr.player_id IN (${pPh})
       AND pr.league_id IN (${lPh})
       AND ${SQL_WHERE_PRESENCE_VOTE}`,
    [...playerIds, ...ratingLeagueIds],
  );

  const presenceKeys = new Set();
  for (const row of rows || []) {
    const pid = Number(row.player_id);
    const lid = Number(row.league_id);
    if (pid > 0 && lid > 0) presenceKeys.add(`${pid}:${lid}`);
  }

  for (const [editionLeagueId, edition] of entries) {
    const playerId = Number(edition.playerId);
    const scope = byInput.get(editionLeagueId) || [editionLeagueId];
    const hasPresence = scope.some((ratingLeagueId) => (
      presenceKeys.has(`${playerId}:${Number(ratingLeagueId)}`)
    ));
    if (hasPresence) withPresence.add(editionLeagueId);
  }

  return withPresence;
}

/**
 * Trofei vinti per league_id: squadra del giocatore = vincitrice finale
 * E il giocatore ha almeno una presenza (voto o S.V.) in quella lega.
 * @returns {Map<number, { championship: boolean, wine: boolean }>}
 */
async function computePlayerOfficialTrophyWinsByLeague(competitionId, editionRows) {
  const groupId = Number(competitionId);
  const out = new Map();
  if (!Number.isFinite(groupId) || groupId <= 0) return out;

  const editionByLeague = buildPlayerEditionByLeagueId(editionRows);
  if (!editionByLeague.size) return out;

  const leagues = await listOfficialGroupSeasonLeagues(groupId);
  const leagueIds = (leagues || [])
    .map((row) => Number(row.league_id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!leagueIds.length) return out;

  const finals = await fetchHallFinalMatchesByLeagueStage(groupId, leagueIds);
  const leaguesWithPresence = await fetchEditionLeaguesWithPresence(editionByLeague);

  for (const row of leagues || []) {
    const leagueId = Number(row.league_id);
    if (!Number.isFinite(leagueId) || leagueId <= 0) continue;

    const edition = editionByLeague.get(leagueId);
    if (!edition) continue;
    // Senza almeno una presenza (voto / S.V.) il trofeo non conta
    if (!leaguesWithPresence.has(leagueId)) continue;

    let championship = false;
    let wine = false;

    const champMatches = finals.get(`${leagueId}:${HALL_CAMPIONATO_FINAL_STAGE_ID}`) || [];
    const champWinner = determineKnockoutMatchWinner(champMatches[0] || null);
    if (champWinner?.team_id && Number(champWinner.team_id) === Number(edition.teamId)) {
      championship = true;
    }

    const wineMatches = finals.get(`${leagueId}:${HALL_WINE_TROPHY_STAGE_ID}`) || [];
    const wineWinner = resolveWineWinnerFromMatches(wineMatches);
    if (wineWinner?.team_id && Number(wineWinner.team_id) === Number(edition.teamId)) {
      wine = true;
    }

    if (championship || wine) {
      out.set(leagueId, { championship, wine });
    }
  }

  return out;
}

/**
 * Conta i trofei vinti dal giocatore: squadra vincitrice + almeno una presenza in lega.
 */
async function computePlayerOfficialTrophies(competitionId, editionRows) {
  const winsByLeague = await computePlayerOfficialTrophyWinsByLeague(competitionId, editionRows);
  let championships = 0;
  let wineTrophies = 0;
  for (const win of winsByLeague.values()) {
    if (win.championship) championships += 1;
    if (win.wine) wineTrophies += 1;
  }
  return { championships, wine_trophies: wineTrophies };
}

module.exports = {
  HALL_CAMPIONATO_FINAL_STAGE_ID,
  HALL_WINE_TROPHY_STAGE_ID,
  computePlayerOfficialTrophies,
  computePlayerOfficialTrophyWinsByLeague,
  determineKnockoutMatchWinner,
  fetchHallFinalMatchesByLeagueStage,
  listOfficialGroupSeasonLeagues,
};

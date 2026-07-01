const { query } = require('../config/database');
const { isOfficialLeague } = require('./matchdayGhost');
const { normalizeVoteRating } = require('./voteRating');

let schemaReady = false;

async function ensureOfficialMatchMatchdayLinksSchema() {
  if (schemaReady) return;
  await query(
    `CREATE TABLE IF NOT EXISTS official_match_matchday_links (
       id BIGSERIAL PRIMARY KEY,
       official_match_id INTEGER NOT NULL REFERENCES official_matches(id) ON DELETE CASCADE,
       league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
       team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
       matchday_id INTEGER NOT NULL REFERENCES matchdays(id) ON DELETE CASCADE,
       giornata INTEGER NOT NULL,
       created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (official_match_id, team_id),
       UNIQUE (league_id, team_id, matchday_id)
     )`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_omml_match ON official_match_matchday_links (official_match_id)`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_omml_league_team_md ON official_match_matchday_links (league_id, team_id, matchday_id)`
  );
  schemaReady = true;
}

async function getEffectiveLeagueId(leagueId) {
  const rows = await query(
    `SELECT COALESCE(NULLIF(linked_to_league_id, 0), id) AS eff
     FROM leagues WHERE id = ? LIMIT 1`,
    [leagueId]
  );
  const eff = Number(rows[0]?.eff || leagueId);
  return Number.isFinite(eff) && eff > 0 ? eff : Number(leagueId);
}

async function getMatchLinkContext(matchId) {
  await ensureOfficialMatchMatchdayLinksSchema();
  const rows = await query(
    `SELECT m.id, m.competition_id, m.league_id, m.home_team_id, m.away_team_id,
            ht.name AS home_team_name, at.name AS away_team_name,
            ht.league_id AS home_league_id, at.league_id AS away_league_id
     FROM official_matches m
     LEFT JOIN teams ht ON ht.id = m.home_team_id
     LEFT JOIN teams at ON at.id = m.away_team_id
     WHERE m.id = ?
     LIMIT 1`,
    [matchId]
  );
  const row = rows[0];
  if (!row) return null;
  const homeTeamId = Number(row.home_team_id);
  const awayTeamId = Number(row.away_team_id);
  const homeLeagueId = Number(row.home_league_id || 0);
  const awayLeagueId = Number(row.away_league_id || 0);
  const matchLeagueId = Number(row.league_id || 0);
  const leagueId =
    matchLeagueId > 0
      ? matchLeagueId
      : homeLeagueId > 0 && homeLeagueId === awayLeagueId
        ? homeLeagueId
        : 0;
  return {
    matchId: Number(row.id),
    competitionId: Number(row.competition_id),
    leagueId,
    homeTeamId,
    awayTeamId,
    homeTeamName: row.home_team_name || 'Casa',
    awayTeamName: row.away_team_name || 'Trasferta',
    homeLeagueId,
    awayLeagueId,
  };
}

async function assertOfficialLeagueForLinks(leagueId) {
  const official = await isOfficialLeague(leagueId);
  if (!official) {
    const err = new Error('Funzione disponibile solo per leghe ufficiali');
    err.status = 400;
    throw err;
  }
}

async function assertTeamsBelongToLeague(leagueId, homeTeamId, awayTeamId) {
  const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
  const rows = await query(
    `SELECT id FROM teams WHERE league_id = ? AND id IN (?, ?)`,
    [effectiveLeagueId, homeTeamId, awayTeamId]
  );
  const ids = new Set(rows.map((r) => Number(r.id)));
  if (!ids.has(homeTeamId) || !ids.has(awayTeamId)) {
    const err = new Error('Le squadre della partita devono appartenere alla lega ufficiale selezionata');
    err.status = 400;
    throw err;
  }
  return effectiveLeagueId;
}

async function getLinksForMatch(matchId) {
  await ensureOfficialMatchMatchdayLinksSchema();
  const rows = await query(
    `SELECT l.id, l.official_match_id, l.league_id, l.team_id, l.matchday_id, l.giornata,
            t.name AS team_name,
            COALESCE(md.is_ghost, 0)::int AS is_ghost,
            to_char((md.deadline AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-DD') AS deadline_date
     FROM official_match_matchday_links l
     INNER JOIN teams t ON t.id = l.team_id
     INNER JOIN matchdays md ON md.id = l.matchday_id
     WHERE l.official_match_id = ?
     ORDER BY l.team_id ASC`,
    [matchId]
  );
  return rows;
}

function linksToSides(links, ctx) {
  const home = links.find((l) => Number(l.team_id) === ctx.homeTeamId) || null;
  const away = links.find((l) => Number(l.team_id) === ctx.awayTeamId) || null;
  const mapSide = (row) =>
    row
      ? {
          team_id: Number(row.team_id),
          team_name: row.team_name,
          matchday_id: Number(row.matchday_id),
          giornata: Number(row.giornata),
          is_ghost: Number(row.is_ghost) === 1,
          deadline_date: row.deadline_date || null,
        }
      : null;
  return { home: mapSide(home), away: mapSide(away) };
}

async function getOccupiedSlots(leagueId, excludeMatchId = null) {
  await ensureOfficialMatchMatchdayLinksSchema();
  const params = [leagueId];
  let excludeSql = '';
  if (excludeMatchId) {
    excludeSql = ' AND l.official_match_id <> ?';
    params.push(excludeMatchId);
  }
  const rows = await query(
    `SELECT l.team_id, t.name AS team_name, l.matchday_id, l.giornata, l.official_match_id,
            ht.name AS home_name, at.name AS away_name
     FROM official_match_matchday_links l
     INNER JOIN teams t ON t.id = l.team_id
     INNER JOIN official_matches om ON om.id = l.official_match_id
     LEFT JOIN teams ht ON ht.id = om.home_team_id
     LEFT JOIN teams at ON at.id = om.away_team_id
     WHERE l.league_id = ?${excludeSql}
     ORDER BY l.giornata ASC, t.name ASC`,
    params
  );
  return rows.map((r) => ({
    team_id: Number(r.team_id),
    team_name: r.team_name,
    matchday_id: Number(r.matchday_id),
    giornata: Number(r.giornata),
    official_match_id: Number(r.official_match_id),
    match_label: `${r.home_name || '?'} – ${r.away_name || '?'}`,
  }));
}

async function getMatchdayLinkOptions(matchId) {
  const ctx = await getMatchLinkContext(matchId);
  if (!ctx || ctx.leagueId <= 0) {
    const err = new Error('Partita senza lega ufficiale associata');
    err.status = 400;
    throw err;
  }
  await assertOfficialLeagueForLinks(ctx.leagueId);
  const effectiveLeagueId = await assertTeamsBelongToLeague(
    ctx.leagueId,
    ctx.homeTeamId,
    ctx.awayTeamId
  );
  const [matchdays, links, occupied] = await Promise.all([
    query(
      `SELECT id, giornata,
              COALESCE(is_ghost, 0)::int AS is_ghost,
              to_char((deadline AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-DD') AS deadline_date
       FROM matchdays
       WHERE league_id = ?
       ORDER BY giornata ASC`,
      [effectiveLeagueId]
    ),
    getLinksForMatch(matchId),
    getOccupiedSlots(ctx.leagueId, matchId),
  ]);
  const sides = linksToSides(links, ctx);
  return {
    league_id: ctx.leagueId,
    effective_league_id: effectiveLeagueId,
    home_team: { id: ctx.homeTeamId, name: ctx.homeTeamName },
    away_team: { id: ctx.awayTeamId, name: ctx.awayTeamName },
    matchdays,
    current: {
      home_matchday_id: sides.home?.matchday_id ?? null,
      away_matchday_id: sides.away?.matchday_id ?? null,
    },
    occupied_slots: occupied,
    links: sides,
    has_links: !!(sides.home || sides.away),
  };
}

async function resolveMatchdayForTeam(leagueId, teamId, matchdayIdRaw, excludeMatchId = null) {
  const matchdayId = matchdayIdRaw == null || matchdayIdRaw === '' ? null : Number(matchdayIdRaw);
  if (matchdayId == null) return null;
  if (!Number.isFinite(matchdayId) || matchdayId <= 0) {
    const err = new Error('Giornata non valida');
    err.status = 400;
    throw err;
  }
  const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
  const rows = await query(
    `SELECT md.id, md.giornata, md.league_id
     FROM matchdays md
     WHERE md.id = ? AND md.league_id = ?
     LIMIT 1`,
    [matchdayId, effectiveLeagueId]
  );
  if (!rows[0]) {
    const err = new Error('Giornata non trovata nella lega della partita');
    err.status = 400;
    throw err;
  }
  const teamRows = await query(`SELECT id FROM teams WHERE id = ? AND league_id = ? LIMIT 1`, [
    teamId,
    effectiveLeagueId,
  ]);
  if (!teamRows[0]) {
    const err = new Error('Squadra non appartenente alla lega');
    err.status = 400;
    throw err;
  }
  const conflictParams = [leagueId, teamId, matchdayId];
  let conflictSql = `SELECT l.official_match_id, ht.name AS home_name, at.name AS away_name
     FROM official_match_matchday_links l
     INNER JOIN official_matches om ON om.id = l.official_match_id
     LEFT JOIN teams ht ON ht.id = om.home_team_id
     LEFT JOIN teams at ON at.id = om.away_team_id
     WHERE l.league_id = ? AND l.team_id = ? AND l.matchday_id = ?`;
  if (excludeMatchId) {
    conflictSql += ' AND l.official_match_id <> ?';
    conflictParams.push(excludeMatchId);
  }
  conflictSql += ' LIMIT 1';
  const conflict = await query(conflictSql, conflictParams);
  if (conflict[0]) {
    const c = conflict[0];
    const err = new Error(
      `La squadra ha già una partita collegata a questa giornata (${c.home_name || '?'} – ${c.away_name || '?'})`
    );
    err.status = 409;
    throw err;
  }
  return { matchday_id: matchdayId, giornata: Number(rows[0].giornata) };
}

async function setMatchdayLinks(matchId, userId, { home_matchday_id, away_matchday_id }) {
  const ctx = await getMatchLinkContext(matchId);
  if (!ctx || ctx.leagueId <= 0) {
    const err = new Error('Partita senza lega ufficiale associata');
    err.status = 400;
    throw err;
  }
  await assertOfficialLeagueForLinks(ctx.leagueId);
  const effectiveLeagueId = await assertTeamsBelongToLeague(
    ctx.leagueId,
    ctx.homeTeamId,
    ctx.awayTeamId
  );

  const homeMd = await resolveMatchdayForTeam(
    ctx.leagueId,
    ctx.homeTeamId,
    home_matchday_id,
    matchId
  );
  const awayMd = await resolveMatchdayForTeam(
    ctx.leagueId,
    ctx.awayTeamId,
    away_matchday_id,
    matchId
  );

  await query(`DELETE FROM official_match_matchday_links WHERE official_match_id = ?`, [matchId]);

  const inserts = [];
  if (homeMd) {
    inserts.push({
      team_id: ctx.homeTeamId,
      matchday_id: homeMd.matchday_id,
      giornata: homeMd.giornata,
    });
  }
  if (awayMd) {
    inserts.push({
      team_id: ctx.awayTeamId,
      matchday_id: awayMd.matchday_id,
      giornata: awayMd.giornata,
    });
  }

  for (const row of inserts) {
    await query(
      `INSERT INTO official_match_matchday_links
         (official_match_id, league_id, team_id, matchday_id, giornata, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [matchId, ctx.leagueId, row.team_id, row.matchday_id, row.giornata, userId || null]
    );
  }

  void effectiveLeagueId;
  return getMatchdayLinkOptions(matchId);
}

async function getLeagueIdsForMatchdayDataCleanup(leagueId) {
  const ids = new Set([Number(leagueId)]);
  try {
    const children = await query(
      `SELECT id FROM leagues WHERE linked_to_league_id = ?`,
      [leagueId]
    );
    children.forEach((r) => ids.add(Number(r.id)));
  } catch (_) {
    /* optional */
  }
  return [...ids].filter((n) => Number.isFinite(n) && n > 0);
}

async function invalidateCalculatedForLeagueGiornata(leagueId, giornata) {
  const g = Number(giornata);
  if (!Number.isFinite(g) || g <= 0) return;
  const leagueIds = await getLeagueIdsForMatchdayDataCleanup(leagueId);
  if (!leagueIds.length) return;
  const inPh = leagueIds.map(() => '?').join(', ');
  const params = [...leagueIds, g];
  const optionalStatements = [
    `DELETE FROM matchday_player_scores WHERE league_id IN (${inPh}) AND giornata::numeric = ?::numeric`,
    `DELETE FROM matchday_results WHERE league_id IN (${inPh}) AND giornata::numeric = ?::numeric`,
    `DELETE FROM push_notification_sends WHERE league_id IN (${inPh}) AND giornata::numeric = ?::numeric AND notification_type = 'matchday_calculated'`,
  ];
  for (const sql of optionalStatements) {
    try {
      await query(sql, params);
    } catch (_) {
      /* optional tables */
    }
  }
}

function mapRatingRow(v) {
  return {
    rating: normalizeVoteRating(v?.rating || 0),
    goals: Number(v?.goals || 0),
    assists: Number(v?.assists || 0),
    yellow_cards: Number(v?.yellow_cards || 0),
    red_cards: Number(v?.red_cards || 0),
    goals_conceded: Number(v?.goals_conceded || 0),
    own_goals: Number(v?.own_goals || 0),
    penalty_missed: Number(v?.penalty_missed || 0),
    penalty_saved: Number(v?.penalty_saved || 0),
    clean_sheet: Number(v?.clean_sheet || 0),
    pallone_fuori: Number(v?.pallone_fuori || 0),
    briso: Number(v?.briso || 0),
    no_divisa: Number(v?.no_divisa || 0),
  };
}

async function upsertPlayerRatings(leagueId, giornata, ratings) {
  const entries = Object.entries(ratings || {});
  for (const [playerIdRaw, v] of entries) {
    const playerId = Number(playerIdRaw);
    if (!Number.isFinite(playerId) || playerId <= 0) continue;
    const row = mapRatingRow(v);
    await query(
      `INSERT INTO player_ratings (
         league_id, giornata, player_id, rating, goals, assists, yellow_cards, red_cards,
         goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet,
         pallone_fuori, briso, no_divisa
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (league_id, giornata, player_id)
       DO UPDATE SET
         rating = EXCLUDED.rating,
         goals = EXCLUDED.goals,
         assists = EXCLUDED.assists,
         yellow_cards = EXCLUDED.yellow_cards,
         red_cards = EXCLUDED.red_cards,
         goals_conceded = EXCLUDED.goals_conceded,
         own_goals = EXCLUDED.own_goals,
         penalty_missed = EXCLUDED.penalty_missed,
         penalty_saved = EXCLUDED.penalty_saved,
         clean_sheet = EXCLUDED.clean_sheet,
         pallone_fuori = EXCLUDED.pallone_fuori,
         briso = EXCLUDED.briso,
         no_divisa = EXCLUDED.no_divisa`,
      [
        leagueId,
        giornata,
        playerId,
        row.rating,
        row.goals,
        row.assists,
        row.yellow_cards,
        row.red_cards,
        row.goals_conceded,
        row.own_goals,
        row.penalty_missed,
        row.penalty_saved,
        row.clean_sheet,
        row.pallone_fuori,
        row.briso,
        row.no_divisa,
      ]
    );
  }
  await invalidateCalculatedForLeagueGiornata(leagueId, giornata);
}

async function loadRatingsForGiornata(leagueId, giornata, playerIds = null) {
  const g = Number(giornata);
  if (!Number.isFinite(g) || g <= 0) return {};
  let sql = `SELECT player_id, rating, goals, assists, yellow_cards, red_cards,
                    goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet,
                    pallone_fuori, briso, no_divisa
             FROM player_ratings
             WHERE league_id = ? AND giornata = ?`;
  const params = [leagueId, g];
  if (Array.isArray(playerIds) && playerIds.length > 0) {
    const ph = playerIds.map(() => '?').join(', ');
    sql += ` AND player_id IN (${ph})`;
    params.push(...playerIds);
  }
  const rows = await query(sql, params);
  const mapped = {};
  rows.forEach((r) => {
    mapped[String(r.player_id)] = mapRatingRow(r);
  });
  return mapped;
}

async function getBonusSettings(leagueId) {
  try {
    const rows = await query(
      `SELECT enable_bonus_malus, enable_goal, bonus_goal, enable_assist, bonus_assist,
              enable_yellow_card, malus_yellow_card, enable_red_card, malus_red_card
       FROM league_bonus_settings
       WHERE league_id = ?
       LIMIT 1`,
      [leagueId]
    );
    return rows[0] || null;
  } catch (_) {
    return null;
  }
}

async function getMatchVotesBundle(matchId) {
  const options = await getMatchdayLinkOptions(matchId);
  if (!options.has_links) {
    const err = new Error('Nessuna giornata collegata a questa partita');
    err.status = 404;
    throw err;
  }
  const effectiveLeagueId = options.effective_league_id;
  const teamIds = [options.home_team.id, options.away_team.id];
  const players = await query(
    `SELECT p.id, p.first_name, p.last_name, p.role, p.team_id, t.name AS team_name
     FROM players p
     INNER JOIN teams t ON t.id = p.team_id
     WHERE p.team_id IN (?, ?)
     ORDER BY p.team_id ASC, p.role ASC, p.last_name ASC`,
    teamIds
  );
  const giornate = new Set();
  if (options.links.home) giornate.add(options.links.home.giornata);
  if (options.links.away) giornate.add(options.links.away.giornata);

  const votes = {};
  for (const g of giornate) {
    const chunk = await loadRatingsForGiornata(effectiveLeagueId, g);
    Object.assign(votes, chunk);
  }

  const teams = teamIds.map((tid) => {
    const side = tid === options.home_team.id ? 'home' : 'away';
    const link = side === 'home' ? options.links.home : options.links.away;
    return {
      id: tid,
      name: side === 'home' ? options.home_team.name : options.away_team.name,
      side,
      giornata: link?.giornata ?? null,
      matchday_id: link?.matchday_id ?? null,
      is_ghost: link?.is_ghost ?? false,
      players: players.filter((p) => Number(p.team_id) === tid),
    };
  });

  const bonusSettings = await getBonusSettings(options.league_id);
  return {
    league_id: options.league_id,
    effective_league_id: effectiveLeagueId,
    links: options.links,
    teams,
    votes,
    bonus_settings: bonusSettings,
    has_links: true,
  };
}

async function saveMatchVotes(matchId, body) {
  const bundle = await getMatchVotesBundle(matchId);
  const ratings = body?.ratings && typeof body.ratings === 'object' ? body.ratings : {};
  const saveTeamId = body?.team_id != null ? Number(body.team_id) : null;
  const effectiveLeagueId = bundle.effective_league_id;

  const teamsToSave = saveTeamId
    ? bundle.teams.filter((t) => t.id === saveTeamId)
    : bundle.teams.filter((t) => t.giornata != null);

  if (saveTeamId && !teamsToSave.length) {
    const err = new Error('Squadra non valida per questa partita');
    err.status = 400;
    throw err;
  }

  const giornateTouched = new Set();
  for (const team of teamsToSave) {
    const playerIds = team.players.map((p) => Number(p.id));
    const teamRatings = {};
    playerIds.forEach((pid) => {
      const vote = ratings[String(pid)] || ratings[pid] || { rating: 0 };
      teamRatings[pid] = vote;
    });
    await upsertPlayerRatings(effectiveLeagueId, team.giornata, teamRatings);
    giornateTouched.add(team.giornata);
  }

  const freshVotes = {};
  for (const g of giornateTouched) {
    Object.assign(freshVotes, await loadRatingsForGiornata(effectiveLeagueId, g));
  }

  return { message: 'Voti salvati', votes: freshVotes, giornate: [...giornateTouched] };
}

module.exports = {
  ensureOfficialMatchMatchdayLinksSchema,
  getMatchLinkContext,
  getMatchdayLinkOptions,
  setMatchdayLinks,
  getMatchVotesBundle,
  saveMatchVotes,
  isOfficialLeague,
};

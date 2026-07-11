const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const OVERVIEW_LOG_PREFIX = '[player-overview]';

function logOverview(step, payload = {}) {
  try {
    console.log(OVERVIEW_LOG_PREFIX, step, JSON.stringify(payload));
  } catch (_) {
    console.log(OVERVIEW_LOG_PREFIX, step, payload);
  }
}

async function getLeagueOfficialMeta(leagueId) {
  const rows = await query(
    `SELECT COALESCE(is_official, 0) AS is_official, official_group_id
     FROM leagues
     WHERE id = ?
     LIMIT 1`,
    [leagueId]
  );
  if (!rows.length) return null;
  return {
    is_official: Number(rows[0].is_official || 0),
    official_group_id: rows[0].official_group_id ? Number(rows[0].official_group_id) : null,
  };
}

/** Leghe dove possono essere salvati i voti (parent collegato + figli che puntano al parent). */
async function resolveLeagueIdsForRatings(leagueId) {
  const lid = Number(leagueId);
  if (!Number.isFinite(lid) || lid <= 0) return [];

  let effectiveId = lid;
  try {
    const rows = await query(
      `SELECT linked_to_league_id FROM leagues WHERE id = ? LIMIT 1`,
      [lid]
    );
    const linked = Number(rows[0]?.linked_to_league_id || 0);
    if (linked > 0) effectiveId = linked;
  } catch (_) {}

  const ids = new Set([lid, effectiveId]);
  try {
    const children = await query(
      `SELECT id FROM leagues WHERE linked_to_league_id = ?`,
      [effectiveId]
    );
    (children || []).forEach((r) => {
      const n = Number(r.id);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    });
  } catch (_) {}

  return [...ids];
}

const BONUS_SCORE_SQL = `
  pr.rating
  + CASE WHEN COALESCE(bs.enable_goal, 0) = 1 THEN COALESCE(bs.bonus_goal, 0) * COALESCE(pr.goals, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_assist, 0) = 1 THEN COALESCE(bs.bonus_assist, 0) * COALESCE(pr.assists, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_yellow_card, 0) = 1 THEN COALESCE(bs.malus_yellow_card, 0) * COALESCE(pr.yellow_cards, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_red_card, 0) = 1 THEN COALESCE(bs.malus_red_card, 0) * COALESCE(pr.red_cards, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_goals_conceded, 0) = 1 THEN COALESCE(bs.malus_goals_conceded, 0) * COALESCE(pr.goals_conceded, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_own_goal, 0) = 1 THEN COALESCE(bs.malus_own_goal, 0) * COALESCE(pr.own_goals, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_penalty_missed, 0) = 1 THEN COALESCE(bs.malus_penalty_missed, 0) * COALESCE(pr.penalty_missed, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_penalty_saved, 0) = 1 THEN COALESCE(bs.bonus_penalty_saved, 0) * COALESCE(pr.penalty_saved, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_clean_sheet, 0) = 1 THEN COALESCE(bs.bonus_clean_sheet, 0) * COALESCE(pr.clean_sheet, 0) ELSE 0 END
`;

/**
 * Presenze = voto reale o S.V. (-0.25), una per (lega, giornata).
 * Media voto = solo su voti reali (esclude S.V. e N.D.).
 */
async function fetchPlayerStatsAggregates(playerIds, leagueIds) {
  if (!playerIds.length || !leagueIds.length) {
    return {
      games_played: 0,
      games_with_rating: 0,
      avg_rating: 0,
      avg_rating_with_bonus: 0,
      total_goals: 0,
      total_assists: 0,
      total_yellow_cards: 0,
      total_red_cards: 0,
      total_goals_conceded: 0,
      total_own_goals: 0,
      total_penalty_missed: 0,
      total_penalty_saved: 0,
      total_clean_sheets: 0,
    };
  }

  const playerPh = playerIds.map(() => '?').join(',');
  const leaguesPh = leagueIds.map(() => '?').join(',');
  const params = [...playerIds, ...leagueIds];

  const rows = await query(
    `WITH vote_rows AS (
       SELECT
         pr.league_id,
         pr.giornata,
         pr.player_id,
         pr.rating::float AS rating,
         (${BONUS_SCORE_SQL})::float AS rating_with_bonus,
         COALESCE(pr.goals, 0) AS goals,
         COALESCE(pr.assists, 0) AS assists,
         COALESCE(pr.yellow_cards, 0) AS yellow_cards,
         COALESCE(pr.red_cards, 0) AS red_cards,
         COALESCE(pr.goals_conceded, 0) AS goals_conceded,
         COALESCE(pr.own_goals, 0) AS own_goals,
         COALESCE(pr.penalty_missed, 0) AS penalty_missed,
         COALESCE(pr.penalty_saved, 0) AS penalty_saved,
         COALESCE(pr.clean_sheet, 0) AS clean_sheet
       FROM player_ratings pr
       LEFT JOIN league_bonus_settings bs ON bs.league_id = pr.league_id
       WHERE pr.player_id IN (${playerPh})
         AND pr.league_id IN (${leaguesPh})
         AND (pr.rating > 0 OR ABS(pr.rating + 0.25) < 0.001)
     ),
     presence AS (
       SELECT DISTINCT ON (league_id, giornata)
         league_id,
         giornata,
         goals,
         assists,
         yellow_cards,
         red_cards,
         goals_conceded,
         own_goals,
         penalty_missed,
         penalty_saved,
         clean_sheet
       FROM vote_rows
       ORDER BY league_id, giornata, player_id DESC
     ),
     scored AS (
       SELECT DISTINCT ON (league_id, giornata)
         league_id,
         giornata,
         rating,
         rating_with_bonus
       FROM vote_rows
       WHERE rating > 0
       ORDER BY league_id, giornata, player_id DESC
     )
     SELECT
       (SELECT COUNT(*)::int FROM presence) AS games_played,
       (SELECT COUNT(*)::int FROM scored) AS games_with_rating,
       (SELECT AVG(rating) FROM scored) AS avg_rating,
       (SELECT AVG(rating_with_bonus) FROM scored) AS avg_rating_with_bonus,
       (SELECT COALESCE(SUM(goals), 0) FROM presence) AS total_goals,
       (SELECT COALESCE(SUM(assists), 0) FROM presence) AS total_assists,
       (SELECT COALESCE(SUM(yellow_cards), 0) FROM presence) AS total_yellow_cards,
       (SELECT COALESCE(SUM(red_cards), 0) FROM presence) AS total_red_cards,
       (SELECT COALESCE(SUM(goals_conceded), 0) FROM presence) AS total_goals_conceded,
       (SELECT COALESCE(SUM(own_goals), 0) FROM presence) AS total_own_goals,
       (SELECT COALESCE(SUM(penalty_missed), 0) FROM presence) AS total_penalty_missed,
       (SELECT COALESCE(SUM(penalty_saved), 0) FROM presence) AS total_penalty_saved,
       (SELECT COALESCE(SUM(clean_sheet), 0) FROM presence) AS total_clean_sheets
     FROM (SELECT 1) AS _one`,
    params
  );

  const r = rows[0] || {};
  return {
    games_played: Number(r.games_played || 0),
    games_with_rating: Number(r.games_with_rating || 0),
    avg_rating: safeNumber(r.avg_rating, 2),
    avg_rating_with_bonus: safeNumber(r.avg_rating_with_bonus, 2),
    total_goals: Number(r.total_goals || 0),
    total_assists: Number(r.total_assists || 0),
    total_yellow_cards: Number(r.total_yellow_cards || 0),
    total_red_cards: Number(r.total_red_cards || 0),
    total_goals_conceded: Number(r.total_goals_conceded || 0),
    total_own_goals: Number(r.total_own_goals || 0),
    total_penalty_missed: Number(r.total_penalty_missed || 0),
    total_penalty_saved: Number(r.total_penalty_saved || 0),
    total_clean_sheets: Number(r.total_clean_sheets || 0),
  };
}

function safeNumber(value, decimals = null) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return decimals == null ? n : Number(n.toFixed(decimals));
}

async function resolveOfficialGroupId(leagueId) {
  let currentId = Number(leagueId);
  const seen = new Set();

  while (Number.isFinite(currentId) && currentId > 0 && !seen.has(currentId)) {
    seen.add(currentId);
    const leagueMetaRows = await query(
      `SELECT id, linked_to_league_id, official_group_id
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [currentId]
    );
    const leagueMeta = leagueMetaRows[0];
    if (!leagueMeta) break;

    const groupId = leagueMeta.official_group_id ? Number(leagueMeta.official_group_id) : null;
    if (groupId) return groupId;

    currentId = Number(leagueMeta.linked_to_league_id || 0);
  }

  return null;
}

async function fetchClusterDiagnostics(playerId) {
  const pid = Number(playerId);
  if (!Number.isFinite(pid) || pid <= 0) return [];

  try {
    const rows = await query(
      `SELECT
         pc.id AS cluster_id,
         pc.status,
         pc.official_group_id,
         (
           SELECT COUNT(*)::int
           FROM player_cluster_members pcm_all
           WHERE pcm_all.cluster_id = pc.id
         ) AS members_count
       FROM player_cluster_members pcm
       INNER JOIN player_clusters pc ON pc.id = pcm.cluster_id
       WHERE pcm.player_id = ?
       GROUP BY pc.id, pc.status, pc.official_group_id
       ORDER BY pc.id DESC`,
      [pid]
    );
    return (rows || []).map((row) => ({
      cluster_id: Number(row.cluster_id) || null,
      status: String(row.status || ''),
      official_group_id: Number(row.official_group_id) || null,
      members_count: Number(row.members_count) || 0,
    }));
  } catch (error) {
    return [{ error: error.message }];
  }
}

async function fetchClusterContext(playerId, preferredGroupId = null) {
  const pid = Number(playerId);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { playerIds: [], groupId: preferredGroupId || null, hasCluster: false, clusterId: null, lookup: 'invalid_player' };
  }

  const lookupCluster = async (groupFilterId, lookupLabel) => {
    const clusterParams = [pid];
    let clusterSql = `
      SELECT pc.id AS cluster_id, pc.official_group_id
      FROM player_cluster_members pcm
      INNER JOIN player_clusters pc ON pc.id = pcm.cluster_id
      WHERE pcm.player_id = ?
        AND pc.status = 'approved'
    `;
    if (groupFilterId) {
      clusterSql += ' AND pc.official_group_id = ?';
      clusterParams.push(Number(groupFilterId));
    }
    clusterSql += ' ORDER BY pc.approved_at DESC NULLS LAST, pc.id DESC LIMIT 1';

    const clusterRows = await query(clusterSql, clusterParams);
    const clusterId = Number(clusterRows[0]?.cluster_id || 0);
    if (!clusterId) {
      logOverview('cluster_lookup_miss', {
        playerId: pid,
        lookup: lookupLabel,
        preferredGroupId: groupFilterId || null,
      });
      return null;
    }

    const clusterGroupId = Number(clusterRows[0]?.official_group_id || 0) || null;
    const memberRows = await query(
      `SELECT player_id FROM player_cluster_members WHERE cluster_id = ?`,
      [clusterId]
    );
    const playerIds = (memberRows || [])
      .map((row) => Number(row.player_id))
      .filter((id) => Number.isFinite(id) && id > 0);
    const uniquePlayerIds = [...new Set(playerIds.length ? playerIds : [pid])];

    logOverview('cluster_lookup_hit', {
      playerId: pid,
      lookup: lookupLabel,
      clusterId,
      clusterGroupId,
      membersCount: uniquePlayerIds.length,
      memberPlayerIds: uniquePlayerIds,
    });

    return {
      playerIds: uniquePlayerIds,
      groupId: groupFilterId || clusterGroupId || null,
      hasCluster: uniquePlayerIds.length > 1,
      clusterId,
      lookup: lookupLabel,
    };
  };

  if (preferredGroupId) {
    const inPreferredGroup = await lookupCluster(preferredGroupId, 'preferred_group');
    if (inPreferredGroup) return inPreferredGroup;
  }

  const anyCluster = await lookupCluster(null, 'any_group');
  if (anyCluster) return anyCluster;

  logOverview('cluster_fallback_single_player', {
    playerId: pid,
    preferredGroupId: preferredGroupId || null,
  });

  return {
    playerIds: [pid],
    groupId: preferredGroupId || null,
    hasCluster: false,
    clusterId: null,
    lookup: 'single_player_fallback',
  };
}

async function isLeagueExcludedFromPlayerOverview(leagueId, cache = new Map()) {
  let currentId = Number(leagueId);
  if (!Number.isFinite(currentId) || currentId <= 0) return false;
  if (cache.has(currentId)) return cache.get(currentId);

  const seen = new Set();
  let excluded = false;
  let excludeReason = 'visible';

  while (Number.isFinite(currentId) && currentId > 0 && !seen.has(currentId)) {
    seen.add(currentId);
    const rows = await query(
      `SELECT id, linked_to_league_id,
              COALESCE(is_official, 0) AS is_official,
              COALESCE(is_official_squad_public, 0) AS is_official_squad_public,
              COALESCE(is_hidden_from_discovery, 0) AS is_hidden_from_discovery
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [currentId]
    );
    const row = rows[0];
    if (!row) break;

    if (Number(row.is_official || 0) === 1) {
      if (Number(row.is_official_squad_public || 0) === 0) {
        excluded = true;
        excludeReason = 'official_bozza';
      }
      break;
    }

    if (Number(row.is_hidden_from_discovery || 0) === 1) {
      excluded = true;
      excludeReason = 'hidden_from_discovery';
      break;
    }

    currentId = Number(row.linked_to_league_id || 0);
  }

  for (const id of seen) {
    cache.set(id, excluded);
  }
  if (!seen.has(Number(leagueId))) {
    cache.set(Number(leagueId), excluded);
  }

  cache.set(`${Number(leagueId)}:reason`, excludeReason);
  return excluded;
}

async function fetchClusterMembersLeagues(playerIds) {
  if (!playerIds.length) return [];

  const playerPh = playerIds.map(() => '?').join(',');
  const rows = await query(
    `SELECT
       p.id AS player_id,
       t.league_id
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     WHERE p.id IN (${playerPh})`,
    playerIds
  );

  const leagueByPlayer = new Map();
  for (const row of rows || []) {
    const pid = Number(row.player_id);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    leagueByPlayer.set(pid, Number(row.league_id || 0) || null);
  }

  return playerIds.map((playerId) => ({
    player_id: Number(playerId),
    league_id: leagueByPlayer.get(Number(playerId)) || null,
  }));
}

async function countVisibleClusterMembers(playerIds) {
  if (!playerIds.length) return { visibleCount: 0, memberDetails: [] };

  const members = await fetchClusterMembersLeagues(playerIds);
  const hiddenCache = new Map();
  const uniqueLeagueIds = [
    ...new Set(
      members
        .map((member) => Number(member.league_id || 0))
        .filter((leagueId) => Number.isFinite(leagueId) && leagueId > 0)
    ),
  ];

  await Promise.all(
    uniqueLeagueIds.map((leagueId) => isLeagueExcludedFromPlayerOverview(leagueId, hiddenCache))
  );

  const memberDetails = [];
  let visibleCount = 0;

  for (const member of members) {
    const leagueId = Number(member.league_id || 0);
    const hasLeague = Number.isFinite(leagueId) && leagueId > 0;
    const excluded = hasLeague ? !!hiddenCache.get(leagueId) : null;
    const visible = hasLeague && !excluded;
    const excludeReason = hasLeague ? hiddenCache.get(`${leagueId}:reason`) || null : null;

    memberDetails.push({
      player_id: member.player_id,
      league_id: hasLeague ? leagueId : null,
      excluded,
      visible,
      reason: !hasLeague
        ? 'no_league'
        : (excluded ? (excludeReason || 'stats_hidden') : 'visible'),
    });

    if (visible) visibleCount += 1;
  }

  logOverview('visible_editions_count', {
    inputPlayerIds: playerIds,
    membersTotal: members.length,
    visibleCount,
    memberDetails,
    excludedLeagueFlags: Object.fromEntries(
      [...hiddenCache.entries()].filter(([key]) => !String(key).includes(':reason'))
    ),
  });

  return { visibleCount, memberDetails };
}

async function fetchPlayerEditionRows(playerIds) {
  if (!playerIds.length) return [];

  const playerPh = playerIds.map(() => '?').join(',');
  const hiddenCache = new Map();

  const rows = await query(
    `SELECT
       p.id AS player_id,
       p.role,
       p.shirt_number,
       p.birth_year,
       NULLIF(to_jsonb(l)->>'reference_year','')::int AS reference_year,
       l.id AS league_id,
       l.name AS league_name,
       t.id AS team_id,
       COALESCE(NULLIF(to_jsonb(t)->>'name',''), NULLIF(t.name,''), '') AS team_name,
       COALESCE(NULLIF(to_jsonb(t)->>'logo_path',''), NULLIF(t.logo_path, ''), '') AS team_logo_path
     FROM players p
     INNER JOIN teams t ON t.id = p.team_id
     INNER JOIN leagues l ON l.id = t.league_id
     WHERE p.id IN (${playerPh})`,
    playerIds
  );

  const visibleRows = [];
  for (const row of rows || []) {
    const leagueId = Number(row.league_id || 0);
    if (!leagueId) continue;
    const excluded = await isLeagueExcludedFromPlayerOverview(leagueId, hiddenCache);
    if (!excluded) visibleRows.push(row);
  }

  return visibleRows;
}

function sortEditionsByYearDesc(rows) {
  return [...rows].sort((a, b) => {
    const ay = Number(a.reference_year);
    const by = Number(b.reference_year);
    const aValid = Number.isFinite(ay);
    const bValid = Number.isFinite(by);
    if (aValid && bValid && ay !== by) return by - ay;
    if (aValid && !bValid) return -1;
    if (!aValid && bValid) return 1;
    return Number(b.league_id || 0) - Number(a.league_id || 0);
  });
}

function parseBirthYear(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function resolveBirthYear(editions) {
  const sorted = sortEditionsByYearDesc(editions);
  for (const row of sorted) {
    const birthYear = parseBirthYear(row.birth_year);
    if (birthYear) return birthYear;
  }
  return null;
}

function buildPlayerOverviewPayload(editions, hasCluster, editionsPlayed) {
  const sorted = sortEditionsByYearDesc(editions);
  const latest = sorted[0];
  const visibleEditions = Number(editionsPlayed) || 0;

  if (!latest) {
    return {
      has_cluster: hasCluster,
      editions_played: visibleEditions,
      birth_year: null,
      role: null,
      shirt_number: null,
      team: null,
    };
  }

  const shirtRaw = latest.shirt_number;
  const shirtNumber = shirtRaw == null || shirtRaw === '' ? null : Number(shirtRaw);

  return {
    has_cluster: hasCluster,
    editions_played: visibleEditions,
    birth_year: resolveBirthYear(sorted),
    role: String(latest.role || '').trim().toUpperCase() || null,
    shirt_number: Number.isFinite(shirtNumber) ? shirtNumber : null,
    team: {
      id: Number(latest.team_id) || null,
      name: String(latest.team_name || '').trim() || null,
      logo_path: String(latest.team_logo_path || '').trim() || null,
    },
  };
}

router.get('/:playerId/overview/:leagueId', authenticateToken, async (req, res) => {
  try {
    const playerId = Number(req.params.playerId);
    const leagueId = Number(req.params.leagueId);
    if (!playerId || !leagueId) return res.status(400).json({ message: 'Parametri non validi' });

    const playerRows = await query(
      `SELECT id FROM players WHERE id = ? LIMIT 1`,
      [playerId]
    );
    if (!playerRows.length) return res.status(404).json({ message: 'Giocatore non trovato' });

    const groupId = await resolveOfficialGroupId(leagueId);
    logOverview('request_start', {
      playerId,
      leagueId,
      resolvedGroupId: groupId,
    });

    const clusterDiagnostics = await fetchClusterDiagnostics(playerId);
    logOverview('cluster_diagnostics', {
      playerId,
      clusters: clusterDiagnostics,
    });

    const clusterContext = await fetchClusterContext(playerId, groupId);
    const visibility = await countVisibleClusterMembers(clusterContext.playerIds);
    const editions = await fetchPlayerEditionRows(clusterContext.playerIds);

    logOverview('edition_rows', {
      playerId,
      requestedPlayerIds: clusterContext.playerIds,
      editionRowsCount: editions.length,
      editionRows: (editions || []).map((row) => ({
        player_id: Number(row.player_id) || null,
        league_id: Number(row.league_id) || null,
        reference_year: Number(row.reference_year) || null,
        team_name: String(row.team_name || '').trim() || null,
      })),
    });

    const overview = buildPlayerOverviewPayload(
      editions,
      clusterContext.hasCluster,
      visibility.visibleCount
    );

    logOverview('response_summary', {
      playerId,
      leagueId,
      clusterLookup: clusterContext.lookup || null,
      clusterId: clusterContext.clusterId,
      clusterPlayersCount: clusterContext.playerIds.length,
      clusterPlayerIds: clusterContext.playerIds,
      visibleEditionsCount: visibility.visibleCount,
      editionsPlayed: overview.editions_played,
      hasCluster: overview.has_cluster,
    });

    return res.json({
      overview,
      meta: {
        cluster_id: clusterContext.clusterId,
        cluster_players_count: clusterContext.playerIds.length,
        visible_editions_count: visibility.visibleCount,
        official_group_id: clusterContext.groupId,
        cluster_lookup: clusterContext.lookup || null,
        cluster_diagnostics: clusterDiagnostics,
        member_visibility: visibility.memberDetails,
      },
    });
  } catch (error) {
    logOverview('request_error', {
      playerId: Number(req.params.playerId) || null,
      leagueId: Number(req.params.leagueId) || null,
      error: error.message,
    });
    return res.status(500).json({ message: 'Errore caricamento panoramica giocatore', error: error.message });
  }
});

router.get('/:playerId/stats/:leagueId', authenticateToken, async (req, res) => {
  try {
    const playerId = Number(req.params.playerId);
    const leagueId = Number(req.params.leagueId);
    if (!playerId || !leagueId) return res.status(400).json({ message: 'Parametri non validi' });

    const playerRows = await query(
      `SELECT id, first_name, last_name, role, rating, COALESCE(photo_path, '') AS photo_path
       FROM players
       WHERE id = ?
       LIMIT 1`,
      [playerId]
    );
    if (!playerRows.length) return res.status(404).json({ message: 'Giocatore non trovato' });

    const leagueIds = await resolveLeagueIdsForRatings(leagueId);
    const stats = await fetchPlayerStatsAggregates([playerId], leagueIds);

    return res.json({
      player: {
        id: Number(playerRows[0].id),
        first_name: playerRows[0].first_name,
        last_name: playerRows[0].last_name,
        role: playerRows[0].role,
        rating: safeNumber(playerRows[0].rating),
        photo_path: playerRows[0].photo_path || '',
      },
      stats,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento statistiche giocatore', error: error.message });
  }
});

router.get('/:playerId/stats/aggregated/:leagueId', authenticateToken, async (req, res) => {
  try {
    const playerId = Number(req.params.playerId);
    const leagueId = Number(req.params.leagueId);
    if (!playerId || !leagueId) return res.status(400).json({ message: 'Parametri non validi' });

    const leagueMetaRows = await query(
      `SELECT id, linked_to_league_id, COALESCE(is_official, 0) AS is_official, official_group_id
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [leagueId]
    );
    const leagueMeta = leagueMetaRows[0];
    if (!leagueMeta) return res.status(404).json({ message: 'Lega non trovata' });

    let groupId = leagueMeta.official_group_id ? Number(leagueMeta.official_group_id) : null;
    if (!groupId && Number(leagueMeta.linked_to_league_id || 0) > 0) {
      const linkedMeta = await getLeagueOfficialMeta(Number(leagueMeta.linked_to_league_id));
      groupId = linkedMeta?.official_group_id ? Number(linkedMeta.official_group_id) : null;
    }
    if (!groupId) {
      return res.status(404).json({ message: 'Statistiche aggregate non disponibili per questa lega' });
    }

    const playerRows = await query(
      `SELECT id, first_name, last_name, role, rating, COALESCE(photo_path, '') AS photo_path
       FROM players
       WHERE id = ?
       LIMIT 1`,
      [playerId]
    );
    if (!playerRows.length) return res.status(404).json({ message: 'Giocatore non trovato' });
    const basePlayer = playerRows[0];

    const groupLeagueRows = await query(
      `SELECT id
       FROM leagues
       WHERE official_group_id = ?
         AND COALESCE(is_official, 0) = 1
         AND COALESCE(is_official_squad_public, 0) = 1`,
      [groupId]
    );
    const groupLeagueIds = groupLeagueRows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    if (!groupLeagueIds.length) {
      return res.status(404).json({ message: 'Statistiche aggregate non disponibili per questo gruppo ufficiale' });
    }

    const clusterRows = await query(
      `SELECT DISTINCT pcm2.player_id
       FROM player_clusters pc
       JOIN player_cluster_members pcm1 ON pcm1.cluster_id = pc.id
       JOIN player_cluster_members pcm2 ON pcm2.cluster_id = pc.id
       WHERE pc.official_group_id = ?
         AND pc.status = 'approved'
         AND pcm1.player_id = ?`,
      [groupId, playerId]
    );
    const aggregatedPlayerIds = clusterRows.map((r) => Number(r.player_id)).filter((n) => Number.isFinite(n) && n > 0);

    if (aggregatedPlayerIds.length < 2) {
      return res.status(404).json({ message: 'Giocatore non associato a un cluster' });
    }

    const stats = await fetchPlayerStatsAggregates(aggregatedPlayerIds, groupLeagueIds);

    let bestPhoto = basePlayer.photo_path || '';
    if (!bestPhoto && aggregatedPlayerIds.length > 1) {
      try {
        const photoRows = await query(
          `SELECT p.photo_path
           FROM players p
           JOIN teams t ON t.id = p.team_id
           JOIN leagues l ON l.id = t.league_id
           WHERE p.id IN (${aggregatedPlayerIds.map(() => '?').join(',')})
             AND COALESCE(p.photo_path, '') != ''
           ORDER BY l.name DESC
           LIMIT 1`,
          aggregatedPlayerIds
        );
        if (photoRows.length > 0) bestPhoto = photoRows[0].photo_path || '';
      } catch (_) {}
    }

    return res.json({
      player: {
        id: Number(basePlayer.id),
        first_name: basePlayer.first_name,
        last_name: basePlayer.last_name,
        role: basePlayer.role,
        rating: safeNumber(basePlayer.rating),
        photo_path: bestPhoto,
      },
      stats,
      meta: {
        official_group_id: groupId,
        leagues_count: groupLeagueIds.length,
        players_count: aggregatedPlayerIds.length,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento statistiche aggregate', error: error.message });
  }
});

module.exports = router;

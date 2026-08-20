const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { computePlayerOfficialTrophies, computePlayerOfficialTrophyWinsByLeague } = require('../utils/officialHallTrophies');
const { SQL_WHERE_PRESENCE_VOTE } = require('../utils/voteRating');
const {
  tallyOfficialMatchEventScores,
  resolveOfficialMatchOutcome,
} = require('../utils/officialMatchOutcome');
const {
  BONUS_SCORE_SQL,
  safeNumber,
  fetchPlayerFantaStats,
  fetchPlayerAnalytics,
} = require('../utils/playerStatsQueries');

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

async function resolveAggregatedPlayerContext(playerId, leagueId) {
  const leagueMetaRows = await query(
    `SELECT id, linked_to_league_id, COALESCE(is_official, 0) AS is_official, official_group_id
     FROM leagues
     WHERE id = ?
     LIMIT 1`,
    [leagueId]
  );
  const leagueMeta = leagueMetaRows[0];
  if (!leagueMeta) return { error: { status: 404, message: 'Lega non trovata' } };

  let groupId = leagueMeta.official_group_id ? Number(leagueMeta.official_group_id) : null;
  if (!groupId && Number(leagueMeta.linked_to_league_id || 0) > 0) {
    const linkedMeta = await getLeagueOfficialMeta(Number(leagueMeta.linked_to_league_id));
    groupId = linkedMeta?.official_group_id ? Number(linkedMeta.official_group_id) : null;
  }
  if (!groupId) {
    return { error: { status: 404, message: 'Statistiche aggregate non disponibili per questa lega' } };
  }

  const playerRows = await query(
    `SELECT id, first_name, last_name, role, rating, COALESCE(photo_path, '') AS photo_path
     FROM players
     WHERE id = ?
     LIMIT 1`,
    [playerId]
  );
  if (!playerRows.length) return { error: { status: 404, message: 'Giocatore non trovato' } };
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
    return { error: { status: 404, message: 'Statistiche aggregate non disponibili per questo gruppo ufficiale' } };
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
    return { error: { status: 404, message: 'Giocatore non associato a un cluster' } };
  }

  let bestPhoto = basePlayer.photo_path || '';
  if (!bestPhoto) {
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

  return {
    player: {
      id: Number(basePlayer.id),
      first_name: basePlayer.first_name,
      last_name: basePlayer.last_name,
      role: basePlayer.role,
      rating: safeNumber(basePlayer.rating),
      photo_path: bestPhoto,
    },
    aggregatedPlayerIds,
    groupLeagueIds,
    meta: {
      official_group_id: groupId,
      leagues_count: groupLeagueIds.length,
      players_count: aggregatedPlayerIds.length,
    },
  };
}

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
      // Zone ufficiali / player / compare: conta solo "Pubblicata" (rosa/stats).
      if (Number(row.is_official_squad_public || 0) === 0) {
        excluded = true;
      }
      break;
    }

    if (Number(row.is_hidden_from_discovery || 0) === 1) {
      excluded = true;
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
  if (!playerIds.length) return 0;

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

  let visibleCount = 0;

  for (const member of members) {
    const leagueId = Number(member.league_id || 0);
    const hasLeague = Number.isFinite(leagueId) && leagueId > 0;
    const excluded = hasLeague ? !!hiddenCache.get(leagueId) : true;

    if (hasLeague && !excluded) visibleCount += 1;
  }

  return visibleCount;
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
       p.rating,
       NULLIF(to_jsonb(l)->>'reference_year','')::int AS reference_year,
       l.id AS league_id,
       l.name AS league_name,
       l.official_group_id AS competition_id,
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
  const uniqueLeagueIds = [
    ...new Set(
      (rows || [])
        .map((row) => Number(row.league_id || 0))
        .filter((leagueId) => Number.isFinite(leagueId) && leagueId > 0),
    ),
  ];

  await Promise.all(
    uniqueLeagueIds.map((leagueId) => isLeagueExcludedFromPlayerOverview(leagueId, hiddenCache)),
  );

  for (const row of rows || []) {
    const leagueId = Number(row.league_id || 0);
    if (!leagueId) continue;
    if (!hiddenCache.get(leagueId)) visibleRows.push(row);
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

function resolveRankInLeaderboard(rows, clusterPlayerIds) {
  const idSet = new Set(
    (clusterPlayerIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0),
  );
  if (!idSet.size) return null;

  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;

  let lastScore = null;
  let currentRank = 0;

  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    const score = Number(row?.value || 0);
    if (i === 0 || score !== lastScore) {
      currentRank = i + 1;
      lastScore = score;
    }
    const rowPlayerId = Number(row?.player_id);
    if (rowPlayerId > 0 && idSet.has(rowPlayerId)) {
      return currentRank;
    }
  }

  return null;
}

async function fetchPlayerAbsoluteOverviewRanks(groupId, clusterPlayerIds) {
  const empty = { appearances_rank: null, goals_rank: null };
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0 || !clusterPlayerIds?.length) {
    return empty;
  }

  try {
    const {
      fetchClusterAbsoluteRanksFromStore,
      isOfficialGroupAbsoluteStatsStoreAvailable,
    } = require('../utils/officialGroupAbsoluteStatsStore');
    const {
      scheduleOfficialGroupAbsoluteStatsRefresh,
    } = require('../utils/officialGroupAbsoluteStatsRefresh');

    if (await isOfficialGroupAbsoluteStatsStoreAvailable()) {
      const stored = await fetchClusterAbsoluteRanksFromStore(gid, clusterPlayerIds);
      if (stored.found) {
        return stored.ranks;
      }
    }

    const { officialGroupStatsApi } = require('./matches');
    const listOfficialGroupSeasonLeagues = officialGroupStatsApi?.listOfficialGroupSeasonLeagues;
    const computeOfficialGroupSeasonStats = officialGroupStatsApi?.computeOfficialGroupSeasonStats;
    if (!listOfficialGroupSeasonLeagues || !computeOfficialGroupSeasonStats) {
      return empty;
    }

    const seasonLeagues = await listOfficialGroupSeasonLeagues(gid);
    const leagueIds = [
      ...new Set(
        (seasonLeagues || [])
          .map((row) => Number(row.league_id))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];
    if (!leagueIds.length) return empty;

    const stats = await computeOfficialGroupSeasonStats(gid, leagueIds, true, {
      leaderboards: ['scorers', 'presences'],
    });
    const ranks = {
      appearances_rank: resolveRankInLeaderboard(stats?.presences, clusterPlayerIds),
      goals_rank: resolveRankInLeaderboard(stats?.scorers, clusterPlayerIds),
    };

    void scheduleOfficialGroupAbsoluteStatsRefresh(gid).catch(() => {});

    return ranks;
  } catch (_) {
    return empty;
  }
}

function mapEditionRow(row) {
  const year = Number(row.reference_year);
  return {
    reference_year: Number.isFinite(year) && year > 0 ? Math.trunc(year) : null,
    league_id: Number(row.league_id) || null,
    player_id: Number(row.player_id) || null,
    team_name: String(row.team_name || '').trim() || null,
    league_name: String(row.league_name || '').trim() || null,
  };
}

async function fetchPlayerCareerHistory(playerId, leagueId) {
  const groupId = await resolveOfficialGroupId(leagueId);
  const clusterContext = await fetchClusterContext(playerId, groupId);
  const editions = await fetchPlayerEditionRows(clusterContext.playerIds);
  const sorted = sortEditionsByYearDesc(editions);
  const trophiesByLeague = groupId
    ? await computePlayerOfficialTrophyWinsByLeague(groupId, editions)
    : new Map();

  return Promise.all(
    sorted.map(async (row) => {
      const editionPlayerId = Number(row.player_id);
      const editionLeagueId = Number(row.league_id);
      const leagueIds = editionLeagueId
        ? await resolveLeagueIdsForRatings(editionLeagueId)
        : [];
      const stats = await fetchPlayerStatsAggregates(
        editionPlayerId ? [editionPlayerId] : [],
        leagueIds,
      );

      const refYear = Number(row.reference_year);
      const hasYear = Number.isFinite(refYear) && refYear > 0;
      const trophyWin = editionLeagueId > 0
        ? (trophiesByLeague.get(editionLeagueId) || null)
        : null;

      return {
        team_id: Number(row.team_id) || null,
        team_name: String(row.team_name || '').trim() || null,
        team_logo_path: String(row.team_logo_path || '').trim() || null,
        competition_id: Number(row.competition_id) || null,
        reference_year: hasYear ? Math.trunc(refYear) : null,
        appearances: Number(stats.games_played || 0),
        goals: Number(stats.total_goals || 0),
        assists: Number(stats.total_assists || 0),
        player_id: editionPlayerId || null,
        league_id: editionLeagueId || null,
        won_championship: !!trophyWin?.championship,
        won_wine_trophy: !!trophyWin?.wine,
      };
    }),
  );
}

function buildPlayerOverviewPayload(editions, hasCluster, editionsPlayed, trophies = null) {
  const sorted = sortEditionsByYearDesc(editions);
  const latest = sorted[0];
  const visibleEditions = Number(editionsPlayed) || 0;
  const trophyCounts = trophies || { championships: 0, wine_trophies: 0 };
  const editionPayload = sorted.map(mapEditionRow);

  if (!latest) {
    return {
      has_cluster: hasCluster,
      editions_played: visibleEditions,
      birth_year: null,
      role: null,
      shirt_number: null,
      team: null,
      trophies: trophyCounts,
      editions: editionPayload,
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
    trophies: trophyCounts,
    editions: editionPayload,
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

    const clusterContext = await fetchClusterContext(playerId, groupId);
    const [editionsPlayed, editions] = await Promise.all([
      countVisibleClusterMembers(clusterContext.playerIds),
      fetchPlayerEditionRows(clusterContext.playerIds),
    ]);
    const trophies = groupId
      ? await computePlayerOfficialTrophies(groupId, editions)
      : { championships: 0, wine_trophies: 0 };

    const overview = buildPlayerOverviewPayload(
      editions,
      clusterContext.hasCluster,
      editionsPlayed,
      trophies
    );

    return res.json({ overview });
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento panoramica giocatore', error: error.message });
  }
});

router.get('/:playerId/absolute-ranks/:leagueId', authenticateToken, async (req, res) => {
  try {
    const playerId = Number(req.params.playerId);
    const leagueId = Number(req.params.leagueId);
    if (!playerId || !leagueId) return res.status(400).json({ message: 'Parametri non validi' });

    const playerRows = await query(
      `SELECT id FROM players WHERE id = ? LIMIT 1`,
      [playerId],
    );
    if (!playerRows.length) return res.status(404).json({ message: 'Giocatore non trovato' });

    const groupId = await resolveOfficialGroupId(leagueId);
    if (!groupId) {
      return res.json({ absolute_ranks: { appearances_rank: null, goals_rank: null } });
    }

    const clusterContext = await fetchClusterContext(playerId, groupId);
    const absoluteRanks = await fetchPlayerAbsoluteOverviewRanks(groupId, clusterContext.playerIds);
    return res.json({ absolute_ranks: absoluteRanks });
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento ranking assoluto giocatore', error: error.message });
  }
});

router.get('/:playerId/career/:leagueId', authenticateToken, async (req, res) => {
  try {
    const playerId = Number(req.params.playerId);
    const leagueId = Number(req.params.leagueId);
    if (!playerId || !leagueId) return res.status(400).json({ message: 'Parametri non validi' });

    const playerRows = await query(
      `SELECT id FROM players WHERE id = ? LIMIT 1`,
      [playerId],
    );
    if (!playerRows.length) return res.status(404).json({ message: 'Giocatore non trovato' });

    const career = await fetchPlayerCareerHistory(playerId, leagueId);
    return res.json({ career });
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento carriera giocatore', error: error.message });
  }
});

router.get('/:playerId/fanta-stats/aggregated/:leagueId', authenticateToken, async (req, res) => {
  try {
    const playerId = Number(req.params.playerId);
    const leagueId = Number(req.params.leagueId);
    if (!playerId || !leagueId) return res.status(400).json({ message: 'Parametri non validi' });

    const context = await resolveAggregatedPlayerContext(playerId, leagueId);
    if (context.error) return res.status(context.error.status).json({ message: context.error.message });

    const stats = await fetchPlayerFantaStats(context.aggregatedPlayerIds, context.groupLeagueIds);
    return res.json({ player: context.player, stats, meta: context.meta });
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento statistiche fanta aggregate', error: error.message });
  }
});

router.get('/:playerId/fanta-stats/:leagueId', authenticateToken, async (req, res) => {
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
    const stats = await fetchPlayerFantaStats([playerId], leagueIds);

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
    return res.status(500).json({ message: 'Errore caricamento statistiche fanta giocatore', error: error.message });
  }
});

router.get('/:playerId/analytics/aggregated/:leagueId', authenticateToken, async (req, res) => {
  try {
    const playerId = Number(req.params.playerId);
    const leagueId = Number(req.params.leagueId);
    if (!playerId || !leagueId) return res.status(400).json({ message: 'Parametri non validi' });

    const context = await resolveAggregatedPlayerContext(playerId, leagueId);
    if (context.error) return res.status(context.error.status).json({ message: context.error.message });

    const analytics = await fetchPlayerAnalytics(
      context.aggregatedPlayerIds,
      context.groupLeagueIds,
      context.player.role
    );
    return res.json({ analytics, meta: context.meta });
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento analisi aggregate', error: error.message });
  }
});

router.get('/:playerId/analytics/:leagueId', authenticateToken, async (req, res) => {
  try {
    const playerId = Number(req.params.playerId);
    const leagueId = Number(req.params.leagueId);
    if (!playerId || !leagueId) return res.status(400).json({ message: 'Parametri non validi' });

    const playerRows = await query(
      `SELECT id, role FROM players WHERE id = ? LIMIT 1`,
      [playerId]
    );
    if (!playerRows.length) return res.status(404).json({ message: 'Giocatore non trovato' });

    const leagueIds = await resolveLeagueIdsForRatings(leagueId);
    const analytics = await fetchPlayerAnalytics([playerId], leagueIds, playerRows[0].role);
    return res.json({ analytics });
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento analisi giocatore', error: error.message });
  }
});

router.get('/:playerId/stats/aggregated/:leagueId', authenticateToken, async (req, res) => {
  try {
    const playerId = Number(req.params.playerId);
    const leagueId = Number(req.params.leagueId);
    if (!playerId || !leagueId) return res.status(400).json({ message: 'Parametri non validi' });

    const context = await resolveAggregatedPlayerContext(playerId, leagueId);
    if (context.error) return res.status(context.error.status).json({ message: context.error.message });

    const stats = await fetchPlayerStatsAggregates(context.aggregatedPlayerIds, context.groupLeagueIds);
    return res.json({ player: context.player, stats, meta: context.meta });
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento statistiche aggregate', error: error.message });
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

async function resolveCompareLeagueIds(groupId, editionRows, fallbackLeagueId) {
  if (groupId) {
    const groupLeagueRows = await query(
      `SELECT id
       FROM leagues
       WHERE official_group_id = ?
         AND COALESCE(is_official, 0) = 1
         AND COALESCE(is_official_squad_public, 0) = 1`,
      [groupId],
    );
    const ids = (groupLeagueRows || [])
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length) return [...new Set(ids)];
  }

  const fromEditions = (editionRows || [])
    .map((row) => Number(row.league_id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (fromEditions.length) return [...new Set(fromEditions)];

  return resolveLeagueIdsForRatings(fallbackLeagueId);
}

async function fetchPlayerPenaltyGoals(playerIds) {
  const ids = [...new Set((playerIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return 0;
  const ph = ids.map(() => '?').join(',');
  try {
    const rows = await query(
      `SELECT COUNT(*)::int AS total
       FROM official_match_events e
       INNER JOIN official_matches m ON m.id = e.match_id
       WHERE e.event_type = 'penalty_goal'
         AND e.player_id IN (${ph})
         AND EXISTS (
           SELECT 1
           FROM leagues pub_l
           WHERE pub_l.id = COALESCE(
             NULLIF(m.league_id, 0),
             (SELECT ht.league_id FROM teams ht WHERE ht.id = m.home_team_id LIMIT 1)
           )
             AND COALESCE(pub_l.is_official, 0) = 1
             AND COALESCE(pub_l.is_official_squad_public, 0) = 1
         )`,
      ids,
    );
    return Number(rows[0]?.total || 0);
  } catch (_) {
    return 0;
  }
}

/** Partite vinte: presenza (voto/S.V.) su squadra vincitrice, esito ufficiale (eventi + rigori). */
async function fetchPlayerMatchWins(playerIds, leagueIds) {
  const pids = [...new Set((playerIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  const lids = [...new Set((leagueIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!pids.length || !lids.length) return 0;

  const playerPh = pids.map(() => '?').join(',');
  const leaguesPh = lids.map(() => '?').join(',');
  try {
    // 1) Presenze del giocatore collegate a partite ufficiali (stessa giornata/squadra)
    const linkedRows = await query(
      `WITH presence AS (
         SELECT DISTINCT
           pr.league_id,
           pr.giornata,
           p.team_id
         FROM player_ratings pr
         INNER JOIN players p ON p.id = pr.player_id
         WHERE pr.player_id IN (${playerPh})
           AND pr.league_id IN (${leaguesPh})
           AND ${SQL_WHERE_PRESENCE_VOTE}
       )
       SELECT DISTINCT
         l.official_match_id AS match_id,
         l.team_id
       FROM presence
       INNER JOIN official_match_matchday_links l
         ON l.giornata = presence.giornata
        AND l.team_id = presence.team_id
        AND (
          l.league_id = presence.league_id
          OR l.league_id IN (${leaguesPh})
        )`,
      [...pids, ...lids, ...lids],
    );

    const teamsByMatch = new Map();
    for (const row of linkedRows || []) {
      const mid = Number(row.match_id);
      const tid = Number(row.team_id);
      if (!Number.isFinite(mid) || mid <= 0 || !Number.isFinite(tid) || tid <= 0) continue;
      if (!teamsByMatch.has(mid)) teamsByMatch.set(mid, new Set());
      teamsByMatch.get(mid).add(tid);
    }

    const matchIds = [...teamsByMatch.keys()];
    if (!matchIds.length) return 0;

    const matchPh = matchIds.map(() => '?').join(',');
    const [matchRows, eventRows, endedRows] = await Promise.all([
      query(
        `SELECT id, home_team_id, away_team_id, home_score, away_score
         FROM official_matches
         WHERE id IN (${matchPh})`,
        matchIds,
      ),
      query(
        `SELECT match_id, event_type, team_side, team_id
         FROM official_match_events
         WHERE match_id IN (${matchPh})`,
        matchIds,
      ),
      query(
        `SELECT DISTINCT match_id
         FROM official_match_events
         WHERE match_id IN (${matchPh})
           AND event_type = 'match_end'`,
        matchIds,
      ),
    ]);

    const eventsByMatch = new Map();
    for (const ev of eventRows || []) {
      const mid = Number(ev.match_id);
      if (!eventsByMatch.has(mid)) eventsByMatch.set(mid, []);
      eventsByMatch.get(mid).push(ev);
    }
    const endedMatchIds = new Set(
      (endedRows || []).map((r) => Number(r.match_id)).filter((id) => id > 0),
    );

    let wins = 0;
    for (const m of matchRows || []) {
      const mid = Number(m.id);
      const playerTeams = teamsByMatch.get(mid);
      if (!playerTeams || !playerTeams.size) continue;

      const homeId = Number(m.home_team_id);
      const awayId = Number(m.away_team_id);
      const events = eventsByMatch.get(mid) || [];
      const tallied = tallyOfficialMatchEventScores(events, homeId, awayId);

      let hs = null;
      let as = null;
      if (tallied.hasGoalEvents) {
        hs = Number(tallied.homeGoals) || 0;
        as = Number(tallied.awayGoals) || 0;
      } else {
        const hSet = m.home_score != null && m.home_score !== '';
        const aSet = m.away_score != null && m.away_score !== '';
        if (hSet && aSet) {
          const home = Number(m.home_score);
          const away = Number(m.away_score);
          if (Number.isFinite(home) && Number.isFinite(away)) {
            hs = home;
            as = away;
          }
        } else if (endedMatchIds.has(mid)) {
          hs = hSet && Number.isFinite(Number(m.home_score)) ? Number(m.home_score) : 0;
          as = aSet && Number.isFinite(Number(m.away_score)) ? Number(m.away_score) : 0;
        }
      }

      if (hs == null && (tallied.hasRigEvents || tallied.hasPreEvents)) hs = 0;
      if (as == null && (tallied.hasRigEvents || tallied.hasPreEvents)) as = 0;
      if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;

      const outcome = resolveOfficialMatchOutcome({
        regHome: hs,
        regAway: as,
        preHome: tallied.homePreShootout,
        preAway: tallied.awayPreShootout,
        rigHome: tallied.homeRig,
        rigAway: tallied.awayRig,
        hasRig: tallied.hasRigEvents,
      });

      let winnerTeamId = null;
      if (outcome.home > outcome.away) winnerTeamId = homeId;
      else if (outcome.away > outcome.home) winnerTeamId = awayId;
      if (winnerTeamId && playerTeams.has(winnerTeamId)) wins += 1;
    }

    return wins;
  } catch (_) {
    return 0;
  }
}

function buildCompareCareerTeams(editionRows) {
  const seen = new Set();
  const teams = [];
  for (const row of sortEditionsByYearDesc(editionRows || [])) {
    const teamId = Number(row.team_id) || 0;
    const name = String(row.team_name || '').trim();
    const logoPath = String(row.team_logo_path || '').trim();
    const logoKey = logoPath.toLowerCase();
    // Un solo logo per club: priorità al path logo (stessa maglia in edizioni diverse)
    const key = logoKey
      ? `logo:${logoKey}`
      : (teamId > 0 ? `id:${teamId}` : `name:${name.toLowerCase()}`);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    teams.push({
      team_id: teamId > 0 ? teamId : null,
      name,
      logo_path: logoPath || null,
    });
  }
  return teams;
}

function buildCompareRoles(editionRows) {
  const order = ['P', 'D', 'C', 'A'];
  const found = new Set();
  for (const row of editionRows || []) {
    const role = String(row.role || '').trim().toUpperCase();
    if (order.includes(role)) found.add(role);
  }
  return order.filter((role) => found.has(role));
}

/** Valore di mercato (= rating): base = lega più recente del gruppo; assente → 0 e missing. */
function resolveCompareMarketValueStats(editionRows, latestReferenceYear) {
  const rows = Array.isArray(editionRows) ? editionRows : [];
  const targetYear = Number(latestReferenceYear);

  let marketValue = null;
  let marketValueMissing = true;
  if (Number.isFinite(targetYear) && targetYear > 0) {
    const inLatest = rows.find((row) => Number(row.reference_year) === targetYear);
    if (inLatest) {
      const n = Number(inLatest.rating);
      if (Number.isFinite(n)) {
        marketValue = n;
        marketValueMissing = false;
      }
    }
  }

  let peakValue = null;
  let peakYear = null;
  for (const row of sortEditionsByYearDesc(rows)) {
    const n = Number(row.rating);
    if (!Number.isFinite(n)) continue;
    if (peakValue == null || n > peakValue) {
      peakValue = n;
      const y = Number(row.reference_year);
      peakYear = Number.isFinite(y) && y > 0 ? Math.trunc(y) : null;
    }
  }

  return {
    market_value: safeNumber(marketValue ?? 0, 2),
    market_value_missing: marketValueMissing,
    peak_market_value: safeNumber(peakValue ?? 0, 2),
    peak_market_value_year: peakYear,
  };
}

async function resolveGroupLatestReferenceYear(groupId, leagueIds = []) {
  try {
    if (groupId) {
      const rows = await query(
        `SELECT MAX(NULLIF(to_jsonb(l)->>'reference_year','')::int) AS max_year
         FROM leagues l
         WHERE l.official_group_id = ?
           AND COALESCE(is_official, 0) = 1
           AND COALESCE(is_official_squad_public, 0) = 1`,
        [groupId],
      );
      const y = Number(rows?.[0]?.max_year);
      if (Number.isFinite(y) && y > 0) return Math.trunc(y);
    }

    const lids = [...new Set((leagueIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
    if (lids.length) {
      const ph = lids.map(() => '?').join(',');
      const rows = await query(
        `SELECT MAX(NULLIF(to_jsonb(l)->>'reference_year','')::int) AS max_year
         FROM leagues l
         WHERE l.id IN (${ph})`,
        lids,
      );
      const y = Number(rows?.[0]?.max_year);
      if (Number.isFinite(y) && y > 0) return Math.trunc(y);
    }
  } catch (_) {
    // ignore
  }
  return null;
}

async function buildPlayerCompareProfile(playerId, leagueId) {
  const playerRows = await query(
    `SELECT id, first_name, last_name, role, COALESCE(photo_path, '') AS photo_path
     FROM players
     WHERE id = ?
     LIMIT 1`,
    [playerId],
  );
  if (!playerRows.length) {
    return { error: { status: 404, message: 'Giocatore non trovato' } };
  }

  const basePlayer = playerRows[0];
  const groupId = await resolveOfficialGroupId(leagueId);
  const clusterContext = await fetchClusterContext(playerId, groupId);
  const playerIds = clusterContext.playerIds.length
    ? clusterContext.playerIds
    : [playerId];

  const [editionsPlayed, editions] = await Promise.all([
    countVisibleClusterMembers(playerIds),
    fetchPlayerEditionRows(playerIds),
  ]);

  const leagueIds = await resolveCompareLeagueIds(groupId, editions, leagueId);
  const latestReferenceYear = await resolveGroupLatestReferenceYear(groupId, leagueIds);
  const primaryRole = String(
    sortEditionsByYearDesc(editions)[0]?.role || basePlayer.role || '',
  ).trim().toUpperCase() || null;

  const [analytics, fantaStats, trophies, matchWins, penaltyGoals, photoRows, groupNameRows] = await Promise.all([
    fetchPlayerAnalytics(playerIds, leagueIds, primaryRole || ''),
    fetchPlayerFantaStats(playerIds, leagueIds),
    groupId
      ? computePlayerOfficialTrophies(groupId, editions)
      : Promise.resolve({ championships: 0, wine_trophies: 0 }),
    fetchPlayerMatchWins(playerIds, leagueIds),
    fetchPlayerPenaltyGoals(playerIds),
    !String(basePlayer.photo_path || '').trim()
      ? query(
        `SELECT p.photo_path
         FROM players p
         JOIN teams t ON t.id = p.team_id
         JOIN leagues l ON l.id = t.league_id
         WHERE p.id IN (${playerIds.map(() => '?').join(',')})
           AND COALESCE(p.photo_path, '') != ''
         ORDER BY NULLIF(to_jsonb(l)->>'reference_year','')::int DESC NULLS LAST, l.id DESC
         LIMIT 1`,
        playerIds,
      ).catch(() => [])
      : Promise.resolve([]),
    groupId
      ? query(
        `SELECT name FROM official_league_groups WHERE id = ? LIMIT 1`,
        [groupId],
      ).catch(() => [])
      : Promise.resolve([]),
  ]);

  const photoPath = String(basePlayer.photo_path || '').trim()
    || String(photoRows?.[0]?.photo_path || '').trim()
    || '';

  const totals = analytics?.totals || {};
  const championships = Number(trophies?.championships || 0);
  const wineTrophies = Number(trophies?.wine_trophies || 0);
  const competitionName = String(groupNameRows?.[0]?.name || '').trim() || null;
  const marketStats = resolveCompareMarketValueStats(editions, latestReferenceYear);

  return {
    profile: {
      player: {
        player_id: Number(basePlayer.id),
        league_id: Number(leagueId),
        first_name: String(basePlayer.first_name || '').trim(),
        last_name: String(basePlayer.last_name || '').trim(),
        name: `${String(basePlayer.first_name || '').trim()} ${String(basePlayer.last_name || '').trim()}`.trim(),
        photo_path: photoPath || null,
        role: primaryRole,
        birth_year: resolveBirthYear(editions),
      },
      career_teams: buildCompareCareerTeams(editions),
      roles_played: buildCompareRoles(editions),
      competition_name: competitionName,
      stats: {
        market_value: marketStats.market_value,
        market_value_missing: Boolean(marketStats.market_value_missing),
        peak_market_value: marketStats.peak_market_value,
        peak_market_value_year: marketStats.peak_market_value_year,
        editions_played: Number(editionsPlayed || 0),
        appearances: Number(totals.games_played || 0),
        wins: Number(matchWins || 0),
        trophies: championships + wineTrophies,
        championships,
        wine_trophies: wineTrophies,
        goals: Number(totals.total_goals || 0),
        assists: Number(totals.total_assists || 0),
        yellow_cards: Number(totals.total_yellow_cards || 0),
        red_cards: Number(totals.total_red_cards || 0),
        penalty_goals: Number(penaltyGoals || 0),
        penalty_missed: Number(totals.total_penalty_missed || 0),
        penalty_saved: Number(totals.total_penalty_saved || 0),
        clean_sheets: Number(totals.total_clean_sheets || 0),
        mvp: Number(totals.total_briso || 0),
        avg_rating: safeNumber(fantaStats?.avg_rating, 2),
      },
    },
  };
}

router.get('/:playerId/compare/:leagueId', authenticateToken, async (req, res) => {
  try {
    const playerId = Number(req.params.playerId);
    const leagueId = Number(req.params.leagueId);
    if (!playerId || !leagueId) return res.status(400).json({ message: 'Parametri non validi' });

    const result = await buildPlayerCompareProfile(playerId, leagueId);
    if (result.error) return res.status(result.error.status).json({ message: result.error.message });
    return res.json(result.profile);
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento confronto giocatore', error: error.message });
  }
});

module.exports = router;

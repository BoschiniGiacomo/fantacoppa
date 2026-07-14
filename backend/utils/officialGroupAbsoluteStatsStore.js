const { query } = require('../config/database');

const TABLE = 'official_group_cluster_absolute_stats';

let tableReadyPromise = null;

async function ensureOfficialGroupAbsoluteStatsTable() {
  if (!tableReadyPromise) {
    tableReadyPromise = query(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        official_group_id INTEGER NOT NULL,
        cluster_id INTEGER NOT NULL,
        representative_player_id INTEGER,
        total_goals INTEGER NOT NULL DEFAULT 0,
        total_presences INTEGER NOT NULL DEFAULT 0,
        refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (official_group_id, cluster_id)
      )
    `).then(() => query(`
      CREATE INDEX IF NOT EXISTS idx_ogcas_group_presences
        ON ${TABLE} (official_group_id, total_presences DESC)
    `)).then(() => query(`
      CREATE INDEX IF NOT EXISTS idx_ogcas_group_goals
        ON ${TABLE} (official_group_id, total_goals DESC)
    `)).catch((error) => {
      tableReadyPromise = null;
      throw error;
    });
  }
  await tableReadyPromise;
  return true;
}

async function isOfficialGroupAbsoluteStatsStoreAvailable() {
  try {
    await ensureOfficialGroupAbsoluteStatsTable();
    return true;
  } catch (_) {
    return false;
  }
}

async function fetchClusterIdForPlayers(groupId, playerIds) {
  const ids = [...new Set((playerIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return new Map();

  const ph = ids.map(() => '?').join(', ');
  const rows = await query(
    `SELECT pcm.player_id, pcm.cluster_id
     FROM player_cluster_members pcm
     INNER JOIN player_clusters pc ON pc.id = pcm.cluster_id
     WHERE pc.official_group_id = ?
       AND pc.status = 'approved'
       AND pcm.player_id IN (${ph})`,
    [groupId, ...ids],
  );

  const map = new Map();
  for (const row of rows || []) {
    const pid = Number(row.player_id);
    const cid = Number(row.cluster_id);
    if (pid > 0 && cid > 0) map.set(pid, cid);
  }
  return map;
}

async function upsertLeaderboardsSnapshot(groupId, stats) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return { upserted: 0 };

  await ensureOfficialGroupAbsoluteStatsTable();

  const scorers = Array.isArray(stats?.scorers) ? stats.scorers : [];
  const presences = Array.isArray(stats?.presences) ? stats.presences : [];
  const playerIds = [
    ...scorers.map((row) => Number(row.player_id)),
    ...presences.map((row) => Number(row.player_id)),
  ];
  const clusterByPlayer = await fetchClusterIdForPlayers(gid, playerIds);

  const byCluster = new Map();
  for (const row of scorers) {
    const pid = Number(row.player_id);
    const clusterId = clusterByPlayer.get(pid);
    if (!clusterId) continue;
    const prev = byCluster.get(clusterId) || {
      total_goals: 0,
      total_presences: 0,
      representative_player_id: pid > 0 ? pid : null,
    };
    prev.total_goals = Number(row.value) || 0;
    if (pid > 0) prev.representative_player_id = pid;
    byCluster.set(clusterId, prev);
  }

  for (const row of presences) {
    const pid = Number(row.player_id);
    const clusterId = clusterByPlayer.get(pid);
    if (!clusterId) continue;
    const prev = byCluster.get(clusterId) || {
      total_goals: 0,
      total_presences: 0,
      representative_player_id: pid > 0 ? pid : null,
    };
    prev.total_presences = Number(row.value) || 0;
    if (pid > 0 && !prev.representative_player_id) prev.representative_player_id = pid;
    byCluster.set(clusterId, prev);
  }

  await query(
    `DELETE FROM ${TABLE} WHERE official_group_id = ?`,
    [gid],
  );

  let upserted = 0;
  for (const [clusterId, row] of byCluster.entries()) {
    await query(
      `INSERT INTO ${TABLE} (
         official_group_id, cluster_id, representative_player_id,
         total_goals, total_presences, refreshed_at
       ) VALUES (?, ?, ?, ?, ?, NOW())`,
      [
        gid,
        Number(clusterId),
        row.representative_player_id,
        Number(row.total_goals) || 0,
        Number(row.total_presences) || 0,
      ],
    );
    upserted += 1;
  }

  return { upserted };
}

async function hasOfficialGroupSnapshot(groupId) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return false;

  try {
    await ensureOfficialGroupAbsoluteStatsTable();
    const rows = await query(
      `SELECT COUNT(*)::int AS row_count
       FROM ${TABLE}
       WHERE official_group_id = ?`,
      [gid],
    );
    return Number(rows[0]?.row_count || 0) > 0;
  } catch (_) {
    return false;
  }
}

async function fetchSnapshotRefreshedAt(groupId) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return null;

  try {
    await ensureOfficialGroupAbsoluteStatsTable();
    const rows = await query(
      `SELECT MAX(refreshed_at) AS refreshed_at
       FROM ${TABLE}
       WHERE official_group_id = ?`,
      [gid],
    );
    return rows[0]?.refreshed_at || null;
  } catch (_) {
    return null;
  }
}

async function fetchClusterAbsoluteRanksFromStore(groupId, clusterPlayerIds) {
  const gid = Number(groupId);
  const playerIds = [...new Set((clusterPlayerIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!gid || !playerIds.length) {
    return { found: false, ranks: { appearances_rank: null, goals_rank: null }, refreshed_at: null };
  }

  const hasSnapshot = await hasOfficialGroupSnapshot(gid);
  if (!hasSnapshot) {
    return { found: false, ranks: { appearances_rank: null, goals_rank: null }, refreshed_at: null };
  }

  const rows = await query(
    `WITH ranked AS (
       SELECT
         cluster_id,
         RANK() OVER (ORDER BY total_presences DESC, cluster_id ASC) AS appearances_rank,
         RANK() OVER (ORDER BY total_goals DESC, cluster_id ASC) AS goals_rank
       FROM ${TABLE}
       WHERE official_group_id = ?
         AND (total_presences > 0 OR total_goals > 0)
     ),
     target AS (
       SELECT DISTINCT pcm.cluster_id
       FROM player_cluster_members pcm
       INNER JOIN player_clusters pc ON pc.id = pcm.cluster_id
       WHERE pc.official_group_id = ?
         AND pc.status = 'approved'
         AND pcm.player_id = ANY(?)
     )
     SELECT r.appearances_rank, r.goals_rank
     FROM ranked r
     INNER JOIN target t ON t.cluster_id = r.cluster_id
     LIMIT 1`,
    [gid, gid, playerIds],
  );

  if (!rows.length) {
    return { found: false, ranks: { appearances_rank: null, goals_rank: null }, refreshed_at: null };
  }

  const appearancesRank = Number(rows[0].appearances_rank);
  const goalsRank = Number(rows[0].goals_rank);
  const refreshedAt = await fetchSnapshotRefreshedAt(gid);

  return {
    found: true,
    refreshed_at: refreshedAt,
    ranks: {
      appearances_rank: Number.isFinite(appearancesRank) && appearancesRank > 0 ? appearancesRank : null,
      goals_rank: Number.isFinite(goalsRank) && goalsRank > 0 ? goalsRank : null,
    },
  };
}

async function refreshOfficialGroupAbsoluteStatsStore(groupId, stats) {
  const t0 = Date.now();
  const result = await upsertLeaderboardsSnapshot(groupId, stats);
  console.log(
    `[PERF][officialGroupAbsoluteStatsStore] refresh groupId=${groupId} rows=${result.upserted} TOTAL=${Date.now() - t0}ms`
  );
  return result;
}

async function recomputeAndStoreOfficialGroupAbsoluteStats(groupId) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return { upserted: 0 };

  const { officialGroupStatsApi } = require('../routes/matches');
  const listOfficialGroupSeasonLeagues = officialGroupStatsApi?.listOfficialGroupSeasonLeagues;
  const computeOfficialGroupSeasonStats = officialGroupStatsApi?.computeOfficialGroupSeasonStats;
  if (!listOfficialGroupSeasonLeagues || !computeOfficialGroupSeasonStats) {
    throw new Error('officialGroupStatsApi non disponibile');
  }

  const seasonLeagues = await listOfficialGroupSeasonLeagues(gid);
  const leagueIds = [
    ...new Set(
      (seasonLeagues || [])
        .map((row) => Number(row.league_id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  if (!leagueIds.length) return { upserted: 0 };

  const stats = await computeOfficialGroupSeasonStats(gid, leagueIds, true, {
    leaderboards: ['scorers', 'presences'],
  });
  return refreshOfficialGroupAbsoluteStatsStore(gid, stats);
}

module.exports = {
  ensureOfficialGroupAbsoluteStatsTable,
  isOfficialGroupAbsoluteStatsStoreAvailable,
  hasOfficialGroupSnapshot,
  fetchSnapshotRefreshedAt,
  fetchClusterAbsoluteRanksFromStore,
  refreshOfficialGroupAbsoluteStatsStore,
  recomputeAndStoreOfficialGroupAbsoluteStats,
};

const { query } = require('../config/database');

const TABLE = 'official_group_cluster_absolute_stats';

let tableReadyPromise = null;

/** Entity id nello store: cluster reale, oppure -player_id per i player senza cluster. */
function absoluteEntityIdForPlayer(clusterId, playerId) {
  const cid = Number(clusterId);
  if (Number.isFinite(cid) && cid > 0) return cid;
  const pid = Number(playerId);
  if (Number.isFinite(pid) && pid > 0) return -pid;
  return null;
}

function rankByDescendingValue(rows, getValue, targetEntityIds) {
  const target = new Set(
    [...(targetEntityIds || [])].map(Number).filter((id) => Number.isFinite(id)),
  );
  if (!target.size) return null;

  const list = (rows || [])
    .map((row) => ({
      entityId: Number(row.cluster_id),
      value: Number(getValue(row) || 0),
    }))
    .filter((row) => Number.isFinite(row.entityId) && row.value > 0)
    .sort((a, b) => b.value - a.value || a.entityId - b.entityId);

  if (!list.length) return null;

  let lastScore = null;
  let currentRank = 0;
  for (let i = 0; i < list.length; i += 1) {
    const score = list[i].value;
    if (i === 0 || score !== lastScore) {
      currentRank = i + 1;
      lastScore = score;
    }
    if (target.has(list[i].entityId)) return currentRank;
  }
  return null;
}

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

  const byEntity = new Map();
  for (const row of scorers) {
    const pid = Number(row.player_id);
    const entityId = absoluteEntityIdForPlayer(clusterByPlayer.get(pid), pid);
    if (!entityId) continue;
    const prev = byEntity.get(entityId) || {
      total_goals: 0,
      total_presences: 0,
      representative_player_id: pid > 0 ? pid : null,
    };
    prev.total_goals = Number(row.value) || 0;
    if (pid > 0) prev.representative_player_id = pid;
    byEntity.set(entityId, prev);
  }

  for (const row of presences) {
    const pid = Number(row.player_id);
    const entityId = absoluteEntityIdForPlayer(clusterByPlayer.get(pid), pid);
    if (!entityId) continue;
    const prev = byEntity.get(entityId) || {
      total_goals: 0,
      total_presences: 0,
      representative_player_id: pid > 0 ? pid : null,
    };
    prev.total_presences = Number(row.value) || 0;
    if (pid > 0 && !prev.representative_player_id) prev.representative_player_id = pid;
    byEntity.set(entityId, prev);
  }

  await query(
    `DELETE FROM ${TABLE} WHERE official_group_id = ?`,
    [gid],
  );

  const entries = [...byEntity.entries()];
  if (!entries.length) return { upserted: 0 };

  const CHUNK_SIZE = 150;
  let upserted = 0;
  for (let offset = 0; offset < entries.length; offset += CHUNK_SIZE) {
    const chunk = entries.slice(offset, offset + CHUNK_SIZE);
    const params = [];
    const valueParts = chunk.map(([entityId, row]) => {
      params.push(
        gid,
        Number(entityId),
        row.representative_player_id,
        Number(row.total_goals) || 0,
        Number(row.total_presences) || 0,
      );
      return '(?, ?, ?, ?, ?, NOW())';
    });

    await query(
      `INSERT INTO ${TABLE} (
         official_group_id, cluster_id, representative_player_id,
         total_goals, total_presences, refreshed_at
       ) VALUES ${valueParts.join(', ')}`,
      params,
    );
    upserted += chunk.length;
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
  const empty = { found: false, ranks: { appearances_rank: null, goals_rank: null }, refreshed_at: null };
  const gid = Number(groupId);
  const playerIds = [...new Set((clusterPlayerIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!gid || !playerIds.length) return empty;

  const hasSnapshot = await hasOfficialGroupSnapshot(gid);
  if (!hasSnapshot) return empty;

  const clusterByPlayer = await fetchClusterIdForPlayers(gid, playerIds);
  const targetEntityIds = [
    ...new Set(
      playerIds
        .map((pid) => absoluteEntityIdForPlayer(clusterByPlayer.get(pid), pid))
        .filter((id) => id != null),
    ),
  ];
  if (!targetEntityIds.length) return empty;

  const rows = await query(
    `SELECT cluster_id, representative_player_id, total_goals, total_presences
     FROM ${TABLE}
     WHERE official_group_id = ?`,
    [gid],
  );
  if (!rows?.length) return empty;

  const targetSet = new Set(targetEntityIds.map(Number));
  const playerSet = new Set(playerIds);
  // Match per entity id (cluster o -player_id) oppure representative_player_id.
  const matched = (rows || []).filter((row) => {
    const entityId = Number(row.cluster_id);
    const repId = Number(row.representative_player_id);
    return targetSet.has(entityId) || (repId > 0 && playerSet.has(repId));
  });
  if (!matched.length) return empty;

  const matchedEntityIds = matched.map((row) => Number(row.cluster_id));

  const appearancesRank = rankByDescendingValue(rows, (r) => r.total_presences, matchedEntityIds);
  const goalsRank = rankByDescendingValue(rows, (r) => r.total_goals, matchedEntityIds);
  const refreshedAt = await fetchSnapshotRefreshedAt(gid);

  return {
    found: appearancesRank != null || goalsRank != null,
    refreshed_at: refreshedAt,
    ranks: {
      appearances_rank: appearancesRank,
      goals_rank: goalsRank,
    },
  };
}

async function refreshOfficialGroupAbsoluteStatsStore(groupId, stats) {
  return upsertLeaderboardsSnapshot(groupId, stats);
}

async function recomputeAndStoreOfficialGroupAbsoluteStats(groupId) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return { upserted: 0 };

  const matchesMod = require('../routes/matches');
  const officialGroupStatsApi = matchesMod.officialGroupStatsApi || matchesMod;
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

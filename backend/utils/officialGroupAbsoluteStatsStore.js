const { query } = require('../config/database');

const TABLE = 'official_group_cluster_absolute_stats';

/** Bump quando cambia la logica di aggregazione (es. teams_count per squadra ufficiale). */
const ABSOLUTE_STATS_LOGIC_VERSION = 2;
const logicRefreshDone = new Set(); // groupId già ricalcolato per questa versione di processo

let tableReadyPromise = null;
const packCache = new Map(); // groupId -> { expiresAt, payload, logicVersion }
const PACK_CACHE_TTL_MS = 3 * 60 * 1000;

/** Entity id nello store: cluster reale, oppure -player_id per i player senza cluster. */
function absoluteEntityIdForPlayer(clusterId, playerId) {
  const cid = Number(clusterId);
  if (Number.isFinite(cid) && cid > 0) return cid;
  const pid = Number(playerId);
  if (Number.isFinite(pid) && pid > 0) return -pid;
  return null;
}

function stripBirthYearNameSuffix(name) {
  return String(name || '')
    .replace(/\s*\(\s*'\d{2}\s*\)\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chiave squadra ufficiale: stesso club tra edizioni (es. "Scampate 2018" ≈ "Scampate 2019").
 */
function normalizeOfficialTeamKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+(19|20)\d{2}$/u, '')
    .trim();
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

async function ensureColumn(sql) {
  try {
    await query(sql);
  } catch (_) {
    // colonna già presente o ALTER non supportato in questo ambiente
  }
}

async function ensureOfficialGroupAbsoluteStatsTable() {
  if (!tableReadyPromise) {
    tableReadyPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          official_group_id INTEGER NOT NULL,
          cluster_id INTEGER NOT NULL,
          representative_player_id INTEGER,
          total_goals INTEGER NOT NULL DEFAULT 0,
          total_presences INTEGER NOT NULL DEFAULT 0,
          total_trophies INTEGER NOT NULL DEFAULT 0,
          editions_played INTEGER NOT NULL DEFAULT 0,
          teams_count INTEGER NOT NULL DEFAULT 0,
          display_name TEXT,
          photo_path TEXT,
          refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (official_group_id, cluster_id)
        )
      `);
      await ensureColumn(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS total_trophies INTEGER NOT NULL DEFAULT 0`);
      await ensureColumn(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS editions_played INTEGER NOT NULL DEFAULT 0`);
      await ensureColumn(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS teams_count INTEGER NOT NULL DEFAULT 0`);
      await ensureColumn(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS display_name TEXT`);
      await ensureColumn(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS photo_path TEXT`);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_ogcas_group_presences
          ON ${TABLE} (official_group_id, total_presences DESC)
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_ogcas_group_goals
          ON ${TABLE} (official_group_id, total_goals DESC)
      `);
    })().catch((error) => {
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

function emptyEntity(pid) {
  return {
    total_goals: 0,
    total_presences: 0,
    total_trophies: 0,
    editions_played: 0,
    teams_count: 0,
    display_name: null,
    photo_path: null,
    representative_player_id: pid > 0 ? pid : null,
  };
}

async function fetchEditionAndTeamCountsByPlayer(groupId) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return [];

  return query(
    `SELECT
       p.id AS player_id,
       TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, ''))) AS name,
       NULLIF(TRIM(COALESCE(p.photo_path, '')), '') AS photo_path,
       COUNT(DISTINCT t.league_id)::int AS editions_played,
       COUNT(DISTINCT p.team_id)::int AS teams_count
     FROM players p
     INNER JOIN teams t ON t.id = p.team_id
     INNER JOIN leagues l ON l.id = t.league_id
     WHERE l.official_group_id = ?
       AND COALESCE(l.is_official, 0) = 1
       AND COALESCE(l.is_official_squad_public, 0) = 1
     GROUP BY p.id, p.first_name, p.last_name, p.photo_path`,
    [gid],
  );
}

/**
 * Edizioni / squadre a livello entity (cluster o -player_id):
 * - editions = numero di rosa/player-id nel gruppo ufficiale pubblico
 * - teams = squadre ufficiali distinte (nome senza anno di edizione)
 */
async function fetchEntityEditionAndTeamCounts(groupId) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return [];

  const rows = await query(
    `SELECT
       CASE
         WHEN pc.id IS NOT NULL THEN pc.id
         ELSE -p.id
       END AS entity_id,
       p.id AS player_id,
       COALESCE(NULLIF(to_jsonb(t)->>'name',''), NULLIF(t.name,''), '') AS team_name,
       t.id AS team_id
     FROM players p
     INNER JOIN teams t ON t.id = p.team_id
     INNER JOIN leagues l ON l.id = t.league_id
     LEFT JOIN player_cluster_members pcm ON pcm.player_id = p.id
     LEFT JOIN player_clusters pc
       ON pc.id = pcm.cluster_id
      AND pc.official_group_id = ?
      AND pc.status = 'approved'
     WHERE l.official_group_id = ?
       AND COALESCE(l.is_official, 0) = 1
       AND COALESCE(l.is_official_squad_public, 0) = 1`,
    [gid, gid],
  );

  const byEntity = new Map();
  for (const row of rows || []) {
    const entityId = Number(row.entity_id);
    if (!Number.isFinite(entityId) || entityId === 0) continue;
    let entry = byEntity.get(entityId);
    if (!entry) {
      entry = {
        entity_id: entityId,
        playerIds: new Set(),
        teamKeys: new Set(),
        representative_player_id: null,
      };
      byEntity.set(entityId, entry);
    }
    const pid = Number(row.player_id);
    if (pid > 0) {
      entry.playerIds.add(pid);
      if (!entry.representative_player_id || pid < entry.representative_player_id) {
        entry.representative_player_id = pid;
      }
    }
    const teamKey = normalizeOfficialTeamKey(row.team_name);
    if (teamKey) {
      entry.teamKeys.add(teamKey);
    } else {
      const tid = Number(row.team_id);
      if (tid > 0) entry.teamKeys.add(`id:${tid}`);
    }
  }

  return [...byEntity.values()].map((entry) => ({
    entity_id: entry.entity_id,
    editions_played: entry.playerIds.size,
    teams_count: entry.teamKeys.size,
    representative_player_id: entry.representative_player_id,
  }));
}

async function upsertLeaderboardsSnapshot(groupId, stats) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return { upserted: 0 };

  await ensureOfficialGroupAbsoluteStatsTable();

  const scorers = Array.isArray(stats?.scorers) ? stats.scorers : [];
  const presentces = Array.isArray(stats?.presences) ? stats.presences : [];
  const editionWins = Array.isArray(stats?.edition_wins) ? stats.edition_wins : [];
  const playerMetaRows = Array.isArray(stats?.player_meta) ? stats.player_meta : [];

  const playerIds = [
    ...scorers.map((row) => Number(row.player_id)),
    ...presentces.map((row) => Number(row.player_id)),
    ...editionWins.map((row) => Number(row.player_id)),
    ...playerMetaRows.map((row) => Number(row.player_id)),
  ];
  const clusterByPlayer = await fetchClusterIdForPlayers(gid, playerIds);

  const byEntity = new Map();

  const touch = (pid, mutate) => {
    const entityId = absoluteEntityIdForPlayer(clusterByPlayer.get(pid), pid);
    if (!entityId) return;
    const prev = byEntity.get(entityId) || emptyEntity(pid);
    mutate(prev, pid);
    byEntity.set(entityId, prev);
  };

  for (const row of scorers) {
    const pid = Number(row.player_id);
    touch(pid, (prev) => {
      prev.total_goals = Number(row.value) || 0;
      if (pid > 0) prev.representative_player_id = pid;
      const name = stripBirthYearNameSuffix(row.name);
      if (name) prev.display_name = name;
      if (row.photo_path) prev.photo_path = String(row.photo_path);
    });
  }

  for (const row of presentces) {
    const pid = Number(row.player_id);
    touch(pid, (prev) => {
      prev.total_presences = Number(row.value) || 0;
      if (pid > 0 && !prev.representative_player_id) prev.representative_player_id = pid;
      const name = stripBirthYearNameSuffix(row.name);
      if (name && !prev.display_name) prev.display_name = name;
      if (row.photo_path && !prev.photo_path) prev.photo_path = String(row.photo_path);
    });
  }

  for (const row of editionWins) {
    const pid = Number(row.player_id);
    touch(pid, (prev) => {
      // edition_wins leaderboard = trofei (edizioni vinte con presenza)
      prev.total_trophies = Number(row.value) || 0;
      if (pid > 0 && !prev.representative_player_id) prev.representative_player_id = pid;
      const name = stripBirthYearNameSuffix(row.name);
      if (name && !prev.display_name) prev.display_name = name;
    });
  }

  // editions_played / teams_count: conteggio entity-level (cluster union), come overview giocatore
  const entityCounts = await fetchEntityEditionAndTeamCounts(gid);
  for (const row of entityCounts || []) {
    const entityId = Number(row.entity_id);
    if (!Number.isFinite(entityId) || entityId === 0) continue;
    const prev = byEntity.get(entityId) || emptyEntity(Number(row.representative_player_id) || 0);
    prev.editions_played = Number(row.editions_played) || 0;
    prev.teams_count = Number(row.teams_count) || 0;
    const repId = Number(row.representative_player_id);
    if (repId > 0 && !prev.representative_player_id) prev.representative_player_id = repId;
    byEntity.set(entityId, prev);
  }

  // Fallback: se manca il conteggio entity, usa max/union da player_meta
  for (const row of playerMetaRows) {
    const pid = Number(row.player_id);
    const entityId = absoluteEntityIdForPlayer(clusterByPlayer.get(pid), pid);
    if (!entityId) continue;
    const prev = byEntity.get(entityId) || emptyEntity(pid);
    if (pid > 0 && !prev.representative_player_id) prev.representative_player_id = pid;
    const name = stripBirthYearNameSuffix(row.name);
    if (name && !prev.display_name) prev.display_name = name;
    if (row.photo_path && !prev.photo_path) prev.photo_path = String(row.photo_path);

    if (!(Number(prev.editions_played) > 0)) {
      const ep = Number(row.editions_played) || 0;
      if (ep > 0) prev.editions_played = Math.max(Number(prev.editions_played) || 0, ep);
    }
    if (!(Number(prev.teams_count) > 0)) {
      const tc = Number(row.teams_count) || 0;
      if (tc > 0) prev.teams_count = Math.max(Number(prev.teams_count) || 0, tc);
    }
    byEntity.set(entityId, prev);
  }

  await query(
    `DELETE FROM ${TABLE} WHERE official_group_id = ?`,
    [gid],
  );

  const entries = [...byEntity.entries()];
  if (!entries.length) {
    packCache.delete(gid);
    return { upserted: 0 };
  }

  const CHUNK_SIZE = 100;
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
        Number(row.total_trophies) || 0,
        Number(row.editions_played) || 0,
        Number(row.teams_count) || 0,
        row.display_name || null,
        row.photo_path || null,
      );
      return '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())';
    });

    await query(
      `INSERT INTO ${TABLE} (
         official_group_id, cluster_id, representative_player_id,
         total_goals, total_presences, total_trophies, editions_played, teams_count,
         display_name, photo_path, refreshed_at
       ) VALUES ${valueParts.join(', ')}`,
      params,
    );
    upserted += chunk.length;
  }

  packCache.delete(gid);
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

async function buildPlayerMetaForGroup(groupId) {
  const rows = await fetchEditionAndTeamCountsByPlayer(groupId);
  // Passiamo anche league_ids/team_ids per union a livello cluster
  const detailed = await query(
    `SELECT
       p.id AS player_id,
       t.league_id,
       p.team_id,
       TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, ''))) AS name,
       NULLIF(TRIM(COALESCE(p.photo_path, '')), '') AS photo_path
     FROM players p
     INNER JOIN teams t ON t.id = p.team_id
     INNER JOIN leagues l ON l.id = t.league_id
     WHERE l.official_group_id = ?
       AND COALESCE(l.is_official, 0) = 1
       AND COALESCE(l.is_official_squad_public, 0) = 1`,
    [groupId],
  );

  const byPlayer = new Map();
  for (const row of rows || []) {
    const pid = Number(row.player_id);
    if (!(pid > 0)) continue;
    byPlayer.set(pid, {
      player_id: pid,
      name: row.name,
      photo_path: row.photo_path || null,
      editions_played: Number(row.editions_played) || 0,
      teams_count: Number(row.teams_count) || 0,
      league_ids: [],
      team_ids: [],
    });
  }
  for (const row of detailed || []) {
    const pid = Number(row.player_id);
    if (!(pid > 0)) continue;
    let entry = byPlayer.get(pid);
    if (!entry) {
      entry = {
        player_id: pid,
        name: row.name,
        photo_path: row.photo_path || null,
        editions_played: 0,
        teams_count: 0,
        league_ids: [],
        team_ids: [],
      };
      byPlayer.set(pid, entry);
    }
    const lid = Number(row.league_id);
    const tid = Number(row.team_id);
    if (lid > 0) entry.league_ids.push(lid);
    if (tid > 0) entry.team_ids.push(tid);
    if (row.photo_path && !entry.photo_path) entry.photo_path = row.photo_path;
  }
  return [...byPlayer.values()];
}

async function recomputeAndStoreOfficialGroupAbsoluteStats(groupId) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return { upserted: 0 };

  const matchesMod = require('../routes/matches');
  const officialGroupStatsApi = matchesMod.officialGroupStatsApi || matchesMod;
  const listOfficialGroupSeasonLeagues = officialGroupStatsApi?.listOfficialGroupSeasonLeagues;
  const computeOfficialGroupSeasonStats = officialGroupStatsApi?.computeOfficialGroupSeasonStats;
  const fetchOfficialGroupEditionWinLeaderboard = officialGroupStatsApi?.fetchOfficialGroupEditionWinLeaderboard;
  const mergeAbsoluteStatsByCluster = officialGroupStatsApi?.mergeAbsoluteStatsByCluster;
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

  const [stats, player_meta] = await Promise.all([
    computeOfficialGroupSeasonStats(gid, leagueIds, true, {
      leaderboards: ['scorers', 'presences'],
    }),
    buildPlayerMetaForGroup(gid),
  ]);

  let edition_wins = [];
  if (typeof fetchOfficialGroupEditionWinLeaderboard === 'function'
    && typeof mergeAbsoluteStatsByCluster === 'function') {
    try {
      const raw = await fetchOfficialGroupEditionWinLeaderboard(gid, leagueIds);
      edition_wins = await mergeAbsoluteStatsByCluster(raw, gid);
    } catch (error) {
      console.error('[OfficialGroupAbsoluteStats] edition_wins failed:', error?.message || error);
    }
  }

  return refreshOfficialGroupAbsoluteStatsStore(gid, {
    ...stats,
    edition_wins,
    player_meta,
  });
}

async function fetchHigherLowerPackFromStore(groupId) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) {
    return { group_id: gid, refreshed_at: null, players: [] };
  }

  const cached = packCache.get(gid);
  if (
    cached
    && cached.logicVersion === ABSOLUTE_STATS_LOGIC_VERSION
    && cached.expiresAt > Date.now()
  ) {
    const cachedPlayers = cached.payload?.players || [];
    const cachedLooksStale = cachedPlayers.some((p) =>
      ((Number(p.goals) || 0) + (Number(p.appearances) || 0) > 0)
      && (Number(p.editions_played) || 0) === 0
    ) && cachedPlayers.every((p) => (Number(p.editions_played) || 0) === 0);
    if (!cachedLooksStale) {
      return cached.payload;
    }
    packCache.delete(gid);
  }

  await ensureOfficialGroupAbsoluteStatsTable();
  let rows = await query(
    `SELECT cluster_id, representative_player_id, total_goals, total_presences,
            COALESCE(total_trophies, 0) AS total_trophies,
            COALESCE(editions_played, 0) AS editions_played,
            COALESCE(teams_count, 0) AS teams_count,
            display_name, photo_path, refreshed_at
     FROM ${TABLE}
     WHERE official_group_id = ?`,
    [gid],
  );

  const snapshotLooksStale = (list) => {
    if (!list?.length) return true;
    let activity = 0;
    let maxEditions = 0;
    for (const row of list) {
      activity += (Number(row.total_goals) || 0) + (Number(row.total_presences) || 0);
      maxEditions = Math.max(maxEditions, Number(row.editions_played) || 0);
    }
    // Snapshot pre-fix: gol/presenze presenti ma edizioni tutte a 0
    return activity > 0 && maxEditions === 0;
  };

  const needLogicRefresh = !logicRefreshDone.has(gid);
  if (needLogicRefresh || snapshotLooksStale(rows)) {
    await recomputeAndStoreOfficialGroupAbsoluteStats(gid);
    logicRefreshDone.add(gid);
    rows = await query(
      `SELECT cluster_id, representative_player_id, total_goals, total_presences,
              COALESCE(total_trophies, 0) AS total_trophies,
              COALESCE(editions_played, 0) AS editions_played,
              COALESCE(teams_count, 0) AS teams_count,
              display_name, photo_path, refreshed_at
       FROM ${TABLE}
       WHERE official_group_id = ?`,
      [gid],
    );
  }

  // Completa nome/foto se mancanti
  const missingIds = (rows || [])
    .filter((r) => !r.display_name || !r.photo_path)
    .map((r) => Number(r.representative_player_id))
    .filter((id) => id > 0);
  const nameById = new Map();
  if (missingIds.length) {
    const ph = [...new Set(missingIds)].map(() => '?').join(', ');
    const nameRows = await query(
      `SELECT id,
              TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS name,
              NULLIF(TRIM(COALESCE(photo_path, '')), '') AS photo_path
       FROM players
       WHERE id IN (${ph})`,
      [...new Set(missingIds)],
    );
    for (const r of nameRows || []) {
      nameById.set(Number(r.id), {
        name: stripBirthYearNameSuffix(r.name),
        photo_path: r.photo_path || null,
      });
    }
  }

  let refreshedAt = null;
  const players = [];
  for (const row of rows || []) {
    const entityId = Number(row.cluster_id);
    const playerId = Number(row.representative_player_id) || null;
    const meta = playerId ? nameById.get(playerId) : null;
    const name = stripBirthYearNameSuffix(row.display_name) || meta?.name || '';
    if (!name) continue;
    const goals = Number(row.total_goals) || 0;
    const appearances = Number(row.total_presences) || 0;
    const trophies = Number(row.total_trophies) || 0;
    const editionsPlayed = Number(row.editions_played) || 0;
    const teamsCount = Number(row.teams_count) || 0;
    if (goals + appearances + trophies + editionsPlayed + teamsCount <= 0) continue;

    if (!refreshedAt && row.refreshed_at) refreshedAt = row.refreshed_at;
    players.push({
      entity_id: entityId,
      player_id: playerId,
      name,
      photo_path: row.photo_path || meta?.photo_path || null,
      goals,
      appearances,
      trophies,
      editions_played: editionsPlayed,
      teams_count: teamsCount,
    });
  }

  const payload = {
    group_id: gid,
    refreshed_at: refreshedAt,
    players,
  };
  packCache.set(gid, {
    expiresAt: Date.now() + PACK_CACHE_TTL_MS,
    logicVersion: ABSOLUTE_STATS_LOGIC_VERSION,
    payload,
  });
  return payload;
}

module.exports = {
  ensureOfficialGroupAbsoluteStatsTable,
  isOfficialGroupAbsoluteStatsStoreAvailable,
  hasOfficialGroupSnapshot,
  fetchSnapshotRefreshedAt,
  fetchClusterAbsoluteRanksFromStore,
  refreshOfficialGroupAbsoluteStatsStore,
  recomputeAndStoreOfficialGroupAbsoluteStats,
  fetchHigherLowerPackFromStore,
  absoluteEntityIdForPlayer,
};

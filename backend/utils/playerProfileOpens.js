/**
 * Contatori leggeri aperture scheda giocatore (trending 30gg).
 * - daily aggregates + dedupe 1/user/player/giorno
 * - purge automatico oltre 30 giorni
 */
const { query } = require('../config/database');
const { createShortTtlCache } = require('./shortTtlCache');

const RETENTION_DAYS = 30;
const TRENDING_LIMIT = 3;
const TRENDING_CACHE_TTL_MS = 90 * 1000;
const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000;

let schemaReady = false;
let schemaPromise = null;
let cleanupTimer = null;

const trendingCache = createShortTtlCache({ maxEntries: 64 });

function isSchemaInitRaceError(err) {
  return err && (err.code === '23505' || err.code === '42P07' || err.code === '42701');
}

function todayUtcDateStr() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeCompetitionId(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

async function ensurePlayerProfileOpensSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS player_profile_open_daily (
        day_date date NOT NULL,
        player_id int NOT NULL,
        competition_id int NOT NULL DEFAULT 0,
        cluster_id int NULL,
        opens int NOT NULL DEFAULT 0,
        PRIMARY KEY (day_date, player_id, competition_id)
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS player_profile_open_dedupe (
        day_date date NOT NULL,
        user_id int NOT NULL,
        player_id int NOT NULL,
        PRIMARY KEY (day_date, user_id, player_id)
      )
    `);
    try {
      await query(
        `CREATE INDEX IF NOT EXISTS idx_open_daily_day ON player_profile_open_daily (day_date)`
      );
      await query(
        `CREATE INDEX IF NOT EXISTS idx_open_daily_comp_day ON player_profile_open_daily (competition_id, day_date)`
      );
    } catch (err) {
      if (!isSchemaInitRaceError(err)) throw err;
    }
    schemaReady = true;
  })().catch((err) => {
    schemaPromise = null;
    throw err;
  });
  return schemaPromise;
}

async function resolvePlayerClusterId(playerId) {
  const pid = Number(playerId);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    const rows = await query(
      `SELECT pcm.cluster_id
       FROM player_cluster_members pcm
       INNER JOIN player_clusters pc ON pc.id = pcm.cluster_id
       WHERE pcm.player_id = ?
         AND COALESCE(pc.status, 'pending') = 'approved'
       ORDER BY pcm.cluster_id ASC
       LIMIT 1`,
      [pid]
    );
    const cid = Number(rows?.[0]?.cluster_id);
    return Number.isFinite(cid) && cid > 0 ? cid : null;
  } catch (_) {
    return null;
  }
}

async function purgeExpiredPlayerProfileOpens() {
  await ensurePlayerProfileOpensSchema();
  await query(
    `DELETE FROM player_profile_open_daily
     WHERE day_date < (CURRENT_DATE - (?::int))`,
    [RETENTION_DAYS]
  );
  await query(
    `DELETE FROM player_profile_open_dedupe
     WHERE day_date < (CURRENT_DATE - (?::int))`,
    [RETENTION_DAYS]
  );
}

function startPlayerProfileOpensCleanupJob() {
  if (cleanupTimer) return;
  const run = () => {
    purgeExpiredPlayerProfileOpens().catch((err) => {
      console.warn('[playerProfileOpens] cleanup failed:', err?.message || err);
    });
  };
  run();
  cleanupTimer = setInterval(run, CLEANUP_INTERVAL_MS);
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
}

/**
 * @returns {{ counted: boolean }}
 */
async function trackPlayerProfileOpen({ userId, playerId, competitionId = 0 }) {
  const uid = Number(userId);
  const pid = Number(playerId);
  const compId = normalizeCompetitionId(competitionId);
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(pid) || pid <= 0) {
    return { counted: false };
  }

  await ensurePlayerProfileOpensSchema();
  const day = todayUtcDateStr();

  const inserted = await query(
    `INSERT INTO player_profile_open_dedupe (day_date, user_id, player_id)
     VALUES (?::date, ?, ?)
     ON CONFLICT DO NOTHING
     RETURNING player_id`,
    [day, uid, pid]
  );
  if (!inserted?.affectedRows || !Array.isArray(inserted.rows) || inserted.rows.length === 0) {
    return { counted: false };
  }

  const clusterId = await resolvePlayerClusterId(pid);
  await query(
    `INSERT INTO player_profile_open_daily (day_date, player_id, competition_id, cluster_id, opens)
     VALUES (?::date, ?, ?, ?, 1)
     ON CONFLICT (day_date, player_id, competition_id) DO UPDATE SET
       opens = player_profile_open_daily.opens + 1,
       cluster_id = COALESCE(EXCLUDED.cluster_id, player_profile_open_daily.cluster_id)`,
    [day, pid, compId, clusterId]
  );

  trendingCache.clear?.();
  return { counted: true };
}

async function fetchTrendingPlayerRows(competitionIdFilter) {
  const hasComp = Number.isFinite(competitionIdFilter) && competitionIdFilter > 0;
  const params = [RETENTION_DAYS];
  let compClause = '';
  if (hasComp) {
    compClause = 'AND d.competition_id = ?';
    params.push(competitionIdFilter);
  }

  // Aggrega per cluster (o player) negli ultimi 30gg; sceglie un player_id rappresentativo.
  const aggSql = `
    WITH scored AS (
      SELECT
        COALESCE(d.cluster_id, d.player_id) AS entity_key,
        d.player_id,
        d.cluster_id,
        SUM(d.opens)::int AS player_score
      FROM player_profile_open_daily d
      WHERE d.day_date >= (CURRENT_DATE - (?::int))
        ${compClause}
      GROUP BY COALESCE(d.cluster_id, d.player_id), d.player_id, d.cluster_id
    ),
    entity_totals AS (
      SELECT entity_key, SUM(player_score)::int AS score
      FROM scored
      GROUP BY entity_key
    ),
    rep AS (
      SELECT DISTINCT ON (entity_key)
        entity_key,
        player_id,
        cluster_id
      FROM scored
      ORDER BY entity_key, player_score DESC, player_id DESC
    )
    SELECT
      r.player_id,
      r.cluster_id,
      e.score
    FROM entity_totals e
    INNER JOIN rep r ON r.entity_key = e.entity_key
    ORDER BY e.score DESC, r.player_id DESC
    LIMIT ${TRENDING_LIMIT}
  `;

  const topRows = await query(aggSql, params);
  if (!Array.isArray(topRows) || topRows.length === 0) return [];

  const playerIds = topRows
    .map((r) => Number(r.player_id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!playerIds.length) return [];

  const ph = playerIds.map(() => '?').join(', ');
  const detailRows = await query(
    `SELECT
       p.id AS player_id,
       TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, ''))) AS player_name,
       UPPER(NULLIF(TRIM(COALESCE(p.role, '')), '')) AS role,
       NULLIF(BTRIM(COALESCE(p.photo_path, '')), '') AS photo_path,
       p.team_id,
       t.name AS team_name,
       COALESCE(NULLIF(to_jsonb(t)->>'logo_path',''), NULLIF(t.logo_path,''), '') AS team_logo_path,
       t.league_id,
       l.official_group_id AS competition_id,
       og.name AS competition_name,
       l.reference_year,
       p.birth_year
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     LEFT JOIN leagues l ON l.id = t.league_id
     LEFT JOIN official_league_groups og ON og.id = l.official_group_id
     WHERE p.id IN (${ph})`,
    playerIds
  );

  const byId = new Map(
    (detailRows || []).map((r) => [Number(r.player_id), r])
  );

  return topRows
    .map((row) => {
      const pid = Number(row.player_id);
      const detail = byId.get(pid);
      if (!detail) return null;
      const name = String(detail.player_name || '').trim();
      const leagueId = Number(detail.league_id);
      if (!name || !Number.isFinite(leagueId) || leagueId <= 0) return null;
      const birthYear = Number(detail.birth_year);
      const teamLogoPath = String(detail.team_logo_path || '').trim() || null;
      return {
        player_id: pid,
        name,
        role: String(detail.role || '').trim().toUpperCase() || null,
        photo_path: String(detail.photo_path || '').trim() || null,
        team_name: String(detail.team_name || '').trim() || null,
        team_logo_path: teamLogoPath,
        league_id: leagueId,
        competition_id: Number(detail.competition_id) > 0 ? Number(detail.competition_id) : null,
        competition_name: String(detail.competition_name || '').trim() || null,
        reference_year: Number(detail.reference_year) || null,
        birth_year: Number.isFinite(birthYear) && birthYear >= 1900 ? birthYear : null,
        cluster_id: Number(row.cluster_id) > 0 ? Number(row.cluster_id) : null,
        score: Number(row.score) || 0,
      };
    })
    .filter(Boolean);
}

/**
 * @param {{ competitionId?: number|null }} [opts]
 */
async function getTrendingPlayers(opts = {}) {
  await ensurePlayerProfileOpensSchema();
  const rawComp = opts.competitionId;
  const competitionId =
    rawComp == null || rawComp === '' ? null : normalizeCompetitionId(rawComp) || null;
  const cacheKey = competitionId ? `comp:${competitionId}` : 'global';
  const cached = trendingCache.get(cacheKey);
  if (cached) return cached;

  const players = await fetchTrendingPlayerRows(competitionId);
  trendingCache.set(cacheKey, players, TRENDING_CACHE_TTL_MS);
  return players;
}

module.exports = {
  RETENTION_DAYS,
  TRENDING_LIMIT,
  ensurePlayerProfileOpensSchema,
  trackPlayerProfileOpen,
  getTrendingPlayers,
  purgeExpiredPlayerProfileOpens,
  startPlayerProfileOpensCleanupJob,
};

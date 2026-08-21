const express = require('express');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { ensureAppSettingsTable } = require('../utils/appSettingsStore');
const { ensureLeagueOfficialGironiSchema } = require('../utils/leagueOfficialGironi');
const { SQL_WHERE_PRESENCE_VOTE } = require('../utils/voteRating');
const { removePlayerPhotoVariants } = require('../utils/mediaStorageCleanup');

function isMissingDbObjectError(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function isSchemaInitRaceError(err) {
  return err && (err.code === '23505' || err.code === '42P07' || err.code === '42701');
}

let superuserTablesReady = false;
let playerClusterSchemaReady = false;
let playerClusterSchemaPromise = null;

async function runPlayerClusterSchemaMigration() {
  await query(`
    CREATE TABLE IF NOT EXISTS player_clusters (
      id SERIAL PRIMARY KEY,
      official_group_id INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      suggested_by_system SMALLINT NOT NULL DEFAULT 0,
      created_by INTEGER,
      approved_by INTEGER,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS player_cluster_members (
      cluster_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      added_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (cluster_id, player_id)
    )
  `);
  await query(`ALTER TABLE player_clusters ADD COLUMN IF NOT EXISTS approved_by INTEGER`);
  await query(`ALTER TABLE player_clusters ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`);
  await query(`ALTER TABLE player_clusters ADD COLUMN IF NOT EXISTS suggested_by_system SMALLINT NOT NULL DEFAULT 0`);
  try {
    await query(
      `CREATE INDEX IF NOT EXISTS idx_player_clusters_group_status ON player_clusters (official_group_id, status)`
    );
  } catch (err) {
    if (!isSchemaInitRaceError(err)) throw err;
  }
}

async function ensurePlayerClusterSchema() {
  if (playerClusterSchemaReady) return;
  if (!playerClusterSchemaPromise) {
    playerClusterSchemaPromise = runPlayerClusterSchemaMigration()
      .then(() => {
        playerClusterSchemaReady = true;
      })
      .catch((err) => {
        playerClusterSchemaPromise = null;
        throw err;
      });
  }
  await playerClusterSchemaPromise;
}

async function ensureSuperuserTables() {
  if (superuserTablesReady) return;
  try {
    await ensurePlayerClusterSchema();
    superuserTablesReady = true;
  } catch (_) {}
}

async function ensureOfficialGroupMenuSchema() {
  await query(`ALTER TABLE official_league_groups ADD COLUMN IF NOT EXISTS logo_path TEXT`);
  await query(
    `ALTER TABLE official_league_groups ADD COLUMN IF NOT EXISTS show_in_main_menu SMALLINT NOT NULL DEFAULT 0`
  );
}

async function requireSuperuser(req, res, next) {
  try {
    const rows = await query(`SELECT COALESCE(is_superuser, 0) AS is_superuser FROM users WHERE id = ? LIMIT 1`, [Number(req.user?.userId)]);
    const level = Number(rows[0]?.is_superuser || 0);
    if (level === 1 || level === 2) return next();
    return res.status(403).json({ message: 'Accesso non autorizzato' });
  } catch (_) {
    return res.status(403).json({ message: 'Accesso non autorizzato' });
  }
}

const appLoadingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

let supabaseStorageClient = null;
function getSupabaseStorageClient() {
  if (supabaseStorageClient) return supabaseStorageClient;
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
  const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) return null;
  supabaseStorageClient = createClient(supabaseUrl, supabaseKey);
  return supabaseStorageClient;
}

async function requireSuperuserLevel1(req, res, next) {
  try {
    const rows = await query(`SELECT COALESCE(is_superuser, 0) AS is_superuser FROM users WHERE id = ? LIMIT 1`, [
      Number(req.user?.userId),
    ]);
    const level = Number(rows[0]?.is_superuser || 0);
    if (level === 1) return next();
    return res.status(403).json({ message: 'Operazione riservata al super user (livello 1)' });
  } catch (_) {
    return res.status(403).json({ message: 'Accesso non autorizzato' });
  }
}

function guessLoadingMediaType(mimetype, originalname) {
  const n = String(originalname || '').toLowerCase();
  const m = String(mimetype || '').toLowerCase();
  if (m.startsWith('video/')) return 'video';
  if (['.mp4', '.webm', '.mov', '.m4v'].some((e) => n.endsWith(e))) return 'video';
  return 'image';
}

function allowedLoadingMime(mimetype, originalname) {
  const m = String(mimetype || '').toLowerCase();
  const n = String(originalname || '').toLowerCase();
  const okMime = ['image/gif', 'image/png', 'image/jpeg', 'video/mp4', 'video/webm', 'video/quicktime'].includes(m);
  if (okMime) return true;
  return ['.gif', '.png', '.jpg', '.jpeg', '.mp4', '.webm', '.mov', '.m4v'].some((e) => n.endsWith(e));
}

async function removeStoredLoadingMedia(supabase, relativePath) {
  if (!relativePath || !String(relativePath).startsWith('uploads/')) return;
  const storagePath = String(relativePath).replace(/^uploads\//, '');
  await supabase.storage.from('uploads').remove([storagePath]).catch(() => {});
}

async function getGroupLeagueIds(groupId) {
  const rows = await query(`SELECT id FROM leagues WHERE official_group_id = ? AND COALESCE(is_official, 0) = 1`, [groupId]);
  return rows.map((r) => Number(r.id)).filter((id) => id > 0);
}

function normalizePlayerRow(row) {
  const first = String(row.first_name || '').trim();
  const last = String(row.last_name || '').trim();
  return {
    ...row,
    full_name: `${first} ${last}`.trim(),
    name: `${first} ${last}`.trim(),
    rating: Number(row.rating || 0),
  };
}

function isValidClusterStatus(status) {
  return status === 'pending' || status === 'approved' || status === 'rejected';
}

function mapClusterPlayerRow(p) {
  if (!p || p.id == null) return null;
  const first = String(p.first_name || '').trim();
  const last = String(p.last_name || '').trim();
  return {
    id: Number(p.id),
    first_name: p.first_name,
    last_name: p.last_name,
    full_name: `${first} ${last}`.trim(),
    role: p.role || null,
    birth_year: p.birth_year != null && Number.isFinite(Number(p.birth_year))
      ? Number(p.birth_year)
      : null,
    league_id: Number(p.league_id || 0),
    league_name: p.league_name || '',
    team_name: p.team_name || '',
    reference_year: p.reference_year != null && Number.isFinite(Number(p.reference_year))
      ? Number(p.reference_year)
      : null,
  };
}

function parseClusterPlayersJson(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(mapClusterPlayerRow).filter(Boolean);
  return [];
}

function normalizePlayerBirthYear(player) {
  const y = Number(player?.birth_year);
  if (!Number.isFinite(y) || y < 1900) return null;
  const maxY = new Date().getFullYear();
  if (y > maxY) return null;
  return y;
}

function buildSuggestionLeagueEntry(player) {
  const refYear = player.reference_year != null ? Number(player.reference_year) : null;
  return {
    player_id: Number(player.id),
    league_id: Number(player.league_id),
    league_name: player.league_name || '-',
    reference_year: Number.isFinite(refYear) ? refYear : null,
    team_name: player.team_name || '-',
    role: player.role || null,
    birth_year: normalizePlayerBirthYear(player),
  };
}

function buildClusterSuggestion(fullName, players, approvedPlayerMap, rejectedPlayerIds) {
  const nonRejected = (players || []).filter((p) => !rejectedPlayerIds.has(Number(p.id)));
  if (nonRejected.length < 2) return null;

  const existingLeagues = [];
  const newLeagues = [];
  let clusterId = null;
  const rolesSet = new Set();
  const definedYears = new Set();

  for (const p of nonRejected) {
    const pid = Number(p.id);
    const birthYear = normalizePlayerBirthYear(p);
    if (birthYear != null) definedYears.add(birthYear);
    rolesSet.add(String(p.role || '').trim().toUpperCase());
    const entry = buildSuggestionLeagueEntry(p);
    if (approvedPlayerMap.has(pid)) {
      if (!clusterId) clusterId = approvedPlayerMap.get(pid);
      existingLeagues.push(entry);
    } else {
      newLeagues.push(entry);
    }
  }

  if (newLeagues.length === 0) return null;

  const missingInCluster = existingLeagues.filter((l) => l.birth_year == null);
  const missingInNew = newLeagues.filter((l) => l.birth_year == null);

  return {
    name: fullName,
    cluster_id: clusterId,
    role_changed: rolesSet.size > 1,
    birth_year: definedYears.size === 1 ? [...definedYears][0] : null,
    existing_leagues: existingLeagues,
    new_leagues: newLeagues,
    all_new_player_ids: newLeagues.map((l) => l.player_id),
    missing_birth_year_in_cluster: missingInCluster,
    missing_birth_year_new: missingInNew,
  };
}

function pickPrimaryBirthYearBucket(withYearMap, approvedPlayerMap) {
  let primaryYear = null;
  let maxCount = 0;
  for (const [year, list] of withYearMap) {
    const hasApproved = list.some((p) => approvedPlayerMap.has(Number(p.id)));
    if (hasApproved) return year;
    if (list.length > maxCount) {
      maxCount = list.length;
      primaryYear = year;
    }
  }
  return primaryYear;
}

function splitPlayersForClusterSuggestions(players, approvedPlayerMap) {
  const approvedByCluster = new Map();
  const unapproved = [];
  for (const p of players || []) {
    const pid = Number(p.id);
    const cid = approvedPlayerMap.get(pid);
    if (cid) {
      if (!approvedByCluster.has(cid)) approvedByCluster.set(cid, []);
      approvedByCluster.get(cid).push(p);
    } else {
      unapproved.push(p);
    }
  }
  return { approvedByCluster, unapproved };
}

function playerSeasonKey(player) {
  const year = Number(player?.reference_year);
  if (Number.isFinite(year)) return `y:${year}`;
  const leagueId = Number(player?.league_id);
  if (Number.isFinite(leagueId) && leagueId > 0) return `l:${leagueId}`;
  return `p:${Number(player?.id) || 0}`;
}

function bucketConflictsWithPlayer(bucket, player) {
  const seasonKey = playerSeasonKey(player);
  const leagueId = Number(player?.league_id);
  return (bucket || []).some((existing) => {
    if (playerSeasonKey(existing) === seasonKey) return true;
    const existingLeague = Number(existing?.league_id);
    return (
      Number.isFinite(leagueId)
      && leagueId > 0
      && Number.isFinite(existingLeague)
      && existingLeague === leagueId
    );
  });
}

/**
 * Omonimi (anche stesso anno di nascita) nella stessa stagione/lega = persone diverse.
 * Partiziona in bucket "persona" senza conflitti di stagione/lega.
 */
function partitionHomonymsIntoPersonBuckets(players) {
  const buckets = [];
  const sorted = [...(players || [])].sort((a, b) => (
    (Number(a.reference_year) || 0) - (Number(b.reference_year) || 0)
    || (Number(a.league_id) || 0) - (Number(b.league_id) || 0)
    || (Number(a.id) || 0) - (Number(b.id) || 0)
  ));
  for (const player of sorted) {
    let placed = false;
    for (const bucket of buckets) {
      if (bucketConflictsWithPlayer(bucket, player)) continue;
      bucket.push(player);
      placed = true;
      break;
    }
    if (!placed) buckets.push([player]);
  }
  return buckets;
}

function pushClusterSuggestionIfAny(fullName, groupPlayers, approvedPlayerMap, rejectedPlayerIds, suggestions) {
  const suggestion = buildClusterSuggestion(fullName, groupPlayers, approvedPlayerMap, rejectedPlayerIds);
  if (!suggestion) return false;
  suggestions.push(suggestion);
  return true;
}

/** Non unire cluster approvati distinti né omonimi della stessa stagione. */
function pushClusterSuggestionsSplitByApprovedCluster(
  fullName,
  groupPlayers,
  approvedPlayerMap,
  rejectedPlayerIds,
  suggestions,
) {
  if (!groupPlayers || groupPlayers.length < 2) return false;

  const { approvedByCluster, unapproved } = splitPlayersForClusterSuggestions(
    groupPlayers,
    approvedPlayerMap,
  );

  const personBuckets = partitionHomonymsIntoPersonBuckets(unapproved);
  let pushed = false;

  if (approvedByCluster.size === 0) {
    for (const bucket of personBuckets) {
      if (bucket.length < 2) continue;
      if (pushClusterSuggestionIfAny(
        fullName,
        bucket,
        approvedPlayerMap,
        rejectedPlayerIds,
        suggestions,
      )) {
        pushed = true;
      }
    }
    return pushed;
  }

  const unusedUnapproved = new Set(unapproved.map((p) => Number(p.id)));

  for (const clusterPlayers of approvedByCluster.values()) {
    const compatible = [];
    for (const player of unapproved) {
      const pid = Number(player.id);
      if (!unusedUnapproved.has(pid)) continue;
      if (bucketConflictsWithPlayer(clusterPlayers, player)) continue;
      if (bucketConflictsWithPlayer(compatible, player)) continue;
      compatible.push(player);
    }
    for (const player of compatible) unusedUnapproved.delete(Number(player.id));
    const combined = [...clusterPlayers, ...compatible];
    if (combined.length < 2) continue;
    if (pushClusterSuggestionIfAny(
      fullName,
      combined,
      approvedPlayerMap,
      rejectedPlayerIds,
      suggestions,
    )) {
      pushed = true;
    }
  }

  const leftover = unapproved.filter((p) => unusedUnapproved.has(Number(p.id)));
  for (const bucket of partitionHomonymsIntoPersonBuckets(leftover)) {
    if (bucket.length < 2) continue;
    if (pushClusterSuggestionIfAny(
      fullName,
      bucket,
      approvedPlayerMap,
      rejectedPlayerIds,
      suggestions,
    )) {
      pushed = true;
    }
  }

  return pushed;
}

function pushSuggestionsForNameGroup(players, approvedPlayerMap, rejectedPlayerIds, suggestions) {
  const nonRejected = (players || []).filter((p) => !rejectedPlayerIds.has(Number(p.id)));
  if (nonRejected.length < 2) return;

  const first = nonRejected[0];
  const fullName = `${String(first.first_name || '').trim()} ${String(first.last_name || '').trim()}`.trim();

  const withYear = new Map();
  const withoutYear = [];
  for (const p of nonRejected) {
    const y = normalizePlayerBirthYear(p);
    if (y != null) {
      if (!withYear.has(y)) withYear.set(y, []);
      withYear.get(y).push(p);
    } else {
      withoutYear.push(p);
    }
  }

  if (withYear.size === 0) {
    pushClusterSuggestionsSplitByApprovedCluster(
      fullName,
      nonRejected,
      approvedPlayerMap,
      rejectedPlayerIds,
      suggestions,
    );
    return;
  }

  const primaryYear = pickPrimaryBirthYearBucket(withYear, approvedPlayerMap);
  const hasApprovedWithoutYear = withoutYear.some((p) => approvedPlayerMap.has(Number(p.id)));
  let pushed = false;

  for (const [year, list] of withYear) {
    const hasApprovedInYearList = list.some((p) => approvedPlayerMap.has(Number(p.id)));
    // Collega i senza anno al bucket principale se: più omonimi con stesso anno, già in cluster con anno,
    // oppure cluster solo senza anno + almeno un giocatore con anno da associare (es. nuova lega con anno).
    const canAttachUnknown = year === primaryYear && (
      list.length >= 2
      || hasApprovedInYearList
      || (hasApprovedWithoutYear && list.length >= 1)
    );
    const group = canAttachUnknown ? [...list, ...withoutYear] : [...list];
    if (group.length < 2) continue;
    if (pushClusterSuggestionsSplitByApprovedCluster(
      fullName,
      group,
      approvedPlayerMap,
      rejectedPlayerIds,
      suggestions,
    )) {
      pushed = true;
    }
  }

  const primaryList = primaryYear != null && withYear.has(primaryYear) ? withYear.get(primaryYear) : [];
  const unknownAlreadyUsed = pushed && withoutYear.length > 0
    && primaryYear != null
    && (
      primaryList.length >= 2
      || primaryList.some((p) => approvedPlayerMap.has(Number(p.id)))
      || hasApprovedWithoutYear
    );

  if (!unknownAlreadyUsed && withoutYear.length >= 2) {
    pushClusterSuggestionsSplitByApprovedCluster(
      fullName,
      withoutYear,
      approvedPlayerMap,
      rejectedPlayerIds,
      suggestions,
    );
  }
}

async function assertClusterPlayerBirthYearsCompatible(playerIds, existingClusterId = null) {
  const ids = [...new Set((playerIds || []).map((v) => Number(v)).filter((v) => v > 0))];
  if (existingClusterId) {
    const memberRows = await query(
      `SELECT p.id
       FROM player_cluster_members pcm
       JOIN players p ON p.id = pcm.player_id
       WHERE pcm.cluster_id = ?`,
      [existingClusterId]
    );
    (memberRows || []).forEach((r) => ids.push(Number(r.id)));
  }
  const uniqueIds = [...new Set(ids.filter((v) => v > 0))];
  if (!uniqueIds.length) return;

  const ph = uniqueIds.map(() => '?').join(', ');
  const rows = await query(
    `SELECT id, birth_year FROM players WHERE id IN (${ph})`,
    uniqueIds
  );
  const years = new Set();
  (rows || []).forEach((r) => {
    const y = normalizePlayerBirthYear(r);
    if (y != null) years.add(y);
  });
  if (years.size > 1) {
    const err = new Error('BIRTH_YEAR_MISMATCH');
    err.years = [...years];
    throw err;
  }
}

function parseApplyBirthYearToClusterFlag(body) {
  if (body?.apply_birth_year_to_cluster === true) return true;
  if (body?.apply_birth_year_to_cluster === false) return false;
  return null;
}

async function getBirthYearPropagationContext(clusterId, playerIds) {
  const ids = [...new Set((playerIds || []).map((v) => Number(v)).filter((v) => v > 0))];
  if (!ids.length) return null;

  const ph = ids.map(() => '?').join(', ');
  const incomingRows = await query(
    `SELECT id, birth_year FROM players WHERE id IN (${ph})`,
    ids
  );
  const incomingYears = new Set();
  (incomingRows || []).forEach((r) => {
    const y = normalizePlayerBirthYear(r);
    if (y != null) incomingYears.add(y);
  });
  if (incomingYears.size !== 1) return null;
  const birthYear = [...incomingYears][0];

  if (clusterId) {
    const memberRows = await query(
      `SELECT p.id, p.birth_year
       FROM player_cluster_members pcm
       JOIN players p ON p.id = pcm.player_id
       WHERE pcm.cluster_id = ?`,
      [clusterId]
    );
    const memberIds = new Set((memberRows || []).map((r) => Number(r.id)));
    const missingInCluster = (memberRows || []).filter((r) => normalizePlayerBirthYear(r) == null);
    if (!missingInCluster.length) return null;

    const hasNewPlayerWithYear = (incomingRows || []).some((r) => {
      const y = normalizePlayerBirthYear(r);
      return y === birthYear && !memberIds.has(Number(r.id));
    });
    if (!hasNewPlayerWithYear) return null;

    return {
      birth_year: birthYear,
      missing_count: missingInCluster.length,
      cluster_id: clusterId,
    };
  }

  const withoutYear = (incomingRows || []).filter((r) => normalizePlayerBirthYear(r) == null);
  const withYear = (incomingRows || []).filter((r) => normalizePlayerBirthYear(r) === birthYear);
  if (!withoutYear.length || !withYear.length) return null;

  return {
    birth_year: birthYear,
    missing_count: withoutYear.length,
    cluster_id: null,
  };
}

async function propagateBirthYearToClusterMembers(clusterId, birthYear) {
  if (!clusterId || birthYear == null) return;
  await query(
    `UPDATE players p
     SET birth_year = ?
     FROM player_cluster_members pcm
     WHERE pcm.cluster_id = ?
       AND pcm.player_id = p.id`,
    [birthYear, clusterId]
  );
}

async function propagateRoleToClusterMembers(clusterId, role) {
  if (!clusterId || !role) return;
  await query(
    `UPDATE players p
     SET role = ?
     FROM player_cluster_members pcm
     WHERE pcm.cluster_id = ?
       AND pcm.player_id = p.id`,
    [role, clusterId]
  );
}

function parseClusterBirthYearInput(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  const s = String(raw).trim();
  if (!s) return { value: null };
  if (!/^\d{4}$/.test(s)) return { error: 'invalid' };
  const y = Number(s);
  const maxY = new Date().getFullYear();
  if (!Number.isFinite(y) || y < 1900 || y > maxY) return { error: 'range' };
  return { value: y };
}

function parseClusterRoleInput(raw) {
  if (raw === null || raw === undefined || raw === '') return { error: 'invalid' };
  const code = String(raw).trim().toUpperCase();
  if (!['P', 'D', 'C', 'A'].includes(code)) return { error: 'invalid' };
  return { value: code };
}

async function loadClusterMeta(clusterId) {
  const rows = await query(
    `SELECT id, official_group_id, status
     FROM player_clusters
     WHERE id = ?
     LIMIT 1`,
    [clusterId]
  );
  return rows[0] || null;
}

router.get('/users', authenticateToken, requireSuperuser, async (_req, res) => {
  try {
    // Compatibile con schema legacy: prova con user_presence, fallback se tabella assente/non accessibile.
    try {
      const rows = await query(
        `SELECT
           u.id,
           u.username,
           u.email,
           COALESCE(u.is_superuser, 0) AS is_superuser,
           COALESCE(
             up.last_seen_at,
             NULLIF(to_jsonb(u)->>'last_login', '')::timestamp
           ) AS last_login,
           CASE
             WHEN COALESCE(
               up.last_seen_at,
               NULLIF(to_jsonb(u)->>'last_login', '')::timestamp
             ) >= (NOW() - INTERVAL '2 minutes') THEN 1
             ELSE 0
           END AS is_online
         FROM users u
         LEFT JOIN user_presence up ON up.user_id = u.id
         ORDER BY u.username ASC, u.id ASC`
      );
      return res.json(rows);
    } catch (innerError) {
      const code = String(innerError?.code || '').toLowerCase();
      const msg = String(innerError?.message || '').toLowerCase();
      const isPresenceUnavailable =
        code === '42p01' ||
        msg.includes('user_presence') ||
        msg.includes('relation') ||
        msg.includes('does not exist');
      if (!isPresenceUnavailable) throw innerError;

      const fallbackRows = await query(
        `SELECT
           u.id,
           u.username,
           u.email,
           COALESCE(u.is_superuser, 0) AS is_superuser,
           NULLIF(to_jsonb(u)->>'last_login', '')::timestamp AS last_login,
           CASE
             WHEN NULLIF(to_jsonb(u)->>'last_login', '')::timestamp >= (NOW() - INTERVAL '2 minutes') THEN 1
             ELSE 0
           END AS is_online
         FROM users u
         ORDER BY u.username ASC, u.id ASC`
      );
      return res.json(fallbackRows);
    }
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento utenti', error: error.message });
  }
});

async function toggleSuperuserHandler(req, res) {
  try {
    const id = Number(req.params.id);
    const me = Number(req.user?.userId);
    if (!id || id <= 0) return res.status(400).json({ message: 'ID utente non valido' });
    if (id === me) return res.status(400).json({ message: 'Non puoi modificare te stesso' });
    const current = await query(`SELECT COALESCE(is_superuser, 0) AS is_superuser FROM users WHERE id = ? LIMIT 1`, [id]);
    if (!current.length) return res.status(404).json({ message: 'Utente non trovato' });
    const next = Number(current[0].is_superuser || 0) > 0 ? 0 : 1;
    await query(`UPDATE users SET is_superuser = ? WHERE id = ?`, [next, id]);
    return res.json({ success: true, is_superuser: next });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiornamento utente', error: error.message });
  }
}

router.put('/users/:id/toggle-superuser', authenticateToken, requireSuperuser, toggleSuperuserHandler);
router.post('/users/:id/toggle-superuser', authenticateToken, requireSuperuser, toggleSuperuserHandler);

async function setSuperuserLevelHandler(req, res) {
  try {
    const id = Number(req.params.id);
    const me = Number(req.user?.userId);
    const rawLevel = Number(req.body?.level);
    const level = Number.isFinite(rawLevel) ? rawLevel : 0;
    if (!id || id <= 0) return res.status(400).json({ message: 'ID utente non valido' });
    if (id === me) return res.status(400).json({ message: 'Non puoi modificare te stesso' });
    if (![0, 1, 2].includes(level)) {
      return res.status(400).json({ message: 'Livello non valido (consentiti: 0, 1, 2)' });
    }
    const current = await query(`SELECT id FROM users WHERE id = ? LIMIT 1`, [id]);
    if (!current.length) return res.status(404).json({ message: 'Utente non trovato' });
    await query(`UPDATE users SET is_superuser = ? WHERE id = ?`, [level, id]);
    return res.json({ success: true, is_superuser: level });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiornamento utente', error: error.message });
  }
}

router.put('/users/:id/superuser-level', authenticateToken, requireSuperuser, setSuperuserLevelHandler);
router.post('/users/:id/superuser-level', authenticateToken, requireSuperuser, setSuperuserLevelHandler);

function normalizeUsernameInput(raw) {
  return String(raw || '').trim();
}

function normalizeEmailInput(raw) {
  return String(raw || '').trim().toLowerCase();
}

router.put('/users/:id/username', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const username = normalizeUsernameInput(req.body?.username);
    if (!id || id <= 0) return res.status(400).json({ message: 'ID utente non valido' });
    if (!username || username.length < 2) {
      return res.status(400).json({ message: 'Nome utente non valido (minimo 2 caratteri)' });
    }
    if (username.length > 50) {
      return res.status(400).json({ message: 'Nome utente troppo lungo' });
    }
    const existing = await query(`SELECT id FROM users WHERE id = ? LIMIT 1`, [id]);
    if (!existing.length) return res.status(404).json({ message: 'Utente non trovato' });

    const clash = await query(
      `SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id <> ? LIMIT 1`,
      [username, id]
    );
    if (clash.length) return res.status(400).json({ message: 'Nome utente già in uso' });

    await query(`UPDATE users SET username = ? WHERE id = ?`, [username, id]);
    return res.json({ success: true, id, username });
  } catch (error) {
    if (String(error?.code || '') === '23505') {
      return res.status(400).json({ message: 'Nome utente già in uso' });
    }
    return res.status(500).json({ message: 'Errore aggiornamento nome utente', error: error.message });
  }
});

router.put('/users/:id/email', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const email = normalizeEmailInput(req.body?.email);
    if (!id || id <= 0) return res.status(400).json({ message: 'ID utente non valido' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Email non valida' });
    }
    const existing = await query(`SELECT id FROM users WHERE id = ? LIMIT 1`, [id]);
    if (!existing.length) return res.status(404).json({ message: 'Utente non trovato' });

    const clash = await query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ? LIMIT 1`,
      [email, id]
    );
    if (clash.length) return res.status(400).json({ message: 'Email già in uso' });

    await query(`UPDATE users SET email = ? WHERE id = ?`, [email, id]);
    return res.json({ success: true, id, email });
  } catch (error) {
    if (String(error?.code || '') === '23505') {
      return res.status(400).json({ message: 'Email già in uso' });
    }
    return res.status(500).json({ message: 'Errore aggiornamento email', error: error.message });
  }
});

router.put('/users/:id/password', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const password = String(req.body?.password || '').trim();
    if (!id || id <= 0) return res.status(400).json({ message: 'ID utente non valido' });
    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'La password deve essere di almeno 6 caratteri' });
    }
    const existing = await query(`SELECT id FROM users WHERE id = ? LIMIT 1`, [id]);
    if (!existing.length) return res.status(404).json({ message: 'Utente non trovato' });

    const hashed = await bcrypt.hash(password, 10);
    await query(`UPDATE users SET password = ? WHERE id = ?`, [hashed, id]);
    return res.json({ success: true, id, message: 'Password aggiornata' });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiornamento password', error: error.message });
  }
});

router.get('/leagues', authenticateToken, requireSuperuser, async (_req, res) => {
  try {
    await ensureSuperuserTables();
    const rows = await query(
      `SELECT l.id, l.name, l.access_code, l.created_at,
              COALESCE(l.is_official, 0) AS is_official, l.official_group_id,
              COALESCE(l.is_visible_for_linking, 1) AS is_visible_for_linking,
              COALESCE(l.is_hidden_from_discovery, 0) AS is_hidden_from_discovery,
              og.name AS official_group_name,
              (SELECT COUNT(*)::int FROM league_members lm WHERE lm.league_id = l.id) AS member_count
       FROM leagues l
       LEFT JOIN official_league_groups og ON og.id = l.official_group_id
       ORDER BY l.created_at DESC NULLS LAST, l.id DESC`
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento leghe', error: error.message });
  }
});

router.delete('/leagues/:id', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const leagueId = Number(req.params.id);
    if (!leagueId || leagueId <= 0) return res.status(400).json({ message: 'ID lega non valido' });
    await query(`DELETE FROM leagues WHERE id = ?`, [leagueId]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: 'Errore eliminazione lega', error: error.message });
  }
});

async function ensureUserBudgetForLeagueMember(userId, leagueId) {
  const budgetRows = await query(
    `SELECT 1 FROM user_budget WHERE user_id = ? AND league_id = ? LIMIT 1`,
    [userId, leagueId]
  );
  if (budgetRows.length) return;

  const leagueRows = await query(
    `SELECT COALESCE(initial_budget, 100) AS initial_budget FROM leagues WHERE id = ? LIMIT 1`,
    [leagueId]
  );
  const budget = Number(leagueRows[0]?.initial_budget || 100);
  const countRows = await query(
    `SELECT COUNT(*)::int AS c FROM league_members WHERE league_id = ?`,
    [leagueId]
  );
  const ordinal = Number(countRows[0]?.c || 1);

  await query(
    `INSERT INTO user_budget (user_id, league_id, budget, team_name, coach_name, team_logo)
     VALUES (?, ?, ?, ?, ?, 'default_1')
     ON CONFLICT (user_id, league_id) DO NOTHING`,
    [userId, leagueId, budget, `Squadra ${ordinal}`, `Allenatore ${ordinal}`]
  );
}

router.post('/leagues/:id/join-as-admin', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const leagueId = Number(req.params.id);
    const userId = Number(req.user?.userId);
    if (!leagueId || leagueId <= 0) return res.status(400).json({ message: 'ID lega non valido' });
    try {
      await query(`INSERT INTO league_members (league_id, user_id, role) VALUES (?, ?, 'admin') ON CONFLICT (league_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [leagueId, userId]);
    } catch (_) {
      const existing = await query(`SELECT id FROM league_members WHERE league_id = ? AND user_id = ? LIMIT 1`, [leagueId, userId]);
      if (existing.length) {
        await query(`UPDATE league_members SET role = 'admin' WHERE league_id = ? AND user_id = ?`, [leagueId, userId]);
      } else {
        await query(`INSERT INTO league_members (league_id, user_id, role) VALUES (?, ?, 'admin')`, [leagueId, userId]);
      }
    }
    await ensureUserBudgetForLeagueMember(userId, leagueId);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: 'Errore join admin', error: error.message });
  }
});

router.put('/leagues/:id/official', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    await ensureSuperuserTables();
    const leagueId = Number(req.params.id);
    const isOfficial = Number(req.body?.is_official ? 1 : 0);
    const groupId = req.body?.official_group_id ? Number(req.body.official_group_id) : null;
    await query(`UPDATE leagues SET is_official = ?, official_group_id = ? WHERE id = ?`, [isOfficial, groupId, leagueId]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiornamento stato ufficiale', error: error.message });
  }
});

router.put('/leagues/:id/visible-for-linking', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    await ensureSuperuserTables();
    const leagueId = Number(req.params.id);
    let next = 1;
    const rows = await query(`SELECT COALESCE(is_visible_for_linking, 1) AS current FROM leagues WHERE id = ? LIMIT 1`, [leagueId]);
    next = Number(rows[0]?.current ?? 1) ? 0 : 1;
    await query(`UPDATE leagues SET is_visible_for_linking = ? WHERE id = ?`, [next, leagueId]);
    return res.json({ success: true, is_visible_for_linking: next });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiornamento visibilità', error: error.message });
  }
});

// Nascosta dall'elenco leghe disponibili per chi non è iscritto (toggle 0/1)
router.put('/leagues/:id/hidden-from-discovery', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    await ensureSuperuserTables();
    const leagueId = Number(req.params.id);
    if (!leagueId || leagueId <= 0) return res.status(400).json({ message: 'ID lega non valido' });
    const rows = await query(`SELECT COALESCE(is_hidden_from_discovery, 0) AS current FROM leagues WHERE id = ? LIMIT 1`, [leagueId]);
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ message: 'Lega non trovata' });
    const next = Number(rows[0]?.current || 0) ? 0 : 1;
    await query(`UPDATE leagues SET is_hidden_from_discovery = ? WHERE id = ?`, [next, leagueId]);
    return res.json({ success: true, is_hidden_from_discovery: next });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiornamento nascosta', error: error.message });
  }
});

router.get('/official-groups', authenticateToken, requireSuperuser, async (_req, res) => {
  try {
    await ensureOfficialGroupMenuSchema();
    const rows = await query(
      `SELECT og.id, og.name, og.description, og.created_by, og.created_at,
              COALESCE(NULLIF(to_jsonb(og)->>'logo_path',''), NULLIF(og.logo_path, '')) AS logo_path,
              COALESCE(og.show_in_main_menu, 0)::int AS show_in_main_menu,
              COALESCE(u.username, '') AS created_by_username,
              COUNT(l.id)::int AS league_count
       FROM official_league_groups og
       LEFT JOIN leagues l ON l.official_group_id = og.id
       LEFT JOIN users u ON u.id = og.created_by
       GROUP BY og.id, og.name, og.description, og.created_by, og.created_at, og.logo_path, og.show_in_main_menu, u.username
       ORDER BY og.created_at DESC, og.id DESC`
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento gruppi ufficiali', error: error.message });
  }
});

router.post('/official-groups', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    if (!name) return res.status(400).json({ message: 'Nome gruppo obbligatorio' });

    const dup = await query(`SELECT id FROM official_league_groups WHERE LOWER(name) = LOWER(?) LIMIT 1`, [name]);
    if (dup.length > 0) return res.status(409).json({ message: 'Esiste già un gruppo con questo nome' });

    const rows = await query(
      `INSERT INTO official_league_groups (name, description, created_by)
       VALUES (?, ?, ?)
       RETURNING id, name, description, created_by, created_at`,
      [name, description || null, userId]
    );
    return res.json({ success: true, group: rows[0] || null });
  } catch (error) {
    return res.status(500).json({ message: 'Errore creazione gruppo ufficiale', error: error.message });
  }
});

router.put('/official-groups/:id', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });
    if (!name) return res.status(400).json({ message: 'Nome gruppo obbligatorio' });

    const exists = await query(`SELECT id FROM official_league_groups WHERE id = ? LIMIT 1`, [groupId]);
    if (!exists.length) return res.status(404).json({ message: 'Gruppo non trovato' });

    const dup = await query(
      `SELECT id FROM official_league_groups
       WHERE LOWER(name) = LOWER(?) AND id <> ?
       LIMIT 1`,
      [name, groupId]
    );
    if (dup.length > 0) return res.status(409).json({ message: 'Esiste già un gruppo con questo nome' });

    await query(
      `UPDATE official_league_groups
       SET name = ?, description = ?
       WHERE id = ?`,
      [name, description || null, groupId]
    );
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiornamento gruppo ufficiale', error: error.message });
  }
});

router.put('/official-groups/:id/main-menu', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const enabled =
      req.body?.show_in_main_menu === true ||
      req.body?.show_in_main_menu === 1 ||
      req.body?.enabled === true;

    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });

    await ensureOfficialGroupMenuSchema();

    const exists = await query(`SELECT id FROM official_league_groups WHERE id = ? LIMIT 1`, [groupId]);
    if (!exists.length) return res.status(404).json({ message: 'Gruppo non trovato' });

    if (enabled) {
      await query(`UPDATE official_league_groups SET show_in_main_menu = 0`);
      await query(`UPDATE official_league_groups SET show_in_main_menu = 1 WHERE id = ?`, [groupId]);
    } else {
      await query(`UPDATE official_league_groups SET show_in_main_menu = 0 WHERE id = ?`, [groupId]);
    }

    return res.json({ success: true, show_in_main_menu: enabled ? 1 : 0 });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiornamento menu principale', error: error.message });
  }
});

router.delete('/official-groups/:id', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });

    const exists = await query(`SELECT id FROM official_league_groups WHERE id = ? LIMIT 1`, [groupId]);
    if (!exists.length) return res.status(404).json({ message: 'Gruppo non trovato' });

    await query(
      `UPDATE leagues
       SET is_official = 0,
           official_group_id = NULL
       WHERE official_group_id = ?`,
      [groupId]
    );
    await query(`DELETE FROM official_league_groups WHERE id = ?`, [groupId]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: 'Errore eliminazione gruppo ufficiale', error: error.message });
  }
});

router.get('/official-groups/:id/leagues', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    await ensureLeagueOfficialGironiSchema();
    const groupId = Number(req.params.id);
    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });

    await query(`ALTER TABLE official_league_groups ADD COLUMN IF NOT EXISTS logo_path TEXT`);
    const groupRows = await query(
      `SELECT id, name, COALESCE(NULLIF(to_jsonb(og)->>'logo_path',''), NULLIF(og.logo_path, '')) AS logo_path
       FROM official_league_groups og
       WHERE id = ?
       LIMIT 1`,
      [groupId]
    );
    if (!groupRows.length) return res.status(404).json({ message: 'Gruppo non trovato' });

    const leagues = await query(
      `SELECT l.id, l.name, l.access_code, l.created_at,
              NULLIF(to_jsonb(l)->>'reference_year','')::int AS reference_year,
              COALESCE(l.is_official_squad_public, 0) AS is_official_squad_public,
              COALESCE(l.official_two_groups, 0) AS official_two_groups,
              COUNT(DISTINCT lm.user_id)::int AS member_count
       FROM leagues l
       LEFT JOIN league_members lm ON lm.league_id = l.id
       WHERE l.official_group_id = ?
       GROUP BY l.id, l.name, l.access_code, l.created_at, NULLIF(to_jsonb(l)->>'reference_year','')::int, l.is_official_squad_public, l.official_two_groups
       ORDER BY l.created_at DESC, l.id DESC`,
      [groupId]
    );
    return res.json({
      group: {
        id: Number(groupRows[0].id),
        name: groupRows[0].name,
        logo_path: groupRows[0].logo_path || null,
      },
      leagues,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento leghe del gruppo', error: error.message });
  }
});

router.put('/official-groups/:groupId/leagues/:leagueId/reference-year', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const leagueId = Number(req.params.leagueId);
    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });
    if (!leagueId || leagueId <= 0) return res.status(400).json({ message: 'ID lega non valido' });

    const hasField = Object.prototype.hasOwnProperty.call(req.body || {}, 'reference_year');
    if (!hasField) return res.status(400).json({ message: 'reference_year mancante' });
    const rawYear = req.body?.reference_year;
    const year =
      rawYear == null || String(rawYear).trim() === ''
        ? null
        : Number(rawYear);
    if (year != null && (!Number.isFinite(year) || year < 1900 || year > 2500)) {
      return res.status(400).json({ message: 'Anno riferimento non valido (1900-2500)' });
    }

    const belongs = await query(
      `SELECT id
       FROM leagues
       WHERE id = ? AND official_group_id = ?
       LIMIT 1`,
      [leagueId, groupId]
    );
    if (!belongs.length) return res.status(404).json({ message: 'Lega non trovata nel gruppo selezionato' });

    await query(`UPDATE leagues SET reference_year = ? WHERE id = ?`, [year == null ? null : Math.trunc(year), leagueId]);
    return res.json({ ok: true, league_id: leagueId, reference_year: year == null ? null : Math.trunc(year) });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiornamento anno di riferimento', error: error.message });
  }
});

/**
 * Giocatori delle leghe del gruppo ufficiale senza alcuna presenza:
 * nessun voto reale e nessun S.V. (N.D. o assenza di voti = "mai giocato").
 */
router.get('/official-groups/:groupId/never-played-players', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });

    const groupRows = await query(
      `SELECT id, name FROM official_league_groups WHERE id = ? LIMIT 1`,
      [groupId]
    );
    if (!groupRows.length) return res.status(404).json({ message: 'Gruppo ufficiale non trovato' });

    const rows = await query(
      `SELECT
         p.id AS player_id,
         p.first_name,
         p.last_name,
         p.role,
         p.birth_year,
         t.id AS team_id,
         t.name AS team_name,
         l.id AS league_id,
         l.name AS league_name,
         l.reference_year,
         CASE WHEN EXISTS (
           SELECT 1 FROM user_players up
           WHERE up.player_id = p.id AND up.league_id = l.id
         ) THEN 1 ELSE 0 END AS in_user_squad,
         (
           SELECT COUNT(*)::int FROM player_ratings pr
           WHERE pr.player_id = p.id AND pr.league_id = l.id AND pr.rating = 0
         ) AS nd_vote_count
       FROM players p
       INNER JOIN teams t ON t.id = p.team_id
       INNER JOIN leagues l ON l.id = t.league_id
       WHERE l.official_group_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM player_ratings pr
           WHERE pr.player_id = p.id
             AND pr.league_id = l.id
             AND ${SQL_WHERE_PRESENCE_VOTE}
         )
       ORDER BY
         l.reference_year DESC NULLS LAST,
         l.name ASC,
         t.name ASC,
         p.last_name ASC,
         p.first_name ASC`,
      [groupId]
    );

    const players = (rows || []).map((r) => ({
      player_id: Number(r.player_id),
      first_name: String(r.first_name || '').trim(),
      last_name: String(r.last_name || '').trim(),
      role: String(r.role || '').trim().toUpperCase() || null,
      birth_year: r.birth_year != null ? Number(r.birth_year) : null,
      team_id: Number(r.team_id),
      team_name: String(r.team_name || '').trim(),
      league_id: Number(r.league_id),
      league_name: String(r.league_name || '').trim(),
      reference_year: r.reference_year != null ? Number(r.reference_year) : null,
      in_user_squad: Number(r.in_user_squad) === 1,
      nd_vote_count: Number(r.nd_vote_count || 0),
      can_delete: Number(r.in_user_squad) !== 1,
    }));

    return res.json({
      group_id: groupId,
      group_name: groupRows[0].name,
      count: players.length,
      players,
    });
  } catch (error) {
    console.error('[superuser] GET never-played-players error:', error?.message || error);
    return res.status(500).json({ message: 'Errore caricamento giocatori senza partite', error: error.message });
  }
});

/**
 * Giocatori delle leghe del gruppo non membri di alcun cluster approvato.
 */
router.get('/official-groups/:groupId/unclustered-players', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    await ensurePlayerClusterSchema();
    const groupId = Number(req.params.groupId);
    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });

    const groupRows = await query(
      `SELECT id, name FROM official_league_groups WHERE id = ? LIMIT 1`,
      [groupId]
    );
    if (!groupRows.length) return res.status(404).json({ message: 'Gruppo ufficiale non trovato' });

    const rows = await query(
      `SELECT
         p.id AS player_id,
         p.first_name,
         p.last_name,
         p.role,
         p.birth_year,
         t.id AS team_id,
         t.name AS team_name,
         l.id AS league_id,
         l.name AS league_name,
         NULLIF(to_jsonb(l)->>'reference_year','')::int AS reference_year
       FROM players p
       INNER JOIN teams t ON t.id = p.team_id
       INNER JOIN leagues l ON l.id = t.league_id
       WHERE l.official_group_id = ?
         AND NOT EXISTS (
           SELECT 1
           FROM player_cluster_members pcm
           INNER JOIN player_clusters pc ON pc.id = pcm.cluster_id
           WHERE pcm.player_id = p.id
             AND pc.official_group_id = ?
             AND pc.status = 'approved'
         )
       ORDER BY
         p.last_name ASC,
         p.first_name ASC,
         NULLIF(to_jsonb(l)->>'reference_year','')::int DESC NULLS LAST,
         l.name ASC`,
      [groupId, groupId]
    );

    const players = (rows || []).map((r) => ({
      player_id: Number(r.player_id),
      first_name: String(r.first_name || '').trim(),
      last_name: String(r.last_name || '').trim(),
      role: String(r.role || '').trim().toUpperCase() || null,
      birth_year: r.birth_year != null ? Number(r.birth_year) : null,
      team_id: Number(r.team_id),
      team_name: String(r.team_name || '').trim(),
      league_id: Number(r.league_id),
      league_name: String(r.league_name || '').trim(),
      reference_year: r.reference_year != null ? Number(r.reference_year) : null,
    }));

    return res.json({
      group_id: groupId,
      group_name: groupRows[0].name,
      count: players.length,
      players,
    });
  } catch (error) {
    console.error('[superuser] GET unclustered-players error:', error?.message || error);
    if (isMissingDbObjectError(error)) {
      return res.status(500).json({
        message: 'Tabelle cluster non configurate sul database',
        error: error.message,
      });
    }
    return res.status(500).json({ message: 'Errore caricamento giocatori singoli', error: error.message });
  }
});

function normalizeTeamNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function majorityValue(values) {
  const counts = new Map();
  for (const raw of values || []) {
    const v = raw == null ? '' : String(raw).trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [k, n] of counts.entries()) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

function computeYearGaps(presentYearsSorted) {
  const years = [...new Set((presentYearsSorted || []).map(Number).filter((y) => Number.isFinite(y) && y > 0))]
    .sort((a, b) => a - b);
  if (years.length < 2) return [];
  const gaps = [];
  for (let y = years[0] + 1; y < years[years.length - 1]; y += 1) {
    if (!years.includes(y)) gaps.push(y);
  }
  return gaps;
}

/**
 * Cluster approvati con buchi di anni (es. 2004+2006 senza 2005) nel gruppo ufficiale.
 */
router.get('/official-groups/:groupId/cluster-year-gaps', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    await ensurePlayerClusterSchema();
    const groupId = Number(req.params.groupId);
    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });

    const groupRows = await query(
      `SELECT id, name FROM official_league_groups WHERE id = ? LIMIT 1`,
      [groupId]
    );
    if (!groupRows.length) return res.status(404).json({ message: 'Gruppo ufficiale non trovato' });

    const leagueYearRows = await query(
      `SELECT
         l.id AS league_id,
         l.name AS league_name,
         NULLIF(to_jsonb(l)->>'reference_year','')::int AS reference_year
       FROM leagues l
       WHERE l.official_group_id = ?
         AND COALESCE(l.is_official, 0) = 1
         AND NULLIF(to_jsonb(l)->>'reference_year','')::int IS NOT NULL
       ORDER BY reference_year ASC, l.name ASC`,
      [groupId]
    );
    const leagueByYear = new Map();
    for (const row of leagueYearRows || []) {
      const y = Number(row.reference_year);
      if (!Number.isFinite(y) || y <= 0) continue;
      if (!leagueByYear.has(y)) {
        leagueByYear.set(y, {
          league_id: Number(row.league_id),
          league_name: String(row.league_name || '').trim(),
          reference_year: y,
        });
      }
    }

    const memberRows = await query(
      `SELECT
         pc.id AS cluster_id,
         p.id AS player_id,
         p.first_name,
         p.last_name,
         p.role,
         p.birth_year,
         t.id AS team_id,
         t.name AS team_name,
         l.id AS league_id,
         l.name AS league_name,
         NULLIF(to_jsonb(l)->>'reference_year','')::int AS reference_year
       FROM player_clusters pc
       INNER JOIN player_cluster_members pcm ON pcm.cluster_id = pc.id
       INNER JOIN players p ON p.id = pcm.player_id
       INNER JOIN teams t ON t.id = p.team_id
       INNER JOIN leagues l ON l.id = t.league_id
       WHERE pc.official_group_id = ?
         AND pc.status = 'approved'
         AND COALESCE(l.is_official, 0) = 1
       ORDER BY pc.id ASC, reference_year ASC NULLS LAST, p.last_name ASC, p.first_name ASC`,
      [groupId]
    );

    const byCluster = new Map();
    for (const row of memberRows || []) {
      const clusterId = Number(row.cluster_id);
      if (!byCluster.has(clusterId)) byCluster.set(clusterId, []);
      byCluster.get(clusterId).push(row);
    }

    // Prima passa: individua cluster con buchi (senza ancora team/existing)
    const draftClusters = [];
    const neededLeagueIds = new Set();
    for (const [clusterId, members] of byCluster.entries()) {
      const presentYears = [...new Set(
        members
          .map((m) => Number(m.reference_year))
          .filter((y) => Number.isFinite(y) && y > 0)
      )].sort((a, b) => a - b);

      const rawGaps = computeYearGaps(presentYears).filter((y) => leagueByYear.has(y));
      if (!rawGaps.length) continue;

      const first = members[0];
      const displayName = `${first?.first_name || ''} ${first?.last_name || ''}`.trim() || '—';
      const suggestedRole = majorityValue(members.map((m) => String(m.role || '').trim().toUpperCase())) || 'C';
      const suggestedBirthYear = (() => {
        const years = [...new Set(
          members.map((m) => Number(m.birth_year)).filter((y) => Number.isFinite(y) && y >= 1900)
        )];
        return years.length === 1 ? years[0] : null;
      })();
      const suggestedTeamName = majorityValue(members.map((m) => m.team_name)) || null;

      const present = presentYears.map((y) => {
        const league = leagueByYear.get(y);
        const member = members.find((m) => Number(m.reference_year) === y);
        return {
          reference_year: y,
          league_id: league?.league_id || Number(member?.league_id) || null,
          league_name: league?.league_name || String(member?.league_name || ''),
          player_id: Number(member?.player_id) || null,
          team_id: Number(member?.team_id) || null,
          team_name: String(member?.team_name || ''),
          role: String(member?.role || '').trim().toUpperCase() || null,
        };
      });

      const gapYears = [];
      for (const year of rawGaps) {
        const league = leagueByYear.get(year);
        if (!league) continue;
        neededLeagueIds.add(league.league_id);
        gapYears.push(year);
      }
      if (!gapYears.length) continue;

      draftClusters.push({
        cluster_id: clusterId,
        name: displayName,
        first_name: String(first?.first_name || '').trim(),
        last_name: String(first?.last_name || '').trim(),
        present_years: presentYears,
        present,
        members_count: members.length,
        suggested_role: suggestedRole,
        suggested_birth_year: suggestedBirthYear,
        suggested_team_name: suggestedTeamName,
        gap_years: gapYears,
      });
    }

    const teamsByLeagueId = new Map();
    if (neededLeagueIds.size > 0) {
      const leagueIdList = [...neededLeagueIds];
      const placeholders = leagueIdList.map(() => '?').join(',');
      const teamRows = await query(
        `SELECT id, name, league_id
         FROM teams
         WHERE league_id IN (${placeholders})
         ORDER BY name ASC`,
        leagueIdList
      );
      for (const t of teamRows || []) {
        const lid = Number(t.league_id);
        if (!teamsByLeagueId.has(lid)) teamsByLeagueId.set(lid, []);
        teamsByLeagueId.get(lid).push({
          team_id: Number(t.id),
          team_name: String(t.name || '').trim(),
        });
      }
    }

    // Omonimi nelle leghe con buco (una query per tutti i draft)
    const existingByKey = new Map(); // `${leagueId}|${fn}|${ln}` -> players[]
    if (draftClusters.length > 0 && neededLeagueIds.size > 0) {
      const namePairs = [];
      const seenNames = new Set();
      for (const d of draftClusters) {
        const fn = d.first_name;
        const ln = d.last_name;
        if (!fn || !ln) continue;
        const nk = `${fn.toLowerCase()}|${ln.toLowerCase()}`;
        if (seenNames.has(nk)) continue;
        seenNames.add(nk);
        namePairs.push([fn, ln]);
      }
      if (namePairs.length > 0) {
        const leagueIdList = [...neededLeagueIds];
        const leaguePh = leagueIdList.map(() => '?').join(',');
        const nameConds = namePairs.map(() =>
          `(LOWER(TRIM(p.first_name)) = LOWER(TRIM(?)) AND LOWER(TRIM(p.last_name)) = LOWER(TRIM(?)))`
        ).join(' OR ');
        const params = [
          ...leagueIdList,
          ...namePairs.flatMap(([fn, ln]) => [fn, ln]),
        ];
        const existingRows = await query(
          `SELECT p.id AS player_id, p.first_name, p.last_name, p.role, p.birth_year,
                  t.id AS team_id, t.name AS team_name, t.league_id
           FROM players p
           INNER JOIN teams t ON t.id = p.team_id
           WHERE t.league_id IN (${leaguePh})
             AND (${nameConds})`,
          params
        );
        for (const r of existingRows || []) {
          const key = `${Number(r.league_id)}|${String(r.first_name || '').trim().toLowerCase()}|${String(r.last_name || '').trim().toLowerCase()}`;
          if (!existingByKey.has(key)) existingByKey.set(key, []);
          existingByKey.get(key).push({
            player_id: Number(r.player_id),
            role: String(r.role || '').trim().toUpperCase() || null,
            birth_year: r.birth_year != null ? Number(r.birth_year) : null,
            team_id: Number(r.team_id),
            team_name: String(r.team_name || '').trim(),
          });
        }
      }
    }

    const clusters = draftClusters.map((d) => {
      const suggestedTeamKey = normalizeTeamNameKey(d.suggested_team_name);
      const gaps = d.gap_years.map((year) => {
        const league = leagueByYear.get(year);
        const teamList = teamsByLeagueId.get(league.league_id) || [];
        const suggestedTeam = suggestedTeamKey
          ? (teamList.find((t) => normalizeTeamNameKey(t.team_name) === suggestedTeamKey) || null)
          : null;
        const existKey = `${league.league_id}|${d.first_name.toLowerCase()}|${d.last_name.toLowerCase()}`;
        return {
          reference_year: year,
          league_id: league.league_id,
          league_name: league.league_name,
          suggested_role: d.suggested_role,
          suggested_birth_year: d.suggested_birth_year,
          suggested_team_id: suggestedTeam?.team_id || null,
          suggested_team_name: suggestedTeam?.team_name || d.suggested_team_name,
          teams: teamList,
          existing_players: existingByKey.get(existKey) || [],
        };
      });
      return {
        cluster_id: d.cluster_id,
        name: d.name,
        first_name: d.first_name,
        last_name: d.last_name,
        present_years: d.present_years,
        present: d.present,
        gaps,
        members_count: d.members_count,
      };
    }).filter((c) => c.gaps.length > 0);

    clusters.sort((a, b) => a.name.localeCompare(b.name, 'it'));

    return res.json({
      group_id: groupId,
      group_name: groupRows[0].name,
      count: clusters.length,
      clusters,
    });
  } catch (error) {
    console.error('[superuser] GET cluster-year-gaps error:', error?.message || error);
    if (isMissingDbObjectError(error)) {
      return res.status(500).json({
        message: 'Tabelle cluster non configurate sul database',
        error: error.message,
      });
    }
    return res.status(500).json({ message: 'Errore scansione buchi anni cluster', error: error.message });
  }
});

/**
 * Crea (o riusa) un giocatore nell'anno mancante e lo aggiunge al cluster.
 * Body: { reference_year, team_id, role?, birth_year?, player_id? }
 */
router.post('/player-clusters/:clusterId/fill-year-gap', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    await ensurePlayerClusterSchema();
    const userId = Number(req.user?.userId);
    const clusterId = Number(req.params.clusterId);
    const referenceYear = Number(req.body?.reference_year);
    const teamId = Number(req.body?.team_id);
    const existingPlayerId = req.body?.player_id != null ? Number(req.body.player_id) : null;
    const roleRaw = String(req.body?.role || '').trim().toUpperCase();
    const role = ['P', 'D', 'C', 'A'].includes(roleRaw) ? roleRaw : null;
    const birthParsed = parseClusterBirthYearInput(req.body?.birth_year);

    if (!clusterId || !Number.isFinite(referenceYear) || referenceYear <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    if (birthParsed.error) {
      return res.status(400).json({ message: 'Anno di nascita non valido' });
    }

    const cluster = await loadClusterMeta(clusterId);
    if (!cluster || cluster.status !== 'approved') {
      return res.status(404).json({ message: 'Cluster approvato non trovato' });
    }
    const groupId = Number(cluster.official_group_id);

    const memberRows = await query(
      `SELECT p.id, p.first_name, p.last_name, p.role, p.birth_year
       FROM player_cluster_members pcm
       INNER JOIN players p ON p.id = pcm.player_id
       WHERE pcm.cluster_id = ?
       ORDER BY p.id ASC`,
      [clusterId]
    );
    if (!memberRows.length) return res.status(400).json({ message: 'Cluster senza membri' });

    const first = memberRows[0];
    const firstName = String(first.first_name || '').trim();
    const lastName = String(first.last_name || '').trim();
    if (!firstName || !lastName) {
      return res.status(400).json({ message: 'Nome cluster non valido' });
    }

    const leagueRows = await query(
      `SELECT id, name
       FROM leagues l
       WHERE l.official_group_id = ?
         AND COALESCE(l.is_official, 0) = 1
         AND NULLIF(to_jsonb(l)->>'reference_year','')::int = ?
       LIMIT 1`,
      [groupId, referenceYear]
    );
    if (!leagueRows.length) {
      return res.status(400).json({ message: `Nessuna lega ufficiale per l'anno ${referenceYear}` });
    }
    const leagueId = Number(leagueRows[0].id);

    let playerId = Number.isFinite(existingPlayerId) && existingPlayerId > 0 ? existingPlayerId : null;
    let created = false;

    if (playerId) {
      const ok = await query(
        `SELECT p.id
         FROM players p
         INNER JOIN teams t ON t.id = p.team_id
         WHERE p.id = ? AND t.league_id = ?
         LIMIT 1`,
        [playerId, leagueId]
      );
      if (!ok.length) {
        return res.status(400).json({ message: 'Il giocatore selezionato non appartiene alla lega dell\'anno' });
      }
    } else {
      if (!Number.isFinite(teamId) || teamId <= 0) {
        return res.status(400).json({ message: 'Seleziona una squadra' });
      }
      const teamOk = await query(
        `SELECT id, name FROM teams WHERE id = ? AND league_id = ? LIMIT 1`,
        [teamId, leagueId]
      );
      if (!teamOk.length) {
        return res.status(400).json({ message: 'Squadra non valida per la lega dell\'anno' });
      }

      const resolvedRole = role
        || majorityValue(memberRows.map((m) => String(m.role || '').trim().toUpperCase()))
        || 'C';
      const resolvedBirth = birthParsed.value != null
        ? birthParsed.value
        : (() => {
          const years = [...new Set(
            memberRows.map((m) => Number(m.birth_year)).filter((y) => Number.isFinite(y) && y >= 1900)
          )];
          return years.length === 1 ? years[0] : null;
        })();

      let ins;
      try {
        ins = await query(
          `INSERT INTO players (team_id, first_name, last_name, role, rating, birth_year)
           VALUES (?, ?, ?, ?, 0, ?)
           RETURNING id`,
          [teamId, firstName, lastName, resolvedRole, resolvedBirth]
        );
      } catch (_) {
        ins = await query(
          `INSERT INTO players (team_id, first_name, last_name, role, rating)
           VALUES (?, ?, ?, ?, 0)
           RETURNING id`,
          [teamId, firstName, lastName, resolvedRole]
        );
      }
      playerId = Number(ins?.[0]?.id || ins?.insertId);
      if (!Number.isFinite(playerId) || playerId <= 0) {
        return res.status(500).json({ message: 'Creazione giocatore fallita' });
      }
      created = true;
    }

    const alreadyIn = await query(
      `SELECT player_id FROM player_cluster_members WHERE cluster_id = ? AND player_id = ? LIMIT 1`,
      [clusterId, playerId]
    );
    if (!alreadyIn.length) {
      const dupApproved = await query(
        `SELECT pcm.player_id
         FROM player_cluster_members pcm
         JOIN player_clusters pc ON pcm.cluster_id = pc.id
         WHERE pcm.player_id = ?
           AND pc.id <> ?
           AND pc.official_group_id = ?
           AND pc.status = 'approved'
         LIMIT 1`,
        [playerId, clusterId, groupId]
      );
      if (dupApproved.length > 0) {
        return res.status(400).json({ message: 'Il giocatore appartiene già a un altro cluster approvato' });
      }
      try {
        await assertClusterPlayerBirthYearsCompatible([playerId], clusterId);
      } catch (compatErr) {
        if (compatErr?.message === 'BIRTH_YEAR_MISMATCH') {
          return res.status(400).json({
            message: 'Anni di nascita diversi: non puoi associare omonimi con anno diverso nello stesso cluster',
            years: compatErr.years || [],
          });
        }
        throw compatErr;
      }
      await query(
        `INSERT INTO player_cluster_members (cluster_id, player_id, added_by)
         VALUES (?, ?, ?)`,
        [clusterId, playerId, userId]
      );
    }

    return res.json({
      message: created
        ? `Giocatore creato e aggiunto al cluster per il ${referenceYear}`
        : `Giocatore aggiunto al cluster per il ${referenceYear}`,
      created,
      player_id: playerId,
      cluster_id: clusterId,
      reference_year: referenceYear,
      league_id: leagueId,
    });
  } catch (error) {
    console.error('[superuser] POST fill-year-gap error:', error?.message || error);
    return res.status(500).json({ message: 'Errore riempimento anno mancante', error: error.message });
  }
});

/**
 * Discrepanze tra bonus diretta (eventi) e valori salvati nei voti (player_ratings).
 * Stessa logica di allineamento del salvataggio voti partita.
 */
router.get(
  '/official-groups/:groupId/live-bonus-discrepancies',
  authenticateToken,
  requireSuperuser,
  async (req, res) => {
    try {
      const groupId = Number(req.params.groupId);
      if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });
      const leagueIdRaw = req.query?.league_id;
      const leagueId =
        leagueIdRaw != null && String(leagueIdRaw).trim() !== ''
          ? Number(leagueIdRaw)
          : null;
      const { scanOfficialGroupLiveBonusDiscrepancies } = require('../utils/liveBonusDiscrepancyScan');
      const result = await scanOfficialGroupLiveBonusDiscrepancies(groupId, {
        leagueId: Number.isFinite(leagueId) && leagueId > 0 ? leagueId : null,
      });
      return res.json(result);
    } catch (error) {
      const status = Number(error?.status) || 500;
      console.error('[superuser] GET live-bonus-discrepancies error:', error?.message || error);
      return res.status(status).json({
        message: error?.message || 'Errore scansione discrepanze diretta/voti',
        error: error.message,
      });
    }
  }
);

/**
 * Elimina un giocatore "mai giocato" e i dati collegati (voti N.D., cluster, ecc.).
 * Bloccato se è in rosa di un utente (user_players) o se ha voti di presenza.
 */
router.delete(
  '/official-groups/:groupId/never-played-players/:playerId',
  authenticateToken,
  requireSuperuser,
  async (req, res) => {
    try {
      const groupId = Number(req.params.groupId);
      const playerId = Number(req.params.playerId);
      if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });
      if (!playerId || playerId <= 0) return res.status(400).json({ message: 'ID giocatore non valido' });

      const playerRows = await query(
        `SELECT
           p.id,
           p.first_name,
           p.last_name,
           p.team_id,
           t.name AS team_name,
           l.id AS league_id,
           l.name AS league_name,
           l.official_group_id
         FROM players p
         INNER JOIN teams t ON t.id = p.team_id
         INNER JOIN leagues l ON l.id = t.league_id
         WHERE p.id = ?
         LIMIT 1`,
        [playerId]
      );
      const player = playerRows[0];
      if (!player) return res.status(404).json({ message: 'Giocatore non trovato' });
      if (Number(player.official_group_id) !== groupId) {
        return res.status(400).json({ message: 'Il giocatore non appartiene a questo gruppo ufficiale' });
      }

      const leagueId = Number(player.league_id);

      const squadRows = await query(
        `SELECT up.user_id, u.username
         FROM user_players up
         LEFT JOIN users u ON u.id = up.user_id
         WHERE up.player_id = ? AND up.league_id = ?
         LIMIT 5`,
        [playerId, leagueId]
      );
      if (squadRows.length) {
        const names = squadRows
          .map((r) => String(r.username || '').trim() || `user #${r.user_id}`)
          .filter(Boolean);
        return res.status(409).json({
          code: 'IN_USER_SQUAD',
          message:
            'Non puoi eliminare questo giocatore: fa parte della rosa di un utente in questa lega'
            + (names.length ? ` (${names.join(', ')})` : ''),
          usernames: names,
        });
      }

      const presenceRows = await query(
        `SELECT 1
         FROM player_ratings pr
         WHERE pr.player_id = ?
           AND pr.league_id = ?
           AND ${SQL_WHERE_PRESENCE_VOTE}
         LIMIT 1`,
        [playerId, leagueId]
      );
      if (presenceRows.length) {
        return res.status(409).json({
          code: 'HAS_PRESENCE_VOTES',
          message: 'Non puoi eliminare questo giocatore: ha almeno un voto reale o S.V. in questa lega',
        });
      }

      // Cluster membership: rimuovi e pulisci cluster vuoti
      const clusterMemberRows = await query(
        `SELECT cluster_id FROM player_cluster_members WHERE player_id = ?`,
        [playerId]
      );
      const clusterIds = [...new Set((clusterMemberRows || []).map((r) => Number(r.cluster_id)).filter((n) => n > 0))];
      await query(`DELETE FROM player_cluster_members WHERE player_id = ?`, [playerId]);
      let clustersDeleted = 0;
      for (const clusterId of clusterIds) {
        const countRows = await query(
          `SELECT COUNT(*)::int AS c FROM player_cluster_members WHERE cluster_id = ?`,
          [clusterId]
        );
        // Cluster con 0 o 1 membro non ha senso: elimina members + cluster.
        if (Number(countRows[0]?.c || 0) < 2) {
          await query(`DELETE FROM player_cluster_members WHERE cluster_id = ?`, [clusterId]);
          await query(`DELETE FROM player_clusters WHERE id = ?`, [clusterId]);
          try {
            await query(
              `DELETE FROM official_group_cluster_absolute_stats WHERE cluster_id = ?`,
              [clusterId],
            );
          } catch (_) {
            /* tabella opzionale */
          }
          clustersDeleted += 1;
        }
      }

      // Voti N.D. (e eventuali residui non-presenza)
      await query(`DELETE FROM player_ratings WHERE player_id = ? AND league_id = ?`, [playerId, leagueId]);

      // Riferimenti infortunio
      try {
        await query(
          `UPDATE players SET injury_replacement_player_id = NULL WHERE injury_replacement_player_id = ?`,
          [playerId]
        );
      } catch (err) {
        if (!isMissingDbObjectError(err)) throw err;
      }

      // Indisponibili partite ufficiali (CASCADE se FK presente; altrimenti delete esplicito)
      try {
        await query(`DELETE FROM official_match_unavailable_players WHERE player_id = ?`, [playerId]);
      } catch (err) {
        if (!isMissingDbObjectError(err)) throw err;
      }

      // Eventi live: stacca il riferimento (niente FK obbligatoria)
      try {
        await query(
          `UPDATE official_match_events
           SET player_id = NULL
           WHERE player_id = ?`,
          [playerId]
        );
        await query(
          `UPDATE official_match_events
           SET assist_player_id = NULL
           WHERE assist_player_id = ?`,
          [playerId]
        );
      } catch (err) {
        if (!isMissingDbObjectError(err)) throw err;
      }

      // Foto storage
      try {
        const supabase = getSupabaseStorageClient();
        if (supabase) {
          await removePlayerPhotoVariants(supabase, {
            clusterId: clusterIds[0] || null,
            playerId,
          });
        }
      } catch (_photoErr) {
        // non bloccare l'eliminazione per errori storage
      }

      await query(`DELETE FROM players WHERE id = ?`, [playerId]);

      return res.json({
        ok: true,
        message: 'Giocatore eliminato',
        player_id: playerId,
        player_name: `${String(player.first_name || '').trim()} ${String(player.last_name || '').trim()}`.trim(),
        league_id: leagueId,
        team_id: Number(player.team_id),
        clusters_deleted: clustersDeleted,
      });
    } catch (error) {
      console.error('[superuser] DELETE never-played-player error:', error?.message || error);
      if (error?.code === '23503') {
        return res.status(409).json({
          message: 'Impossibile eliminare: il giocatore è ancora referenziato da altri dati',
          error: error.message,
        });
      }
      return res.status(500).json({ message: 'Errore eliminazione giocatore', error: error.message });
    }
  }
);

// Pubblica rosa/classifica/stats squadra ufficiale per questo reference_year (toggle 0/1)
router.put(
  '/official-groups/:groupId/leagues/:leagueId/official-squad-public',
  authenticateToken,
  requireSuperuser,
  async (req, res) => {
    try {
      const groupId = Number(req.params.groupId);
      const leagueId = Number(req.params.leagueId);
      if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });
      if (!leagueId || leagueId <= 0) return res.status(400).json({ message: 'ID lega non valido' });

      const belongs = await query(
        `SELECT id
         FROM leagues
         WHERE id = ? AND official_group_id = ?
         LIMIT 1`,
        [leagueId, groupId]
      );
      if (!belongs.length) return res.status(404).json({ message: 'Lega non trovata nel gruppo selezionato' });

      const rows = await query(
        `SELECT COALESCE(is_official_squad_public, 0) AS current FROM leagues WHERE id = ? LIMIT 1`,
        [leagueId]
      );
      const next = Number(rows[0]?.current || 0) ? 0 : 1;
      await query(`UPDATE leagues SET is_official_squad_public = ? WHERE id = ?`, [next, leagueId]);

      // Ricalcola leaderboard assolute del gruppo senza leghe nascoste/bozza.
      setImmediate(() => {
        try {
          const {
            recomputeAndStoreOfficialGroupAbsoluteStats,
          } = require('../utils/officialGroupAbsoluteStatsStore');
          Promise.resolve(recomputeAndStoreOfficialGroupAbsoluteStats(groupId)).catch((err) => {
            console.warn(
              '[superuser] refresh absolute stats after squad-public toggle failed:',
              err?.message || err,
            );
          });
        } catch (err) {
          console.warn(
            '[superuser] refresh absolute stats after squad-public toggle failed:',
            err?.message || err,
          );
        }
      });

      return res.json({ ok: true, league_id: leagueId, is_official_squad_public: next });
    } catch (error) {
      return res.status(500).json({ message: 'Errore aggiornamento pubblicazione rosa ufficiale', error: error.message });
    }
  }
);

// Due gironi: endpoint su /api/admin/... in routes/matches.js (stessi permessi SU1/SU2)

router.get('/player-clusters/suggestions/:groupId', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    await ensurePlayerClusterSchema();
    const groupId = Number(req.params.groupId);
    if (!groupId || groupId <= 0) return res.json({ suggestions: [] });

    const leagueIds = await getGroupLeagueIds(groupId);
    if (!leagueIds.length) return res.json({ suggestions: [] });

    const ph = leagueIds.map(() => '?').join(', ');

    // All players in the group's leagues with their league info
    const allPlayers = await query(
      `SELECT p.id, p.first_name, p.last_name, p.role, p.birth_year, t.league_id, t.name AS team_name,
              l.name AS league_name,
              NULLIF(to_jsonb(l)->>'reference_year','')::int AS reference_year
       FROM players p
       JOIN teams t ON p.team_id = t.id
       JOIN leagues l ON t.league_id = l.id
       WHERE t.league_id IN (${ph})
       ORDER BY p.last_name, p.first_name`,
      leagueIds
    );
    if (!Array.isArray(allPlayers) || allPlayers.length === 0) return res.json({ suggestions: [] });

    // Players already in a cluster (approved or rejected) for this group
    const clusteredRows = await query(
      `SELECT pcm.player_id, pc.id AS cluster_id, pc.status
       FROM player_cluster_members pcm
       JOIN player_clusters pc ON pcm.cluster_id = pc.id
       WHERE pc.official_group_id = ?`,
      [groupId]
    );
    const rejectedPlayerIds = new Set();
    const approvedPlayerMap = new Map();
    for (const r of (clusteredRows || [])) {
      if (r.status === 'rejected') rejectedPlayerIds.add(Number(r.player_id));
      if (r.status === 'approved') approvedPlayerMap.set(Number(r.player_id), Number(r.cluster_id));
    }

    // Group players by normalized name
    const nameGroups = new Map();
    for (const p of allPlayers) {
      const key = `${(p.first_name || '').trim().toLowerCase()}|${(p.last_name || '').trim().toLowerCase()}`;
      if (!nameGroups.has(key)) nameGroups.set(key, []);
      nameGroups.get(key).push(p);
    }

    const suggestions = [];
    for (const [, players] of nameGroups) {
      pushSuggestionsForNameGroup(players, approvedPlayerMap, rejectedPlayerIds, suggestions);
    }

    suggestions.sort((a, b) => a.name.localeCompare(b.name, 'it'));
    return res.json({ suggestions });
  } catch (error) {
    console.error('[superuser] GET player-clusters/suggestions error:', error?.message || error);
    return res.status(500).json({ message: 'Errore suggerimenti cluster', error: error.message });
  }
});

// POST /player-clusters/approve-suggestion — approve or extend a cluster in one step
router.post('/player-clusters/approve-suggestion', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const groupId = Number(req.body?.official_group_id);
    const existingClusterId = req.body?.cluster_id ? Number(req.body.cluster_id) : null;
    const playerIds = Array.isArray(req.body?.player_ids) ? req.body.player_ids.map((v) => Number(v)).filter((v) => v > 0) : [];

    if (!groupId || playerIds.length === 0) return res.status(400).json({ message: 'Dati non validi' });

    try {
      await assertClusterPlayerBirthYearsCompatible(playerIds, existingClusterId);
    } catch (compatErr) {
      if (compatErr?.message === 'BIRTH_YEAR_MISMATCH') {
        return res.status(400).json({
          message: 'Anni di nascita diversi: non puoi associare omonimi con anno diverso nello stesso cluster',
          years: compatErr.years || [],
        });
      }
      throw compatErr;
    }

    const applyBirthYear = parseApplyBirthYearToClusterFlag(req.body);
    const propagationCtx = await getBirthYearPropagationContext(existingClusterId, playerIds);
    if (propagationCtx && applyBirthYear === null) {
      return res.status(409).json({
        code: 'CONFIRM_BIRTH_YEAR_PROPAGATION',
        message: 'Conferma se applicare l\'anno di nascita a tutto il cluster',
        birth_year: propagationCtx.birth_year,
        missing_count: propagationCtx.missing_count,
      });
    }

    if (existingClusterId) {
      for (const pid of playerIds) {
        const already = await query(
          `SELECT 1 FROM player_cluster_members WHERE cluster_id = ? AND player_id = ? LIMIT 1`,
          [existingClusterId, pid]
        );
        if (!(already || []).length) {
          await query(
            `INSERT INTO player_cluster_members (cluster_id, player_id, added_by) VALUES (?, ?, ?)`,
            [existingClusterId, pid, userId]
          );
        }
      }
      if (applyBirthYear === true && propagationCtx) {
        await propagateBirthYearToClusterMembers(existingClusterId, propagationCtx.birth_year);
      }
      return res.json({
        message: applyBirthYear === true
          ? 'Giocatori aggiunti e anno di nascita aggiornato su tutto il cluster'
          : 'Giocatori aggiunti al cluster esistente',
        cluster_id: existingClusterId,
        birth_year_applied: applyBirthYear === true,
      });
    }

    let ins;
    try {
      ins = await query(
        `INSERT INTO player_clusters (official_group_id, status, suggested_by_system, created_by, approved_by, approved_at)
         VALUES (?, 'approved', 1, ?, ?, NOW())
         RETURNING id`,
        [groupId, userId, userId]
      );
    } catch (insertErr) {
      if (insertErr && /approved_by|approved_at/i.test(String(insertErr.message || ''))) {
        ins = await query(
          `INSERT INTO player_clusters (official_group_id, status, suggested_by_system, created_by)
           VALUES (?, 'approved', 1, ?)
           RETURNING id`,
          [groupId, userId]
        );
      } else {
        throw insertErr;
      }
    }
    const clusterId = Number(ins?.insertId || ins?.rows?.[0]?.id || 0);
    if (!clusterId) return res.status(500).json({ message: 'Errore creazione cluster' });

    for (const pid of playerIds) {
      await query(
        `INSERT INTO player_cluster_members (cluster_id, player_id, added_by) VALUES (?, ?, ?)`,
        [clusterId, pid, userId]
      );
    }
    if (applyBirthYear === true && propagationCtx) {
      await propagateBirthYearToClusterMembers(clusterId, propagationCtx.birth_year);
    }
    return res.json({
      message: applyBirthYear === true
        ? 'Cluster creato e anno di nascita impostato su tutti i giocatori'
        : 'Cluster creato e approvato',
      cluster_id: clusterId,
      birth_year_applied: applyBirthYear === true,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Errore approvazione suggerimento', error: error.message });
  }
});

// POST /player-clusters/dismiss-suggestion — create a rejected cluster so suggestion won't appear again
router.post('/player-clusters/dismiss-suggestion', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const groupId = Number(req.body?.official_group_id);
    const playerIds = Array.isArray(req.body?.player_ids) ? req.body.player_ids.map((v) => Number(v)).filter((v) => v > 0) : [];

    if (!groupId || playerIds.length < 2) return res.status(400).json({ message: 'Dati non validi' });

    let ins;
    try {
      ins = await query(
        `INSERT INTO player_clusters (official_group_id, status, suggested_by_system, created_by, approved_by, approved_at)
         VALUES (?, 'rejected', 1, ?, ?, NOW())
         RETURNING id`,
        [groupId, userId, userId]
      );
    } catch (insertErr) {
      if (insertErr && /approved_by|approved_at/i.test(String(insertErr.message || ''))) {
        ins = await query(
          `INSERT INTO player_clusters (official_group_id, status, suggested_by_system, created_by)
           VALUES (?, 'rejected', 1, ?)
           RETURNING id`,
          [groupId, userId]
        );
      } else {
        throw insertErr;
      }
    }
    const clusterId = Number(ins?.insertId || ins?.rows?.[0]?.id || 0);
    if (!clusterId) return res.status(500).json({ message: 'Errore creazione cluster' });

    for (const pid of playerIds) {
      await query(
        `INSERT INTO player_cluster_members (cluster_id, player_id, added_by) VALUES (?, ?, ?)`,
        [clusterId, pid, userId]
      );
    }
    return res.json({ message: 'Suggerimento nascosto', cluster_id: clusterId });
  } catch (error) {
    return res.status(500).json({ message: 'Errore dismissione suggerimento', error: error.message });
  }
});

router.post('/player-clusters', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const groupId = Number(req.body?.official_group_id);
    const playerIds = Array.isArray(req.body?.player_ids) ? req.body.player_ids.map((v) => Number(v)).filter((v) => v > 0) : [];
    const status = isValidClusterStatus(req.body?.status) ? String(req.body.status) : 'pending';
    const suggestedBySystem = Number(req.body?.suggested_by_system ? 1 : 0);
    if (!groupId || playerIds.length < 2) return res.status(400).json({ message: 'Dati non validi: occorrono almeno 2 giocatori' });

    const placeholders = playerIds.map(() => '?').join(', ');
    const validPlayers = await query(
      `SELECT p.id
       FROM players p
       JOIN teams t ON p.team_id = t.id
       JOIN leagues l ON t.league_id = l.id
       WHERE p.id IN (${placeholders})
         AND l.official_group_id = ?
         AND COALESCE(l.is_official, 0) = 1`,
      [...playerIds, groupId]
    );
    if (validPlayers.length !== playerIds.length) {
      return res.status(400).json({ message: 'Alcuni giocatori non appartengono a leghe del gruppo ufficiale' });
    }

    const dupApproved = await query(
      `SELECT pcm.player_id
       FROM player_cluster_members pcm
       JOIN player_clusters pc ON pcm.cluster_id = pc.id
       WHERE pcm.player_id IN (${placeholders})
         AND pc.official_group_id = ?
         AND pc.status = 'approved'
       LIMIT 1`,
      [...playerIds, groupId]
    );
    if (dupApproved.length > 0) return res.status(400).json({ message: 'Uno o più giocatori appartengono già a un cluster approvato' });

    const clusterRows = await query(
      `INSERT INTO player_clusters (official_group_id, status, suggested_by_system, created_by)
       VALUES (?, ?, ?, ?)
       RETURNING id`,
      [groupId, status, suggestedBySystem, userId]
    );
    const clusterId = Number(clusterRows[0]?.id || 0);
    if (!clusterId) return res.status(500).json({ message: 'Errore creazione cluster' });

    for (const pid of playerIds) {
      await query(
        `INSERT INTO player_cluster_members (cluster_id, player_id, added_by)
         VALUES (?, ?, ?)`,
        [clusterId, pid, userId]
      );
    }

    return res.json({ message: 'Cluster creato con successo', cluster_id: clusterId });
  } catch (error) {
    return res.status(500).json({ message: 'Errore creazione cluster', error: error.message });
  }
});

router.get('/player-clusters/:groupId', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    await ensurePlayerClusterSchema();
    const groupId = Number(req.params.groupId);
    const statusRaw = req.query?.status != null ? String(req.query.status).trim() : '';
    const status = statusRaw && isValidClusterStatus(statusRaw) ? statusRaw : null;
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return res.status(400).json({ message: 'Group ID non valido' });
    }

    const params = [groupId];
    let statusSql = '';
    if (status) {
      statusSql = ' AND pc.status = ?';
      params.push(status);
    }

    const clustersRows = await query(
      `SELECT
         pc.id,
         pc.status,
         pc.suggested_by_system,
         pc.created_at,
         pc.approved_at,
         COUNT(DISTINCT pcm.player_id)::int AS players_count,
         COALESCE(
           json_agg(
             json_build_object(
               'id', p.id,
               'first_name', p.first_name,
               'last_name', p.last_name,
               'role', p.role,
               'birth_year', p.birth_year,
               'league_id', t.league_id,
               'league_name', l.name,
               'team_name', t.name,
               'reference_year', NULLIF(to_jsonb(l)->>'reference_year','')::int
             )
             ORDER BY l.name NULLS LAST, p.last_name, p.first_name
           ) FILTER (WHERE p.id IS NOT NULL),
           '[]'::json
         ) AS players_json
       FROM player_clusters pc
       LEFT JOIN player_cluster_members pcm ON pcm.cluster_id = pc.id
       LEFT JOIN players p ON p.id = pcm.player_id
       LEFT JOIN teams t ON t.id = p.team_id
       LEFT JOIN leagues l ON l.id = t.league_id
       WHERE pc.official_group_id = ?${statusSql}
       GROUP BY pc.id, pc.status, pc.suggested_by_system, pc.created_at, pc.approved_at
       ORDER BY pc.created_at DESC NULLS LAST, pc.id DESC`,
      params
    );

    const clusters = (clustersRows || []).map((row) => {
      const players = parseClusterPlayersJson(row.players_json);
      return {
        id: Number(row.id),
        status: row.status,
        suggested_by_system: Number(row.suggested_by_system || 0) === 1,
        created_at: row.created_at || null,
        approved_at: row.approved_at || null,
        players_count: Number(row.players_count || players.length || 0),
        players,
      };
    });

    return res.json({ clusters });
  } catch (error) {
    console.error('[superuser] GET player-clusters error:', error?.message || error);
    if (isMissingDbObjectError(error)) {
      return res.status(500).json({
        message: 'Tabelle cluster non configurate sul database',
        error: error.message,
      });
    }
    return res.status(500).json({ message: 'Errore caricamento cluster', error: error.message });
  }
});

router.put('/player-clusters/:clusterId/approve', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const clusterId = Number(req.params.clusterId);
    if (!clusterId) return res.status(400).json({ message: 'Cluster ID non valido' });

    const clusterRows = await query(
      `SELECT id, official_group_id, status
       FROM player_clusters
       WHERE id = ?
       LIMIT 1`,
      [clusterId]
    );
    const cluster = clusterRows[0];
    if (!cluster) return res.status(404).json({ message: 'Cluster non trovato' });

    const dupRows = await query(
      `SELECT pcm.player_id
       FROM player_cluster_members pcm
       JOIN player_clusters pc ON pcm.cluster_id = pc.id
       WHERE pcm.player_id IN (
         SELECT player_id FROM player_cluster_members WHERE cluster_id = ?
       )
         AND pc.id <> ?
         AND pc.official_group_id = ?
         AND pc.status = 'approved'
       LIMIT 1`,
      [clusterId, clusterId, cluster.official_group_id]
    );
    if (dupRows.length > 0) return res.status(400).json({ message: 'Uno o più giocatori appartengono già a un altro cluster approvato' });

    await query(
      `UPDATE player_clusters
       SET status = 'approved', approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
      [userId, clusterId]
    );
    return res.json({ message: 'Cluster approvato con successo' });
  } catch (error) {
    return res.status(500).json({ message: 'Errore approvazione cluster', error: error.message });
  }
});

router.put('/player-clusters/:clusterId/reject', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const clusterId = Number(req.params.clusterId);
    if (!clusterId) return res.status(400).json({ message: 'Cluster ID non valido' });

    await query(
      `UPDATE player_clusters
       SET status = 'rejected', approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
      [userId, clusterId]
    );
    return res.json({ message: 'Cluster rifiutato' });
  } catch (error) {
    return res.status(500).json({ message: 'Errore rifiuto cluster', error: error.message });
  }
});

router.post('/player-clusters/:clusterId/players', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const clusterId = Number(req.params.clusterId);
    const playerId = Number(req.body?.player_id);
    if (!clusterId || !playerId) return res.status(400).json({ message: 'Parametri non validi' });

    const clusterRows = await query(
      `SELECT id, official_group_id, status
       FROM player_clusters
       WHERE id = ?
       LIMIT 1`,
      [clusterId]
    );
    const cluster = clusterRows[0];
    if (!cluster) return res.status(404).json({ message: 'Cluster non trovato' });

    const belongsRows = await query(
      `SELECT p.id
       FROM players p
       JOIN teams t ON p.team_id = t.id
       JOIN leagues l ON t.league_id = l.id
       WHERE p.id = ?
         AND l.official_group_id = ?
         AND COALESCE(l.is_official, 0) = 1
       LIMIT 1`,
      [playerId, cluster.official_group_id]
    );
    if (!belongsRows.length) return res.status(400).json({ message: 'Il giocatore non appartiene a una lega del gruppo ufficiale' });

    if (cluster.status === 'approved') {
      const dupApproved = await query(
        `SELECT pcm.player_id
         FROM player_cluster_members pcm
         JOIN player_clusters pc ON pcm.cluster_id = pc.id
         WHERE pcm.player_id = ?
           AND pc.id <> ?
           AND pc.official_group_id = ?
           AND pc.status = 'approved'
         LIMIT 1`,
        [playerId, clusterId, cluster.official_group_id]
      );
      if (dupApproved.length > 0) return res.status(400).json({ message: 'Il giocatore appartiene già a un altro cluster approvato' });
    }

    const alreadyIn = await query(
      `SELECT player_id
       FROM player_cluster_members
       WHERE cluster_id = ? AND player_id = ?
       LIMIT 1`,
      [clusterId, playerId]
    );
    if (alreadyIn.length > 0) return res.status(400).json({ message: 'Il giocatore è già nel cluster' });

    try {
      await assertClusterPlayerBirthYearsCompatible([playerId], clusterId);
    } catch (compatErr) {
      if (compatErr?.message === 'BIRTH_YEAR_MISMATCH') {
        return res.status(400).json({
          message: 'Anni di nascita diversi: non puoi associare omonimi con anno diverso nello stesso cluster',
          years: compatErr.years || [],
        });
      }
      throw compatErr;
    }

    const applyBirthYear = parseApplyBirthYearToClusterFlag(req.body);
    const propagationCtx = await getBirthYearPropagationContext(clusterId, [playerId]);
    if (propagationCtx && applyBirthYear === null) {
      return res.status(409).json({
        code: 'CONFIRM_BIRTH_YEAR_PROPAGATION',
        message: 'Conferma se applicare l\'anno di nascita a tutto il cluster',
        birth_year: propagationCtx.birth_year,
        missing_count: propagationCtx.missing_count,
      });
    }

    await query(
      `INSERT INTO player_cluster_members (cluster_id, player_id, added_by)
       VALUES (?, ?, ?)`,
      [clusterId, playerId, userId]
    );

    if (applyBirthYear === true && propagationCtx) {
      await propagateBirthYearToClusterMembers(clusterId, propagationCtx.birth_year);
    }

    return res.json({
      message: applyBirthYear === true
        ? 'Giocatore aggiunto e anno di nascita aggiornato su tutto il cluster'
        : 'Giocatore aggiunto al cluster con successo',
      birth_year_applied: applyBirthYear === true,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiunta giocatore al cluster', error: error.message });
  }
});

router.put('/player-clusters/:clusterId/birth-year', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const clusterId = Number(req.params.clusterId);
    if (!clusterId) return res.status(400).json({ message: 'Cluster non valido' });

    const cluster = await loadClusterMeta(clusterId);
    if (!cluster) return res.status(404).json({ message: 'Cluster non trovato' });

    const parsed = parseClusterBirthYearInput(req.body?.birth_year);
    if (parsed.error === 'invalid') {
      return res.status(400).json({ message: 'Anno di nascita non valido (4 cifre, es. 1998)' });
    }
    if (parsed.error === 'range') {
      return res.status(400).json({ message: 'Anno di nascita fuori intervallo consentito' });
    }

    const birthYear = parsed.value;
    if (birthYear != null) {
      await propagateBirthYearToClusterMembers(clusterId, birthYear);
    } else {
      await query(
        `UPDATE players p
         SET birth_year = NULL
         FROM player_cluster_members pcm
         WHERE pcm.cluster_id = ?
           AND pcm.player_id = p.id`,
        [clusterId]
      );
    }

    return res.json({
      message: birthYear != null
        ? `Anno di nascita ${birthYear} applicato a tutto il cluster`
        : 'Anno di nascita rimosso per tutto il cluster',
      birth_year: birthYear,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiornamento anno di nascita', error: error.message });
  }
});

router.put('/player-clusters/:clusterId/role', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const clusterId = Number(req.params.clusterId);
    if (!clusterId) return res.status(400).json({ message: 'Cluster non valido' });

    const cluster = await loadClusterMeta(clusterId);
    if (!cluster) return res.status(404).json({ message: 'Cluster non trovato' });

    const parsed = parseClusterRoleInput(req.body?.role);
    if (parsed.error === 'invalid') {
      return res.status(400).json({ message: 'Ruolo non valido (P, D, C o A)' });
    }

    const role = parsed.value;
    await propagateRoleToClusterMembers(clusterId, role);

    return res.json({
      message: `Ruolo ${role} applicato a tutto il cluster`,
      role,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiornamento ruolo cluster', error: error.message });
  }
});

router.delete('/player-clusters/:clusterId/players/:playerId', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const clusterId = Number(req.params.clusterId);
    const playerId = Number(req.params.playerId);
    if (!clusterId || !playerId) return res.status(400).json({ message: 'Parametri non validi' });

    const clusterRows = await query(
      `SELECT id, official_group_id, status
       FROM player_clusters
       WHERE id = ?
       LIMIT 1`,
      [clusterId]
    );
    const cluster = clusterRows[0];
    if (!cluster) return res.status(404).json({ message: 'Cluster non trovato' });

    const memberRows = await query(
      `SELECT player_id
       FROM player_cluster_members
       WHERE cluster_id = ? AND player_id = ?
       LIMIT 1`,
      [clusterId, playerId]
    );
    if (!memberRows.length) return res.status(404).json({ message: 'Il giocatore non è in questo cluster' });

    await query(`DELETE FROM player_cluster_members WHERE cluster_id = ? AND player_id = ?`, [clusterId, playerId]);

    const countRows = await query(
      `SELECT COUNT(*)::int AS c FROM player_cluster_members WHERE cluster_id = ?`,
      [clusterId]
    );
    const remaining = Number(countRows[0]?.c || 0);
    let clusterDeleted = false;
    // Se resta 0 o 1 player (rimozione del penultimo), elimina tutto il cluster.
    if (remaining < 2) {
      await query(`DELETE FROM player_cluster_members WHERE cluster_id = ?`, [clusterId]);
      await query(`DELETE FROM player_clusters WHERE id = ?`, [clusterId]);
      try {
        await query(
          `DELETE FROM official_group_cluster_absolute_stats WHERE cluster_id = ?`,
          [clusterId],
        );
      } catch (_) {
        /* tabella opzionale */
      }
      clusterDeleted = true;
    }

    return res.json({
      message: clusterDeleted
        ? 'Giocatore dissociato: cluster eliminato (restava un solo membro)'
        : 'Giocatore dissociato dal cluster',
      cluster_id: clusterId,
      player_id: playerId,
      remaining_members: clusterDeleted ? 0 : remaining,
      cluster_deleted: clusterDeleted,
      cluster_rejected: false,
    });
  } catch (error) {
    console.error('[superuser] DELETE player-clusters player error:', error?.message || error);
    return res.status(500).json({ message: 'Errore dissociazione giocatore', error: error.message });
  }
});

router.put('/players/:playerId/birth-year', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const playerId = Number(req.params.playerId);
    if (!playerId || playerId <= 0) return res.status(400).json({ message: 'Player ID non valido' });

    const existing = await query(`SELECT id FROM players WHERE id = ? LIMIT 1`, [playerId]);
    if (!existing.length) return res.status(404).json({ message: 'Giocatore non trovato' });

    const parsed = parseClusterBirthYearInput(req.body?.birth_year);
    if (parsed.error === 'invalid') {
      return res.status(400).json({ message: 'Anno di nascita non valido (4 cifre, es. 1998)' });
    }
    if (parsed.error === 'range') {
      return res.status(400).json({ message: 'Anno di nascita fuori intervallo consentito' });
    }

    const birthYear = parsed.value;
    await query(`UPDATE players SET birth_year = ? WHERE id = ?`, [birthYear, playerId]);

    return res.json({
      message: birthYear != null
        ? `Anno di nascita ${birthYear} aggiornato`
        : 'Anno di nascita rimosso',
      birth_year: birthYear,
      player_id: playerId,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiornamento anno di nascita', error: error.message });
  }
});

router.put('/players/:playerId/role', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const playerId = Number(req.params.playerId);
    if (!playerId || playerId <= 0) return res.status(400).json({ message: 'Player ID non valido' });

    const existing = await query(`SELECT id FROM players WHERE id = ? LIMIT 1`, [playerId]);
    if (!existing.length) return res.status(404).json({ message: 'Giocatore non trovato' });

    const parsed = parseClusterRoleInput(req.body?.role);
    if (parsed.error === 'invalid') {
      return res.status(400).json({ message: 'Ruolo non valido (P, D, C o A)' });
    }

    const role = parsed.value;
    await query(`UPDATE players SET role = ? WHERE id = ?`, [role, playerId]);

    return res.json({
      message: `Ruolo ${role} aggiornato`,
      role,
      player_id: playerId,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiornamento ruolo', error: error.message });
  }
});

router.get('/players/search/:groupId', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const q = String(req.query?.q || '').trim();
    const leagueId = req.query?.league_id ? Number(req.query.league_id) : null;
    if (!groupId || groupId <= 0) return res.json({ players: [] });

    let leagueIds = [];
    if (leagueId && leagueId > 0) {
      leagueIds = [leagueId];
    } else {
      leagueIds = await getGroupLeagueIds(groupId);
    }
    if (!leagueIds.length) return res.json({ players: [] });

    const placeholders = leagueIds.map(() => '?').join(', ');
    const params = [...leagueIds];
    let searchSql = '';
    if (q && q.length >= 2) {
      searchSql = ' AND (LOWER(p.first_name) LIKE LOWER(?) OR LOWER(p.last_name) LIKE LOWER(?))';
      params.push(`%${q}%`, `%${q}%`);
    }

    // Nel tuo schema `players` non ha `league_id`: la lega si ricava da `teams.league_id`.
    const players = await query(
      `SELECT
         p.id,
         p.first_name,
         p.last_name,
         p.role,
         p.birth_year,
         p.rating,
         p.team_id,
         t.name AS team_name,
         t.league_id AS league_id,
         l.name AS league_name
       FROM players p
       LEFT JOIN teams t ON t.id = p.team_id
       LEFT JOIN leagues l ON l.id = t.league_id
       WHERE t.league_id IN (${placeholders})
       ${searchSql}
       ORDER BY p.last_name ASC, p.first_name ASC
       LIMIT 100`,
      params
    );
    return res.json({ players: players.map(normalizePlayerRow) });
  } catch (error) {
    return res.status(500).json({ message: 'Errore ricerca giocatori', error: error.message });
  }
});

router.post(
  '/app-loading-media',
  authenticateToken,
  requireSuperuserLevel1,
  appLoadingUpload.single('media'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'File mancante' });
      if (!allowedLoadingMime(req.file.mimetype, req.file.originalname)) {
        return res.status(400).json({ message: 'Formato non supportato (GIF, PNG, JPEG, MP4, WEBM, MOV)' });
      }
      const supabase = getSupabaseStorageClient();
      if (!supabase) {
        return res.status(500).json({
          message: 'Supabase Storage non configurato sul server (SUPABASE_SERVICE_ROLE_KEY)',
        });
      }
      await ensureAppSettingsTable();

      const ext = path.extname(String(req.file.originalname || '')).toLowerCase();
      const safeExt = ['.gif', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm', '.mov', '.m4v'].includes(ext)
        ? ext
        : '.bin';
      const filename = `app_loading_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`;
      const storagePath = `app_loading/${filename}`;
      const mediaType = guessLoadingMediaType(req.file.mimetype, req.file.originalname);

      const prevRows = await query(`SELECT loading_media_path FROM app_settings WHERE id = 1`);
      const prevPath = prevRows[0]?.loading_media_path;

      const { error: storageError } = await supabase.storage
        .from('uploads')
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype || (mediaType === 'video' ? 'video/mp4' : 'application/octet-stream'),
          upsert: true,
          cacheControl: '300',
        });
      if (storageError) {
        return res.status(500).json({ message: 'Errore upload su storage', error: storageError.message });
      }

      const dbPath = `uploads/${storagePath}`;
      await removeStoredLoadingMedia(supabase, prevPath);

      await query(
        `UPDATE app_settings SET loading_media_path = ?, loading_media_type = ?, updated_at = NOW() WHERE id = 1`,
        [dbPath, mediaType]
      );

      return res.json({ success: true, path: dbPath, type: mediaType });
    } catch (error) {
      console.error('Upload app loading media:', error);
      return res.status(500).json({ message: 'Errore upload', error: error.message });
    }
  }
);

router.delete('/app-loading-media', authenticateToken, requireSuperuserLevel1, async (_req, res) => {
  try {
    const supabase = getSupabaseStorageClient();
    await ensureAppSettingsTable();
    const prevRows = await query(`SELECT loading_media_path FROM app_settings WHERE id = 1`);
    const prevPath = prevRows[0]?.loading_media_path;
    if (supabase && prevPath) await removeStoredLoadingMedia(supabase, prevPath);
    await query(
      `UPDATE app_settings SET loading_media_path = NULL, loading_media_type = NULL, updated_at = NOW() WHERE id = 1`
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete app loading media:', error);
    return res.status(500).json({ message: 'Errore rimozione', error: error.message });
  }
});

const loginLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function allowedLogoMime(mimetype, originalname) {
  const m = String(mimetype || '').toLowerCase();
  const n = String(originalname || '').toLowerCase();
  const okMime = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(m);
  if (okMime) return true;
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].some((e) => n.endsWith(e));
}

const officialGroupLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

router.post(
  '/official-groups/:id/logo',
  authenticateToken,
  requireSuperuser,
  officialGroupLogoUpload.single('logo'),
  async (req, res) => {
    try {
      const groupId = Number(req.params.id);
      if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });
      if (!req.file) return res.status(400).json({ message: 'File logo mancante' });
      if (!allowedLogoMime(req.file.mimetype, req.file.originalname)) {
        return res.status(400).json({ message: 'Formato non supportato (PNG, JPEG, WEBP)' });
      }
      await query(`ALTER TABLE official_league_groups ADD COLUMN IF NOT EXISTS logo_path TEXT`);
      const exists = await query(`SELECT id, logo_path FROM official_league_groups WHERE id = ? LIMIT 1`, [groupId]);
      if (!exists.length) return res.status(404).json({ message: 'Gruppo non trovato' });

      const supabase = getSupabaseStorageClient();
      if (!supabase) {
        return res.status(500).json({ message: 'Supabase Storage non configurato sul server' });
      }

      const ext = path.extname(String(req.file.originalname || '')).toLowerCase();
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
      const ts = Math.floor(Date.now() / 1000);
      const filename = `official_group_${groupId}_${ts}${safeExt}`;
      const storagePath = `official_group_logos/${filename}`;

      const prevPath = exists[0]?.logo_path;
      const { error: storageError } = await supabase.storage
        .from('uploads')
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype || 'image/jpeg',
          upsert: true,
          cacheControl: '3600',
        });
      if (storageError) {
        return res.status(500).json({ message: 'Errore upload logo su Supabase Storage', error: storageError.message });
      }

      const logoPath = `uploads/${storagePath}`;
      if (prevPath && String(prevPath).startsWith('uploads/')) {
        const old = String(prevPath).replace(/^uploads\//, '');
        await supabase.storage.from('uploads').remove([old]).catch(() => {});
      }

      await query(`UPDATE official_league_groups SET logo_path = ? WHERE id = ?`, [logoPath, groupId]);
      return res.json({ success: true, logo_path: logoPath });
    } catch (error) {
      console.error('Upload official group logo:', error);
      return res.status(500).json({ message: 'Errore upload logo gruppo ufficiale', error: error.message });
    }
  }
);

router.delete('/official-groups/:id/logo', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });
    await query(`ALTER TABLE official_league_groups ADD COLUMN IF NOT EXISTS logo_path TEXT`);
    const exists = await query(`SELECT id, logo_path FROM official_league_groups WHERE id = ? LIMIT 1`, [groupId]);
    if (!exists.length) return res.status(404).json({ message: 'Gruppo non trovato' });
    const prevPath = exists[0]?.logo_path;
    const supabase = getSupabaseStorageClient();
    if (supabase && prevPath && String(prevPath).startsWith('uploads/')) {
      const old = String(prevPath).replace(/^uploads\//, '');
      await supabase.storage.from('uploads').remove([old]).catch(() => {});
    }
    await query(`UPDATE official_league_groups SET logo_path = NULL WHERE id = ?`, [groupId]);
    return res.json({ success: true });
  } catch (error) {
    console.error('Remove official group logo:', error);
    return res.status(500).json({ message: 'Errore rimozione logo gruppo ufficiale', error: error.message });
  }
});

router.post(
  '/login-logo',
  authenticateToken,
  requireSuperuserLevel1,
  loginLogoUpload.single('media'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'File mancante' });
      if (!allowedLogoMime(req.file.mimetype, req.file.originalname)) {
        return res.status(400).json({ message: 'Formato non supportato (PNG, JPEG, GIF, WEBP)' });
      }
      const supabase = getSupabaseStorageClient();
      if (!supabase) {
        return res.status(500).json({ message: 'Supabase Storage non configurato sul server' });
      }
      await ensureAppSettingsTable();

      const ext = path.extname(String(req.file.originalname || '')).toLowerCase();
      const safeExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) ? ext : '.png';
      const filename = `login_logo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`;
      const storagePath = `login_logo/${filename}`;

      const prevRows = await query(`SELECT login_logo_path FROM app_settings WHERE id = 1`);
      const prevPath = prevRows[0]?.login_logo_path;

      const { error: storageError } = await supabase.storage
        .from('uploads')
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype || 'image/png',
          upsert: true,
          cacheControl: '300',
        });
      if (storageError) {
        return res.status(500).json({ message: 'Errore upload su storage', error: storageError.message });
      }

      const dbPath = `uploads/${storagePath}`;
      if (prevPath && String(prevPath).startsWith('uploads/')) {
        const old = String(prevPath).replace(/^uploads\//, '');
        await supabase.storage.from('uploads').remove([old]).catch(() => {});
      }

      await query(
        `UPDATE app_settings SET login_logo_path = ?, updated_at = NOW() WHERE id = 1`,
        [dbPath]
      );

      return res.json({ success: true, path: dbPath });
    } catch (error) {
      console.error('Upload login logo:', error);
      return res.status(500).json({ message: 'Errore upload', error: error.message });
    }
  }
);

router.delete('/login-logo', authenticateToken, requireSuperuserLevel1, async (_req, res) => {
  try {
    const supabase = getSupabaseStorageClient();
    await ensureAppSettingsTable();
    const prevRows = await query(`SELECT login_logo_path FROM app_settings WHERE id = 1`);
    const prevPath = prevRows[0]?.login_logo_path;
    if (supabase && prevPath && String(prevPath).startsWith('uploads/')) {
      const old = String(prevPath).replace(/^uploads\//, '');
      await supabase.storage.from('uploads').remove([old]).catch(() => {});
    }
    await query(`UPDATE app_settings SET login_logo_path = NULL, updated_at = NOW() WHERE id = 1`);
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete login logo:', error);
    return res.status(500).json({ message: 'Errore rimozione', error: error.message });
  }
});

const loginBackgroundUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

async function removeStoredLoginBackground(supabase, prevPath) {
  if (!supabase || !prevPath || !String(prevPath).startsWith('uploads/')) return;
  const old = String(prevPath).replace(/^uploads\//, '');
  await supabase.storage.from('uploads').remove([old]).catch(() => {});
}

router.post(
  '/login-background',
  authenticateToken,
  requireSuperuserLevel1,
  loginBackgroundUpload.single('media'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'File mancante' });
      if (!allowedLogoMime(req.file.mimetype, req.file.originalname)) {
        return res.status(400).json({ message: 'Formato non supportato (PNG, JPEG, GIF, WEBP)' });
      }
      const supabase = getSupabaseStorageClient();
      if (!supabase) {
        return res.status(500).json({ message: 'Supabase Storage non configurato sul server' });
      }
      await ensureAppSettingsTable();

      const ext = path.extname(String(req.file.originalname || '')).toLowerCase();
      const safeExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) ? ext : '.jpg';
      const filename = `login_bg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`;
      const storagePath = `login_background/${filename}`;

      const prevRows = await query(`SELECT login_background_path FROM app_settings WHERE id = 1`);
      const prevPath = prevRows[0]?.login_background_path;

      const { error: storageError } = await supabase.storage
        .from('uploads')
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype || 'image/jpeg',
          upsert: true,
          cacheControl: '300',
        });
      if (storageError) {
        return res.status(500).json({ message: 'Errore upload su storage', error: storageError.message });
      }

      const dbPath = `uploads/${storagePath}`;
      await removeStoredLoginBackground(supabase, prevPath);

      await query(
        `UPDATE app_settings SET login_background_path = ?, updated_at = NOW() WHERE id = 1`,
        [dbPath]
      );

      return res.json({ success: true, path: dbPath });
    } catch (error) {
      console.error('Upload login background:', error);
      return res.status(500).json({ message: 'Errore upload', error: error.message });
    }
  }
);

router.delete('/login-background', authenticateToken, requireSuperuserLevel1, async (_req, res) => {
  try {
    const supabase = getSupabaseStorageClient();
    await ensureAppSettingsTable();
    const prevRows = await query(`SELECT login_background_path FROM app_settings WHERE id = 1`);
    const prevPath = prevRows[0]?.login_background_path;
    await removeStoredLoginBackground(supabase, prevPath);
    await query(`UPDATE app_settings SET login_background_path = NULL, updated_at = NOW() WHERE id = 1`);
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete login background:', error);
    return res.status(500).json({ message: 'Errore rimozione', error: error.message });
  }
});

const matchBackgroundUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

async function removeStoredMatchBackground(supabase, prevPath) {
  if (!supabase || !prevPath || !String(prevPath).startsWith('uploads/')) return;
  // Non cancellare lo sfondo predefinito bundled nell'app
  if (String(prevPath) === 'uploads/match_background/match_bg_campo_dark.jpg') return;
  const old = String(prevPath).replace(/^uploads\//, '');
  await supabase.storage.from('uploads').remove([old]).catch(() => {});
}

router.post(
  '/match-background',
  authenticateToken,
  requireSuperuserLevel1,
  matchBackgroundUpload.single('media'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'File mancante' });
      if (!allowedLogoMime(req.file.mimetype, req.file.originalname)) {
        return res.status(400).json({ message: 'Formato non supportato (PNG, JPEG, GIF, WEBP)' });
      }
      const supabase = getSupabaseStorageClient();
      if (!supabase) {
        return res.status(500).json({ message: 'Supabase Storage non configurato sul server' });
      }
      await ensureAppSettingsTable();

      const ext = path.extname(String(req.file.originalname || '')).toLowerCase();
      const safeExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) ? ext : '.jpg';
      const filename = `match_bg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`;
      const storagePath = `match_background/${filename}`;

      const prevRows = await query(`SELECT match_background_path FROM app_settings WHERE id = 1`);
      const prevPath = prevRows[0]?.match_background_path;

      const { error: storageError } = await supabase.storage
        .from('uploads')
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype || 'image/jpeg',
          upsert: true,
          cacheControl: '300',
        });
      if (storageError) {
        return res.status(500).json({ message: 'Errore upload su storage', error: storageError.message });
      }

      const dbPath = `uploads/${storagePath}`;
      await removeStoredMatchBackground(supabase, prevPath);

      await query(
        `UPDATE app_settings SET match_background_path = ?, updated_at = NOW() WHERE id = 1`,
        [dbPath]
      );

      return res.json({ success: true, path: dbPath });
    } catch (error) {
      console.error('Upload match background:', error);
      return res.status(500).json({ message: 'Errore upload', error: error.message });
    }
  }
);

router.delete('/match-background', authenticateToken, requireSuperuserLevel1, async (_req, res) => {
  try {
    const supabase = getSupabaseStorageClient();
    await ensureAppSettingsTable();
    const prevRows = await query(`SELECT match_background_path FROM app_settings WHERE id = 1`);
    const prevPath = prevRows[0]?.match_background_path;
    await removeStoredMatchBackground(supabase, prevPath);
    await query(`UPDATE app_settings SET match_background_path = NULL, updated_at = NOW() WHERE id = 1`);
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete match background:', error);
    return res.status(500).json({ message: 'Errore rimozione', error: error.message });
  }
});

module.exports = router;

const express = require('express');
const path = require('path');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { ensureAppSettingsTable } = require('../utils/appSettingsStore');

let superuserTablesReady = false;
async function ensureSuperuserTables() {
  if (superuserTablesReady) return;
  try {
    superuserTablesReady = true;
  } catch (_) {}
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

router.get('/leagues', authenticateToken, requireSuperuser, async (_req, res) => {
  try {
    await ensureSuperuserTables();
    const rows = await query(
      `SELECT l.id, l.name, COALESCE(l.is_official, 0) AS is_official, l.official_group_id, COALESCE(l.is_visible_for_linking, 1) AS is_visible_for_linking,
              COALESCE(l.is_hidden_from_discovery, 0) AS is_hidden_from_discovery,
              og.name AS official_group_name
       FROM leagues l
       LEFT JOIN official_league_groups og ON og.id = l.official_group_id
       ORDER BY l.id DESC`
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
    next = Number(rows[0]?.current || 1) ? 0 : 1;
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
    const rows = await query(
      `SELECT og.id, og.name, og.description, og.created_by, og.created_at,
              COALESCE(u.username, '') AS created_by_username,
              COUNT(l.id)::int AS league_count
       FROM official_league_groups og
       LEFT JOIN leagues l ON l.official_group_id = og.id
       LEFT JOIN users u ON u.id = og.created_by
       GROUP BY og.id, og.name, og.description, og.created_by, og.created_at, u.username
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
    const groupId = Number(req.params.id);
    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });

    const groupRows = await query(
      `SELECT id, name
       FROM official_league_groups
       WHERE id = ?
       LIMIT 1`,
      [groupId]
    );
    if (!groupRows.length) return res.status(404).json({ message: 'Gruppo non trovato' });

    const leagues = await query(
      `SELECT l.id, l.name, l.access_code, l.created_at,
              NULLIF(to_jsonb(l)->>'reference_year','')::int AS reference_year,
              COALESCE(l.is_official_squad_public, 0) AS is_official_squad_public,
              COUNT(DISTINCT lm.user_id)::int AS member_count
       FROM leagues l
       LEFT JOIN league_members lm ON lm.league_id = l.id
       WHERE l.official_group_id = ?
       GROUP BY l.id, l.name, l.access_code, l.created_at, NULLIF(to_jsonb(l)->>'reference_year','')::int, l.is_official_squad_public
       ORDER BY l.created_at DESC, l.id DESC`,
      [groupId]
    );
    return res.json({
      group: { id: Number(groupRows[0].id), name: groupRows[0].name },
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
      return res.json({ ok: true, league_id: leagueId, is_official_squad_public: next });
    } catch (error) {
      return res.status(500).json({ message: 'Errore aggiornamento pubblicazione rosa ufficiale', error: error.message });
    }
  }
);

router.get('/player-clusters/suggestions/:groupId', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    if (!groupId || groupId <= 0) return res.json({ suggestions: [] });

    const leagueIds = await getGroupLeagueIds(groupId);
    if (!leagueIds.length) return res.json({ suggestions: [] });

    const ph = leagueIds.map(() => '?').join(', ');

    // All players in the group's leagues with their league info
    const allPlayers = await query(
      `SELECT p.id, p.first_name, p.last_name, t.league_id, l.name AS league_name
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
      if (players.length < 2) continue;

      // Skip if ALL players are in a rejected cluster
      const nonRejected = players.filter((p) => !rejectedPlayerIds.has(Number(p.id)));
      if (nonRejected.length < 2) continue;

      const existingLeagues = [];
      const newLeagues = [];
      let clusterId = null;

      for (const p of nonRejected) {
        const pid = Number(p.id);
        if (approvedPlayerMap.has(pid)) {
          if (!clusterId) clusterId = approvedPlayerMap.get(pid);
          existingLeagues.push({ player_id: pid, league_id: Number(p.league_id), league_name: p.league_name || '-' });
        } else {
          newLeagues.push({ player_id: pid, league_id: Number(p.league_id), league_name: p.league_name || '-' });
        }
      }

      if (newLeagues.length === 0) continue;

      const first = nonRejected[0];
      const fullName = `${(first.first_name || '').trim()} ${(first.last_name || '').trim()}`.trim();

      suggestions.push({
        name: fullName,
        cluster_id: clusterId,
        existing_leagues: existingLeagues,
        new_leagues: newLeagues,
        all_new_player_ids: newLeagues.map((l) => l.player_id),
      });
    }

    suggestions.sort((a, b) => a.name.localeCompare(b.name, 'it'));
    return res.json({ suggestions });
  } catch (error) {
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
      return res.json({ message: 'Giocatori aggiunti al cluster esistente', cluster_id: existingClusterId });
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
    return res.json({ message: 'Cluster creato e approvato', cluster_id: clusterId });
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
    const groupId = Number(req.params.groupId);
    const status = req.query?.status ? String(req.query.status) : null;
    if (!groupId) return res.status(400).json({ message: 'Group ID non valido' });

    const clustersRows = await query(
      `SELECT pc.id, pc.status, pc.suggested_by_system, pc.created_at, pc.approved_at,
              COUNT(pcm.player_id)::int AS players_count
       FROM player_clusters pc
       LEFT JOIN player_cluster_members pcm ON pc.id = pcm.cluster_id
       WHERE pc.official_group_id = ?
         ${status ? "AND pc.status = ?" : ""}
       GROUP BY pc.id, pc.status, pc.suggested_by_system, pc.created_at, pc.approved_at
       ORDER BY pc.created_at DESC, pc.id DESC`,
      status ? [groupId, status] : [groupId]
    );

    const clusters = [];
    for (const row of (clustersRows || [])) {
      const players = await query(
        `SELECT p.id, p.first_name, p.last_name, p.role, t.league_id, l.name AS league_name
         FROM player_cluster_members pcm
         JOIN players p ON pcm.player_id = p.id
         JOIN teams t ON p.team_id = t.id
         JOIN leagues l ON t.league_id = l.id
         WHERE pcm.cluster_id = ?
         ORDER BY l.name, p.last_name, p.first_name`,
        [row.id]
      );
      clusters.push({
        id: Number(row.id),
        status: row.status,
        suggested_by_system: Number(row.suggested_by_system || 0) === 1,
        created_at: row.created_at || null,
        approved_at: row.approved_at || null,
        players_count: Number(row.players_count || 0),
        players: players.map((p) => ({
          id: Number(p.id),
          first_name: p.first_name,
          last_name: p.last_name,
          full_name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
          role: p.role,
          league_id: Number(p.league_id || 0),
          league_name: p.league_name || '',
        })),
      });
    }
    return res.json({ clusters });
  } catch (error) {
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

    await query(
      `INSERT INTO player_cluster_members (cluster_id, player_id, added_by)
       VALUES (?, ?, ?)`,
      [clusterId, playerId, userId]
    );

    return res.json({ message: 'Giocatore aggiunto al cluster con successo' });
  } catch (error) {
    return res.status(500).json({ message: 'Errore aggiunta giocatore al cluster', error: error.message });
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

module.exports = router;

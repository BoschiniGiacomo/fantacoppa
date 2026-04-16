const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

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
    // Nel DB legacy alcune colonne (es. is_online, last_login) possono non esistere.
    // Evitiamo query "ottimistiche" che generano errori rumorosi nei log.
    const rows = await query(
      `SELECT
         u.id,
         u.username,
         u.email,
         COALESCE(u.is_superuser, 0) AS is_superuser,
         0 AS is_online,
         NULLIF(to_jsonb(u)->>'last_login', '')::timestamp AS last_login
       FROM users u
       ORDER BY u.username ASC, u.id ASC`
    );
    return res.json(rows);
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

router.get('/leagues', authenticateToken, requireSuperuser, async (_req, res) => {
  try {
    await ensureSuperuserTables();
    const rows = await query(
      `SELECT l.id, l.name, COALESCE(l.is_official, 0) AS is_official, l.official_group_id, COALESCE(l.is_visible_for_linking, 1) AS is_visible_for_linking,
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
              COUNT(DISTINCT lm.user_id)::int AS member_count
       FROM leagues l
       LEFT JOIN league_members lm ON lm.league_id = l.id
       WHERE l.official_group_id = ?
       GROUP BY l.id, l.name, l.access_code, l.created_at
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

router.get('/player-clusters/suggestions/:groupId', authenticateToken, requireSuperuser, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    if (!groupId || groupId <= 0) return res.json({ suggestions: [] });

    const leagueIds = await getGroupLeagueIds(groupId);
    if (!leagueIds.length) return res.json({ suggestions: [] });

    const placeholders = leagueIds.map(() => '?').join(', ');
    const suggestions = await query(
      `SELECT p1.id AS player_id_1, p1.first_name, p1.last_name, t1.league_id AS league_id_1, l1.name AS league_name_1,
              p2.id AS player_id_2, t2.league_id AS league_id_2, l2.name AS league_name_2
       FROM players p1
       JOIN teams t1 ON p1.team_id = t1.id
       JOIN leagues l1 ON t1.league_id = l1.id
       JOIN players p2 ON p1.first_name = p2.first_name AND p1.last_name = p2.last_name AND p1.id < p2.id
       JOIN teams t2 ON p2.team_id = t2.id
       JOIN leagues l2 ON t2.league_id = l2.id
       WHERE t1.league_id IN (${placeholders}) AND t2.league_id IN (${placeholders})
         AND t1.league_id <> t2.league_id
         AND NOT EXISTS (
           SELECT 1
           FROM player_cluster_members pcm1
           JOIN player_clusters pc ON pcm1.cluster_id = pc.id
           WHERE (pcm1.player_id = p1.id OR pcm1.player_id = p2.id)
             AND pc.official_group_id = ?
         )
       GROUP BY p1.id, p2.id, p1.first_name, p1.last_name, t1.league_id, l1.name, t2.league_id, l2.name
       ORDER BY p1.last_name, p1.first_name
       LIMIT 200`,
      [...leagueIds, ...leagueIds, groupId]
    );

    const mapped = suggestions.map((row) => ({
      player_1: {
        id: Number(row.player_id_1),
        name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
        league_id: Number(row.league_id_1),
        league_name: row.league_name_1 || '-',
      },
      player_2: {
        id: Number(row.player_id_2),
        name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
        league_id: Number(row.league_id_2),
        league_name: row.league_name_2 || '-',
      },
    }));

    return res.json({ suggestions: mapped });
  } catch (error) {
    return res.status(500).json({ message: 'Errore suggerimenti cluster', error: error.message });
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
    for (const row of clustersRows) {
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

module.exports = router;

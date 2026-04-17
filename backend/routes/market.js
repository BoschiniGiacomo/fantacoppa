const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

function toLeagueId(raw) {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function getLeagueMarketFlags(leagueId) {
  const rows = await query(
    `SELECT COALESCE(market_locked, 0)::int AS market_locked,
            COALESCE(require_approval, 0)::int AS require_approval
     FROM league_market_settings
     WHERE league_id = ?
     LIMIT 1`,
    [leagueId]
  );
  if (rows.length === 0) {
    return { market_locked: 0, require_approval: 0 };
  }
  return {
    market_locked: Number(rows[0]?.market_locked || 0),
    require_approval: Number(rows[0]?.require_approval || 0),
  };
}

async function getUserMarketBlockValue(leagueId, userId) {
  const rows = await query(
    `SELECT COALESCE(blocked, 0)::int AS blocked
     FROM user_market_blocks
     WHERE league_id = ? AND user_id = ?
     LIMIT 1`,
    [leagueId, userId]
  );
  return Number(rows[0]?.blocked || 0);
}

async function getEffectiveSourceLeagueId(leagueId) {
  try {
    const rows = await query(
      `SELECT linked_to_league_id
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [leagueId]
    );
    const linked = Number(rows[0]?.linked_to_league_id || 0);
    return linked > 0 ? linked : leagueId;
  } catch (_) {
    return leagueId;
  }
}

function isUserEffectivelyBlocked(marketLocked, userBlockValue) {
  // market_locked=0 => blocked=1 blocks single user
  // market_locked=1 => blocked=1 is exception (user unblocked)
  return Number(marketLocked) === 1
    ? Number(userBlockValue) !== 1
    : Number(userBlockValue) === 1;
}

let manageSettingsTableReady = false;
async function ensureManageSettingsTable() {
  // Disabled: fallback table removed by user request.
  manageSettingsTableReady = true;
}

// GET /api/market/:leagueId/players
router.get('/:leagueId/players', authenticateToken, async (req, res) => {
  try {
    const leagueId = toLeagueId(req.params.leagueId);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const role = String(req.query?.role || '').trim();
    const search = String(req.query?.search || '').trim();
    const userId = Number(req.user.userId);
    const sourceLeagueId = await getEffectiveSourceLeagueId(leagueId);

    let sql = `
      SELECT p.id, p.first_name, p.last_name, p.role, p.rating,
             COALESCE(t.name, '') AS team_name,
             CASE
               WHEN EXISTS (
                 SELECT 1
                 FROM user_players up
                 WHERE up.player_id = p.id
                   AND up.user_id = ?
                   AND up.league_id = ?
                 LIMIT 1
               ) THEN 1
               ELSE 0
             END AS owned
      FROM players p
      JOIN teams t
        ON t.id = p.team_id
       AND t.league_id = ?
      WHERE 1=1
    `;
    const params = [userId, leagueId, sourceLeagueId];
    if (role) {
      sql += ' AND p.role = ?';
      params.push(role);
    }
    if (search) {
      sql += ' AND (p.first_name ILIKE ? OR p.last_name ILIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY p.rating DESC, p.last_name ASC LIMIT 1000';
    const rows = await query(sql, params);
    res.json(rows);
  } catch (error) {
    console.error('Market players error:', error);
    res.status(500).json({ message: 'Errore caricamento giocatori mercato' });
  }
});

// GET /api/market/:leagueId/budget
router.get('/:leagueId/budget', authenticateToken, async (req, res) => {
  try {
    const leagueId = toLeagueId(req.params.leagueId);
    const userId = Number(req.user.userId);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const rows = await query(
      `SELECT budget
       FROM user_budget
       WHERE user_id = ? AND league_id = ?
       LIMIT 1`,
      [userId, leagueId]
    );
    res.json({ budget: Number(rows[0]?.budget || 0) });
  } catch (error) {
    console.error('Market budget error:', error);
    res.status(500).json({ message: 'Errore recupero budget' });
  }
});

// GET /api/market/:leagueId/blocked
router.get('/:leagueId/blocked', authenticateToken, async (req, res) => {
  try {
    const leagueId = toLeagueId(req.params.leagueId);
    const userId = Number(req.user.userId);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const flags = await getLeagueMarketFlags(leagueId);
    const userBlockValue = await getUserMarketBlockValue(leagueId, userId);
    const globalBlocked = Number(flags.market_locked) === 1;
    const userBlocked = isUserEffectivelyBlocked(flags.market_locked, userBlockValue);
    return res.json({
      blocked: userBlocked,
      global_blocked: globalBlocked,
      user_blocked_raw: Number(userBlockValue || 0),
      block_reason: userBlocked
        ? (globalBlocked ? 'global' : 'user')
        : 'none',
    });
  } catch (error) {
    console.error('Market blocked error:', error);
    res.status(500).json({ message: 'Errore stato mercato' });
  }
});

// POST /api/market/:leagueId/buy
router.post('/:leagueId/buy', authenticateToken, async (req, res) => {
  try {
    const leagueId = toLeagueId(req.params.leagueId);
    const userId = Number(req.user.userId);
    const playerId = Number(req.body?.playerId);
    if (!leagueId || !Number.isFinite(playerId) || playerId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    const sourceLeagueId = await getEffectiveSourceLeagueId(leagueId);

    const flags = await getLeagueMarketFlags(leagueId);
    const userBlockValue = await getUserMarketBlockValue(leagueId, userId);
    if (isUserEffectivelyBlocked(flags.market_locked, userBlockValue)) {
      return res.status(400).json({ message: 'Il mercato è bloccato per il tuo account' });
    }

    const pRows = await query(
      `SELECT p.id, p.role, p.rating
       FROM players p
       JOIN teams t ON t.id = p.team_id
       WHERE p.id = ? AND t.league_id = ?
       LIMIT 1`,
      [playerId, sourceLeagueId]
    );
    const p = pRows[0];
    if (!p) return res.status(404).json({ message: 'Giocatore non trovato' });

    const alreadyOwned = await query(
      'SELECT 1 FROM user_players WHERE user_id = ? AND league_id = ? AND player_id = ? LIMIT 1',
      [userId, leagueId, playerId]
    );
    if (alreadyOwned.length > 0) return res.status(400).json({ message: 'Giocatore già acquistato' });

    const budgetRows = await query('SELECT budget FROM user_budget WHERE user_id = ? AND league_id = ? LIMIT 1', [userId, leagueId]);
    const budget = Number(budgetRows[0]?.budget || 0);
    const price = Number(p.rating || 0);
    if (budget < price) return res.status(400).json({ message: 'Budget insufficiente' });

    const limitsRows = await query(
      'SELECT max_portieri, max_difensori, max_centrocampisti, max_attaccanti FROM leagues WHERE id = ? LIMIT 1',
      [leagueId]
    );
    const l = limitsRows[0] || {};
    const roleLimitMap = { P: Number(l.max_portieri || 0), D: Number(l.max_difensori || 0), C: Number(l.max_centrocampisti || 0), A: Number(l.max_attaccanti || 0) };
    const countRows = await query(
      `SELECT COUNT(*)::int AS c
       FROM user_players up
       JOIN players p ON p.id = up.player_id
       WHERE up.user_id = ? AND up.league_id = ? AND p.role = ?`,
      [userId, leagueId, p.role]
    );
    const owned = Number(countRows[0]?.c || 0);
    if (owned >= (roleLimitMap[p.role] || 0)) return res.status(400).json({ message: 'Limite ruolo raggiunto' });

    await query('INSERT INTO user_players (user_id, league_id, player_id) VALUES (?, ?, ?)', [userId, leagueId, playerId]);
    await query('UPDATE user_budget SET budget = budget - ? WHERE user_id = ? AND league_id = ?', [price, userId, leagueId]);
    res.json({ message: 'Giocatore acquistato con successo' });
  } catch (error) {
    console.error('Market buy error:', error);
    res.status(500).json({ message: 'Errore acquisto giocatore' });
  }
});

// GET /api/market/:leagueId/manage
router.get('/:leagueId/manage', authenticateToken, async (req, res) => {
  try {
    const leagueId = toLeagueId(req.params.leagueId);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    let marketLocked = 0;
    let requireApproval = 0;
    const flags = await getLeagueMarketFlags(leagueId);
    marketLocked = Number(flags.market_locked || 0);
    requireApproval = Number(flags.require_approval || 0);
    let members = [];
    try {
      members = await query(
        `SELECT lm.user_id, u.username,
                COALESCE(ub.team_name, u.username) AS team_name,
                COALESCE(ub.coach_name, '') AS coach_name,
                COALESCE(umb.blocked, 0) AS blocked
         FROM league_members lm
         JOIN users u ON u.id = lm.user_id
         LEFT JOIN user_budget ub ON ub.user_id = lm.user_id AND ub.league_id = lm.league_id
         LEFT JOIN user_market_blocks umb ON umb.user_id = lm.user_id AND umb.league_id = lm.league_id
         WHERE lm.league_id = ?
         ORDER BY u.username ASC`,
        [leagueId]
      );
    } catch (_) {
      members = [];
    }
    return res.json({ market_locked: marketLocked, require_approval: requireApproval, members });
  } catch (error) {
    console.error('Market manage get error:', error);
    res.status(500).json({ message: 'Errore caricamento impostazioni mercato' });
  }
});

// POST /api/market/:leagueId/manage
router.post('/:leagueId/manage', authenticateToken, async (req, res) => {
  try {
    const leagueId = toLeagueId(req.params.leagueId);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const setting = String(req.body?.setting || '').trim();
    const value = Number(req.body?.value ? 1 : 0);
    if (!['market_locked', 'require_approval'].includes(setting)) {
      return res.status(400).json({ message: 'Setting non supportato' });
    }
    try {
      await query(
        `INSERT INTO league_market_settings (league_id, market_locked, require_approval)
         VALUES (?, 0, 0)
         ON CONFLICT (league_id) DO NOTHING`,
        [leagueId]
      );
      await query(
        `UPDATE league_market_settings
         SET ${setting} = ?
         WHERE league_id = ?`,
        [value, leagueId]
      );
    } catch (_) {
      return res.status(500).json({ message: 'Errore aggiornamento impostazione mercato' });
    }
    res.json({ message: 'Impostazione mercato aggiornata' });
  } catch (error) {
    console.error('Market manage post error:', error);
    res.status(500).json({ message: 'Errore aggiornamento impostazioni mercato' });
  }
});

// POST /api/market/:leagueId/user-block
router.post('/:leagueId/user-block', authenticateToken, async (req, res) => {
  try {
    const leagueId = toLeagueId(req.params.leagueId);
    const targetUserId = Number(req.body?.user_id);
    const blocked = Number(req.body?.blocked ? 1 : 0);
    if (!leagueId || !Number.isFinite(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    await query(
      `INSERT INTO user_market_blocks (league_id, user_id, blocked)
       VALUES (?, ?, ?)
       ON CONFLICT (league_id, user_id)
       DO UPDATE SET blocked = EXCLUDED.blocked`,
      [leagueId, targetUserId, blocked]
    );
    const verifyRows = await query(
      `SELECT COALESCE(blocked, 0)::int AS blocked
       FROM user_market_blocks
       WHERE league_id = ? AND user_id = ?
       LIMIT 1`,
      [leagueId, targetUserId]
    );
    res.json({ message: 'Blocco utente aggiornato' });
  } catch (error) {
    console.error('Market user block error:', error);
    res.status(500).json({ message: 'Errore aggiornamento blocco utente' });
  }
});

module.exports = router;

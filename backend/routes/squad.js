const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// GET /api/squad/:leagueId
router.get('/:leagueId', authenticateToken, async (req, res) => {
  try {
    const leagueId = Number(req.params.leagueId);
    const userId = Number(req.user.userId);
    if (!Number.isFinite(leagueId) || leagueId <= 0) {
      return res.status(400).json({ message: 'League ID non valido' });
    }

    const players = await query(
      `SELECT p.id, p.first_name, p.last_name, p.role, p.rating,
              COALESCE(t.name, '') AS team_name
       FROM user_players up
       JOIN players p ON p.id = up.player_id
       LEFT JOIN teams t ON t.id = p.team_id
       WHERE up.user_id = ? AND up.league_id = ?`,
      [userId, leagueId]
    );
    res.json({ squad: players, players });
  } catch (error) {
    console.error('Squad get error:', error);
    res.json({ squad: [], players: [] });
  }
});

// GET /api/squad/:leagueId/bootstrap
// Payload aggregato per schermata Rosa (caricamento iniziale/refresh).
router.get('/:leagueId/bootstrap', authenticateToken, async (req, res) => {
  try {
    const leagueId = Number(req.params.leagueId);
    const userId = Number(req.user.userId);
    if (!Number.isFinite(leagueId) || leagueId <= 0) {
      return res.status(400).json({ message: 'League ID non valido' });
    }

    const [players, limitsRows, budgetRows, blockedRows, leagueRows] = await Promise.all([
      query(
        `SELECT p.id, p.first_name, p.last_name, p.role, p.rating,
                COALESCE(t.name, '') AS team_name
         FROM user_players up
         JOIN players p ON p.id = up.player_id
         LEFT JOIN teams t ON t.id = p.team_id
         WHERE up.user_id = ? AND up.league_id = ?`,
        [userId, leagueId]
      ),
      query(
        `SELECT max_portieri, max_difensori, max_centrocampisti, max_attaccanti
         FROM leagues
         WHERE id = ?
         LIMIT 1`,
        [leagueId]
      ),
      query(
        `SELECT budget
         FROM user_budget
         WHERE user_id = ? AND league_id = ?
         LIMIT 1`,
        [userId, leagueId]
      ),
      query(
        `SELECT COALESCE(lms.market_locked, 0)::int AS market_locked,
                COALESCE(umb.blocked, 0)::int AS user_blocked
         FROM (SELECT 1) AS x
         LEFT JOIN league_market_settings lms ON lms.league_id = ?
         LEFT JOIN user_market_blocks umb ON umb.league_id = ? AND umb.user_id = ?
         LIMIT 1`,
        [leagueId, leagueId, userId]
      ),
      query(
        `SELECT id, name, initial_budget
         FROM leagues
         WHERE id = ?
         LIMIT 1`,
        [leagueId]
      ),
    ]);

    const limits = limitsRows[0] || {};
    const role_limits = {
      P: Number(limits.max_portieri || 0),
      D: Number(limits.max_difensori || 0),
      C: Number(limits.max_centrocampisti || 0),
      A: Number(limits.max_attaccanti || 0),
    };
    const budget = Number(budgetRows[0]?.budget || 0);
    const total_value = (players || []).reduce((sum, p) => sum + (Number(p?.rating) || 0), 0);

    const marketLocked = Number(blockedRows[0]?.market_locked || 0) === 1;
    const userBlockedRaw = Number(blockedRows[0]?.user_blocked || 0);
    const market_blocked = marketLocked ? userBlockedRaw !== 1 : userBlockedRaw === 1;

    const league = leagueRows[0] || { id: leagueId, name: '' };

    return res.json({
      league,
      squad: players || [],
      players: players || [],
      budget,
      total_value: Number(total_value.toFixed(2)),
      role_limits,
      market_blocked,
    });
  } catch (error) {
    console.error('Squad bootstrap error:', error);
    return res.status(500).json({ message: 'Errore caricamento dati rosa' });
  }
});

// GET /api/squad/:leagueId/limits
router.get('/:leagueId/limits', authenticateToken, async (req, res) => {
  try {
    const leagueId = Number(req.params.leagueId);
    if (!Number.isFinite(leagueId) || leagueId <= 0) {
      return res.status(400).json({ message: 'League ID non valido' });
    }
    const rows = await query(
      `SELECT max_portieri, max_difensori, max_centrocampisti, max_attaccanti
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [leagueId]
    );
    const l = rows[0] || {};
    res.json({
      P: Number(l.max_portieri || 0),
      D: Number(l.max_difensori || 0),
      C: Number(l.max_centrocampisti || 0),
      A: Number(l.max_attaccanti || 0),
    });
  } catch (_) {
    res.json({ P: 0, D: 0, C: 0, A: 0 });
  }
});

// DELETE /api/squad/:leagueId/players/:playerId
router.delete('/:leagueId/players/:playerId', authenticateToken, async (req, res) => {
  try {
    const leagueId = Number(req.params.leagueId);
    const playerId = Number(req.params.playerId);
    const userId = Number(req.user.userId);
    if (!Number.isFinite(leagueId) || leagueId <= 0 || !Number.isFinite(playerId) || playerId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }

    const pRows = await query('SELECT rating FROM players WHERE id = ? LIMIT 1', [playerId]);
    const price = Number(pRows[0]?.rating || 0);

    await query('DELETE FROM user_players WHERE user_id = ? AND league_id = ? AND player_id = ?', [userId, leagueId, playerId]);
    await query('UPDATE user_budget SET budget = budget + ? WHERE user_id = ? AND league_id = ?', [price, userId, leagueId]);
    res.json({ message: 'Giocatore rimosso dalla rosa' });
  } catch (error) {
    console.error('Squad remove error:', error);
    res.status(500).json({ message: 'Errore durante la rimozione del giocatore' });
  }
});

module.exports = router;

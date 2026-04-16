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

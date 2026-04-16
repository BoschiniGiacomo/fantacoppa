const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// GET /api/teams/:leagueId
router.get('/:leagueId', authenticateToken, async (req, res) => {
  try {
    const leagueId = Number(req.params.leagueId);
    if (!Number.isFinite(leagueId) || leagueId <= 0) {
      return res.status(400).json({ message: 'League ID non valido' });
    }

    const rows = await query(
      `SELECT u.id, u.username,
              ub.team_name, ub.coach_name, ub.team_logo, ub.budget
       FROM league_members lm
       JOIN users u ON u.id = lm.user_id
       LEFT JOIN user_budget ub ON ub.user_id = lm.user_id AND ub.league_id = lm.league_id
       WHERE lm.league_id = ?
       ORDER BY u.username ASC`,
      [leagueId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Get teams list error:', error);
    res.status(500).json({ message: 'Errore caricamento squadre' });
  }
});

// GET /api/teams/:leagueId/:userId
router.get('/:leagueId/:userId', authenticateToken, async (req, res) => {
  try {
    const leagueId = Number(req.params.leagueId);
    const userId = Number(req.params.userId);
    if (!Number.isFinite(leagueId) || leagueId <= 0 || !Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }

    const teamRows = await query(
      `SELECT u.id, u.username,
              ub.team_name, ub.coach_name, ub.team_logo, ub.budget
       FROM users u
       LEFT JOIN user_budget ub ON ub.user_id = u.id AND ub.league_id = ?
       WHERE u.id = ?
       LIMIT 1`,
      [leagueId, userId]
    );
    if (teamRows.length < 1) return res.status(404).json({ message: 'Squadra non trovata' });

    let players = [];
    try {
      players = await query(
        `SELECT p.id, p.first_name, p.last_name, p.role, p.rating
         FROM user_players up
         JOIN players p ON p.id = up.player_id
         WHERE up.user_id = ? AND up.league_id = ?`,
        [userId, leagueId]
      );
    } catch (_) {
      players = [];
    }

    let results = [];
    try {
      results = await query(
        `SELECT mr.giornata,
                mr.punteggio AS punteggio_giornata,
                m.deadline
         FROM matchday_results mr
         LEFT JOIN matchdays m
           ON m.league_id = mr.league_id
          AND m.giornata = mr.giornata
         WHERE mr.league_id = ? AND mr.user_id = ?
         ORDER BY mr.giornata DESC`,
        [leagueId, userId]
      );
    } catch (_) {
      results = [];
    }

    res.json({
      ...teamRows[0],
      players,
      results,
    });
  } catch (error) {
    console.error('Get team detail error:', error);
    res.status(500).json({ message: 'Errore caricamento dettaglio squadra' });
  }
});

module.exports = router;

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
        `WITH direct_owned AS (
           SELECT up.player_id
           FROM user_players up
           WHERE up.user_id = ? AND up.league_id = ?
         ),
         effective_players AS (
           SELECT d.player_id, 1::int AS directly_owned, 0::int AS acquired_as_injury_replacement
           FROM direct_owned d
           UNION
           SELECT inj.injury_replacement_player_id AS player_id, 0::int AS directly_owned, 1::int AS acquired_as_injury_replacement
           FROM direct_owned d
           JOIN players inj ON inj.id = d.player_id
           WHERE COALESCE(inj.is_injured, 0) = 1
             AND inj.injury_replacement_player_id IS NOT NULL
         )
         SELECT p.id, p.first_name, p.last_name, p.role, p.rating,
                COALESCE(p.is_injured, 0)::int AS is_injured,
                p.injury_replacement_player_id,
                COALESCE(t.name, '') AS team_name,
                MAX(ep.acquired_as_injury_replacement)::int AS acquired_as_injury_replacement,
                MAX(ep.directly_owned)::int AS directly_owned
         FROM effective_players ep
         JOIN players p ON p.id = ep.player_id
         LEFT JOIN teams t ON t.id = p.team_id
         GROUP BY p.id, p.first_name, p.last_name, p.role, p.rating, p.is_injured, p.injury_replacement_player_id, t.name`,
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

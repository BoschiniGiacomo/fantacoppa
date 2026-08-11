const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { computeSquadValue, computeLeagueSquadValuesByUser } = require('../utils/budgetReconcile');

async function getInitialBudget(leagueId) {
  const rows = await query(
    `SELECT COALESCE(initial_budget, 100) AS initial_budget
     FROM leagues WHERE id = ? LIMIT 1`,
    [leagueId]
  );
  return Number(rows[0]?.initial_budget || 100);
}

function budgetFromSquadValue(initialBudget, totalValue) {
  return Number((initialBudget - totalValue).toFixed(2));
}

// GET /api/teams/:leagueId
router.get('/:leagueId', authenticateToken, async (req, res) => {
  try {
    const leagueId = Number(req.params.leagueId);
    if (!Number.isFinite(leagueId) || leagueId <= 0) {
      return res.status(400).json({ message: 'League ID non valido' });
    }

    const [initialBudget, squadValuesByUser, rows, hideRows] = await Promise.all([
      getInitialBudget(leagueId),
      computeLeagueSquadValuesByUser(leagueId),
      query(
        `SELECT u.id, u.username,
                ub.team_name, ub.coach_name, ub.team_logo, ub.budget
         FROM league_members lm
         JOIN users u ON u.id = lm.user_id
         LEFT JOIN user_budget ub ON ub.user_id = lm.user_id AND ub.league_id = lm.league_id
         WHERE lm.league_id = ?
         ORDER BY u.username ASC`,
        [leagueId]
      ),
      query(
        `SELECT COALESCE(hide_formations, 0)::int AS hide_formations
         FROM leagues WHERE id = ? LIMIT 1`,
        [leagueId]
      ).catch(() => [{ hide_formations: 0 }]),
    ]);

    const hideFormations = Number(hideRows?.[0]?.hide_formations || 0) === 1;
    const viewerId = Number(req.user.userId);

    const teams = rows.map((row) => {
      const uid = Number(row.id);
      const totalValue = squadValuesByUser[uid] || 0;
      const isOwnTeam = viewerId === uid;
      const hideBudget = hideFormations && !isOwnTeam;
      return {
        ...row,
        budget: hideBudget ? null : budgetFromSquadValue(initialBudget, totalValue),
        total_value: hideBudget ? null : Number(totalValue.toFixed(2)),
        budget_hidden: hideBudget,
        hide_formations: hideFormations,
      };
    });

    res.json(teams);
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

    const [teamRows, players, results] = await Promise.all([
      query(
        `SELECT u.id, u.username,
                ub.team_name, ub.coach_name, ub.team_logo, ub.budget
         FROM users u
         LEFT JOIN user_budget ub ON ub.user_id = u.id AND ub.league_id = ?
         WHERE u.id = ?
         LIMIT 1`,
        [leagueId, userId]
      ),
      query(
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
                COALESCE(p.photo_path, '') AS photo_path,
                MAX(ep.acquired_as_injury_replacement)::int AS acquired_as_injury_replacement,
                MAX(ep.directly_owned)::int AS directly_owned
         FROM effective_players ep
         JOIN players p ON p.id = ep.player_id
         LEFT JOIN teams t ON t.id = p.team_id
         GROUP BY p.id, p.first_name, p.last_name, p.role, p.rating, p.is_injured, p.injury_replacement_player_id, t.name, p.photo_path`,
        [userId, leagueId]
      ),
      query(
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
      ),
    ]);
    if (teamRows.length < 1) return res.status(404).json({ message: 'Squadra non trovata' });

    const viewerId = Number(req.user.userId);
    const isOwnTeam = viewerId === userId;
    let hideFormations = false;
    try {
      const hideRows = await query(
        `SELECT COALESCE(hide_formations, 0)::int AS hide_formations
         FROM leagues WHERE id = ? LIMIT 1`,
        [leagueId]
      );
      hideFormations = Number(hideRows[0]?.hide_formations || 0) === 1;
    } catch (_) {
      hideFormations = false;
    }

    const initialBudget = await getInitialBudget(leagueId);
    const totalValue = await computeSquadValue(userId, leagueId);
    const computedBudget = budgetFromSquadValue(initialBudget, totalValue);

    const squadHidden = hideFormations && !isOwnTeam;
    const playersOut = squadHidden
      ? (players || []).map((p, idx) => ({
          id: `hidden-${p.role || 'X'}-${idx}`,
          role: p.role,
          first_name: '••••',
          last_name: '',
          team_name: '••••',
          rating: null,
          photo_path: '',
          is_injured: 0,
          injury_replacement_player_id: null,
          acquired_as_injury_replacement: 0,
          directly_owned: p.directly_owned,
          hidden: true,
        }))
      : players;

    res.json({
      ...teamRows[0],
      budget: squadHidden ? null : computedBudget,
      total_value: squadHidden ? null : Number(totalValue.toFixed(2)),
      players: playersOut,
      results,
      squad_hidden: squadHidden,
      budget_hidden: squadHidden,
      hide_formations: hideFormations,
    });
  } catch (error) {
    console.error('Get team detail error:', error);
    res.status(500).json({ message: 'Errore caricamento dettaglio squadra' });
  }
});

module.exports = router;

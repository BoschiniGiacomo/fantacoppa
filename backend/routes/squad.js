const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { removePlayerFromEditableLineups } = require('../utils/lineupResolver');
const { reconcileUserBudget } = require('../utils/budgetReconcile');
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
    );
    res.json({ squad: players, players });
  } catch (error) {
    console.error('Squad get error:', error);
    // Non restituire 200 con lista vuota: i client warm-cacheano e mostrano rosa vuota falsa.
    return res.status(500).json({ message: 'Errore caricamento rosa' });
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

    const [players, limitsRows, budgetRows, blockedRows, leagueRows, lineupRows] = await Promise.all([
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
      query(
        `SELECT 1 FROM user_lineups
         WHERE league_id = ? AND user_id = ?
         LIMIT 1`,
        [leagueId, userId]
      ).catch(() => []),
    ]);

    const limits = limitsRows[0] || {};
    const role_limits = {
      P: Number(limits.max_portieri || 0),
      D: Number(limits.max_difensori || 0),
      C: Number(limits.max_centrocampisti || 0),
      A: Number(limits.max_attaccanti || 0),
    };
    let budget = Number(budgetRows[0]?.budget || 0);
    const reconciled = await reconcileUserBudget(userId, leagueId);
    if (reconciled.budget != null) budget = reconciled.budget;
    const total_value = Number(reconciled.total_value ?? 0);

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
      has_submitted_formation: Array.isArray(lineupRows) && lineupRows.length > 0,
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

async function safeReconcileUserBudget(userId, leagueId) {
  try {
    return await reconcileUserBudget(userId, leagueId);
  } catch (err) {
    console.error('[squad.remove] reconcile failed', { userId, leagueId, err: err?.message || err });
    return { budget: null, total_value: null, fixed: false };
  }
}

// DELETE /api/squad/:leagueId/players/:playerId
router.delete('/:leagueId/players/:playerId', authenticateToken, async (req, res) => {
  const leagueId = Number(req.params.leagueId);
  const playerId = Number(req.params.playerId);
  const userId = Number(req.user.userId);
  const startedAt = Date.now();

  try {
    if (!Number.isFinite(leagueId) || leagueId <= 0 || !Number.isFinite(playerId) || playerId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }

    console.log('[squad.remove] start', { userId, leagueId, playerId });

    const ownedRows = await query(
      `SELECT 1 FROM user_players
       WHERE user_id = ? AND league_id = ? AND player_id = ?
       LIMIT 1`,
      [userId, leagueId, playerId]
    );
    if (!ownedRows.length) {
      const reconciled = await safeReconcileUserBudget(userId, leagueId);
      console.log('[squad.remove] already_removed', { userId, leagueId, playerId, ms: Date.now() - startedAt });
      return res.json({
        message: 'Giocatore già svincolato',
        already_removed: true,
        budget: reconciled.budget,
        total_value: reconciled.total_value,
        budget_reconciled: !!reconciled.fixed,
      });
    }

    // 1) Formazione (mentre il giocatore è ancora in rosa)
    const lineupCleanup = await removePlayerFromEditableLineups(userId, leagueId, playerId);

    // 2) Rosa
    const deleteResult = await query(
      'DELETE FROM user_players WHERE user_id = ? AND league_id = ? AND player_id = ?',
      [userId, leagueId, playerId]
    );
    const removed = Number(deleteResult?.affectedRows || 0) > 0;
    if (!removed) {
      const reconciled = await safeReconcileUserBudget(userId, leagueId);
      console.log('[squad.remove] delete_noop', { userId, leagueId, playerId, ms: Date.now() - startedAt });
      return res.json({
        message: 'Giocatore già svincolato',
        already_removed: true,
        budget: reconciled.budget,
        total_value: reconciled.total_value,
        budget_reconciled: !!reconciled.fixed,
      });
    }

    // 3) Crediti: ricalcolo da initial_budget - valore rosa (no doppio rimborso)
    const reconciled = await safeReconcileUserBudget(userId, leagueId);

    console.log('[squad.remove] ok', {
      userId,
      leagueId,
      playerId,
      starterRemoved: !!lineupCleanup.starterRemoved,
      matchdays: lineupCleanup.matchdays?.length || 0,
      ms: Date.now() - startedAt,
    });

    return res.json({
      message: 'Giocatore rimosso dalla rosa',
      formation_updated: !!lineupCleanup.updated,
      formation_starter_removed: !!lineupCleanup.starterRemoved,
      formation_matchdays: lineupCleanup.matchdays || [],
      budget: reconciled.budget,
      total_value: reconciled.total_value,
      budget_reconciled: !!reconciled.fixed,
    });
  } catch (error) {
    console.error('[squad.remove] error', { userId, leagueId, playerId, err: error?.message || error, ms: Date.now() - startedAt });
    try {
      const stillOwned = await query(
        `SELECT 1 FROM user_players
         WHERE user_id = ? AND league_id = ? AND player_id = ?
         LIMIT 1`,
        [userId, leagueId, playerId]
      );
      if (!stillOwned.length) {
        const reconciled = await safeReconcileUserBudget(userId, leagueId);
        console.log('[squad.remove] recovered_after_error', { userId, leagueId, playerId, ms: Date.now() - startedAt });
        return res.json({
          message: 'Giocatore rimosso dalla rosa',
          recovered_after_error: true,
          budget: reconciled.budget,
          total_value: reconciled.total_value,
          budget_reconciled: !!reconciled.fixed,
        });
      }
    } catch (checkErr) {
      console.error('[squad.remove] recovery_check_failed', checkErr?.message || checkErr);
    }
    return res.status(500).json({ message: 'Errore durante la rimozione del giocatore' });
  }
});

module.exports = router;

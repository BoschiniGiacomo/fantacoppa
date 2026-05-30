const { query } = require('../config/database');

/**
 * SQL: esclude i giocatori in rosa solo come sostituto d'infortunio (gratuiti, a costo zero).
 * @param {string} upAlias alias tabella user_players del giocatore valutato
 */
function injuryReplacementExclusionSql(upAlias = 'up') {
  return `NOT EXISTS (
    SELECT 1
    FROM user_players up_inj
    JOIN players inj ON inj.id = up_inj.player_id
    WHERE up_inj.user_id = ${upAlias}.user_id
      AND up_inj.league_id = ${upAlias}.league_id
      AND COALESCE(inj.is_injured, 0) = 1
      AND inj.injury_replacement_player_id = ${upAlias}.player_id
  )`;
}

/**
 * Valore rosa = somma rating in user_players, esclusi i sostituti d'infortunio.
 */
async function computeSquadValue(userId, leagueId) {
  const rows = await query(
    `SELECT COALESCE(SUM(p.rating), 0) AS total_value
     FROM user_players up
     JOIN players p ON p.id = up.player_id
     WHERE up.user_id = ? AND up.league_id = ?
       AND ${injuryReplacementExclusionSql('up')}`,
    [userId, leagueId]
  );
  return Number(rows[0]?.total_value || 0);
}

/**
 * Valore rosa per tutti i membri di una lega (es. lista squadre).
 */
async function computeLeagueSquadValuesByUser(leagueId) {
  const rows = await query(
    `SELECT up.user_id, COALESCE(SUM(p.rating), 0)::float AS total_value
     FROM user_players up
     JOIN players p ON p.id = up.player_id
     WHERE up.league_id = ?
       AND ${injuryReplacementExclusionSql('up')}
     GROUP BY up.user_id`,
    [leagueId]
  );
  const byUser = {};
  (rows || []).forEach((r) => {
    byUser[Number(r.user_id)] = Number(r.total_value || 0);
  });
  return byUser;
}

/**
 * Allinea budget a: initial_budget - valore rosa (corregge doppi rimborsi / acquisti parziali).
 */
async function reconcileUserBudget(userId, leagueId) {
  const uid = Number(userId);
  const lid = Number(leagueId);
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(lid) || lid <= 0) {
    return { budget: 0, total_value: 0, fixed: false };
  }

  const [leagueRows, budgetRows] = await Promise.all([
    query(
      `SELECT COALESCE(initial_budget, 100) AS initial_budget
       FROM leagues WHERE id = ? LIMIT 1`,
      [lid]
    ),
    query(
      `SELECT budget FROM user_budget WHERE user_id = ? AND league_id = ? LIMIT 1`,
      [uid, lid]
    ),
  ]);

  const initialBudget = Number(leagueRows[0]?.initial_budget || 100);
  const totalValue = await computeSquadValue(uid, lid);
  const expectedBudget = Number((initialBudget - totalValue).toFixed(2));
  const currentBudget = budgetRows[0] != null ? Number(budgetRows[0].budget || 0) : null;

  if (currentBudget == null) {
    return {
      budget: expectedBudget,
      total_value: Number(totalValue.toFixed(2)),
      fixed: false,
    };
  }

  if (Math.abs(currentBudget - expectedBudget) > 0.009) {
    await query(
      `UPDATE user_budget SET budget = ? WHERE user_id = ? AND league_id = ?`,
      [expectedBudget, uid, lid]
    );
    return {
      budget: expectedBudget,
      total_value: Number(totalValue.toFixed(2)),
      fixed: true,
      previous_budget: currentBudget,
    };
  }

  return {
    budget: currentBudget,
    total_value: Number(totalValue.toFixed(2)),
    fixed: false,
  };
}

module.exports = {
  injuryReplacementExclusionSql,
  computeSquadValue,
  computeLeagueSquadValuesByUser,
  reconcileUserBudget,
};

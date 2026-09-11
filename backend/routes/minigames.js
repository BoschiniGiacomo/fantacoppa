const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const TABLE = 'minigame_scores';
const ALLOWED_GAMES = new Set(['higher_lower']);

let tableReadyPromise = null;

async function ensureMinigameScoresTable() {
  if (!tableReadyPromise) {
    tableReadyPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          user_id INTEGER NOT NULL,
          game_key TEXT NOT NULL,
          official_group_id INTEGER NOT NULL DEFAULT 0,
          best_score INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, game_key, official_group_id)
        )
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_minigame_scores_leaderboard
          ON ${TABLE} (game_key, official_group_id, best_score DESC)
      `);
    })().catch((error) => {
      tableReadyPromise = null;
      throw error;
    });
  }
  await tableReadyPromise;
}

function normalizeGameKey(raw) {
  const key = String(raw || '').trim().toLowerCase();
  return ALLOWED_GAMES.has(key) ? key : null;
}

/**
 * GET /api/minigames/:gameKey/best?group_id=
 */
router.get('/:gameKey/best', authenticateToken, async (req, res) => {
  try {
    const gameKey = normalizeGameKey(req.params.gameKey);
    if (!gameKey) return res.status(400).json({ message: 'game_key non valido' });

    const groupId = Number(req.query?.group_id);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return res.status(400).json({ message: 'group_id non valido' });
    }

    const userId = Number(req.user?.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ message: 'Utente non autenticato' });
    }

    await ensureMinigameScoresTable();
    const rows = await query(
      `SELECT best_score, updated_at
       FROM ${TABLE}
       WHERE user_id = ? AND game_key = ? AND official_group_id = ?
       LIMIT 1`,
      [userId, gameKey, groupId],
    );

    return res.json({
      game_key: gameKey,
      official_group_id: groupId,
      best_score: Number(rows[0]?.best_score) || 0,
      updated_at: rows[0]?.updated_at || null,
    });
  } catch (error) {
    console.error('[minigames] GET best:', error);
    return res.status(500).json({ message: 'Errore lettura personal best', error: error.message });
  }
});

/**
 * POST /api/minigames/:gameKey/best
 * body: { group_id, score }
 * Aggiorna solo se score > best_score corrente.
 */
router.post('/:gameKey/best', authenticateToken, async (req, res) => {
  try {
    const gameKey = normalizeGameKey(req.params.gameKey);
    if (!gameKey) return res.status(400).json({ message: 'game_key non valido' });

    const groupId = Number(req.body?.group_id);
    const score = Number(req.body?.score);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return res.status(400).json({ message: 'group_id non valido' });
    }
    if (!Number.isFinite(score) || score < 0 || !Number.isInteger(score)) {
      return res.status(400).json({ message: 'score non valido' });
    }

    const userId = Number(req.user?.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ message: 'Utente non autenticato' });
    }

    await ensureMinigameScoresTable();

    const existing = await query(
      `SELECT best_score
       FROM ${TABLE}
       WHERE user_id = ? AND game_key = ? AND official_group_id = ?
       LIMIT 1`,
      [userId, gameKey, groupId],
    );
    const prevBest = Number(existing[0]?.best_score) || 0;
    const nextBest = Math.max(prevBest, Math.trunc(score));
    const improved = nextBest > prevBest;

    if (improved || !existing.length) {
      await query(
        `INSERT INTO ${TABLE} (user_id, game_key, official_group_id, best_score, updated_at)
         VALUES (?, ?, ?, ?, NOW())
         ON CONFLICT (user_id, game_key, official_group_id)
         DO UPDATE SET
           best_score = EXCLUDED.best_score,
           updated_at = NOW()
         WHERE ${TABLE}.best_score < EXCLUDED.best_score`,
        [userId, gameKey, groupId, nextBest],
      );
    }

    return res.json({
      game_key: gameKey,
      official_group_id: groupId,
      best_score: nextBest,
      improved,
    });
  } catch (error) {
    console.error('[minigames] POST best:', error);
    return res.status(500).json({ message: 'Errore salvataggio personal best', error: error.message });
  }
});

module.exports = router;

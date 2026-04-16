const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// GET /api/formation/:leagueId/matchdays
router.get('/:leagueId/matchdays', authenticateToken, async (req, res) => {
  try {
    const leagueId = Number(req.params.leagueId);
    const rows = await query(
      `SELECT giornata, deadline
       FROM matchdays
       WHERE league_id = ?
       ORDER BY giornata ASC`,
      [leagueId]
    );
    res.json(rows);
  } catch (_) {
    res.json([]);
  }
});

// GET /api/formation/:leagueId/:giornata/deadline
router.get('/:leagueId/:giornata/deadline', authenticateToken, async (req, res) => {
  try {
    const leagueId = Number(req.params.leagueId);
    const giornata = Number(req.params.giornata);
    const rows = await query(
      `SELECT deadline
       FROM matchdays
       WHERE league_id = ? AND giornata = ?
       LIMIT 1`,
      [leagueId, giornata]
    );
    const deadline = rows[0]?.deadline || null;
    res.json({ deadline, isExpired: deadline ? new Date(deadline) < new Date() : false });
  } catch (_) {
    res.json({ deadline: null, isExpired: false });
  }
});

// GET /api/formation/:leagueId/:giornata
router.get('/:leagueId/:giornata', authenticateToken, async (req, res) => {
  try {
    const leagueId = Number(req.params.leagueId);
    const giornata = Number(req.params.giornata);
    const userId = Number(req.user.userId);

    const dRows = await query(
      `SELECT deadline
       FROM matchdays
       WHERE league_id = ? AND giornata = ?
       LIMIT 1`,
      [leagueId, giornata]
    );
    const deadline = dRows[0]?.deadline || null;
    const isExpired = deadline ? new Date(deadline) < new Date() : false;

    const rows = await query(
      `SELECT modulo, titolari, panchina
       FROM user_lineups
       WHERE user_id = ? AND league_id = ? AND giornata = ?
       LIMIT 1`,
      [userId, leagueId, giornata]
    );
    const row = rows[0];
    const formation = row
      ? { modulo: row.modulo, titolari: row.titolari, panchina: row.panchina }
      : null;
    res.json({ formation, deadline, isExpired });
  } catch (_) {
    res.json({ formation: null, deadline: null, isExpired: false });
  }
});

// POST /api/formation/:leagueId/:giornata
router.post('/:leagueId/:giornata', authenticateToken, async (req, res) => {
  try {
    const leagueId = Number(req.params.leagueId);
    const giornata = Number(req.params.giornata);
    const userId = Number(req.user.userId);
    const modulo = String(req.body?.modulo || '').trim();
    const titolari = req.body?.titolari != null ? JSON.stringify(req.body.titolari) : '[]';
    const panchina = req.body?.panchina != null ? JSON.stringify(req.body.panchina) : '[]';

    if (!modulo) return res.status(400).json({ message: 'Modulo obbligatorio' });

    await query(
      `INSERT INTO user_lineups (user_id, league_id, giornata, modulo, titolari, panchina)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, league_id, giornata)
       DO UPDATE SET
         modulo = EXCLUDED.modulo,
         titolari = EXCLUDED.titolari,
         panchina = EXCLUDED.panchina`,
      [userId, leagueId, giornata, modulo, titolari, panchina]
    );
    res.json({ message: 'Formazione salvata' });
  } catch (error) {
    console.error('Save formation error:', error);
    res.status(500).json({ message: 'Errore salvataggio formazione' });
  }
});

module.exports = router;

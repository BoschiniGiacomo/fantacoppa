const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// GET /api/official-leagues/available
router.get('/available', authenticateToken, async (_req, res) => {
  try {
    const rows = await query(
      `SELECT id, name
       FROM leagues
       WHERE COALESCE(is_official, 0) = 1
         AND COALESCE(is_visible_for_linking, 1) = 1
       ORDER BY name ASC, id ASC`
    );
    return res.json(rows);
  } catch (error) {
    console.error('Official leagues available error:', error);
    res.status(500).json({ message: 'Errore caricamento leghe ufficiali disponibili' });
  }
});

module.exports = router;

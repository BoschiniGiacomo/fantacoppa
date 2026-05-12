const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { ensureAppSettingsTable } = require('../utils/appSettingsStore');

/**
 * GET /api/public/app-loading
 * Pubblico (nessun token): usato all'avvio app prima del login.
 */
router.get('/app-loading', async (_req, res) => {
  try {
    await ensureAppSettingsTable();
    const rows = await query(
      `SELECT loading_media_path AS path, loading_media_type AS type
       FROM app_settings WHERE id = 1 LIMIT 1`
    );
    const row = rows[0] || {};
    const pathVal = row.path ? String(row.path).trim() : null;
    const typeVal = String(row.type || '').trim().toLowerCase() === 'video' ? 'video' : pathVal ? 'image' : null;
    return res.json({
      path: pathVal || null,
      type: typeVal,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Errore lettura impostazioni', error: error.message });
  }
});

module.exports = router;

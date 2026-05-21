const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { ensureAppSettingsTable } = require('../utils/appSettingsStore');
const { logMediaDbRead, logMediaClientEvent } = require('../utils/mediaCacheServerLog');

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
    logMediaDbRead('app_loading', _req, { path: pathVal, type: typeVal, ok: true });
    return res.json({
      path: pathVal || null,
      type: typeVal,
    });
  } catch (error) {
    logMediaDbRead('app_loading', _req, { ok: false, error: error.message });
    return res.status(500).json({ message: 'Errore lettura impostazioni', error: error.message });
  }
});

/**
 * GET /api/public/login-logo
 * Pubblico (nessun token): usato nella pagina di login.
 */
router.get('/login-logo', async (_req, res) => {
  try {
    await ensureAppSettingsTable();
    const rows = await query(
      `SELECT login_logo_path AS path FROM app_settings WHERE id = 1 LIMIT 1`
    );
    const row = rows[0] || {};
    const pathVal = row.path ? String(row.path).trim() : null;
    logMediaDbRead('login_logo', _req, { path: pathVal, ok: true });
    return res.json({ path: pathVal || null });
  } catch (error) {
    logMediaDbRead('login_logo', _req, { ok: false, error: error.message });
    return res.status(500).json({ message: 'Errore lettura impostazioni', error: error.message });
  }
});

/**
 * POST /api/public/media-cache-event
 * L'app segnala cache disco vs download rete (visibile su Render).
 */
router.post('/media-cache-event', (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    logMediaClientEvent(req, body);
    return res.status(204).end();
  } catch (error) {
    console.error('[DEBUG_MEDIA_CACHE] media-cache-event errore:', error?.message || error);
    return res.status(500).json({ message: 'Errore log evento' });
  }
});

/**
 * GET /api/public/login-background
 * Pubblico (nessun token): sfondo pagina di login.
 */
router.get('/login-background', async (_req, res) => {
  try {
    await ensureAppSettingsTable();
    const rows = await query(
      `SELECT login_background_path AS path FROM app_settings WHERE id = 1 LIMIT 1`
    );
    const row = rows[0] || {};
    const pathVal = row.path ? String(row.path).trim() : null;
    logMediaDbRead('login_background', _req, { path: pathVal, ok: true });
    return res.json({ path: pathVal || null });
  } catch (error) {
    logMediaDbRead('login_background', _req, { ok: false, error: error.message });
    return res.status(500).json({ message: 'Errore lettura impostazioni', error: error.message });
  }
});

module.exports = router;

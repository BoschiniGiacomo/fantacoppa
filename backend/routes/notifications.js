const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

let notificationsTablesReady = false;
async function ensureNotificationsTables() {
  if (notificationsTablesReady) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS user_push_tokens (
         id SERIAL PRIMARY KEY,
         user_id INTEGER NOT NULL,
         expo_push_token TEXT NOT NULL UNIQUE,
         platform TEXT NULL,
         is_active INTEGER NOT NULL DEFAULT 1,
         created_at TIMESTAMP NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
         last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
       )`
    );
    notificationsTablesReady = true;
  } catch (_) {}
}

router.post('/register-token', authenticateToken, async (req, res) => {
  try {
    await ensureNotificationsTables();
    const userId = Number(req.user?.userId);
    const expoToken = String(req.body?.token || '').trim();
    const platform = String(req.body?.platform || '').trim() || null;

    const validPrefix = expoToken.startsWith('ExponentPushToken') || expoToken.startsWith('ExpoPushToken');
    if (!expoToken || !validPrefix) {
      return res.status(400).json({ message: 'Token push non valido' });
    }

    await query(
      `INSERT INTO user_push_tokens (user_id, expo_push_token, platform, is_active, updated_at, last_seen_at)
       VALUES (?, ?, ?, 1, NOW(), NOW())
       ON CONFLICT (expo_push_token)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         platform = EXCLUDED.platform,
         is_active = 1,
         updated_at = NOW(),
         last_seen_at = NOW()`,
      [userId, expoToken, platform]
    );

    return res.json({ message: 'Token push registrato' });
  } catch (error) {
    console.error('Register push token error:', error);
    return res.status(500).json({ message: 'Errore registrazione token push', error: error.message });
  }
});

module.exports = router;

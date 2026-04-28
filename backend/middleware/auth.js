const jwt = require('jsonwebtoken');
require('dotenv').config();
const { query } = require('../config/database');

const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const lastTouchedByUser = new Map();
let lastLoginColumnMissing = false;
let presenceTableReady = false;

async function ensurePresenceTable() {
  if (presenceTableReady) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS user_presence (
         user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
         last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );
    presenceTableReady = true;
  } catch (_) {
    // Non bloccare auth se la creazione tabella fallisce temporaneamente.
  }
}

async function touchUserPresence(userId) {
  if (!Number.isFinite(userId) || userId <= 0) return;
  await ensurePresenceTable();
  if (!presenceTableReady) return;
  try {
    await query(
      `INSERT INTO user_presence (user_id, last_seen_at)
       VALUES (?, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
      [userId]
    );
  } catch (_) {
    // Ignora errore presenza per non impattare richieste utente.
  }
}

async function touchUserLastLogin(userId) {
  if (!Number.isFinite(userId) || userId <= 0) return;
  const now = Date.now();
  const lastTouched = lastTouchedByUser.get(userId) || 0;
  if (now - lastTouched < HEARTBEAT_INTERVAL_MS) return;
  lastTouchedByUser.set(userId, now);
  await touchUserPresence(userId);
  if (lastLoginColumnMissing) return;
  try {
    await query('UPDATE users SET last_login = NOW() WHERE id = ?', [userId]);
  } catch (error) {
    const code = String(error?.code || '').toLowerCase();
    const msg = String(error?.message || '').toLowerCase();
    if (code === '42703' || msg.includes('last_login')) {
      lastLoginColumnMissing = true;
      return;
    }
  }
}

// Middleware per verificare il token JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ message: 'Token di autenticazione mancante' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Token non valido o scaduto' });
    }
    req.user = user;
    // Heartbeat soft: mantiene aggiornato last_login mentre l'utente usa l'app.
    void touchUserLastLogin(Number(user?.userId));
    next();
  });
};

module.exports = {
  authenticateToken
};


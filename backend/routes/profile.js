const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const rows = await query(
      'SELECT id, username, email, COALESCE(is_superuser, 0) AS is_superuser FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ message: 'Utente non trovato' });
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      is_superuser: Number(user.is_superuser || 0),
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Errore recupero profilo' });
  }
});

router.put('/', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const username = req.body?.username != null ? String(req.body.username).trim() : null;
    const email = req.body?.email != null ? String(req.body.email).trim() : null;

    if (!username && !email) {
      return res.status(400).json({ message: 'Nessun campo da aggiornare' });
    }

    if (username) {
      const u = await query('SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1', [username, userId]);
      if (u.length > 0) return res.status(400).json({ message: 'Username già esistente' });
      await query('UPDATE users SET username = ? WHERE id = ?', [username, userId]);
    }

    if (email) {
      const e = await query('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [email, userId]);
      if (e.length > 0) return res.status(400).json({ message: 'Email già registrata' });
      await query('UPDATE users SET email = ? WHERE id = ?', [email, userId]);
    }

    const rows = await query(
      'SELECT id, username, email, COALESCE(is_superuser, 0) AS is_superuser FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const user = rows[0];
    res.json({
      message: 'Profilo aggiornato',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_superuser: Number(user.is_superuser || 0),
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Errore aggiornamento profilo' });
  }
});

module.exports = router;

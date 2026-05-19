const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { sendTransactionalEmail, buildForgotPasswordHtml } = require('../utils/emailDelivery');
require('dotenv').config();
const { authenticateToken } = require('../middleware/auth');

async function syncUsersIdSequence() {
  await query(
    "SELECT setval(pg_get_serial_sequence('users','id'), COALESCE((SELECT MAX(id) FROM users), 0) + 1, false)"
  );
}

async function sendForgotPasswordEmail(toEmail, newPassword) {
  console.log(`[DEBUG_FORGOT] invio email verso=${toEmail}`);
  return sendTransactionalEmail({
    to: toEmail,
    subject: 'Recupero Password - FantaCoppa',
    html: buildForgotPasswordHtml(newPassword),
  });
}

// Registrazione
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validazione input
    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Compila tutti i campi' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'La password deve essere di almeno 6 caratteri' });
    }

    // Verifica se username esiste già
    const existingUser = await query(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({ message: 'Username già esistente' });
    }

    // Verifica se email esiste già
    const existingEmail = await query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingEmail.length > 0) {
      return res.status(400).json({ message: 'Email già registrata' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Inserisci utente
    let result;
    try {
      result = await query(
        'INSERT INTO users (username, email, password) VALUES (?, ?, ?) RETURNING id',
        [username, email, hashedPassword]
      );
    } catch (insertError) {
      // Migrazioni DB possono lasciare la sequence della PK desincronizzata.
      if (insertError && insertError.code === '23505') {
        await syncUsersIdSequence();
        result = await query(
          'INSERT INTO users (username, email, password) VALUES (?, ?, ?) RETURNING id',
          [username, email, hashedPassword]
        );
      } else {
        throw insertError;
      }
    }

    const userId = result.insertId;

    // In PostgreSQL user_budget richiede anche league_id: il budget viene creato
    // quando l'utente entra/crea una lega, non in fase di registrazione.

    // Genera token JWT
    const token = jwt.sign(
      { userId: userId, username: username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Registrazione completata con successo',
      token: token,
      user: {
        id: userId,
        username: username,
        email: email
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Errore durante la registrazione' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const loginId = String(username || '').trim();

    // Validazione input (campo "username" accetta anche email)
    if (!loginId || !password) {
      return res.status(400).json({ message: 'Inserisci username o email e password' });
    }

    // Cerca utente per username oppure email (case-insensitive sull'email)
    const users = await query(
      `SELECT id, username, email, password, COALESCE(is_superuser, 0) AS is_superuser
       FROM users
       WHERE username = ? OR LOWER(email) = LOWER(?)
       LIMIT 1`,
      [loginId, loginId]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Credenziali non valide' });
    }

    const user = users[0];

    // Verifica password
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ message: 'Credenziali non valide' });
    }

    // Aggiorna ultimo login (se la colonna esiste)
    try {
      await query(
        'UPDATE users SET last_login = NOW() WHERE id = ?',
        [user.id]
      );
    } catch (err) {
      // Se la colonna non esiste, continua comunque
      console.log('Colonna last_login non trovata, skip...');
    }

    // Genera token JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login effettuato con successo',
      token: token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_superuser: Number(user.is_superuser || 0),
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Errore durante il login' });
  }
});

// Logout (solo per invalidare il token lato client)
router.post('/logout', (req, res) => {
  res.json({ message: 'Logout effettuato con successo' });
});

// Presence ping: chiamata periodica dal client quando l'app è in foreground.
// Il middleware auth aggiorna last_login con heartbeat.
router.post('/presence/ping', authenticateToken, async (_req, res) => {
  return res.json({ ok: true, server_time: new Date().toISOString() });
});

const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'Se l\'email è registrata nel nostro sistema, riceverai una nuova password via email.';

async function processForgotPasswordAsync(email) {
  const users = await query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
  console.log(`[DEBUG_FORGOT] utenti trovati=${users.length}`);
  if (!users.length) return;

  const userId = Number(users[0].id);
  const newPassword = `fc${Math.random().toString(36).slice(2, 10)}${Date.now().toString().slice(-2)}`;
  console.log(`[DEBUG_FORGOT] password temporanea generata len=${newPassword.length}, user_id=${userId}`);

  const mailSent = await sendForgotPasswordEmail(email, newPassword);
  if (mailSent) {
    const hashed = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password = ? WHERE id = ?', [hashed, userId]);
    console.log('[DEBUG_FORGOT] email inviata e password aggiornata su DB');
  } else {
    console.error('[DEBUG_FORGOT] email non inviata: password NON aggiornata (operazione annullata)');
  }
}

// Password dimenticata (risposta immediata; email in background — evita timeout app su Render/SMTP)
router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    console.log(`[DEBUG_FORGOT] richiesta forgot-password email=${email || '(vuota)'}`);
    if (!email) {
      return res.status(400).json({ message: 'Inserisci la tua email' });
    }

    res.json({ message: FORGOT_PASSWORD_GENERIC_MESSAGE });

    setImmediate(() => {
      processForgotPasswordAsync(email).catch((error) => {
        console.error('[DEBUG_FORGOT] errore elaborazione async:', error);
      });
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ message: 'Errore durante il recupero password' });
  }
});

// Cambio password
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const currentPassword = String(req.body?.current_password || '').trim();
    const newPassword = String(req.body?.new_password || '').trim();
    const confirmPassword = String(req.body?.confirm_password || '').trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: 'Compila tutti i campi' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'Le nuove password non coincidono' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'La nuova password deve essere di almeno 6 caratteri' });
    }

    const rows = await query('SELECT password FROM users WHERE id = ? LIMIT 1', [userId]);
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ message: 'Utente non trovato' });
    }

    const ok = await bcrypt.compare(currentPassword, row.password);
    if (!ok) {
      return res.status(401).json({ message: 'Password attuale non corretta' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password = ? WHERE id = ?', [hashed, userId]);
    return res.json({ message: 'Password aggiornata con successo' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Errore durante il cambio password' });
  }
});

// Eliminazione account
router.post('/delete-account', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const password = String(req.body?.password || '').trim();
    if (!password) {
      return res.status(400).json({ message: 'Inserisci la password per confermare' });
    }

    const rows = await query('SELECT password FROM users WHERE id = ? LIMIT 1', [userId]);
    const row = rows[0];
    if (!row) return res.status(404).json({ message: 'Utente non trovato' });

    const ok = await bcrypt.compare(password, row.password);
    if (!ok) return res.status(401).json({ message: 'Password non corretta' });

    await query('DELETE FROM league_members WHERE user_id = ?', [userId]);
    await query('DELETE FROM user_budget WHERE user_id = ?', [userId]);
    await query('DELETE FROM user_league_prefs WHERE user_id = ?', [userId]);
    await query('DELETE FROM user_players WHERE user_id = ?', [userId]);
    await query('DELETE FROM user_lineups WHERE user_id = ?', [userId]);
    await query('DELETE FROM users WHERE id = ?', [userId]);

    return res.json({ message: 'Account eliminato con successo' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ message: 'Errore durante eliminazione account' });
  }
});

// Verifica token (endpoint per verificare se il token è valido)
router.get('/verify', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const rows = await query(
      'SELECT id, username, email, COALESCE(is_superuser, 0) AS is_superuser FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ message: 'Utente non trovato' });
    res.json({
      valid: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_superuser: Number(user.is_superuser || 0),
      }
    });
  } catch (error) {
    console.error('Verify session error:', error);
    res.status(500).json({ message: 'Errore verifica sessione' });
  }
});

module.exports = router;


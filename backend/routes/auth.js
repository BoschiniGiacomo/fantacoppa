const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { query } = require('../config/database');
require('dotenv').config();
const { authenticateToken } = require('../middleware/auth');

async function syncUsersIdSequence() {
  await query(
    "SELECT setval(pg_get_serial_sequence('users','id'), COALESCE((SELECT MAX(id) FROM users), 0) + 1, false)"
  );
}

function createMailerTransport() {
  const host = String(process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USERNAME || '').trim();
  const pass = String(process.env.SMTP_PASSWORD || '').trim();
  const maskedUser = user ? `${user.slice(0, 3)}***${user.slice(-8)}` : '(vuoto)';
  const passLen = pass ? pass.length : 0;
  console.log(`[DEBUG_FORGOT_SMTP] create transport host=${host} port=${port} user=${maskedUser} pass_len=${passLen}`);

  if (!host || !user || !pass || !Number.isFinite(port) || port <= 0) {
    console.error('[DEBUG_FORGOT_SMTP] config SMTP non valida o incompleta');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
    tls: {
      rejectUnauthorized: false,
    },
  });
}

async function sendForgotPasswordEmail(toEmail, newPassword) {
  console.log(`[DEBUG_FORGOT_SMTP] avvio invio email verso=${toEmail}`);
  const transport = createMailerTransport();
  if (!transport) {
    console.error('[DEBUG_FORGOT_SMTP] transport null: invio annullato');
    return false;
  }

  const fromName = String(process.env.SMTP_FROM_NAME || 'FantaCoppa').trim() || 'FantaCoppa';
  const fromAddress = String(process.env.SMTP_FROM_ADDRESS || process.env.SMTP_USERNAME || '').trim();
  if (!fromAddress) {
    console.error('[DEBUG_FORGOT_SMTP] fromAddress vuoto: invio annullato');
    return false;
  }
  console.log(`[DEBUG_FORGOT_SMTP] from="${fromName}" <${fromAddress}>`);

  const htmlBody = `
    <h2>Recupero Password - FantaCoppa</h2>
    <p>Ciao,</p>
    <p>Abbiamo ricevuto una richiesta di recupero password per il tuo account.</p>
    <p>La tua nuova password temporanea e: <strong>${newPassword}</strong></p>
    <p>Per sicurezza, ti consigliamo di cambiarla subito dopo l'accesso.</p>
    <br>
    <p>Saluti,<br>Team FantaCoppa</p>
  `;

  try {
    console.log('[DEBUG_FORGOT_SMTP] verify transport principale...');
    await transport.verify();
    console.log('[DEBUG_FORGOT_SMTP] verify OK, invio mail principale...');
    await transport.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: toEmail,
      subject: 'Recupero Password - FantaCoppa',
      html: htmlBody,
    });
    console.log('[DEBUG_FORGOT_SMTP] invio principale completato');
    return true;
  } catch (firstError) {
    console.error('[DEBUG_FORGOT_SMTP] invio principale FALLITO:', {
      message: firstError?.message,
      code: firstError?.code,
      response: firstError?.response,
      command: firstError?.command,
    });
    // Fallback SMTPS (porta 465), come nel flusso legacy
    try {
      const host = String(process.env.SMTP_HOST || 'smtp.gmail.com').trim();
      const user = String(process.env.SMTP_USERNAME || '').trim();
      const pass = String(process.env.SMTP_PASSWORD || '').trim();
      if (!host || !user || !pass) return false;
      console.log('[DEBUG_FORGOT_SMTP] tentativo fallback SMTPS:465...');
      const fallbackTransport = nodemailer.createTransport({
        host,
        port: 465,
        secure: true,
        auth: { user, pass },
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 30000,
        tls: { rejectUnauthorized: false },
      });
      console.log('[DEBUG_FORGOT_SMTP] verify fallback...');
      await fallbackTransport.verify();
      console.log('[DEBUG_FORGOT_SMTP] verify fallback OK, invio fallback...');
      await fallbackTransport.sendMail({
        from: `"${fromName}" <${fromAddress}>`,
        to: toEmail,
        subject: 'Recupero Password - FantaCoppa',
        html: htmlBody,
      });
      console.log('[DEBUG_FORGOT_SMTP] invio fallback completato');
      return true;
    } catch (fallbackError) {
      console.error('[DEBUG_FORGOT_SMTP] fallback FALLITO:', {
        message: fallbackError?.message,
        code: fallbackError?.code,
        response: fallbackError?.response,
        command: fallbackError?.command,
      });
      return false;
    }
  }
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

    // Validazione input
    if (!username || !password) {
      return res.status(400).json({ message: 'Inserisci username e password' });
    }

    // Cerca utente
    const users = await query(
      'SELECT id, username, email, password, COALESCE(is_superuser, 0) AS is_superuser FROM users WHERE username = ?',
      [username]
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

// Password dimenticata (risposta sempre generica)
router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    console.log(`[DEBUG_FORGOT] richiesta forgot-password email=${email || '(vuota)'}`);
    if (!email) {
      return res.status(400).json({ message: 'Inserisci la tua email' });
    }
    const genericMessage = 'Se l\'email è registrata nel nostro sistema, riceverai una nuova password via email.';

    const users = await query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
    console.log(`[DEBUG_FORGOT] utenti trovati=${users.length}`);
    if (users.length) {
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

    return res.json({ message: genericMessage });
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


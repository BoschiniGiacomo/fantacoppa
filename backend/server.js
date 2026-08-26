const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const dotenv = require('dotenv');

// Carica prima il .env della root (usato anche da Expo), poi eventuale backend/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

// Import routes
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const leagueRoutes = require('./routes/leagues');
const marketRoutes = require('./routes/market');
const squadRoutes = require('./routes/squad');
const formationRoutes = require('./routes/formation');
const teamsRoutes = require('./routes/teams');
const officialLeaguesRoutes = require('./routes/officialLeagues');
const matchesRoutes = require('./routes/matches');
const superuserRoutes = require('./routes/superuser');
const playerStatsRoutes = require('./routes/playerStats');
const notificationsRoutes = require('./routes/notifications');
const publicAppRoutes = require('./routes/publicApp');

// Import database (per testare connessione all'avvio)
const { pool } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;
const MIN_SUPPORTED_APP_VERSION_CODE = parseInt(process.env.MIN_SUPPORTED_APP_VERSION_CODE || '0', 10) || 0;
const APP_FORCE_UPDATE_URL = (process.env.APP_FORCE_UPDATE_URL || '').trim();

// Middleware
app.use(compression({ threshold: 1024 })); // Gzip JSON/HTML sopra ~1KB (meno HTTP outbound)
app.use(cors()); // Permette richieste da qualsiasi origine (per sviluppo)
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use('/uploads', express.static(path.resolve(__dirname, 'uploads')));
app.use('/api/uploads', express.static(path.resolve(__dirname, 'uploads')));

// Enforce versione minima app su tutte le API del nuovo backend.
app.use('/api', (req, res, next) => {
  if (MIN_SUPPORTED_APP_VERSION_CODE <= 0) {
    return next();
  }

  // Endpoint pubblici senza controllo versione (bootstrap / asset globali / auth pre-login).
  if (
    req.path === '/public/app-loading' ||
    req.path === '/public/media-cache-event' ||
    req.path === '/auth/forgot-password'
  ) {
    return next();
  }

  // Lascia sempre accessibili endpoint diagnostici e cron.
  if (req.path === '/health' || req.path === '/test-db' || req.path === '/notifications/run-cron') {
    return next();
  }

  const versionHeader = req.get('X-App-Version-Code');
  const currentVersionCode = parseInt(versionHeader || '0', 10) || 0;

  if (currentVersionCode < MIN_SUPPORTED_APP_VERSION_CODE) {
    return res.status(426).json({
      code: 'UPDATE_REQUIRED',
      message: 'Questa versione dell\'app non e piu supportata. Aggiorna per continuare.',
      current_version_code: currentVersionCode,
      min_supported_version_code: MIN_SUPPORTED_APP_VERSION_CODE,
      update_url: APP_FORCE_UPDATE_URL,
    });
  }

  return next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/leagues', leagueRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/squad', squadRoutes);
app.use('/api/formation', formationRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/official-leagues', officialLeaguesRoutes);
app.use('/api', matchesRoutes);
app.use('/api/public', publicAppRoutes);
app.use('/api/superuser', superuserRoutes);
app.use('/api/players', playerStatsRoutes);
app.use('/api/notifications', notificationsRoutes);

// Health check endpoint (include stato DB se possibile)
app.get('/api/health', async (req, res) => {
  let db = 'unknown';
  try {
    await pool.query('SELECT 1');
    db = 'ok';
  } catch (err) {
    db = 'error';
  }
  res.json({
    status: db === 'ok' ? 'OK' : 'DEGRADED',
    message: 'FantaCoppa API is running',
    db,
    timestamp: new Date().toISOString(),
  });
});

// Test database connection endpoint
app.get('/api/test-db', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'OK', 
      message: 'Database connection successful' 
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: 'Database connection failed',
      error: error?.message || String(error),
    });
  }
});

// Landing invito lega (https cliccabile su WhatsApp) → apre app via scheme
app.get('/invite/:token', (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token || token.length < 20 || token.length > 200) {
    return res.status(400).type('html').send(`<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Invito non valido</title></head>
<body style="font-family:system-ui,sans-serif;padding:24px;background:#f4f6fb;color:#0f172a">
  <h1 style="font-size:20px">Invito non valido</h1>
  <p style="color:#64748b">Il link non è corretto. Chiedi all'admin un nuovo invito.</p>
</body></html>`);
  }

  const safeToken = encodeURIComponent(token);
  const deepLink = `fantacoppa://invite/${safeToken}`;
  const intentLink = `intent://invite/${safeToken}#Intent;scheme=fantacoppa;package=com.fantacoppa.app;end`;

  res
    .status(200)
    .type('html')
    .set('Cache-Control', 'no-store')
    .send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex"/>
  <title>Apri FantaCoppa</title>
  <meta http-equiv="refresh" content="0;url=${deepLink}"/>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f4f6fb;color:#0f172a;
      display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
    .card{background:#fff;border:1px solid #e8eaf1;border-radius:16px;padding:28px 22px;max-width:380px;width:100%;text-align:center}
    h1{font-size:20px;margin:0 0 8px}
    p{margin:0 0 18px;color:#64748b;font-size:14px;line-height:1.45}
    a.btn{display:inline-block;background:#667eea;color:#fff;text-decoration:none;font-weight:700;
      padding:12px 18px;border-radius:12px;font-size:15px}
    a.alt{display:block;margin-top:14px;color:#4338ca;font-size:13px;font-weight:600}
  </style>
</head>
<body>
  <div class="card">
    <h1>Invito lega</h1>
    <p>Sto aprendo FantaCoppa… Se non succede nulla, usa il pulsante qui sotto.</p>
    <a class="btn" href="${deepLink}">Apri in FantaCoppa</a>
    <a class="alt" href="${intentLink}">Apri su Android</a>
  </div>
  <script>
    (function () {
      var deep = ${JSON.stringify(deepLink)};
      try { window.location.replace(deep); } catch (e) {}
      setTimeout(function () {
        try { window.location.href = deep; } catch (e2) {}
      }, 400);
    })();
  </script>
</body>
</html>`);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Endpoint non trovato' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    message: 'Errore interno del server',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const { runEmailDiagnostics } = require('./utils/emailDelivery');

// Avvia server
app.listen(PORT, () => {
  console.log('========================================');
  console.log('🚀 FantaCoppa Backend API');
  console.log('========================================');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌐 API available at http://localhost:${PORT}/api`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔍 Test DB: http://localhost:${PORT}/api/test-db`);
  console.log('========================================');

  runEmailDiagnostics('server_startup').catch((err) => {
    console.error('[DEBUG_FORGOT_BREVO] diagnostica avvio fallita:', err?.message || err);
  });

  try {
    const { startPlayerProfileOpensCleanupJob } = require('./utils/playerProfileOpens');
    startPlayerProfileOpensCleanupJob();
  } catch (err) {
    console.warn('[playerProfileOpens] job non avviato:', err?.message || err);
  }
});


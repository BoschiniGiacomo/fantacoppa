const express = require('express');
const cors = require('cors');
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

// Import database (per testare connessione all'avvio)
const { pool } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Permette richieste da qualsiasi origine (per sviluppo)
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use('/uploads', express.static(path.resolve(__dirname, 'uploads')));
app.use('/api/uploads', express.static(path.resolve(__dirname, 'uploads')));

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
app.use('/api/superuser', superuserRoutes);
app.use('/api/players', playerStatsRoutes);
app.use('/api/notifications', notificationsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'FantaCoppa API is running',
    timestamp: new Date().toISOString()
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
      error: error.message 
    });
  }
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
});


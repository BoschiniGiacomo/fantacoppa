const { Pool } = require('pg');
const path = require('path');
const dotenv = require('dotenv');

// Carica prima backend/.env, poi fallback alla root del progetto.
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';
const hasConnectionString = !!connectionString;

function parsePostgresConnectionString(urlString) {
  const u = new URL(urlString);
  const dbName = (u.pathname || '/postgres').replace(/^\//, '') || 'postgres';
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''),
    database: dbName,
  };
}

const dbConfig = hasConnectionString
  ? {
      ...parsePostgresConnectionString(connectionString),
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'postgres',
      port: Number(process.env.DB_PORT || 5432),
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
    };

const pool = new Pool(dbConfig);

function toPgSql(sql, params = []) {
  let i = 0;
  const text = sql.replace(/\?/g, () => {
    i += 1;
    return `$${i}`;
  });
  return { text, values: params };
}

// Test connessione
pool.connect()
  .then(client => {
    console.log('✅ Connesso al database PostgreSQL (Supabase)');
    client.release();
  })
  .catch(err => {
    console.error('❌ Errore connessione database:', err?.message || err);
    process.exit(1);
  });

// Helper per eseguire query
const query = async (sql, params) => {
  try {
    const { text, values } = toPgSql(sql, params || []);
    const result = await pool.query(text, values);
    const statementType = String(sql || '').trim().split(/\s+/)[0].toUpperCase();
    const isSelectLike = statementType === 'SELECT' || statementType === 'WITH';

    if (isSelectLike) {
      return result.rows;
    }

    if (statementType === 'INSERT') {
      return {
        insertId: result.rows[0] ? (result.rows[0].id || null) : null,
        affectedRows: result.rowCount,
        rows: result.rows,
      };
    }

    return {
      affectedRows: result.rowCount,
      rows: result.rows,
    };
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

module.exports = {
  pool,
  query
};


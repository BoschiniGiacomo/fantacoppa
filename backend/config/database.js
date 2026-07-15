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
      keepAlive: true,
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
      keepAlive: true,
    };

const pool = new Pool(dbConfig);

pool.on('error', (err) => {
  console.error('[DB] Errore client idle nel pool:', err?.message || err);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyDatabaseConnection({
  retries = Number(process.env.DB_CONNECT_RETRIES || 5),
  baseDelayMs = Number(process.env.DB_CONNECT_RETRY_DELAY_MS || 2000),
} = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    let client;
    try {
      client = await pool.connect();
      await client.query('SELECT 1');
      console.log('✅ Connesso al database PostgreSQL (Supabase)');
      return true;
    } catch (err) {
      const msg = err?.message || String(err);
      console.error(`❌ Errore connessione database (tentativo ${attempt}/${retries}):`, msg);
      if (attempt < retries) {
        const waitMs = baseDelayMs * attempt;
        console.log(`[DB] Nuovo tentativo tra ${waitMs}ms...`);
        await sleep(waitMs);
      }
    } finally {
      if (client) client.release();
    }
  }
  console.error(
    '⚠️ Database non raggiungibile all\'avvio: il server parte comunque e ritenterà alle richieste.'
  );
  return false;
}

void verifyDatabaseConnection();

function toPgSql(sql, params = []) {
  let i = 0;
  const text = sql.replace(/\?/g, () => {
    i += 1;
    return `$${i}`;
  });
  return { text, values: params };
}

function isTransientDbError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  const code = String(error?.code || '');
  return (
    msg.includes('connection terminated unexpectedly')
    || msg.includes('connection terminated')
    || msg.includes('connection reset')
    || msg.includes('econnreset')
    || msg.includes('client has encountered a connection error')
    || msg.includes('cannot use a pool after calling end')
    || msg.includes('timeout exceeded when trying to connect')
    || code === 'ECONNRESET'
    || code === 'ECONNREFUSED'
    || code === 'ETIMEDOUT'
    || code === '57P01'
    || code === '08006'
    || code === '08003'
    || code === '08001'
  );
}

async function runQuery(sql, params) {
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
}

const query = async (sql, params, options = {}) => {
  const retries = Number.isFinite(options.retries)
    ? options.retries
    : Number(process.env.DB_QUERY_RETRIES || 2);
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await runQuery(sql, params);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < retries && isTransientDbError(error);
      if (canRetry) {
        const waitMs = 150 * (attempt + 1);
        console.warn(
          `[DB] Query transient error (attempt ${attempt + 1}/${retries + 1}): ${error?.message || error}. Retry in ${waitMs}ms`
        );
        await sleep(waitMs);
        continue;
      }
      console.error('Database query error:', error?.message || error);
      throw error;
    }
  }

  throw lastError;
};

module.exports = {
  pool,
  query,
};

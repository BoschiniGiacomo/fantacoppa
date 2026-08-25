/**
 * Backup database FantaCoppa.
 *
 * Uso:
 *   npm run backup:db                 → Postgres, solo schema public (app)
 *   npm run backup:db:mysql           → MySQL/MariaDB (Altervista ecc.), schema public
 *   npm run backup:db -- --full       → dump Postgres intero (anche schemi Supabase)
 *   node scripts/backupDatabase.js --dialect=mysql --keep=20
 *
 * Credenziali: DATABASE_URL o SUPABASE_DB_URL in backend/.env
 * Postgres dump richiede pg_dump; MySQL dump usa solo Node + pg.
 *
 * Output in backups/:
 *   fantacoppa-postgres-YYYYMMDD-HHMMSS.sql
 *   fantacoppa-mysql-YYYYMMDD-HHMMSS.sql
 */
const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BACKUPS_DIR = path.join(ROOT, 'backups');

const dotenv = require(path.join(ROOT, 'backend', 'node_modules', 'dotenv'));
dotenv.config({ path: path.join(ROOT, 'backend', '.env') });
dotenv.config({ path: path.join(ROOT, '.env') });

function parseArgs(argv) {
  const out = {
    keep: 30,
    format: 'plain',
    dialect: 'postgres',
    scope: 'public',
    help: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--keep=')) {
      const n = Number(arg.slice('--keep='.length));
      if (Number.isFinite(n) && n >= 0) out.keep = Math.trunc(n);
    } else if (arg.startsWith('--format=')) {
      const f = String(arg.slice('--format='.length)).trim().toLowerCase();
      if (f === 'plain' || f === 'sql' || f === 'custom' || f === 'dump') {
        out.format = f === 'sql' ? 'plain' : f === 'dump' ? 'custom' : f;
      }
    } else if (arg.startsWith('--dialect=')) {
      const d = String(arg.slice('--dialect='.length)).trim().toLowerCase();
      if (d === 'postgres' || d === 'postgresql' || d === 'pg') out.dialect = 'postgres';
      else if (d === 'mysql' || d === 'mariadb') out.dialect = 'mysql';
    } else if (arg === '--mysql') {
      out.dialect = 'mysql';
    } else if (arg === '--full') {
      out.scope = 'full';
    } else if (arg.startsWith('--scope=')) {
      const s = String(arg.slice('--scope='.length)).trim().toLowerCase();
      if (s === 'public' || s === 'app') out.scope = 'public';
      else if (s === 'full' || s === 'all') out.scope = 'full';
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    }
  }
  return out;
}

function parseDbUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/i.test(u.protocol)) return null;

  let port = u.port || '5432';
  // pg_dump non funziona sul pooler transaction (6543)
  if (port === '6543') port = '5432';

  return {
    host: u.hostname,
    port,
    user: decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''),
    database: decodeURIComponent((u.pathname || '/postgres').replace(/^\//, '') || 'postgres'),
    connectionString: s,
  };
}

function resolveDbConfig() {
  const fromUrl = parseDbUrl(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL);
  if (fromUrl) return fromUrl;
  return {
    host: process.env.DB_HOST || 'localhost',
    port: String(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'postgres',
    connectionString: null,
  };
}

function findPgDump() {
  const whichCmd = process.platform === 'win32' ? 'where pg_dump' : 'which pg_dump';
  try {
    const out = execSync(whichCmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = String(out || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    if (first && fs.existsSync(first)) return first;
  } catch {
    // not in PATH
  }

  if (process.platform === 'win32') {
    const roots = [
      'C:\\Program Files\\PostgreSQL',
      'C:\\Program Files (x86)\\PostgreSQL',
    ];
    const found = [];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const candidate = path.join(root, ent.name, 'bin', 'pg_dump.exe');
        if (fs.existsSync(candidate)) found.push(candidate);
      }
    }
    found.sort((a, b) => String(b).localeCompare(String(a), undefined, { numeric: true }));
    if (found[0]) return found[0];
  }

  return null;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function pruneOldBackups(dir, keep, prefix, ext) {
  if (!Number.isFinite(keep) || keep <= 0) return;
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith(prefix) && n.endsWith(ext))
    .map((n) => ({ name: n, abs: path.join(dir, n), mtime: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of files.slice(keep)) {
    fs.unlinkSync(old.abs);
    console.log(`[backup:db] rimosso vecchio backup: ${old.name}`);
  }
}

function mysqlIdent(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function pgIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function mysqlQuoteString(value) {
  return `'${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x00/g, '\\0')
    .replace(/\u001a/g, '\\Z')}'`;
}

function formatMysqlDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return 'NULL';
  const p = (n) => String(n).padStart(2, '0');
  return mysqlQuoteString(
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
      `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

function formatMysqlDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) {
    const s = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return mysqlQuoteString(s.slice(0, 10));
    return 'NULL';
  }
  const p = (n) => String(n).padStart(2, '0');
  return mysqlQuoteString(`${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`);
}

function mapPgTypeToMysql(col, enumsByName) {
  const udt = String(col.udt_name || '');
  const dataType = String(col.data_type || '');
  const isSerial = /nextval\(/i.test(String(col.column_default || ''));

  if (enumsByName.has(udt)) {
    const labels = enumsByName.get(udt).map((l) => mysqlQuoteString(l)).join(',');
    return `ENUM(${labels})`;
  }

  switch (udt) {
    case 'int2':
      return isSerial ? 'SMALLINT AUTO_INCREMENT' : 'SMALLINT';
    case 'int4':
      return isSerial ? 'INT AUTO_INCREMENT' : 'INT';
    case 'int8':
      return isSerial ? 'BIGINT AUTO_INCREMENT' : 'BIGINT';
    case 'float4':
      return 'FLOAT';
    case 'float8':
      return 'DOUBLE';
    case 'numeric': {
      const p = Number(col.numeric_precision);
      const s = Number(col.numeric_scale);
      if (Number.isFinite(p) && Number.isFinite(s)) return `DECIMAL(${p},${s})`;
      return 'DECIMAL(38,10)';
    }
    case 'varchar': {
      const len = Number(col.character_maximum_length);
      if (Number.isFinite(len) && len > 0 && len <= 16383) return `VARCHAR(${len})`;
      return 'TEXT';
    }
    case 'text':
    case 'citext':
      return 'LONGTEXT';
    case 'date':
      return 'DATE';
    case 'time':
    case 'timetz':
      return 'TIME';
    case 'timestamp':
    case 'timestamptz':
      return 'DATETIME';
    case 'bool':
      return 'TINYINT(1)';
    case 'json':
    case 'jsonb':
      return 'JSON';
    case 'uuid':
      return 'CHAR(36)';
    case 'bytea':
      return 'LONGBLOB';
    default:
      if (dataType === 'ARRAY') return 'LONGTEXT';
      return 'LONGTEXT';
  }
}

function mysqlLiteral(value, col) {
  if (value == null) return 'NULL';
  const udt = String(col.udt_name || '');

  if (udt === 'bool' || typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL';
    return String(value);
  }
  if (typeof value === 'bigint') return String(value);
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;

  if (udt === 'json' || udt === 'jsonb' || (typeof value === 'object' && !(value instanceof Date))) {
    try {
      return mysqlQuoteString(typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
      return 'NULL';
    }
  }

  if (udt === 'date' || (value instanceof Date && udt === 'date')) {
    return formatMysqlDate(value);
  }
  if (udt === 'timestamp' || udt === 'timestamptz' || value instanceof Date) {
    return formatMysqlDateTime(value);
  }
  if (udt === 'time' || udt === 'timetz') {
    return mysqlQuoteString(String(value).slice(0, 8));
  }

  return mysqlQuoteString(value);
}

async function createPgClient(db) {
  const { Client } = require(path.join(ROOT, 'backend', 'node_modules', 'pg'));
  const client = new Client(
    db.connectionString
      ? { connectionString: db.connectionString, ssl: { rejectUnauthorized: false } }
      : {
          host: db.host,
          port: Number(db.port || 5432),
          user: db.user,
          password: db.password,
          database: db.database,
          ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
        }
  );
  await client.connect();
  return client;
}

async function dumpMysqlFromPublic(db, outFile) {
  const client = await createPgClient(db);
  const stream = fs.createWriteStream(outFile, { encoding: 'utf8' });
  const write = (chunk) =>
    new Promise((resolve, reject) => {
      stream.write(chunk, (err) => (err ? reject(err) : resolve()));
    });

  try {
    await write(`-- FantaCoppa MySQL/MariaDB dump (converted from PostgreSQL public schema)
-- Generated: ${new Date().toISOString()}
-- Source host: ${db.host} / ${db.database}
-- Note: tipi Postgres convertiti al meglio; verifica su Altervista/MySQL 5.7+/8+
--       Import: phpMyAdmin o mysql < file.sql
--       Se fallisce per dimensione: aumenta max_allowed_packet o importa a pezzi.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET UNIQUE_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';
SET time_zone = '+00:00';

`);

    const enumRows = await client.query(`
      SELECT t.typname, e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      ORDER BY t.typname, e.enumsortorder
    `);
    const enumsByName = new Map();
    for (const row of enumRows.rows || []) {
      if (!enumsByName.has(row.typname)) enumsByName.set(row.typname, []);
      enumsByName.get(row.typname).push(row.enumlabel);
    }

    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tables = (tablesRes.rows || []).map((r) => r.table_name);
    console.log(`[backup:db] MySQL export: ${tables.length} tabelle...`);

    const pkMap = new Map();
    const pkRes = await client.query(`
      SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY tc.table_name, kcu.ordinal_position
    `);
    for (const row of pkRes.rows || []) {
      if (!pkMap.has(row.table_name)) pkMap.set(row.table_name, []);
      pkMap.get(row.table_name).push(row.column_name);
    }

    for (const table of tables) {
      const colsRes = await client.query(
        `
        SELECT column_name, data_type, udt_name, character_maximum_length,
               numeric_precision, numeric_scale, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `,
        [table]
      );
      const cols = colsRes.rows || [];
      if (!cols.length) continue;

      const colDefs = cols.map((col) => {
        let def = `  ${mysqlIdent(col.column_name)} ${mapPgTypeToMysql(col, enumsByName)}`;
        if (String(col.is_nullable).toUpperCase() === 'NO' && !/AUTO_INCREMENT/i.test(def)) {
          def += ' NOT NULL';
        } else if (/AUTO_INCREMENT/i.test(def) && String(col.is_nullable).toUpperCase() === 'NO') {
          def += ' NOT NULL';
        }
        return def;
      });

      const pkCols = pkMap.get(table) || [];
      if (pkCols.length) {
        colDefs.push(`  PRIMARY KEY (${pkCols.map(mysqlIdent).join(', ')})`);
      }

      await write(`\nDROP TABLE IF EXISTS ${mysqlIdent(table)};\n`);
      await write(`CREATE TABLE ${mysqlIdent(table)} (\n${colDefs.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n`);

      const selectList = cols.map((c) => pgIdent(c.column_name)).join(', ');
      const q = await client.query(`SELECT ${selectList} FROM ${pgIdent(table)}`);
      const rows = q.rows || [];
      if (!rows.length) {
        console.log(`[backup:db]   ${table}: 0 righe`);
        continue;
      }

      const batchSize = 80;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const values = batch.map((row) => {
          const literals = cols.map((col) => mysqlLiteral(row[col.column_name], col));
          return `(${literals.join(',')})`;
        });
        await write(
          `INSERT INTO ${mysqlIdent(table)} (${cols.map((c) => mysqlIdent(c.column_name)).join(',')}) VALUES\n` +
            `${values.join(',\n')};\n`
        );
      }
      console.log(`[backup:db]   ${table}: ${rows.length} righe`);
    }

    const fkRes = await client.query(`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
    `);

    const fkGroups = new Map();
    for (const row of fkRes.rows || []) {
      const key = `${row.table_name}::${row.constraint_name}`;
      if (!fkGroups.has(key)) {
        fkGroups.set(key, {
          table: row.table_name,
          name: row.constraint_name,
          cols: [],
          refTable: row.foreign_table_name,
          refCols: [],
        });
      }
      const g = fkGroups.get(key);
      g.cols.push(row.column_name);
      g.refCols.push(row.foreign_column_name);
    }

    if (fkGroups.size) {
      await write(`\n-- Foreign keys\n`);
      for (const g of fkGroups.values()) {
        const safeName = String(g.name).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60);
        await write(
          `ALTER TABLE ${mysqlIdent(g.table)} ADD CONSTRAINT ${mysqlIdent(safeName)} ` +
            `FOREIGN KEY (${g.cols.map(mysqlIdent).join(',')}) ` +
            `REFERENCES ${mysqlIdent(g.refTable)} (${g.refCols.map(mysqlIdent).join(',')});\n`
        );
      }
    }

    await write(`\nSET FOREIGN_KEY_CHECKS = 1;\nSET UNIQUE_CHECKS = 1;\n`);
  } finally {
    await new Promise((resolve) => stream.end(resolve));
    await client.end().catch(() => {});
  }
}

function dumpPostgres(db, args, outFile) {
  const pgDump = findPgDump();
  if (!pgDump) {
    console.error(`[backup:db] pg_dump non trovato.
Installa i client PostgreSQL e assicurati che pg_dump sia nel PATH.`);
    process.exit(1);
  }

  const isCustom = args.format === 'custom';
  const dumpArgs = [
    '--host', db.host,
    '--port', db.port,
    '--username', db.user,
    '--dbname', db.database,
    '--no-owner',
    '--no-acl',
    '--verbose',
  ];

  if (args.scope === 'public') {
    dumpArgs.push('--schema=public');
  }

  if (isCustom) {
    dumpArgs.push('--format=custom', '--file', outFile);
  } else {
    dumpArgs.push('--format=plain', '--file', outFile);
  }

  console.log(
    `[backup:db] Postgres ${args.scope} → ${path.relative(ROOT, outFile)} (host=${db.host})`
  );

  const result = spawnSync(pgDump, dumpArgs, {
    env: {
      ...process.env,
      PGPASSWORD: db.password || '',
      PGSSLMODE: process.env.PGSSLMODE || 'require',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    if (fs.existsSync(outFile) && fs.statSync(outFile).size === 0) {
      try {
        fs.unlinkSync(outFile);
      } catch {
        // ignore
      }
    }
    console.error('[backup:db] FALLITO');
    if (result.stderr) console.error(result.stderr);
    if (result.stdout) console.error(result.stdout);
    process.exit(result.status || 1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Uso:
  npm run backup:db
  npm run backup:db:mysql
  node scripts/backupDatabase.js [opzioni]

Opzioni:
  --dialect=postgres|mysql   destinazione (default postgres)
  --mysql                    alias di --dialect=mysql
  --scope=public|full        solo app (public) o dump intero Supabase (solo postgres)
  --full                     alias di --scope=full
  --format=plain|custom      solo postgres (custom = .dump)
  --keep=N                   backup recenti da tenere (default 30; 0 = non cancellare)`);
    process.exit(0);
  }

  const db = resolveDbConfig();
  if (!db.host || !db.database) {
    console.error('[backup:db] Imposta DATABASE_URL o SUPABASE_DB_URL in backend/.env');
    process.exit(1);
  }

  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  if (args.dialect === 'mysql') {
    if (args.scope === 'full') {
      console.warn('[backup:db] MySQL esporta solo schema public (app); --full ignorato.');
    }
    const outFile = path.join(BACKUPS_DIR, `fantacoppa-mysql-${stamp()}.sql`);
    console.log(`[backup:db] MySQL ← public @ ${db.host}`);
    await dumpMysqlFromPublic(db, outFile);
    const sizeMb = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(2);
    console.log(`[backup:db] OK ${outFile} (${sizeMb} MB)`);
    pruneOldBackups(BACKUPS_DIR, args.keep, 'fantacoppa-mysql-', '.sql');
    console.log('[backup:db] Import MySQL/Altervista (ATTENZIONE: DROP TABLE):');
    console.log(`  mysql -u USER -p DB_NAME < "${outFile}"`);
    console.log('  oppure Importa in phpMyAdmin');
    return;
  }

  const isCustom = args.format === 'custom';
  const ext = isCustom ? '.dump' : '.sql';
  const prefix = args.scope === 'full' ? 'fantacoppa-postgres-full-' : 'fantacoppa-postgres-';
  const outFile = path.join(BACKUPS_DIR, `${prefix}${stamp()}${ext}`);
  dumpPostgres(db, args, outFile);
  const sizeMb = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(2);
  console.log(`[backup:db] OK ${outFile} (${sizeMb} MB)`);
  pruneOldBackups(BACKUPS_DIR, args.keep, prefix, ext);
  console.log('[backup:db] Ripristino Postgres (ATTENZIONE: sovrascrive i dati):');
  if (isCustom) {
    console.log(`  pg_restore --clean --if-exists --no-owner --dbname=<URL> "${outFile}"`);
  } else {
    console.log(`  psql "<DATABASE_URL>" -f "${outFile}"`);
  }
}

main().catch((err) => {
  console.error('[backup:db] ERRORE:', err?.message || err);
  process.exit(1);
});

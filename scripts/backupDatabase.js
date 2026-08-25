/**
 * Backup completo del database PostgreSQL (Supabase / locale).
 *
 * Uso:
 *   npm run backup:db
 *   node scripts/backupDatabase.js
 *   node scripts/backupDatabase.js --keep=20
 *   node scripts/backupDatabase.js --format=custom   (file .dump, ripristino con pg_restore)
 *
 * Richiede: pg_dump nel PATH (PostgreSQL client tools).
 * Credenziali: DATABASE_URL o SUPABASE_DB_URL in backend/.env (o .env in root).
 *
 * Output: backups/fantacoppa-YYYYMMDD-HHMMSS.sql (o .dump)
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
  const out = { keep: 30, format: 'plain' };
  for (const arg of argv) {
    if (arg.startsWith('--keep=')) {
      const n = Number(arg.slice('--keep='.length));
      if (Number.isFinite(n) && n >= 0) out.keep = Math.trunc(n);
    } else if (arg.startsWith('--format=')) {
      const f = String(arg.slice('--format='.length)).trim().toLowerCase();
      if (f === 'plain' || f === 'sql' || f === 'custom' || f === 'dump') {
        out.format = f === 'sql' ? 'plain' : f === 'dump' ? 'custom' : f;
      }
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
  // pg_dump non funziona sul pooler transaction (6543): usa la connessione diretta
  if (port === '6543') port = '5432';

  return {
    host: u.hostname,
    port,
    user: decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''),
    database: decodeURIComponent((u.pathname || '/postgres').replace(/^\//, '') || 'postgres'),
  };
}

function resolveDbConfig() {
  const fromUrl = parseDbUrl(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL);
  if (fromUrl) return fromUrl;
  return {
    host: process.env.DB_HOST || 'localhost',
    port: String(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'postgres',
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
    const candidates = [
      'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
      'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
      'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
      'C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
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

function pruneOldBackups(dir, keep, ext) {
  if (!Number.isFinite(keep) || keep <= 0) return;
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith('fantacoppa-') && n.endsWith(ext))
    .map((n) => ({ name: n, abs: path.join(dir, n), mtime: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of files.slice(keep)) {
    fs.unlinkSync(old.abs);
    console.log(`[backup:db] rimosso vecchio backup: ${old.name}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Uso:
  npm run backup:db
  node scripts/backupDatabase.js [--keep=30] [--format=plain|custom]

  --keep=N     quanti backup recenti tenere (default 30; 0 = non cancellare)
  --format     plain = .sql (default), custom = .dump (pg_restore)`);
    process.exit(0);
  }

  const db = resolveDbConfig();
  if (!db.host || !db.database) {
    console.error('[backup:db] Imposta DATABASE_URL o SUPABASE_DB_URL in backend/.env');
    process.exit(1);
  }

  const pgDump = findPgDump();
  if (!pgDump) {
    console.error(`[backup:db] pg_dump non trovato.
Installa i client PostgreSQL e assicurati che pg_dump sia nel PATH,
oppure installa PostgreSQL da https://www.postgresql.org/download/windows/`);
    process.exit(1);
  }

  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  const isCustom = args.format === 'custom';
  const ext = isCustom ? '.dump' : '.sql';
  const outFile = path.join(BACKUPS_DIR, `fantacoppa-${stamp()}${ext}`);

  const dumpArgs = [
    '--host', db.host,
    '--port', db.port,
    '--username', db.user,
    '--dbname', db.database,
    '--no-owner',
    '--no-acl',
    '--verbose',
  ];

  if (isCustom) {
    dumpArgs.push('--format=custom', '--file', outFile);
  } else {
    dumpArgs.push('--format=plain', '--file', outFile);
  }

  console.log(`[backup:db] host=${db.host} db=${db.database} → ${path.relative(ROOT, outFile)}`);

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

  const sizeMb = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(2);
  console.log(`[backup:db] OK ${outFile} (${sizeMb} MB)`);

  pruneOldBackups(BACKUPS_DIR, args.keep, ext);
  console.log('[backup:db] Per ripristinare (ATTENZIONE: sovrascrive i dati):');
  if (isCustom) {
    console.log(`  pg_restore --clean --if-exists --no-owner --dbname=<URL> "${outFile}"`);
  } else {
    console.log(`  psql "<DATABASE_URL>" -f "${outFile}"`);
  }
}

main();

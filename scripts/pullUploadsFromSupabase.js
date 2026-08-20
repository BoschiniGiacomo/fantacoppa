/**
 * Scarica il bucket Supabase `uploads` nella cartella locale uploads/.
 *
 * Richiede SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY nel .env (root o backend/)
 *
 *   npm run pull:uploads:supabase
 *   npm run pull:uploads:supabase -- --dry-run
 *   npm run pull:uploads:supabase -- --prefix match_background
 *   npm run pull:uploads:supabase -- --force
 *   npm run pull:uploads:supabase -- --manifest
 *   npm run pull:uploads:supabase -- --folders app_loading,login_logo
 *
 * Default: salta file già presenti con stessa size (se metadata disponibile).
 * --force: riscarica tutto. --manifest: rigenera bundledUploadsManifest.js a fine pull.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { createClient } = require(path.join(ROOT, 'backend', 'node_modules', '@supabase', 'supabase-js'));
const dotenv = require(path.join(ROOT, 'backend', 'node_modules', 'dotenv'));
const UPLOADS = path.join(ROOT, 'uploads');

dotenv.config({ path: path.join(ROOT, 'backend', '.env') });
dotenv.config({ path: path.join(ROOT, '.env') });

/** Cartelle incluse nell'OTA / assetBundlePatterns (no team_logos). */
const BUNDLE_UPLOAD_FOLDERS = [
  'app_loading',
  'login_background',
  'login_logo',
  'match_background',
  'official_group_logos',
  'official_team_logos',
  'player_photos',
];

const EXCLUDE_DIRS = new Set(['team_logos']);
const LIST_LIMIT = 1000;

function argValue(flag, argv = process.argv) {
  const i = argv.indexOf(flag);
  if (i < 0 || i + 1 >= argv.length) return null;
  return String(argv[i + 1] || '').trim() || null;
}

function parseFolders(raw) {
  if (!raw) return null;
  return String(raw)
    .split(',')
    .map((s) => s.trim().replace(/^uploads\//, '').replace(/\/+$/, ''))
    .filter(Boolean);
}

function getClient() {
  const url = String(process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    throw new Error('Mancano SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nel .env');
  }
  return createClient(url, key);
}

function isFolderEntry(entry) {
  return entry?.id == null;
}

async function listAllInFolder(supabase, folder) {
  const out = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from('uploads').list(folder || '', {
      limit: LIST_LIMIT,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`list ${folder || '/'}: ${error.message}`);
    const batch = Array.isArray(data) ? data : [];
    out.push(...batch);
    if (batch.length < LIST_LIMIT) break;
    offset += batch.length;
  }
  return out;
}

async function walkRemote(supabase, folder = '', excludeDirs = EXCLUDE_DIRS) {
  const top = folder.split('/').filter(Boolean)[0];
  if (top && excludeDirs.has(top)) return [];

  const entries = await listAllInFolder(supabase, folder);
  const files = [];

  for (const entry of entries) {
    const name = String(entry?.name || '').trim();
    if (!name || name === '.emptyFolderPlaceholder') continue;
    const rel = folder ? `${folder}/${name}` : name;
    const topSeg = rel.split('/')[0];
    if (excludeDirs.has(topSeg)) continue;

    if (isFolderEntry(entry)) {
      files.push(...(await walkRemote(supabase, rel, excludeDirs)));
      continue;
    }

    files.push({
      storagePath: rel.replace(/\\/g, '/'),
      size: entry?.metadata?.size != null ? Number(entry.metadata.size) : null,
      updatedAt: entry?.updated_at || entry?.created_at || null,
    });
  }
  return files;
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  const results = new Array(items.length);
  async function run() {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => run()));
  return results;
}

function shouldSkipLocal(abs, remoteSize, force) {
  if (force || !fs.existsSync(abs)) return false;
  if (remoteSize == null || !Number.isFinite(remoteSize)) return false;
  try {
    return fs.statSync(abs).size === remoteSize;
  } catch {
    return false;
  }
}

async function downloadOne(supabase, file, { dryRun, force }) {
  const abs = path.join(UPLOADS, ...file.storagePath.split('/'));
  if (shouldSkipLocal(abs, file.size, force)) {
    return { status: 'skip', path: file.storagePath };
  }

  if (dryRun) {
    return { status: 'planned', path: file.storagePath };
  }

  const { data, error } = await supabase.storage.from('uploads').download(file.storagePath);
  if (error) {
    return { status: 'fail', path: file.storagePath, error: error.message };
  }

  const buf = Buffer.from(await data.arrayBuffer());
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return { status: 'ok', path: file.storagePath, bytes: buf.length };
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.force]
 * @param {boolean} [opts.manifest]
 * @param {string|null} [opts.prefix] single folder prefix
 * @param {string[]|null} [opts.folders] list of top-level folders to pull
 * @param {number} [opts.concurrency]
 * @param {boolean} [opts.quiet]
 */
async function pullUploadsFromSupabase(opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const force = Boolean(opts.force);
  const withManifest = Boolean(opts.manifest);
  const concurrency = Math.max(1, Math.min(12, Number(opts.concurrency || 6) || 6));
  const quiet = Boolean(opts.quiet);

  let folders = Array.isArray(opts.folders) ? opts.folders.filter(Boolean) : null;
  const prefix = opts.prefix
    ? String(opts.prefix).replace(/^uploads\//, '').replace(/^\/+|\/+$/g, '')
    : null;

  if (!folders && prefix) folders = [prefix];

  const supabase = getClient();

  let remoteFiles = [];
  if (folders && folders.length > 0) {
    if (!quiet) {
      console.log(
        dryRun ? '[dry-run]' : '[pull]',
        `cartelle: ${folders.join(', ')}`,
        force ? '[force]' : '[skip same size]'
      );
    }
    for (const folder of folders) {
      remoteFiles.push(...(await walkRemote(supabase, folder, new Set())));
    }
  } else {
    if (!quiet) {
      console.log(
        dryRun ? '[dry-run]' : '[pull]',
        `bucket uploads → ${path.relative(ROOT, UPLOADS)} (escluso team_logos)`,
        force ? '[force]' : '[skip same size]'
      );
    }
    remoteFiles = await walkRemote(supabase, '', EXCLUDE_DIRS);
  }

  // dedupe path
  const byPath = new Map();
  for (const f of remoteFiles) byPath.set(f.storagePath, f);
  remoteFiles = [...byPath.values()];

  if (!quiet) console.log(`Trovati ${remoteFiles.length} file remoti`);

  let ok = 0;
  let skip = 0;
  let fail = 0;
  let planned = 0;
  const changed = [];

  await mapPool(remoteFiles, concurrency, async (file) => {
    const res = await downloadOne(supabase, file, { dryRun, force });
    if (res.status === 'ok') {
      ok += 1;
      changed.push(res.path);
      if (!quiet && ok % 25 === 0) console.log(`  … ${ok} scaricati`);
    } else if (res.status === 'skip') {
      skip += 1;
    } else if (res.status === 'planned') {
      planned += 1;
      changed.push(res.path);
      if (!quiet) console.log('  download', res.path);
    } else {
      fail += 1;
      console.warn('  fail', res.path, res.error || '');
    }
    return res;
  });

  if (!quiet) {
    if (dryRun) {
      console.log(`Dry-run: ${planned} da scaricare, ${skip} già ok, ${fail} errori`);
    } else {
      console.log(`Fatto: ${ok} scaricati, ${skip} saltati, ${fail} errori`);
    }
  }

  if (!dryRun && withManifest) {
    execSync('node scripts/generateBundledUploadsManifest.js', { cwd: ROOT, stdio: 'inherit' });
  }

  return {
    remoteCount: remoteFiles.length,
    downloaded: ok,
    planned,
    skipped: skip,
    failed: fail,
    changed,
    hasChanges: changed.length > 0,
  };
}

async function mainCli() {
  const folders = parseFolders(argValue('--folders'));
  const result = await pullUploadsFromSupabase({
    dryRun: process.argv.includes('--dry-run'),
    force: process.argv.includes('--force'),
    manifest: process.argv.includes('--manifest'),
    prefix: argValue('--prefix'),
    folders,
    concurrency: Number(argValue('--concurrency') || 6) || 6,
  });
  if (result.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  mainCli().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

module.exports = {
  BUNDLE_UPLOAD_FOLDERS,
  pullUploadsFromSupabase,
};

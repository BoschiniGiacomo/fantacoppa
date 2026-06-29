/**
 * Allinea Supabase Storage con uploads/ locale (dopo dedupe).
 * - Carica/aggiorna i file canonici presenti in locale
 * - Rimuove su Storage i path obsoleti elencati in uploadPathAliases.js
 *
 * Richiede SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY nel .env
 *
 *   node scripts/syncUploadsToSupabase.js
 *   node scripts/syncUploadsToSupabase.js --dry-run
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { createClient } = require(path.join(ROOT, 'backend', 'node_modules', '@supabase', 'supabase-js'));
const dotenv = require(path.join(ROOT, 'backend', 'node_modules', 'dotenv'));
const UPLOADS = path.join(ROOT, 'uploads');
const ALIASES_FILE = path.join(ROOT, 'src', 'generated', 'uploadPathAliases.js');
const EXCLUDE_DIRS = new Set(['team_logos']);

dotenv.config({ path: path.join(ROOT, 'backend', '.env') });
dotenv.config({ path: path.join(ROOT, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
};

function loadAliasSources() {
  if (!fs.existsSync(ALIASES_FILE)) return [];
  const raw = fs.readFileSync(ALIASES_FILE, 'utf8');
  const sources = [];
  const re = /'((?:\\'|[^'])*)'\s*:\s*'/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    sources.push(m[1].replace(/\\'/g, "'"));
  }
  return sources;
}

function walkLocalFiles(dir, rel = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.isDirectory()) {
      if (EXCLUDE_DIRS.has(name.name)) continue;
      out.push(...walkLocalFiles(path.join(dir, name.name), rel ? `${rel}/${name.name}` : name.name));
      continue;
    }
    const relPath = rel ? `${rel}/${name.name}` : name.name;
    out.push({
      storagePath: `uploads/${relPath.replace(/\\/g, '/')}`,
      abs: path.join(dir, name.name),
    });
  }
  return out;
}

function getClient() {
  const url = String(process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    throw new Error('Mancano SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nel .env');
  }
  return createClient(url, key);
}

async function main() {
  const supabase = getClient();
  const localFiles = walkLocalFiles(UPLOADS);
  const obsolete = loadAliasSources();

  console.log(DRY_RUN ? '[dry-run]' : '[sync]', `${localFiles.length} file locali, ${obsolete.length} path obsoleti`);

  let uploaded = 0;
  for (const file of localFiles) {
    const rel = file.storagePath.replace(/^uploads\//, '');
    const ext = path.extname(file.abs).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const body = fs.readFileSync(file.abs);

    if (DRY_RUN) {
      console.log('  upload', rel);
      uploaded += 1;
      continue;
    }

    const { error } = await supabase.storage.from('uploads').upload(rel, body, {
      contentType,
      upsert: true,
      cacheControl: '31536000',
    });
    if (error) {
      console.warn('  upload fail', rel, error.message);
    } else {
      uploaded += 1;
    }
  }

  let removed = 0;
  const toRemove = obsolete.map((p) => p.replace(/^uploads\//, '')).filter(Boolean);
  if (toRemove.length > 0) {
    if (DRY_RUN) {
      console.log('  remove', toRemove.length, 'obsoleti');
      removed = toRemove.length;
    } else {
      const BATCH = 50;
      for (let i = 0; i < toRemove.length; i += BATCH) {
        const batch = toRemove.slice(i, i + BATCH);
        const { error } = await supabase.storage.from('uploads').remove(batch);
        if (error) console.warn('  remove batch fail', error.message);
        else removed += batch.length;
      }
    }
  }

  console.log(`Fatto: ${uploaded} upload, ${removed} rimossi da Storage`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

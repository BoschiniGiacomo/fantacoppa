/**
 * Deduplica uploads/ locale prima del bundle APK.
 *
 * - official_team_logos: un file per immagine identica (hash MD5), mantiene il più recente
 * - player_photos: con --db unifica per cluster approvato (stessa foto su tutti i membri)
 *
 * Genera src/generated/uploadPathAliases.js (path vecchi → path canonico).
 *
 * Uso:
 *   node scripts/dedupeUploadsMedia.js
 *   node scripts/dedupeUploadsMedia.js --db          (richiede DATABASE_URL)
 *   node scripts/dedupeUploadsMedia.js --dry-run
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const UPLOADS = path.join(ROOT, 'uploads');
const OUT_DIR = path.join(ROOT, 'src', 'generated');
const ALIASES_FILE = path.join(OUT_DIR, 'uploadPathAliases.js');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const WITH_DB = args.has('--db');

const {
  buildOfficialTeamLogoFilename,
  buildPlayerClusterPhotoFilename,
  extractUploadTimestamp,
  normalizeTeamNameForStorage,
} = require('../backend/utils/mediaCanonical');

function posix(p) {
  return p.split(path.sep).join('/');
}

function storagePath(folder, filename) {
  return `uploads/${folder}/${filename}`;
}

function fileScore(filename, stat) {
  const ts = extractUploadTimestamp(filename);
  if (ts > 0) return ts;
  return stat?.mtimeMs ? Math.floor(stat.mtimeMs) : 0;
}

function pickNewestFile(filesWithStats) {
  return filesWithStats.reduce((best, cur) => (fileScore(cur.name, cur.stat) >= fileScore(best.name, best.stat) ? cur : best));
}

function dedupeFolderByHash(folderName) {
  const dir = path.join(UPLOADS, folderName);
  if (!fs.existsSync(dir)) return { aliases: {}, removed: 0, kept: 0 };

  const names = fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile());
  const byHash = new Map();

  for (const name of names) {
    const abs = path.join(dir, name);
    const buf = fs.readFileSync(abs);
    const hash = crypto.createHash('md5').update(buf).digest('hex');
    const entry = { name, abs, stat: fs.statSync(abs), hash };
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(entry);
  }

  const aliases = {};
  let removed = 0;
  let kept = 0;

  for (const group of byHash.values()) {
    const winner = pickNewestFile(group);
    const canonical = storagePath(folderName, winner.name);
    kept += 1;
    for (const item of group) {
      const full = storagePath(folderName, item.name);
      if (full !== canonical) {
        aliases[full] = canonical;
        if (!DRY_RUN && item.abs !== winner.abs) {
          fs.unlinkSync(item.abs);
          removed += 1;
        } else if (item.abs !== winner.abs) {
          removed += 1;
        }
      }
    }
  }

  return { aliases, removed, kept: byHash.size };
}

async function dedupeTeamLogosByGroupName() {
  if (!WITH_DB) return { aliases: {}, renamed: 0 };

  const { query } = require('../backend/config/database');
  const rows = await query(
    `SELECT
       l.official_group_id AS group_id,
       LOWER(TRIM(t.name)) AS team_name_norm,
       t.name AS team_name,
       COALESCE(NULLIF(to_jsonb(t)->>'logo_path',''), NULLIF(t.logo_path,'')) AS logo_path
     FROM teams t
     INNER JOIN leagues l ON l.id = t.league_id
     WHERE l.official_group_id IS NOT NULL
       AND l.official_group_id > 0
       AND COALESCE(l.is_official, 0) = 1
       AND COALESCE(NULLIF(TRIM(COALESCE(NULLIF(to_jsonb(t)->>'logo_path',''), NULLIF(t.logo_path,''))), '') IS NOT NULL`
  );

  const buckets = new Map();
  for (const r of rows || []) {
    const gid = Number(r.group_id);
    const norm = normalizeTeamNameForStorage(r.team_name_norm || r.team_name);
    const logoPath = String(r.logo_path || '').trim();
    if (!gid || !norm || !logoPath) continue;
    const key = `${gid}:${norm}`;
    if (!buckets.has(key)) {
      buckets.set(key, { groupId: gid, teamName: r.team_name, paths: new Set() });
    }
    buckets.get(key).paths.add(logoPath.replace(/^\/+/, ''));
  }

  const aliases = {};
  let renamed = 0;
  const dir = path.join(UPLOADS, 'official_team_logos');

  for (const bucket of buckets.values()) {
    const existingPaths = [...bucket.paths].filter((p) => {
      const rel = p.replace(/^uploads\//, '');
      return fs.existsSync(path.join(UPLOADS, rel.replace(/\//g, path.sep)));
    });
    if (!existingPaths.length) continue;

    let winnerPath = existingPaths[0];
    let winnerScore = 0;
    for (const p of existingPaths) {
      const rel = p.replace(/^uploads\/official_team_logos\//, '');
      const abs = path.join(dir, rel);
      if (!fs.existsSync(abs)) continue;
      const score = fileScore(rel, fs.statSync(abs));
      if (score >= winnerScore) {
        winnerScore = score;
        winnerPath = p.startsWith('uploads/') ? p : `uploads/${p}`;
      }
    }

    const winnerRel = winnerPath.replace(/^uploads\/official_team_logos\//, '');
    const winnerAbs = path.join(dir, winnerRel);
    if (!fs.existsSync(winnerAbs)) continue;

    const ext = path.extname(winnerRel).toLowerCase() || '.png';
    const canonicalName = buildOfficialTeamLogoFilename(bucket.groupId, bucket.teamName, ext, winnerScore || Math.floor(Date.now() / 1000));
    const canonicalPath = storagePath('official_team_logos', canonicalName);
    const canonicalAbs = path.join(dir, canonicalName);

    if (winnerRel !== canonicalName) {
      if (!DRY_RUN) {
        fs.copyFileSync(winnerAbs, canonicalAbs);
        if (winnerAbs !== canonicalAbs) {
          try { fs.unlinkSync(winnerAbs); } catch (_) {}
        }
      }
      renamed += 1;
    }

    for (const p of existingPaths) {
      const normalized = p.startsWith('uploads/') ? p : `uploads/${p}`;
      if (normalized !== canonicalPath) aliases[normalized] = canonicalPath;
    }
    for (const p of existingPaths) {
      const rel = p.replace(/^uploads\/official_team_logos\//, '');
      const abs = path.join(dir, rel);
      if (rel !== canonicalName && fs.existsSync(abs) && abs !== canonicalAbs) {
        aliases[storagePath('official_team_logos', rel)] = canonicalPath;
        if (!DRY_RUN) {
          try { fs.unlinkSync(abs); } catch (_) {}
        }
      }
    }

    if (!DRY_RUN && WITH_DB) {
      await query(
        `UPDATE teams t
         SET logo_path = ?
         FROM leagues l
         WHERE t.league_id = l.id
           AND l.official_group_id = ?
           AND LOWER(TRIM(t.name)) = LOWER(TRIM(?))`,
        [canonicalPath, bucket.groupId, bucket.teamName]
      );
    }
  }

  return { aliases, renamed };
}

async function dedupePlayerPhotosByCluster() {
  if (!WITH_DB) return { aliases: {}, removed: 0 };

  const { query } = require('../backend/config/database');
  let rows = [];
  try {
    rows = await query(
      `SELECT pc.id AS cluster_id, p.id AS player_id,
              COALESCE(NULLIF(TRIM(p.photo_path), ''), '') AS photo_path
       FROM player_clusters pc
       INNER JOIN player_cluster_members pcm ON pcm.cluster_id = pc.id
       INNER JOIN players p ON p.id = pcm.player_id
       WHERE pc.status = 'approved'
         AND COALESCE(NULLIF(TRIM(p.photo_path), ''), '') != ''`
    );
  } catch (e) {
    console.warn('Cluster giocatori non disponibile:', e.message);
    return { aliases: {}, removed: 0 };
  }

  const byCluster = new Map();
  for (const r of rows || []) {
    const cid = Number(r.cluster_id);
    if (!cid) continue;
    if (!byCluster.has(cid)) byCluster.set(cid, []);
    byCluster.get(cid).push(r);
  }

  const aliases = {};
  let removed = 0;
  const dir = path.join(UPLOADS, 'player_photos');

  for (const [clusterId, members] of byCluster.entries()) {
    const paths = [...new Set(members.map((m) => String(m.photo_path || '').trim()).filter(Boolean))];
    if (!paths.length) continue;

    let winnerPath = paths[0];
    let winnerScore = 0;
    for (const p of paths) {
      const rel = p.replace(/^uploads\/player_photos\//, '').replace(/^uploads\//, '').replace(/^player_photos\//, '');
      const abs = path.join(dir, rel);
      if (!fs.existsSync(abs)) continue;
      const score = fileScore(rel, fs.statSync(abs));
      if (score >= winnerScore) {
        winnerScore = score;
        winnerPath = p.startsWith('uploads/') ? p : `uploads/player_photos/${rel}`;
      }
    }

    const winnerRel = winnerPath.replace(/^uploads\/player_photos\//, '');
    const winnerAbs = path.join(dir, winnerRel);
    if (!fs.existsSync(winnerAbs)) continue;

    const ext = path.extname(winnerRel).toLowerCase() || '.jpg';
    const rand = winnerRel.match(/_([a-z0-9]{4,8})\.[a-z]+$/i)?.[1] || Math.random().toString(36).slice(2, 8);
    const canonicalName = buildPlayerClusterPhotoFilename(clusterId, ext, winnerScore || Math.floor(Date.now() / 1000), rand);
    const canonicalPath = storagePath('player_photos', canonicalName);
    const canonicalAbs = path.join(dir, canonicalName);

    if (winnerRel !== canonicalName) {
      if (!DRY_RUN) {
        fs.copyFileSync(winnerAbs, canonicalAbs);
        if (winnerAbs !== canonicalAbs) {
          try { fs.unlinkSync(winnerAbs); } catch (_) {}
        }
      }
    }

    for (const p of paths) {
      const normalized = p.startsWith('uploads/') ? p : `uploads/player_photos/${p}`;
      if (normalized !== canonicalPath) aliases[normalized] = canonicalPath;
    }

    const memberIds = members.map((m) => Number(m.player_id)).filter((id) => id > 0);
    for (const name of fs.readdirSync(dir)) {
      const isMemberLegacy = memberIds.some((pid) => name.startsWith(`player_${pid}_`) || name.startsWith(`player_solo_${pid}_`));
      const isOldCluster = name.startsWith(`player_cluster_${clusterId}_`) && name !== canonicalName;
      if (isMemberLegacy || isOldCluster) {
        aliases[storagePath('player_photos', name)] = canonicalPath;
        if (!DRY_RUN) {
          try {
            fs.unlinkSync(path.join(dir, name));
            removed += 1;
          } catch (_) {}
        } else {
          removed += 1;
        }
      }
    }

    if (!DRY_RUN) {
      const ph = memberIds.map(() => '?').join(', ');
      await query(`UPDATE players SET photo_path = ? WHERE id IN (${ph})`, [canonicalPath, ...memberIds]);
    }
  }

  return { aliases, removed };
}

function loadExistingAliases() {
  if (!fs.existsSync(ALIASES_FILE)) return {};
  try {
    const raw = fs.readFileSync(ALIASES_FILE, 'utf8');
    const m = raw.match(/UPLOAD_PATH_ALIASES\s*=\s*\{([^}]*)\}/s);
    if (!m) return {};
    const out = {};
    const re = /'((?:\\'|[^'])*)'\s*:\s*'((?:\\'|[^'])*)'/g;
    let match;
    while ((match = re.exec(m[1])) !== null) {
      out[match[1].replace(/\\'/g, "'")] = match[2].replace(/\\'/g, "'");
    }
    return out;
  } catch {
    return {};
  }
}

function mergeAliases(...maps) {
  const merged = {};
  for (const m of maps) {
    for (const [from, to] of Object.entries(m || {})) {
      let target = to;
      const seen = new Set();
      while (merged[target] && !seen.has(target)) {
        seen.add(target);
        target = merged[target];
      }
      merged[from] = target;
    }
  }
  return merged;
}

function writeAliasesFile(aliases) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const lines = Object.entries(aliases)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([from, to]) => `  '${from.replace(/'/g, "\\'")}': '${to.replace(/'/g, "\\'")}',`);
  const content = `/* eslint-disable */
// AUTO-GENERATED by scripts/dedupeUploadsMedia.js
export const UPLOAD_PATH_ALIASES = {
${lines.join('\n')}
};
`;
  fs.writeFileSync(ALIASES_FILE, content, 'utf8');
}

async function main() {
  console.log(DRY_RUN ? '[dry-run]' : '[write]', WITH_DB ? '+db' : 'hash-only');

  const teamHash = dedupeFolderByHash('official_team_logos');
  console.log(`official_team_logos: ${teamHash.kept} unici, ${teamHash.removed} duplicati rimossi (hash)`);

  let teamGroup = { aliases: {}, renamed: 0 };
  let playerCluster = { aliases: {}, removed: 0 };
  if (WITH_DB) {
    teamGroup = await dedupeTeamLogosByGroupName();
    console.log(`official_team_logos: ${teamGroup.renamed} rinominati per gruppo+nome`);
    playerCluster = await dedupePlayerPhotosByCluster();
    console.log(`player_photos: ${playerCluster.removed} file cluster legacy rimossi`);
  }

  const aliases = mergeAliases(loadExistingAliases(), teamHash.aliases, teamGroup.aliases, playerCluster.aliases);
  if (!DRY_RUN) writeAliasesFile(aliases);
  console.log(`Alias path: ${Object.keys(aliases).length} → ${path.relative(ROOT, ALIASES_FILE)}`);

  if (!DRY_RUN) {
    const { execSync } = require('child_process');
    execSync('node scripts/generateBundledUploadsManifest.js', { cwd: ROOT, stdio: 'inherit' });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Un solo comando: pull cartelle bundle da Supabase → manifest → EAS Update (solo se ci sono novità).
 *
 * Cartelle: app_loading, login_background, login_logo, match_background,
 *           official_group_logos, official_team_logos, player_photos
 *
 *   npm run update:uploads:production
 *   npm run update:uploads:production -- "messaggio custom"
 *   npm run update:uploads:production -- --dry-run
 *   npm run update:uploads:production -- --force
 *   npm run update:uploads:production -- --always-update
 *   npm run update:uploads:preview
 */
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { BUNDLE_UPLOAD_FOLDERS, pullUploadsFromSupabase } = require('./pullUploadsFromSupabase');

function parseArgs(argv) {
  const flags = new Set();
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run' || a === '--force' || a === '--always-update' || a === '--preview') {
      flags.add(a);
      continue;
    }
    if (a === '--channel') {
      const v = argv[i + 1];
      if (v) {
        flags.add(`channel:${v}`);
        i += 1;
      }
      continue;
    }
    if (a.startsWith('-')) continue;
    positionals.push(a);
  }
  return { flags, positionals };
}

function channelFromFlags(flags, scriptHint) {
  for (const f of flags) {
    if (f.startsWith('channel:')) return f.slice('channel:'.length);
  }
  if (flags.has('--preview') || scriptHint === 'preview') return 'preview';
  return 'production';
}

function main() {
  const scriptHint = process.env.npm_lifecycle_event?.includes('preview') ? 'preview' : 'production';
  const { flags, positionals } = parseArgs(process.argv.slice(2));
  const dryRun = flags.has('--dry-run');
  const force = flags.has('--force');
  const alwaysUpdate = flags.has('--always-update');
  const channel = channelFromFlags(flags, scriptHint);
  const message =
    positionals.join(' ').trim() ||
    `uploads sync ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

  console.log(`=== update:uploads (${channel}) ===`);
  console.log(`Cartelle: ${BUNDLE_UPLOAD_FOLDERS.join(', ')}`);

  return pullUploadsFromSupabase({
    dryRun,
    force,
    folders: BUNDLE_UPLOAD_FOLDERS,
    concurrency: 6,
  }).then((result) => {
    if (result.failed > 0) {
      throw new Error(`Pull fallito su ${result.failed} file — update interrotto`);
    }

    const needsUpdate = result.hasChanges || alwaysUpdate || force;

    if (dryRun) {
      console.log(
        needsUpdate
          ? `[dry-run] Ci sarebbero ${result.planned} file da aggiornare → poi manifest + eas update`
          : '[dry-run] Nessun aggiornamento file — eas update saltato'
      );
      return;
    }

    if (!needsUpdate) {
      console.log('Nessun file cambiato su Supabase rispetto a uploads/ locale → eas update saltato.');
      console.log('Usa --always-update per pubblicare comunque, o --force per riscaricare tutto.');
      return;
    }

    console.log('Rigenero manifest…');
    execSync('node scripts/generateBundledUploadsManifest.js', { cwd: ROOT, stdio: 'inherit' });

    console.log(`Pubblico EAS Update → channel ${channel}`);
    execSync(`npx eas update --channel ${channel} --message ${JSON.stringify(message)} --non-interactive`, {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });

    console.log('Fatto.');
  });
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

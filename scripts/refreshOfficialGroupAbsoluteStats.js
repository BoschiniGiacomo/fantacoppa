/**
 * Pre-calcola e salva le classifiche all-time per cluster (gruppo ufficiale).
 *
 * Uso:
 *   node scripts/refreshOfficialGroupAbsoluteStats.js
 *   node scripts/refreshOfficialGroupAbsoluteStats.js --group=1
 *
 * Consigliato: cron Render / Supabase ogni 1-6 ore + dopo import massivo voti/partite.
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { query } = require('../backend/config/database');
const {
  ensureOfficialGroupAbsoluteStatsTable,
  recomputeAndStoreOfficialGroupAbsoluteStats,
} = require('../backend/utils/officialGroupAbsoluteStatsStore');

function parseGroupArg(argv) {
  const flag = argv.find((arg) => arg.startsWith('--group='));
  if (!flag) return null;
  const n = Number(flag.split('=')[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function listOfficialGroupIds() {
  const rows = await query(
    `SELECT id FROM official_league_groups ORDER BY id ASC`,
    [],
  );
  return (rows || []).map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
}

async function main() {
  const onlyGroupId = parseGroupArg(process.argv.slice(2));
  await ensureOfficialGroupAbsoluteStatsTable();

  const groupIds = onlyGroupId ? [onlyGroupId] : await listOfficialGroupIds();
  if (!groupIds.length) {
    console.log('[refreshOfficialGroupAbsoluteStats] Nessun gruppo ufficiale trovato.');
    return;
  }

  console.log(`[refreshOfficialGroupAbsoluteStats] Avvio refresh per ${groupIds.length} gruppo/i...`);
  for (const groupId of groupIds) {
    const t0 = Date.now();
    try {
      const result = await recomputeAndStoreOfficialGroupAbsoluteStats(groupId);
      console.log(
        `[refreshOfficialGroupAbsoluteStats] groupId=${groupId} rows=${result.upserted} TOTAL=${Date.now() - t0}ms`
      );
    } catch (error) {
      console.error(
        `[refreshOfficialGroupAbsoluteStats] groupId=${groupId} ERRORE:`,
        error?.message || error
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[refreshOfficialGroupAbsoluteStats] Fatal:', error?.message || error);
    process.exit(1);
  });

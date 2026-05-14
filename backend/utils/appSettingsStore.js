const { query } = require('../config/database');

let tableReady = false;

async function ensureAppSettingsTable() {
  if (tableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      loading_media_path TEXT,
      loading_media_type TEXT,
      login_logo_path TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  await query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS login_logo_path TEXT`).catch(() => {});
  tableReady = true;
}

module.exports = { ensureAppSettingsTable };

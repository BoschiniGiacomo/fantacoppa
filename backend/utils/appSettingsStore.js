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
      login_background_path TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  await query(
    `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS login_background_path TEXT`
  );
  await query(
    `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS match_background_path TEXT`
  );
  await query(
    `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS sistema_json TEXT`
  );
  tableReady = true;
}

const DEFAULT_SISTEMA = {
  slides: [
    { id: 'minigames', visible: true },
    { id: 'player_compare', visible: true },
  ],
  minigames: [
    { id: 'higher_lower', visible: true },
  ],
};

const KNOWN_SLIDES = new Set(DEFAULT_SISTEMA.slides.map((s) => s.id));
const KNOWN_MINIGAMES = new Set(DEFAULT_SISTEMA.minigames.map((m) => m.id));

function normalizeSistemaSettings(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object') parsed = {};

  const incomingSlides = Array.isArray(parsed.slides) ? parsed.slides : [];
  const incomingMinigames = Array.isArray(parsed.minigames) ? parsed.minigames : [];

  const slideById = new Map();
  incomingSlides.forEach((s, idx) => {
    const id = String(s?.id || '').trim();
    if (!KNOWN_SLIDES.has(id) || slideById.has(id)) return;
    slideById.set(id, { id, visible: !!s.visible, _order: idx });
  });
  DEFAULT_SISTEMA.slides.forEach((def, idx) => {
    if (!slideById.has(def.id)) {
      slideById.set(def.id, { id: def.id, visible: def.visible, _order: 1000 + idx });
    }
  });
  const slides = [...slideById.values()]
    .sort((a, b) => a._order - b._order)
    .map(({ id, visible }) => ({ id, visible: !!visible }));

  const miniById = new Map();
  incomingMinigames.forEach((m, idx) => {
    const id = String(m?.id || '').trim();
    if (!KNOWN_MINIGAMES.has(id) || miniById.has(id)) return;
    miniById.set(id, { id, visible: !!m.visible, _order: idx });
  });
  DEFAULT_SISTEMA.minigames.forEach((def, idx) => {
    if (!miniById.has(def.id)) {
      miniById.set(def.id, { id: def.id, visible: def.visible, _order: 1000 + idx });
    }
  });
  const minigames = [...miniById.values()]
    .sort((a, b) => a._order - b._order)
    .map(({ id, visible }) => ({ id, visible: !!visible }));

  const anyMinigameVisible = minigames.some((m) => m.visible);
  const slidesOut = slides.map((s) =>
    s.id === 'minigames' && !anyMinigameVisible ? { ...s, visible: false } : s
  );

  return { slides: slidesOut, minigames };
}

module.exports = {
  ensureAppSettingsTable,
  DEFAULT_SISTEMA,
  normalizeSistemaSettings,
};

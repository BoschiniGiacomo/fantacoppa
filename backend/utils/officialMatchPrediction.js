const { query } = require('../config/database');

const PREDICTION_CHOICES = new Set(['home', 'draw', 'away']);

let schemaReady = false;

async function ensureOfficialMatchPredictionSchema() {
  if (schemaReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS official_match_predictions (
      match_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      choice TEXT NOT NULL CHECK (choice IN ('home', 'draw', 'away')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (match_id, user_id)
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_official_match_predictions_match_choice
      ON official_match_predictions (match_id, choice)
  `);
  schemaReady = true;
}

function emptyPrediction(myChoice = null) {
  return {
    my_choice: myChoice,
    total: 0,
    counts: { home: 0, draw: 0, away: 0 },
    percents: { home: 0, draw: 0, away: 0 },
  };
}

function normalizeChoice(raw) {
  const c = String(raw || '').trim().toLowerCase();
  return PREDICTION_CHOICES.has(c) ? c : null;
}

/** Percentuali intere che sommano a 100 (largest remainder). */
function buildPercents(counts, total) {
  const keys = ['home', 'draw', 'away'];
  if (!(total > 0)) return { home: 0, draw: 0, away: 0 };
  const raw = keys.map((k) => {
    const exact = (Number(counts[k] || 0) * 100) / total;
    const floor = Math.floor(exact);
    return { key: k, floor, frac: exact - floor };
  });
  let used = raw.reduce((s, r) => s + r.floor, 0);
  let remain = 100 - used;
  raw.sort((a, b) => b.frac - a.frac || a.key.localeCompare(b.key));
  const out = { home: 0, draw: 0, away: 0 };
  for (const r of raw) out[r.key] = r.floor;
  for (let i = 0; i < raw.length && remain > 0; i += 1) {
    out[raw[i].key] += 1;
    remain -= 1;
  }
  return out;
}

function shapePrediction(countsRow, myChoice) {
  const counts = {
    home: Number(countsRow?.home || 0) || 0,
    draw: Number(countsRow?.draw || 0) || 0,
    away: Number(countsRow?.away || 0) || 0,
  };
  const total = counts.home + counts.draw + counts.away;
  return {
    my_choice: normalizeChoice(myChoice),
    total,
    counts,
    percents: buildPercents(counts, total),
  };
}

async function loadOfficialMatchPrediction(matchId, userId) {
  await ensureOfficialMatchPredictionSchema();
  const mid = Number(matchId);
  const uid = Number(userId);
  if (!(mid > 0)) return emptyPrediction(null);

  const [countRows, myRows] = await Promise.all([
    query(
      `
      SELECT
        COUNT(*) FILTER (WHERE choice = 'home')::int AS home,
        COUNT(*) FILTER (WHERE choice = 'draw')::int AS draw,
        COUNT(*) FILTER (WHERE choice = 'away')::int AS away
      FROM official_match_predictions
      WHERE match_id = ?
      `,
      [mid]
    ),
    uid > 0
      ? query(
          `SELECT choice FROM official_match_predictions WHERE match_id = ? AND user_id = ? LIMIT 1`,
          [mid, uid]
        )
      : Promise.resolve([]),
  ]);

  return shapePrediction(countRows?.[0], myRows?.[0]?.choice ?? null);
}

async function setOfficialMatchPrediction(matchId, userId, choiceRaw) {
  await ensureOfficialMatchPredictionSchema();
  const mid = Number(matchId);
  const uid = Number(userId);
  const choice = normalizeChoice(choiceRaw);
  if (!(mid > 0) || !(uid > 0) || !choice) {
    const err = new Error('Dati pronostico non validi');
    err.status = 400;
    throw err;
  }

  const exists = await query(`SELECT id FROM official_matches WHERE id = ? LIMIT 1`, [mid]);
  if (!exists?.[0]) {
    const err = new Error('Partita non trovata');
    err.status = 404;
    throw err;
  }

  await query(
    `
    INSERT INTO official_match_predictions (match_id, user_id, choice, updated_at)
    VALUES (?, ?, ?, NOW())
    ON CONFLICT (match_id, user_id) DO UPDATE
      SET choice = EXCLUDED.choice,
          updated_at = NOW()
    `,
    [mid, uid, choice]
  );

  return loadOfficialMatchPrediction(mid, uid);
}

async function clearOfficialMatchPrediction(matchId, userId) {
  await ensureOfficialMatchPredictionSchema();
  const mid = Number(matchId);
  const uid = Number(userId);
  if (!(mid > 0) || !(uid > 0)) {
    const err = new Error('Dati pronostico non validi');
    err.status = 400;
    throw err;
  }

  await query(
    `DELETE FROM official_match_predictions WHERE match_id = ? AND user_id = ?`,
    [mid, uid]
  );

  return loadOfficialMatchPrediction(mid, uid);
}

module.exports = {
  ensureOfficialMatchPredictionSchema,
  loadOfficialMatchPrediction,
  setOfficialMatchPrediction,
  clearOfficialMatchPrediction,
  emptyPrediction,
  normalizeChoice,
};

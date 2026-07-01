const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const {
  triggerCalculatedNotificationForLeagueMatchday,
  suppressCalculatedNotificationsForLeagueMatchday,
} = require('./notifications');
const { buildAutoLineupFromVotes } = require('../utils/autoLineup');
const { computeBonusTotal: computeBonusTotalUtil } = require('../utils/bonus');
const { injuryReplacementExclusionSql } = require('../utils/budgetReconcile');
const {
  resolveUserLineup,
  persistUserLineup,
  titolariIdsToSlots,
  buildStarterRolesFromModulo,
  applyInjuryToSlots,
  canMutateLineupForInjury,
} = require('../utils/lineupResolver');
const {
  applyInjuryReplacementAcrossLeagues,
  revertInjuryReplacementAcrossLeagues,
} = require('../utils/injuryPropagation');
const { scoreResolvedLineup } = require('../utils/lineupScoring');
const { normalizeVoteRating } = require('../utils/voteRating');
const {
  buildOfficialTeamLogoFilename,
  buildPlayerClusterPhotoFilename,
  buildPlayerSoloPhotoFilename,
  normalizeTeamNameForStorage,
} = require('../utils/mediaCanonical');
const {
  removeOfficialTeamLogoVariants,
  removePlayerPhotoVariants,
} = require('../utils/mediaStorageCleanup');
const {
  ensureMatchdaysGhostSchema,
  userCanSeeGhostMatchdays,
  isOfficialLeague,
  isGhostMatchday,
  filterGhostMatchdaysForUser,
  CURRENT_MATCHDAY_SUBQUERY,
} = require('../utils/matchdayGhost');

const MR_EXCLUDE_GHOST_JOIN = `INNER JOIN matchdays md_ghost ON md_ghost.league_id = ? AND md_ghost.giornata = mr.giornata AND COALESCE(md_ghost.is_ghost, 0) = 0`;

const uploadsRoot = path.resolve(__dirname, '..', 'uploads');
const userTeamLogosDir = path.join(uploadsRoot, 'team_logos');
const officialTeamLogosDir = path.join(uploadsRoot, 'official_team_logos');
fs.mkdirSync(userTeamLogosDir, { recursive: true });
fs.mkdirSync(officialTeamLogosDir, { recursive: true });

function imageFilename(prefix, originalname) {
  const ext = path.extname(String(originalname || '')).toLowerCase();
  const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`;
}

const teamLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const officialLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
});

let supabaseStorageClient = null;
function getSupabaseStorageClient() {
  if (supabaseStorageClient) return supabaseStorageClient;
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
  // Upload lato backend: richiede service role, non anon key (RLS Storage).
  const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) return null;
  supabaseStorageClient = createClient(supabaseUrl, supabaseKey);
  return supabaseStorageClient;
}

/** Separatore CSV per Excel in italiano (lista separata = punto e virgola). */
const CSV_SEP = ';';

function csvEscape(value) {
  const s = String(value ?? '');
  if (/["\n\r]/.test(s) || s.includes(CSV_SEP) || s.includes(',')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsvLine(fields) {
  return fields.map((f) => csvEscape(f)).join(CSV_SEP);
}

function sendCsvResponse(res, filename, lines) {
  const body = `\uFEFF${lines.join('\n')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(body);
}

function detectCsvDelimiter(line) {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === ',') commas += 1;
    if (!inQuotes && ch === ';') semicolons += 1;
  }
  return semicolons >= commas ? ';' : ',';
}

function parseCsvLine(line, delimiter = CSV_SEP) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseCsvContent(content) {
  const lines = String(content || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const delimiter = detectCsvDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map((h) => String(h || '').trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i], delimiter);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] != null ? normalizePotentialMojibake(String(values[idx]).trim()) : '';
    });
    rows.push(row);
  }
  return rows;
}

function textDecodeBadness(s) {
  const str = String(s || '');
  const replacementCount = (str.match(/\uFFFD/g) || []).length;
  const mojibakeCount = (str.match(/[ÃÂ]/g) || []).length;
  return (replacementCount * 10) + mojibakeCount;
}

function normalizePotentialMojibake(value) {
  const raw = String(value || '');
  if (!raw) return '';
  // Typical mojibake repair: UTF-8 bytes interpreted as latin1/cp1252 (es: "MarcillÃ²")
  if (/[ÃÂ]/.test(raw)) {
    try {
      const repaired = Buffer.from(raw, 'latin1').toString('utf8');
      if (textDecodeBadness(repaired) < textDecodeBadness(raw)) return repaired;
    } catch (_) {
      // keep raw
    }
  }
  return raw;
}

function decodeCsvBuffer(buffer) {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''), 'utf8');
  const utf8Text = raw.toString('utf8');
  const latin1Text = raw.toString('latin1');
  // Pick the least broken decode (handles UTF-8, ANSI, and mixed cases better)
  return textDecodeBadness(latin1Text) < textDecodeBadness(utf8Text) ? latin1Text : utf8Text;
}

const CSV_PLAYERS_HEADER = ['Nome', 'Cognome', 'Squadra', 'Ruolo', 'Valutazione', 'Numero', 'Anno'];

function parseBirthYearInput(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { value: null };
  if (!/^\d{4}$/.test(s)) return { error: 'invalid' };
  const y = Number(s);
  const maxY = new Date().getFullYear();
  if (!Number.isFinite(y) || y < 1900 || y > maxY) return { error: 'range' };
  return { value: y };
}
const CSV_TEAMS_HEADER = 'Squadra';

function normalizeCsvDecimalString(value) {
  return String(value ?? '').trim().replace(',', '.');
}

function isStrictNumericCsvValue(value, { allowEmpty = false, integerOnly = false } = {}) {
  const s = String(value ?? '').trim();
  if (!s) return allowEmpty;
  if (integerOnly) return /^\d+$/.test(s);
  const normalized = normalizeCsvDecimalString(s);
  return /^\d+(\.\d+)?$/.test(normalized);
}

function parseCsvDecimal(value) {
  const normalized = normalizeCsvDecimalString(value);
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return parseFloat(normalized);
}

function isPlayersCsvShape(rows) {
  if (!rows.length) return false;
  const row = rows[0];
  const hasNome = Object.prototype.hasOwnProperty.call(row, 'nome')
    || Object.prototype.hasOwnProperty.call(row, 'first_name');
  const hasCognome = Object.prototype.hasOwnProperty.call(row, 'cognome')
    || Object.prototype.hasOwnProperty.call(row, 'last_name');
  return hasNome && hasCognome;
}

function mapPlayerCsvRow(row) {
  return {
    firstName: String(row.nome || row.first_name || '').trim(),
    lastName: String(row.cognome || row.last_name || '').trim(),
    teamName: String(row.squadra || row.team_name || '').trim(),
    role: String(row.ruolo || row.role || '').trim().toUpperCase(),
    ratingRaw: String(row.valutazione ?? row.rating ?? '').trim(),
    shirtRaw: String(row.numero ?? row.shirt_number ?? row.numero_maglia ?? '').trim(),
    yearRaw: String(row.anno ?? row.birth_year ?? row.anno_nascita ?? row.year ?? '').trim(),
  };
}

function getTeamNameFromCsvRow(row) {
  return String(row.squadra || row.name || row.team_name || '').trim();
}

async function insertCsvPlayer(teamId, firstName, lastName, role, rating, shirtNumber, birthYear = null) {
  const runInsert = async (sql, params) => query(sql, params);
  const attempts = [
    [
      `INSERT INTO players (team_id, first_name, last_name, role, rating, shirt_number, birth_year) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [teamId, firstName, lastName, role, rating, shirtNumber, birthYear],
    ],
    [
      `INSERT INTO players (team_id, first_name, last_name, role, rating, numero_maglia, birth_year) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [teamId, firstName, lastName, role, rating, shirtNumber, birthYear],
    ],
    [
      `INSERT INTO players (team_id, first_name, last_name, role, rating, birth_year) VALUES (?, ?, ?, ?, ?, ?)`,
      [teamId, firstName, lastName, role, rating, birthYear],
    ],
    [
      `INSERT INTO players (team_id, first_name, last_name, role, rating, shirt_number) VALUES (?, ?, ?, ?, ?, ?)`,
      [teamId, firstName, lastName, role, rating, shirtNumber],
    ],
    [
      `INSERT INTO players (team_id, first_name, last_name, role, rating, numero_maglia) VALUES (?, ?, ?, ?, ?, ?)`,
      [teamId, firstName, lastName, role, rating, shirtNumber],
    ],
    [
      `INSERT INTO players (team_id, first_name, last_name, role, rating) VALUES (?, ?, ?, ?, ?)`,
      [teamId, firstName, lastName, role, rating],
    ],
  ];

  let lastErr = null;
  for (const [sql, params] of attempts) {
    try {
      await runInsert(sql, params);
      return;
    } catch (err) {
      lastErr = err;
      if (err && err.code === '23505') {
        await syncPlayersIdSequence();
        try {
          await runInsert(sql, params);
          return;
        } catch (retryErr) {
          lastErr = retryErr;
        }
      }
    }
  }
  throw lastErr;
}

async function syncLeaguesIdSequence() {
  await query(
    "SELECT setval(pg_get_serial_sequence('leagues','id'), COALESCE((SELECT MAX(id) FROM leagues), 0) + 1, false)"
  );
}

function normalizeLeagueAccessCodeInput(raw) {
  const s = raw != null ? String(raw).trim() : '';
  return s || null;
}

let leaguesAccessCodeUniqueDropped = false;
async function ensureLeaguesAccessCodeNotGloballyUnique() {
  if (leaguesAccessCodeUniqueDropped) return;
  try {
    await query('ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_access_code_key');
    leaguesAccessCodeUniqueDropped = true;
  } catch (err) {
    console.log('drop leagues_access_code_key skipped:', err?.message || err);
  }
}

function isLeaguesPrimaryKeyDuplicateError(err) {
  if (!err || err.code !== '23505') return false;
  if (err.constraint === 'leagues_pkey') return true;
  return /Key \(id\)=/i.test(String(err.detail || ''));
}

async function syncLeagueMembersIdSequence() {
  await query(
    "SELECT setval(pg_get_serial_sequence('league_members','id'), COALESCE((SELECT MAX(id) FROM league_members), 0) + 1, false)"
  );
}

async function syncTeamsIdSequence() {
  await query(
    "SELECT setval(pg_get_serial_sequence('teams','id'), COALESCE((SELECT MAX(id) FROM teams), 0) + 1, false)"
  );
}

async function syncPlayersIdSequence() {
  await query(
    "SELECT setval(pg_get_serial_sequence('players','id'), COALESCE((SELECT MAX(id) FROM players), 0) + 1, false)"
  );
}

function toValidLeagueId(raw) {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function toBoolInt(v) {
  return Number(v ? 1 : 0);
}

const BONUS_DEFAULTS = {
  enable_bonus_malus: 1,
  enable_goal: 1, bonus_goal: 3.0,
  enable_assist: 1, bonus_assist: 1.0,
  enable_yellow_card: 1, malus_yellow_card: -0.5,
  enable_red_card: 1, malus_red_card: -1.0,
  enable_goals_conceded: 1, malus_goals_conceded: -1.0,
  enable_own_goal: 1, malus_own_goal: -2.0,
  enable_penalty_missed: 1, malus_penalty_missed: -3.0,
  enable_penalty_saved: 1, bonus_penalty_saved: 3.0,
  enable_clean_sheet: 1, bonus_clean_sheet: 1.0,
  enable_pallone_fuori: 0, malus_pallone_fuori: -0.5,
  enable_briso: 0, bonus_briso: 1.5,
  enable_no_divisa: 0, malus_no_divisa: -1.0,
};

function normalizeBonusSettings(input = {}) {
  const merged = { ...BONUS_DEFAULTS, ...(input || {}) };
  return {
    enable_bonus_malus: toBoolInt(merged.enable_bonus_malus),
    enable_goal: toBoolInt(merged.enable_goal),
    bonus_goal: Number(merged.bonus_goal ?? BONUS_DEFAULTS.bonus_goal),
    enable_assist: toBoolInt(merged.enable_assist),
    bonus_assist: Number(merged.bonus_assist ?? BONUS_DEFAULTS.bonus_assist),
    enable_yellow_card: toBoolInt(merged.enable_yellow_card),
    malus_yellow_card: Number(merged.malus_yellow_card ?? BONUS_DEFAULTS.malus_yellow_card),
    enable_red_card: toBoolInt(merged.enable_red_card),
    malus_red_card: Number(merged.malus_red_card ?? BONUS_DEFAULTS.malus_red_card),
    enable_goals_conceded: toBoolInt(merged.enable_goals_conceded),
    malus_goals_conceded: Number(merged.malus_goals_conceded ?? BONUS_DEFAULTS.malus_goals_conceded),
    enable_own_goal: toBoolInt(merged.enable_own_goal),
    malus_own_goal: Number(merged.malus_own_goal ?? BONUS_DEFAULTS.malus_own_goal),
    enable_penalty_missed: toBoolInt(merged.enable_penalty_missed),
    malus_penalty_missed: Number(merged.malus_penalty_missed ?? BONUS_DEFAULTS.malus_penalty_missed),
    enable_penalty_saved: toBoolInt(merged.enable_penalty_saved),
    bonus_penalty_saved: Number(merged.bonus_penalty_saved ?? BONUS_DEFAULTS.bonus_penalty_saved),
    enable_clean_sheet: toBoolInt(merged.enable_clean_sheet),
    bonus_clean_sheet: Number(merged.bonus_clean_sheet ?? BONUS_DEFAULTS.bonus_clean_sheet),
    enable_pallone_fuori: toBoolInt(merged.enable_pallone_fuori),
    malus_pallone_fuori: Number(merged.malus_pallone_fuori ?? BONUS_DEFAULTS.malus_pallone_fuori),
    enable_briso: toBoolInt(merged.enable_briso),
    bonus_briso: Number(merged.bonus_briso ?? BONUS_DEFAULTS.bonus_briso),
    enable_no_divisa: toBoolInt(merged.enable_no_divisa),
    malus_no_divisa: Number(merged.malus_no_divisa ?? BONUS_DEFAULTS.malus_no_divisa),
  };
}

function parseIdsArray(raw) {
  if (Array.isArray(raw)) {
    return raw.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
      }
    } catch (_) {
      return raw.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0);
    }
  }
  return [];
}

/**
 * Rimuove risultati giornata, dettaglio voti, formazioni e rosa per utente+lega
 * così l'utente non resta in classifica dopo kick o abbandono.
 */
async function deleteUserFantasyLeagueParticipationData(leagueId, userId) {
  const lid = toValidLeagueId(leagueId);
  const uid = Number(userId);
  if (!lid || !Number.isFinite(uid) || uid <= 0) return;
  const statements = [
    ['DELETE FROM matchday_player_scores WHERE league_id = ? AND user_id = ?', [lid, uid]],
    ['DELETE FROM matchday_results WHERE league_id = ? AND user_id = ?', [lid, uid]],
    ['DELETE FROM user_lineups WHERE league_id = ? AND user_id = ?', [lid, uid]],
    ['DELETE FROM user_players WHERE league_id = ? AND user_id = ?', [lid, uid]],
    ['DELETE FROM user_market_blocks WHERE league_id = ? AND user_id = ?', [lid, uid]],
    ['DELETE FROM league_join_requests WHERE league_id = ? AND user_id = ?', [lid, uid]],
  ];
  for (const [sql, params] of statements) {
    try {
      await query(sql, params);
    } catch (_) {
      /* tabelle opzionali o non presenti */
    }
  }
}

const computeBonusTotal = computeBonusTotalUtil;

let matchdayResultsCalculatedAtReady = false;

async function ensureMatchdayResultsCalculatedAtColumn() {
  if (matchdayResultsCalculatedAtReady) return;
  try {
    await query(
      `ALTER TABLE matchday_results
       ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ`
    );
  } catch (_) {
    /* colonna opzionale */
  }
  matchdayResultsCalculatedAtReady = true;
}

function matchdayCalculatedAtExpr(tableAlias = 'mr') {
  const a = tableAlias;
  return `COALESCE(
    ${a}.calculated_at,
    NULLIF(to_jsonb(${a})->>'calculated_at', '')::timestamptz,
    NULLIF(to_jsonb(${a})->>'created_at', '')::timestamptz
  )`;
}

function applyInjuryToLineup(ids, injuryMap) {
  return applyInjuryMap(ids, injuryMap);
}

async function getInjuryReplacementMap(leagueId) {
  try {
    const sourceLeagueId = await getEffectiveLeagueId(leagueId);
    const rows = await query(
      `SELECT p.id AS injured_id, p.injury_replacement_player_id
       FROM players p
       JOIN teams t ON t.id = p.team_id
       WHERE t.league_id = ?
         AND COALESCE(p.is_injured, 0) = 1
         AND p.injury_replacement_player_id IS NOT NULL`,
      [sourceLeagueId]
    );
    const map = {};
    rows.forEach((r) => {
      const injuredId = Number(r.injured_id);
      const replacementId = Number(r.injury_replacement_player_id);
      if (Number.isFinite(injuredId) && injuredId > 0 && Number.isFinite(replacementId) && replacementId > 0 && replacementId !== injuredId) {
        map[injuredId] = replacementId;
      }
    });
    return map;
  } catch (_) {
    return {};
  }
}

function applyInjuryMap(ids, injuryMap) {
  const out = [];
  const used = new Set();
  (ids || []).forEach((rawId) => {
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) return;
    const mapped = Number(injuryMap[id] || id);
    if (!Number.isFinite(mapped) || mapped <= 0 || used.has(mapped)) return;
    used.add(mapped);
    out.push(mapped);
  });
  return out;
}

async function getLeagueBonusSettings(leagueId) {
  try {
    const rows = await query(
      `SELECT enable_bonus_malus, enable_goal, bonus_goal, enable_assist, bonus_assist,
              enable_yellow_card, malus_yellow_card, enable_red_card, malus_red_card,
              enable_goals_conceded, malus_goals_conceded, enable_own_goal, malus_own_goal,
              enable_penalty_missed, malus_penalty_missed, enable_penalty_saved, bonus_penalty_saved,
              enable_clean_sheet, bonus_clean_sheet,
              enable_pallone_fuori, malus_pallone_fuori, enable_briso, bonus_briso,
              enable_no_divisa, malus_no_divisa
       FROM league_bonus_settings
       WHERE league_id = ?
       LIMIT 1`,
      [leagueId]
    );
    if (!rows[0]) return { ...BONUS_DEFAULTS };
    return normalizeBonusSettings(rows[0]);
  } catch (_) {
    return { ...BONUS_DEFAULTS };
  }
}

async function upsertUserBudgetForLeague(userId, leagueId, budget, teamName, coachName, teamLogo = 'default_1') {
  await query(
    `INSERT INTO user_budget (user_id, league_id, budget, team_name, coach_name, team_logo)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, league_id)
     DO UPDATE SET
       budget = EXCLUDED.budget,
       team_name = COALESCE(user_budget.team_name, EXCLUDED.team_name),
       coach_name = COALESCE(user_budget.coach_name, EXCLUDED.coach_name),
       team_logo = COALESCE(user_budget.team_logo, EXCLUDED.team_logo)`,
    [userId, leagueId, Number(budget || 100), String(teamName), String(coachName), String(teamLogo)]
  );
}

async function isLeagueAdmin(userId, leagueId) {
  const rows = await query(
    `SELECT role FROM league_members WHERE user_id = ? AND league_id = ? LIMIT 1`,
    [userId, leagueId]
  );
  return !!rows[0] && String(rows[0].role) === 'admin';
}

async function getRequireJoinApproval(leagueId) {
  try {
    const rows = await query(
      `SELECT COALESCE(require_approval, 0)::int AS require_approval
       FROM league_market_settings
       WHERE league_id = ?
       LIMIT 1`,
      [leagueId]
    );
    return Number(rows[0]?.require_approval || 0) === 1;
  } catch (_) {
    return false;
  }
}

async function addUserToLeagueWithInitialBudget(userId, leagueId, leagueInitialBudget) {
  try {
    await query(
      `INSERT INTO league_members (league_id, user_id, role)
       VALUES (?, ?, 'user')
       ON CONFLICT (league_id, user_id) DO NOTHING`,
      [leagueId, userId]
    );
  } catch (memberErr) {
    if (memberErr && memberErr.code === '23505') {
      await syncLeagueMembersIdSequence();
      await query(
        `INSERT INTO league_members (league_id, user_id, role)
         VALUES (?, ?, 'user')
         ON CONFLICT (league_id, user_id) DO NOTHING`,
        [leagueId, userId]
      );
    } else {
      throw memberErr;
    }
  }

  const countRows = await query(
    `SELECT COUNT(*)::int AS c FROM league_members WHERE league_id = ?`,
    [leagueId]
  );
  const ordinal = Number(countRows[0]?.c || 1);
  await upsertUserBudgetForLeague(
    userId,
    leagueId,
    Number(leagueInitialBudget || 100),
    `Squadra ${ordinal}`,
    `Allenatore ${ordinal}`,
    'default_1'
  );
}

async function getEffectiveLeagueId(leagueId) {
  try {
    const rows = await query(
      `SELECT linked_to_league_id
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [leagueId]
    );
    const linked = Number(rows[0]?.linked_to_league_id || 0);
    return linked > 0 ? linked : leagueId;
  } catch (_) {
    return leagueId;
  }
}

/**
 * Tutti i `league_id` su cui possono esistere dati giornata (matchdays, user_lineups, risultati).
 * @param {number|null} leagueId - Lega dalla URL / contesto.
 * @param {number|number[]|null} extraSeedLeagueIds - Es. `league_id` della riga in `matchdays` da eliminare (se diversa dalla URL).
 */
async function getLeagueIdsForMatchdayDataCleanup(leagueId, extraSeedLeagueIds = null) {
  const seeds = new Set();
  const lid = toValidLeagueId(leagueId);
  if (lid) seeds.add(lid);
  const extras = Array.isArray(extraSeedLeagueIds) ? extraSeedLeagueIds : [extraSeedLeagueIds];
  for (const raw of extras) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) seeds.add(n);
  }
  const ids = new Set();
  for (const seed of seeds) {
    const effectiveId = await getEffectiveLeagueId(seed);
    [seed, effectiveId].forEach((x) => {
      const n = Number(x);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    });
    try {
      const rows = await query(
        `SELECT id FROM leagues WHERE id = ? OR id = ? OR linked_to_league_id = ?`,
        [seed, effectiveId, effectiveId]
      );
      for (const r of rows || []) {
        const id = Number(r.id);
        if (Number.isFinite(id) && id > 0) ids.add(id);
      }
    } catch (_) {
      /* */
    }
  }
  return [...ids];
}

/**
 * Elimina voti inseriti, risultati calcolati, formazioni inviate per quella giornata
 * e record notifiche collegati (prima di rimuovere la riga da matchdays).
 * `extraSeedLeagueIds`: includere sempre `league_id` della riga `matchdays` così non si perde nessun id DB.
 */
async function deleteAllDataForLeagueGiornata(leagueId, giornata, extraSeedLeagueIds = null) {
  const g = Number(giornata);
  if (!Number.isFinite(g) || g <= 0) return;
  const leagueIds = await getLeagueIdsForMatchdayDataCleanup(leagueId, extraSeedLeagueIds);
  if (leagueIds.length === 0) return;
  const inPh = leagueIds.map(() => '?').join(', ');
  const params = [...leagueIds, g];

  await query(
    `DELETE FROM user_lineups WHERE league_id IN (${inPh}) AND giornata::numeric = ?::numeric`,
    params
  );

  const optionalStatements = [
    `DELETE FROM matchday_player_scores WHERE league_id IN (${inPh}) AND giornata::numeric = ?::numeric`,
    `DELETE FROM matchday_results WHERE league_id IN (${inPh}) AND giornata::numeric = ?::numeric`,
    `DELETE FROM push_notification_sends WHERE league_id IN (${inPh}) AND giornata::numeric = ?::numeric AND notification_type = 'matchday_calculated'`,
    `DELETE FROM player_ratings WHERE league_id IN (${inPh}) AND giornata::numeric = ?::numeric`,
  ];
  for (const sql of optionalStatements) {
    try {
      await query(sql, params);
    } catch (_) {
      /* tabelle opzionali o permessi */
    }
  }
}

/**
 * Dopo modifica voti, invalida eventuali risultati già calcolati
 * per evitare classifica/somme stale.
 */
async function invalidateCalculatedForLeagueGiornata(leagueId, giornata) {
  const g = Number(giornata);
  if (!Number.isFinite(g) || g <= 0) return;
  const leagueIds = await getLeagueIdsForMatchdayDataCleanup(leagueId, null);
  if (!leagueIds.length) return;
  const inPh = leagueIds.map(() => '?').join(', ');
  const params = [...leagueIds, g];
  const optionalStatements = [
    `DELETE FROM matchday_player_scores WHERE league_id IN (${inPh}) AND giornata::numeric = ?::numeric`,
    `DELETE FROM matchday_results WHERE league_id IN (${inPh}) AND giornata::numeric = ?::numeric`,
    `DELETE FROM push_notification_sends WHERE league_id IN (${inPh}) AND giornata::numeric = ?::numeric AND notification_type = 'matchday_calculated'`,
  ];
  for (const sql of optionalStatements) {
    try {
      const result = await query(sql, params);
      void result;
    } catch (_) {
      // tabelle opzionali
    }
  }
}

let joinRequestsTableReady = false;
async function ensureJoinRequestsTable() {
  if (joinRequestsTableReady) return true;
  await query(
    `CREATE TABLE IF NOT EXISTS league_join_requests (
       id BIGSERIAL PRIMARY KEY,
       league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
       user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       status TEXT NOT NULL DEFAULT 'pending',
       requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       reviewed_at TIMESTAMPTZ NULL,
       reviewed_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
       UNIQUE (league_id, user_id)
     )`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_league_join_requests_league_status
     ON league_join_requests (league_id, status, requested_at DESC)`
  );
  joinRequestsTableReady = true;
  return true;
}

async function getLeagueByIdForUser(leagueId, userId) {
  const rows = await query(
    `SELECT l.id, l.name, l.access_code, l.creator_id, l.created_at,
            l.initial_budget, l.default_deadline_time, l.max_portieri, l.max_difensori,
            l.max_centrocampisti, l.max_attaccanti, l.numero_titolari, l.auto_lineup_mode,
            l.linked_to_league_id,
            COALESCE(l.is_official, 0) AS is_official,
            l.official_group_id,
            COALESCE(l.recover_previous_lineup_if_missing, 1) AS recover_previous_lineup_if_missing,
            ll.name AS linked_league_name,
            lm.role, ub.team_name, ub.coach_name, ub.team_logo,
            COALESCE(ulp.favorite, 0) AS favorite,
            COALESCE(ulp.archived, 0) AS archived,
            COALESCE(ulp.notifications_enabled, 1) AS notifications_enabled
     FROM leagues l
     JOIN league_members lm ON lm.league_id = l.id AND lm.user_id = ?
     LEFT JOIN leagues ll ON ll.id = l.linked_to_league_id
     LEFT JOIN user_budget ub ON ub.league_id = l.id AND ub.user_id = lm.user_id
     LEFT JOIN user_league_prefs ulp ON ulp.league_id = l.id AND ulp.user_id = lm.user_id
     WHERE l.id = ?
     LIMIT 1`,
    [userId, leagueId]
  );
  return rows[0] || null;
}

async function getUserSuperuserLevel(userId) {
  try {
    const rows = await query(
      `SELECT COALESCE(is_superuser, 0) AS is_superuser
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    return Number(rows[0]?.is_superuser || 0);
  } catch (_) {
    return 0;
  }
}

async function getLeagueByIdForSuperuserViewer(leagueId, userId) {
  const rows = await query(
    `SELECT l.id, l.name, l.access_code, l.creator_id, l.created_at,
            l.initial_budget, l.default_deadline_time, l.max_portieri, l.max_difensori,
            l.max_centrocampisti, l.max_attaccanti, l.numero_titolari, l.auto_lineup_mode,
            l.linked_to_league_id,
            COALESCE(l.is_official, 0) AS is_official,
            l.official_group_id,
            COALESCE(l.recover_previous_lineup_if_missing, 1) AS recover_previous_lineup_if_missing,
            ll.name AS linked_league_name,
            'superuser_viewer'::text AS role, ub.team_name, ub.coach_name, ub.team_logo,
            COALESCE(ulp.favorite, 0) AS favorite,
            COALESCE(ulp.archived, 0) AS archived,
            COALESCE(ulp.notifications_enabled, 1) AS notifications_enabled
     FROM leagues l
     LEFT JOIN leagues ll ON ll.id = l.linked_to_league_id
     LEFT JOIN user_budget ub ON ub.league_id = l.id AND ub.user_id = ?
     LEFT JOIN user_league_prefs ulp ON ulp.league_id = l.id AND ulp.user_id = ?
     WHERE l.id = ?
     LIMIT 1`,
    [userId, userId, leagueId]
  );
  return rows[0] || null;
}

// GET /api/leagues - leghe dell'utente loggato
router.get('/', authenticateToken, async (req, res) => {
  try {
    await ensureMatchdaysGhostSchema();
    const userId = Number(req.user.userId);
    const leagues = await query(
      `SELECT l.id, l.name, l.access_code, l.creator_id, l.created_at,
              l.initial_budget, l.default_deadline_time, l.max_portieri, l.max_difensori,
              l.max_centrocampisti, l.max_attaccanti, l.numero_titolari, l.auto_lineup_mode,
              l.linked_to_league_id,
              COALESCE(l.is_official, 0) AS is_official,
              l.official_group_id,
              l.reference_year,
              ll.name AS linked_league_name,
              lm.role, ub.team_name, ub.coach_name, ub.team_logo,
              COALESCE(ulp.favorite, 0) AS favorite,
              COALESCE(ulp.archived, 0) AS archived,
              COALESCE(ulp.notifications_enabled, 1) AS notifications_enabled,
              (SELECT COUNT(*)::int FROM league_members lm2 WHERE lm2.league_id = l.id) AS user_count,
              (SELECT COUNT(*)::int FROM league_members lm2 WHERE lm2.league_id = l.id) AS member_count,
              COALESCE((
                SELECT lms.market_locked::int
                FROM league_market_settings lms
                WHERE lms.league_id = l.id
                LIMIT 1
              ), 0) AS market_locked,
              ${CURRENT_MATCHDAY_SUBQUERY}
       FROM leagues l
       JOIN league_members lm ON lm.league_id = l.id
       LEFT JOIN leagues ll ON ll.id = l.linked_to_league_id
       LEFT JOIN user_budget ub ON ub.league_id = l.id AND ub.user_id = lm.user_id
       LEFT JOIN user_league_prefs ulp ON ulp.league_id = l.id AND ulp.user_id = lm.user_id
       WHERE lm.user_id = ?
       ORDER BY l.created_at DESC, l.id DESC`,
      [userId]
    );
    const normalized = leagues.map((l) => ({
      ...l,
      user_count: Number(l?.user_count || 0),
      member_count: Number(l?.member_count || 0),
    }));
    res.json(normalized);
  } catch (error) {
    console.error('Get leagues error:', error);
    res.status(500).json({ message: 'Errore nel recupero leghe' });
  }
});

// GET /api/leagues/all - elenco leghe disponibili (con stato iscrizione utente)
router.get('/all', authenticateToken, async (req, res) => {
  try {
    await ensureMatchdaysGhostSchema();
    const userId = Number(req.user.userId);
    const leagues = await query(
      `SELECT l.id, l.name, l.access_code, l.creator_id, l.created_at,
              l.initial_budget, l.default_deadline_time, l.max_portieri, l.max_difensori,
              l.max_centrocampisti, l.max_attaccanti, l.numero_titolari, l.auto_lineup_mode,
              l.linked_to_league_id,
              COALESCE(l.is_official, 0) AS is_official,
              ll.name AS linked_league_name,
              my.role,
              COALESCE(ulp.favorite, 0) AS favorite,
              COALESCE(ulp.archived, 0) AS archived,
              COALESCE(ulp.notifications_enabled, 1) AS notifications_enabled,
              CASE WHEN my.user_id IS NULL THEN 0 ELSE 1 END AS is_joined,
              (SELECT COUNT(*) FROM league_members lm2 WHERE lm2.league_id = l.id) AS user_count,
              COALESCE((
                SELECT lms.market_locked::int
                FROM league_market_settings lms
                WHERE lms.league_id = l.id
                LIMIT 1
              ), 0) AS market_locked,
              ${CURRENT_MATCHDAY_SUBQUERY}
       FROM leagues l
       LEFT JOIN leagues ll ON ll.id = l.linked_to_league_id
       LEFT JOIN league_members my ON my.league_id = l.id AND my.user_id = ?
       LEFT JOIN user_league_prefs ulp ON ulp.league_id = l.id AND ulp.user_id = ?
       WHERE my.user_id IS NULL
         AND COALESCE(l.is_hidden_from_discovery, 0) = 0
       ORDER BY COALESCE(l.is_official, 0) DESC, l.created_at DESC, l.id DESC`,
      [userId, userId]
    );
    res.json(leagues);
  } catch (error) {
    console.error('Get all leagues error:', error);
    res.status(500).json({ message: 'Errore nel recupero leghe' });
  }
});

// GET /api/leagues/search?q=...
router.get('/search', authenticateToken, async (req, res) => {
  try {
    await ensureMatchdaysGhostSchema();
    const userId = Number(req.user.userId);
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);

    const leagues = await query(
      `SELECT l.id, l.name, l.access_code, l.creator_id, l.created_at,
              l.initial_budget, l.default_deadline_time, l.max_portieri, l.max_difensori,
              l.max_centrocampisti, l.max_attaccanti, l.numero_titolari, l.auto_lineup_mode,
              l.linked_to_league_id,
              ll.name AS linked_league_name,
              CASE WHEN my.user_id IS NULL THEN 0 ELSE 1 END AS is_joined,
              (SELECT COUNT(*) FROM league_members lm2 WHERE lm2.league_id = l.id) AS user_count,
              COALESCE((
                SELECT lms.market_locked::int
                FROM league_market_settings lms
                WHERE lms.league_id = l.id
                LIMIT 1
              ), 0) AS market_locked,
              ${CURRENT_MATCHDAY_SUBQUERY}
       FROM leagues l
       LEFT JOIN leagues ll ON ll.id = l.linked_to_league_id
       LEFT JOIN league_members my ON my.league_id = l.id AND my.user_id = ?
       WHERE l.name ILIKE ?
         AND my.user_id IS NULL
         AND COALESCE(l.is_hidden_from_discovery, 0) = 0
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT 50`,
      [userId, `%${q}%`]
    );
    res.json(leagues);
  } catch (error) {
    console.error('Search leagues error:', error);
    res.status(500).json({ message: 'Errore durante la ricerca leghe' });
  }
});

// GET /api/leagues/:id - dettaglio lega (solo se membro)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const leagueId = Number(req.params.id);
    if (!Number.isFinite(leagueId) || leagueId <= 0) {
      return res.status(400).json({ message: 'League ID non valido' });
    }

    let league = await getLeagueByIdForUser(leagueId, userId);
    if (!league) {
      const suLevel = await getUserSuperuserLevel(userId);
      if (suLevel === 1) {
        league = await getLeagueByIdForSuperuserViewer(leagueId, userId);
      }
    }
    if (!league) {
      return res.status(404).json({ message: 'Lega non trovata o accesso negato' });
    }
    res.json(league);
  } catch (error) {
    console.error('Get league by id error:', error);
    res.status(500).json({ message: 'Errore nel recupero lega' });
  }
});

// GET /api/leagues/:id/dashboard-data - payload aggregato dashboard lega
router.get('/:id/dashboard-data', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const leagueId = Number(req.params.id);
    if (!Number.isFinite(leagueId) || leagueId <= 0) {
      return res.status(400).json({ message: 'League ID non valido' });
    }

    // ── Phase 1: league + effectiveLeagueId in parallel ──
    const [leagueResult, effectiveLeagueId] = await Promise.all([
      (async () => {
        let l = await getLeagueByIdForUser(leagueId, userId);
        if (!l) {
          const suLevel = await getUserSuperuserLevel(userId);
          if (suLevel === 1) l = await getLeagueByIdForSuperuserViewer(leagueId, userId);
        }
        return l;
      })(),
      getEffectiveLeagueId(leagueId),
    ]);
    await ensureMatchdaysGhostSchema();
    const league = leagueResult;
    if (!league) {
      return res.status(404).json({ message: 'Lega non trovata o accesso negato' });
    }

    // ── Phase 2: all independent queries in parallel ──
    const isAutoLineup = Number(league.auto_lineup_mode || 0) === 1;
    const [
      teamRows,
      standingsRows,
      scoreRows,
      squadCountRows,
      marketCountRows,
      roleLimitsRows,
      roleOwnedRows,
      liveRows,
      ndRows,
      sfRows,
    ] = await Promise.all([
      query(
        `SELECT team_name, coach_name, team_logo
         FROM user_budget
         WHERE user_id = ? AND league_id = ?
         LIMIT 1`,
        [userId, leagueId]
      ),
      query(
        `SELECT mr.user_id AS id, u.username,
                COALESCE(ub.team_name, u.username) AS team_name,
                COALESCE(ub.team_logo, 'default_1') AS team_logo,
                SUM(mr.punteggio)::float AS punteggio,
                AVG(mr.punteggio)::float AS media_punti
         FROM matchday_results mr
         ${MR_EXCLUDE_GHOST_JOIN}
         JOIN users u ON u.id = mr.user_id
         LEFT JOIN user_budget ub ON ub.user_id = mr.user_id AND ub.league_id = mr.league_id
         WHERE mr.league_id = ?
         GROUP BY mr.user_id, u.username, ub.team_name, ub.team_logo
         ORDER BY punteggio DESC,
                  LOWER(COALESCE(ub.team_name, u.username)) ASC,
                  LOWER(u.username) ASC`,
        [effectiveLeagueId, leagueId]
      ),
      query(
        `SELECT mr.giornata, mr.punteggio
         FROM matchday_results mr
         ${MR_EXCLUDE_GHOST_JOIN}
         WHERE mr.league_id = ? AND mr.user_id = ?
         ORDER BY mr.giornata ASC`,
        [effectiveLeagueId, leagueId, userId]
      ).catch(() => []),
      query(
        `SELECT COUNT(*)::int AS c
         FROM user_players
         WHERE user_id = ? AND league_id = ?`,
        [userId, leagueId]
      ),
      query(
        `SELECT COUNT(*)::int AS c
         FROM players p
         JOIN teams t ON t.id = p.team_id
         WHERE t.league_id = ?`,
        [effectiveLeagueId]
      ),
      query(
        `SELECT max_portieri, max_difensori, max_centrocampisti, max_attaccanti
         FROM leagues
         WHERE id = ?
         LIMIT 1`,
        [leagueId]
      ),
      query(
        `SELECT p.role, COUNT(*)::int AS c
         FROM user_players up
         JOIN players p ON p.id = up.player_id
         WHERE up.user_id = ? AND up.league_id = ?
         GROUP BY p.role`,
        [userId, leagueId]
      ),
      query(
        `SELECT m.giornata
         FROM matchdays m
         WHERE m.league_id = ?
           AND COALESCE(m.is_ghost, 0) = 0
           AND m.deadline < NOW()
           AND EXISTS (
             SELECT 1
             FROM player_ratings pr
             WHERE pr.league_id = m.league_id
               AND pr.giornata = m.giornata
           )
           AND NOT EXISTS (
             SELECT 1
             FROM matchday_results mr
             WHERE mr.league_id = ?
               AND mr.giornata = m.giornata
           )
         ORDER BY m.deadline DESC
         LIMIT 1`,
        [effectiveLeagueId, leagueId]
      ).catch(() => []),
      isAutoLineup
        ? Promise.resolve([])
        : query(
            `SELECT giornata,
                    to_char((deadline AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-DD HH24:MI:SS') AS deadline
             FROM matchdays
             WHERE league_id = ?
               AND COALESCE(is_ghost, 0) = 0
               AND deadline > NOW()
             ORDER BY deadline ASC
             LIMIT 1`,
            [effectiveLeagueId]
          ).catch(() => []),
      query(
        `SELECT 1 FROM user_lineups
         WHERE league_id = ? AND user_id = ?
         LIMIT 1`,
        [leagueId, userId]
      ).catch(() => []),
    ]);

    // ── Process results ──
    const teamName = String(teamRows[0]?.team_name || '').trim();
    const coachName = String(teamRows[0]?.coach_name || '').trim();
    const teamLogo = String(teamRows[0]?.team_logo || 'default_1').trim() || 'default_1';
    const hasTeam = teamName !== '' && !/^Squadra\s*\d+$/i.test(teamName);
    const hasCoach = coachName !== '' && !/^Allenatore\s*\d+$/i.test(coachName);
    const isSuperuserViewer = String(league?.role || '') === 'superuser_viewer';
    const needsInfo = isSuperuserViewer ? false : !(hasTeam && hasCoach);

    let standingsFull = standingsRows;
    if (!Array.isArray(standingsRows) || standingsRows.length === 0) {
      standingsFull = await query(
        `SELECT lm.user_id AS id, u.username,
                COALESCE(ub.team_name, u.username) AS team_name,
                COALESCE(ub.team_logo, 'default_1') AS team_logo,
                0::float AS punteggio, 0::float AS media_punti
         FROM league_members lm
         JOIN users u ON u.id = lm.user_id
         LEFT JOIN user_budget ub ON ub.user_id = lm.user_id AND ub.league_id = lm.league_id
         WHERE lm.league_id = ?
         ORDER BY u.username ASC`,
        [leagueId]
      );
    }

    let lastScore = null;
    let currentPosition = 0;
    const standingsWithPosition = (standingsFull || []).map((row, idx) => {
      const score = Number(row?.punteggio || 0);
      if (idx === 0 || score !== lastScore) {
        currentPosition = idx + 1;
        lastScore = score;
      }
      return { ...row, position: currentPosition };
    });

    const topStandings = standingsWithPosition.slice(0, 5);
    const userIdx = standingsWithPosition.findIndex((r) => Number(r.id) === userId);
    const userStats = userIdx >= 0
      ? {
          position: Number(standingsWithPosition[userIdx].position || 0),
          totalPoints: Number(Number(standingsWithPosition[userIdx].punteggio || 0).toFixed(1)),
          avgPoints: Number(Number(standingsWithPosition[userIdx].media_punti || 0).toFixed(2)),
        }
      : null;

    const userScoresAll = Array.isArray(scoreRows)
      ? scoreRows.map((r) => ({ giornata: Number(r.giornata || 0), punteggio: Number(r.punteggio || 0) }))
      : [];
    // LeagueScreen con >=5 elementi fa slice(-5).reverse(): inviamo ultime 5 DESC così in UI escono ASC.
    const userScores = userScoresAll.length >= 5
      ? userScoresAll.slice(-5).sort((a, b) => b.giornata - a.giornata)
      : userScoresAll;

    const squadPlayersCount = Number(squadCountRows[0]?.c || 0);
    const marketPlayersCount = Number(marketCountRows[0]?.c || 0);

    const limits = roleLimitsRows[0] || {};
    const ownedByRole = { P: 0, D: 0, C: 0, A: 0 };
    roleOwnedRows.forEach((r) => {
      const role = String(r.role || '').trim().toUpperCase();
      if (ownedByRole[role] != null) ownedByRole[role] = Number(r.c || 0);
    });
    const limitsByRole = {
      P: Number(limits.max_portieri || 0),
      D: Number(limits.max_difensori || 0),
      C: Number(limits.max_centrocampisti || 0),
      A: Number(limits.max_attaccanti || 0),
    };
    const squadFull = ['P', 'D', 'C', 'A'].every((r) => limitsByRole[r] > 0 && ownedByRole[r] >= limitsByRole[r]);

    const liveMatchday = Number(liveRows[0]?.giornata || 0) || null;

    let nextDeadline = null;
    if (!isAutoLineup && ndRows[0]) {
      nextDeadline = {
        giornata: Number(ndRows[0].giornata || 0),
        deadline: ndRows[0].deadline,
      };
    }

    const hasSubmittedFormation = Array.isArray(sfRows) && sfRows.length > 0;

    return res.json({
      league,
      needs_info: needsInfo,
      default_team_name: teamName || '',
      default_coach_name: coachName || '',
      user_team_info: {
        team_name: teamName || '',
        coach_name: coachName || '',
        team_logo: teamLogo || 'default_1',
      },
      top_standings: topStandings,
      user_stats: userStats,
      user_scores: userScores,
      squad_players_count: squadPlayersCount,
      market_players_count: marketPlayersCount,
      role_limits: limitsByRole,
      squad_full: squadFull,
      live_matchday: liveMatchday,
      next_deadline: nextDeadline,
      has_submitted_formation: hasSubmittedFormation,
    });
  } catch (error) {
    console.error('Dashboard data error:', error);
    return res.status(500).json({ message: 'Errore caricamento dashboard lega' });
  }
});

// POST /api/leagues/:id/prefs - preferenze dashboard lega
router.post('/:id/prefs', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const favorite = Number(req.body?.favorite ? 1 : 0);
    const archived = Number(req.body?.archived ? 1 : 0);
    const notificationsEnabled = Number(req.body?.notifications_enabled === 0 ? 0 : 1);

    await query(
      `INSERT INTO user_league_prefs (user_id, league_id, favorite, archived, notifications_enabled)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, league_id)
       DO UPDATE SET
         favorite = EXCLUDED.favorite,
         archived = EXCLUDED.archived,
         notifications_enabled = EXCLUDED.notifications_enabled`,
      [userId, leagueId, favorite, archived, notificationsEnabled]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error('Update league prefs error:', error);
    res.status(500).json({ message: 'Errore aggiornamento preferenze lega' });
  }
});

// GET /api/leagues/:id/team-info/check
router.get('/:id/team-info/check', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const teamRows = await query(
      `SELECT team_name, coach_name
       FROM user_budget
       WHERE user_id = ? AND league_id = ?
       LIMIT 1`,
      [userId, leagueId]
    );

    const teamName = String(teamRows[0]?.team_name || '').trim();
    const coachName = String(teamRows[0]?.coach_name || '').trim();

    const hasTeam = teamName !== '' && !/^Squadra\s*\d+$/i.test(teamName);
    const hasCoach = coachName !== '' && !/^Allenatore\s*\d+$/i.test(coachName);

    res.json({
      needs_info: !(hasTeam && hasCoach),
      default_team_name: teamName || '',
      default_coach_name: coachName || '',
    });
  } catch (error) {
    console.error('Check team info error:', error);
    res.status(500).json({ message: 'Errore controllo info squadra' });
  }
});

// PUT /api/leagues/:id/team-info
router.put('/:id/team-info', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const teamName = String(req.body?.team_name || '').trim();
    const coachName = String(req.body?.coach_name || '').trim();
    if (!teamName || !coachName) {
      return res.status(400).json({ message: 'Nome squadra e nome allenatore sono obbligatori' });
    }
    const leagueRows = await query(
      `SELECT COALESCE(initial_budget, 100) AS initial_budget FROM leagues WHERE id = ? LIMIT 1`,
      [leagueId]
    );
    const budget = Number(leagueRows[0]?.initial_budget || 100);
    await query(
      `INSERT INTO user_budget (user_id, league_id, budget, team_name, coach_name, team_logo)
       VALUES (?, ?, ?, ?, ?, 'default_1')
       ON CONFLICT (user_id, league_id)
       DO UPDATE SET
         team_name = EXCLUDED.team_name,
         coach_name = EXCLUDED.coach_name`,
      [userId, leagueId, budget, teamName, coachName]
    );
    res.json({ message: 'Info squadra aggiornate' });
  } catch (error) {
    console.error('Update team info error:', error);
    res.status(500).json({ message: 'Errore aggiornamento info squadra' });
  }
});

// POST /api/leagues/:id/team-info/logo
router.post('/:id/team-info/logo', authenticateToken, teamLogoUpload.single('logo'), async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    if (!req.file) return res.status(400).json({ message: 'File logo mancante' });
    const supabase = getSupabaseStorageClient();
    if (!supabase) {
      return res.status(500).json({
        message: 'Supabase Storage non configurato: manca SUPABASE_SERVICE_ROLE_KEY nel backend .env',
      });
    }
    const ext = path.extname(String(req.file.originalname || '')).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    const ts = Math.floor(Date.now() / 1000);
    const filename = `user_team_${leagueId}_${userId}_${ts}${safeExt}`;
    const storagePath = `team_logos/${filename}`;

    // Best effort cleanup: mantiene un solo logo custom per utente/lega.
    try {
      const { data: existing, error: listErr } = await supabase.storage.from('uploads').list('team_logos', {
        limit: 2000,
      });
      if (!listErr && Array.isArray(existing)) {
        const prefix = `user_team_${leagueId}_${userId}_`;
        const toDelete = existing
          .map((f) => String(f?.name || '').trim())
          .filter((name) => name.startsWith(prefix))
          .map((name) => `team_logos/${name}`);
        if (toDelete.length > 0) {
          await supabase.storage.from('uploads').remove(toDelete);
        }
      }
    } catch (_) {
      // ignore cleanup errors
    }

    const { error: storageError } = await supabase.storage
      .from('uploads')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype || 'image/jpeg',
        upsert: true,
        cacheControl: '3600',
      });
    if (storageError) {
      return res.status(500).json({ message: 'Errore upload logo su Supabase Storage', error: storageError.message });
    }
    const logoPath = `uploads/${storagePath}`;
    await query(
      `UPDATE user_budget
       SET team_logo = ?
       WHERE user_id = ? AND league_id = ?`,
      [logoPath, userId, leagueId]
    );
    res.json({ message: 'Logo squadra aggiornato', team_logo: logoPath });
  } catch (error) {
    console.error('Upload team logo error:', error);
    res.status(500).json({ message: 'Errore upload logo squadra' });
  }
});

// DELETE /api/leagues/:id/team-info/logo
router.delete('/:id/team-info/logo', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    try {
      const rows = await query(
        `SELECT team_logo
         FROM user_budget
         WHERE user_id = ? AND league_id = ?
         LIMIT 1`,
        [userId, leagueId]
      );
      const existingLogo = String(rows?.[0]?.team_logo || '').trim();
      if (existingLogo.startsWith('uploads/team_logos/')) {
        const supabase = getSupabaseStorageClient();
        if (supabase) {
          const storagePath = existingLogo.replace(/^uploads\//, '');
          await supabase.storage.from('uploads').remove([storagePath]);
        }
      }
    } catch (_) {
      // ignore cleanup errors
    }
    await query(
      `UPDATE user_budget
       SET team_logo = 'default_1'
       WHERE user_id = ? AND league_id = ?`,
      [userId, leagueId]
    );
    res.json({ message: 'Logo rimosso' });
  } catch (error) {
    console.error('Remove team logo error:', error);
    res.status(500).json({ message: 'Errore rimozione logo' });
  }
});

// POST /api/leagues/:id/team-info/logo/default
router.post('/:id/team-info/logo/default', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const leagueId = toValidLeagueId(req.params.id);
    const logoId = String(req.body?.logo_id || 'default_1').trim();
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const safeLogo = /^default_\d+$/i.test(logoId) ? logoId : 'default_1';
    await query(
      `UPDATE user_budget
       SET team_logo = ?
       WHERE user_id = ? AND league_id = ?`,
      [safeLogo, userId, leagueId]
    );
    res.json({ message: 'Logo aggiornato' });
  } catch (error) {
    console.error('Select default logo error:', error);
    res.status(500).json({ message: 'Errore selezione logo' });
  }
});

// GET /api/leagues/:id/members
router.get('/:id/members', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const rows = await query(
      `SELECT lm.user_id, u.username, lm.role,
              CASE WHEN lm.user_id = ? THEN 1 ELSE 0 END AS is_current_user,
              ub.team_name, ub.coach_name, ub.team_logo
       FROM league_members lm
       JOIN users u ON u.id = lm.user_id
       LEFT JOIN user_budget ub ON ub.user_id = lm.user_id AND ub.league_id = lm.league_id
       WHERE lm.league_id = ?
       ORDER BY (CASE WHEN lm.role = 'admin' THEN 0 ELSE 1 END), u.username ASC`,
      [userId, leagueId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({ message: 'Errore recupero membri' });
  }
});

// GET /api/leagues/:id/leave/info
router.get('/:id/leave/info', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const members = await query(
      `SELECT user_id, role
       FROM league_members
       WHERE league_id = ?`,
      [leagueId]
    );
    const myRow = members.find((m) => Number(m.user_id) === userId);
    const others = members.filter((m) => Number(m.user_id) !== userId);
    const adminCount = members.filter((m) => String(m.role) === 'admin').length;

    const onlyUser = members.length <= 1;
    const onlyAdmin = !!myRow && String(myRow.role) === 'admin' && adminCount <= 1 && others.length > 0;
    res.json({
      only_user: onlyUser,
      only_admin: onlyAdmin,
      other_members: others,
    });
  } catch (error) {
    console.error('Leave info error:', error);
    res.status(500).json({ message: 'Errore recupero informazioni abbandono lega' });
  }
});

// GET /api/leagues/:id/standings?limit=5
router.get('/:id/standings', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const limitRaw = Number(req.query?.limit || 5);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 5;
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    await ensureMatchdaysGhostSchema();
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);

    let rows = [];
    try {
      rows = await query(
        `SELECT mr.user_id AS id, u.username, COALESCE(ub.team_name, u.username) AS team_name,
                SUM(mr.punteggio)::float AS punteggio,
                AVG(mr.punteggio)::float AS media_punti
         FROM matchday_results mr
         ${MR_EXCLUDE_GHOST_JOIN}
         JOIN users u ON u.id = mr.user_id
         LEFT JOIN user_budget ub ON ub.user_id = mr.user_id AND ub.league_id = mr.league_id
         WHERE mr.league_id = ?
         GROUP BY mr.user_id, u.username, ub.team_name
         ORDER BY punteggio DESC,
                  LOWER(COALESCE(ub.team_name, u.username)) ASC,
                  LOWER(u.username) ASC
         LIMIT ?`,
        [effectiveLeagueId, leagueId, limit]
      );
    } catch (_) {
      rows = await query(
        `SELECT lm.user_id AS id, u.username, COALESCE(ub.team_name, u.username) AS team_name,
                0::float AS punteggio, 0::float AS media_punti
         FROM league_members lm
         JOIN users u ON u.id = lm.user_id
         LEFT JOIN user_budget ub ON ub.user_id = lm.user_id AND ub.league_id = lm.league_id
         WHERE lm.league_id = ?
         ORDER BY u.username ASC
         LIMIT ?`,
        [leagueId, limit]
      );
    }
    res.json(rows);
  } catch (error) {
    console.error('Standings short error:', error);
    res.status(500).json({ message: 'Errore caricamento classifica' });
  }
});

// POST /api/leagues/:id/remove-user (admin)
router.post('/:id/remove-user', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const actorId = Number(req.user.userId);
    const targetUserId = Number(req.body?.user_id);
    if (!leagueId || !Number.isFinite(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    const roleRows = await query(
      `SELECT role FROM league_members WHERE league_id = ? AND user_id = ? LIMIT 1`,
      [leagueId, actorId]
    );
    if (!roleRows[0] || String(roleRows[0].role) !== 'admin') {
      return res.status(403).json({ message: 'Solo gli admin possono rimuovere utenti' });
    }
    if (targetUserId === actorId) {
      return res.status(400).json({ message: 'Usa "lascia lega" per uscire dalla lega' });
    }
    await deleteUserFantasyLeagueParticipationData(leagueId, targetUserId);
    await query(`DELETE FROM league_members WHERE league_id = ? AND user_id = ?`, [leagueId, targetUserId]);
    await query(`DELETE FROM user_budget WHERE league_id = ? AND user_id = ?`, [leagueId, targetUserId]);
    await query(`DELETE FROM user_league_prefs WHERE league_id = ? AND user_id = ?`, [leagueId, targetUserId]);
    res.json({ message: 'Utente rimosso dalla lega' });
  } catch (error) {
    console.error('Remove user error:', error);
    res.status(500).json({ message: 'Errore rimozione utente' });
  }
});

// POST /api/leagues/:id/change-role (admin)
router.post('/:id/change-role', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const actorId = Number(req.user.userId);
    const memberIdRaw = req.body?.member_id != null ? req.body.member_id : req.body?.user_id;
    const memberId = Number(memberIdRaw);
    const newRole = String(req.body?.new_role || '').trim();
    if (!leagueId || !Number.isFinite(memberId) || !['admin', 'user', 'pagellatore'].includes(newRole)) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    const roleRows = await query(
      `SELECT role FROM league_members WHERE league_id = ? AND user_id = ? LIMIT 1`,
      [leagueId, actorId]
    );
    if (!roleRows[0] || String(roleRows[0].role) !== 'admin') {
      return res.status(403).json({ message: 'Solo gli admin possono cambiare ruoli' });
    }
    await query(
      `UPDATE league_members SET role = ? WHERE league_id = ? AND user_id = ?`,
      [newRole, leagueId, memberId]
    );
    res.json({ message: 'Ruolo aggiornato' });
  } catch (error) {
    console.error('Change role error:', error);
    res.status(500).json({ message: 'Errore aggiornamento ruolo' });
  }
});

// GET /api/leagues/:id/join-requests
router.get('/:id/join-requests', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const actorId = Number(req.user.userId);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });

    const roleRows = await query(
      `SELECT role FROM league_members WHERE league_id = ? AND user_id = ? LIMIT 1`,
      [leagueId, actorId]
    );
    const isAdmin = !!roleRows[0] && String(roleRows[0].role) === 'admin';
    if (!isAdmin) {
      const suLevel = await getUserSuperuserLevel(actorId);
      if (suLevel !== 1) return res.status(403).json({ message: 'Solo gli admin possono vedere le richieste' });
    }

    await ensureJoinRequestsTable();
    const rows = await query(
      `SELECT r.id, r.user_id, u.username, r.status, r.requested_at
       FROM league_join_requests r
       JOIN users u ON u.id = r.user_id
       WHERE r.league_id = ?
         AND r.status = 'pending'
       ORDER BY r.requested_at ASC`,
      [leagueId]
    );
    return res.json({ requests: rows });
  } catch (error) {
    console.error('Get join requests error:', error);
    return res.status(500).json({ message: 'Errore caricamento richieste iscrizione' });
  }
});

// POST /api/leagues/:id/join-requests/:requestId/approve
router.post('/:id/join-requests/:requestId/approve', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const requestId = Number(req.params.requestId);
    const actorId = Number(req.user.userId);
    if (!leagueId || !Number.isFinite(requestId) || requestId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }

    const roleRows = await query(
      `SELECT role FROM league_members WHERE league_id = ? AND user_id = ? LIMIT 1`,
      [leagueId, actorId]
    );
    if (!roleRows[0] || String(roleRows[0].role) !== 'admin') {
      return res.status(403).json({ message: 'Solo gli admin possono approvare richieste' });
    }

    await ensureJoinRequestsTable();
    const reqRows = await query(
      `SELECT id, user_id, status
       FROM league_join_requests
       WHERE id = ? AND league_id = ?
       LIMIT 1`,
      [requestId, leagueId]
    );
    const request = reqRows[0];
    if (!request || String(request.status) !== 'pending') {
      return res.status(404).json({ message: 'Richiesta non trovata o non più pendente' });
    }

    const leagueRows = await query(
      `SELECT initial_budget FROM leagues WHERE id = ? LIMIT 1`,
      [leagueId]
    );
    const initialBudget = Number(leagueRows[0]?.initial_budget || 100);
    await addUserToLeagueWithInitialBudget(Number(request.user_id), leagueId, initialBudget);

    await query(
      `UPDATE league_join_requests
       SET status = 'approved',
           reviewed_at = NOW(),
           reviewed_by = ?
       WHERE id = ?`,
      [actorId, requestId]
    );
    return res.json({ message: 'Richiesta approvata' });
  } catch (error) {
    console.error('Approve join request error:', error);
    return res.status(500).json({ message: 'Errore approvazione richiesta' });
  }
});

// POST /api/leagues/:id/join-requests/:requestId/reject
router.post('/:id/join-requests/:requestId/reject', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const requestId = Number(req.params.requestId);
    const actorId = Number(req.user.userId);
    if (!leagueId || !Number.isFinite(requestId) || requestId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }

    const roleRows = await query(
      `SELECT role FROM league_members WHERE league_id = ? AND user_id = ? LIMIT 1`,
      [leagueId, actorId]
    );
    if (!roleRows[0] || String(roleRows[0].role) !== 'admin') {
      return res.status(403).json({ message: 'Solo gli admin possono rifiutare richieste' });
    }

    await ensureJoinRequestsTable();
    const reqRows = await query(
      `SELECT id, status
       FROM league_join_requests
       WHERE id = ? AND league_id = ?
       LIMIT 1`,
      [requestId, leagueId]
    );
    const request = reqRows[0];
    if (!request || String(request.status) !== 'pending') {
      return res.status(404).json({ message: 'Richiesta non trovata o non più pendente' });
    }

    await query(
      `UPDATE league_join_requests
       SET status = 'rejected',
           reviewed_at = NOW(),
           reviewed_by = ?
       WHERE id = ?`,
      [actorId, requestId]
    );
    return res.json({ message: 'Richiesta rifiutata' });
  } catch (error) {
    console.error('Reject join request error:', error);
    return res.status(500).json({ message: 'Errore rifiuto richiesta' });
  }
});

// GET /api/leagues/:id/teams
router.get('/:id/teams', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    let rows = [];
    try {
      rows = await query(
        `SELECT t.id, t.name, COALESCE(t.jersey_color, '#667eea') AS jersey_color, t.logo_path,
                COALESCE(pc.player_count, 0)::int AS player_count
         FROM teams t
         LEFT JOIN (
           SELECT team_id, COUNT(*)::int AS player_count
           FROM players
           GROUP BY team_id
         ) pc ON pc.team_id = t.id
         WHERE t.league_id = ?
         ORDER BY t.id ASC`,
        [effectiveLeagueId]
      );
    } catch (_) {
      rows = await query(
        `SELECT t.id, t.name,
                COALESCE(pc.player_count, 0)::int AS player_count
         FROM teams t
         LEFT JOIN (
           SELECT team_id, COUNT(*)::int AS player_count
           FROM players
           GROUP BY team_id
         ) pc ON pc.team_id = t.id
         WHERE t.league_id = ?
         ORDER BY t.id ASC`,
        [effectiveLeagueId]
      );
      rows = rows.map((r) => ({ ...r, jersey_color: '#667eea', logo_path: null, player_count: Number(r?.player_count || 0) }));
    }
    res.json(rows);
  } catch (error) {
    console.error('Get league teams error:', error);
    res.status(500).json({ message: 'Errore caricamento squadre ufficiali' });
  }
});

// POST /api/leagues/:id/teams
router.post('/:id/teams', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const name = String(req.body?.name || '').trim();
    if (!leagueId || !name) return res.status(400).json({ message: 'Parametri non validi' });
    let ins;
    try {
      ins = await query(
        `INSERT INTO teams (league_id, name)
         VALUES (?, ?)
         RETURNING id`,
        [leagueId, name]
      );
    } catch (insertErr) {
      if (insertErr && insertErr.code === '23505') {
        await syncTeamsIdSequence();
        ins = await query(
          `INSERT INTO teams (league_id, name)
           VALUES (?, ?)
           RETURNING id`,
          [leagueId, name]
        );
      } else {
        throw insertErr;
      }
    }
    res.status(201).json({ id: ins.insertId, name });
  } catch (error) {
    console.error('Add team error:', error);
    res.status(500).json({ message: 'Errore creazione squadra ufficiale' });
  }
});

// POST /api/leagues/:id/teams/:teamId/logo
router.post('/:id/teams/:teamId/logo', authenticateToken, officialLogoUpload.single('logo'), async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const teamId = Number(req.params.teamId);
    if (!leagueId || !Number.isFinite(teamId) || teamId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    if (!req.file) return res.status(400).json({ message: 'File logo mancante' });
    const supabase = getSupabaseStorageClient();
    if (!supabase) {
      return res.status(500).json({
        message: 'Supabase Storage non configurato: manca SUPABASE_SERVICE_ROLE_KEY nel backend .env',
      });
    }

    const leagueRows = await query(
      `SELECT official_group_id, COALESCE(is_official, 0) AS is_official FROM leagues WHERE id = ? LIMIT 1`,
      [leagueId]
    );
    const groupId = Number(leagueRows[0]?.official_group_id || 0);
    const teamRows = await query(`SELECT name FROM teams WHERE id = ? AND league_id = ? LIMIT 1`, [teamId, leagueId]);
    const teamName = String(teamRows[0]?.name || '').trim();
    if (!teamName) return res.status(404).json({ message: 'Squadra non trovata' });

    const ext = path.extname(String(req.file.originalname || '')).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    const ts = Math.floor(Date.now() / 1000);

    let filename;
    let siblingTeamIds = [teamId];
    if (groupId > 0) {
      filename = buildOfficialTeamLogoFilename(groupId, teamName, safeExt, ts);
      const siblings = await query(
        `SELECT t.id
         FROM teams t
         INNER JOIN leagues l ON l.id = t.league_id
         WHERE l.official_group_id = ?
           AND LOWER(TRIM(t.name)) = LOWER(TRIM(?))`,
        [groupId, teamName]
      );
      siblingTeamIds = (siblings || []).map((r) => Number(r.id)).filter((id) => id > 0);
    } else {
      filename = `official_team_${teamId}_${ts}${safeExt}`;
    }
    const storagePath = `official_team_logos/${filename}`;

    try {
      await removeOfficialTeamLogoVariants(supabase, {
        groupId: groupId > 0 ? groupId : null,
        teamName,
        teamIds: siblingTeamIds,
      });
    } catch (_) {
      // best effort cleanup
    }
    const { error: storageError } = await supabase.storage
      .from('uploads')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype || 'image/jpeg',
        upsert: true,
        cacheControl: '3600',
      });
    if (storageError) {
      return res.status(500).json({ message: 'Errore upload logo su Supabase Storage', error: storageError.message });
    }
    const logoPath = `uploads/${storagePath}`;
    try {
      if (groupId > 0) {
        await query(
          `UPDATE teams t
           SET logo_path = ?
           FROM leagues l
           WHERE t.league_id = l.id
             AND l.official_group_id = ?
             AND LOWER(TRIM(t.name)) = LOWER(TRIM(?))`,
          [logoPath, groupId, teamName]
        );
      } else {
        await query(
          `UPDATE teams SET logo_path = ? WHERE id = ? AND league_id = ?`,
          [logoPath, teamId, leagueId]
        );
      }
    } catch (_) {
      // Colonna logo_path non presente: fallback compat.
    }
    res.json({
      message: 'Logo squadra ufficiale aggiornato',
      logo_path: logoPath,
      teams_updated: siblingTeamIds.length,
    });
  } catch (error) {
    console.error('Upload official team logo error:', error);
    res.status(500).json({ message: 'Errore upload logo squadra ufficiale' });
  }
});

// DELETE /api/leagues/:id/teams/:teamId/logo
router.delete('/:id/teams/:teamId/logo', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const teamId = Number(req.params.teamId);
    if (!leagueId || !Number.isFinite(teamId) || teamId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    try {
      const leagueRows = await query(
        `SELECT official_group_id FROM leagues WHERE id = ? LIMIT 1`,
        [leagueId]
      );
      const groupId = Number(leagueRows[0]?.official_group_id || 0);
      const teamRows = await query(`SELECT name FROM teams WHERE id = ? AND league_id = ? LIMIT 1`, [teamId, leagueId]);
      const teamName = String(teamRows[0]?.name || '').trim();

      if (groupId > 0 && teamName) {
        await query(
          `UPDATE teams t
           SET logo_path = NULL
           FROM leagues l
           WHERE t.league_id = l.id
             AND l.official_group_id = ?
             AND LOWER(TRIM(t.name)) = LOWER(TRIM(?))`,
          [groupId, teamName]
        );
      } else {
        await query(
          `UPDATE teams SET logo_path = NULL WHERE id = ? AND league_id = ?`,
          [teamId, leagueId]
        );
      }
    } catch (_) {
      // Colonna non presente: ignore.
    }
    res.json({ message: 'Logo squadra ufficiale rimosso' });
  } catch (error) {
    console.error('Remove official team logo error:', error);
    res.status(500).json({ message: 'Errore rimozione logo squadra ufficiale' });
  }
});

// POST /api/leagues/:id/teams/:teamId/players/:playerId/photo
const playerPhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
router.post('/:id/teams/:teamId/players/:playerId/photo', authenticateToken, playerPhotoUpload.single('photo'), async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const teamId = Number(req.params.teamId);
    const playerId = Number(req.params.playerId);
    if (!leagueId || !Number.isFinite(teamId) || teamId <= 0 || !Number.isFinite(playerId) || playerId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    if (!req.file) return res.status(400).json({ message: 'File foto mancante' });
    const supabase = getSupabaseStorageClient();
    if (!supabase) {
      return res.status(500).json({ message: 'Supabase Storage non configurato' });
    }

    let clusterId = 0;
    let memberPlayerIds = [playerId];
    try {
      const clusterRows = await query(
        `SELECT pc.id AS cluster_id
         FROM player_cluster_members pcm
         INNER JOIN player_clusters pc ON pc.id = pcm.cluster_id
         WHERE pcm.player_id = ?
           AND pc.status = 'approved'
         LIMIT 1`,
        [playerId]
      );
      clusterId = Number(clusterRows[0]?.cluster_id || 0);
      if (clusterId > 0) {
        const members = await query(
          `SELECT player_id FROM player_cluster_members WHERE cluster_id = ?`,
          [clusterId]
        );
        memberPlayerIds = (members || []).map((r) => Number(r.player_id)).filter((id) => id > 0);
      }
    } catch (_) {
      clusterId = 0;
      memberPlayerIds = [playerId];
    }

    const ext = path.extname(String(req.file.originalname || '')).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    const ts = Math.floor(Date.now() / 1000);
    const rand = Math.random().toString(36).slice(2, 8);
    const filename =
      clusterId > 0
        ? buildPlayerClusterPhotoFilename(clusterId, safeExt, ts, rand)
        : buildPlayerSoloPhotoFilename(playerId, safeExt, ts, rand);
    const storagePath = `player_photos/${filename}`;

    try {
      await removePlayerPhotoVariants(supabase, {
        clusterId: clusterId > 0 ? clusterId : null,
        playerId,
        memberPlayerIds,
      });
    } catch (_) {}

    const { error: storageError } = await supabase.storage
      .from('uploads')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype || 'image/jpeg',
        upsert: true,
        cacheControl: '3600',
      });
    if (storageError) {
      return res.status(500).json({ message: 'Errore upload foto', error: storageError.message });
    }
    const photoPath = `uploads/${storagePath}`;
    if (clusterId > 0 && memberPlayerIds.length > 0) {
      const ph = memberPlayerIds.map(() => '?').join(', ');
      await query(`UPDATE players SET photo_path = ? WHERE id IN (${ph})`, [photoPath, ...memberPlayerIds]);
    } else {
      await query(
        `UPDATE players SET photo_path = ? WHERE id = ? AND team_id IN (SELECT id FROM teams WHERE league_id = ?)`,
        [photoPath, playerId, leagueId]
      );
    }
    res.json({
      message: 'Foto giocatore aggiornata',
      photo_path: photoPath,
      cluster_id: clusterId > 0 ? clusterId : null,
      players_updated: clusterId > 0 ? memberPlayerIds.length : 1,
    });
  } catch (error) {
    console.error('Upload player photo error:', error);
    res.status(500).json({ message: 'Errore upload foto giocatore' });
  }
});

// DELETE /api/leagues/:id/teams/:teamId/players/:playerId/photo
router.delete('/:id/teams/:teamId/players/:playerId/photo', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const playerId = Number(req.params.playerId);
    if (!leagueId || !Number.isFinite(playerId) || playerId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    const supabase = getSupabaseStorageClient();

    let clusterId = 0;
    let memberPlayerIds = [playerId];
    try {
      const clusterRows = await query(
        `SELECT pc.id AS cluster_id
         FROM player_cluster_members pcm
         INNER JOIN player_clusters pc ON pc.id = pcm.cluster_id
         WHERE pcm.player_id = ?
           AND pc.status = 'approved'
         LIMIT 1`,
        [playerId]
      );
      clusterId = Number(clusterRows[0]?.cluster_id || 0);
      if (clusterId > 0) {
        const members = await query(
          `SELECT player_id FROM player_cluster_members WHERE cluster_id = ?`,
          [clusterId]
        );
        memberPlayerIds = (members || []).map((r) => Number(r.player_id)).filter((id) => id > 0);
      }
    } catch (_) {
      clusterId = 0;
      memberPlayerIds = [playerId];
    }

    if (supabase) {
      try {
        await removePlayerPhotoVariants(supabase, {
          clusterId: clusterId > 0 ? clusterId : null,
          playerId,
          memberPlayerIds,
        });
      } catch (_) {}
    }

    if (clusterId > 0 && memberPlayerIds.length > 0) {
      const ph = memberPlayerIds.map(() => '?').join(', ');
      await query(`UPDATE players SET photo_path = NULL WHERE id IN (${ph})`, memberPlayerIds);
    } else {
      await query(
        `UPDATE players SET photo_path = NULL WHERE id = ? AND team_id IN (SELECT id FROM teams WHERE league_id = ?)`,
        [playerId, leagueId]
      );
    }
    res.json({ message: 'Foto giocatore rimossa' });
  } catch (error) {
    console.error('Delete player photo error:', error);
    res.status(500).json({ message: 'Errore rimozione foto giocatore' });
  }
});

// PUT /api/leagues/:id/teams/:teamId
router.put('/:id/teams/:teamId', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const teamId = Number(req.params.teamId);
    const jerseyColor = String(req.body?.jersey_color || '').trim();
    if (!leagueId || !Number.isFinite(teamId) || teamId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    try {
      await query(
        `UPDATE teams SET jersey_color = ? WHERE id = ? AND league_id = ?`,
        [jerseyColor || '#667eea', teamId, leagueId]
      );
    } catch (_) {
      // Colonna opzionale mancante.
    }
    res.json({ message: 'Squadra aggiornata' });
  } catch (error) {
    console.error('Update team error:', error);
    res.status(500).json({ message: 'Errore aggiornamento squadra ufficiale' });
  }
});

// DELETE /api/leagues/:id/teams/:teamId
router.delete('/:id/teams/:teamId', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const teamId = Number(req.params.teamId);
    if (!leagueId || !Number.isFinite(teamId) || teamId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    await query(`DELETE FROM teams WHERE id = ? AND league_id = ?`, [teamId, leagueId]);
    res.json({ message: 'Squadra eliminata' });
  } catch (error) {
    console.error('Delete team error:', error);
    res.status(500).json({ message: 'Errore eliminazione squadra ufficiale' });
  }
});

// GET /api/leagues/:id/teams/:teamId/players
router.get('/:id/teams/:teamId/players', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const teamId = Number(req.params.teamId);
    if (!leagueId || !Number.isFinite(teamId) || teamId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    const rows = await query(
      `SELECT p.id, p.first_name, p.last_name, p.role,
              COALESCE(
                p.rating,
                CASE
                  WHEN (to_jsonb(p)->>'valutazione') ~ '^[0-9]+(\\.[0-9]+){0,1}$'
                    THEN (to_jsonb(p)->>'valutazione')::numeric
                  ELSE NULL
                END,
                CASE
                  WHEN (to_jsonb(p)->>'crediti') ~ '^[0-9]+(\\.[0-9]+){0,1}$'
                    THEN (to_jsonb(p)->>'crediti')::numeric
                  ELSE NULL
                END,
                CASE
                  WHEN (to_jsonb(p)->>'price') ~ '^[0-9]+(\\.[0-9]+){0,1}$'
                    THEN (to_jsonb(p)->>'price')::numeric
                  ELSE NULL
                END,
                0
              ) AS rating,
              COALESCE(
                CASE
                  WHEN (to_jsonb(p)->>'shirt_number') ~ '^[0-9]+$'
                    THEN (to_jsonb(p)->>'shirt_number')::int
                  ELSE NULL
                END,
                CASE
                  WHEN (to_jsonb(p)->>'numero_maglia') ~ '^[0-9]+$'
                    THEN (to_jsonb(p)->>'numero_maglia')::int
                  ELSE NULL
                END
              ) AS shirt_number,
              COALESCE(p.is_injured, 0)::int AS is_injured,
              p.injury_replacement_player_id,
              COALESCE(p.photo_path, '') AS photo_path,
              p.birth_year
       FROM players p
       JOIN teams t ON t.id = p.team_id
       WHERE p.team_id = ? AND t.league_id = ?
       ORDER BY p.role ASC, p.last_name ASC`,
      [teamId, leagueId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Get official team players error:', error);
    res.status(500).json({ message: 'Errore caricamento giocatori squadra ufficiale' });
  }
});

// POST /api/leagues/:id/teams/:teamId/players
router.post('/:id/teams/:teamId/players', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const teamId = Number(req.params.teamId);
    const firstName = String(req.body?.first_name || '').trim();
    const lastName = String(req.body?.last_name || '').trim();
    const role = String(req.body?.role || '').trim();
    const ratingRaw = req.body?.rating;
    const rating = ratingRaw == null || ratingRaw === '' ? 0 : Number(ratingRaw);
    const shirtNumber = req.body?.shirt_number === '' || req.body?.shirt_number == null
      ? null
      : Number(req.body.shirt_number);
    const birthYearParsed = parseBirthYearInput(req.body?.birth_year);
    if (birthYearParsed.error) {
      return res.status(400).json({ message: 'Anno di nascita non valido (usa 4 cifre, es. 1998)' });
    }
    const birthYear = birthYearParsed.value;
    if (!leagueId || !Number.isFinite(teamId) || !firstName || !lastName || !['P', 'D', 'C', 'A'].includes(role)) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    if (!Number.isFinite(rating) || rating < 0) {
      return res.status(400).json({ message: 'Valutazione non valida' });
    }
    let ins;
    try {
      try {
        ins = await query(
          `INSERT INTO players (team_id, first_name, last_name, role, rating, shirt_number, birth_year, is_injured, injury_replacement_player_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
           RETURNING id`,
          [teamId, firstName, lastName, role, rating, shirtNumber, birthYear]
        );
      } catch (_) {
        try {
          ins = await query(
            `INSERT INTO players (team_id, first_name, last_name, role, rating, numero_maglia, is_injured, injury_replacement_player_id)
             VALUES (?, ?, ?, ?, ?, ?, 0, NULL)
             RETURNING id`,
            [teamId, firstName, lastName, role, rating, shirtNumber]
          );
        } catch (_) {
          ins = await query(
            `INSERT INTO players (team_id, first_name, last_name, role, rating, is_injured, injury_replacement_player_id)
             VALUES (?, ?, ?, ?, ?, 0, NULL)
             RETURNING id`,
            [teamId, firstName, lastName, role, rating]
          );
        }
      }
    } catch (insertErr) {
      if (insertErr && insertErr.code === '23505') {
        await syncPlayersIdSequence();
        try {
          ins = await query(
            `INSERT INTO players (team_id, first_name, last_name, role, rating, shirt_number, is_injured, injury_replacement_player_id)
             VALUES (?, ?, ?, ?, ?, ?, 0, NULL)
             RETURNING id`,
            [teamId, firstName, lastName, role, rating, shirtNumber]
          );
        } catch (_) {
          try {
            ins = await query(
              `INSERT INTO players (team_id, first_name, last_name, role, rating, numero_maglia, is_injured, injury_replacement_player_id)
               VALUES (?, ?, ?, ?, ?, ?, 0, NULL)
               RETURNING id`,
              [teamId, firstName, lastName, role, rating, shirtNumber]
            );
          } catch (_) {
            ins = await query(
              `INSERT INTO players (team_id, first_name, last_name, role, rating, is_injured, injury_replacement_player_id)
               VALUES (?, ?, ?, ?, ?, 0, NULL)
               RETURNING id`,
              [teamId, firstName, lastName, role, rating]
            );
          }
        }
      } else {
        throw insertErr;
      }
    }
    const newPlayerId = Number(ins.insertId);
    if (birthYear != null && Number.isFinite(newPlayerId) && newPlayerId > 0) {
      await query(`UPDATE players SET birth_year = ? WHERE id = ?`, [birthYear, newPlayerId]).catch(() => {});
    }
    res.status(201).json({
      id: newPlayerId,
      first_name: firstName,
      last_name: lastName,
      role,
      rating,
      shirt_number: shirtNumber,
      birth_year: birthYear,
    });
  } catch (error) {
    console.error('Add player to team error:', error);
    res.status(500).json({ message: 'Errore creazione giocatore' });
  }
});

// PUT /api/leagues/:id/teams/:teamId/players/:playerId
router.put('/:id/teams/:teamId/players/:playerId', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const teamId = Number(req.params.teamId);
    const playerId = Number(req.params.playerId);
    const firstName = req.body?.first_name != null ? String(req.body.first_name).trim() : null;
    const lastName = req.body?.last_name != null ? String(req.body.last_name).trim() : null;
    const role = req.body?.role != null ? String(req.body.role).trim() : null;
    const rating = req.body?.rating == null || req.body?.rating === '' ? null : Number(req.body.rating);
    const isInjured = req.body?.is_injured != null ? Number(req.body.is_injured ? 1 : 0) : null;
    const injuryReplacementPlayerId =
      req.body?.injury_replacement_player_id == null || req.body?.injury_replacement_player_id === ''
        ? null
        : Number(req.body.injury_replacement_player_id);
    const shirtNumber = req.body?.shirt_number === '' || req.body?.shirt_number == null
      ? null
      : Number(req.body.shirt_number);
    let birthYear = undefined;
    if (req.body?.birth_year !== undefined) {
      const birthYearParsed = parseBirthYearInput(req.body.birth_year);
      if (birthYearParsed.error) {
        return res.status(400).json({ message: 'Anno di nascita non valido (usa 4 cifre, es. 1998)' });
      }
      birthYear = birthYearParsed.value;
    }
    if (!leagueId || !Number.isFinite(teamId) || !Number.isFinite(playerId)) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    if (injuryReplacementPlayerId != null && (!Number.isFinite(injuryReplacementPlayerId) || injuryReplacementPlayerId <= 0)) {
      return res.status(400).json({ message: 'Sostituto non valido' });
    }
    if (injuryReplacementPlayerId != null && injuryReplacementPlayerId === playerId) {
      return res.status(400).json({ message: 'Il sostituto deve essere diverso dal giocatore infortunato' });
    }
    if (rating != null && (!Number.isFinite(rating) || rating < 0)) {
      return res.status(400).json({ message: 'Valutazione non valida' });
    }
    if (injuryReplacementPlayerId != null) {
      const replacementRows = await query(
        `SELECT p.id
         FROM players p
         JOIN teams t ON t.id = p.team_id
         WHERE p.id = ? AND t.league_id = ?
         LIMIT 1`,
        [injuryReplacementPlayerId, leagueId]
      );
      if (!replacementRows[0]) {
        return res.status(400).json({ message: 'Il sostituto deve appartenere alla stessa lega' });
      }
    }

    const prevInjuryRows = await query(
      `SELECT COALESCE(p.is_injured, 0)::int AS is_injured, p.injury_replacement_player_id
       FROM players p
       JOIN teams t ON t.id = p.team_id
       WHERE p.id = ? AND t.league_id = ?
       LIMIT 1`,
      [playerId, leagueId]
    );
    const prevReplacementId = Number(prevInjuryRows[0]?.injury_replacement_player_id || 0);

    try {
      await query(
        `UPDATE players p
         SET first_name = COALESCE(?, first_name),
             last_name = COALESCE(?, last_name),
             role = COALESCE(?, role),
             rating = COALESCE(CAST(? AS numeric), rating),
             shirt_number = ?,
             is_injured = COALESCE(CAST(? AS integer), is_injured),
             injury_replacement_player_id = CASE
               WHEN COALESCE(CAST(? AS integer), is_injured) = 1 THEN CAST(? AS integer)
               ELSE NULL
             END
         FROM teams t
         WHERE p.id = ? AND p.team_id = ? AND t.id = p.team_id AND t.league_id = ?`,
        [
          firstName, lastName, role, rating, shirtNumber,
          Number.isFinite(isInjured) ? isInjured : null,
          Number.isFinite(isInjured) ? isInjured : null,
          injuryReplacementPlayerId,
          playerId, teamId, leagueId,
        ]
      );
    } catch (_) {
      try {
        await query(
          `UPDATE players p
           SET first_name = COALESCE(?, first_name),
               last_name = COALESCE(?, last_name),
               role = COALESCE(?, role),
               rating = COALESCE(CAST(? AS numeric), rating),
               numero_maglia = ?,
               is_injured = COALESCE(CAST(? AS integer), is_injured),
               injury_replacement_player_id = CASE
                 WHEN COALESCE(CAST(? AS integer), is_injured) = 1 THEN CAST(? AS integer)
                 ELSE NULL
               END
           FROM teams t
           WHERE p.id = ? AND p.team_id = ? AND t.id = p.team_id AND t.league_id = ?`,
          [
            firstName, lastName, role, rating, shirtNumber,
            Number.isFinite(isInjured) ? isInjured : null,
            Number.isFinite(isInjured) ? isInjured : null,
            injuryReplacementPlayerId,
            playerId, teamId, leagueId,
          ]
        );
      } catch (_) {
        await query(
          `UPDATE players p
           SET first_name = COALESCE(?, first_name),
               last_name = COALESCE(?, last_name),
               role = COALESCE(?, role),
               rating = COALESCE(CAST(? AS numeric), rating),
               is_injured = COALESCE(CAST(? AS integer), is_injured),
               injury_replacement_player_id = CASE
                 WHEN COALESCE(CAST(? AS integer), is_injured) = 1 THEN CAST(? AS integer)
                 ELSE NULL
               END
           FROM teams t
           WHERE p.id = ? AND p.team_id = ? AND t.id = p.team_id AND t.league_id = ?`,
          [
            firstName, lastName, role, rating,
            Number.isFinite(isInjured) ? isInjured : null,
            Number.isFinite(isInjured) ? isInjured : null,
            injuryReplacementPlayerId,
            playerId, teamId, leagueId,
          ]
        );
      }
    }
    if (birthYear !== undefined) {
      try {
        await query(`UPDATE players SET birth_year = ? WHERE id = ?`, [birthYear, playerId]);
      } catch (birthErr) {
        if (birthErr && birthErr.code === '42703') {
          return res.status(500).json({
            message: 'Colonna birth_year non trovata. Esegui la migrazione add_players_birth_year.sql su Supabase',
          });
        }
        throw birthErr;
      }
    }

    let cascadeResult = null;
    let revertResult = null;
    const shouldPropagateInjury =
      (Number.isFinite(isInjured) && isInjured === 1 && injuryReplacementPlayerId != null)
      || injuryReplacementPlayerId != null;
    if (shouldPropagateInjury) {
      cascadeResult = await applyInjuryReplacementAcrossLeagues(
        leagueId,
        playerId,
        injuryReplacementPlayerId
      );
    }

    const shouldRevertInjury =
      Number.isFinite(prevReplacementId) && prevReplacementId > 0
      && Number.isFinite(isInjured) && isInjured === 0;
    if (shouldRevertInjury) {
      revertResult = await revertInjuryReplacementAcrossLeagues(
        leagueId,
        playerId,
        prevReplacementId
      );
    }

    res.json({
      message: 'Giocatore aggiornato',
      lineups_updated: cascadeResult?.lineups_updated ?? revertResult?.lineups_updated ?? 0,
      lineup_matchdays: cascadeResult?.lineup_matchdays ?? revertResult?.lineup_matchdays ?? [],
      leagues_updated: cascadeResult?.linked_leagues ?? revertResult?.linked_leagues ?? [],
      lineups_reverted: revertResult?.lineups_updated ?? 0,
    });
  } catch (error) {
    console.error('Update player error:', error);
    const msg = String(error?.message || '').toLowerCase();
    if (msg.includes('is_injured') || msg.includes('injury_replacement_player_id')) {
      return res.status(500).json({
        message: 'Colonne infortunio non trovate nel DB. Esegui la migrazione db/injury_migration.sql',
      });
    }
    res.status(500).json({ message: 'Errore aggiornamento giocatore' });
  }
});

// DELETE /api/leagues/:id/teams/:teamId/players/:playerId
router.delete('/:id/teams/:teamId/players/:playerId', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const teamId = Number(req.params.teamId);
    const playerId = Number(req.params.playerId);
    if (!leagueId || !Number.isFinite(teamId) || !Number.isFinite(playerId)) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    await query(
      `DELETE FROM players p
       USING teams t
       WHERE p.id = ? AND p.team_id = ? AND t.id = p.team_id AND t.league_id = ?`,
      [playerId, teamId, leagueId]
    );
    res.json({ message: 'Giocatore eliminato' });
  } catch (error) {
    console.error('Delete player error:', error);
    res.status(500).json({ message: 'Errore eliminazione giocatore' });
  }
});

// GET /api/leagues/:id/players/options
router.get('/:id/players/options', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const sourceLeagueId = await getEffectiveLeagueId(leagueId);
    const rows = await query(
      `SELECT p.id, p.first_name, p.last_name, p.role, t.id AS team_id, t.name AS team_name,
              COALESCE(p.is_injured, 0)::int AS is_injured,
              p.injury_replacement_player_id
       FROM players p
       JOIN teams t ON t.id = p.team_id
       WHERE t.league_id = ?
       ORDER BY p.last_name ASC, p.first_name ASC`,
      [sourceLeagueId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Get player options error:', error);
    res.status(500).json({ message: 'Errore caricamento elenco giocatori' });
  }
});

// POST /api/leagues/:id/injuries/:playerId/apply-replacement
router.post('/:id/injuries/:playerId/apply-replacement', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const playerId = Number(req.params.playerId);
    const currentUserId = Number(req.user.userId);
    const replacementPlayerId = Number(req.body?.replacement_player_id);
    if (!leagueId || !Number.isFinite(playerId) || playerId <= 0 || !Number.isFinite(replacementPlayerId) || replacementPlayerId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    if (playerId === replacementPlayerId) {
      return res.status(400).json({ message: 'Il sostituto deve essere diverso dal giocatore infortunato' });
    }

    const roleRows = await query(
      `SELECT role FROM league_members WHERE league_id = ? AND user_id = ? LIMIT 1`,
      [leagueId, currentUserId]
    );
    if (!roleRows[0] || String(roleRows[0].role) !== 'admin') {
      return res.status(403).json({ message: 'Solo gli amministratori possono applicare la sostituzione infortunio' });
    }

    const sourceLeagueId = await getEffectiveLeagueId(leagueId);

    const targetRows = await query(
      `SELECT p.id
       FROM players p
       JOIN teams t ON t.id = p.team_id
       WHERE p.id = ? AND t.league_id = ?
       LIMIT 1`,
      [playerId, sourceLeagueId]
    );
    if (!targetRows[0]) return res.status(404).json({ message: 'Giocatore infortunato non trovato in lega' });

    const replacementRows = await query(
      `SELECT p.id
       FROM players p
       JOIN teams t ON t.id = p.team_id
       WHERE p.id = ? AND t.league_id = ?
       LIMIT 1`,
      [replacementPlayerId, sourceLeagueId]
    );
    if (!replacementRows[0]) return res.status(400).json({ message: 'Sostituto non trovato in lega' });

    const cascadeResult = await applyInjuryReplacementAcrossLeagues(
      leagueId,
      playerId,
      replacementPlayerId
    );

    res.json({
      message: 'Sostituzione infortunio applicata',
      affected_owners: cascadeResult.affected_owners,
      replacements_added: cascadeResult.replacements_added,
      already_had_replacement: cascadeResult.already_had_replacement,
      lineups_updated: cascadeResult.lineups_updated,
      lineup_matchdays: cascadeResult.lineup_matchdays,
      leagues_updated: cascadeResult.linked_leagues,
    });
  } catch (error) {
    console.error('Apply injury replacement error:', error);
    res.status(500).json({ message: 'Errore applicazione sostituzione infortunio' });
  }
});

// GET /api/leagues/:id/standings/full - placeholder minimo
router.get('/:id/standings/full', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    await ensureMatchdaysGhostSchema();
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);

    try {
      const rows = await query(
        `SELECT mr.user_id AS id, u.username,
                COALESCE(ub.team_name, u.username) AS team_name,
                COALESCE(ub.coach_name, '') AS coach_name,
                COALESCE(ub.team_logo, 'default_1') AS team_logo,
                SUM(mr.punteggio)::float AS punteggio,
                AVG(mr.punteggio)::float AS media_punti
         FROM matchday_results mr
         ${MR_EXCLUDE_GHOST_JOIN}
         JOIN users u ON u.id = mr.user_id
         LEFT JOIN user_budget ub ON ub.user_id = mr.user_id AND ub.league_id = mr.league_id
         WHERE mr.league_id = ?
         GROUP BY mr.user_id, u.username, ub.team_name, ub.coach_name, ub.team_logo
         ORDER BY punteggio DESC,
                  LOWER(COALESCE(ub.team_name, u.username)) ASC,
                  LOWER(u.username) ASC`,
        [effectiveLeagueId, leagueId]
      );
      return res.json(rows);
    } catch (_) {
      // Fallback senza risultati calcolati.
      const rows = await query(
        `SELECT lm.user_id AS id, u.username, COALESCE(ub.team_name, u.username) AS team_name,
                COALESCE(ub.coach_name, '') AS coach_name,
                COALESCE(ub.team_logo, 'default_1') AS team_logo,
                0::float AS punteggio, 0::float AS media_punti
         FROM league_members lm
         JOIN users u ON u.id = lm.user_id
         LEFT JOIN user_budget ub ON ub.user_id = lm.user_id AND ub.league_id = lm.league_id
         WHERE lm.league_id = ?
         ORDER BY u.username ASC`,
        [leagueId]
      );
      return res.json(rows);
    }
  } catch (error) {
    console.error('Standings full error:', error);
    res.status(500).json({ message: 'Errore classifica generale' });
  }
});

const LEAGUE_STATS_BONUS_SCORE_SQL = `
  pr.rating
  + CASE WHEN COALESCE(bs.enable_goal, 0) = 1 THEN COALESCE(bs.bonus_goal, 0) * COALESCE(pr.goals, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_assist, 0) = 1 THEN COALESCE(bs.bonus_assist, 0) * COALESCE(pr.assists, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_yellow_card, 0) = 1 THEN COALESCE(bs.malus_yellow_card, 0) * COALESCE(pr.yellow_cards, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_red_card, 0) = 1 THEN COALESCE(bs.malus_red_card, 0) * COALESCE(pr.red_cards, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_goals_conceded, 0) = 1 THEN COALESCE(bs.malus_goals_conceded, 0) * COALESCE(pr.goals_conceded, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_own_goal, 0) = 1 THEN COALESCE(bs.malus_own_goal, 0) * COALESCE(pr.own_goals, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_penalty_missed, 0) = 1 THEN COALESCE(bs.malus_penalty_missed, 0) * COALESCE(pr.penalty_missed, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_penalty_saved, 0) = 1 THEN COALESCE(bs.bonus_penalty_saved, 0) * COALESCE(pr.penalty_saved, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_clean_sheet, 0) = 1 THEN COALESCE(bs.bonus_clean_sheet, 0) * COALESCE(pr.clean_sheet, 0) ELSE 0 END
`;

/** Proprietari contati solo nella lega richiesta (no cluster/gruppi ufficiali, no altre leghe collegate). */
const LEAGUE_PLAYER_PURCHASE_COUNT_SQL = `
  (
    SELECT COUNT(DISTINCT up.user_id)::int
    FROM user_players up
    INNER JOIN league_members lm
      ON lm.user_id = up.user_id
     AND lm.league_id = ?
    WHERE up.player_id = p.id
      AND up.league_id = ?
      AND ${injuryReplacementExclusionSql('up')}
  )
`;

function mapLeagueStatsPlayerRow(r) {
  return {
    player_id: Number(r.player_id || r.id || 0),
    first_name: r.first_name || '',
    last_name: r.last_name || '',
    role: r.role || '',
    team_id: Number(r.team_id || 0) || null,
    team_name: r.team_name || '',
    team_logo_path: r.team_logo_path || '',
    photo_path: r.photo_path || '',
    purchase_count: Number(r.purchase_count || 0),
    giornata: Number(r.giornata || 0) || null,
    fantavoto: Number(Number(r.fantavoto || 0).toFixed(2)),
  };
}

function mapLeagueStatsTeamRow(r) {
  return {
    user_id: Number(r.user_id || 0),
    team_name: r.team_name || '',
    team_logo: r.team_logo || 'default_1',
    giornata: Number(r.giornata || 0),
    total_fantavoto: Number(Number(r.total_fantavoto || 0).toFixed(2)),
  };
}

/** Nel rapporto migliori acquisti il costo entra come √costo per attenuarne l'impatto. */
function leagueStatsBestPurchaseDivisor(cost) {
  const c = Number(cost || 0);
  return c > 0 ? Math.sqrt(c) : 0;
}

function mapLeagueStatsBestPurchaseRow(r) {
  const base = mapLeagueStatsPlayerRow(r);
  const cost = Number(r.cost || 0);
  const totalFantavotoSum = Number(r.total_fantavoto_sum || 0);
  const divisor = leagueStatsBestPurchaseDivisor(cost);
  const valueRatio = divisor > 0 ? totalFantavotoSum / divisor : 0;
  return {
    ...base,
    cost: Number(cost.toFixed(2)),
    total_fantavoto_sum: Number(totalFantavotoSum.toFixed(2)),
    value_ratio: Number(valueRatio.toFixed(2)),
  };
}

const LEAGUE_STATS_TEAM_FIELDS_SQL = `
  t.id AS team_id,
  COALESCE(t.name, '') AS team_name,
  COALESCE(t.logo_path, '') AS team_logo_path
`;

async function fetchOfficialTeamsForStats(effectiveLeagueId) {
  try {
    const rows = await query(
      `SELECT t.id, t.name,
              COALESCE(t.jersey_color, '#667eea') AS jersey_color,
              COALESCE(t.logo_path, '') AS logo_path
       FROM teams t
       WHERE t.league_id = ?
       ORDER BY LOWER(t.name) ASC, t.id ASC`,
      [effectiveLeagueId]
    );
    return (rows || []).map((r) => ({
      id: Number(r.id),
      name: r.name || '',
      jersey_color: r.jersey_color || '#667eea',
      logo_path: r.logo_path || '',
    }));
  } catch (_) {
    const rows = await query(
      `SELECT t.id, t.name
       FROM teams t
       WHERE t.league_id = ?
       ORDER BY LOWER(t.name) ASC, t.id ASC`,
      [effectiveLeagueId]
    );
    return (rows || []).map((r) => ({
      id: Number(r.id),
      name: r.name || '',
      jersey_color: '#667eea',
      logo_path: '',
    }));
  }
}

const LEAGUE_STAT_RANKING_TYPES = new Set([
  'most_purchased',
  'least_purchased',
  'top_fantavoti',
  'bottom_fantavoti',
  'best_purchases',
]);

function sqlLimitClause(limit) {
  if (limit == null) return '';
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `LIMIT ${Math.floor(n)}`;
}

async function assertLeagueStatisticsAccess(leagueId, actorId) {
  const roleRows = await query(
    `SELECT role FROM league_members WHERE league_id = ? AND user_id = ? LIMIT 1`,
    [leagueId, actorId]
  );
  const role = String(roleRows[0]?.role || '');
  const canView = role === 'admin' || role === 'pagellatore';
  if (!canView) {
    const err = new Error('Solo amministratori e pagellatori possono vedere le statistiche della lega');
    err.status = 403;
    throw err;
  }
}

async function fetchLeagueStatRanking(type, leagueId, effectiveLeagueId, limit = null) {
  const limitSql = sqlLimitClause(limit);
  switch (type) {
    case 'most_purchased':
      return query(
        `SELECT p.id AS player_id, p.first_name, p.last_name, p.role,
                COALESCE(p.photo_path, '') AS photo_path,
                ${LEAGUE_STATS_TEAM_FIELDS_SQL},
                ${LEAGUE_PLAYER_PURCHASE_COUNT_SQL} AS purchase_count
         FROM players p
         JOIN teams t ON t.id = p.team_id AND t.league_id = ?
         GROUP BY p.id, p.first_name, p.last_name, p.role, p.photo_path, t.id, t.name, t.logo_path
         ORDER BY purchase_count DESC, p.last_name ASC, p.first_name ASC
         ${limitSql}`,
        [leagueId, leagueId, effectiveLeagueId]
      );
    case 'least_purchased':
      return query(
        `SELECT p.id AS player_id, p.first_name, p.last_name, p.role,
                COALESCE(p.photo_path, '') AS photo_path,
                ${LEAGUE_STATS_TEAM_FIELDS_SQL},
                ${LEAGUE_PLAYER_PURCHASE_COUNT_SQL} AS purchase_count
         FROM players p
         JOIN teams t ON t.id = p.team_id AND t.league_id = ?
         GROUP BY p.id, p.first_name, p.last_name, p.role, p.photo_path, t.id, t.name, t.logo_path
         ORDER BY purchase_count ASC, p.last_name ASC, p.first_name ASC
         ${limitSql}`,
        [leagueId, leagueId, effectiveLeagueId]
      );
    case 'top_fantavoti':
      return query(
        `SELECT pr.giornata, pr.player_id,
                p.first_name, p.last_name, p.role,
                COALESCE(p.photo_path, '') AS photo_path,
                ${LEAGUE_STATS_TEAM_FIELDS_SQL},
                (${LEAGUE_STATS_BONUS_SCORE_SQL})::float AS fantavoto
         FROM player_ratings pr
         JOIN players p ON p.id = pr.player_id
         LEFT JOIN teams t ON t.id = p.team_id
         LEFT JOIN league_bonus_settings bs ON bs.league_id = ?
         WHERE pr.league_id = ?
           AND pr.rating > 0
         ORDER BY fantavoto DESC, pr.giornata ASC, p.last_name ASC
         ${limitSql}`,
        [leagueId, effectiveLeagueId]
      ).catch(() => []);
    case 'bottom_fantavoti':
      return query(
        `SELECT pr.giornata, pr.player_id,
                p.first_name, p.last_name, p.role,
                COALESCE(p.photo_path, '') AS photo_path,
                ${LEAGUE_STATS_TEAM_FIELDS_SQL},
                (${LEAGUE_STATS_BONUS_SCORE_SQL})::float AS fantavoto
         FROM player_ratings pr
         JOIN players p ON p.id = pr.player_id
         LEFT JOIN teams t ON t.id = p.team_id
         LEFT JOIN league_bonus_settings bs ON bs.league_id = ?
         WHERE pr.league_id = ?
           AND pr.rating > 0
         ORDER BY fantavoto ASC, pr.giornata ASC, p.last_name ASC
         ${limitSql}`,
        [leagueId, effectiveLeagueId]
      ).catch(() => []);
    case 'best_purchases':
      return query(
        `WITH purchased_players AS (
           SELECT DISTINCT up.player_id
           FROM user_players up
           INNER JOIN league_members lm
             ON lm.user_id = up.user_id
            AND lm.league_id = ?
           WHERE up.league_id = ?
             AND ${injuryReplacementExclusionSql('up')}
         ),
         player_totals AS (
           SELECT pr.player_id,
                  SUM((${LEAGUE_STATS_BONUS_SCORE_SQL}))::float AS total_fantavoto_sum
           FROM player_ratings pr
           LEFT JOIN league_bonus_settings bs ON bs.league_id = ?
           WHERE pr.league_id = ?
             AND pr.rating > 0
           GROUP BY pr.player_id
         )
         SELECT p.id AS player_id, p.first_name, p.last_name, p.role,
                COALESCE(p.photo_path, '') AS photo_path,
                ${LEAGUE_STATS_TEAM_FIELDS_SQL},
                p.rating::float AS cost,
                pt.total_fantavoto_sum,
                (pt.total_fantavoto_sum / NULLIF(SQRT(p.rating), 0))::float AS value_ratio
         FROM purchased_players pp
         JOIN players p ON p.id = pp.player_id
         JOIN teams t ON t.id = p.team_id AND t.league_id = ?
         JOIN player_totals pt ON pt.player_id = p.id
         WHERE p.rating > 0
           AND pt.total_fantavoto_sum > 0
         ORDER BY pt.total_fantavoto_sum DESC, p.last_name ASC, p.first_name ASC
         ${limitSql}`,
        [leagueId, leagueId, leagueId, effectiveLeagueId, effectiveLeagueId]
      ).catch(() => []);
    default:
      return null;
  }
}

function mapLeagueStatRankingRows(type, rows) {
  if (type === 'best_purchases') {
    return (rows || []).map(mapLeagueStatsBestPurchaseRow);
  }
  return (rows || []).map(mapLeagueStatsPlayerRow);
}

// GET /api/leagues/:id/statistics/ranking/:type - classifica completa (lazy, admin/pagellatore)
router.get('/:id/statistics/ranking/:type', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const type = String(req.params.type || '').trim();
    const actorId = Number(req.user.userId);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    if (!LEAGUE_STAT_RANKING_TYPES.has(type)) {
      return res.status(400).json({ message: 'Tipo classifica non valido' });
    }

    await assertLeagueStatisticsAccess(leagueId, actorId);
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    const rows = await fetchLeagueStatRanking(type, leagueId, effectiveLeagueId, null);
    if (rows == null) return res.status(400).json({ message: 'Tipo classifica non valido' });

    return res.json({
      type,
      items: mapLeagueStatRankingRows(type, rows),
    });
  } catch (error) {
    if (error?.status === 403) {
      return res.status(403).json({ message: error.message });
    }
    console.error('League statistics ranking error:', error);
    return res.status(500).json({ message: 'Errore caricamento classifica statistiche' });
  }
});

// GET /api/leagues/:id/statistics - statistiche lega (admin e pagellatore)
router.get('/:id/statistics', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const actorId = Number(req.user.userId);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });

    await assertLeagueStatisticsAccess(leagueId, actorId);
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    const previewLimit = 10;

    const [
      mostPurchasedRows,
      leastPurchasedRows,
      bestTeamRows,
      worstTeamRows,
      topFantavotoRows,
      bottomFantavotoRows,
      bestPurchaseRows,
      officialTeams,
    ] = await Promise.all([
      fetchLeagueStatRanking('most_purchased', leagueId, effectiveLeagueId, previewLimit),
      fetchLeagueStatRanking('least_purchased', leagueId, effectiveLeagueId, previewLimit),
      query(
        `SELECT mr.giornata, mr.user_id, mr.punteggio::float AS total_fantavoto,
                COALESCE(ub.team_name, u.username) AS team_name,
                COALESCE(ub.team_logo, 'default_1') AS team_logo
         FROM matchday_results mr
         ${MR_EXCLUDE_GHOST_JOIN}
         JOIN users u ON u.id = mr.user_id
         LEFT JOIN user_budget ub ON ub.user_id = mr.user_id AND ub.league_id = mr.league_id
         WHERE mr.league_id = ?
         ORDER BY mr.punteggio DESC, mr.giornata ASC,
                  LOWER(COALESCE(ub.team_name, u.username)) ASC
         LIMIT 1`,
        [effectiveLeagueId, leagueId]
      ).catch(() => []),
      query(
        `SELECT mr.giornata, mr.user_id, mr.punteggio::float AS total_fantavoto,
                COALESCE(ub.team_name, u.username) AS team_name,
                COALESCE(ub.team_logo, 'default_1') AS team_logo
         FROM matchday_results mr
         ${MR_EXCLUDE_GHOST_JOIN}
         JOIN users u ON u.id = mr.user_id
         LEFT JOIN user_budget ub ON ub.user_id = mr.user_id AND ub.league_id = mr.league_id
         WHERE mr.league_id = ?
           AND mr.punteggio > 0
         ORDER BY mr.punteggio ASC, mr.giornata ASC,
                  LOWER(COALESCE(ub.team_name, u.username)) ASC
         LIMIT 1`,
        [effectiveLeagueId, leagueId]
      ).catch(() => []),
      fetchLeagueStatRanking('top_fantavoti', leagueId, effectiveLeagueId, previewLimit),
      fetchLeagueStatRanking('bottom_fantavoti', leagueId, effectiveLeagueId, previewLimit),
      fetchLeagueStatRanking('best_purchases', leagueId, effectiveLeagueId, previewLimit),
      fetchOfficialTeamsForStats(effectiveLeagueId),
    ]);

    return res.json({
      official_teams: officialTeams || [],
      most_purchased: mapLeagueStatRankingRows('most_purchased', mostPurchasedRows),
      least_purchased: mapLeagueStatRankingRows('least_purchased', leastPurchasedRows),
      best_team_matchday: bestTeamRows[0] ? mapLeagueStatsTeamRow(bestTeamRows[0]) : null,
      worst_team_matchday: worstTeamRows[0] ? mapLeagueStatsTeamRow(worstTeamRows[0]) : null,
      top_fantavoti: mapLeagueStatRankingRows('top_fantavoti', topFantavotoRows),
      bottom_fantavoti: mapLeagueStatRankingRows('bottom_fantavoti', bottomFantavotoRows),
      best_purchases: mapLeagueStatRankingRows('best_purchases', bestPurchaseRows),
    });
  } catch (error) {
    if (error?.status === 403) {
      return res.status(403).json({ message: error.message });
    }
    console.error('League statistics error:', error);
    return res.status(500).json({ message: 'Errore caricamento statistiche lega' });
  }
});

// GET /api/leagues/:id/user-stats - placeholder minimo
router.get('/:id/user-stats', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const userId = Number(req.user.userId);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    await ensureMatchdaysGhostSchema();
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    try {
      const rows = await query(
        `SELECT mr.giornata, mr.punteggio
         FROM matchday_results mr
         ${MR_EXCLUDE_GHOST_JOIN}
         WHERE mr.league_id = ? AND mr.user_id = ?
         ORDER BY mr.giornata ASC`,
        [effectiveLeagueId, leagueId, userId]
      );
      const scores = rows.map((r) => ({
        giornata: Number(r.giornata || 0),
        punteggio: Number(r.punteggio || 0),
      }));
      const numericScores = scores.map((s) => Number(s.punteggio || 0));
      return res.json({
        scores,
        average: numericScores.length
          ? numericScores.reduce((a, b) => a + b, 0) / numericScores.length
          : 0,
      });
    } catch (_) {
      return res.json(null);
    }
  } catch (error) {
    console.error('User stats error:', error);
    res.status(500).json({ message: 'Errore statistiche utente' });
  }
});

// GET /api/leagues/:id/standings/matchday/:giornata/formation/:userId
router.get('/:id/standings/matchday/:giornata/formation/:userId', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const giornata = Number(req.params.giornata);
    const targetUserId = Number(req.params.userId);
    if (!leagueId || !Number.isFinite(giornata) || !Number.isFinite(targetUserId)) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }

    const [bonusSettings, injuryMap, recoverRows, calcRows, lineRows] = await Promise.all([
      getLeagueBonusSettings(leagueId),
      getInjuryReplacementMap(leagueId),
      query(
        `SELECT COALESCE(recover_previous_lineup_if_missing, 1) AS recover_previous_lineup_if_missing,
                COALESCE(auto_lineup_mode, 0) AS auto_lineup_mode,
                COALESCE(enable_sv_fallback_vote, 0) AS enable_sv_fallback_vote,
                COALESCE(numero_titolari, 10) AS numero_titolari
         FROM leagues WHERE id = ? LIMIT 1`,
        [leagueId]
      ).catch(() => []),
      query(
        `SELECT COUNT(*)::int AS c
         FROM matchday_results WHERE league_id = ? AND giornata = ?`,
        [leagueId, giornata]
      ).catch(() => [{ c: 0 }]),
      query(
        `SELECT titolari, panchina, COALESCE(modulo, '') AS modulo
         FROM user_lineups WHERE league_id = ? AND giornata = ? AND user_id = ? LIMIT 1`,
        [leagueId, giornata, targetUserId]
      ),
    ]);
    const recoverPrevious = Number(recoverRows[0]?.recover_previous_lineup_if_missing ?? 1) === 1;
    const autoLineupMode = Number(recoverRows[0]?.auto_lineup_mode || 0) === 1;
    const enableSvFallbackVote = Number(recoverRows[0]?.enable_sv_fallback_vote ?? 0) === 1;
    const numeroTitolari = Math.max(1, Number(recoverRows[0]?.numero_titolari || 10));
    const isCalculated = Number(calcRows[0]?.c || 0) > 0;
    const canApplyInjurySwap = await canMutateLineupForInjury(leagueId, giornata);
    const injuryMapForLineup = canApplyInjurySwap ? injuryMap : {};
    let playerIds = applyInjuryMap(parseIdsArray(lineRows[0]?.titolari), injuryMapForLineup).slice(0, numeroTitolari);
    let panchina = applyInjuryMap(parseIdsArray(lineRows[0]?.panchina), injuryMapForLineup);
    let modulo = lineRows[0]?.modulo || '';
    const hasDirectLineupForMatchday = !!lineRows[0] && playerIds.length > 0;
    let formationRecovered = false;
    let formationRecoveryKind = null;

    if (autoLineupMode) {
      const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
      const vRowsAuto = await query(
        `SELECT player_id, rating, goals, assists, yellow_cards, red_cards,
                goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet,
                pallone_fuori, briso, no_divisa
         FROM player_ratings
         WHERE league_id = ? AND giornata = ?`,
        [effectiveLeagueId, giornata]
      ).catch(() => []);
      const votesByPlayer = {};
      vRowsAuto.forEach((r) => { votesByPlayer[Number(r.player_id)] = r; });
      const generated = await buildAutoLineupFromVotes({
        leagueId,
        userId: targetUserId,
        numeroTitolari,
        votesByPlayer,
        bonusSettings,
        use6Politico: false,
        computeBonusTotal,
      });
      if (generated && generated.titolari.length > 0) {
        playerIds = applyInjuryMap(generated.titolari, injuryMapForLineup).slice(0, numeroTitolari);
        panchina = applyInjuryMap(generated.panchina, injuryMapForLineup);
        modulo = generated.modulo || modulo;
        formationRecovered = true;
        formationRecoveryKind = 'auto_matchday_votes';
      }
    } else if (playerIds.length < 1) {
      const resolved = await resolveUserLineup(leagueId, targetUserId, giornata, numeroTitolari, {
        recoverPrevious,
        injuryMap: injuryMapForLineup,
        applyInjury: applyInjuryToLineup,
      });
      playerIds = resolved.titolari;
      panchina = resolved.panchina;
      if (resolved.modulo) modulo = resolved.modulo;
      if (resolved.formationRecovered) {
        formationRecovered = true;
        formationRecoveryKind = resolved.formationRecoveryKind;
      }
    }

    // Giornate calcolate prima del persist automatico: mostra almeno i giocatori che hanno fatto punti.
    if (!autoLineupMode && playerIds.length < 1 && isCalculated) {
      const psFallback = await query(
        `SELECT player_id
         FROM matchday_player_scores
         WHERE league_id = ? AND giornata = ? AND user_id = ?
         ORDER BY total_score DESC, player_id ASC`,
        [leagueId, giornata, targetUserId]
      ).catch(() => []);
      const fromScores = psFallback
        .map((r) => Number(r.player_id))
        .filter((id) => Number.isFinite(id) && id > 0);
      if (fromScores.length > 0) {
        playerIds = fromScores.slice(0, numeroTitolari);
        formationRecovered = true;
        formationRecoveryKind = formationRecoveryKind || 'from_calculated_scores';
      }
    }

    if (hasDirectLineupForMatchday && recoverPrevious && isCalculated && playerIds.length < 1) {
      try {
        const prevCountRows = await query(
          `SELECT COUNT(*)::int AS c
           FROM user_lineups
           WHERE league_id = ? AND user_id = ? AND giornata < ?`,
          [leagueId, targetUserId, giornata]
        );
        const hadPreviousLineups = Number(prevCountRows[0]?.c || 0) > 0;
        if (!hadPreviousLineups) {
          // Riga su user_lineups per questa giornata ma titolari vuoti, nessuno storico precedente:
          // tipicamente formazione generata dal sistema per il calcolo.
          formationRecovered = true;
          formationRecoveryKind = 'system_first_on_calculated';
        }
      } catch (_) {
        // Ignora errori di detection.
      }
    }

    const formationDebug = {
      has_lineup_row_this_matchday: hasDirectLineupForMatchday,
      recover_previous_lineup_if_missing: recoverPrevious,
      is_matchday_calculated: isCalculated,
      formation_recovery_kind: formationRecoveryKind,
    };

    if (playerIds.length < 1) {
      let squadPlayersCount = 0;
      let requiredTitolari = 10;
      let firstSavedLineupGiornata = null;
      try {
        const [squadRows, titRows, lineupMetaRows] = await Promise.all([
          query(
            `SELECT COUNT(*)::int AS c FROM user_players WHERE user_id = ? AND league_id = ?`,
            [targetUserId, leagueId]
          ),
          query(
            `SELECT COALESCE(numero_titolari, 10) AS numero_titolari FROM leagues WHERE id = ? LIMIT 1`,
            [leagueId]
          ),
          query(
            `SELECT giornata, titolari FROM user_lineups WHERE league_id = ? AND user_id = ? ORDER BY giornata ASC`,
            [leagueId, targetUserId]
          ),
        ]);
        squadPlayersCount = Number(squadRows[0]?.c || 0);
        requiredTitolari = Math.max(1, Number(titRows[0]?.numero_titolari || 10));
        for (const row of lineupMetaRows || []) {
          if (parseIdsArray(row?.titolari).length > 0) {
            const g = Number(row.giornata);
            if (Number.isFinite(g)) {
              firstSavedLineupGiornata = g;
              break;
            }
          }
        }
      } catch (_) {
        // Campi opzionali per messaggistica client: ignora errori.
      }
      return res.json({
        formation: [],
        formation_recovered: formationRecovered,
        is_matchday_calculated: isCalculated,
        ...formationDebug,
        squad_players_count: squadPlayersCount,
        required_titolari: requiredTitolari,
        first_saved_lineup_giornata: firstSavedLineupGiornata,
        bonus_enabled: Number(bonusSettings.enable_bonus_malus) === 1,
        bonus_settings: bonusSettings,
      });
    }

    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    const leagueScopeIds = [...new Set([Number(leagueId), Number(effectiveLeagueId)].filter((x) => Number.isFinite(x) && x > 0))];
    const inParams = playerIds.map(() => '?').join(',');
    const leagueScopeParams = leagueScopeIds.map(() => '?').join(',');
    const [pRows, scoreRows, vRows, rosterMetaRows] = await Promise.all([
      query(
        `SELECT p.id, p.first_name, p.last_name, p.role,
                COALESCE(p.photo_path, '') AS photo_path,
                COALESCE(t.name, '') AS team_name
         FROM players p
         LEFT JOIN teams t ON t.id = p.team_id
         WHERE p.id IN (${inParams})`,
        playerIds
      ),
      query(
        `SELECT player_id, rating, goals, assists, yellow_cards, red_cards,
                goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet,
                pallone_fuori, briso, no_divisa,
                total_score
         FROM matchday_player_scores
         WHERE league_id = ? AND giornata = ? AND user_id = ?`,
        [leagueId, giornata, targetUserId]
      ).catch(() => []),
      query(
        `SELECT player_id, rating, goals, assists, yellow_cards, red_cards,
                goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet,
                pallone_fuori, briso, no_divisa
         FROM player_ratings
         WHERE league_id = ? AND giornata = ?`,
        [effectiveLeagueId, giornata]
      ).catch(() => []),
      query(
        `SELECT p.id, p.role, p.team_id, p.last_name
         FROM players p
         WHERE p.team_id IN (SELECT id FROM teams WHERE league_id IN (${leagueScopeParams}))`,
        leagueScopeIds
      ),
    ]);
    const byId = {};
    pRows.forEach((p) => { byId[Number(p.id)] = p; });
    const playersById = {};
    rosterMetaRows.forEach((p) => { playersById[Number(p.id)] = p; });
    const leagueSurnameCounts = {};
    (rosterMetaRows || []).forEach((p) => {
      const surname = String(p?.last_name || '').trim().toLocaleLowerCase('it-IT');
      if (!surname) return;
      leagueSurnameCounts[surname] = Number(leagueSurnameCounts[surname] || 0) + 1;
    });
    const scoreMap = Object.fromEntries(scoreRows.map((s) => [Number(s.player_id), s]));
    const votesByPlayer = Object.fromEntries(vRows.map((v) => [Number(v.player_id), v]));

    const scored = scoreResolvedLineup({
      titolari: playerIds,
      panchina,
      votesByPlayer,
      playersById,
      enableSvFallbackVote,
      use6Politico: false,
      bonusSettings,
      computeBonusTotal,
    });
    const slotByTit = Object.fromEntries(
      scored.formationSlots.map((s) => [Number(s.titolare_id), s])
    );

    const subIdsToLoad = [
      ...new Set(
        scored.formationSlots
          .map((s) => Number(s.substitute_id))
          .filter((id) => Number.isFinite(id) && id > 0 && !playerIds.includes(id))
      ),
    ];
    if (subIdsToLoad.length > 0) {
      const subInParams = subIdsToLoad.map(() => '?').join(',');
      const subRows = await query(
        `SELECT p.id, p.first_name, p.last_name, p.role,
                COALESCE(p.photo_path, '') AS photo_path,
                COALESCE(t.name, '') AS team_name
         FROM players p
         LEFT JOIN teams t ON t.id = p.team_id
         WHERE p.id IN (${subInParams})`,
        subIdsToLoad
      );
      subRows.forEach((row) => { byId[Number(row.id)] = row; });
    }

    const formation = playerIds.map((pid) => {
      const p = byId[Number(pid)];
      if (!p) return null;
      const slot = slotByTit[Number(pid)] || {};
      const subId = slot.substitute_id ? Number(slot.substitute_id) : null;
      const subP = subId ? byId[subId] : null;
      const visual = subP || p;
      const visualSurnameKey = String(visual?.last_name || '').trim().toLocaleLowerCase('it-IT');
      const sameSurnameInLeague = !!(visualSurnameKey && Number(leagueSurnameCounts[visualSurnameKey] || 0) > 1);
      // Voto reale mostrato: del sub entrato se sostituito, altrimenti del titolare (S.V. = 0, aiuto 4.5 solo nel fantavoto).
      const rating = subId
        ? normalizeVoteRating(slot.rating ?? 0)
        : normalizeVoteRating(slot.display_rating ?? 0);
      const final_rating = Number(slot.total_score ?? 0);
      return {
        id: Number(p.id),
        titolare_id: Number(p.id),
        titolare_first_name: p.first_name,
        titolare_last_name: p.last_name,
        first_name: visual.first_name,
        last_name: visual.last_name,
        role: p.role,
        photo_path: visual.photo_path || '',
        team_name: visual.team_name || '',
        rating,
        final_rating,
        goals: Number(slot.goals ?? 0),
        assists: Number(slot.assists ?? 0),
        yellow_cards: Number(slot.yellow_cards ?? 0),
        red_cards: Number(slot.red_cards ?? 0),
        goals_conceded: Number(slot.goals_conceded ?? 0),
        own_goals: Number(slot.own_goals ?? 0),
        penalty_missed: Number(slot.penalty_missed ?? 0),
        penalty_saved: Number(slot.penalty_saved ?? 0),
        clean_sheet: Number(slot.clean_sheet ?? 0),
        pallone_fuori: Number(slot.pallone_fuori ?? 0),
        briso: Number(slot.briso ?? 0),
        no_divisa: Number(slot.no_divisa ?? 0),
        substitute_id: subId || null,
        substitute_first_name: subP?.first_name || null,
        substitute_last_name: subP?.last_name || null,
        same_surname_in_league: sameSurnameInLeague,
        pending_team_vote: !!slot.pending_team_vote,
        sv_fallback_score: Number(slot.sv_fallback_score || 0),
      };
    }).filter(Boolean);

    res.json({
      formation,
      modulo: modulo || '',
      formation_recovered: formationRecovered,
      is_matchday_calculated: isCalculated,
      ...formationDebug,
      bonus_enabled: Number(bonusSettings.enable_bonus_malus) === 1,
      bonus_settings: bonusSettings,
    });
  } catch (error) {
    console.error('Standings formation error:', error);
    res.status(500).json({ message: 'Errore caricamento formazione giornata' });
  }
});

// GET /api/leagues/:id/standings/matchday/:giornata
router.get('/:id/standings/matchday/:giornata', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const giornata = Number(req.params.giornata);
    if (!leagueId || !Number.isFinite(giornata)) return res.status(400).json({ message: 'Parametri non validi' });
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    const userId = Number(req.user.userId);
    if (await isGhostMatchday(effectiveLeagueId, giornata)) {
      const canSee = await userCanSeeGhostMatchdays(userId, leagueId);
      if (!canSee) return res.json([]);
    }

    try {
      const rows = await query(
        `SELECT mr.user_id AS id, u.username, COALESCE(ub.team_name, u.username) AS team_name,
                COALESCE(ub.coach_name, '') AS coach_name,
                mr.punteggio::float AS punteggio
         FROM matchday_results mr
         JOIN users u ON u.id = mr.user_id
         LEFT JOIN user_budget ub ON ub.user_id = mr.user_id AND ub.league_id = mr.league_id
         WHERE mr.league_id = ? AND mr.giornata = ?
         ORDER BY mr.punteggio DESC,
                  LOWER(COALESCE(ub.team_name, u.username)) ASC,
                  LOWER(u.username) ASC`,
        [leagueId, giornata]
      );
      return res.json(rows);
    } catch (_) {
      return res.json([]);
    }
  } catch (error) {
    console.error('Standings matchday error:', error);
    res.status(500).json({ message: 'Errore classifica giornata' });
  }
});

// GET /api/leagues/:id/matchday-status - placeholder minimo
router.get('/:id/matchday-status', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    await ensureMatchdaysGhostSchema();
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    const userId = Number(req.user.userId);
    const canSeeGhost = await userCanSeeGhostMatchdays(userId, leagueId);
    let rows = await query(
      `SELECT m.giornata,
              to_char((m.deadline AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-DD HH24:MI:SS') AS deadline,
              COALESCE(m.is_ghost, 0)::int AS is_ghost,
              CASE WHEN EXISTS (
                SELECT 1 FROM player_ratings pr
                WHERE pr.league_id = m.league_id AND pr.giornata = m.giornata
              ) THEN 1 ELSE 0 END AS has_votes,
              (SELECT COUNT(*)
               FROM player_ratings pr2
               WHERE pr2.league_id = m.league_id AND pr2.giornata = m.giornata) AS votes_count,
              CASE WHEN EXISTS (
                SELECT 1 FROM matchday_results mr
                WHERE mr.league_id = ? AND mr.giornata = m.giornata
              ) THEN 1 ELSE 0 END AS is_calculated,
              (
                SELECT MAX(${matchdayCalculatedAtExpr('mr2')})
                FROM matchday_results mr2
                WHERE mr2.league_id = ? AND mr2.giornata = m.giornata
              ) AS calculated_at
       FROM matchdays m
       WHERE m.league_id = ?
       ORDER BY m.giornata ASC`,
      [leagueId, leagueId, effectiveLeagueId]
    );
    // Se mancano matchdays ma esistono risultati/voti, restituisce comunque uno stato minimo.
    if (!rows.length) {
      rows = await query(
        `SELECT g.giornata, NULL AS deadline, 0::int AS is_ghost,
                CASE WHEN EXISTS (
                  SELECT 1 FROM player_ratings pr
                  WHERE pr.league_id = ? AND pr.giornata = g.giornata
                ) THEN 1 ELSE 0 END AS has_votes,
                (SELECT COUNT(*) FROM player_ratings pr2 WHERE pr2.league_id = ? AND pr2.giornata = g.giornata) AS votes_count,
                CASE WHEN EXISTS (
                  SELECT 1 FROM matchday_results mr
                  WHERE mr.league_id = ? AND mr.giornata = g.giornata
                ) THEN 1 ELSE 0 END AS is_calculated,
                (
                  SELECT MAX(${matchdayCalculatedAtExpr('mr2')})
                  FROM matchday_results mr2
                  WHERE mr2.league_id = ? AND mr2.giornata = g.giornata
                ) AS calculated_at
         FROM (
           SELECT giornata FROM player_ratings WHERE league_id = ?
           UNION
           SELECT giornata FROM matchday_results WHERE league_id = ?
         ) g
         ORDER BY g.giornata ASC`,
        [effectiveLeagueId, effectiveLeagueId, leagueId, leagueId, effectiveLeagueId, leagueId]
      );
    }
    res.json(filterGhostMatchdaysForUser(rows, canSeeGhost));
  } catch (_) {
    res.json([]);
  }
});

// GET /api/leagues/:id/bonus-settings
router.get('/:id/bonus-settings', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const bs = await getLeagueBonusSettings(leagueId);
    res.json(bs);
  } catch (error) {
    console.error('Get bonus settings error:', error);
    res.status(500).json({ message: 'Errore caricamento bonus settings' });
  }
});

// PUT /api/leagues/:id/bonus-settings
router.put('/:id/bonus-settings', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const bs = normalizeBonusSettings(req.body || {});
    await query(
      `INSERT INTO league_bonus_settings (
         league_id, enable_bonus_malus, enable_goal, bonus_goal, enable_assist, bonus_assist,
         enable_yellow_card, malus_yellow_card, enable_red_card, malus_red_card,
         enable_goals_conceded, malus_goals_conceded, enable_own_goal, malus_own_goal,
         enable_penalty_missed, malus_penalty_missed, enable_penalty_saved, bonus_penalty_saved,
         enable_clean_sheet, bonus_clean_sheet,
         enable_pallone_fuori, malus_pallone_fuori, enable_briso, bonus_briso,
         enable_no_divisa, malus_no_divisa
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (league_id)
       DO UPDATE SET
         enable_bonus_malus = EXCLUDED.enable_bonus_malus,
         enable_goal = EXCLUDED.enable_goal,
         bonus_goal = EXCLUDED.bonus_goal,
         enable_assist = EXCLUDED.enable_assist,
         bonus_assist = EXCLUDED.bonus_assist,
         enable_yellow_card = EXCLUDED.enable_yellow_card,
         malus_yellow_card = EXCLUDED.malus_yellow_card,
         enable_red_card = EXCLUDED.enable_red_card,
         malus_red_card = EXCLUDED.malus_red_card,
         enable_goals_conceded = EXCLUDED.enable_goals_conceded,
         malus_goals_conceded = EXCLUDED.malus_goals_conceded,
         enable_own_goal = EXCLUDED.enable_own_goal,
         malus_own_goal = EXCLUDED.malus_own_goal,
         enable_penalty_missed = EXCLUDED.enable_penalty_missed,
         malus_penalty_missed = EXCLUDED.malus_penalty_missed,
         enable_penalty_saved = EXCLUDED.enable_penalty_saved,
         bonus_penalty_saved = EXCLUDED.bonus_penalty_saved,
         enable_clean_sheet = EXCLUDED.enable_clean_sheet,
         bonus_clean_sheet = EXCLUDED.bonus_clean_sheet,
         enable_pallone_fuori = EXCLUDED.enable_pallone_fuori,
         malus_pallone_fuori = EXCLUDED.malus_pallone_fuori,
         enable_briso = EXCLUDED.enable_briso,
         bonus_briso = EXCLUDED.bonus_briso,
         enable_no_divisa = EXCLUDED.enable_no_divisa,
         malus_no_divisa = EXCLUDED.malus_no_divisa`,
      [
        leagueId,
        bs.enable_bonus_malus, bs.enable_goal, bs.bonus_goal, bs.enable_assist, bs.bonus_assist,
        bs.enable_yellow_card, bs.malus_yellow_card, bs.enable_red_card, bs.malus_red_card,
        bs.enable_goals_conceded, bs.malus_goals_conceded, bs.enable_own_goal, bs.malus_own_goal,
        bs.enable_penalty_missed, bs.malus_penalty_missed, bs.enable_penalty_saved, bs.bonus_penalty_saved,
        bs.enable_clean_sheet, bs.bonus_clean_sheet,
        bs.enable_pallone_fuori, bs.malus_pallone_fuori, bs.enable_briso, bs.bonus_briso,
        bs.enable_no_divisa, bs.malus_no_divisa,
      ]
    );
    res.json({ message: 'Bonus settings aggiornati' });
  } catch (error) {
    console.error('Update bonus settings error:', error);
    res.status(500).json({ message: 'Errore aggiornamento bonus settings' });
  }
});

// GET /api/leagues/:id/votes/matchdays
router.get('/:id/votes/matchdays', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    const matchdays = await query(
      `SELECT giornata
       FROM matchdays
       WHERE league_id = ?
       ORDER BY giornata ASC`,
      [effectiveLeagueId]
    );
    let last = null;
    try {
      const rows = await query(
        `SELECT MAX(giornata)::int AS last_g
         FROM player_ratings
         WHERE league_id = ?`,
        [effectiveLeagueId]
      );
      last = rows[0]?.last_g || null;
    } catch (_) {
      last = null;
    }
    res.json({ matchdays, last_matchday_with_votes: last });
  } catch (error) {
    console.error('Votes matchdays error:', error);
    res.status(500).json({ message: 'Errore caricamento giornate voti' });
  }
});

// GET /api/leagues/:id/votes/players
router.get('/:id/votes/players', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    const teams = await query(
      `SELECT id, name
       FROM teams
       WHERE league_id = ?
       ORDER BY id ASC`,
      [effectiveLeagueId]
    );
    const players = await query(
      `SELECT id, first_name, last_name, role, team_id
       FROM players
       WHERE team_id IN (SELECT id FROM teams WHERE league_id = ?)
       ORDER BY team_id ASC, role ASC, last_name ASC`,
      [effectiveLeagueId]
    );
    const byTeam = {};
    teams.forEach((t) => { byTeam[t.id] = { id: t.id, name: t.name, players: [] }; });
    players.forEach((p) => {
      if (byTeam[p.team_id]) byTeam[p.team_id].players.push(p);
    });
    res.json(Object.values(byTeam));
  } catch (error) {
    console.error('Votes players error:', error);
    res.status(500).json({ message: 'Errore caricamento giocatori voti' });
  }
});

// GET /api/leagues/:id/votes/:giornata
router.get('/:id/votes/:giornata', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const giornata = Number(req.params.giornata);
    if (!leagueId || !Number.isFinite(giornata)) return res.status(400).json({ message: 'Parametri non validi' });
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    try {
      const rows = await query(
        `SELECT player_id, rating, goals, assists, yellow_cards, red_cards,
                goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet,
                pallone_fuori, briso, no_divisa
         FROM player_ratings
         WHERE league_id = ? AND giornata = ?`,
        [effectiveLeagueId, giornata]
      );
      const mapped = {};
      rows.forEach((r) => {
        mapped[String(r.player_id)] = {
          rating: normalizeVoteRating(r.rating || 0),
          goals: Number(r.goals || 0),
          assists: Number(r.assists || 0),
          yellow_cards: Number(r.yellow_cards || 0),
          red_cards: Number(r.red_cards || 0),
          goals_conceded: Number(r.goals_conceded || 0),
          own_goals: Number(r.own_goals || 0),
          penalty_missed: Number(r.penalty_missed || 0),
          penalty_saved: Number(r.penalty_saved || 0),
          clean_sheet: Number(r.clean_sheet || 0),
          pallone_fuori: Number(r.pallone_fuori || 0),
          briso: Number(r.briso || 0),
          no_divisa: Number(r.no_divisa || 0),
        };
      });
      return res.json(mapped);
    } catch (_) {
      return res.json({});
    }
  } catch (error) {
    console.error('Votes get by matchday error:', error);
    res.status(500).json({ message: 'Errore caricamento voti' });
  }
});

// POST /api/leagues/:id/votes/:giornata
router.post('/:id/votes/:giornata', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const giornata = Number(req.params.giornata);
    const ratings = req.body?.ratings || {};
    if (!leagueId || !Number.isFinite(giornata) || typeof ratings !== 'object') {
      return res.status(400).json({ message: 'Parametri non validi' });
    }

    const entries = Object.entries(ratings);
    for (const [playerIdRaw, v] of entries) {
      const playerId = Number(playerIdRaw);
      if (!Number.isFinite(playerId) || playerId <= 0) continue;
      const row = {
        rating: normalizeVoteRating(v?.rating || 0),
        goals: Number(v?.goals || 0),
        assists: Number(v?.assists || 0),
        yellow_cards: Number(v?.yellow_cards || 0),
        red_cards: Number(v?.red_cards || 0),
        goals_conceded: Number(v?.goals_conceded || 0),
        own_goals: Number(v?.own_goals || 0),
        penalty_missed: Number(v?.penalty_missed || 0),
        penalty_saved: Number(v?.penalty_saved || 0),
        clean_sheet: Number(v?.clean_sheet || 0),
        pallone_fuori: Number(v?.pallone_fuori || 0),
        briso: Number(v?.briso || 0),
        no_divisa: Number(v?.no_divisa || 0),
      };
      await query(
        `INSERT INTO player_ratings (
           league_id, giornata, player_id, rating, goals, assists, yellow_cards, red_cards,
           goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet,
           pallone_fuori, briso, no_divisa
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (league_id, giornata, player_id)
         DO UPDATE SET
           rating = EXCLUDED.rating,
           goals = EXCLUDED.goals,
           assists = EXCLUDED.assists,
           yellow_cards = EXCLUDED.yellow_cards,
           red_cards = EXCLUDED.red_cards,
           goals_conceded = EXCLUDED.goals_conceded,
           own_goals = EXCLUDED.own_goals,
           penalty_missed = EXCLUDED.penalty_missed,
           penalty_saved = EXCLUDED.penalty_saved,
           clean_sheet = EXCLUDED.clean_sheet,
           pallone_fuori = EXCLUDED.pallone_fuori,
           briso = EXCLUDED.briso,
           no_divisa = EXCLUDED.no_divisa`,
        [
          leagueId, giornata, playerId, row.rating, row.goals, row.assists, row.yellow_cards, row.red_cards,
          row.goals_conceded, row.own_goals, row.penalty_missed, row.penalty_saved, row.clean_sheet,
          row.pallone_fuori, row.briso, row.no_divisa,
        ]
      );
    }
    await invalidateCalculatedForLeagueGiornata(leagueId, giornata);
    res.json({ message: 'Voti salvati con successo', recalculation_invalidated: true });
  } catch (error) {
    console.error('Save votes error:', error);
    res.status(500).json({ message: 'Errore salvataggio voti' });
  }
});

// POST /api/leagues/:id/calculate/:giornata
router.post('/:id/calculate/:giornata', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const giornata = Number(req.params.giornata);
    const currentUserId = Number(req.user.userId);
    const use6Politico = Number(req.body?.use_6_politico ? 1 : 0) === 1;
    const force = Number(req.body?.force ? 1 : 0) === 1;
    const notifyOnRecalculate = Number(req.body?.notify_on_recalculate ? 1 : 0) === 1;
    if (!leagueId || !Number.isFinite(giornata) || giornata <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);

    const roleRows = await query(
      `SELECT role
       FROM league_members
       WHERE league_id = ? AND user_id = ?
       LIMIT 1`,
      [leagueId, currentUserId]
    );
    if (!roleRows[0] || String(roleRows[0].role) !== 'admin') {
      return res.status(403).json({ message: 'Solo gli amministratori possono calcolare la giornata' });
    }

    if (await isGhostMatchday(effectiveLeagueId, giornata)) {
      return res.status(400).json({
        message: 'Le giornate fantasma non si calcolano in classifica: i voti restano solo nelle statistiche giocatore',
      });
    }

    const existing = await query(
      `SELECT COUNT(*)::int AS c
       FROM matchday_results
       WHERE league_id = ? AND giornata = ?`,
      [leagueId, giornata]
    );
    const alreadyCalculated = Number(existing[0]?.c || 0) > 0;
    if (alreadyCalculated && !force) {
      return res.json({ already_calculated: true, recalculated: false });
    }

    const leagueRows = await query(
      `SELECT numero_titolari, auto_lineup_mode,
              COALESCE(recover_previous_lineup_if_missing, 1) AS recover_previous_lineup_if_missing,
              COALESCE(enable_sv_fallback_vote, 0) AS enable_sv_fallback_vote
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [leagueId]
    );
    const numeroTitolari = Number(leagueRows[0]?.numero_titolari || 10);
    const autoLineupMode = Number(leagueRows[0]?.auto_lineup_mode || 0) === 1;
    const recoverPreviousLineupIfMissing = Number(leagueRows[0]?.recover_previous_lineup_if_missing ?? 1) === 1;
    const enableSvFallbackVote = Number(leagueRows[0]?.enable_sv_fallback_vote ?? 0) === 1;
    const bonusSettings = await getLeagueBonusSettings(leagueId);
    const injuryMap = await getInjuryReplacementMap(leagueId);

    const members = await query(
      `SELECT lm.user_id
       FROM league_members lm
       WHERE lm.league_id = ?`,
      [leagueId]
    );
    if (!members.length) {
      return res.status(400).json({ message: 'Nessun membro trovato in lega' });
    }

    const lineupRows = await query(
      `SELECT user_id, titolari, panchina, COALESCE(modulo, '') AS modulo
       FROM user_lineups
       WHERE league_id = ? AND giornata = ?`,
      [leagueId, giornata]
    );
    const lineupByUser = {};
    lineupRows.forEach((r) => {
      const modulo = String(r.modulo || '').trim();
      lineupByUser[Number(r.user_id)] = {
        modulo,
        titolariSlots: titolariIdsToSlots(r.titolari, modulo, numeroTitolari),
        panchina: parseIdsArray(r.panchina),
      };
    });

    const voteRows = await query(
      `SELECT player_id, rating, goals, assists, yellow_cards, red_cards,
              goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet,
              pallone_fuori, briso, no_divisa
       FROM player_ratings
       WHERE league_id = ? AND giornata = ?`,
      [effectiveLeagueId, giornata]
    );
    const votesByPlayer = {};
    voteRows.forEach((r) => { votesByPlayer[Number(r.player_id)] = r; });
    const playersRows = await query(
      `SELECT p.id, p.first_name, p.last_name, p.role, p.team_id
       FROM players p
       WHERE p.team_id IN (SELECT id FROM teams WHERE league_id = ?)`,
      [effectiveLeagueId]
    );
    const playersById = {};
    playersRows.forEach((p) => {
      playersById[Number(p.id)] = p;
    });

    if (alreadyCalculated && force) {
      await query(
        `DELETE FROM matchday_results
         WHERE league_id = ? AND giornata = ?`,
        [leagueId, giornata]
      );
      try {
        // Se la giornata viene ricalcolata, consenti una nuova notifica "giornata calcolata".
        await query(
          `DELETE FROM push_notification_sends
           WHERE league_id = ? AND giornata = ? AND notification_type = 'matchday_calculated'`,
          [leagueId, giornata]
        );
      } catch (_) {
        // Tabella notifiche opzionale: ignora se non presente.
      }
      try {
        await query(
          `DELETE FROM matchday_player_scores
           WHERE league_id = ? AND giornata = ?`,
          [leagueId, giornata]
        );
      } catch (_) {
        // Tabella opzionale: ignora se non presente.
      }
    }

    await ensureMatchdayResultsCalculatedAtColumn();
    let calculatedAtStamp = null;
    try {
      const tsRows = await query('SELECT NOW() AS ts');
      calculatedAtStamp = tsRows[0]?.ts ?? new Date();
    } catch (_) {
      calculatedAtStamp = new Date();
    }

    const details = [];
    const calcWarnings = [];
    const usersWith6Politico = [];
    const memberOutcomes = await Promise.all(members.map(async (m) => {
      const userId = Number(m.user_id);
      try {
        let titolari = [];
        let titolariSlots = null;
        let slotRoles = null;
        let panchina = [];
        const currentLineup = lineupByUser[userId];

        let resolvedModulo = '';
        if (autoLineupMode) {
          const generated = await buildAutoLineupFromVotes({
            leagueId,
            userId,
            numeroTitolari,
            votesByPlayer,
            bonusSettings,
            use6Politico,
            computeBonusTotal,
          });
          if (generated && generated.titolari.length > 0) {
            titolari = generated.titolari;
            panchina = generated.panchina || [];
            resolvedModulo = String(generated.modulo || '');
          }
        } else if (currentLineup && (currentLineup.titolariSlots || []).some((id) => Number(id) > 0)) {
          titolariSlots = applyInjuryToSlots(currentLineup.titolariSlots, injuryMap);
          slotRoles = buildStarterRolesFromModulo(currentLineup.modulo, titolariSlots.length);
          panchina = currentLineup.panchina || [];
          resolvedModulo = String(currentLineup.modulo || '');
        } else {
          const resolved = await resolveUserLineup(leagueId, userId, giornata, numeroTitolari, {
            recoverPrevious: recoverPreviousLineupIfMissing,
            injuryMap,
            applyInjury: applyInjuryToLineup,
          });
          titolari = resolved.titolari;
          panchina = resolved.panchina;
          resolvedModulo = String(resolved.modulo || '');
        }

        if (!titolariSlots) {
          titolari = applyInjuryMap(titolari, injuryMap).slice(0, numeroTitolari);
        }
        panchina = applyInjuryMap(panchina, injuryMap);
        if (!Array.isArray(panchina)) panchina = [];

        const lineupToPersist = titolariSlots?.length ? titolariSlots : titolari;
        if (lineupToPersist.length > 0) {
          await persistUserLineup(leagueId, userId, giornata, {
            modulo: resolvedModulo,
            titolari: lineupToPersist,
            panchina,
          });
        }

        const scored = scoreResolvedLineup({
          ...(titolariSlots ? { titolariSlots, slotRoles } : { titolari }),
          panchina,
          votesByPlayer,
          playersById,
          enableSvFallbackVote,
          use6Politico,
          bonusSettings,
          computeBonusTotal,
        });
        const punteggio = scored.punteggio;
        const hasRealVotes = scored.hasRealVotes;
        const playerScores = scored.playerScores;
        const hasLineupForScore = titolariSlots?.length
          ? titolariSlots.some((id) => Number(id) > 0)
          : titolari.length > 0;

        await query(
          `INSERT INTO matchday_results (league_id, giornata, user_id, punteggio, calculated_at)
           VALUES (?, ?, ?, ?, ?)`,
          [leagueId, giornata, userId, punteggio, calculatedAtStamp]
        );

        let playerScoresWarning = null;
        try {
          await Promise.all((playerScores || []).map((ps) => query(
            `INSERT INTO matchday_player_scores (
               league_id, giornata, user_id, player_id, player_name, player_role,
               rating, goals, assists, yellow_cards, red_cards, goals_conceded,
               own_goals, penalty_missed, penalty_saved, clean_sheet,
               pallone_fuori, briso, no_divisa,
               bonus_total, total_score
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (league_id, giornata, user_id, player_id)
             DO UPDATE SET
               player_name = EXCLUDED.player_name,
               player_role = EXCLUDED.player_role,
               rating = EXCLUDED.rating,
               goals = EXCLUDED.goals,
               assists = EXCLUDED.assists,
               yellow_cards = EXCLUDED.yellow_cards,
               red_cards = EXCLUDED.red_cards,
               goals_conceded = EXCLUDED.goals_conceded,
               own_goals = EXCLUDED.own_goals,
               penalty_missed = EXCLUDED.penalty_missed,
               penalty_saved = EXCLUDED.penalty_saved,
               clean_sheet = EXCLUDED.clean_sheet,
               pallone_fuori = EXCLUDED.pallone_fuori,
               briso = EXCLUDED.briso,
               no_divisa = EXCLUDED.no_divisa,
               bonus_total = EXCLUDED.bonus_total,
               total_score = EXCLUDED.total_score`,
            [
              leagueId, giornata, userId, ps.player_id, ps.player_name, ps.player_role,
              ps.rating, ps.goals, ps.assists, ps.yellow_cards, ps.red_cards, ps.goals_conceded,
              ps.own_goals, ps.penalty_missed, ps.penalty_saved, ps.clean_sheet,
              ps.pallone_fuori, ps.briso, ps.no_divisa,
              ps.bonus_total, ps.total_score,
            ]
          )));
        } catch (scoreErr) {
          playerScoresWarning = {
            user_id: userId,
            code: 'player_scores_write',
            message: 'Punteggio salvato; dettaglio giocatori non aggiornato.',
          };
          console.error('matchday_player_scores write error:', scoreErr?.message || scoreErr);
        }

        return {
          ok: true,
          user_id: userId,
          punteggio,
          players: playerScores,
          use6PoliticoFlag: !hasRealVotes && use6Politico && hasLineupForScore,
          warning: playerScoresWarning,
        };
      } catch (userErr) {
        console.error(`Calculate matchday user ${userId} error:`, userErr);
        return {
          ok: false,
          warning: {
            user_id: userId,
            code: 'user_calc_failed',
            message: userErr?.message || 'Errore calcolo utente',
          },
        };
      }
    }));

    for (const outcome of memberOutcomes) {
      if (outcome.warning) calcWarnings.push(outcome.warning);
      if (!outcome.ok) continue;
      if (outcome.use6PoliticoFlag) usersWith6Politico.push(outcome.user_id);
      details.push({
        user_id: outcome.user_id,
        punteggio: outcome.punteggio,
        players: outcome.players,
      });
    }

    if (details.length < 1) {
      return res.status(500).json({
        message: 'Nessun punteggio calcolato. Verifica voti e formazioni.',
        warnings: calcWarnings,
      });
    }

    let notificationStats = null;
    const notifyUsersReq = req.body?.notify_users;
    const shouldNotify = force
      ? notifyOnRecalculate
      : (notifyUsersReq === true || notifyUsersReq === 1
          ? true
          : notifyUsersReq === false || notifyUsersReq === 0
            ? false
            : !alreadyCalculated);
    if (shouldNotify) {
      try {
        notificationStats = await triggerCalculatedNotificationForLeagueMatchday(leagueId, giornata);
      } catch (_notifyErr) {
        /* push opzionale: fallimento non blocca calcolo */
      }
    } else {
      try {
        await suppressCalculatedNotificationsForLeagueMatchday(leagueId, giornata);
      } catch (_suppressErr) {
        /* soppressione opzionale: evita reinvio dal cron */
      }
    }

    return res.json({
      success: true,
      already_calculated: false,
      recalculated: !!force,
      notifications_sent: Number(notificationStats?.sent || 0) > 0,
      use_6_politico: use6Politico,
      users_with_6_politico: usersWith6Politico,
      processed_users: details.length,
      warnings: calcWarnings,
      results: details.sort((a, b) => b.punteggio - a.punteggio),
      notifications: notificationStats,
    });
  } catch (error) {
    console.error('Calculate matchday error:', error);
    res.status(500).json({ message: 'Errore durante il calcolo giornata' });
  }
});

// DELETE /api/leagues/:id/calculate/:giornata
router.delete('/:id/calculate/:giornata', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const giornata = Number(req.params.giornata);
    const currentUserId = Number(req.user.userId);
    if (!leagueId || !Number.isFinite(giornata) || giornata <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }

    const roleRows = await query(
      `SELECT role
       FROM league_members
       WHERE league_id = ? AND user_id = ?
       LIMIT 1`,
      [leagueId, currentUserId]
    );
    if (!roleRows[0] || String(roleRows[0].role) !== 'admin') {
      return res.status(403).json({ message: 'Solo gli amministratori possono annullare il calcolo della giornata' });
    }

    const existing = await query(
      `SELECT COUNT(*)::int AS c
       FROM matchday_results
       WHERE league_id = ? AND giornata = ?`,
      [leagueId, giornata]
    );
    const hasCalculatedData = Number(existing[0]?.c || 0) > 0;
    if (!hasCalculatedData) {
      return res.status(404).json({ message: 'Nessun calcolo presente per questa giornata' });
    }

    await query(
      `DELETE FROM matchday_results
       WHERE league_id = ? AND giornata = ?`,
      [leagueId, giornata]
    );

    try {
      await query(
        `DELETE FROM matchday_player_scores
         WHERE league_id = ? AND giornata = ?`,
        [leagueId, giornata]
      );
    } catch (_) {
      // Tabella opzionale: ignora se non presente.
    }

    try {
      await query(
        `DELETE FROM push_notification_sends
         WHERE league_id = ? AND giornata = ? AND notification_type = 'matchday_calculated'`,
        [leagueId, giornata]
      );
    } catch (_) {
      // Tabella opzionale: ignora se non presente.
    }

    return res.json({ message: 'Calcolo giornata annullato con successo' });
  } catch (error) {
    console.error('Undo calculate matchday error:', error);
    res.status(500).json({ message: 'Errore durante l\'annullamento del calcolo giornata' });
  }
});

// GET /api/leagues/:id/live/:giornata
router.get('/:id/live/:giornata', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const giornata = Number(req.params.giornata);
    if (!leagueId || !Number.isFinite(giornata)) return res.status(400).json({ message: 'Parametri non validi' });
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    if (await isGhostMatchday(effectiveLeagueId, giornata)) {
      return res.status(404).json({ message: 'Giornata non disponibile' });
    }

    const members = await query(
      `SELECT lm.user_id, u.username, ub.team_name, ub.coach_name, ub.team_logo
       FROM league_members lm
       JOIN users u ON u.id = lm.user_id
       LEFT JOIN user_budget ub ON ub.user_id = lm.user_id AND ub.league_id = lm.league_id
       WHERE lm.league_id = ?`,
      [leagueId]
    );

    let isCalculated = false;
    let calculatedAt = null;
    let calculatedResults = null;
    try {
      const calcRows = await query(
        `SELECT mr.user_id, mr.punteggio, u.username,
                COALESCE(ub.team_name, u.username) AS team_name,
                COALESCE(ub.coach_name, '') AS coach_name,
                COALESCE(ub.team_logo, 'default_1') AS team_logo
         FROM matchday_results mr
         JOIN users u ON u.id = mr.user_id
         LEFT JOIN user_budget ub ON ub.user_id = mr.user_id AND ub.league_id = mr.league_id
         WHERE mr.league_id = ? AND mr.giornata = ?
         ORDER BY mr.punteggio DESC,
                  LOWER(COALESCE(ub.team_name, u.username)) ASC,
                  LOWER(u.username) ASC`,
        [leagueId, giornata]
      );
      if (calcRows.length > 0) {
        isCalculated = true;
        let psRows = [];
        try {
          psRows = await query(
            `SELECT user_id, player_id, player_name, player_role, rating, bonus_total, total_score
             FROM matchday_player_scores
             WHERE league_id = ? AND giornata = ?
             ORDER BY total_score DESC`,
            [leagueId, giornata]
          );
        } catch (_) {
          psRows = [];
        }
        try {
          await ensureMatchdayResultsCalculatedAtColumn();
          const cRows = await query(
            `SELECT MAX(${matchdayCalculatedAtExpr('mr')}) AS calc_at
             FROM matchday_results mr
             WHERE mr.league_id = ? AND mr.giornata = ?`,
            [leagueId, giornata]
          );
          calculatedAt = cRows[0]?.calc_at || null;
        } catch (_) {
          calculatedAt = null;
        }
        const byUser = {};
        const scoreByUser = {};
        psRows.forEach((r) => {
          const uid = Number(r.user_id);
          if (!byUser[uid]) byUser[uid] = [];
          byUser[uid].push({
            player_id: Number(r.player_id),
            player_name: r.player_name,
            player_role: r.player_role,
            rating: normalizeVoteRating(r.rating || 0),
            bonus_total: Number(r.bonus_total || 0),
            total_score: Number(r.total_score || 0),
          });
          scoreByUser[uid] = Number((Number(scoreByUser[uid] || 0) + Number(r.total_score || 0)).toFixed(2));
        });
        const hasPlayerScores = psRows.length > 0;
        calculatedResults = calcRows.map((r) => {
          const uid = Number(r.user_id);
          const recalculatedScore = hasPlayerScores ? Number(scoreByUser[uid] || 0) : Number(r.punteggio || 0);
          return {
            user_id: uid,
            username: r.username,
            team_name: r.team_name,
            coach_name: r.coach_name,
            team_logo: r.team_logo,
            // Se i player scores esistono, la classifica live deve seguire il dettaglio aggiornato.
            punteggio: Number(recalculatedScore.toFixed(2)),
            players: byUser[uid] || [],
          };
        }).sort((a, b) => {
          const scoreDiff = Number(b.punteggio || 0) - Number(a.punteggio || 0);
          if (scoreDiff !== 0) return scoreDiff;
          const nameA = String(a.team_name || a.username || '').toLocaleLowerCase('it-IT');
          const nameB = String(b.team_name || b.username || '').toLocaleLowerCase('it-IT');
          return nameA.localeCompare(nameB, 'it');
        });
      }
    } catch (calcErr) {
      // fallback to on-the-fly
    }

    if (isCalculated && calculatedResults && calculatedResults.length > 0) {
      return res.json({
        results: calculatedResults,
        is_calculated: true,
        calculated_at: calculatedAt,
      });
    }

    if (isCalculated && (!calculatedResults || calculatedResults.length === 0)) {
      isCalculated = false;
    }

    let ratings = [];
    try {
      ratings = await query(
        `SELECT up.user_id, pr.player_id, pr.rating, pr.goals, pr.assists, pr.yellow_cards, pr.red_cards,
                pr.goals_conceded, pr.own_goals, pr.penalty_missed, pr.penalty_saved, pr.clean_sheet,
                pr.pallone_fuori, pr.briso, pr.no_divisa,
                p.role AS player_role, CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, '')) AS player_name
         FROM player_ratings pr
         JOIN user_players up ON up.player_id = pr.player_id AND up.league_id = ?
         JOIN players p ON p.id = pr.player_id
         WHERE pr.league_id = ? AND pr.giornata = ?`,
        [leagueId, effectiveLeagueId, giornata]
      );
    } catch (_) {
      ratings = [];
    }

    const bonus = await getLeagueBonusSettings(leagueId);
    const injuryMapLive = await getInjuryReplacementMap(leagueId);
    const leagueRows = await query(
      `SELECT numero_titolari, COALESCE(auto_lineup_mode, 0) AS auto_lineup_mode,
              COALESCE(recover_previous_lineup_if_missing, 1) AS recover_previous_lineup_if_missing,
              COALESCE(enable_sv_fallback_vote, 0) AS enable_sv_fallback_vote
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [leagueId]
    );
    const numeroTitolari = Number(leagueRows[0]?.numero_titolari || 10);
    const autoLineupMode = Number(leagueRows[0]?.auto_lineup_mode || 0) === 1;
    const recoverPreviousLive = Number(leagueRows[0]?.recover_previous_lineup_if_missing ?? 1) === 1;
    const enableSvFallbackVoteLive = Number(leagueRows[0]?.enable_sv_fallback_vote ?? 0) === 1;

    const votesByPlayer = {};
    ratings.forEach((r) => {
      votesByPlayer[Number(r.player_id)] = r;
    });

    const playersMetaRows = await query(
      `SELECT p.id, p.role, p.team_id, p.first_name, p.last_name
       FROM players p
       WHERE p.team_id IN (SELECT id FROM teams WHERE league_id = ?)`,
      [effectiveLeagueId]
    );
    const playersById = {};
    playersMetaRows.forEach((p) => { playersById[Number(p.id)] = p; });

    const lineupRows = await query(
      `SELECT user_id, titolari, panchina, COALESCE(modulo, '') AS modulo
       FROM user_lineups
       WHERE league_id = ? AND giornata = ?`,
      [leagueId, giornata]
    );
    const lineupByUser = {};
    lineupRows.forEach((r) => {
      const modulo = String(r.modulo || '').trim();
      lineupByUser[Number(r.user_id)] = {
        modulo,
        titolariSlots: titolariIdsToSlots(r.titolari, modulo, numeroTitolari),
        panchina: parseIdsArray(r.panchina),
      };
    });

    const sums = {};
    const playersByUser = {};
    await Promise.all(members.map(async (m) => {
      const uid = Number(m.user_id);
      try {
        let titolari = [];
        let titolariSlots = null;
        let slotRoles = null;
        let panchina = [];
        const currentLineup = lineupByUser[uid];
        if (autoLineupMode) {
          const generated = await buildAutoLineupFromVotes({
            leagueId,
            userId: uid,
            numeroTitolari,
            votesByPlayer,
            bonusSettings: bonus,
            use6Politico: false,
            computeBonusTotal,
          });
          titolari = generated?.titolari || [];
          panchina = generated?.panchina || [];
        } else if (currentLineup && (currentLineup.titolariSlots || []).some((id) => Number(id) > 0)) {
          titolariSlots = applyInjuryToSlots(currentLineup.titolariSlots, injuryMapLive);
          slotRoles = buildStarterRolesFromModulo(currentLineup.modulo, titolariSlots.length);
          panchina = applyInjuryMap(currentLineup.panchina || [], injuryMapLive);
        } else {
          const resolved = await resolveUserLineup(leagueId, uid, giornata, numeroTitolari, {
            recoverPrevious: recoverPreviousLive,
            injuryMap: injuryMapLive,
            applyInjury: applyInjuryToLineup,
          });
          titolari = resolved.titolari;
          panchina = resolved.panchina;
        }

        if (!titolariSlots) {
          titolari = applyInjuryMap(titolari, injuryMapLive).slice(0, numeroTitolari);
          panchina = applyInjuryMap(panchina, injuryMapLive);
        }

        const scored = scoreResolvedLineup({
          ...(titolariSlots ? { titolariSlots, slotRoles } : { titolari }),
          panchina,
          votesByPlayer,
          playersById,
          enableSvFallbackVote: enableSvFallbackVoteLive,
          use6Politico: false,
          bonusSettings: bonus,
          computeBonusTotal,
        });
        sums[uid] = scored.punteggio;
        playersByUser[uid] = scored.playerScores
          .map((ps) => ({
            player_id: ps.player_id,
            player_name: ps.player_name,
            player_role: ps.player_role,
            rating: ps.rating,
            bonus_total: ps.bonus_total,
            total_score: ps.total_score,
          }))
          .sort((a, b) => b.total_score - a.total_score);
      } catch (memberErr) {
        sums[uid] = 0;
        playersByUser[uid] = [];
      }
    }));

    const results = members.map((m) => ({
      user_id: Number(m.user_id),
      username: m.username,
      team_name: m.team_name || m.username,
      coach_name: m.coach_name || '',
      team_logo: m.team_logo || 'default_1',
      punteggio: Number((sums[Number(m.user_id)] || 0).toFixed(2)),
      players: (playersByUser[Number(m.user_id)] || []).sort((a, b) => b.total_score - a.total_score),
    })).sort((a, b) => {
      const scoreDiff = Number(b.punteggio || 0) - Number(a.punteggio || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const nameA = String(a.team_name || a.username || '').toLocaleLowerCase('it-IT');
      const nameB = String(b.team_name || b.username || '').toLocaleLowerCase('it-IT');
      return nameA.localeCompare(nameB, 'it');
    });

    res.json({
      results,
      is_calculated: isCalculated,
      calculated_at: calculatedAt,
    });
  } catch (error) {
    console.error('Live scores error:', error);
    res.status(500).json({ message: 'Errore caricamento live scores' });
  }
});

// GET /api/leagues/:id/settings
router.get('/:id/settings', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const rows = await query(
      `SELECT id, name, creator_id, initial_budget, access_code, default_deadline_time, numero_titolari,
              max_portieri, max_difensori, max_centrocampisti, max_attaccanti, auto_lineup_mode,
              enable_next_matchday_from_next_day, recover_previous_lineup_if_missing, enable_sv_fallback_vote
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [leagueId]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ message: 'Lega non trovata' });
    const bonusSettings = await getLeagueBonusSettings(leagueId);
    res.json({
      ...row,
      bonus_settings: bonusSettings,
    });
  } catch (error) {
    console.error('Get league settings error:', error);
    res.status(500).json({ message: 'Errore recupero impostazioni lega' });
  }
});

// PUT /api/leagues/:id/settings
router.put('/:id/settings', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });

    const defaultDeadlineTime = req.body?.default_deadline_time != null ? String(req.body.default_deadline_time) : null;
    const hasAccessCodeField = Object.prototype.hasOwnProperty.call(req.body || {}, 'access_code');
    const accessCodeRaw = req.body?.access_code;
    const accessCode =
      accessCodeRaw == null ? null : String(accessCodeRaw).trim() === '' ? null : String(accessCodeRaw).trim();
    const numeroTitolari = req.body?.numero_titolari != null ? Number(req.body.numero_titolari) : null;
    const autoLineupMode = req.body?.auto_lineup_mode != null ? Number(req.body.auto_lineup_mode) : null;
    const enableNextMatchdayFromNextDay =
      req.body?.enable_next_matchday_from_next_day != null
        ? Number(req.body.enable_next_matchday_from_next_day)
        : null;
    const recoverPreviousLineupIfMissing =
      req.body?.recover_previous_lineup_if_missing != null
        ? Number(req.body.recover_previous_lineup_if_missing)
        : null;
    const enableSvFallbackVote =
      req.body?.enable_sv_fallback_vote != null
        ? Number(req.body.enable_sv_fallback_vote)
        : null;

    await query(
      `UPDATE leagues
       SET access_code = CASE WHEN ? THEN ? ELSE access_code END,
           default_deadline_time = COALESCE(?, default_deadline_time),
           numero_titolari = COALESCE(?, numero_titolari),
           auto_lineup_mode = COALESCE(?, auto_lineup_mode),
           enable_next_matchday_from_next_day = COALESCE(?, enable_next_matchday_from_next_day),
           recover_previous_lineup_if_missing = COALESCE(?, recover_previous_lineup_if_missing),
           enable_sv_fallback_vote = COALESCE(?, enable_sv_fallback_vote)
       WHERE id = ?`,
      [
        hasAccessCodeField,
        accessCode,
        defaultDeadlineTime,
        Number.isFinite(numeroTitolari) ? numeroTitolari : null,
        Number.isFinite(autoLineupMode) ? autoLineupMode : null,
        Number.isFinite(enableNextMatchdayFromNextDay) ? enableNextMatchdayFromNextDay : null,
        Number.isFinite(recoverPreviousLineupIfMissing) ? recoverPreviousLineupIfMissing : null,
        Number.isFinite(enableSvFallbackVote) ? enableSvFallbackVote : null,
        leagueId,
      ]
    );
    res.json({ message: 'Impostazioni lega aggiornate' });
  } catch (error) {
    console.error('Update league settings error:', error);
    res.status(500).json({ message: 'Errore aggiornamento impostazioni lega' });
  }
});

// GET /api/leagues/:id/matchdays
router.get('/:id/matchdays', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    await ensureMatchdaysGhostSchema();
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    const userId = Number(req.user.userId);
    const canSeeGhost = await userCanSeeGhostMatchdays(userId, leagueId);
    const rows = await query(
      `SELECT id, giornata,
              COALESCE(is_ghost, 0)::int AS is_ghost,
              to_char((deadline AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-DD HH24:MI:SS') AS deadline
       FROM matchdays
       WHERE league_id = ?
       ORDER BY deadline ASC`,
      [effectiveLeagueId]
    );
    const enriched = filterGhostMatchdaysForUser(rows, canSeeGhost).map((r) => {
      const d = new Date(r.deadline);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return { ...r, deadline_date: `${y}-${m}-${day}` };
    });
    res.json(enriched);
  } catch (error) {
    console.error('Get matchdays error:', error);
    res.status(500).json({ message: 'Errore recupero giornate' });
  }
});

// POST /api/leagues/:id/matchdays
router.post('/:id/matchdays', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    await ensureMatchdaysGhostSchema();
    const currentUserId = Number(req.user.userId);
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    const leagueIds = await getLeagueIdsForMatchdayDataCleanup(leagueId);
    const inPh = leagueIds.map(() => '?').join(', ');
    const deadlineDate = String(req.body?.deadline_date || '').trim();
    const deadlineTime = String(req.body?.deadline_time || '20:00').trim();
    if (!deadlineDate) return res.status(400).json({ message: 'deadline_date obbligatoria' });

    const deadline = `${deadlineDate} ${deadlineTime}:00`;
    const matchdayId = req.body?.matchday_id ? Number(req.body.matchday_id) : null;
    const hasGhostFlag = req.body?.is_ghost !== undefined && req.body?.is_ghost !== null;
    const wantsGhost = hasGhostFlag && Number(req.body.is_ghost ? 1 : 0) === 1;

    if (wantsGhost) {
      const official = await isOfficialLeague(effectiveLeagueId);
      if (!official) {
        return res.status(400).json({ message: 'Le giornate fantasma sono disponibili solo per leghe ufficiali' });
      }
      if (!(await isLeagueAdmin(currentUserId, leagueId))) {
        return res.status(403).json({ message: 'Solo gli admin possono impostare giornate fantasma' });
      }
    }

    if (matchdayId && Number.isFinite(matchdayId)) {
      if (hasGhostFlag) {
        await query(
          `UPDATE matchdays
           SET deadline = (?::timestamp AT TIME ZONE 'Europe/Rome'),
               is_ghost = ?
           WHERE id = ? AND league_id IN (${inPh})`,
          [deadline, wantsGhost ? 1 : 0, matchdayId, ...leagueIds]
        );
      } else {
        await query(
          `UPDATE matchdays
           SET deadline = (?::timestamp AT TIME ZONE 'Europe/Rome')
           WHERE id = ? AND league_id IN (${inPh})`,
          [deadline, matchdayId, ...leagueIds]
        );
      }
    } else {
      const maxRows = await query(
        `SELECT COALESCE(MAX(giornata), 0) AS max_giornata
         FROM matchdays
         WHERE league_id IN (${inPh})`,
        [...leagueIds]
      );
      const nextGiornata = Number(maxRows[0]?.max_giornata || 0) + 1;
      await query(
        `INSERT INTO matchdays (league_id, giornata, deadline, is_ghost)
         VALUES (?, ?, (?::timestamp AT TIME ZONE 'Europe/Rome'), ?)`,
        [effectiveLeagueId, nextGiornata, deadline, wantsGhost ? 1 : 0]
      );
    }
    res.json({ message: 'Giornata salvata' });
  } catch (error) {
    console.error('Save matchday error:', error);
    res.status(500).json({ message: 'Errore salvataggio giornata' });
  }
});

// DELETE /api/leagues/:id/matchdays/:matchdayId
router.delete('/:id/matchdays/:matchdayId', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const matchdayId = Number(req.params.matchdayId);
    if (!leagueId || !Number.isFinite(matchdayId) || matchdayId <= 0) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    const leagueIdsForLookup = await getLeagueIdsForMatchdayDataCleanup(leagueId);
    const inPhLookup = leagueIdsForLookup.map(() => '?').join(', ');
    const mdRows = await query(
      `SELECT giornata, league_id FROM matchdays WHERE id = ? AND league_id IN (${inPhLookup}) LIMIT 1`,
      [matchdayId, ...leagueIdsForLookup]
    );
    if (!mdRows[0]) {
      return res.status(404).json({ message: 'Giornata non trovata' });
    }
    const giornata = Number(mdRows[0].giornata);
    if (!Number.isFinite(giornata) || giornata <= 0) {
      return res.status(400).json({ message: 'Numero giornata non valido' });
    }
    const rowLeagueId = Number(mdRows[0].league_id);
    const rowLeagueSeed = Number.isFinite(rowLeagueId) && rowLeagueId > 0 ? rowLeagueId : null;
    const leagueIds = await getLeagueIdsForMatchdayDataCleanup(leagueId, rowLeagueSeed);
    await deleteAllDataForLeagueGiornata(leagueId, giornata, rowLeagueSeed);
    await query('DELETE FROM matchdays WHERE id = ?', [matchdayId]);
    const inPh = leagueIds.map(() => '?').join(', ');
    await query(`DELETE FROM matchdays WHERE giornata = ? AND league_id IN (${inPh})`, [giornata, ...leagueIds]);
    res.json({ message: 'Giornata eliminata' });
  } catch (error) {
    console.error('Delete matchday error:', error);
    res.status(500).json({ message: 'Errore eliminazione giornata' });
  }
});

// GET /api/leagues/:id/csv/template/teams
router.get('/:id/csv/template/teams', authenticateToken, async (req, res) => {
  const leagueId = toValidLeagueId(req.params.id);
  if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
  return sendCsvResponse(res, `teams_template_league_${leagueId}.csv`, [
    CSV_TEAMS_HEADER,
    'Squadra 1',
    'Squadra 2',
  ]);
});

// GET /api/leagues/:id/csv/template/players
router.get('/:id/csv/template/players', authenticateToken, async (req, res) => {
  const leagueId = toValidLeagueId(req.params.id);
  if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
  return sendCsvResponse(res, `players_template_league_${leagueId}.csv`, [
    buildCsvLine(CSV_PLAYERS_HEADER),
    buildCsvLine(['Mario', 'Rossi', 'Squadra 1', 'C', '10', '7', '1998']),
  ]);
});

// GET /api/leagues/:id/csv/export/teams
router.get('/:id/csv/export/teams', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const teams = await query(
      `SELECT name
       FROM teams
       WHERE league_id = ?
       ORDER BY name ASC, id ASC`,
      [leagueId]
    );
    const lines = [CSV_TEAMS_HEADER];
    for (const t of teams) {
      lines.push(csvEscape(t.name));
    }
    return sendCsvResponse(res, `teams_league_${leagueId}.csv`, lines);
  } catch (error) {
    console.error('CSV export teams error:', error);
    return res.status(500).json({ message: 'Errore export squadre CSV' });
  }
});

// GET /api/leagues/:id/csv/export/players
router.get('/:id/csv/export/players', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    let players;
    try {
      players = await query(
        `SELECT p.first_name, p.last_name, t.name AS team_name, p.role,
                COALESCE(p.rating, 0) AS rating, p.shirt_number, p.birth_year
         FROM players p
         JOIN teams t ON t.id = p.team_id
         WHERE t.league_id = ?
         ORDER BY t.name ASC, p.role ASC, p.last_name ASC, p.first_name ASC`,
        [leagueId]
      );
    } catch (_) {
      players = await query(
        `SELECT p.first_name, p.last_name, t.name AS team_name, p.role,
                COALESCE(p.rating, 0) AS rating, NULL AS shirt_number, NULL AS birth_year
         FROM players p
         JOIN teams t ON t.id = p.team_id
         WHERE t.league_id = ?
         ORDER BY t.name ASC, p.role ASC, p.last_name ASC, p.first_name ASC`,
        [leagueId]
      );
    }
    const lines = [buildCsvLine(CSV_PLAYERS_HEADER)];
    for (const p of players) {
      const shirt = p.shirt_number != null && String(p.shirt_number).trim() !== ''
        ? String(Number(p.shirt_number))
        : '';
      const year = p.birth_year != null && Number.isFinite(Number(p.birth_year))
        ? String(Number(p.birth_year))
        : '';
      lines.push(buildCsvLine([
        p.first_name,
        p.last_name,
        p.team_name,
        p.role,
        Number(p.rating || 0),
        shirt,
        year,
      ]));
    }
    return sendCsvResponse(res, `players_league_${leagueId}.csv`, lines);
  } catch (error) {
    console.error('CSV export players error:', error);
    return res.status(500).json({ message: 'Errore export giocatori CSV' });
  }
});

// POST /api/leagues/:id/csv/import
router.post('/:id/csv/import', authenticateToken, csvUpload.single('csv_file'), async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    if (!req.file?.buffer) return res.status(400).json({ message: 'File CSV mancante' });

    const rows = parseCsvContent(decodeCsvBuffer(req.file.buffer));
    if (!rows.length) return res.status(400).json({ message: 'CSV vuoto o non valido' });

    let teamsCreated = 0;
    let playersCreated = 0;
    let skipped = 0;
    const errors = [];

    if (!isPlayersCsvShape(rows)) {
      for (const row of rows) {
        const name = getTeamNameFromCsvRow(row);
        if (!name) {
          skipped += 1;
          continue;
        }
        const exists = await query(
          `SELECT id FROM teams WHERE league_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`,
          [leagueId, name]
        );
        if (exists.length) {
          skipped += 1;
          continue;
        }
        try {
          await query(`INSERT INTO teams (league_id, name) VALUES (?, ?)`, [leagueId, name]);
          teamsCreated += 1;
        } catch (insertErr) {
          if (insertErr && insertErr.code === '23505') {
            await syncTeamsIdSequence();
            await query(`INSERT INTO teams (league_id, name) VALUES (?, ?)`, [leagueId, name]);
            teamsCreated += 1;
          } else {
            throw insertErr;
          }
        }
      }
      const imported = teamsCreated;
      return res.json({
        message: 'Import squadre completato',
        type: 'teams',
        teams_created: teamsCreated,
        imported,
        skipped,
        errors,
      });
    }

    for (let i = 0; i < rows.length; i += 1) {
      const rowNum = i + 2;
      const mapped = mapPlayerCsvRow(rows[i]);
      const { teamName, firstName, lastName, role, ratingRaw, shirtRaw, yearRaw } = mapped;

      if (!teamName || !firstName || !lastName || !['P', 'D', 'C', 'A'].includes(role)) {
        skipped += 1;
        if (errors.length < 50) {
          errors.push(`Riga ${rowNum}: dati obbligatori mancanti o ruolo non valido`);
        }
        continue;
      }
      if (!isStrictNumericCsvValue(ratingRaw)) {
        skipped += 1;
        if (errors.length < 50) {
          errors.push(`Riga ${rowNum}: valutazione non numerica (${ratingRaw || '(vuota)'})`);
        }
        continue;
      }
      if (!isStrictNumericCsvValue(shirtRaw, { allowEmpty: true, integerOnly: true })) {
        skipped += 1;
        if (errors.length < 50) {
          errors.push(`Riga ${rowNum}: numero maglia non numerico (${shirtRaw})`);
        }
        continue;
      }
      if (yearRaw !== '' && !isStrictNumericCsvValue(yearRaw, { integerOnly: true })) {
        skipped += 1;
        if (errors.length < 50) {
          errors.push(`Riga ${rowNum}: anno non valido (${yearRaw})`);
        }
        continue;
      }
      const birthYearParsed = parseBirthYearInput(yearRaw);
      if (birthYearParsed.error) {
        skipped += 1;
        if (errors.length < 50) {
          errors.push(`Riga ${rowNum}: anno di nascita non valido (${yearRaw})`);
        }
        continue;
      }

      const rating = parseCsvDecimal(ratingRaw);
      const shirtNumber = shirtRaw === '' ? null : Number(shirtRaw);
      const birthYear = birthYearParsed.value;

      let team = await query(
        `SELECT id FROM teams WHERE league_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`,
        [leagueId, teamName]
      );
      if (!team.length) {
        try {
          const insTeam = await query(
            `INSERT INTO teams (league_id, name) VALUES (?, ?) RETURNING id`,
            [leagueId, teamName]
          );
          team = [{ id: insTeam.insertId }];
          teamsCreated += 1;
        } catch (insertErr) {
          if (insertErr && insertErr.code === '23505') {
            await syncTeamsIdSequence();
            const insTeam = await query(
              `INSERT INTO teams (league_id, name) VALUES (?, ?) RETURNING id`,
              [leagueId, teamName]
            );
            team = [{ id: insTeam.insertId }];
            teamsCreated += 1;
          } else {
            throw insertErr;
          }
        }
      }

      const teamId = Number(team[0].id);
      const existingPlayer = await query(
        `SELECT p.id
         FROM players p
         JOIN teams t ON t.id = p.team_id
         WHERE t.league_id = ? AND p.team_id = ? AND LOWER(p.first_name) = LOWER(?) AND LOWER(p.last_name) = LOWER(?) AND p.role = ?
         LIMIT 1`,
        [leagueId, teamId, firstName, lastName, role]
      );
      if (existingPlayer.length) {
        const playerId = Number(existingPlayer[0].id);
        try {
          await query(
            `UPDATE players SET rating = ?, shirt_number = ?, birth_year = ? WHERE id = ?`,
            [rating, shirtNumber, birthYear, playerId]
          );
        } catch (_) {
          try {
            await query(
              `UPDATE players SET rating = ?, numero_maglia = ?, birth_year = ? WHERE id = ?`,
              [rating, shirtNumber, birthYear, playerId]
            );
          } catch (__) {
            try {
              await query(
                `UPDATE players SET rating = ?, birth_year = ? WHERE id = ?`,
                [rating, birthYear, playerId]
              );
            } catch (___) {
              await query(`UPDATE players SET rating = ? WHERE id = ?`, [rating, playerId]).catch(() => {});
            }
          }
        }
        skipped += 1;
        continue;
      }

      await insertCsvPlayer(teamId, firstName, lastName, role, rating, shirtNumber, birthYear);
      playersCreated += 1;
    }

    const imported = playersCreated + teamsCreated;
    return res.json({
      message: 'Import giocatori completato',
      type: 'players',
      teams_created: teamsCreated,
      players_created: playersCreated,
      imported,
      skipped,
      errors,
    });
  } catch (error) {
    console.error('CSV import error:', error);
    return res.status(500).json({ message: 'Errore import CSV', error: error.message });
  }
});

// POST /api/leagues/:id/join
router.post('/:id/join', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });

    const leagueRows = await query(
      `SELECT id, name, access_code, initial_budget
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [leagueId]
    );
    const league = leagueRows[0];
    if (!league) return res.status(404).json({ message: 'Lega non trovata' });

    const already = await query(
      `SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ? LIMIT 1`,
      [leagueId, userId]
    );
    if (already.length > 0) {
      return res.status(200).json({ message: 'Sei già iscritto a questa lega', leagueId });
    }

    const incomingCode = String(req.body?.accessCode ?? req.body?.access_code ?? '').trim();
    const requiredCode = String(league.access_code || '').trim();
    if (requiredCode && incomingCode !== requiredCode) {
      return res.status(400).json({ message: 'Codice di accesso errato' });
    }

    const requireApproval = await getRequireJoinApproval(leagueId);
    if (requireApproval) {
      await ensureJoinRequestsTable();
      await query(
        `INSERT INTO league_join_requests (league_id, user_id, status, requested_at, reviewed_at, reviewed_by)
         VALUES (?, ?, 'pending', NOW(), NULL, NULL)
         ON CONFLICT (league_id, user_id)
         DO UPDATE SET
           status = 'pending',
           requested_at = NOW(),
           reviewed_at = NULL,
           reviewed_by = NULL`,
        [leagueId, userId]
      );
      return res.status(202).json({ message: 'Richiesta di iscrizione inviata in attesa di approvazione', pending: true, leagueId });
    }

    await addUserToLeagueWithInitialBudget(userId, leagueId, Number(league.initial_budget || 100));

    res.json({ message: 'Iscrizione completata', leagueId });
  } catch (error) {
    console.error('Join league error:', error);
    res.status(500).json({ message: 'Errore durante l\'iscrizione alla lega' });
  }
});

// POST /api/leagues/:id/leave
router.post('/:id/leave', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });

    const members = await query(
      `SELECT user_id, role FROM league_members WHERE league_id = ?`,
      [leagueId]
    );
    const me = members.find((m) => Number(m.user_id) === userId);
    if (!me) return res.status(404).json({ message: 'Non risulti membro di questa lega' });

    const others = members.filter((m) => Number(m.user_id) !== userId);
    const adminCount = members.filter((m) => String(m.role) === 'admin').length;
    const newAdminId = req.body?.new_admin_id ? Number(req.body.new_admin_id) : null;

    if (String(me.role) === 'admin' && adminCount <= 1 && others.length > 0) {
      if (!newAdminId || !others.some((m) => Number(m.user_id) === newAdminId)) {
        return res.status(400).json({ message: 'Sei l\'unico admin: seleziona un nuovo admin prima di uscire' });
      }
      await query(
        `UPDATE league_members SET role = 'admin' WHERE league_id = ? AND user_id = ?`,
        [leagueId, newAdminId]
      );
    }

    await deleteUserFantasyLeagueParticipationData(leagueId, userId);
    await query(`DELETE FROM league_members WHERE league_id = ? AND user_id = ?`, [leagueId, userId]);
    await query(`DELETE FROM user_budget WHERE league_id = ? AND user_id = ?`, [leagueId, userId]);
    await query(`DELETE FROM user_league_prefs WHERE league_id = ? AND user_id = ?`, [leagueId, userId]);

    // Se resta vuota, elimina la lega.
    const leftRows = await query(`SELECT COUNT(*)::int AS c FROM league_members WHERE league_id = ?`, [leagueId]);
    const left = Number(leftRows[0]?.c || 0);
    if (left <= 0) {
      await query(`DELETE FROM leagues WHERE id = ?`, [leagueId]);
    }

    res.json({ message: 'Hai lasciato la lega con successo' });
  } catch (error) {
    console.error('Leave league error:', error);
    res.status(500).json({ message: 'Errore durante l\'abbandono della lega' });
  }
});

// POST /api/leagues - creazione lega base
router.post('/', authenticateToken, async (req, res) => {
  try {
    await ensureLeaguesAccessCodeNotGloballyUnique();
    const userId = Number(req.user.userId);
    const body = req.body || {};
    const pickFirst = (...vals) => vals.find((v) => v !== undefined);
    const {
      name,
      access_code = null,
      initial_budget = 100,
      default_deadline_time = '20:00:00',
      max_portieri = 3,
      max_difensori = 8,
      max_centrocampisti = 8,
      max_attaccanti = 6,
      numero_titolari = 11,
      auto_lineup_mode = 0,
      team_name = 'Squadra 1',
      coach_name = 'Allenatore 1',
      team_logo = 'default_1',
    } = body;

    const accessCodeRaw = pickFirst(body.accessCode, access_code);
    const initialBudget = pickFirst(body.initialBudget, initial_budget);
    const defaultDeadlineTime = pickFirst(body.defaultTime, body.default_deadline_time, default_deadline_time);
    const maxPortieri = pickFirst(body.maxPortieri, max_portieri);
    const maxDifensori = pickFirst(body.maxDifensori, max_difensori);
    const maxCentrocampisti = pickFirst(body.maxCentrocampisti, max_centrocampisti);
    const maxAttaccanti = pickFirst(body.maxAttaccanti, max_attaccanti);
    const numeroTitolari = pickFirst(body.numeroTitolari, numero_titolari);
    const autoLineupMode = pickFirst(body.autoLineupMode, auto_lineup_mode);
    const linkedToLeagueRaw = pickFirst(body.linked_to_league_id, body.linkedToLeagueId, null);
    const linkedToLeagueId = linkedToLeagueRaw == null ? null : Number(linkedToLeagueRaw);
    const requireApprovalRaw = pickFirst(body.requireApproval, body.require_approval, 0);
    const requireApproval = Number(requireApprovalRaw) ? 1 : 0;
    const incomingBonusSettings = body.bonusSettings ?? body.bonus_settings ?? null;

    if (!name || String(name).trim() === '') {
      return res.status(400).json({ message: 'Nome lega obbligatorio' });
    }
    if (linkedToLeagueId != null && (!Number.isFinite(linkedToLeagueId) || linkedToLeagueId <= 0)) {
      return res.status(400).json({ message: 'linked_to_league_id non valido' });
    }

    if (linkedToLeagueId) {
      const linkedRows = await query(
        `SELECT id
         FROM leagues
         WHERE id = ?
           AND COALESCE(is_official, 0) = 1
           AND COALESCE(is_visible_for_linking, 1) = 1
         LIMIT 1`,
        [linkedToLeagueId]
      );
      if (!Array.isArray(linkedRows) || linkedRows.length <= 0) {
        return res.status(400).json({ message: 'La lega ufficiale selezionata non è disponibile per il collegamento' });
      }
    }

    const accessCode = normalizeLeagueAccessCodeInput(accessCodeRaw);

    const insertLeagueParams = [
      String(name).trim(),
      accessCode,
      userId,
      Number(initialBudget),
      String(defaultDeadlineTime),
      Number(maxPortieri),
      Number(maxDifensori),
      Number(maxCentrocampisti),
      Number(maxAttaccanti),
      Number(numeroTitolari),
      Number(autoLineupMode),
      linkedToLeagueId || null,
    ];
    const insertLeagueSql = `
      INSERT INTO leagues
        (name, access_code, creator_id, initial_budget, default_deadline_time, max_portieri, max_difensori, max_centrocampisti, max_attaccanti, numero_titolari, auto_lineup_mode, linked_to_league_id, is_hidden_from_discovery, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())
       RETURNING id`;

    let insertLeague;
    try {
      insertLeague = await query(insertLeagueSql, insertLeagueParams);
    } catch (insertError) {
      if (isLeaguesPrimaryKeyDuplicateError(insertError)) {
        await syncLeaguesIdSequence();
        insertLeague = await query(insertLeagueSql, insertLeagueParams);
      } else {
        throw insertError;
      }
    }

    const leagueId = Number(
      insertLeague?.insertId ||
      insertLeague?.rows?.[0]?.id ||
      insertLeague?.[0]?.id ||
      0
    );
    if (!leagueId || leagueId <= 0) {
      return res.status(500).json({ message: 'Errore creazione lega: id non restituito dal database' });
    }

    // Salva approvazione iscrizioni nella tabella corretta usata dal mercato/impostazioni.
    try {
      await query(
        `INSERT INTO league_market_settings (league_id, market_locked, require_approval)
         VALUES (?, 0, ?)
         ON CONFLICT (league_id)
         DO UPDATE SET require_approval = EXCLUDED.require_approval`,
        [leagueId, requireApproval]
      );
    } catch (approvalErr) {
      console.log('league_market_settings require_approval upsert skipped:', approvalErr?.message || approvalErr);
    }

    // Allineamento legacy: salva bonusSettings iniziali quando passati dal client.
    if (incomingBonusSettings && typeof incomingBonusSettings === 'object') {
      try {
        const bs = normalizeBonusSettings(incomingBonusSettings);
        await query(
          `INSERT INTO league_bonus_settings (
             league_id, enable_bonus_malus, enable_goal, bonus_goal, enable_assist, bonus_assist,
             enable_yellow_card, malus_yellow_card, enable_red_card, malus_red_card,
             enable_goals_conceded, malus_goals_conceded, enable_own_goal, malus_own_goal,
             enable_penalty_missed, malus_penalty_missed, enable_penalty_saved, bonus_penalty_saved,
             enable_clean_sheet, bonus_clean_sheet,
             enable_pallone_fuori, malus_pallone_fuori, enable_briso, bonus_briso,
             enable_no_divisa, malus_no_divisa
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (league_id)
           DO UPDATE SET
             enable_bonus_malus = EXCLUDED.enable_bonus_malus,
             enable_goal = EXCLUDED.enable_goal,
             bonus_goal = EXCLUDED.bonus_goal,
             enable_assist = EXCLUDED.enable_assist,
             bonus_assist = EXCLUDED.bonus_assist,
             enable_yellow_card = EXCLUDED.enable_yellow_card,
             malus_yellow_card = EXCLUDED.malus_yellow_card,
             enable_red_card = EXCLUDED.enable_red_card,
             malus_red_card = EXCLUDED.malus_red_card,
             enable_goals_conceded = EXCLUDED.enable_goals_conceded,
             malus_goals_conceded = EXCLUDED.malus_goals_conceded,
             enable_own_goal = EXCLUDED.enable_own_goal,
             malus_own_goal = EXCLUDED.malus_own_goal,
             enable_penalty_missed = EXCLUDED.enable_penalty_missed,
             malus_penalty_missed = EXCLUDED.malus_penalty_missed,
             enable_penalty_saved = EXCLUDED.enable_penalty_saved,
             bonus_penalty_saved = EXCLUDED.bonus_penalty_saved,
             enable_clean_sheet = EXCLUDED.enable_clean_sheet,
             bonus_clean_sheet = EXCLUDED.bonus_clean_sheet,
             enable_pallone_fuori = EXCLUDED.enable_pallone_fuori,
             malus_pallone_fuori = EXCLUDED.malus_pallone_fuori,
             enable_briso = EXCLUDED.enable_briso,
             bonus_briso = EXCLUDED.bonus_briso,
             enable_no_divisa = EXCLUDED.enable_no_divisa,
             malus_no_divisa = EXCLUDED.malus_no_divisa`,
          [
            leagueId,
            bs.enable_bonus_malus, bs.enable_goal, bs.bonus_goal, bs.enable_assist, bs.bonus_assist,
            bs.enable_yellow_card, bs.malus_yellow_card, bs.enable_red_card, bs.malus_red_card,
            bs.enable_goals_conceded, bs.malus_goals_conceded, bs.enable_own_goal, bs.malus_own_goal,
            bs.enable_penalty_missed, bs.malus_penalty_missed, bs.enable_penalty_saved, bs.bonus_penalty_saved,
            bs.enable_clean_sheet, bs.bonus_clean_sheet,
            bs.enable_pallone_fuori, bs.malus_pallone_fuori, bs.enable_briso, bs.bonus_briso,
            bs.enable_no_divisa, bs.malus_no_divisa,
          ]
        );
      } catch (bonusErr) {
        console.log('league_bonus_settings upsert skipped:', bonusErr?.message || bonusErr);
      }
    }

    try {
      await query(
        `INSERT INTO league_members (league_id, user_id, role)
         VALUES (?, ?, 'admin')
         ON CONFLICT (league_id, user_id) DO NOTHING`,
        [leagueId, userId]
      );
    } catch (memberErr) {
      if (memberErr && memberErr.code === '23505') {
        await syncLeagueMembersIdSequence();
        await query(
          `INSERT INTO league_members (league_id, user_id, role)
           VALUES (?, ?, 'admin')
           ON CONFLICT (league_id, user_id) DO NOTHING`,
          [leagueId, userId]
        );
      } else {
        throw memberErr;
      }
    }

    // Optional: se la tabella è presente, crea anagrafica squadra utente.
    try {
      await query(
        `INSERT INTO user_budget (user_id, league_id, budget, team_name, coach_name, team_logo)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, leagueId, Number(initialBudget), String(team_name), String(coach_name), String(team_logo)]
      );
    } catch (budgetErr) {
      console.log('user_budget insert skipped:', budgetErr.message);
    }

    const createdLeague = await getLeagueByIdForUser(leagueId, userId);
    return res.status(201).json(
      createdLeague || {
        id: leagueId,
        name: String(name).trim(),
        role: 'admin',
      }
    );
  } catch (error) {
    console.error('Create league error:', error);
    res.status(500).json({ message: 'Errore durante la creazione lega' });
  }
});

module.exports = router;

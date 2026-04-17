const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

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
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, userTeamLogosDir),
    filename: (_req, file, cb) => cb(null, imageFilename('team', file.originalname)),
  }),
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

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsvLine(line) {
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
    if (ch === ',' && !inQuotes) {
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
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((h) => String(h || '').trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] != null ? String(values[idx]).trim() : '';
    });
    rows.push(row);
  }
  return rows;
}

async function syncLeaguesIdSequence() {
  await query(
    "SELECT setval(pg_get_serial_sequence('leagues','id'), COALESCE((SELECT MAX(id) FROM leagues), 0) + 1, false)"
  );
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

function computeBonusTotal(vote, bonusSettings) {
  if (Number(bonusSettings.enable_bonus_malus || 0) !== 1) return 0;
  let bonus = 0;
  if (Number(bonusSettings.enable_goal || 0) === 1) {
    bonus += Number(vote.goals || 0) * Number(bonusSettings.bonus_goal || 0);
  }
  if (Number(bonusSettings.enable_assist || 0) === 1) {
    bonus += Number(vote.assists || 0) * Number(bonusSettings.bonus_assist || 0);
  }
  if (Number(bonusSettings.enable_yellow_card || 0) === 1) {
    bonus += Number(vote.yellow_cards || 0) * Number(bonusSettings.malus_yellow_card || 0);
  }
  if (Number(bonusSettings.enable_red_card || 0) === 1) {
    bonus += Number(vote.red_cards || 0) * Number(bonusSettings.malus_red_card || 0);
  }
  if (Number(bonusSettings.enable_goals_conceded || 0) === 1) {
    bonus += Number(vote.goals_conceded || 0) * Number(bonusSettings.malus_goals_conceded || 0);
  }
  if (Number(bonusSettings.enable_own_goal || 0) === 1) {
    bonus += Number(vote.own_goals || 0) * Number(bonusSettings.malus_own_goal || 0);
  }
  if (Number(bonusSettings.enable_penalty_missed || 0) === 1) {
    bonus += Number(vote.penalty_missed || 0) * Number(bonusSettings.malus_penalty_missed || 0);
  }
  if (Number(bonusSettings.enable_penalty_saved || 0) === 1) {
    bonus += Number(vote.penalty_saved || 0) * Number(bonusSettings.bonus_penalty_saved || 0);
  }
  if (Number(bonusSettings.enable_clean_sheet || 0) === 1) {
    bonus += Number(vote.clean_sheet || 0) * Number(bonusSettings.bonus_clean_sheet || 0);
  }
  return bonus;
}

const AUTO_MODULES = {
  '1-1-1': [1, 1, 1],
  '1-1-2': [1, 1, 2], '1-2-1': [1, 2, 1], '2-1-1': [2, 1, 1],
  '1-2-2': [1, 2, 2], '2-2-1': [2, 2, 1], '2-1-2': [2, 1, 2], '3-1-1': [3, 1, 1],
  '2-2-2': [2, 2, 2], '3-2-1': [3, 2, 1], '2-3-1': [2, 3, 1], '1-3-2': [1, 3, 2], '3-1-2': [3, 1, 2],
  '3-2-2': [3, 2, 2], '2-3-2': [2, 3, 2], '2-2-3': [2, 2, 3], '4-2-1': [4, 2, 1], '3-3-1': [3, 3, 1], '4-3-1': [4, 3, 1],
  '3-3-2': [3, 3, 2], '3-2-3': [3, 2, 3], '2-3-3': [2, 3, 3], '4-2-2': [4, 2, 2],
  '3-3-3': [3, 3, 3], '4-2-3': [4, 2, 3], '3-4-2': [3, 4, 2], '2-4-3': [2, 4, 3], '5-2-2': [5, 2, 2],
  '4-3-2': [4, 3, 2], '2-5-2': [2, 5, 2], '3-5-1': [3, 5, 1], '4-4-1': [4, 4, 1],
  '4-4-2': [4, 4, 2], '4-3-3': [4, 3, 3], '3-5-2': [3, 5, 2], '4-5-1': [4, 5, 1], '5-3-2': [5, 3, 2],
  '5-4-1': [5, 4, 1], '5-2-3': [5, 2, 3], '3-4-3': [3, 4, 3], '2-5-3': [2, 5, 3],
};

function pickTopPlayers(players, count) {
  if (!Array.isArray(players) || count <= 0) return [];
  return players
    .slice()
    .sort((a, b) => (b.total - a.total) || (a.id - b.id))
    .slice(0, count);
}

async function buildAutoLineupSimple(leagueId, userId, numeroTitolari, votesByPlayer, bonusSettings, use6Politico) {
  const rows = await query(
    `SELECT p.id, p.role
     FROM user_players up
     JOIN players p ON p.id = up.player_id
     WHERE up.league_id = ? AND up.user_id = ?`,
    [leagueId, userId]
  );
  if (!rows.length) return [];

  const enriched = rows.map((p) => {
    const vote = votesByPlayer[Number(p.id)] || {};
    let rating = Number(vote.rating || 0);
    if (rating <= 0 && use6Politico) rating = 6;
    const bonus = rating > 0 ? computeBonusTotal({ ...vote, rating }, bonusSettings) : 0;
    return {
      id: Number(p.id),
      role: p.role || '',
      total: rating > 0 ? (rating + bonus) : 0,
      hasVote: rating > 0,
    };
  });

  const valid = enriched.filter((p) => p.hasVote);
  const n = Math.max(0, Number(numeroTitolari || 11));
  if (!valid.length || n <= 0) return [];

  const portieri = valid.filter((p) => p.role === 'P');
  const difensori = valid.filter((p) => p.role === 'D');
  const centrocampisti = valid.filter((p) => p.role === 'C');
  const attaccanti = valid.filter((p) => p.role === 'A');

  // Portiere sempre obbligatorio quando possibile.
  const bestGk = pickTopPlayers(portieri, 1);
  const movSlots = Math.max(0, n - bestGk.length);
  if (movSlots <= 0) return bestGk.map((p) => p.id);

  const candidateModules = Object.values(AUTO_MODULES)
    .filter(([d, c, a]) => (d + c + a) === movSlots)
    .map(([d, c, a]) => ({ d, c, a }));

  let best = null;
  for (const mod of candidateModules) {
    if (difensori.length < mod.d || centrocampisti.length < mod.c || attaccanti.length < mod.a) continue;
    const chosen = [
      ...bestGk,
      ...pickTopPlayers(difensori, mod.d),
      ...pickTopPlayers(centrocampisti, mod.c),
      ...pickTopPlayers(attaccanti, mod.a),
    ];
    if (chosen.length !== n) continue;
    const total = chosen.reduce((acc, p) => acc + Number(p.total || 0), 0);
    if (!best || total > best.total) {
      best = { total, chosen };
    }
  }

  if (best) return best.chosen.map((p) => p.id);

  // Fallback: migliore n per punteggio (se la rosa non copre un modulo valido).
  return valid
    .slice()
    .sort((a, b) => (b.total - a.total) || (a.id - b.id))
    .slice(0, n)
    .map((p) => p.id);
}

async function getLeagueBonusSettings(leagueId) {
  try {
    const rows = await query(
      `SELECT enable_bonus_malus, enable_goal, bonus_goal, enable_assist, bonus_assist,
              enable_yellow_card, malus_yellow_card, enable_red_card, malus_red_card,
              enable_goals_conceded, malus_goals_conceded, enable_own_goal, malus_own_goal,
              enable_penalty_missed, malus_penalty_missed, enable_penalty_saved, bonus_penalty_saved,
              enable_clean_sheet, bonus_clean_sheet
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
      `SELECT COALESCE(require_approval, 0) AS require_approval
       FROM leagues
       WHERE id = ?
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

let joinRequestsTableReady = false;
async function ensureJoinRequestsTable() {
  joinRequestsTableReady = true;
  return false;
}

async function getLeagueByIdForUser(leagueId, userId) {
  const rows = await query(
    `SELECT l.id, l.name, l.access_code, l.creator_id, l.created_at,
            l.initial_budget, l.default_deadline_time, l.max_portieri, l.max_difensori,
            l.max_centrocampisti, l.max_attaccanti, l.numero_titolari, l.auto_lineup_mode,
            l.linked_to_league_id,
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

// GET /api/leagues - leghe dell'utente loggato
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user.userId);
    const leagues = await query(
      `SELECT l.id, l.name, l.access_code, l.creator_id, l.created_at,
              l.initial_budget, l.default_deadline_time, l.max_portieri, l.max_difensori,
              l.max_centrocampisti, l.max_attaccanti, l.numero_titolari, l.auto_lineup_mode,
              l.linked_to_league_id,
              ll.name AS linked_league_name,
              lm.role, ub.team_name, ub.coach_name, ub.team_logo,
              COALESCE(ulp.favorite, 0) AS favorite,
              COALESCE(ulp.archived, 0) AS archived,
              COALESCE(ulp.notifications_enabled, 1) AS notifications_enabled,
              (SELECT COUNT(*)::int FROM league_members lm2 WHERE lm2.league_id = l.id) AS user_count,
              (SELECT COUNT(*)::int FROM league_members lm2 WHERE lm2.league_id = l.id) AS member_count,
              0 AS market_locked,
              NULL AS current_matchday
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
    const userId = Number(req.user.userId);
    const leagues = await query(
      `SELECT l.id, l.name, l.access_code, l.creator_id, l.created_at,
              l.initial_budget, l.default_deadline_time, l.max_portieri, l.max_difensori,
              l.max_centrocampisti, l.max_attaccanti, l.numero_titolari, l.auto_lineup_mode,
              l.linked_to_league_id,
              ll.name AS linked_league_name,
              my.role,
              COALESCE(ulp.favorite, 0) AS favorite,
              COALESCE(ulp.archived, 0) AS archived,
              COALESCE(ulp.notifications_enabled, 1) AS notifications_enabled,
              CASE WHEN my.user_id IS NULL THEN 0 ELSE 1 END AS is_joined,
              (SELECT COUNT(*) FROM league_members lm2 WHERE lm2.league_id = l.id) AS user_count,
              0 AS market_locked,
              NULL AS current_matchday
       FROM leagues l
       LEFT JOIN leagues ll ON ll.id = l.linked_to_league_id
       LEFT JOIN league_members my ON my.league_id = l.id AND my.user_id = ?
       LEFT JOIN user_league_prefs ulp ON ulp.league_id = l.id AND ulp.user_id = ?
       WHERE my.user_id IS NULL
       ORDER BY l.created_at DESC, l.id DESC`,
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
              0 AS market_locked,
              NULL AS current_matchday
       FROM leagues l
       LEFT JOIN leagues ll ON ll.id = l.linked_to_league_id
       LEFT JOIN league_members my ON my.league_id = l.id AND my.user_id = ?
       WHERE l.name ILIKE ?
         AND my.user_id IS NULL
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

    const league = await getLeagueByIdForUser(leagueId, userId);
    if (!league) {
      return res.status(404).json({ message: 'Lega non trovata o accesso negato' });
    }
    res.json(league);
  } catch (error) {
    console.error('Get league by id error:', error);
    res.status(500).json({ message: 'Errore nel recupero lega' });
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
    await query(
      `UPDATE user_budget
       SET team_name = ?, coach_name = ?
       WHERE user_id = ? AND league_id = ?`,
      [teamName, coachName, userId, leagueId]
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
    const logoPath = `uploads/team_logos/${req.file.filename}`;
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

    let rows = [];
    try {
      rows = await query(
        `SELECT mr.user_id AS id, u.username, COALESCE(ub.team_name, u.username) AS team_name,
                SUM(mr.punteggio)::float AS punteggio,
                AVG(mr.punteggio)::float AS media_punti
         FROM matchday_results mr
         JOIN users u ON u.id = mr.user_id
         LEFT JOIN user_budget ub ON ub.user_id = mr.user_id AND ub.league_id = mr.league_id
         WHERE mr.league_id = ?
         GROUP BY mr.user_id, u.username, ub.team_name
         ORDER BY punteggio DESC, media_punti DESC
         LIMIT ?`,
        [leagueId, limit]
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
    const memberId = Number(req.body?.member_id);
    const newRole = String(req.body?.new_role || '').trim();
    if (!leagueId || !Number.isFinite(memberId) || !['admin', 'user'].includes(newRole)) {
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

// GET /api/leagues/:id/join-requests (compat fallback)
router.get('/:id/join-requests', authenticateToken, async (req, res) => {
  return res.status(410).json({ message: 'Feature join-requests disabilitata' });
});

// POST /api/leagues/:id/join-requests/:requestId/approve (compat fallback)
router.post('/:id/join-requests/:requestId/approve', authenticateToken, async (req, res) => {
  return res.status(410).json({ message: 'Feature join-requests disabilitata' });
});

// POST /api/leagues/:id/join-requests/:requestId/reject (compat fallback)
router.post('/:id/join-requests/:requestId/reject', authenticateToken, async (req, res) => {
  return res.status(410).json({ message: 'Feature join-requests disabilitata' });
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
    const ext = path.extname(String(req.file.originalname || '')).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    const ts = Math.floor(Date.now() / 1000);
    // Naming legacy: official_team_<teamId>_<timestamp>.<ext>
    const filename = `official_team_${teamId}_${ts}${safeExt}`;
    const storagePath = `official_team_logos/${filename}`;

    // Pulisce i vecchi logo del team (anche formato nome fisso precedente) prima del nuovo upload.
    try {
      const { data: existing, error: listErr } = await supabase.storage.from('uploads').list('official_team_logos', {
        limit: 2000,
      });
      if (!listErr && Array.isArray(existing)) {
        const toDelete = existing
          .map((f) => String(f?.name || '').trim())
          .filter((name) => name.startsWith(`official_team_${teamId}_`) || /^official_team_\d+\.(jpg|jpeg|png|webp)$/i.test(name) && name.startsWith(`official_team_${teamId}.`))
          .map((name) => `official_team_logos/${name}`);
        if (toDelete.length > 0) {
          const { data: removed, error: removeErr } = await supabase.storage.from('uploads').remove(toDelete);
        }
      }
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
      await query(
        `UPDATE teams
         SET logo_path = ?
         WHERE id = ? AND league_id = ?`,
        [logoPath, teamId, leagueId]
      );
    } catch (_) {
      // Colonna logo_path non presente: fallback compat.
    }
    res.json({ message: 'Logo squadra ufficiale aggiornato', logo_path: logoPath });
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
      await query(
        `UPDATE teams
         SET logo_path = NULL
         WHERE id = ? AND league_id = ?`,
        [teamId, leagueId]
      );
    } catch (_) {
      // Colonna non presente: ignore.
    }
    res.json({ message: 'Logo squadra ufficiale rimosso' });
  } catch (error) {
    console.error('Remove official team logo error:', error);
    res.status(500).json({ message: 'Errore rimozione logo squadra ufficiale' });
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
              ) AS shirt_number
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
    const shirtNumber = req.body?.shirt_number === '' || req.body?.shirt_number == null
      ? null
      : Number(req.body.shirt_number);
    if (!leagueId || !Number.isFinite(teamId) || !firstName || !lastName || !['P', 'D', 'C', 'A'].includes(role)) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    let ins;
    try {
      try {
        ins = await query(
          `INSERT INTO players (team_id, first_name, last_name, role, shirt_number)
           VALUES (?, ?, ?, ?, ?)
           RETURNING id`,
          [teamId, firstName, lastName, role, shirtNumber]
        );
      } catch (_) {
        try {
          ins = await query(
            `INSERT INTO players (team_id, first_name, last_name, role, numero_maglia)
             VALUES (?, ?, ?, ?, ?)
             RETURNING id`,
            [teamId, firstName, lastName, role, shirtNumber]
          );
        } catch (_) {
          ins = await query(
            `INSERT INTO players (team_id, first_name, last_name, role)
             VALUES (?, ?, ?, ?)
             RETURNING id`,
            [teamId, firstName, lastName, role]
          );
        }
      }
    } catch (insertErr) {
      if (insertErr && insertErr.code === '23505') {
        await syncPlayersIdSequence();
        try {
          ins = await query(
            `INSERT INTO players (team_id, first_name, last_name, role, shirt_number)
             VALUES (?, ?, ?, ?, ?)
             RETURNING id`,
            [teamId, firstName, lastName, role, shirtNumber]
          );
        } catch (_) {
          try {
            ins = await query(
              `INSERT INTO players (team_id, first_name, last_name, role, numero_maglia)
               VALUES (?, ?, ?, ?, ?)
               RETURNING id`,
              [teamId, firstName, lastName, role, shirtNumber]
            );
          } catch (_) {
            ins = await query(
              `INSERT INTO players (team_id, first_name, last_name, role)
               VALUES (?, ?, ?, ?)
               RETURNING id`,
              [teamId, firstName, lastName, role]
            );
          }
        }
      } else {
        throw insertErr;
      }
    }
    res.status(201).json({ id: ins.insertId, first_name: firstName, last_name: lastName, role, shirt_number: shirtNumber });
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
    const shirtNumber = req.body?.shirt_number === '' || req.body?.shirt_number == null
      ? null
      : Number(req.body.shirt_number);
    if (!leagueId || !Number.isFinite(teamId) || !Number.isFinite(playerId)) {
      return res.status(400).json({ message: 'Parametri non validi' });
    }
    try {
      await query(
        `UPDATE players p
         SET first_name = COALESCE(?, first_name),
             last_name = COALESCE(?, last_name),
             role = COALESCE(?, role),
             shirt_number = ?
         FROM teams t
         WHERE p.id = ? AND p.team_id = ? AND t.id = p.team_id AND t.league_id = ?`,
        [firstName, lastName, role, shirtNumber, playerId, teamId, leagueId]
      );
    } catch (_) {
      try {
        await query(
          `UPDATE players p
           SET first_name = COALESCE(?, first_name),
               last_name = COALESCE(?, last_name),
               role = COALESCE(?, role),
               numero_maglia = ?
           FROM teams t
           WHERE p.id = ? AND p.team_id = ? AND t.id = p.team_id AND t.league_id = ?`,
          [firstName, lastName, role, shirtNumber, playerId, teamId, leagueId]
        );
      } catch (_) {
        await query(
          `UPDATE players p
           SET first_name = COALESCE(?, first_name),
               last_name = COALESCE(?, last_name),
               role = COALESCE(?, role)
           FROM teams t
           WHERE p.id = ? AND p.team_id = ? AND t.id = p.team_id AND t.league_id = ?`,
          [firstName, lastName, role, playerId, teamId, leagueId]
        );
      }
    }
    res.json({ message: 'Giocatore aggiornato' });
  } catch (error) {
    console.error('Update player error:', error);
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

// GET /api/leagues/:id/standings/full - placeholder minimo
router.get('/:id/standings/full', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });

    try {
      const rows = await query(
        `SELECT mr.user_id AS id, u.username,
                COALESCE(ub.team_name, u.username) AS team_name,
                SUM(mr.punteggio)::float AS punteggio,
                AVG(mr.punteggio)::float AS media_punti
         FROM matchday_results mr
         JOIN users u ON u.id = mr.user_id
         LEFT JOIN user_budget ub ON ub.user_id = mr.user_id AND ub.league_id = mr.league_id
         WHERE mr.league_id = ?
         GROUP BY mr.user_id, u.username, ub.team_name
         ORDER BY punteggio DESC, media_punti DESC`,
        [leagueId]
      );
      return res.json(rows);
    } catch (_) {
      // Fallback senza risultati calcolati.
      const rows = await query(
        `SELECT lm.user_id AS id, u.username, COALESCE(ub.team_name, u.username) AS team_name,
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

// GET /api/leagues/:id/user-stats - placeholder minimo
router.get('/:id/user-stats', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const userId = Number(req.user.userId);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    try {
      const rows = await query(
        `SELECT giornata, punteggio
         FROM matchday_results
         WHERE league_id = ? AND user_id = ?
         ORDER BY giornata ASC`,
        [leagueId, userId]
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

    const bonusSettings = await getLeagueBonusSettings(leagueId);
    const lineRows = await query(
      `SELECT titolari
       FROM user_lineups
       WHERE league_id = ? AND giornata = ? AND user_id = ?
       LIMIT 1`,
      [leagueId, giornata, targetUserId]
    );
    const titolariRaw = lineRows[0]?.titolari;
    let playerIds = [];
    if (typeof titolariRaw === 'string' && titolariRaw.trim() !== '') {
      try {
        const p = JSON.parse(titolariRaw);
        if (Array.isArray(p)) playerIds = p.map((x) => Number(x)).filter((x) => Number.isFinite(x));
      } catch (_) {
        playerIds = titolariRaw.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
      }
    } else if (Array.isArray(titolariRaw)) {
      playerIds = titolariRaw.map((x) => Number(x)).filter((x) => Number.isFinite(x));
    }

    if (playerIds.length < 1) {
      return res.json({ formation: [], bonus_enabled: Number(bonusSettings.enable_bonus_malus) === 1, bonus_settings: bonusSettings });
    }

    const inParams = playerIds.map(() => '?').join(',');
    const pRows = await query(
      `SELECT id, first_name, last_name, role
       FROM players
       WHERE id IN (${inParams})`,
      playerIds
    );
    const byId = {};
    pRows.forEach((p) => { byId[Number(p.id)] = p; });

    let votesMap = {};
    try {
      const vRows = await query(
        `SELECT player_id, rating, goals, assists, yellow_cards, red_cards,
                goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet
         FROM player_ratings
         WHERE league_id = ? AND giornata = ?`,
        [leagueId, giornata]
      );
      votesMap = Object.fromEntries(vRows.map((v) => [Number(v.player_id), v]));
    } catch (_) {
      votesMap = {};
    }

    const formation = playerIds.map((pid) => {
      const p = byId[pid];
      if (!p) return null;
      const v = votesMap[pid] || {};
      const rating = Number(v.rating || 0);
      const goals = Number(v.goals || 0);
      const assists = Number(v.assists || 0);
      const yellow_cards = Number(v.yellow_cards || 0);
      const red_cards = Number(v.red_cards || 0);
      const final_rating = rating
        + goals * Number(bonusSettings.bonus_goal || 0)
        + assists * Number(bonusSettings.bonus_assist || 0)
        + yellow_cards * Number(bonusSettings.malus_yellow_card || 0)
        + red_cards * Number(bonusSettings.malus_red_card || 0);
      return {
        id: Number(p.id),
        first_name: p.first_name,
        last_name: p.last_name,
        role: p.role,
        rating,
        final_rating,
        goals,
        assists,
        yellow_cards,
        red_cards,
        goals_conceded: Number(v.goals_conceded || 0),
        own_goals: Number(v.own_goals || 0),
        penalty_missed: Number(v.penalty_missed || 0),
        penalty_saved: Number(v.penalty_saved || 0),
        clean_sheet: Number(v.clean_sheet || 0),
      };
    }).filter(Boolean);

    res.json({ formation, bonus_enabled: Number(bonusSettings.enable_bonus_malus) === 1, bonus_settings: bonusSettings });
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

    try {
      const rows = await query(
        `SELECT mr.user_id AS id, u.username, COALESCE(ub.team_name, u.username) AS team_name,
                mr.punteggio::float AS punteggio
         FROM matchday_results mr
         JOIN users u ON u.id = mr.user_id
         LEFT JOIN user_budget ub ON ub.user_id = mr.user_id AND ub.league_id = mr.league_id
         WHERE mr.league_id = ? AND mr.giornata = ?
         ORDER BY mr.punteggio DESC`,
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
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    let rows = await query(
      `SELECT m.giornata, m.deadline,
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
                SELECT MAX(
                  COALESCE(
                    NULLIF(to_jsonb(mr2)->>'created_at', '')::timestamp,
                    NULLIF(to_jsonb(mr2)->>'calculated_at', '')::timestamp
                  )
                )
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
        `SELECT g.giornata, NULL AS deadline,
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
                  SELECT MAX(
                    COALESCE(
                      NULLIF(to_jsonb(mr2)->>'created_at', '')::timestamp,
                      NULLIF(to_jsonb(mr2)->>'calculated_at', '')::timestamp
                    )
                  )
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
    res.json(rows);
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
         enable_clean_sheet, bonus_clean_sheet
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         bonus_clean_sheet = EXCLUDED.bonus_clean_sheet`,
      [
        leagueId,
        bs.enable_bonus_malus, bs.enable_goal, bs.bonus_goal, bs.enable_assist, bs.bonus_assist,
        bs.enable_yellow_card, bs.malus_yellow_card, bs.enable_red_card, bs.malus_red_card,
        bs.enable_goals_conceded, bs.malus_goals_conceded, bs.enable_own_goal, bs.malus_own_goal,
        bs.enable_penalty_missed, bs.malus_penalty_missed, bs.enable_penalty_saved, bs.bonus_penalty_saved,
        bs.enable_clean_sheet, bs.bonus_clean_sheet,
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
                goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet
         FROM player_ratings
         WHERE league_id = ? AND giornata = ?`,
        [effectiveLeagueId, giornata]
      );
      const mapped = {};
      rows.forEach((r) => {
        mapped[String(r.player_id)] = {
          rating: Number(r.rating || 0),
          goals: Number(r.goals || 0),
          assists: Number(r.assists || 0),
          yellow_cards: Number(r.yellow_cards || 0),
          red_cards: Number(r.red_cards || 0),
          goals_conceded: Number(r.goals_conceded || 0),
          own_goals: Number(r.own_goals || 0),
          penalty_missed: Number(r.penalty_missed || 0),
          penalty_saved: Number(r.penalty_saved || 0),
          clean_sheet: Number(r.clean_sheet || 0),
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
        rating: Number(v?.rating || 0),
        goals: Number(v?.goals || 0),
        assists: Number(v?.assists || 0),
        yellow_cards: Number(v?.yellow_cards || 0),
        red_cards: Number(v?.red_cards || 0),
        goals_conceded: Number(v?.goals_conceded || 0),
        own_goals: Number(v?.own_goals || 0),
        penalty_missed: Number(v?.penalty_missed || 0),
        penalty_saved: Number(v?.penalty_saved || 0),
        clean_sheet: Number(v?.clean_sheet || 0),
      };
      await query(
        `INSERT INTO player_ratings (
           league_id, giornata, player_id, rating, goals, assists, yellow_cards, red_cards,
           goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
           clean_sheet = EXCLUDED.clean_sheet`,
        [
          leagueId, giornata, playerId, row.rating, row.goals, row.assists, row.yellow_cards, row.red_cards,
          row.goals_conceded, row.own_goals, row.penalty_missed, row.penalty_saved, row.clean_sheet,
        ]
      );
    }
    res.json({ message: 'Voti salvati con successo' });
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
      `SELECT numero_titolari
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [leagueId]
    );
    const numeroTitolari = Number(leagueRows[0]?.numero_titolari || 11);
    const bonusSettings = await getLeagueBonusSettings(leagueId);

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
      `SELECT user_id, titolari
       FROM user_lineups
       WHERE league_id = ? AND giornata = ?`,
      [leagueId, giornata]
    );
    const lineupByUser = {};
    lineupRows.forEach((r) => {
      lineupByUser[Number(r.user_id)] = parseIdsArray(r.titolari).slice(0, numeroTitolari);
    });

    const voteRows = await query(
      `SELECT player_id, rating, goals, assists, yellow_cards, red_cards,
              goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet
       FROM player_ratings
       WHERE league_id = ? AND giornata = ?`,
      [effectiveLeagueId, giornata]
    );
    const votesByPlayer = {};
    voteRows.forEach((r) => { votesByPlayer[Number(r.player_id)] = r; });
    const playersRows = await query(
      `SELECT p.id, p.first_name, p.last_name, p.role
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
        await query(
          `DELETE FROM matchday_player_scores
           WHERE league_id = ? AND giornata = ?`,
          [leagueId, giornata]
        );
      } catch (_) {
        // Tabella opzionale: ignora se non presente.
      }
    }

    const details = [];
    const usersWith6Politico = [];
    let canWritePlayerScores = true;
    for (const m of members) {
      const userId = Number(m.user_id);
      let titolari = [];
      if (lineupByUser[userId] && lineupByUser[userId].length > 0) {
        titolari = lineupByUser[userId].filter((id) => Number.isFinite(id) && id > 0).slice(0, numeroTitolari);
      } else {
        titolari = await buildAutoLineupSimple(leagueId, userId, numeroTitolari, votesByPlayer, bonusSettings, use6Politico);
      }
      let punteggio = 0;
      let hasRealVotes = false;
      const playerScores = [];

      for (const playerId of titolari) {
        const vote = votesByPlayer[playerId] || {};
        let rating = Number(vote.rating || 0);
        if (rating > 0) hasRealVotes = true;
        if (rating <= 0 && use6Politico) rating = 6;
        if (rating <= 0) continue;
        const bonusTotal = computeBonusTotal({ ...vote, rating }, bonusSettings);
        const score = rating + bonusTotal;
        punteggio += score;
        const p = playersById[Number(playerId)];
        playerScores.push({
          player_id: Number(playerId),
          player_name: p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : `Giocatore ${playerId}`,
          player_role: p?.role || null,
          rating: Number(rating.toFixed(2)),
          goals: Number(vote.goals || 0),
          assists: Number(vote.assists || 0),
          yellow_cards: Number(vote.yellow_cards || 0),
          red_cards: Number(vote.red_cards || 0),
          goals_conceded: Number(vote.goals_conceded || 0),
          own_goals: Number(vote.own_goals || 0),
          penalty_missed: Number(vote.penalty_missed || 0),
          penalty_saved: Number(vote.penalty_saved || 0),
          clean_sheet: Number(vote.clean_sheet || 0),
          bonus_total: Number(bonusTotal.toFixed(2)),
          total_score: Number(score.toFixed(2)),
        });
      }
      if (!hasRealVotes && use6Politico && titolari.length > 0) usersWith6Politico.push(userId);

      punteggio = Number(punteggio.toFixed(2));
      await query(
        `INSERT INTO matchday_results (league_id, giornata, user_id, punteggio)
         VALUES (?, ?, ?, ?)`,
        [leagueId, giornata, userId, punteggio]
      );
      if (canWritePlayerScores) {
        try {
          for (const ps of playerScores) {
            await query(
              `INSERT INTO matchday_player_scores (
                 league_id, giornata, user_id, player_id, player_name, player_role,
                 rating, goals, assists, yellow_cards, red_cards, goals_conceded,
                 own_goals, penalty_missed, penalty_saved, clean_sheet, bonus_total, total_score
               )
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                 bonus_total = EXCLUDED.bonus_total,
                 total_score = EXCLUDED.total_score`,
              [
                leagueId, giornata, userId, ps.player_id, ps.player_name, ps.player_role,
                ps.rating, ps.goals, ps.assists, ps.yellow_cards, ps.red_cards, ps.goals_conceded,
                ps.own_goals, ps.penalty_missed, ps.penalty_saved, ps.clean_sheet, ps.bonus_total, ps.total_score,
              ]
            );
          }
        } catch (_) {
          // Tabella non disponibile: disabilita nuovi tentativi in questa request.
          canWritePlayerScores = false;
        }
      }
      details.push({ user_id: userId, punteggio, players: playerScores });
    }

    return res.json({
      success: true,
      already_calculated: false,
      recalculated: alreadyCalculated && force,
      use_6_politico: use6Politico,
      users_with_6_politico: usersWith6Politico,
      processed_users: details.length,
      results: details.sort((a, b) => b.punteggio - a.punteggio),
    });
  } catch (error) {
    console.error('Calculate matchday error:', error);
    res.status(500).json({ message: 'Errore durante il calcolo giornata' });
  }
});

// GET /api/leagues/:id/live/:giornata
router.get('/:id/live/:giornata', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    const giornata = Number(req.params.giornata);
    if (!leagueId || !Number.isFinite(giornata)) return res.status(400).json({ message: 'Parametri non validi' });
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);

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
    try {
      const existRows = await query(
        `SELECT COUNT(*)::int AS c
         FROM matchday_results
         WHERE league_id = ? AND giornata = ?`,
        [leagueId, giornata]
      );
      isCalculated = Number(existRows[0]?.c || 0) > 0;
      const cRows = await query(
        `SELECT MAX(
            COALESCE(
              NULLIF(to_jsonb(mr)->>'created_at', '')::timestamp,
              NULLIF(to_jsonb(mr)->>'calculated_at', '')::timestamp
            )
          ) AS calc_at
         FROM matchday_results mr
         WHERE mr.league_id = ? AND mr.giornata = ?`,
        [leagueId, giornata]
      );
      calculatedAt = cRows[0]?.calc_at || null;
    } catch (_) {
      try {
        const existRows = await query(
          `SELECT COUNT(*)::int AS c
           FROM matchday_results
           WHERE league_id = ? AND giornata = ?`,
          [leagueId, giornata]
        );
        isCalculated = Number(existRows[0]?.c || 0) > 0;
      } catch (_) {
        isCalculated = false;
      }
      calculatedAt = null;
    }

    if (isCalculated) {
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
           ORDER BY mr.punteggio DESC`,
          [leagueId, giornata]
        );
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
        const byUser = {};
        psRows.forEach((r) => {
          const uid = Number(r.user_id);
          if (!byUser[uid]) byUser[uid] = [];
          byUser[uid].push({
            player_id: Number(r.player_id),
            player_name: r.player_name,
            player_role: r.player_role,
            rating: Number(r.rating || 0),
            bonus_total: Number(r.bonus_total || 0),
            total_score: Number(r.total_score || 0),
          });
        });
        const calculatedResults = calcRows.map((r) => ({
          user_id: Number(r.user_id),
          username: r.username,
          team_name: r.team_name,
          coach_name: r.coach_name,
          team_logo: r.team_logo,
          punteggio: Number(Number(r.punteggio || 0).toFixed(2)),
          players: byUser[Number(r.user_id)] || [],
        }));
        return res.json({
          results: calculatedResults,
          is_calculated: true,
          calculated_at: calculatedAt,
        });
      } catch (_) {
        // Se fallisce la lettura risultati calcolati, usa fallback live on-the-fly.
      }
    }

    let ratings = [];
    try {
      ratings = await query(
        `SELECT up.user_id, pr.player_id, pr.rating, pr.goals, pr.assists, pr.yellow_cards, pr.red_cards,
                pr.goals_conceded, pr.own_goals, pr.penalty_missed, pr.penalty_saved, pr.clean_sheet,
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
    const leagueRows = await query(
      `SELECT numero_titolari
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [leagueId]
    );
    const numeroTitolari = Number(leagueRows[0]?.numero_titolari || 11);

    const votesByPlayer = {};
    const ratingsByUser = {};
    ratings.forEach((r) => {
      const pid = Number(r.player_id);
      const uid = Number(r.user_id);
      votesByPlayer[pid] = r;
      if (!ratingsByUser[uid]) ratingsByUser[uid] = [];
      ratingsByUser[uid].push(r);
    });

    const lineupRows = await query(
      `SELECT user_id, titolari
       FROM user_lineups
       WHERE league_id = ? AND giornata = ?`,
      [leagueId, giornata]
    );
    const lineupByUser = {};
    lineupRows.forEach((r) => {
      lineupByUser[Number(r.user_id)] = parseIdsArray(r.titolari).slice(0, numeroTitolari);
    });

    const sums = {};
    const playersByUser = {};
    for (const m of members) {
      const uid = Number(m.user_id);
      let titolari = lineupByUser[uid] || [];
      if (!titolari.length) {
        titolari = await buildAutoLineupSimple(leagueId, uid, numeroTitolari, votesByPlayer, bonus, false);
      }
      let total = 0;
      const detail = [];
      for (const pid of titolari) {
        const r = (ratingsByUser[uid] || []).find((x) => Number(x.player_id) === Number(pid)) || votesByPlayer[Number(pid)];
        if (!r) continue;
        const rating = Number(r.rating || 0);
        if (rating <= 0) continue;
        const bonusTotal = computeBonusTotal(r, bonus);
        const score = rating + bonusTotal;
        total += score;
        detail.push({
          player_id: Number(r.player_id),
          player_name: String(r.player_name || '').trim() || `Giocatore ${r.player_id}`,
          player_role: r.player_role || null,
          rating,
          bonus_total: Number(bonusTotal.toFixed(2)),
          total_score: Number(score.toFixed(2)),
        });
      }
      sums[uid] = Number(total.toFixed(2));
      playersByUser[uid] = detail.sort((a, b) => b.total_score - a.total_score);
    }

    const results = members.map((m) => ({
      user_id: Number(m.user_id),
      username: m.username,
      team_name: m.team_name || m.username,
      coach_name: m.coach_name || '',
      team_logo: m.team_logo || 'default_1',
      punteggio: Number((sums[Number(m.user_id)] || 0).toFixed(2)),
      players: (playersByUser[Number(m.user_id)] || []).sort((a, b) => b.total_score - a.total_score),
    })).sort((a, b) => b.punteggio - a.punteggio);

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
      `SELECT id, name, creator_id, initial_budget, default_deadline_time, numero_titolari,
              max_portieri, max_difensori, max_centrocampisti, max_attaccanti, auto_lineup_mode
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [leagueId]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ message: 'Lega non trovata' });
    res.json(row);
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
    const numeroTitolari = req.body?.numero_titolari != null ? Number(req.body.numero_titolari) : null;
    const autoLineupMode = req.body?.auto_lineup_mode != null ? Number(req.body.auto_lineup_mode) : null;

    await query(
      `UPDATE leagues
       SET default_deadline_time = COALESCE(?, default_deadline_time),
           numero_titolari = COALESCE(?, numero_titolari),
           auto_lineup_mode = COALESCE(?, auto_lineup_mode)
       WHERE id = ?`,
      [defaultDeadlineTime, Number.isFinite(numeroTitolari) ? numeroTitolari : null, Number.isFinite(autoLineupMode) ? autoLineupMode : null, leagueId]
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
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    const rows = await query(
      `SELECT id, giornata, deadline
       FROM matchdays
       WHERE league_id = ?
       ORDER BY deadline ASC`,
      [effectiveLeagueId]
    );
    const enriched = rows.map((r) => {
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
    const deadlineDate = String(req.body?.deadline_date || '').trim();
    const deadlineTime = String(req.body?.deadline_time || '20:00').trim();
    if (!deadlineDate) return res.status(400).json({ message: 'deadline_date obbligatoria' });

    const deadline = `${deadlineDate} ${deadlineTime}:00`;
    const matchdayId = req.body?.matchday_id ? Number(req.body.matchday_id) : null;

    if (matchdayId && Number.isFinite(matchdayId)) {
      await query(
        `UPDATE matchdays
         SET deadline = ?
         WHERE id = ? AND league_id = ?`,
        [deadline, matchdayId, leagueId]
      );
    } else {
      const maxRows = await query(
        `SELECT COALESCE(MAX(giornata), 0) AS max_giornata
         FROM matchdays
         WHERE league_id = ?`,
        [leagueId]
      );
      const nextGiornata = Number(maxRows[0]?.max_giornata || 0) + 1;
      await query(
        `INSERT INTO matchdays (league_id, giornata, deadline)
         VALUES (?, ?, ?)`,
        [leagueId, nextGiornata, deadline]
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
    await query('DELETE FROM matchdays WHERE id = ? AND league_id = ?', [matchdayId, leagueId]);
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
  const csv = ['name', 'Team 1', 'Team 2'].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="teams_template_league_${leagueId}.csv"`);
  return res.status(200).send(csv);
});

// GET /api/leagues/:id/csv/template/players
router.get('/:id/csv/template/players', authenticateToken, async (req, res) => {
  const leagueId = toValidLeagueId(req.params.id);
  if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
  const csv = ['team_name,first_name,last_name,role,rating', 'Team 1,Mario,Rossi,C,10'].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="players_template_league_${leagueId}.csv"`);
  return res.status(200).send(csv);
});

// GET /api/leagues/:id/csv/export/teams
router.get('/:id/csv/export/teams', authenticateToken, async (req, res) => {
  try {
    const leagueId = toValidLeagueId(req.params.id);
    if (!leagueId) return res.status(400).json({ message: 'League ID non valido' });
    const teams = await query(
      `SELECT id, name, COALESCE(logo_path, '') AS logo_path, COALESCE(jersey_color, '') AS jersey_color
       FROM teams
       WHERE league_id = ?
       ORDER BY name ASC, id ASC`,
      [leagueId]
    ).catch(async () => query(
      `SELECT id, name, '' AS logo_path, '' AS jersey_color
       FROM teams
       WHERE league_id = ?
       ORDER BY name ASC, id ASC`,
      [leagueId]
    ));
    const lines = ['id,name,logo_path,jersey_color'];
    for (const t of teams) {
      lines.push([t.id, csvEscape(t.name), csvEscape(t.logo_path), csvEscape(t.jersey_color)].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="teams_league_${leagueId}.csv"`);
    return res.status(200).send(lines.join('\n'));
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
    const players = await query(
      `SELECT p.id, t.name AS team_name, p.first_name, p.last_name, p.role, COALESCE(p.rating, 0) AS rating
       FROM players p
       JOIN teams t ON t.id = p.team_id
       WHERE t.league_id = ?
       ORDER BY t.name ASC, p.role ASC, p.last_name ASC, p.first_name ASC`,
      [leagueId]
    );
    const lines = ['id,team_name,first_name,last_name,role,rating'];
    for (const p of players) {
      lines.push([p.id, csvEscape(p.team_name), csvEscape(p.first_name), csvEscape(p.last_name), csvEscape(p.role), Number(p.rating || 0)].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="players_league_${leagueId}.csv"`);
    return res.status(200).send(lines.join('\n'));
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

    const rows = parseCsvContent(req.file.buffer.toString('utf8'));
    if (!rows.length) return res.status(400).json({ message: 'CSV vuoto o non valido' });

    const hasPlayersShape = Object.prototype.hasOwnProperty.call(rows[0], 'team_name')
      && Object.prototype.hasOwnProperty.call(rows[0], 'first_name')
      && Object.prototype.hasOwnProperty.call(rows[0], 'last_name')
      && Object.prototype.hasOwnProperty.call(rows[0], 'role');

    let teamsCreated = 0;
    let playersCreated = 0;

    if (!hasPlayersShape) {
      // Teams CSV: expected headers containing "name"
      for (const row of rows) {
        const name = String(row.name || '').trim();
        if (!name) continue;
        const exists = await query(`SELECT id FROM teams WHERE league_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`, [leagueId, name]);
        if (exists.length) continue;
        try {
          await query(`INSERT INTO teams (league_id, name) VALUES (?, ?)`, [leagueId, name]);
          teamsCreated += 1;
        } catch (insertErr) {
          if (insertErr && insertErr.code === '23505') {
            await syncTeamsIdSequence();
            await query(`INSERT INTO teams (league_id, name) VALUES (?, ?)`, [leagueId, name]);
            teamsCreated += 1;
          }
        }
      }
      return res.json({ message: 'Import squadre completato', type: 'teams', teams_created: teamsCreated });
    }

    // Players CSV: team_name,first_name,last_name,role,rating
    for (const row of rows) {
      const teamName = String(row.team_name || '').trim();
      const firstName = String(row.first_name || '').trim();
      const lastName = String(row.last_name || '').trim();
      const role = String(row.role || '').trim().toUpperCase();
      const rating = Number(row.rating || 0);
      if (!teamName || !firstName || !lastName || !['P', 'D', 'C', 'A'].includes(role)) continue;

      let team = await query(`SELECT id FROM teams WHERE league_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`, [leagueId, teamName]);
      if (!team.length) {
        try {
          const insTeam = await query(`INSERT INTO teams (league_id, name) VALUES (?, ?) RETURNING id`, [leagueId, teamName]);
          team = [{ id: insTeam.insertId }];
          teamsCreated += 1;
        } catch (insertErr) {
          if (insertErr && insertErr.code === '23505') {
            await syncTeamsIdSequence();
            const insTeam = await query(`INSERT INTO teams (league_id, name) VALUES (?, ?) RETURNING id`, [leagueId, teamName]);
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
        await query(`UPDATE players SET rating = ? WHERE id = ?`, [rating, Number(existingPlayer[0].id)]).catch(() => {});
        continue;
      }
      try {
        await query(`INSERT INTO players (team_id, first_name, last_name, role, rating) VALUES (?, ?, ?, ?, ?)`, [teamId, firstName, lastName, role, rating]);
        playersCreated += 1;
      } catch (insertErr) {
        if (insertErr && insertErr.code === '23505') {
          await syncPlayersIdSequence();
          await query(`INSERT INTO players (team_id, first_name, last_name, role, rating) VALUES (?, ?, ?, ?, ?)`, [teamId, firstName, lastName, role, rating]);
          playersCreated += 1;
        } else if (String(insertErr.message || '').toLowerCase().includes('column') && String(insertErr.message || '').toLowerCase().includes('rating')) {
          await query(`INSERT INTO players (team_id, first_name, last_name, role) VALUES (?, ?, ?, ?)`, [teamId, firstName, lastName, role]);
          playersCreated += 1;
        } else {
          throw insertErr;
        }
      }
    }

    return res.json({
      message: 'Import giocatori completato',
      type: 'players',
      teams_created: teamsCreated,
      players_created: playersCreated,
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
      return res.status(410).json({ message: 'Join requests disabilitate: imposta require_approval=0 per questa lega' });
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

    const accessCode = pickFirst(body.accessCode, access_code);
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

    let insertLeague;
    try {
      insertLeague = await query(
        `INSERT INTO leagues
          (name, access_code, creator_id, initial_budget, default_deadline_time, max_portieri, max_difensori, max_centrocampisti, max_attaccanti, numero_titolari, auto_lineup_mode, linked_to_league_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         RETURNING id`,
        [
          String(name).trim(),
          accessCode ? String(accessCode).trim() : null,
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
        ]
      );
    } catch (insertError) {
      if (insertError && insertError.code === '23505') {
        await syncLeaguesIdSequence();
        insertLeague = await query(
          `INSERT INTO leagues
            (name, access_code, creator_id, initial_budget, default_deadline_time, max_portieri, max_difensori, max_centrocampisti, max_attaccanti, numero_titolari, auto_lineup_mode, linked_to_league_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
           RETURNING id`,
          [
            String(name).trim(),
            accessCode ? String(accessCode).trim() : null,
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
          ]
        );
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

    // Allineamento legacy: salva sempre require_approval alla creazione (se colonna disponibile).
    try {
      await query(`UPDATE leagues SET require_approval = ? WHERE id = ?`, [requireApproval, leagueId]);
    } catch (approvalErr) {
      console.log('require_approval update skipped:', approvalErr?.message || approvalErr);
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
             enable_clean_sheet, bonus_clean_sheet
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
             bonus_clean_sheet = EXCLUDED.bonus_clean_sheet`,
          [
            leagueId,
            bs.enable_bonus_malus, bs.enable_goal, bs.bonus_goal, bs.enable_assist, bs.bonus_assist,
            bs.enable_yellow_card, bs.malus_yellow_card, bs.enable_red_card, bs.malus_red_card,
            bs.enable_goals_conceded, bs.malus_goals_conceded, bs.enable_own_goal, bs.malus_own_goal,
            bs.enable_penalty_missed, bs.malus_penalty_missed, bs.enable_penalty_saved, bs.bonus_penalty_saved,
            bs.enable_clean_sheet, bs.bonus_clean_sheet,
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

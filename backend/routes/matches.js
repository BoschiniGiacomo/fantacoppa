const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const {
  ensureLeagueOfficialGironiSchema,
  assertOfficialGironiTeamsSameGroup,
} = require('../utils/leagueOfficialGironi');

function isMissingDbObjectError(err) {
  return err && (err.code === '42P01' || err.code === '42703'); // undefined_table / undefined_column
}

function matchesNotConfigured(res, err) {
  return res.status(500).json({
    message: 'Errore configurazione gestione partite sul DB',
    error: err?.message,
    code: err?.code,
  });
}

function isRegularGoalEventType(eventType) {
  const t = String(eventType || '').trim();
  return t === 'goal' || t === 'penalty_goal';
}

function parseEventPayloadJson(ev) {
  let payload = ev?.payload_json ?? ev?.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }
  return payload && typeof payload === 'object' ? payload : {};
}

function eventHasGoalScorer(ev) {
  const pid = Number(ev?.player_id);
  if (Number.isFinite(pid) && pid > 0) return true;
  const payload = parseEventPayloadJson(ev);
  const payloadPid = Number(payload?.player_id);
  if (Number.isFinite(payloadPid) && payloadPid > 0) return true;
  return String(payload?.player_name ?? '').trim().length > 0;
}

function isWalkoverMinute(minute) {
  const m = Number(minute);
  return Number.isFinite(m) && m === 0;
}

/** 3 goal/penalty_goal al minuto 0 senza marcatore, partita chiusa con match_end. */
function computeIsWalkoverFromEvents(events) {
  const list = Array.isArray(events) ? events : [];
  if (!list.some((e) => String(e?.event_type) === 'match_end')) return false;
  const goals = list.filter((e) => e && isRegularGoalEventType(e.event_type));
  if (goals.length !== 3) return false;
  if (!goals.every((e) => isWalkoverMinute(e.minute))) return false;
  return goals.every((e) => !eventHasGoalScorer(e));
}

const SQL_WALKOVER_MATCHES_CTE = `
      walkover_matches AS (
        SELECT wg.match_id
        FROM (
          SELECT e.match_id
          FROM official_match_events e
          WHERE e.event_type IN ('goal','penalty_goal')
            AND COALESCE(e.minute, 0) = 0
            AND (e.player_id IS NULL OR e.player_id <= 0)
            AND COALESCE(TRIM(
              CASE
                WHEN e.payload_json IS NULL OR BTRIM(e.payload_json) IN ('', '{}') THEN ''
                ELSE COALESCE((e.payload_json::jsonb)->>'player_name', '')
              END
            ), '') = ''
            AND COALESCE(NULLIF(TRIM(
              CASE
                WHEN e.payload_json IS NULL OR BTRIM(e.payload_json) IN ('', '{}') THEN ''
                ELSE COALESCE((e.payload_json::jsonb)->>'player_id', '')
              END
            ), ''), '0')::int <= 0
          GROUP BY e.match_id
          HAVING COUNT(*) = 3
        ) wg
        WHERE EXISTS (
          SELECT 1 FROM official_match_events me
          WHERE me.match_id = wg.match_id AND me.event_type = 'match_end'
        )
      )`;

function parseBooleanishInt(value, fallback = 0) {
  if (value == null || value === '') return fallback ? 1 : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 't', 'yes', 'y', 'on'].includes(normalized)) return 1;
  if (['0', 'false', 'f', 'no', 'n', 'off'].includes(normalized)) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric ? 1 : 0;
  return fallback ? 1 : 0;
}

let unavailablePlayersTableReady = false;
async function ensureUnavailablePlayersTable() {
  if (unavailablePlayersTableReady) return;
  await query(
    `CREATE TABLE IF NOT EXISTS official_match_unavailable_players (
       id BIGSERIAL PRIMARY KEY,
       match_id INTEGER NOT NULL REFERENCES official_matches(id) ON DELETE CASCADE,
       player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
       created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (match_id, player_id)
     )`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_off_match_unavailable_match
     ON official_match_unavailable_players (match_id)`
  );
  unavailablePlayersTableReady = true;
}

let standingsTieOrderTableReady = false;
async function ensureStandingsTieOrderTable() {
  if (standingsTieOrderTableReady) return;
  await query(
    `CREATE TABLE IF NOT EXISTS official_standings_tie_orders (
       id BIGSERIAL PRIMARY KEY,
       competition_id INTEGER NOT NULL,
       league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
       points INTEGER NOT NULL,
       ordered_team_ids JSONB NOT NULL,
       created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       UNIQUE (competition_id, league_id, points)
     )`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_official_standings_tie_orders_scope
     ON official_standings_tie_orders (competition_id, league_id, points)`
  );
  standingsTieOrderTableReady = true;
}

async function resolveMatchStageInput(matchStageIdRaw) {
  const stageIdInput = Number(matchStageIdRaw);
  let stageId = Number.isFinite(stageIdInput) && stageIdInput > 0 ? Math.trunc(stageIdInput) : null;
  let stageName = null;

  if (stageId) {
    const byId = await query(
      `SELECT id, name
       FROM official_match_stages
       WHERE id = ?
       LIMIT 1`,
      [stageId]
    );
    const row = byId?.[0];
    if (row?.id) {
      stageId = Number(row.id);
      stageName = row.name != null ? String(row.name).trim() || null : null;
      return { stageId, stageName };
    }
    stageId = null;
  }
  return { stageId: null, stageName: null };
}

function getInsertRows(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  return [];
}

function formatPlayerInitialLast(raw) {
  const parts = String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) {
    const w = parts[0];
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }
  const fi = parts[0].charAt(0).toUpperCase();
  const last = parts[parts.length - 1];
  const lastFmt = last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
  return `${fi}.${lastFmt}`;
}

function formatScorePlain(homeGoals, awayGoals) {
  if (homeGoals == null || awayGoals == null) return '';
  const h = Number(homeGoals);
  const a = Number(awayGoals);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return '';
  return ` ${h}-${a}`;
}

function teamNameFromSide(teamSide, homeTeamName, awayTeamName) {
  const s = String(teamSide || '').trim().toLowerCase();
  if (s === 'home') return String(homeTeamName || '').trim() || 'Casa';
  if (s === 'away') return String(awayTeamName || '').trim() || 'Trasferta';
  return '';
}

/** Titolo + corpo push (goal / autogol / fine partita come richiesto). */
function buildMatchEventPushContent({
  eventType,
  homeTeamName,
  awayTeamName,
  teamSide,
  payload,
  homeGoals,
  awayGoals,
  isWalkover = false,
}) {
  const matchLabel = `${homeTeamName || 'Casa'} - ${awayTeamName || 'Trasferta'}`;
  const playerFmt = formatPlayerInitialLast(String(payload?.player_name || '').trim());
  const scoreStr = formatScorePlain(homeGoals, awayGoals);
  const sideTeam = teamNameFromSide(teamSide, homeTeamName, awayTeamName);

  if (eventType === 'match_start') {
    return { title: 'Inizio partita', body: `${matchLabel}: la partita e iniziata.` };
  }
  if (eventType === 'match_end') {
    const title = isWalkover ? 'A tavolino' : 'Partita terminata';
    return { title, body: `${matchLabel}${scoreStr}`.trimEnd() };
  }
  if (isRegularGoalEventType(eventType)) {
    const title = sideTeam ? `GOAL ${sideTeam}` : 'GOAL';
    const rigSuffix = eventType === 'penalty_goal' ? ' (rig.)' : '';
    const body = playerFmt
      ? `goal di ${playerFmt}${rigSuffix} ${matchLabel}${scoreStr}`.trimEnd()
      : `goal${rigSuffix} ${matchLabel}${scoreStr}`.trimEnd();
    return { title, body };
  }
  if (eventType === 'own_goal') {
    const title = sideTeam ? `AUTOGOAL ${sideTeam}` : 'AUTOGOAL';
    const body = playerFmt
      ? `Autogoal di ${playerFmt} ${matchLabel}${scoreStr}`.trimEnd()
      : `Autogoal ${matchLabel}${scoreStr}`.trimEnd();
    return { title, body };
  }
  return null;
}

/** Punteggio da eventi goal/own_goal, con fallback alle colonne official_matches. */
async function fetchOfficialMatchLiveScore(matchId) {
  const mid = Number(matchId);
  if (!mid) return null;
  const rows = await safeQuery(
    `SELECT
       COALESCE((
         SELECT SUM(
           CASE
            WHEN e.event_type IN ('goal','penalty_goal') AND (
              e.team_id = m.home_team_id OR (e.team_id IS NULL AND e.team_side = 'home')
            ) THEN 1
            WHEN e.event_type = 'own_goal' AND (
              e.team_id = m.away_team_id OR (e.team_id IS NULL AND e.team_side = 'away')
            ) THEN 1
             ELSE 0
           END
         )::int
         FROM official_match_events e
         WHERE e.match_id = ? AND e.event_type IN ('goal','penalty_goal','own_goal')
       ), m.home_score, 0) AS home_goals,
       COALESCE((
         SELECT SUM(
           CASE
            WHEN e.event_type IN ('goal','penalty_goal') AND (
              e.team_id = m.away_team_id OR (e.team_id IS NULL AND e.team_side = 'away')
            ) THEN 1
            WHEN e.event_type = 'own_goal' AND (
              e.team_id = m.home_team_id OR (e.team_id IS NULL AND e.team_side = 'home')
            ) THEN 1
             ELSE 0
           END
         )::int
         FROM official_match_events e
         WHERE e.match_id = ? AND e.event_type IN ('goal','penalty_goal','own_goal')
       ), m.away_score, 0) AS away_goals
     FROM official_matches m
     WHERE m.id = ?
     LIMIT 1`,
    [mid, mid, mid]
  );
  const r = rows[0];
  if (!r) return null;
  const h = Number(r.home_goals);
  const a = Number(r.away_goals);
  return {
    home: Number.isFinite(h) ? h : 0,
    away: Number.isFinite(a) ? a : 0,
  };
}

async function safeQuery(sql, params = [], fallback = []) {
  try {
    const rows = await query(sql, params);
    return Array.isArray(rows) ? rows : rows?.rows || fallback;
  } catch (err) {
    if (isMissingDbObjectError(err)) return fallback;
    throw err;
  }
}

const ITALY_TZ = 'Europe/Rome';

/** Data calendario YYYY-MM-DD nel fuso Italia (stesso criterio di "giornata" per utenti IT). */
function calendarYmdItaly(isoLike) {
  try {
    const d = new Date(isoLike);
    if (!Number.isFinite(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: ITALY_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return null;
  }
}

/**
 * Nessuna push per eventi aggiunti/modificati dopo la giornata della partita (es. correzioni su match già passati).
 * Confronto solo su data calendario, non sull'orario esatto.
 */
function isOfficialMatchKickoffBeforeTodayItaly(kickoffAt) {
  if (kickoffAt == null || String(kickoffAt).trim() === '') return false;
  const matchYmd = calendarYmdItaly(kickoffAt);
  const todayYmd = calendarYmdItaly(Date.now());
  if (!matchYmd || !todayYmd) return false;
  return matchYmd < todayYmd;
}

async function sendExpoMessages(messages) {
  if (!Array.isArray(messages) || messages.length <= 0) return { sent: 0, invalidated: 0, errors: 0 };
  let sent = 0;
  let invalidated = 0;
  let errors = 0;
  const chunkSize = 100;
  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunk = messages.slice(i, i + chunkSize);
    try {
      const resp = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
      const data = await resp.json().catch(() => ({}));
      const results = Array.isArray(data?.data) ? data.data : [];
      for (let j = 0; j < chunk.length; j += 1) {
        const r = results[j] || {};
        const msg = chunk[j];
        if (r.status === 'ok') {
          sent += 1;
          continue;
        }
        errors += 1;
        const expoErr = String(r?.details?.error || r?.message || '');
        if (/DeviceNotRegistered/i.test(expoErr)) {
          try {
            await query(
              `UPDATE user_push_tokens
               SET is_active = 0, updated_at = NOW()
               WHERE expo_push_token = ?`,
              [msg?.to]
            );
            invalidated += 1;
          } catch (_) {}
        }
      }
    } catch (_) {
      errors += chunk.length;
    }
  }
  return { sent, invalidated, errors };
}

async function notifyUsersForOfficialMatchEvent({ eventId, matchId, eventType, payload, teamSide }) {
  const matchRows = await safeQuery(
    `SELECT m.id, m.competition_id, m.home_team_id, m.away_team_id, m.kickoff_at,
            ht.name AS home_team_name, at.name AS away_team_name
     FROM official_matches m
     LEFT JOIN teams ht ON ht.id = m.home_team_id
     LEFT JOIN teams at ON at.id = m.away_team_id
     WHERE m.id = ?
     LIMIT 1`,
    [matchId]
  );
  const match = matchRows[0];
  if (!match) return { targeted_users: 0, reserved: 0, sent: 0, invalidated: 0, errors: 0 };

  if (isOfficialMatchKickoffBeforeTodayItaly(match.kickoff_at)) {
    return { targeted_users: 0, reserved: 0, sent: 0, invalidated: 0, errors: 0 };
  }

  const compId = Number(match.competition_id || 0);
  const homeNorm = normalizeTeamNameForFavorite(match.home_team_name || '');
  const awayNorm = normalizeTeamNameForFavorite(match.away_team_name || '');

  const targetsByUser = new Map();
  const addTarget = (uid, token) => {
    const userId = Number(uid);
    const expoToken = String(token || '').trim();
    if (!userId || !expoToken) return;
    if (!targetsByUser.has(userId)) targetsByUser.set(userId, new Set());
    targetsByUser.get(userId).add(expoToken);
  };

  // campanella sulla partita OR preferiti squadra (gruppo ufficiale + nome normalizzato) con notifiche attive.
  const byMatchRows = await safeQuery(
    `SELECT mn.user_id, upt.expo_push_token
     FROM user_official_match_notifications mn
     JOIN user_push_tokens upt ON upt.user_id = mn.user_id AND upt.is_active = 1
     WHERE mn.match_id = ? AND COALESCE(mn.enabled, 0) = 1`,
    [matchId]
  );
  for (const r of byMatchRows || []) addTarget(r.user_id, r.expo_push_token);

  if (compId > 0 && (homeNorm || awayNorm)) {
    const names = [homeNorm, awayNorm].filter(Boolean);
    if (names.length > 0) {
      const placeholders = names.map(() => '?').join(',');
      const byTeamRows = await safeQuery(
        `SELECT tf.user_id, upt.expo_push_token
         FROM user_official_team_favorites tf
         JOIN user_push_tokens upt ON upt.user_id = tf.user_id AND upt.is_active = 1
         WHERE tf.official_group_id = ?
           AND COALESCE(tf.notifications_enabled, 0) = 1
           AND tf.team_name_norm IN (${placeholders})`,
        [compId, ...names]
      );
      for (const r of byTeamRows || []) addTarget(r.user_id, r.expo_push_token);
    }
  }

  let homeGoals = null;
  let awayGoals = null;
  if (isRegularGoalEventType(eventType) || eventType === 'own_goal' || eventType === 'match_end') {
    const live = await fetchOfficialMatchLiveScore(matchId);
    if (live) {
      homeGoals = live.home;
      awayGoals = live.away;
    }
  }

  let isWalkover = false;
  if (eventType === 'match_end') {
    const walkoverRows = await safeQuery(
      `SELECT event_type, minute, player_id, payload_json
       FROM official_match_events
       WHERE match_id = ?`,
      [matchId]
    );
    isWalkover = computeIsWalkoverFromEvents(walkoverRows || []);
  }

  const pushText = buildMatchEventPushContent({
    eventType,
    homeTeamName: match.home_team_name,
    awayTeamName: match.away_team_name,
    teamSide,
    payload,
    homeGoals,
    awayGoals,
    isWalkover,
  });
  if (!pushText) return { targeted_users: targetsByUser.size, reserved: 0, sent: 0, invalidated: 0, errors: 0 };
  const { title, body } = pushText;

  let reserved = 0;
  const messages = [];
  const evId = Number(eventId);
  for (const [userId, tokenSet] of targetsByUser.entries()) {
    const ins = await safeQuery(
      `INSERT INTO user_official_match_event_sent (user_id, match_event_id)
       VALUES (?, ?)
       ON CONFLICT (user_id, match_event_id) DO NOTHING
       RETURNING id`,
      [userId, evId],
      []
    );
    if (!ins[0]?.id) continue;
    reserved += 1;
    for (const token of tokenSet) {
      messages.push({
        to: token,
        sound: 'default',
        channelId: 'fantacoppa-reminders',
        priority: 'high',
        title,
        body,
        data: {
          type: 'match_event',
          event_type: eventType,
          match_id: Number(matchId),
          event_id: evId,
          ...(homeGoals != null && awayGoals != null ? { home_score: homeGoals, away_score: awayGoals } : {}),
        },
      });
    }
  }

  const pushStats = await sendExpoMessages(messages);
  return {
    targeted_users: targetsByUser.size,
    reserved,
    sent: pushStats.sent,
    invalidated: pushStats.invalidated,
    errors: pushStats.errors,
  };
}

function normalizeTeamNameForFavorite(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '');
}

/**
 * Mappa logo per (competition_id, nome squadra): reference_year più alto tra leghe
 * con almeno una partita visibile e rosa pubblica (stessa visibilità di prima).
 */
async function buildBestOfficialTeamLogoMap(competitionIds, canSeeAdminOnly) {
  const ids = [
    ...new Set(
      (Array.isArray(competitionIds) ? competitionIds : [])
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)
    ),
  ];
  const map = new Map();
  if (ids.length === 0) return map;

  const ph = ids.map(() => '?').join(', ');
  const adminFlag = canSeeAdminOnly ? 1 : 0;
  const params = [...ids, adminFlag, ...ids, adminFlag, ...ids];

  const rows = await query(
    `
    WITH leagues_with_matches AS (
      SELECT DISTINCT m.competition_id, l.id AS league_id
      FROM official_matches m
      INNER JOIN teams tx ON tx.id IN (m.home_team_id, m.away_team_id)
      INNER JOIN leagues l ON l.id = tx.league_id AND l.official_group_id = m.competition_id
      WHERE m.competition_id IN (${ph})
        AND (? = 1 OR COALESCE(m.is_admin_only, 0) = 0)
        AND COALESCE(l.is_official_squad_public, 0) = 1
      UNION
      SELECT DISTINCT m.competition_id, l.id AS league_id
      FROM official_matches m
      INNER JOIN leagues l ON l.id = m.league_id AND l.official_group_id = m.competition_id
      WHERE m.competition_id IN (${ph})
        AND (? = 1 OR COALESCE(m.is_admin_only, 0) = 0)
        AND COALESCE(l.is_official_squad_public, 0) = 1
        AND m.league_id IS NOT NULL
    ),
    ranked AS (
      SELECT
        l.official_group_id AS competition_id,
        LOWER(TRIM(t.name)) AS team_name_norm,
        COALESCE(NULLIF(to_jsonb(t)->>'logo_path',''), NULLIF(t.logo_path,'')) AS logo_path,
        ROW_NUMBER() OVER (
          PARTITION BY l.official_group_id, LOWER(TRIM(t.name))
          ORDER BY
            CASE
              WHEN NULLIF(TRIM(COALESCE(NULLIF(to_jsonb(t)->>'logo_path',''), NULLIF(t.logo_path,''))), '') IS NOT NULL
              THEN 0
              ELSE 1
            END ASC,
            NULLIF(to_jsonb(l)->>'reference_year','')::int DESC NULLS LAST,
            t.id DESC
        ) AS rn
      FROM teams t
      INNER JOIN leagues l ON l.id = t.league_id
      INNER JOIN leagues_with_matches lwm
        ON lwm.league_id = l.id AND lwm.competition_id = l.official_group_id
      WHERE l.official_group_id IN (${ph})
        AND COALESCE(l.is_official_squad_public, 0) = 1
    )
    SELECT competition_id, team_name_norm, logo_path
    FROM ranked
    WHERE rn = 1
    `,
    params
  );

  for (const r of Array.isArray(rows) ? rows : []) {
    const compId = Number(r.competition_id);
    const norm = normalizeTeamNameForFavorite(r.team_name_norm || '');
    if (!compId || !norm) continue;
    map.set(`${compId}:${norm}`, normalizeTeamLogoPathForApi(r.logo_path));
  }
  return map;
}

function pickBestOfficialTeamLogo(logoMap, competitionId, teamName, fallbackPath) {
  const compId = Number(competitionId);
  const norm = normalizeTeamNameForFavorite(teamName);
  if (compId > 0 && norm) {
    const best = logoMap.get(`${compId}:${norm}`);
    if (best) return best;
  }
  return normalizeTeamLogoPathForApi(fallbackPath);
}

function normalizeJerseyColorForApi(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  // accetta #RRGGBB o RRGGBB
  const hex = s.startsWith('#') ? s.slice(1) : s;
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  return s; // fallback: mantieni valore legacy/descrittivo
}

function normalizeTeamLogoPathForApi(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const cleaned = s.replace(/^\/+/, '');
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  // Allineamento legacy: i file logo ufficiali vivono sotto uploads/official_team_logos/
  if (cleaned.startsWith('uploads/')) return cleaned;
  if (cleaned.includes('/')) return cleaned; // path relativo già strutturato
  return `uploads/official_team_logos/${cleaned}`;
}

function logoUrlForPath(p) {
  const s = normalizeTeamLogoPathForApi(p);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  // Il client costruisce l'URL pubblico da logo_path tramite publicAssetUrl()
  return null;
}

function safeJsonParse(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  const s = String(value).trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function getTeamMeta(teamId) {
  const rows = await query(
    `
    SELECT
      t.id,
      t.name,
      t.league_id,
      COALESCE(NULLIF(to_jsonb(t)->>'logo_path',''), NULLIF(t.logo_path, '')) AS logo_path,
      NULLIF(to_jsonb(t)->>'logo_url','') AS logo_url,
      COALESCE(NULLIF(to_jsonb(t)->>'jersey_color',''), NULLIF(t.jersey_color, '')) AS jersey_color
    FROM teams t
    WHERE t.id = ?
    LIMIT 1
    `,
    [teamId]
  );
  return rows[0] || null;
}

function buildEventPayloadForDb(body) {
  const playerName = body?.player_name != null ? String(body.player_name).trim() : '';
  const assistPlayerName = body?.assist_player_name != null ? String(body.assist_player_name).trim() : '';
  const clockTime = body?.clock_time != null ? String(body.clock_time).trim() : '';
  const teamId = Number(body?.team_id);
  const playerId = Number(body?.player_id);
  const assistPlayerId = Number(body?.assist_player_id);
  const stoppagePeriodEnd = Number(body?.stoppage_period_end);
  const out = {};
  if (playerName) out.player_name = playerName;
  if (assistPlayerName) out.assist_player_name = assistPlayerName;
  if (Number.isFinite(teamId) && teamId > 0) out.team_id = teamId;
  if (Number.isFinite(playerId) && playerId > 0) out.player_id = playerId;
  if (Number.isFinite(assistPlayerId) && assistPlayerId > 0) out.assist_player_id = assistPlayerId;
  if (Number.isFinite(stoppagePeriodEnd) && stoppagePeriodEnd > 0) {
    out.stoppage_period_end = stoppagePeriodEnd;
    out.goal_in_stoppage = true;
  }
  if (clockTime) out.clock_time = clockTime;
  // Permetti payload custom aggiuntivo (compat)
  if (body?.payload_json && typeof body.payload_json === 'object') {
    Object.assign(out, body.payload_json);
  }
  return Object.keys(out).length ? out : null;
}

function buildEventTitleForDb(eventType, teamSide, payload) {
  const pn = payload && payload.player_name ? String(payload.player_name).trim() : '';
  if (eventType === 'goal') return pn ? `Goal - ${pn}` : 'Goal';
  if (eventType === 'penalty_goal') return pn ? `Rigore segnato - ${pn}` : 'Rigore segnato';
  if (eventType === 'own_goal') return pn ? `Autogol - ${pn}` : 'Autogol';
  if (eventType === 'yellow_card') return pn ? `Ammonizione - ${pn}` : 'Ammonizione';
  if (eventType === 'red_card') return pn ? `Espulsione - ${pn}` : 'Espulsione';
  if (eventType === 'penalty_missed') return pn ? `Rigore sbagliato - ${pn}` : 'Rigore sbagliato';
  if (eventType === 'shootout_goal') return pn ? `Rigore segnato - ${pn}` : 'Rigore segnato';
  if (eventType === 'shootout_missed') return pn ? `Rigore no goal - ${pn}` : 'Rigore no goal';
  if (eventType === 'match_start') return 'Inizio partita';
  if (eventType === 'match_end') return 'Fine partita';
  if (eventType === 'half_time') return 'Fine primo tempo';
  if (eventType === 'second_half_start') return 'Inizio secondo tempo';
  if (eventType === 'second_half_end') return 'Fine secondo tempo';
  if (eventType === 'extra_first_half_start') return 'Inizio supplementari';
  if (eventType === 'extra_half_time') return 'Fine primo tempo supplementare';
  if (eventType === 'extra_second_half_start') return 'Inizio secondo tempo supplementare';
  if (eventType === 'extra_second_half_end') return 'Fine secondo tempo supplementare';
  // fallback
  const et = String(eventType || '').trim();
  return et ? et : null;
}

function enrichEventForApi(ev) {
  const payload = safeJsonParse(ev.payload_json);
  // Retrocompat: se non c'è payload.player_name ma title contiene " - Nome"
  let playerName = payload && payload.player_name ? String(payload.player_name).trim() : '';
  if (!playerName && ev?.title && typeof ev.title === 'string' && ev.title.includes(' - ')) {
    const parts = ev.title.split(' - ');
    const maybe = parts.slice(1).join(' - ').trim();
    if (maybe) playerName = maybe;
  }
  const nextPayload = payload && typeof payload === 'object' ? { ...payload } : {};
  if (playerName) nextPayload.player_name = playerName;
  if (ev.team_id != null && Number.isFinite(Number(ev.team_id)) && Number(ev.team_id) > 0) nextPayload.team_id = Number(ev.team_id);
  if (ev.player_id != null && Number.isFinite(Number(ev.player_id)) && Number(ev.player_id) > 0) nextPayload.player_id = Number(ev.player_id);
  if (ev.assist_player_id != null && Number.isFinite(Number(ev.assist_player_id)) && Number(ev.assist_player_id) > 0) {
    nextPayload.assist_player_id = Number(ev.assist_player_id);
  }
  const title = ev.title || buildEventTitleForDb(ev.event_type, ev.team_side, nextPayload);
  return {
    id: Number(ev.id),
    match_id: Number(ev.match_id),
    event_type: ev.event_type,
    minute: ev.minute != null ? Number(ev.minute) : null,
    team_side: ev.team_side,
    team_id: ev.team_id != null ? Number(ev.team_id) : null,
    player_id: ev.player_id != null ? Number(ev.player_id) : null,
    assist_player_id: ev.assist_player_id != null ? Number(ev.assist_player_id) : null,
    title,
    payload: Object.keys(nextPayload).length ? nextPayload : null,
    created_at: ev.created_at,
  };
}

async function getTeamPlayersLineup(teamId) {
  const rows = await query(
    `
    WITH pnorm AS (
      SELECT
        p.*,
        COALESCE(
          NULLIF(to_jsonb(p)->>'shirt_number','')::int,
          NULLIF(to_jsonb(p)->>'numero_maglia','')::int
        ) AS shirt_number_norm,
        COALESCE(
          NULLIF(to_jsonb(p)->>'rating','')::numeric,
          NULLIF(to_jsonb(p)->>'valutazione','')::numeric,
          NULLIF(to_jsonb(p)->>'credits','')::numeric,
          NULLIF(to_jsonb(p)->>'price','')::numeric
        ) AS rating_norm
      FROM players p
      WHERE p.team_id = ?
    )
    SELECT
      p.id,
      p.first_name,
      p.last_name,
      p.role,
      p.shirt_number_norm AS shirt_number,
      p.rating_norm AS rating
    FROM pnorm p
    ORDER BY COALESCE(p.shirt_number_norm, 999), p.role ASC, p.last_name ASC, p.first_name ASC
    `,
    [teamId]
  );

  let order = 1;
  return rows
    .map((p) => {
      const first = String(p.first_name || '').trim();
      const last = String(p.last_name || '').trim();
      const displayName = `${first} ${last}`.trim();
      if (!displayName) return null;
      return {
        id: Number(p.id),
        order: order++,
        name: displayName,
        first_name: first,
        last_name: last,
        role: p.role || null,
        shirt_number: p.shirt_number != null ? Number(p.shirt_number) : null,
        rating: p.rating != null ? Number(p.rating) : null,
      };
    })
    .filter(Boolean);
}

async function getManualTieOrderMap({ leagueId, groupId }) {
  try {
    await ensureStandingsTieOrderTable();
    const rows = await query(
      `
      SELECT points, ordered_team_ids
      FROM official_standings_tie_orders
      WHERE competition_id = ? AND league_id = ?
      `,
      [Number(groupId), Number(leagueId)]
    );
    const out = new Map();
    for (const r of rows || []) {
      const points = Number(r.points);
      const raw = safeJsonParse(r.ordered_team_ids) || r.ordered_team_ids;
      const ids = Array.isArray(raw)
        ? raw.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
        : [];
      if (Number.isFinite(points) && ids.length > 1) out.set(points, ids);
    }
    return out;
  } catch (err) {
    if (isMissingDbObjectError(err)) return new Map();
    throw err;
  }
}

/**
 * Risultato per classifica: gol da eventi, altrimenti colonne DB, altrimenti 0-0 se partita chiusa (match_end).
 * Allineato a COALESCE(evs, home_score, CASE match_end THEN 0) nelle liste partite.
 */
function resolveOfficialMatchResultForStandings(m, evScore, isMatchEnded) {
  if (evScore?.has) {
    return { home: evScore.home, away: evScore.away, counted: true };
  }
  const hSet = m?.home_score != null && m?.home_score !== '';
  const aSet = m?.away_score != null && m?.away_score !== '';
  if (hSet && aSet) {
    const home = Number(m.home_score);
    const away = Number(m.away_score);
    if (Number.isFinite(home) && Number.isFinite(away)) {
      return { home, away, counted: true };
    }
  }
  if (isMatchEnded) {
    const home = hSet && Number.isFinite(Number(m.home_score)) ? Number(m.home_score) : 0;
    const away = aSet && Number.isFinite(Number(m.away_score)) ? Number(m.away_score) : 0;
    return { home, away, counted: true };
  }
  return { counted: false };
}

async function fetchMatchEndedIds(matchIds) {
  const ids = (Array.isArray(matchIds) ? matchIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return new Set();
  const ph = ids.map(() => '?').join(', ');
  const rows = await query(
    `SELECT DISTINCT match_id FROM official_match_events WHERE match_id IN (${ph}) AND event_type = 'match_end'`,
    ids
  );
  return new Set((rows || []).map((r) => Number(r.match_id)).filter((id) => id > 0));
}

async function computeStandingsFromMatches({ leagueId, groupId, allowedTeamIds = null }) {
  const restrictIds =
    Array.isArray(allowedTeamIds) && allowedTeamIds.length > 0
      ? [...new Set(allowedTeamIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))]
      : null;
  if (Array.isArray(allowedTeamIds) && allowedTeamIds.length > 0 && (!restrictIds || restrictIds.length === 0)) {
    return [];
  }

  let teamsSql = `
    SELECT
      t.id,
      t.name,
      t.league_id,
      COALESCE(NULLIF(to_jsonb(t)->>'logo_path',''), NULLIF(t.logo_path, '')) AS logo_path
    FROM teams t
    WHERE t.league_id = ?
  `;
  const teamsParams = [leagueId];
  if (restrictIds) {
    const ph = restrictIds.map(() => '?').join(', ');
    teamsSql += ` AND t.id IN (${ph})`;
    teamsParams.push(...restrictIds);
  }
  teamsSql += ` ORDER BY t.id ASC`;

  const teams = await query(teamsSql, teamsParams);
  const teamMap = new Map((Array.isArray(teams) ? teams : []).map((t) => [Number(t.id), t]));
  if (teamMap.size === 0) return [];

  let matchesSql = `
    SELECT
      m.id,
      m.home_team_id,
      m.away_team_id,
      m.home_score,
      m.away_score
    FROM official_matches m
    WHERE m.competition_id = ?
      AND m.home_team_id IN (SELECT id FROM teams WHERE league_id = ?)
      AND m.away_team_id IN (SELECT id FROM teams WHERE league_id = ?)
      AND m.match_stage_id = 1
  `;
  const matchesParams = [groupId, leagueId, leagueId];
  if (restrictIds) {
    const ph = restrictIds.map(() => '?').join(', ');
    matchesSql += ` AND m.home_team_id IN (${ph}) AND m.away_team_id IN (${ph})`;
    matchesParams.push(...restrictIds, ...restrictIds);
  }

  const matches = await query(matchesSql, matchesParams);

  const matchIds = (Array.isArray(matches) ? matches : []).map((m) => Number(m.id)).filter((x) => x > 0);
  const endedMatchIds = await fetchMatchEndedIds(matchIds);
  const eventsByMatch = new Map();
  if (matchIds.length) {
    const ph = matchIds.map(() => '?').join(', ');
    const evs = await query(
      `
      SELECT match_id, event_type, team_side, team_id
      FROM official_match_events
      WHERE match_id IN (${ph}) AND event_type IN ('goal','penalty_goal','own_goal')
      `,
      matchIds
    );
    (Array.isArray(evs) ? evs : []).forEach((e) => {
      const mid = Number(e.match_id);
      if (!eventsByMatch.has(mid)) eventsByMatch.set(mid, []);
      eventsByMatch.get(mid).push(e);
    });
  }

  const table = new Map();
  for (const t of teamMap.values()) {
    table.set(Number(t.id), { team_id: Number(t.id), team_name: t.name, played: 0, gf: 0, ga: 0, goal_diff: 0, points: 0 });
  }

  const scoreFromEvents = (mid, homeTeamId, awayTeamId) => {
    const evs = eventsByMatch.get(mid) || [];
    let h = 0;
    let a = 0;
    for (const e of evs) {
      const evTeamId = Number(e.team_id);
      const byTeamId = Number.isFinite(evTeamId) && evTeamId > 0 && homeTeamId > 0 && awayTeamId > 0;
      if (isRegularGoalEventType(e.event_type)) {
        if (byTeamId) {
          if (evTeamId === homeTeamId) h += 1;
          if (evTeamId === awayTeamId) a += 1;
        } else {
          if (e.team_side === 'home') h += 1;
          if (e.team_side === 'away') a += 1;
        }
      } else if (e.event_type === 'own_goal') {
        if (byTeamId) {
          if (evTeamId === homeTeamId) a += 1;
          if (evTeamId === awayTeamId) h += 1;
        } else {
          if (e.team_side === 'home') a += 1;
          if (e.team_side === 'away') h += 1;
        }
      }
    }
    return { home: h, away: a, has: evs.length > 0 };
  };

  const playedMatches = [];
  for (const m of Array.isArray(matches) ? matches : []) {
    const homeId = Number(m.home_team_id);
    const awayId = Number(m.away_team_id);
    if (!table.has(homeId) || !table.has(awayId)) continue;

    const evScore = scoreFromEvents(Number(m.id), homeId, awayId);
    const resolved = resolveOfficialMatchResultForStandings(m, evScore, endedMatchIds.has(Number(m.id)));
    if (!resolved.counted) continue; // non giocata / risultato non disponibile
    const hs = resolved.home;
    const as = resolved.away;
    playedMatches.push({ homeId, awayId, hs, as });

    const home = table.get(homeId);
    const away = table.get(awayId);
    home.played += 1;
    away.played += 1;
    home.gf += hs;
    home.ga += as;
    away.gf += as;
    away.ga += hs;

    if (hs > as) home.points += 3;
    else if (hs < as) away.points += 3;
    else {
      home.points += 1;
      away.points += 1;
    }
  }

  const rows = Array.from(table.values()).map((r) => ({ ...r, goal_diff: r.gf - r.ga }));
  const manualTieOrderMap = await getManualTieOrderMap({ leagueId, groupId });
  const manualTieCompare = (a, b) => {
    if (a.points !== b.points) return null;
    const order = manualTieOrderMap.get(Number(a.points));
    if (!Array.isArray(order) || order.length < 2) return null;
    const ai = order.indexOf(Number(a.team_id));
    const bi = order.indexOf(Number(b.team_id));
    if (ai >= 0 && bi >= 0 && ai !== bi) return ai - bi;
    if (ai >= 0 && bi < 0) return -1;
    if (ai < 0 && bi >= 0) return 1;
    return null;
  };
  const headToHeadCompare = (a, b) => {
    if (a.points !== b.points) return null;
    const aId = Number(a.team_id);
    const bId = Number(b.team_id);
    let aGoals = 0;
    let bGoals = 0;
    let found = false;
    for (const m of playedMatches) {
      const direct =
        (m.homeId === aId && m.awayId === bId) ||
        (m.homeId === bId && m.awayId === aId);
      if (!direct) continue;
      found = true;
      if (m.homeId === aId) {
        aGoals += Number(m.hs);
        bGoals += Number(m.as);
      } else {
        aGoals += Number(m.as);
        bGoals += Number(m.hs);
      }
    }
    if (!found || aGoals === bGoals) return null;
    return aGoals > bGoals ? -1 : 1;
  };
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const manual = manualTieCompare(a, b);
    if (manual != null) return manual;
    const h2h = headToHeadCompare(a, b);
    if (h2h != null) return h2h;
    if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return String(a.team_name).localeCompare(String(b.team_name), 'it');
  });

  return rows.map((r, idx) => {
    const t = teamMap.get(Number(r.team_id));
    const lp = normalizeTeamLogoPathForApi(t?.logo_path);
    return {
      position: idx + 1,
      team_id: Number(r.team_id),
      team_name: r.team_name,
      played: Number(r.played),
      gf: Number(r.gf),
      gs: Number(r.ga),
      goal_diff: Number(r.goal_diff),
      points: Number(r.points),
      team_logo_path: lp,
      team_logo_url: logoUrlForPath(lp),
    };
  });
}

/** Classifica fase gironi: unica tabella oppure Girone A + B se la lega ha due gironi e le assegnazioni sono valide. */
async function computeOfficialLeagueGironiStandings({ leagueId, competitionId }) {
  const lid = Number(leagueId);
  const compId = Number(competitionId);
  if (!Number.isFinite(lid) || lid <= 0 || !Number.isFinite(compId) || compId <= 0) {
    return { standings: [], standings_groups: null };
  }

  const leagueMetaRows = await query(
    `SELECT COALESCE(official_two_groups, 0) AS official_two_groups FROM leagues WHERE id = ? LIMIT 1`,
    [lid]
  );
  const twoGroups = Number(leagueMetaRows[0]?.official_two_groups || 0) === 1;

  if (!twoGroups) {
    const standings = await computeStandingsFromMatches({ leagueId: lid, groupId: compId }).catch(() => []);
    return { standings: Array.isArray(standings) ? standings : [], standings_groups: null };
  }

  await ensureLeagueOfficialGironiSchema();
  const gironiRows = await query(
    `SELECT team_id, girone_index FROM league_official_team_gironi WHERE league_id = ?`,
    [lid]
  );
  const idsG1 = [];
  const idsG2 = [];
  for (const r of gironiRows || []) {
    const gi = Number(r.girone_index);
    const tid = Number(r.team_id);
    if (!Number.isFinite(tid) || tid <= 0) continue;
    if (gi === 1) idsG1.push(tid);
    else if (gi === 2) idsG2.push(tid);
  }
  const useSplit = idsG1.length > 0 && idsG2.length > 0;
  if (!useSplit) {
    const standings = await computeStandingsFromMatches({ leagueId: lid, groupId: compId }).catch(() => []);
    return { standings: Array.isArray(standings) ? standings : [], standings_groups: null };
  }

  const [sA, sB] = await Promise.all([
    computeStandingsFromMatches({ leagueId: lid, groupId: compId, allowedTeamIds: idsG1 }).catch(() => []),
    computeStandingsFromMatches({ leagueId: lid, groupId: compId, allowedTeamIds: idsG2 }).catch(() => []),
  ]);
  return {
    standings: [],
    standings_groups: [
      { girone_index: 1, label: 'Girone A', standings: Array.isArray(sA) ? sA : [] },
      { girone_index: 2, label: 'Girone B', standings: Array.isArray(sB) ? sB : [] },
    ],
  };
}

async function buildKnockoutBracketForLeague({ competitionId, leagueId }) {
  const compId = Number(competitionId);
  const lid = Number(leagueId);
  if (!Number.isFinite(compId) || compId <= 0 || !Number.isFinite(lid) || lid <= 0) {
    return { quarterfinals: [], semifinals: [], final: null };
  }

  const knockoutRows = await query(
    `
    SELECT
      m.id,
      NULLIF(to_jsonb(m)->>'match_stage_id','')::int AS match_stage_id,
      ms.name AS stage_name,
      m.kickoff_at,
      m.home_team_id,
      ht.name AS home_team_name,
      ht.logo_path AS home_team_logo_path,
      m.away_team_id,
      at.name AS away_team_name,
      at.logo_path AS away_team_logo_path,
      m.home_score,
      m.away_score
    FROM official_matches m
    LEFT JOIN official_match_stages ms ON ms.id = NULLIF(to_jsonb(m)->>'match_stage_id','')::int
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.competition_id = ?
      AND (
        m.league_id = ?
        OR (
          m.league_id IS NULL
          AND ht.league_id = ?
          AND at.league_id = ?
        )
      )
      AND NULLIF(to_jsonb(m)->>'match_stage_id','')::int IN (2, 3, 4)
    ORDER BY
      NULLIF(to_jsonb(m)->>'match_stage_id','')::int ASC,
      m.kickoff_at ASC NULLS LAST,
      m.id ASC
    `,
    [compId, lid, lid, lid]
  );

  const knockoutIds = (Array.isArray(knockoutRows) ? knockoutRows : [])
    .map((r) => Number(r.id))
    .filter((n) => Number.isFinite(n) && n > 0);
  const knockoutTeamByMatchId = new Map(
    (Array.isArray(knockoutRows) ? knockoutRows : []).map((r) => [
      Number(r.id),
      { home_team_id: Number(r.home_team_id || 0), away_team_id: Number(r.away_team_id || 0) },
    ])
  );
  const liveScoreByMatch = new Map();
  if (knockoutIds.length > 0) {
    const ph = knockoutIds.map(() => '?').join(', ');
    const evRows = await query(
      `
      SELECT match_id, event_type, team_side, team_id
      FROM official_match_events
      WHERE match_id IN (${ph})
      ORDER BY id ASC
      `,
      knockoutIds
    );
    (Array.isArray(evRows) ? evRows : []).forEach((e) => {
      const mid = Number(e.match_id);
      if (!liveScoreByMatch.has(mid)) {
        liveScoreByMatch.set(mid, { home: 0, away: 0, homeShootout: 0, awayShootout: 0, hasEvents: false, hasShootout: false });
      }
      const s = liveScoreByMatch.get(mid);
      s.hasEvents = true;
      const teamRef = knockoutTeamByMatchId.get(mid) || { home_team_id: 0, away_team_id: 0 };
      const evTeamId = Number(e.team_id);
      const byTeamId =
        Number.isFinite(evTeamId) && evTeamId > 0 && teamRef.home_team_id > 0 && teamRef.away_team_id > 0;
      if (e.event_type === 'shootout_goal') {
        s.hasShootout = true;
        if (byTeamId) {
          if (evTeamId === teamRef.home_team_id) s.homeShootout += 1;
          if (evTeamId === teamRef.away_team_id) s.awayShootout += 1;
        } else {
          if (e.team_side === 'home') s.homeShootout += 1;
          if (e.team_side === 'away') s.awayShootout += 1;
        }
      } else if (e.event_type === 'shootout_missed') {
        s.hasShootout = true;
      } else if (isRegularGoalEventType(e.event_type)) {
        if (byTeamId) {
          if (evTeamId === teamRef.home_team_id) s.home += 1;
          if (evTeamId === teamRef.away_team_id) s.away += 1;
        } else {
          if (e.team_side === 'home') s.home += 1;
          if (e.team_side === 'away') s.away += 1;
        }
      } else if (e.event_type === 'own_goal') {
        if (byTeamId) {
          if (evTeamId === teamRef.home_team_id) s.away += 1;
          if (evTeamId === teamRef.away_team_id) s.home += 1;
        } else {
          if (e.team_side === 'home') s.away += 1;
          if (e.team_side === 'away') s.home += 1;
        }
      }
    });
  }

  const mapped = (Array.isArray(knockoutRows) ? knockoutRows : []).map((r) => {
    const live = liveScoreByMatch.get(Number(r.id)) || null;
    const hs = live?.hasEvents ? Number(live.home) : (r.home_score != null ? Number(r.home_score) : null);
    const as = live?.hasEvents ? Number(live.away) : (r.away_score != null ? Number(r.away_score) : null);
    const hps = live?.hasShootout ? Number(live.homeShootout) : null;
    const aps = live?.hasShootout ? Number(live.awayShootout) : null;
    const homeLogoPath = normalizeTeamLogoPathForApi(r?.home_team_logo_path);
    const awayLogoPath = normalizeTeamLogoPathForApi(r?.away_team_logo_path);
    return {
      id: Number(r.id),
      stage_id: Number(r.match_stage_id),
      stage_name: r.stage_name != null ? String(r.stage_name) : null,
      kickoff_at: r.kickoff_at,
      home_team_id: r.home_team_id != null ? Number(r.home_team_id) : null,
      home_team_name: r.home_team_name != null ? String(r.home_team_name) : null,
      home_team_logo_path: homeLogoPath,
      home_team_logo_url: logoUrlForPath(homeLogoPath),
      away_team_id: r.away_team_id != null ? Number(r.away_team_id) : null,
      away_team_name: r.away_team_name != null ? String(r.away_team_name) : null,
      away_team_logo_path: awayLogoPath,
      away_team_logo_url: logoUrlForPath(awayLogoPath),
      home_score: Number.isFinite(hs) ? hs : null,
      away_score: Number.isFinite(as) ? as : null,
      home_shootout_score: Number.isFinite(hps) && Number.isFinite(aps) ? hps : null,
      away_shootout_score: Number.isFinite(hps) && Number.isFinite(aps) ? aps : null,
    };
  });

  return {
    quarterfinals: mapped.filter((m) => m.stage_id === 4),
    semifinals: mapped.filter((m) => m.stage_id === 2),
    final: mapped.find((m) => m.stage_id === 3) || null,
  };
}

async function getSuperuserLevel(userId) {
  try {
    const rows = await query(`SELECT COALESCE(is_superuser, 0) AS is_superuser FROM users WHERE id = ? LIMIT 1`, [
      Number(userId),
    ]);
    return Number(rows[0]?.is_superuser || 0);
  } catch (_) {
    return 0;
  }
}

function requireSuperuserLevels(levels) {
  return async (req, res, next) => {
    const level = await getSuperuserLevel(req.user?.userId);
    if (levels.includes(level)) return next();
    return res.status(403).json({ message: 'Operazione riservata ai superuser' });
  };
}

function safeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function listCompetitionsOnlyEnabled() {
  return await query(
    `SELECT og.id, og.name, COALESCE(og.is_match_competition_enabled, 1) AS is_match_competition_enabled
     FROM official_league_groups og
     WHERE COALESCE(og.is_match_competition_enabled, 1) = 1
     ORDER BY og.name ASC`
  );
}

// GET /competitions — competizioni globali (gruppi ufficiali)
router.get('/competitions', authenticateToken, async (_req, res) => {
  try {
    const rows = await listCompetitionsOnlyEnabled();
    return res.json(rows.map((r) => ({ id: safeInt(r.id), name: r.name })));
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento competizioni', error: err.message });
  }
});

// GET /matches?date=YYYY-MM-DD — lista match (con preferiti/notifiche)
router.get('/matches', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const date = String(req.query?.date || '').trim();
    if (!date) return res.status(400).json({ message: 'date mancante' });
    const rows = await query(
      `
      WITH su AS (
        SELECT CASE WHEN COALESCE(is_superuser, 0) IN (1, 2) THEN 1 ELSE 0 END AS can_see
        FROM users WHERE id = ?
      ),
      ev_scores AS (
        SELECT
          e.match_id,
          SUM(CASE
                WHEN e.event_type IN ('goal','penalty_goal') AND (
                  e.team_id = om.home_team_id OR (e.team_id IS NULL AND e.team_side = 'home')
                ) THEN 1
                WHEN e.event_type = 'own_goal' AND (
                  e.team_id = om.away_team_id OR (e.team_id IS NULL AND e.team_side = 'away')
                ) THEN 1
                ELSE 0
              END)::int AS ev_home,
          SUM(CASE
                WHEN e.event_type IN ('goal','penalty_goal') AND (
                  e.team_id = om.away_team_id OR (e.team_id IS NULL AND e.team_side = 'away')
                ) THEN 1
                WHEN e.event_type = 'own_goal' AND (
                  e.team_id = om.home_team_id OR (e.team_id IS NULL AND e.team_side = 'home')
                ) THEN 1
                ELSE 0
              END)::int AS ev_away
          ,
          SUM(CASE
                WHEN e.event_type = 'shootout_goal' AND (
                  e.team_id = om.home_team_id OR (e.team_id IS NULL AND e.team_side = 'home')
                ) THEN 1
                ELSE 0
              END)::int AS ev_home_shootout,
          SUM(CASE
                WHEN e.event_type = 'shootout_goal' AND (
                  e.team_id = om.away_team_id OR (e.team_id IS NULL AND e.team_side = 'away')
                ) THEN 1
                ELSE 0
              END)::int AS ev_away_shootout,
          BOOL_OR(e.event_type IN ('shootout_goal','shootout_missed')) AS has_shootout
        FROM official_match_events e
        JOIN official_matches om ON om.id = e.match_id
        WHERE e.event_type IN ('goal','penalty_goal','own_goal','shootout_goal','shootout_missed')
        GROUP BY e.match_id
      ),
      last_phase AS (
        SELECT DISTINCT ON (e.match_id)
          e.match_id,
          e.event_type AS last_phase_type,
          e.minute AS last_phase_minute
        FROM official_match_events e
        WHERE e.event_type IN (
          'match_start','half_time','second_half_start','second_half_end',
          'extra_first_half_start','extra_first_half_end','extra_second_half_start','extra_second_half_end',
          'penalties_start','match_end'
        )
        ORDER BY e.match_id, e.id DESC
      ),
      phase_events AS (
        SELECT
          e.match_id,
          json_agg(
            json_build_object(
              'id', e.id,
              'event_type', e.event_type,
              'minute', e.minute,
              'created_at', e.created_at
            )
            ORDER BY e.id ASC
          ) AS live_phase_events
        FROM official_match_events e
        WHERE e.event_type IN (
          'match_start','half_time','second_half_start','second_half_end',
          'extra_first_half_start','extra_first_half_end','extra_second_half_start','extra_second_half_end',
          'penalties_start','match_end'
        )
        GROUP BY e.match_id
      ),
${SQL_WALKOVER_MATCHES_CTE}
      SELECT
        m.id,
        m.competition_id,
        m.league_id,
        lg.name AS league_name,
        og.name AS competition_name,
        m.kickoff_at,
        COALESCE(m.status, 'scheduled') AS status,
        m.notes,
        m.venue,
        m.referee,
        ms.name AS match_stage,
        NULLIF(to_jsonb(m)->>'match_stage_id','')::int AS match_stage_id,
        m.home_team_id,
        ht.name AS home_team_name,
        ht.logo_path AS home_team_logo_path,
        m.away_team_id,
        at.name AS away_team_name,
        at.logo_path AS away_team_logo_path,
        COALESCE(evs.ev_home, m.home_score) AS home_score,
        COALESCE(evs.ev_away, m.away_score) AS away_score,
        COALESCE(evs.ev_home, m.home_score) AS live_home_score,
        COALESCE(evs.ev_away, m.away_score) AS live_away_score,
        CASE WHEN COALESCE(evs.has_shootout, false) THEN COALESCE(evs.ev_home_shootout, 0) ELSE NULL END AS home_shootout_score,
        CASE WHEN COALESCE(evs.has_shootout, false) THEN COALESCE(evs.ev_away_shootout, 0) ELSE NULL END AS away_shootout_score,
        COALESCE(fm.match_id IS NOT NULL, false) AS is_favorite_match,
        COALESCE(mn.enabled, 0) AS notifications_enabled,
        COALESCE(lp.last_phase_type, NULL) AS last_phase_type,
        COALESCE(lp.last_phase_minute, NULL) AS last_phase_minute,
        COALESCE(pe.live_phase_events, '[]'::json) AS live_phase_events,
        COALESCE(wo.match_id IS NOT NULL, false) AS is_walkover
      FROM official_matches m
      INNER JOIN official_league_groups og ON og.id = m.competition_id
      LEFT JOIN leagues lg ON lg.id = m.league_id
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      LEFT JOIN official_match_stages ms ON ms.id = NULLIF(to_jsonb(m)->>'match_stage_id','')::int
      LEFT JOIN ev_scores evs ON evs.match_id = m.id
      LEFT JOIN last_phase lp ON lp.match_id = m.id
      LEFT JOIN phase_events pe ON pe.match_id = m.id
      LEFT JOIN walkover_matches wo ON wo.match_id = m.id
      LEFT JOIN user_official_match_favorites fm ON fm.user_id = ? AND fm.match_id = m.id
      LEFT JOIN user_official_match_notifications mn ON mn.user_id = ? AND mn.match_id = m.id
      WHERE (m.kickoff_at AT TIME ZONE 'Europe/Rome')::date = ?::date
        AND ((SELECT can_see FROM su) = 1 OR COALESCE(m.is_admin_only, 0) = 0)
      ORDER BY (fm.match_id IS NOT NULL) DESC, m.kickoff_at ASC, m.id ASC
      `,
      [userId, userId, userId, date]
    );
    const withLogos = (Array.isArray(rows) ? rows : []).map((r) => {
      const homeLogoPath = normalizeTeamLogoPathForApi(r?.home_team_logo_path);
      const awayLogoPath = normalizeTeamLogoPathForApi(r?.away_team_logo_path);
      return {
        ...r,
        home_team_logo_path: homeLogoPath,
        home_team_logo_url: logoUrlForPath(homeLogoPath),
        away_team_logo_path: awayLogoPath,
        away_team_logo_url: logoUrlForPath(awayLogoPath),
      };
    });

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    return res.json({ date, matches: withLogos });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento partite', error: err.message });
  }
});

// GET /matches/:matchId/detail — dettaglio match con tabs (overview/formazione/classifica)
router.get('/matches/:matchId/detail', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const matchId = Number(req.params.matchId);
    if (!matchId || matchId <= 0) return res.status(400).json({ message: 'matchId non valido' });

    const rows = await query(
      `
      SELECT
        m.id,
        m.competition_id,
        m.league_id,
        m.home_team_id,
        m.away_team_id,
        m.kickoff_at,
        COALESCE(m.status, 'scheduled') AS status,
        m.venue,
        m.referee,
        ms.name AS match_stage,
        NULLIF(to_jsonb(m)->>'match_stage_id','')::int AS match_stage_id,
        m.home_score,
        m.away_score,
        NULLIF(to_jsonb(m)->>'regulation_half_minutes','')::int AS regulation_half_minutes,
        NULLIF(to_jsonb(m)->>'extra_time_enabled','')::int AS extra_time_enabled,
        NULLIF(to_jsonb(m)->>'extra_first_half_minutes','')::int AS extra_first_half_minutes,
        NULLIF(to_jsonb(m)->>'extra_second_half_minutes','')::int AS extra_second_half_minutes,
        NULLIF(to_jsonb(m)->>'penalties_enabled','')::int AS penalties_enabled,
        og.name AS competition_name,
        ht.name AS home_team_name,
        at.name AS away_team_name,
        ht.league_id AS home_league_id,
        at.league_id AS away_league_id,
        COALESCE(fm.match_id IS NOT NULL, false) AS is_favorite_match,
        COALESCE(mn.enabled, 0) AS notifications_enabled
      FROM official_matches m
      INNER JOIN official_league_groups og ON og.id = m.competition_id
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      LEFT JOIN official_match_stages ms ON ms.id = NULLIF(to_jsonb(m)->>'match_stage_id','')::int
      LEFT JOIN user_official_match_favorites fm ON fm.user_id = ? AND fm.match_id = m.id
      LEFT JOIN user_official_match_notifications mn ON mn.user_id = ? AND mn.match_id = m.id
      WHERE m.id = ?
      LIMIT 1
      `,
      [userId, userId, matchId]
    );
    const matchRow = rows[0];
    if (!matchRow) return res.status(404).json({ message: 'Partita non trovata' });
    const homeTeamId = Number(matchRow.home_team_id);
    const awayTeamId = Number(matchRow.away_team_id);
    const homeLeagueId = Number(matchRow.home_league_id || 0);
    const awayLeagueId = Number(matchRow.away_league_id || 0);
    const matchLeagueId = Number(matchRow.league_id || 0);
    const currentLeagueId =
      matchLeagueId > 0 ? matchLeagueId : (homeLeagueId > 0 && homeLeagueId === awayLeagueId ? homeLeagueId : 0);

    await ensureUnavailablePlayersTable();
    const emptyKnockout = { quarterfinals: [], semifinals: [], final: null };
    const [homeTeam, awayTeam, rawEvents, homeLineup, awayLineup, unavailableRows, standingsBundle, knockout] = await Promise.all([
      getTeamMeta(homeTeamId),
      getTeamMeta(awayTeamId),
      query(
        `SELECT id, match_id, event_type, minute, team_side, team_id, player_id, assist_player_id, title, payload_json, created_at
         FROM official_match_events WHERE match_id = ? ORDER BY minute ASC, id ASC`,
        [matchId]
      ),
      getTeamPlayersLineup(homeTeamId),
      getTeamPlayersLineup(awayTeamId),
      query(`SELECT player_id FROM official_match_unavailable_players WHERE match_id = ?`, [matchId]),
      currentLeagueId > 0
        ? computeOfficialLeagueGironiStandings({
            leagueId: currentLeagueId,
            competitionId: Number(matchRow.competition_id),
          }).catch(() => ({ standings: [], standings_groups: null }))
        : Promise.resolve({ standings: [], standings_groups: null }),
      currentLeagueId > 0
        ? buildKnockoutBracketForLeague({
            leagueId: currentLeagueId,
            competitionId: Number(matchRow.competition_id),
          }).catch(() => emptyKnockout)
        : Promise.resolve(emptyKnockout),
    ]);

    const homeLogoPath = normalizeTeamLogoPathForApi(homeTeam?.logo_path);
    const awayLogoPath = normalizeTeamLogoPathForApi(awayTeam?.logo_path);
    const match = {
      ...matchRow,
      home_team_logo_path: homeLogoPath,
      home_team_logo_url: homeTeam?.logo_url || logoUrlForPath(homeLogoPath),
      away_team_logo_path: awayLogoPath,
      away_team_logo_url: awayTeam?.logo_url || logoUrlForPath(awayLogoPath),
      home_jersey_color: normalizeJerseyColorForApi(homeTeam?.jersey_color),
      away_jersey_color: normalizeJerseyColorForApi(awayTeam?.jersey_color),
      regulation_half_minutes: matchRow.regulation_half_minutes != null ? Number(matchRow.regulation_half_minutes) : 30,
      extra_time_enabled: matchRow.extra_time_enabled != null ? Number(matchRow.extra_time_enabled) : 0,
      extra_first_half_minutes: matchRow.extra_first_half_minutes != null ? Number(matchRow.extra_first_half_minutes) : 0,
      extra_second_half_minutes: matchRow.extra_second_half_minutes != null ? Number(matchRow.extra_second_half_minutes) : 0,
      penalties_enabled: matchRow.penalties_enabled != null ? Number(matchRow.penalties_enabled) : 0,
    };

    const events = (Array.isArray(rawEvents) ? rawEvents : []).map(enrichEventForApi);
    match.is_walkover = computeIsWalkoverFromEvents(events) ? 1 : 0;
    const nowMs = Date.now();
    const correctedEvents = events.map((ev) => {
      if (!ev || ev.event_type !== 'match_start' || !ev.created_at) return ev;
      const evMs = new Date(String(ev.created_at).replace(' ', 'T')).getTime();
      if (!Number.isFinite(evMs)) return ev;
      const deltaSec = Math.floor((nowMs - evMs) / 1000);
      if (deltaSec > 900) {
        return { ...ev, created_at: new Date(nowMs).toISOString() };
      }
      return ev;
    });

    const unavailableSet = new Set((unavailableRows || []).map((r) => Number(r.player_id)).filter((n) => Number.isFinite(n) && n > 0));
    const homeAvailable = homeLineup.filter((p) => !unavailableSet.has(Number(p.id)));
    const awayAvailable = awayLineup.filter((p) => !unavailableSet.has(Number(p.id)));
    const homeUnavailable = homeLineup.filter((p) => unavailableSet.has(Number(p.id)));
    const awayUnavailable = awayLineup.filter((p) => unavailableSet.has(Number(p.id)));

    const standings = Array.isArray(standingsBundle?.standings) ? standingsBundle.standings : [];
    const standings_groups = standingsBundle?.standings_groups ?? null;
    const knockoutSafe = knockout && typeof knockout === 'object' ? knockout : emptyKnockout;

    return res.json({
      match,
      lineups: { home: homeAvailable, away: awayAvailable },
      unavailable_lineups: { home: homeUnavailable, away: awayUnavailable },
      team_players: { home: homeLineup, away: awayLineup },
      events: correctedEvents,
      standings,
      standings_groups,
      knockout: knockoutSafe,
      favorites: {
        match: Number(match.is_favorite_match) ? 1 : 0,
        home_team: 0,
        away_team: 0,
      },
      notifications: { enabled: Number(match.notifications_enabled) ? 1 : 0 },
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento dettaglio partita', error: err.message });
  }
});

// GET /matches/teams/:teamId/detail?competition_id=xx — dettaglio squadra ufficiale + preferenze utente
router.get('/matches/teams/:teamId/detail', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const teamId = Number(req.params.teamId);
    const competitionId = Number(req.query?.competition_id);
    if (!teamId || teamId <= 0) return res.status(400).json({ message: 'teamId non valido' });
    if (!competitionId || competitionId <= 0) return res.status(400).json({ message: 'competition_id non valido' });

    const teamRows = await query(
      `SELECT t.id, t.name FROM teams t WHERE t.id = ? LIMIT 1`,
      [teamId]
    );
    const team = teamRows[0];
    if (!team) return res.status(404).json({ message: 'Squadra non trovata' });

    const teamName = String(team.name || '').trim();
    if (!teamName) return res.status(404).json({ message: 'Squadra non valida' });

    const teamNameNorm = normalizeTeamNameForFavorite(teamName);
    const [logoCandidates, currentPref, favoriteCountRows] = await Promise.all([
      query(
        `SELECT t.logo_path, NULLIF(to_jsonb(l)->>'reference_year','')::int AS reference_year
         FROM teams t
         INNER JOIN leagues l ON l.id = t.league_id
         WHERE l.official_group_id = ?
           AND COALESCE(l.is_official_squad_public, 0) = 1
           AND LOWER(TRIM(t.name)) = LOWER(TRIM(?))
         ORDER BY
           CASE WHEN COALESCE(NULLIF(t.logo_path, ''), '') <> '' THEN 0 ELSE 1 END ASC,
           NULLIF(to_jsonb(l)->>'reference_year','')::int DESC NULLS LAST,
           t.id DESC`,
        [competitionId, teamName]
      ),
      query(
        `SELECT COALESCE(is_heart, 0) AS is_heart, COALESCE(notifications_enabled, 0) AS notifications_enabled
         FROM user_official_team_favorites
         WHERE user_id = ? AND official_group_id = ? AND team_name_norm = ?
         LIMIT 1`,
        [userId, competitionId, teamNameNorm]
      ),
      query(
        `SELECT COUNT(*)::int AS favorite_count
         FROM user_official_team_favorites
         WHERE official_group_id = ? AND team_name_norm = ? AND COALESCE(is_heart, 0) = 1`,
        [competitionId, teamNameNorm]
      ),
    ]);

    const bestLogoRaw = (logoCandidates || []).find((r) => String(r?.logo_path || '').trim() !== '')?.logo_path || null;
    const bestLogoPath = normalizeTeamLogoPathForApi(bestLogoRaw);
    const pref = currentPref[0] || null;
    const favoriteCount = Number(favoriteCountRows?.[0]?.favorite_count || 0);

    return res.json({
      team: {
        id: Number(team.id),
        name: teamName,
        competition_id: competitionId,
        logo_path: bestLogoPath,
        logo_url: logoUrlForPath(bestLogoPath),
        favorite_count: Number.isFinite(favoriteCount) ? favoriteCount : 0,
      },
      favorites: {
        team: Number(pref?.is_heart || 0) ? 1 : 0,
      },
      notifications: {
        enabled: Number(pref?.notifications_enabled || 0) ? 1 : 0,
      },
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento dettaglio squadra', error: err.message });
  }
});

// GET /matches/teams/:teamId/matches?competition_id=xx — tutte le partite della squadra nel gruppo ufficiale (tutti gli anni)
router.get('/matches/teams/:teamId/matches', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const teamId = Number(req.params.teamId);
    const competitionId = Number(req.query?.competition_id);
    if (!teamId || teamId <= 0) return res.status(400).json({ message: 'teamId non valido' });
    if (!competitionId || competitionId <= 0) return res.status(400).json({ message: 'competition_id non valido' });

    const teamRows = await query(`SELECT id, name FROM teams WHERE id = ? LIMIT 1`, [teamId]);
    const team = teamRows[0];
    if (!team) return res.status(404).json({ message: 'Squadra non trovata' });
    const teamName = String(team.name || '').trim();
    if (!teamName) return res.status(404).json({ message: 'Squadra non valida' });

    const rows = await query(
      `
      WITH su AS (
        SELECT CASE WHEN COALESCE(is_superuser, 0) IN (1, 2) THEN 1 ELSE 0 END AS can_see
        FROM users WHERE id = ?
      ),
      ev_scores AS (
        SELECT
          e.match_id,
          SUM(CASE
                WHEN e.event_type IN ('goal','penalty_goal') AND (
                  e.team_id = om.home_team_id OR (e.team_id IS NULL AND e.team_side = 'home')
                ) THEN 1
                WHEN e.event_type = 'own_goal' AND (
                  e.team_id = om.away_team_id OR (e.team_id IS NULL AND e.team_side = 'away')
                ) THEN 1
                ELSE 0
              END)::int AS ev_home,
          SUM(CASE
                WHEN e.event_type IN ('goal','penalty_goal') AND (
                  e.team_id = om.away_team_id OR (e.team_id IS NULL AND e.team_side = 'away')
                ) THEN 1
                WHEN e.event_type = 'own_goal' AND (
                  e.team_id = om.home_team_id OR (e.team_id IS NULL AND e.team_side = 'home')
                ) THEN 1
                ELSE 0
              END)::int AS ev_away,
          SUM(CASE
                WHEN e.event_type = 'shootout_goal' AND (
                  e.team_id = om.home_team_id OR (e.team_id IS NULL AND e.team_side = 'home')
                ) THEN 1
                ELSE 0
              END)::int AS ev_home_shootout,
          SUM(CASE
                WHEN e.event_type = 'shootout_goal' AND (
                  e.team_id = om.away_team_id OR (e.team_id IS NULL AND e.team_side = 'away')
                ) THEN 1
                ELSE 0
              END)::int AS ev_away_shootout,
          BOOL_OR(e.event_type IN ('shootout_goal','shootout_missed')) AS has_shootout
        FROM official_match_events e
        JOIN official_matches om ON om.id = e.match_id
        WHERE e.event_type IN ('goal','penalty_goal','own_goal','shootout_goal','shootout_missed')
        GROUP BY e.match_id
      ),
      last_phase AS (
        SELECT DISTINCT ON (e.match_id)
          e.match_id,
          e.event_type AS last_phase_type
        FROM official_match_events e
        WHERE e.event_type IN (
          'match_start','half_time','second_half_start','second_half_end',
          'extra_first_half_start','extra_half_time','extra_second_half_start','extra_second_half_end',
          'penalties_start','match_end'
        )
        ORDER BY e.match_id, e.id DESC
      ),
${SQL_WALKOVER_MATCHES_CTE}
      SELECT
        m.id,
        m.kickoff_at,
        m.competition_id,
        ms.name AS match_stage,
        m.home_team_id,
        ht.name AS home_team_name,
        ht.logo_path AS home_team_logo_path,
        m.away_team_id,
        at.name AS away_team_name,
        at.logo_path AS away_team_logo_path,
        COALESCE(evs.ev_home, m.home_score, CASE WHEN lp.last_phase_type = 'match_end' THEN 0 END) AS home_score,
        COALESCE(evs.ev_away, m.away_score, CASE WHEN lp.last_phase_type = 'match_end' THEN 0 END) AS away_score,
        CASE WHEN COALESCE(evs.has_shootout, false) THEN COALESCE(evs.ev_home_shootout, 0) ELSE NULL END AS home_shootout_score,
        CASE WHEN COALESCE(evs.has_shootout, false) THEN COALESCE(evs.ev_away_shootout, 0) ELSE NULL END AS away_shootout_score,
        lp.last_phase_type,
        COALESCE(wo.match_id IS NOT NULL, false) AS is_walkover
      FROM official_matches m
      INNER JOIN teams ht ON ht.id = m.home_team_id
      INNER JOIN teams at ON at.id = m.away_team_id
      LEFT JOIN official_match_stages ms ON ms.id = NULLIF(to_jsonb(m)->>'match_stage_id','')::int
      LEFT JOIN ev_scores evs ON evs.match_id = m.id
      LEFT JOIN last_phase lp ON lp.match_id = m.id
      LEFT JOIN walkover_matches wo ON wo.match_id = m.id
      WHERE m.competition_id = ?
        AND ((SELECT can_see FROM su) = 1 OR COALESCE(m.is_admin_only, 0) = 0)
        AND (
          LOWER(TRIM(ht.name)) = LOWER(TRIM(?))
          OR LOWER(TRIM(at.name)) = LOWER(TRIM(?))
        )
      ORDER BY m.kickoff_at ASC, m.id ASC
      `,
      [userId, competitionId, teamName, teamName]
    );

    const matches = (Array.isArray(rows) ? rows : []).map((r) => {
      const homeLogoPath = normalizeTeamLogoPathForApi(r?.home_team_logo_path);
      const awayLogoPath = normalizeTeamLogoPathForApi(r?.away_team_logo_path);
      return {
        id: Number(r.id),
        kickoff_at: r.kickoff_at,
        competition_id: Number(r.competition_id),
        match_stage: r.match_stage != null ? String(r.match_stage) : null,
        home_team_id: Number(r.home_team_id),
        home_team_name: r.home_team_name,
        home_team_logo_path: homeLogoPath,
        home_team_logo_url: logoUrlForPath(homeLogoPath),
        away_team_id: Number(r.away_team_id),
        away_team_name: r.away_team_name,
        away_team_logo_path: awayLogoPath,
        away_team_logo_url: logoUrlForPath(awayLogoPath),
        home_score: r.home_score != null ? Number(r.home_score) : null,
        away_score: r.away_score != null ? Number(r.away_score) : null,
        home_shootout_score: r.home_shootout_score != null ? Number(r.home_shootout_score) : null,
        away_shootout_score: r.away_shootout_score != null ? Number(r.away_shootout_score) : null,
        last_phase_type: r.last_phase_type || null,
        is_walkover: r.is_walkover === true || r.is_walkover === 1 ? 1 : 0,
      };
    });

    return res.json({ team: { id: Number(team.id), name: teamName }, matches });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento partite squadra', error: err.message });
  }
});

// GET /matches/teams/:teamId/season-standings?competition_id=xx&reference_year=yyyy
// Restituisce anni disponibili per la squadra nel gruppo ufficiale e classifica del solo girone per l'anno selezionato.
router.get('/matches/teams/:teamId/season-standings', authenticateToken, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const competitionId = Number(req.query?.competition_id);
    const referenceYearRaw = req.query?.reference_year;
    const requestedYear =
      referenceYearRaw == null || String(referenceYearRaw).trim() === ''
        ? null
        : Number(referenceYearRaw);

    if (!teamId || teamId <= 0) return res.status(400).json({ message: 'teamId non valido' });
    if (!competitionId || competitionId <= 0) return res.status(400).json({ message: 'competition_id non valido' });
    if (requestedYear != null && !Number.isFinite(requestedYear)) {
      return res.status(400).json({ message: 'reference_year non valido' });
    }

    const seasonLeagues = await query(
      `SELECT
        root.id AS team_id, root.name AS team_name,
        l.id AS league_id,
        NULLIF(to_jsonb(l)->>'reference_year','')::int AS reference_year
      FROM teams root
      INNER JOIN leagues l ON l.official_group_id = ?
        AND COALESCE(l.is_official, 0) = 1
        AND COALESCE(l.is_official_squad_public, 0) = 1
      INNER JOIN teams t ON t.league_id = l.id AND LOWER(TRIM(t.name)) = LOWER(TRIM(root.name))
      WHERE root.id = ?
      GROUP BY root.id, root.name, l.id, NULLIF(to_jsonb(l)->>'reference_year','')::int
      ORDER BY NULLIF(to_jsonb(l)->>'reference_year','')::int DESC NULLS LAST, l.id DESC`,
      [competitionId, teamId]
    );
    const teamName = String(seasonLeagues[0]?.team_name || '').trim();
    if (!teamName) {
      const fallback = await query(`SELECT name FROM teams WHERE id = ? LIMIT 1`, [teamId]);
      if (!fallback[0]) return res.status(404).json({ message: 'Squadra non trovata' });
      return res.json({ team: { id: teamId, name: String(fallback[0].name || '').trim() }, available_years: [], selected_year: null, standings: [], knockout: { quarterfinals: [], semifinals: [], final: null } });
    }

    const availableYears = Array.from(
      new Set(
        (Array.isArray(seasonLeagues) ? seasonLeagues : [])
          .map((r) => Number(r.reference_year))
          .filter((y) => Number.isFinite(y))
      )
    ).sort((a, b) => b - a);

    const selectedYear =
      requestedYear != null && Number.isFinite(requestedYear)
        ? Math.trunc(requestedYear)
        : availableYears.length > 0
          ? availableYears[0]
          : null;

    let selectedLeagueId = null;
    if (selectedYear != null) {
      const hit = (seasonLeagues || []).find((r) => Number(r.reference_year) === selectedYear);
      selectedLeagueId = hit ? Number(hit.league_id) : null;
    }
    if (!selectedLeagueId) {
      selectedLeagueId = Number((seasonLeagues || [])[0]?.league_id || 0) || null;
    }

    let standings = [];
    let standings_groups = null;
    let knockout = { quarterfinals: [], semifinals: [], final: null };
    if (selectedLeagueId) {
      const [tablesResult, ko] = await Promise.all([
        computeOfficialLeagueGironiStandings({ leagueId: selectedLeagueId, competitionId }),
        buildKnockoutBracketForLeague({ leagueId: selectedLeagueId, competitionId }),
      ]);
      standings = tablesResult.standings;
      standings_groups = tablesResult.standings_groups;
      knockout = ko;
    }

    return res.json({
      team: { id: teamId, name: teamName },
      available_years: availableYears,
      selected_year: selectedYear,
      standings: Array.isArray(standings) ? standings : [],
      standings_groups: standings_groups,
      knockout,
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento stagione squadra', error: err.message });
  }
});

// GET /matches/teams/:teamId/season-squad?competition_id=xx&reference_year=yyyy
// Restituisce anni disponibili e rosa della squadra (con maglia/ruolo/numero) per l'anno selezionato.
router.get('/matches/teams/:teamId/season-squad', authenticateToken, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const competitionId = Number(req.query?.competition_id);
    const referenceYearRaw = req.query?.reference_year;
    const requestedYear =
      referenceYearRaw == null || String(referenceYearRaw).trim() === ''
        ? null
        : Number(referenceYearRaw);

    if (!teamId || teamId <= 0) return res.status(400).json({ message: 'teamId non valido' });
    if (!competitionId || competitionId <= 0) return res.status(400).json({ message: 'competition_id non valido' });
    if (requestedYear != null && !Number.isFinite(requestedYear)) {
      return res.status(400).json({ message: 'reference_year non valido' });
    }

    const seasonLeagues = await query(
      `SELECT root.id AS team_id, root.name AS team_name,
        l.id AS league_id, NULLIF(to_jsonb(l)->>'reference_year','')::int AS reference_year
      FROM teams root
      INNER JOIN leagues l ON l.official_group_id = ?
        AND COALESCE(l.is_official, 0) = 1 AND COALESCE(l.is_official_squad_public, 0) = 1
      INNER JOIN teams t ON t.league_id = l.id AND LOWER(TRIM(t.name)) = LOWER(TRIM(root.name))
      WHERE root.id = ?
      GROUP BY root.id, root.name, l.id, NULLIF(to_jsonb(l)->>'reference_year','')::int
      ORDER BY NULLIF(to_jsonb(l)->>'reference_year','')::int DESC NULLS LAST, l.id DESC`,
      [competitionId, teamId]
    );
    const teamName = String(seasonLeagues[0]?.team_name || '').trim();
    if (!teamName) {
      const fb = await query(`SELECT name FROM teams WHERE id = ? LIMIT 1`, [teamId]);
      if (!fb[0]) return res.status(404).json({ message: 'Squadra non trovata' });
      return res.json({ team: { id: teamId, name: String(fb[0].name || '').trim() }, available_years: [], selected_year: null, league_id: null, jersey_color: null, squad: [] });
    }

    const availableYears = Array.from(
      new Set((seasonLeagues || []).map((r) => Number(r.reference_year)).filter((y) => Number.isFinite(y)))
    ).sort((a, b) => b - a);

    const selectedYear =
      requestedYear != null && Number.isFinite(requestedYear)
        ? Math.trunc(requestedYear)
        : availableYears.length > 0 ? availableYears[0] : null;

    let selectedLeagueId = null;
    if (selectedYear != null) {
      const hit = (seasonLeagues || []).find((r) => Number(r.reference_year) === selectedYear);
      selectedLeagueId = hit ? Number(hit.league_id) : null;
    }
    if (!selectedLeagueId) {
      selectedLeagueId = Number((seasonLeagues || [])[0]?.league_id || 0) || null;
    }

    let selectedTeamId = null;
    let jerseyColor = null;
    if (selectedLeagueId) {
      const teamForSeasonRows = await query(
        `SELECT t.id, COALESCE(NULLIF(to_jsonb(t)->>'jersey_color',''), NULLIF(t.jersey_color, '')) AS jersey_color
         FROM teams t WHERE t.league_id = ? AND LOWER(TRIM(t.name)) = LOWER(TRIM(?))
         ORDER BY t.id DESC LIMIT 1`,
        [selectedLeagueId, teamName]
      );
      const seasonTeam = teamForSeasonRows[0] || null;
      selectedTeamId = Number(seasonTeam?.id || 0) || null;
      jerseyColor = normalizeJerseyColorForApi(seasonTeam?.jersey_color);
    }

    const squad = selectedTeamId ? await getTeamPlayersLineup(selectedTeamId) : [];
    return res.json({
      team: { id: teamId, name: teamName },
      available_years: availableYears,
      selected_year: selectedYear,
      league_id: selectedLeagueId ? Number(selectedLeagueId) : null,
      jersey_color: jerseyColor,
      squad: Array.isArray(squad) ? squad : [],
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento rosa stagione squadra', error: err.message });
  }
});

/** Leghe collegate (stesso bacino voti) per scope player_ratings. */
async function expandLeagueIdsForRatingsMany(leagueIds) {
  const base = [...new Set((leagueIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!base.length) return [];
  const ph = base.map(() => '?').join(', ');
  const rows = await query(
    `SELECT id, COALESCE(linked_to_league_id, 0) AS linked_to_league_id FROM leagues WHERE id IN (${ph})`,
    base
  );
  const effective = new Set();
  for (const lid of base) {
    const r = (rows || []).find((x) => Number(x.id) === lid);
    const linked = Number(r?.linked_to_league_id || 0);
    effective.add(linked > 0 ? linked : lid);
  }
  const effArr = [...effective];
  const ph2 = effArr.map(() => '?').join(', ');
  const children = await query(`SELECT id FROM leagues WHERE linked_to_league_id IN (${ph2})`, effArr);
  const out = new Set(base);
  effArr.forEach((id) => out.add(id));
  (children || []).forEach((c) => out.add(Number(c.id)));
  return [...out];
}

/**
 * In modalità Assolute: giocatori nello stesso cluster (approved) → una riga, presenze = somma.
 */
async function mergeAbsolutePresencesByCluster(perPlayer, officialGroupId) {
  const entries = (perPlayer || []).filter((e) => Number(e.value) > 0);
  if (!entries.length) return [];

  const groupId = Number(officialGroupId);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return entries
      .map(({ name, value }) => ({ name, value }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'it'));
  }

  const playerIds = [...new Set(entries.map((e) => Number(e.player_id)).filter((id) => id > 0))];
  if (!playerIds.length) {
    return entries
      .map(({ name, value }) => ({ name, value }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'it'));
  }

  const ph = playerIds.map(() => '?').join(', ');
  const memberRows = await query(
    `
    SELECT pcm.player_id, pcm.cluster_id
    FROM player_cluster_members pcm
    INNER JOIN player_clusters pc ON pc.id = pcm.cluster_id
    WHERE pc.official_group_id = ?
      AND pc.status = 'approved'
      AND pcm.player_id IN (${ph})
    `,
    [groupId, ...playerIds]
  );

  const playerToCluster = new Map();
  for (const r of memberRows || []) {
    const pid = Number(r.player_id);
    const cid = Number(r.cluster_id);
    if (pid > 0 && cid > 0) playerToCluster.set(pid, cid);
  }

  const buckets = new Map();
  for (const e of entries) {
    const pid = Number(e.player_id);
    const clusterId = playerToCluster.get(pid);
    const key = clusterId ? `c:${clusterId}` : `p:${pid}`;
    const prev = buckets.get(key);
    if (!prev) {
      buckets.set(key, {
        name: e.name,
        value: Number(e.value) || 0,
        labelScore: Number(e.value) || 0,
      });
      continue;
    }
    prev.value += Number(e.value) || 0;
    const v = Number(e.value) || 0;
    if (v > prev.labelScore) {
      prev.labelScore = v;
      prev.name = e.name;
    }
  }

  return [...buckets.values()]
    .filter((b) => b.value > 0)
    .map((b) => ({ name: b.name, value: b.value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'it'));
}

/**
 * Presenze con voto = come fetchPlayerStatsAggregates (games_with_rating):
 * rating > 0, una per (lega stagione, giornata), voti letti da tutte le leghe del bacino resolveLeagueIds.
 * Solo giocatori con players.team_id = teams.id della rosa di quella stagione.
 */
async function fetchOfficialTeamPresencesWithVoteRanking(seasonTeamRows, opts = {}) {
  const franchiseRows = (seasonTeamRows || [])
    .map((r) => ({
      canonLeagueId: Number(r.league_id),
      teamTableId: Number(r.id),
    }))
    .filter((r) => Number.isFinite(r.canonLeagueId) && r.canonLeagueId > 0 && Number.isFinite(r.teamTableId) && r.teamTableId > 0);
  if (!franchiseRows.length) return [];

  const scopeTriplets = [];
  for (const fr of franchiseRows) {
    const ratingLeagueIds = await expandLeagueIdsForRatingsMany([fr.canonLeagueId]);
    for (const rlid of ratingLeagueIds) {
      scopeTriplets.push([fr.canonLeagueId, fr.teamTableId, rlid]);
    }
  }
  if (!scopeTriplets.length) return [];

  const phScope = scopeTriplets.map(() => '(?, ?, ?)').join(', ');
  const flatScope = scopeTriplets.flat();

  const sql = `
    WITH franchise_scope AS (
      SELECT
        v.canon_league_id::int AS canon_league_id,
        v.team_table_id::int AS team_table_id,
        v.rating_league_id::int AS rating_league_id
      FROM (VALUES ${phScope}) AS v(canon_league_id, team_table_id, rating_league_id)
    ),
    rated AS (
      SELECT DISTINCT
        pr.player_id,
        pr.giornata,
        fs.canon_league_id
      FROM player_ratings pr
      INNER JOIN franchise_scope fs ON pr.league_id = fs.rating_league_id
      INNER JOIN players p ON p.id = pr.player_id AND p.team_id = fs.team_table_id
      WHERE pr.rating > 0
    )
    SELECT
      p.id AS player_id,
      TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, ''))) AS player_name,
      COUNT(DISTINCT (rated.canon_league_id, rated.giornata))::int AS presenze
    FROM rated
    INNER JOIN players p ON p.id = rated.player_id
    GROUP BY p.id, p.first_name, p.last_name
    HAVING COUNT(DISTINCT (rated.canon_league_id, rated.giornata)) > 0
    ORDER BY presenze DESC, player_name ASC`;

  const rows = await query(sql, flatScope);

  const perPlayer = (rows || [])
    .map((r) => ({
      player_id: Number(r.player_id),
      name: String(r.player_name || '').trim() || 'Giocatore',
      value: Number(r.presenze || 0),
    }))
    .filter((r) => r.value > 0);

  if (opts.isAbsoluteMode && Number(opts.competitionId) > 0) {
    return mergeAbsolutePresencesByCluster(perPlayer, Number(opts.competitionId));
  }

  return perPlayer
    .map(({ name, value }) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'it'));
}

// GET /matches/teams/:teamId/season-stats?competition_id=xx&reference_year=yyyy
// Statistiche squadra per anno: generale, W/D/L con %, marcatori, assistman e presenze (giornate con voto).
router.get('/matches/teams/:teamId/season-stats', authenticateToken, async (req, res) => {
  try {
    const teamId = Number(req.params.teamId);
    const competitionId = Number(req.query?.competition_id);
    const referenceYearRaw = req.query?.reference_year;
    const statsModeRaw = String(req.query?.mode || '').trim().toLowerCase();
    const isAbsoluteMode = statsModeRaw === 'absolute' || String(referenceYearRaw || '').trim().toLowerCase() === 'absolute';
    const requestedYear =
      isAbsoluteMode || referenceYearRaw == null || String(referenceYearRaw).trim() === ''
        ? null
        : Number(referenceYearRaw);

    if (!teamId || teamId <= 0) return res.status(400).json({ message: 'teamId non valido' });
    if (!competitionId || competitionId <= 0) return res.status(400).json({ message: 'competition_id non valido' });
    if (requestedYear != null && !Number.isFinite(requestedYear)) {
      return res.status(400).json({ message: 'reference_year non valido' });
    }

    const seasonLeagues = await query(
      `SELECT root.id AS team_id, root.name AS team_name,
        l.id AS league_id, NULLIF(to_jsonb(l)->>'reference_year','')::int AS reference_year
      FROM teams root
      INNER JOIN leagues l ON l.official_group_id = ?
        AND COALESCE(l.is_official, 0) = 1 AND COALESCE(l.is_official_squad_public, 0) = 1
      INNER JOIN teams t ON t.league_id = l.id AND LOWER(TRIM(t.name)) = LOWER(TRIM(root.name))
      WHERE root.id = ?
      GROUP BY root.id, root.name, l.id, NULLIF(to_jsonb(l)->>'reference_year','')::int
      ORDER BY NULLIF(to_jsonb(l)->>'reference_year','')::int DESC NULLS LAST, l.id DESC`,
      [competitionId, teamId]
    );
    const teamName = String(seasonLeagues[0]?.team_name || '').trim();
    if (!teamName) {
      const fb = await query(`SELECT name FROM teams WHERE id = ? LIMIT 1`, [teamId]);
      if (!fb[0]) return res.status(404).json({ message: 'Squadra non trovata' });
      return res.json({ team: { id: teamId, name: String(fb[0].name || '').trim() }, available_years: [], selected_year: null, general: { played: 0, goals: 0, goals_conceded: 0, yellow_cards: 0, red_cards: 0 }, outcomes: { wins: 0, draws: 0, losses: 0, wins_pct: 0, draws_pct: 0, losses_pct: 0 }, scorers: [], assistmen: [], presences: [] });
    }

    const availableYears = Array.from(
      new Set(
        (Array.isArray(seasonLeagues) ? seasonLeagues : [])
          .map((r) => Number(r.reference_year))
          .filter((y) => Number.isFinite(y))
      )
    ).sort((a, b) => b - a);

    const selectedYear = isAbsoluteMode
      ? 'absolute'
      : (
        requestedYear != null && Number.isFinite(requestedYear)
          ? Math.trunc(requestedYear)
          : availableYears.length > 0
            ? availableYears[0]
            : null
      );

    const targetLeagueIds = isAbsoluteMode
      ? Array.from(
        new Set(
          (Array.isArray(seasonLeagues) ? seasonLeagues : [])
            .map((r) => Number(r.league_id))
            .filter((id) => Number.isFinite(id) && id > 0)
        )
      )
      : (() => {
        let selectedLeagueId = null;
        if (selectedYear != null && Number.isFinite(Number(selectedYear))) {
          const hit = (seasonLeagues || []).find((r) => Number(r.reference_year) === Number(selectedYear));
          selectedLeagueId = hit ? Number(hit.league_id) : null;
        }
        if (!selectedLeagueId) {
          selectedLeagueId = Number((seasonLeagues || [])[0]?.league_id || 0) || null;
        }
        return selectedLeagueId ? [selectedLeagueId] : [];
      })();

    if (targetLeagueIds.length === 0) {
      return res.json({
        team: { id: teamId, name: teamName },
        available_years: availableYears,
        selected_year: selectedYear,
        general: { played: 0, goals: 0, goals_conceded: 0, yellow_cards: 0, red_cards: 0 },
        outcomes: { wins: 0, draws: 0, losses: 0, wins_pct: 0, draws_pct: 0, losses_pct: 0 },
        scorers: [],
        assistmen: [],
        presences: [],
      });
    }

    const phLeagueIds = targetLeagueIds.map(() => '?').join(', ');
    const [seasonTeamRows, seasonMatches] = await Promise.all([
      query(
        `SELECT id, league_id FROM teams
         WHERE league_id IN (${phLeagueIds}) AND LOWER(TRIM(name)) = LOWER(TRIM(?))
         ORDER BY id DESC`,
        [...targetLeagueIds, teamName]
      ),
      query(
        `SELECT id, home_team_id, away_team_id, home_score, away_score
         FROM official_matches
         WHERE competition_id = ?
           AND home_team_id IN (SELECT id FROM teams WHERE league_id IN (${phLeagueIds}))
           AND away_team_id IN (SELECT id FROM teams WHERE league_id IN (${phLeagueIds}))
         ORDER BY id ASC`,
        [competitionId, ...targetLeagueIds, ...targetLeagueIds]
      ),
    ]);
    const seasonTeamIds = Array.from(
      new Set((seasonTeamRows || []).map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0))
    );
    if (seasonTeamIds.length === 0) {
      return res.json({
        team: { id: teamId, name: teamName },
        available_years: availableYears,
        selected_year: selectedYear,
        general: { played: 0, goals: 0, goals_conceded: 0, yellow_cards: 0, red_cards: 0 },
        outcomes: { wins: 0, draws: 0, losses: 0, wins_pct: 0, draws_pct: 0, losses_pct: 0 },
        scorers: [],
        assistmen: [],
        presences: [],
      });
    }

    const presencesPromise = fetchOfficialTeamPresencesWithVoteRanking(seasonTeamRows, {
      isAbsoluteMode,
      competitionId,
    }).catch(() => []);

    const matchIds = (seasonMatches || []).map((m) => Number(m.id)).filter((n) => Number.isFinite(n) && n > 0);
    const seasonEndedMatchIds = await fetchMatchEndedIds(matchIds);

    let evRows = [];
    if (matchIds.length > 0) {
      const ph = matchIds.map(() => '?').join(', ');
      evRows = await query(
        `
        SELECT id, match_id, event_type, team_side, team_id, player_id, assist_player_id, payload_json
        FROM official_match_events
        WHERE match_id IN (${ph})
        ORDER BY id ASC
        `,
        matchIds
      );
    }
    const playerIds = Array.from(
      new Set(
        (evRows || [])
          .flatMap((e) => {
            const payload = safeJsonParse(e.payload_json) || {};
            return [
              Number(e.player_id),
              Number(e.assist_player_id),
              Number(payload.player_id),
              Number(payload.assist_player_id),
            ];
          })
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    );
    let playerNameMap = new Map();
    let playerTeamMap = new Map();
    if (playerIds.length > 0) {
      const phPlayers = playerIds.map(() => '?').join(', ');
      const pRows = await query(
        `
        SELECT id, first_name, last_name, team_id
        FROM players
        WHERE id IN (${phPlayers})
        `,
        playerIds
      );
      playerNameMap = new Map(
        (pRows || []).map((p) => [
          Number(p.id),
          String(`${p.first_name || ''} ${p.last_name || ''}`).trim(),
        ])
      );
      playerTeamMap = new Map((pRows || []).map((p) => [Number(p.id), Number(p.team_id)]));
    }
    const evByMatch = new Map();
    for (const ev of evRows || []) {
      const mid = Number(ev.match_id);
      if (!evByMatch.has(mid)) evByMatch.set(mid, []);
      evByMatch.get(mid).push(ev);
    }

    let played = 0;
    let goals = 0;
    let goalsConceded = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let yellowCards = 0;
    let redCards = 0;
    const scorersMap = new Map();
    const assistsMap = new Map();

    for (const m of seasonMatches || []) {
      const isHome = seasonTeamIds.includes(Number(m.home_team_id));
      const isAway = seasonTeamIds.includes(Number(m.away_team_id));
      if (!isHome && !isAway) continue;

      const events = evByMatch.get(Number(m.id)) || [];
      let homeGoals = 0;
      let awayGoals = 0;
      let homeShootoutGoals = 0;
      let awayShootoutGoals = 0;
      let hasGoalEvents = false;
      let hasShootoutEvents = false;
      for (const e of events) {
        const payload = safeJsonParse(e.payload_json) || {};
        const evTeamId = Number(e.team_id) || Number(payload.team_id);
        if (e.event_type === 'shootout_goal') {
          hasShootoutEvents = true;
          if (Number.isFinite(evTeamId) && evTeamId > 0) {
            if (evTeamId === Number(m.home_team_id)) homeShootoutGoals += 1;
            if (evTeamId === Number(m.away_team_id)) awayShootoutGoals += 1;
          } else {
            if (e.team_side === 'home') homeShootoutGoals += 1;
            if (e.team_side === 'away') awayShootoutGoals += 1;
          }
        } else if (e.event_type === 'shootout_missed') {
          hasShootoutEvents = true;
        } else if (isRegularGoalEventType(e.event_type)) {
          hasGoalEvents = true;
          if (Number.isFinite(evTeamId) && evTeamId > 0) {
            if (evTeamId === Number(m.home_team_id)) homeGoals += 1;
            if (evTeamId === Number(m.away_team_id)) awayGoals += 1;
          } else {
            if (e.team_side === 'home') homeGoals += 1;
            if (e.team_side === 'away') awayGoals += 1;
          }
        } else if (e.event_type === 'own_goal') {
          hasGoalEvents = true;
          if (Number.isFinite(evTeamId) && evTeamId > 0) {
            if (evTeamId === Number(m.home_team_id)) awayGoals += 1;
            if (evTeamId === Number(m.away_team_id)) homeGoals += 1;
          } else {
            if (e.team_side === 'home') awayGoals += 1;
            if (e.team_side === 'away') homeGoals += 1;
          }
        }
      }
      const evScore = { has: hasGoalEvents, home: homeGoals, away: awayGoals };
      const resolvedSeason = resolveOfficialMatchResultForStandings(m, evScore, seasonEndedMatchIds.has(Number(m.id)));
      let hs = resolvedSeason.counted ? resolvedSeason.home : null;
      let as = resolvedSeason.counted ? resolvedSeason.away : null;
      if (hs == null && hasShootoutEvents) hs = 0;
      if (as == null && hasShootoutEvents) as = 0;

      for (const e of events) {
        const payload = safeJsonParse(e.payload_json) || {};
        const evTeamId = Number(e.team_id) || Number(payload.team_id);
        const side = String(e.team_side || '').trim();
        const mine =
          (Number.isFinite(evTeamId) && evTeamId > 0)
            ? seasonTeamIds.includes(evTeamId)
            : ((isHome && side === 'home') || (isAway && side === 'away'));
        if (!mine) continue;
        if (e.event_type === 'yellow_card') yellowCards += 1;
        if (e.event_type === 'red_card') redCards += 1;
        if (isRegularGoalEventType(e.event_type)) {
          if (!eventHasGoalScorer(e)) continue;
          const pid = Number(e.player_id) || Number(payload?.player_id);
          const aid = Number(e.assist_player_id) || Number(payload?.assist_player_id);
          const scorerMine =
            (Number.isFinite(pid) && pid > 0 && seasonTeamIds.includes(Number(playerTeamMap.get(pid)))) ||
            mine;
          const assistMine =
            (Number.isFinite(aid) && aid > 0 && seasonTeamIds.includes(Number(playerTeamMap.get(aid)))) ||
            mine;
          const pn =
            (Number.isFinite(pid) && pid > 0 ? String(playerNameMap.get(pid) || '').trim() : '') ||
            String(payload?.player_name || '').trim();
          if (scorerMine && pn) scorersMap.set(pn, Number(scorersMap.get(pn) || 0) + 1);
          const an =
            (Number.isFinite(aid) && aid > 0 ? String(playerNameMap.get(aid) || '').trim() : '') ||
            String(payload?.assist_player_name || payload?.assist_name || '').trim();
          if (assistMine && an) assistsMap.set(an, Number(assistsMap.get(an) || 0) + 1);
        }
      }

      if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;

      played += 1;
      const gf = isHome ? hs : as;
      const ga = isHome ? as : hs;
      goals += gf;
      goalsConceded += ga;
      const outcomeHome = hs === as && hasShootoutEvents ? homeShootoutGoals : hs;
      const outcomeAway = hs === as && hasShootoutEvents ? awayShootoutGoals : as;
      const outcomeGf = isHome ? outcomeHome : outcomeAway;
      const outcomeGa = isHome ? outcomeAway : outcomeHome;
      if (outcomeGf > outcomeGa) wins += 1;
      else if (outcomeGf === outcomeGa) draws += 1;
      else losses += 1;
    }

    const pct = (x) => (played > 0 ? Math.round((x / played) * 1000) / 10 : 0);
    const listFromMap = (mp) =>
      Array.from(mp.entries())
        .map(([name, value]) => ({ name, value: Number(value || 0) }))
        .sort((a, b) => (b.value - a.value) || a.name.localeCompare(b.name, 'it'));

    const presences = await presencesPromise;

    return res.json({
      team: { id: teamId, name: teamName },
      available_years: availableYears,
      selected_year: selectedYear,
      general: {
        played,
        goals,
        goals_conceded: goalsConceded,
        yellow_cards: yellowCards,
        red_cards: redCards,
      },
      outcomes: {
        wins,
        draws,
        losses,
        wins_pct: pct(wins),
        draws_pct: pct(draws),
        losses_pct: pct(losses),
      },
      scorers: listFromMap(scorersMap),
      assistmen: listFromMap(assistsMap),
      presences: Array.isArray(presences) ? presences : [],
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento statistiche stagione squadra', error: err.message });
  }
});

let officialGroupLogoSchemaReady = false;
async function ensureOfficialGroupLogoSchema() {
  if (officialGroupLogoSchemaReady) return;
  await query(`ALTER TABLE official_league_groups ADD COLUMN IF NOT EXISTS logo_path TEXT`);
  officialGroupLogoSchemaReady = true;
}

function normalizeOfficialGroupLogoPathForApi(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const cleaned = s.replace(/^\/+/, '');
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  if (cleaned.startsWith('uploads/')) return cleaned;
  if (cleaned.includes('/')) return cleaned;
  return `uploads/official_group_logos/${cleaned}`;
}

async function fetchOfficialGroupRow(groupId) {
  await ensureOfficialGroupLogoSchema();
  const rows = await query(
    `SELECT id, name, description, COALESCE(NULLIF(to_jsonb(og)->>'logo_path',''), NULLIF(og.logo_path, '')) AS logo_path
     FROM official_league_groups og
     WHERE og.id = ?
     LIMIT 1`,
    [groupId]
  );
  return rows[0] || null;
}

async function listOfficialGroupSeasonLeagues(competitionId) {
  return await query(
    `SELECT l.id AS league_id, NULLIF(to_jsonb(l)->>'reference_year','')::int AS reference_year
     FROM leagues l
     WHERE l.official_group_id = ?
       AND COALESCE(l.is_official, 0) = 1
     ORDER BY NULLIF(to_jsonb(l)->>'reference_year','')::int DESC NULLS LAST, l.id DESC`,
    [competitionId]
  );
}

function determineKnockoutMatchWinner(match) {
  if (!match) return null;
  const hs = match.home_score != null ? Number(match.home_score) : null;
  const as = match.away_score != null ? Number(match.away_score) : null;
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  const hps = match.home_shootout_score != null ? Number(match.home_shootout_score) : null;
  const aps = match.away_shootout_score != null ? Number(match.away_shootout_score) : null;
  const outcomeHome = hs === as && Number.isFinite(hps) && Number.isFinite(aps) ? hps : hs;
  const outcomeAway = hs === as && Number.isFinite(hps) && Number.isFinite(aps) ? aps : as;
  if (outcomeHome > outcomeAway) {
    return {
      team_id: match.home_team_id != null ? Number(match.home_team_id) : null,
      team_name: match.home_team_name != null ? String(match.home_team_name) : null,
      logo_path: match.home_team_logo_path || null,
    };
  }
  if (outcomeAway > outcomeHome) {
    return {
      team_id: match.away_team_id != null ? Number(match.away_team_id) : null,
      team_name: match.away_team_name != null ? String(match.away_team_name) : null,
      logo_path: match.away_team_logo_path || null,
    };
  }
  return null;
}

async function buildOfficialGroupHallOfFame(competitionId) {
  const leagues = await listOfficialGroupSeasonLeagues(competitionId);
  const winnersByYear = [];
  const titleBuckets = new Map();

  for (const row of leagues || []) {
    const leagueId = Number(row.league_id);
    const year = Number(row.reference_year);
    if (!Number.isFinite(leagueId) || leagueId <= 0 || !Number.isFinite(year)) continue;
    const ko = await buildKnockoutBracketForLeague({ competitionId, leagueId });
    const finalMatch = ko?.final || null;
    if (!finalMatch?.id) continue;
    const endedIds = await fetchMatchEndedIds([Number(finalMatch.id)]);
    if (!endedIds.has(Number(finalMatch.id))) continue;
    const winner = determineKnockoutMatchWinner(finalMatch);
    if (!winner?.team_name) continue;
    const logoPath = normalizeTeamLogoPathForApi(winner.logo_path);
    winnersByYear.push({
      year,
      team_id: winner.team_id,
      team_name: winner.team_name,
      team_logo_path: logoPath,
      team_logo_url: logoUrlForPath(logoPath),
    });
    const norm = normalizeTeamNameForFavorite(winner.team_name);
    const prev = titleBuckets.get(norm) || {
      team_name: winner.team_name,
      titles: 0,
      years: [],
      team_logo_path: logoPath,
    };
    prev.titles += 1;
    prev.years.push(year);
    if (logoPath && !prev.team_logo_path) prev.team_logo_path = logoPath;
    titleBuckets.set(norm, prev);
  }

  winnersByYear.sort((a, b) => Number(b.year) - Number(a.year));
  const ranking = [...titleBuckets.values()]
    .map((r) => ({
      team_name: r.team_name,
      titles: r.titles,
      years: [...r.years].sort((a, b) => b - a),
      team_logo_path: r.team_logo_path,
      team_logo_url: logoUrlForPath(r.team_logo_path),
    }))
    .sort((a, b) => b.titles - a.titles || a.team_name.localeCompare(b.team_name, 'it'));

  return { winners_by_year: winnersByYear, ranking };
}

async function computeOfficialGroupSeasonStats(competitionId, targetLeagueIds, isAbsoluteMode) {
  const compId = Number(competitionId);
  const leagueIds = [...new Set((targetLeagueIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!leagueIds.length) {
    return { scorers: [], assistmen: [], presences: [] };
  }

  const phLeagueIds = leagueIds.map(() => '?').join(', ');
  const [seasonTeamRows, seasonMatches] = await Promise.all([
    query(
      `SELECT id, league_id FROM teams WHERE league_id IN (${phLeagueIds}) ORDER BY id ASC`,
      leagueIds
    ),
    query(
      `SELECT id, home_team_id, away_team_id, home_score, away_score
       FROM official_matches
       WHERE competition_id = ?
         AND home_team_id IN (SELECT id FROM teams WHERE league_id IN (${phLeagueIds}))
         AND away_team_id IN (SELECT id FROM teams WHERE league_id IN (${phLeagueIds}))
       ORDER BY id ASC`,
      [compId, ...leagueIds, ...leagueIds]
    ),
  ]);

  const seasonTeamIds = Array.from(
    new Set((seasonTeamRows || []).map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0))
  );
  if (!seasonTeamIds.length) {
    return { scorers: [], assistmen: [], presences: [] };
  }

  const presencesPromise = fetchOfficialTeamPresencesWithVoteRanking(seasonTeamRows, {
    isAbsoluteMode,
    competitionId: compId,
  }).catch(() => []);

  const matchIds = (seasonMatches || []).map((m) => Number(m.id)).filter((n) => Number.isFinite(n) && n > 0);
  const seasonEndedMatchIds = await fetchMatchEndedIds(matchIds);

  let evRows = [];
  if (matchIds.length > 0) {
    const ph = matchIds.map(() => '?').join(', ');
    evRows = await query(
      `SELECT id, match_id, event_type, team_side, team_id, player_id, assist_player_id, payload_json
       FROM official_match_events
       WHERE match_id IN (${ph})
       ORDER BY id ASC`,
      matchIds
    );
  }

  const playerIds = Array.from(
    new Set(
      (evRows || [])
        .flatMap((e) => {
          const payload = safeJsonParse(e.payload_json) || {};
          return [
            Number(e.player_id),
            Number(e.assist_player_id),
            Number(payload.player_id),
            Number(payload.assist_player_id),
          ];
        })
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );

  let playerNameMap = new Map();
  let playerTeamMap = new Map();
  if (playerIds.length > 0) {
    const phPlayers = playerIds.map(() => '?').join(', ');
    const pRows = await query(
      `SELECT id, first_name, last_name, team_id FROM players WHERE id IN (${phPlayers})`,
      playerIds
    );
    playerNameMap = new Map(
      (pRows || []).map((p) => [Number(p.id), String(`${p.first_name || ''} ${p.last_name || ''}`).trim()])
    );
    playerTeamMap = new Map((pRows || []).map((p) => [Number(p.id), Number(p.team_id)]));
  }

  const evByMatch = new Map();
  for (const ev of evRows || []) {
    const mid = Number(ev.match_id);
    if (!evByMatch.has(mid)) evByMatch.set(mid, []);
    evByMatch.get(mid).push(ev);
  }

  const scorersMap = new Map();
  const assistsMap = new Map();

  for (const m of seasonMatches || []) {
    const events = evByMatch.get(Number(m.id)) || [];
    const resolvedSeason = resolveOfficialMatchResultForStandings(
      m,
      { has: events.some((e) => isRegularGoalEventType(e.event_type) || e.event_type === 'own_goal'), home: 0, away: 0 },
      seasonEndedMatchIds.has(Number(m.id))
    );
    if (!resolvedSeason.counted) continue;

    for (const e of events) {
      if (!isRegularGoalEventType(e.event_type)) continue;
      if (!eventHasGoalScorer(e)) continue;
      const payload = safeJsonParse(e.payload_json) || {};
      const pid = Number(e.player_id) || Number(payload?.player_id);
      const aid = Number(e.assist_player_id) || Number(payload?.assist_player_id);
      const pn =
        (Number.isFinite(pid) && pid > 0 ? String(playerNameMap.get(pid) || '').trim() : '') ||
        String(payload?.player_name || '').trim();
      const scorerOnLeagueTeam =
        (Number.isFinite(pid) && pid > 0 && seasonTeamIds.includes(Number(playerTeamMap.get(pid)))) ||
        seasonTeamIds.includes(Number(e.team_id) || Number(payload?.team_id));
      if (scorerOnLeagueTeam && pn) scorersMap.set(pn, Number(scorersMap.get(pn) || 0) + 1);
      const an =
        (Number.isFinite(aid) && aid > 0 ? String(playerNameMap.get(aid) || '').trim() : '') ||
        String(payload?.assist_player_name || payload?.assist_name || '').trim();
      const assistOnLeagueTeam =
        (Number.isFinite(aid) && aid > 0 && seasonTeamIds.includes(Number(playerTeamMap.get(aid)))) ||
        seasonTeamIds.includes(Number(e.team_id) || Number(payload?.team_id));
      if (assistOnLeagueTeam && an) assistsMap.set(an, Number(assistsMap.get(an) || 0) + 1);
    }
  }

  const listFromMap = (mp) =>
    Array.from(mp.entries())
      .map(([name, value]) => ({ name, value: Number(value || 0) }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'it'));

  const presences = await presencesPromise;
  return {
    scorers: listFromMap(scorersMap),
    assistmen: listFromMap(assistsMap),
    presences: Array.isArray(presences) ? presences : [],
  };
}

// GET /matches/groups/:groupId/detail — dettaglio gruppo ufficiale
router.get('/matches/groups/:groupId/detail', authenticateToken, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'groupId non valido' });
    const group = await fetchOfficialGroupRow(groupId);
    if (!group) return res.status(404).json({ message: 'Gruppo non trovato' });
    const logoPath = normalizeOfficialGroupLogoPathForApi(group.logo_path);
    return res.json({
      group: {
        id: Number(group.id),
        name: String(group.name || '').trim(),
        description: group.description != null ? String(group.description) : null,
        logo_path: logoPath,
        logo_url: logoUrlForPath(logoPath),
      },
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento dettaglio gruppo', error: err.message });
  }
});

function mapOfficialGroupMatchRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const homeLogoPath = normalizeTeamLogoPathForApi(r?.home_team_logo_path);
    const awayLogoPath = normalizeTeamLogoPathForApi(r?.away_team_logo_path);
    return {
      id: Number(r.id),
      kickoff_at: r.kickoff_at,
      competition_id: Number(r.competition_id),
      match_stage: r.match_stage != null ? String(r.match_stage) : null,
      home_team_id: Number(r.home_team_id),
      home_team_name: r.home_team_name,
      home_team_logo_path: homeLogoPath,
      home_team_logo_url: logoUrlForPath(homeLogoPath),
      away_team_id: Number(r.away_team_id),
      away_team_name: r.away_team_name,
      away_team_logo_path: awayLogoPath,
      away_team_logo_url: logoUrlForPath(awayLogoPath),
      home_score: r.home_score != null ? Number(r.home_score) : null,
      away_score: r.away_score != null ? Number(r.away_score) : null,
      home_shootout_score: r.home_shootout_score != null ? Number(r.home_shootout_score) : null,
      away_shootout_score: r.away_shootout_score != null ? Number(r.away_shootout_score) : null,
      last_phase_type: r.last_phase_type || null,
      is_walkover: r.is_walkover === true || r.is_walkover === 1 ? 1 : 0,
    };
  });
}

async function queryOfficialGroupMatchYears({ userId, groupId }) {
  const rows = await query(
    `
    SELECT DISTINCT EXTRACT(YEAR FROM (m.kickoff_at AT TIME ZONE 'Europe/Rome'))::int AS kickoff_year
    FROM official_matches m
    WHERE m.competition_id = ?
      AND m.kickoff_at IS NOT NULL
      AND (
        EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND COALESCE(u.is_superuser, 0) IN (1, 2))
        OR COALESCE(m.is_admin_only, 0) = 0
      )
    ORDER BY kickoff_year DESC
    `,
    [groupId, userId]
  );
  return (Array.isArray(rows) ? rows : [])
    .map((r) => Number(r.kickoff_year))
    .filter((y) => Number.isFinite(y));
}

function parseKickoffYearsQuery(raw) {
  if (raw == null) return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(',');
  return [...new Set(parts.map((v) => Number(String(v).trim())).filter((y) => Number.isFinite(y)))].sort((a, b) => b - a);
}

async function queryOfficialGroupMatchesRows({ userId, groupId, kickoffYear = null, kickoffYears = null }) {
  const visibilityClause =
    '(EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND COALESCE(u.is_superuser, 0) IN (1, 2)) OR COALESCE(m.is_admin_only, 0) = 0)';
  const params = [groupId, userId];

  const yearsList = parseKickoffYearsQuery(kickoffYears);
  let yearClause = '';
  if (yearsList.length > 0) {
    const ph = yearsList.map(() => '?').join(', ');
    yearClause = `AND EXTRACT(YEAR FROM (m.kickoff_at AT TIME ZONE 'Europe/Rome'))::int IN (${ph})`;
    params.push(...yearsList);
  } else if (kickoffYear != null && Number.isFinite(Number(kickoffYear))) {
    yearClause = 'AND EXTRACT(YEAR FROM (m.kickoff_at AT TIME ZONE \'Europe/Rome\'))::int = ?';
    params.push(Math.trunc(Number(kickoffYear)));
  }

  // Lista partite: punteggi da official_matches + solo fase/rigori/tavolino (no ricalcolo gol da tutti gli eventi).
  return await query(
    `
    WITH scoped_matches AS (
      SELECT m.id
      FROM official_matches m
      WHERE m.competition_id = ?
        AND ${visibilityClause}
        ${yearClause}
    ),
    last_phase AS (
      SELECT DISTINCT ON (e.match_id)
        e.match_id,
        e.event_type AS last_phase_type
      FROM official_match_events e
      INNER JOIN scoped_matches sm ON sm.id = e.match_id
      WHERE e.event_type IN (
        'match_start','half_time','second_half_start','second_half_end',
        'extra_first_half_start','extra_half_time','extra_second_half_start','extra_second_half_end',
        'penalties_start','match_end'
      )
      ORDER BY e.match_id, e.id DESC
    ),
    live_scores AS (
      SELECT
        e.match_id,
        SUM(CASE
              WHEN e.event_type IN ('goal','penalty_goal') AND (
                e.team_id = om.home_team_id OR (e.team_id IS NULL AND e.team_side = 'home')
              ) THEN 1
              WHEN e.event_type = 'own_goal' AND (
                e.team_id = om.away_team_id OR (e.team_id IS NULL AND e.team_side = 'away')
              ) THEN 1
              ELSE 0
            END)::int AS ev_home,
        SUM(CASE
              WHEN e.event_type IN ('goal','penalty_goal') AND (
                e.team_id = om.away_team_id OR (e.team_id IS NULL AND e.team_side = 'away')
              ) THEN 1
              WHEN e.event_type = 'own_goal' AND (
                e.team_id = om.home_team_id OR (e.team_id IS NULL AND e.team_side = 'home')
              ) THEN 1
              ELSE 0
            END)::int AS ev_away
      FROM official_match_events e
      INNER JOIN official_matches om ON om.id = e.match_id
      INNER JOIN scoped_matches sm ON sm.id = e.match_id
      LEFT JOIN last_phase lp ON lp.match_id = sm.id
      WHERE e.event_type IN ('goal','penalty_goal','own_goal')
        AND COALESCE(lp.last_phase_type, '') <> 'match_end'
      GROUP BY e.match_id
    ),
    shootout_scores AS (
      SELECT
        e.match_id,
        SUM(CASE
              WHEN e.event_type = 'shootout_goal' AND (
                e.team_id = om.home_team_id OR (e.team_id IS NULL AND e.team_side = 'home')
              ) THEN 1
              ELSE 0
            END)::int AS ev_home_shootout,
        SUM(CASE
              WHEN e.event_type = 'shootout_goal' AND (
                e.team_id = om.away_team_id OR (e.team_id IS NULL AND e.team_side = 'away')
              ) THEN 1
              ELSE 0
            END)::int AS ev_away_shootout,
        BOOL_OR(e.event_type IN ('shootout_goal','shootout_missed')) AS has_shootout
      FROM official_match_events e
      INNER JOIN official_matches om ON om.id = e.match_id
      INNER JOIN scoped_matches sm ON sm.id = e.match_id
      WHERE e.event_type IN ('shootout_goal','shootout_missed')
      GROUP BY e.match_id
    ),
    walkover_matches AS (
      SELECT wg.match_id
      FROM (
        SELECT e.match_id
        FROM official_match_events e
        INNER JOIN scoped_matches sm ON sm.id = e.match_id
        WHERE e.event_type IN ('goal','penalty_goal')
          AND COALESCE(e.minute, 0) = 0
          AND (e.player_id IS NULL OR e.player_id <= 0)
          AND COALESCE(TRIM(
            CASE
              WHEN e.payload_json IS NULL OR BTRIM(e.payload_json) IN ('', '{}') THEN ''
              ELSE COALESCE((e.payload_json::jsonb)->>'player_name', '')
            END
          ), '') = ''
          AND COALESCE(NULLIF(TRIM(
            CASE
              WHEN e.payload_json IS NULL OR BTRIM(e.payload_json) IN ('', '{}') THEN ''
              ELSE COALESCE((e.payload_json::jsonb)->>'player_id', '')
            END
          ), ''), '0')::int <= 0
        GROUP BY e.match_id
        HAVING COUNT(*) = 3
      ) wg
      WHERE EXISTS (
        SELECT 1 FROM official_match_events me
        WHERE me.match_id = wg.match_id AND me.event_type = 'match_end'
      )
    )
    SELECT
      m.id,
      m.kickoff_at,
      m.competition_id,
      ms.name AS match_stage,
      m.home_team_id,
      ht.name AS home_team_name,
      ht.logo_path AS home_team_logo_path,
      m.away_team_id,
      at.name AS away_team_name,
      at.logo_path AS away_team_logo_path,
      COALESCE(
        m.home_score,
        ls.ev_home,
        CASE WHEN lp.last_phase_type = 'match_end' THEN 0 END
      ) AS home_score,
      COALESCE(
        m.away_score,
        ls.ev_away,
        CASE WHEN lp.last_phase_type = 'match_end' THEN 0 END
      ) AS away_score,
      CASE WHEN COALESCE(so.has_shootout, false) THEN COALESCE(so.ev_home_shootout, 0) ELSE NULL END AS home_shootout_score,
      CASE WHEN COALESCE(so.has_shootout, false) THEN COALESCE(so.ev_away_shootout, 0) ELSE NULL END AS away_shootout_score,
      lp.last_phase_type,
      COALESCE(wo.match_id IS NOT NULL, false) AS is_walkover
    FROM official_matches m
    INNER JOIN scoped_matches sm ON sm.id = m.id
    INNER JOIN teams ht ON ht.id = m.home_team_id
    INNER JOIN teams at ON at.id = m.away_team_id
    LEFT JOIN official_match_stages ms ON ms.id = NULLIF(to_jsonb(m)->>'match_stage_id','')::int
    LEFT JOIN last_phase lp ON lp.match_id = m.id
    LEFT JOIN live_scores ls ON ls.match_id = m.id
    LEFT JOIN shootout_scores so ON so.match_id = m.id
    LEFT JOIN walkover_matches wo ON wo.match_id = m.id
    ORDER BY m.kickoff_at ASC, m.id ASC
    `,
    params
  );
}

// GET /matches/groups/:groupId/matches/years — anni disponibili (query leggera)
router.get('/matches/groups/:groupId/matches/years', authenticateToken, async (req, res) => {
  const t0 = Date.now();
  const log = (step, extra = {}) => {
    console.log('[OfficialGroupMatches][years]', step, { groupId: Number(req.params.groupId), ms: Date.now() - t0, ...extra });
  };
  try {
    const userId = Number(req.user?.userId);
    const groupId = Number(req.params.groupId);
    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'groupId non valido' });

    const tGroup0 = Date.now();
    const exists = await query(`SELECT id FROM official_league_groups WHERE id = ? LIMIT 1`, [groupId]);
    log('fetch_group', { fetchGroupMs: Date.now() - tGroup0 });
    if (!exists.length) return res.status(404).json({ message: 'Gruppo non trovato' });

    const tQuery0 = Date.now();
    const years = await queryOfficialGroupMatchYears({ userId, groupId });
    log('query_years', { queryMs: Date.now() - tQuery0, yearCount: years.length, years });

    return res.json({
      group: { id: groupId },
      years,
    });
  } catch (err) {
    log('error', { error: err?.message });
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento anni partite gruppo', error: err.message });
  }
});

// GET /matches/groups/:groupId/matches?kickoff_year=yyyy — partite del gruppo (opz. filtro anno)
router.get('/matches/groups/:groupId/matches', authenticateToken, async (req, res) => {
  const t0 = Date.now();
  const kickoffYearRaw = req.query?.kickoff_year;
  const kickoffYearsRaw = req.query?.kickoff_years;
  const kickoffYear =
    kickoffYearRaw == null || String(kickoffYearRaw).trim() === ''
      ? null
      : Number(kickoffYearRaw);
  const kickoffYears = parseKickoffYearsQuery(kickoffYearsRaw);
  const log = (step, extra = {}) => {
    console.log('[OfficialGroupMatches]', step, {
      groupId: Number(req.params.groupId),
      kickoffYear,
      kickoffYears,
      ms: Date.now() - t0,
      ...extra,
    });
  };
  try {
    const userId = Number(req.user?.userId);
    const groupId = Number(req.params.groupId);
    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'groupId non valido' });
    if (kickoffYear != null && !Number.isFinite(kickoffYear)) {
      return res.status(400).json({ message: 'kickoff_year non valido' });
    }
    if (kickoffYears.length > 0 && kickoffYear != null) {
      return res.status(400).json({ message: 'Usa kickoff_year oppure kickoff_years, non entrambi' });
    }

    const tGroup0 = Date.now();
    const groupRows = await query(
      `SELECT id, name FROM official_league_groups WHERE id = ? LIMIT 1`,
      [groupId]
    );
    log('fetch_group', { fetchGroupMs: Date.now() - tGroup0 });
    const group = groupRows[0];
    if (!group) return res.status(404).json({ message: 'Gruppo non trovato' });

    const tQuery0 = Date.now();
    const rows = await queryOfficialGroupMatchesRows({
      userId,
      groupId,
      kickoffYear,
      kickoffYears: kickoffYears.length > 0 ? kickoffYears : null,
    });
    log('query_matches', { queryMs: Date.now() - tQuery0, rowCount: Array.isArray(rows) ? rows.length : 0 });

    const tMap0 = Date.now();
    const matches = mapOfficialGroupMatchRows(rows);
    log('map_matches', { mapMs: Date.now() - tMap0, matchCount: matches.length });

    return res.json({
      group: { id: groupId, name: String(group.name || '').trim() },
      kickoff_year: kickoffYear != null ? Math.trunc(kickoffYear) : null,
      kickoff_years: kickoffYears.length > 0 ? kickoffYears : null,
      matches,
    });
  } catch (err) {
    log('error', { error: err?.message });
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento partite gruppo', error: err.message });
  }
});

// GET /matches/groups/:groupId/season-standings?reference_year=yyyy
router.get('/matches/groups/:groupId/season-standings', authenticateToken, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const referenceYearRaw = req.query?.reference_year;
    const requestedYear =
      referenceYearRaw == null || String(referenceYearRaw).trim() === ''
        ? null
        : Number(referenceYearRaw);

    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'groupId non valido' });
    if (requestedYear != null && !Number.isFinite(requestedYear)) {
      return res.status(400).json({ message: 'reference_year non valido' });
    }

    const group = await fetchOfficialGroupRow(groupId);
    if (!group) return res.status(404).json({ message: 'Gruppo non trovato' });

    const seasonLeagues = await listOfficialGroupSeasonLeagues(groupId);
    const availableYears = Array.from(
      new Set(
        (Array.isArray(seasonLeagues) ? seasonLeagues : [])
          .map((r) => Number(r.reference_year))
          .filter((y) => Number.isFinite(y))
      )
    ).sort((a, b) => b - a);

    const selectedYear =
      requestedYear != null && Number.isFinite(requestedYear)
        ? Math.trunc(requestedYear)
        : availableYears.length > 0
          ? availableYears[0]
          : null;

    let selectedLeagueId = null;
    if (selectedYear != null) {
      const hit = (seasonLeagues || []).find((r) => Number(r.reference_year) === selectedYear);
      selectedLeagueId = hit ? Number(hit.league_id) : null;
    }
    if (!selectedLeagueId) {
      selectedLeagueId = Number((seasonLeagues || [])[0]?.league_id || 0) || null;
    }

    let standings = [];
    let standings_groups = null;
    let knockout = { quarterfinals: [], semifinals: [], final: null };
    if (selectedLeagueId) {
      const [tablesResult, ko] = await Promise.all([
        computeOfficialLeagueGironiStandings({ leagueId: selectedLeagueId, competitionId: groupId }),
        buildKnockoutBracketForLeague({ leagueId: selectedLeagueId, competitionId: groupId }),
      ]);
      standings = tablesResult.standings;
      standings_groups = tablesResult.standings_groups;
      knockout = ko;
    }

    return res.json({
      group: { id: groupId, name: String(group.name || '').trim() },
      available_years: availableYears,
      selected_year: selectedYear,
      standings: Array.isArray(standings) ? standings : [],
      standings_groups,
      knockout,
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento stagione gruppo', error: err.message });
  }
});

// GET /matches/groups/:groupId/season-stats?reference_year=yyyy|mode=absolute
router.get('/matches/groups/:groupId/season-stats', authenticateToken, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const referenceYearRaw = req.query?.reference_year;
    const statsModeRaw = String(req.query?.mode || '').trim().toLowerCase();
    const isAbsoluteMode = statsModeRaw === 'absolute' || String(referenceYearRaw || '').trim().toLowerCase() === 'absolute';
    const requestedYear =
      isAbsoluteMode || referenceYearRaw == null || String(referenceYearRaw).trim() === ''
        ? null
        : Number(referenceYearRaw);

    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'groupId non valido' });
    if (requestedYear != null && !Number.isFinite(requestedYear)) {
      return res.status(400).json({ message: 'reference_year non valido' });
    }

    const group = await fetchOfficialGroupRow(groupId);
    if (!group) return res.status(404).json({ message: 'Gruppo non trovato' });

    const seasonLeagues = await listOfficialGroupSeasonLeagues(groupId);
    const availableYears = Array.from(
      new Set(
        (Array.isArray(seasonLeagues) ? seasonLeagues : [])
          .map((r) => Number(r.reference_year))
          .filter((y) => Number.isFinite(y))
      )
    ).sort((a, b) => b - a);

    const selectedYear = isAbsoluteMode
      ? 'absolute'
      : (
        requestedYear != null && Number.isFinite(requestedYear)
          ? Math.trunc(requestedYear)
          : availableYears.length > 0
            ? availableYears[0]
            : null
      );

    const targetLeagueIds = isAbsoluteMode
      ? Array.from(
        new Set(
          (Array.isArray(seasonLeagues) ? seasonLeagues : [])
            .map((r) => Number(r.league_id))
            .filter((id) => Number.isFinite(id) && id > 0)
        )
      )
      : (() => {
        let selectedLeagueId = null;
        if (selectedYear != null && Number.isFinite(Number(selectedYear))) {
          const hit = (seasonLeagues || []).find((r) => Number(r.reference_year) === Number(selectedYear));
          selectedLeagueId = hit ? Number(hit.league_id) : null;
        }
        if (!selectedLeagueId) {
          selectedLeagueId = Number((seasonLeagues || [])[0]?.league_id || 0) || null;
        }
        return selectedLeagueId ? [selectedLeagueId] : [];
      })();

    const stats = await computeOfficialGroupSeasonStats(groupId, targetLeagueIds, isAbsoluteMode);

    return res.json({
      group: { id: groupId, name: String(group.name || '').trim() },
      available_years: availableYears,
      selected_year: selectedYear,
      scorers: stats.scorers,
      assistmen: stats.assistmen,
      presences: stats.presences,
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento statistiche gruppo', error: err.message });
  }
});

// GET /matches/groups/:groupId/hall-of-fame — albo d'oro (vincitori finali)
router.get('/matches/groups/:groupId/hall-of-fame', authenticateToken, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    if (!groupId || groupId <= 0) return res.status(400).json({ message: 'groupId non valido' });
    const group = await fetchOfficialGroupRow(groupId);
    if (!group) return res.status(404).json({ message: 'Gruppo non trovato' });
    const hall = await buildOfficialGroupHallOfFame(groupId);
    return res.json({
      group: { id: groupId, name: String(group.name || '').trim() },
      winners_by_year: hall.winners_by_year,
      ranking: hall.ranking,
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento albo d\'oro', error: err.message });
  }
});

router.put('/admin/matches/:matchId/unavailable-players', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    const userId = Number(req.user?.userId);
    if (!matchId || matchId <= 0) return res.status(400).json({ message: 'matchId non valido' });

    const matchRows = await query(
      `SELECT home_team_id, away_team_id
       FROM official_matches
       WHERE id = ?
       LIMIT 1`,
      [matchId]
    );
    const match = matchRows[0];
    if (!match) return res.status(404).json({ message: 'Partita non trovata' });

    const homeIdsRaw = Array.isArray(req.body?.home_player_ids) ? req.body.home_player_ids : [];
    const awayIdsRaw = Array.isArray(req.body?.away_player_ids) ? req.body.away_player_ids : [];
    const homeIds = [...new Set(homeIdsRaw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
    const awayIds = [...new Set(awayIdsRaw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];

    const homeRoster = await getTeamPlayersLineup(Number(match.home_team_id));
    const awayRoster = await getTeamPlayersLineup(Number(match.away_team_id));
    const homeAllowed = new Set(homeRoster.map((p) => Number(p.id)));
    const awayAllowed = new Set(awayRoster.map((p) => Number(p.id)));

    const validHome = homeIds.filter((id) => homeAllowed.has(id));
    const validAway = awayIds.filter((id) => awayAllowed.has(id));
    const allValid = [...validHome, ...validAway];

    await ensureUnavailablePlayersTable();
    await query(`DELETE FROM official_match_unavailable_players WHERE match_id = ?`, [matchId]);
    for (const pid of allValid) {
      await query(
        `INSERT INTO official_match_unavailable_players (match_id, player_id, created_by)
         VALUES (?, ?, ?)
         ON CONFLICT (match_id, player_id) DO NOTHING`,
        [matchId, pid, userId]
      );
    }

    return res.json({
      ok: true,
      match_id: matchId,
      unavailable: { home_player_ids: validHome, away_player_ids: validAway },
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore aggiornamento non disponibili', error: err.message });
  }
});

// POST /matches/notifications/toggle — campanella singola partita
router.post('/matches/notifications/toggle', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const matchId = Number(req.body?.match_id);
    const enabled = Number(req.body?.enabled) ? 1 : 0;
    if (!matchId || matchId <= 0) return res.status(400).json({ message: 'match_id non valido' });

    await query(
      `
      INSERT INTO user_official_match_notifications (user_id, match_id, enabled)
      VALUES (?, ?, ?)
      ON CONFLICT (user_id, match_id) DO UPDATE SET enabled = EXCLUDED.enabled
      `,
      [userId, matchId, enabled]
    );
    return res.json({ ok: true, match_id: matchId, enabled });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore aggiornamento notifiche match', error: err.message });
  }
});

// POST /matches/favorites/match — stellina match
router.post('/matches/favorites/match', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const matchId = Number(req.body?.match_id);
    const isFavorite = Number(req.body?.is_favorite) ? 1 : 0;
    if (!matchId || matchId <= 0) return res.status(400).json({ message: 'match_id non valido' });

    if (isFavorite) {
      await query(
        `
        INSERT INTO user_official_match_favorites (user_id, match_id)
        VALUES (?, ?)
        ON CONFLICT (user_id, match_id) DO NOTHING
        `,
        [userId, matchId]
      );
    } else {
      await query(`DELETE FROM user_official_match_favorites WHERE user_id = ? AND match_id = ?`, [userId, matchId]);
    }
    return res.json({ ok: true, match_id: matchId, is_favorite: isFavorite });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore aggiornamento preferito match', error: err.message });
  }
});

// POST /matches/favorites/team — preferito squadra per nome nel gruppo ufficiale
router.post('/matches/favorites/team', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const groupId = Number(req.body?.official_group_id);
    const teamName = String(req.body?.team_name || '').trim();
    const isFavorite = Number(req.body?.is_favorite) ? 1 : 0;
    if (!groupId || groupId <= 0 || !teamName) return res.status(400).json({ message: 'Dati preferito squadra non validi' });
    const teamNameNorm = normalizeTeamNameForFavorite(teamName);

    if (isFavorite) {
      await query(
        `
        INSERT INTO user_official_team_favorites
          (user_id, official_group_id, team_name_norm, team_name_display, is_heart, notifications_enabled)
        VALUES
          (?, ?, ?, ?, 1, 1)
        ON CONFLICT (user_id, official_group_id, team_name_norm) DO UPDATE SET
          team_name_display = EXCLUDED.team_name_display,
          is_heart = 1,
          notifications_enabled = 1,
          updated_at = NOW()
        `,
        [userId, groupId, teamNameNorm, teamName]
      );
    } else {
      await query(
        `
        UPDATE user_official_team_favorites
        SET is_heart = 0,
            updated_at = NOW()
        WHERE user_id = ? AND official_group_id = ? AND team_name_norm = ?
        `,
        [userId, groupId, teamNameNorm]
      );
      await query(
        `
        DELETE FROM user_official_team_favorites
        WHERE user_id = ? AND official_group_id = ? AND team_name_norm = ?
          AND COALESCE(is_heart, 0) = 0
          AND COALESCE(notifications_enabled, 0) = 0
        `,
        [userId, groupId, teamNameNorm]
      );
    }
    return res.json({ ok: true, official_group_id: groupId, team_name: teamName, is_favorite: isFavorite });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore aggiornamento preferito squadra', error: err.message });
  }
});

// POST /matches/favorites/team-notifications — toggle campanella squadra
router.post('/matches/favorites/team-notifications', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const groupId = Number(req.body?.official_group_id);
    const teamName = String(req.body?.team_name || '').trim();
    const enabled = Number(req.body?.enabled) ? 1 : 0;
    if (!groupId || groupId <= 0 || !teamName) return res.status(400).json({ message: 'Dati notifiche squadra non validi' });
    const teamNameNorm = normalizeTeamNameForFavorite(teamName);

    if (enabled) {
      await query(
        `
        INSERT INTO user_official_team_favorites
          (user_id, official_group_id, team_name_norm, team_name_display, is_heart, notifications_enabled)
        VALUES
          (?, ?, ?, ?, 0, 1)
        ON CONFLICT (user_id, official_group_id, team_name_norm) DO UPDATE SET
          team_name_display = EXCLUDED.team_name_display,
          notifications_enabled = 1,
          updated_at = NOW()
        `,
        [userId, groupId, teamNameNorm, teamName]
      );
    } else {
      await query(
        `
        UPDATE user_official_team_favorites
        SET notifications_enabled = 0,
            updated_at = NOW()
        WHERE user_id = ? AND official_group_id = ? AND team_name_norm = ?
        `,
        [userId, groupId, teamNameNorm]
      );
      await query(
        `
        DELETE FROM user_official_team_favorites
        WHERE user_id = ? AND official_group_id = ? AND team_name_norm = ?
          AND COALESCE(is_heart, 0) = 0
          AND COALESCE(notifications_enabled, 0) = 0
        `,
        [userId, groupId, teamNameNorm]
      );
    }
    return res.json({ ok: true, official_group_id: groupId, team_name: teamName, enabled });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore aggiornamento notifiche squadra', error: err.message });
  }
});

// GET /matches/strip-teams — squadre delle competizioni abilitate dal super admin per la strip in alto
router.get('/matches/strip-teams', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);

    const [su, comps, heartRows] = await Promise.all([
      getSuperuserLevel(userId),
      query(
        `SELECT id, name FROM official_league_groups
         WHERE COALESCE(show_teams_in_matches_strip, 0) = 1
         ORDER BY name ASC`
      ),
      userId > 0
        ? query(
            `SELECT official_group_id, team_name_display
             FROM user_official_team_favorites
             WHERE user_id = ? AND COALESCE(is_heart, 0) = 1`,
            [userId]
          )
        : Promise.resolve([]),
    ]);

    const canSeeAdminOnly = su === 1 || su === 2 ? 1 : 0;
    const stripCompIds = comps.map((c) => Number(c.id)).filter((x) => x > 0);
    if (stripCompIds.length === 0) return res.json({ teams: [] });

    const enabledCompetitions = await listCompetitionsOnlyEnabled();
    const logoMapCompIds = enabledCompetitions.map((c) => Number(c.id)).filter((x) => x > 0);

    const ph = stripCompIds.map(() => '?').join(', ');
    const teamRows = await query(
      `WITH comp_teams AS (
         SELECT m.competition_id, t.id AS team_id, t.name
         FROM official_matches m
         INNER JOIN teams t ON t.id = m.home_team_id
         WHERE m.competition_id IN (${ph})
           AND (? = 1 OR COALESCE(m.is_admin_only, 0) = 0)
         UNION
         SELECT m.competition_id, t.id AS team_id, t.name
         FROM official_matches m
         INNER JOIN teams t ON t.id = m.away_team_id
         WHERE m.competition_id IN (${ph})
           AND (? = 1 OR COALESCE(m.is_admin_only, 0) = 0)
       ),
       ranked AS (
         SELECT competition_id, team_id, name,
           ROW_NUMBER() OVER (
             PARTITION BY competition_id, LOWER(TRIM(name))
             ORDER BY team_id DESC
           ) AS rn
         FROM comp_teams
         WHERE name IS NOT NULL AND TRIM(name) <> ''
       )
       SELECT competition_id, team_id, name
       FROM ranked WHERE rn = 1
       ORDER BY name ASC`,
      [...stripCompIds, canSeeAdminOnly, ...stripCompIds, canSeeAdminOnly]
    );

    const logoMap = await buildBestOfficialTeamLogoMap(logoMapCompIds, canSeeAdminOnly === 1);

    const heartSet = new Set();
    for (const r of heartRows || []) {
      heartSet.add(
        `${r.official_group_id}:${normalizeTeamNameForFavorite(r.team_name_display || '')}`
      );
    }

    const compNameMap = new Map(comps.map((c) => [Number(c.id), c.name]));
    const teams = (teamRows || []).map((r) => {
      const logoPath = pickBestOfficialTeamLogo(logoMap, r.competition_id, r.name, null);
      const name = String(r.name || '').trim();
      const compId = Number(r.competition_id);
      const isHeart = heartSet.has(`${compId}:${normalizeTeamNameForFavorite(name)}`);
      return {
        team_id: Number(r.team_id),
        name,
        competition_id: compId,
        competition_name: compNameMap.get(compId) || null,
        logo_path: logoPath,
        logo_url: logoUrlForPath(logoPath),
        is_heart: isHeart ? 1 : 0,
      };
    });
    teams.sort((a, b) => {
      if (a.is_heart !== b.is_heart) return b.is_heart - a.is_heart;
      return a.name.localeCompare(b.name, 'it');
    });
    return res.json({ teams });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento squadre strip', error: err.message });
  }
});

// GET /matches/follow-setup — competizioni visibili, squadre e preferenze utente
router.get('/matches/follow-setup', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const su = await getSuperuserLevel(userId);
    const canSeeAdminOnly = su === 1 || su === 2 ? 1 : 0;

    const competitions = await listCompetitionsOnlyEnabled();
    const compIds = competitions.map((c) => Number(c.id)).filter((x) => x > 0);

    const prefs = await query(
      `SELECT official_group_id, team_name_norm, team_name_display, COALESCE(is_heart, 0) AS is_heart, COALESCE(notifications_enabled, 0) AS notifications_enabled
       FROM user_official_team_favorites
       WHERE user_id = ?
       ORDER BY official_group_id ASC, team_name_norm ASC`,
      [userId]
    );

    // Squadre presenti nelle partite; logo dalla lega con reference_year più alto tra quelle con partite.
    const teamsByGroup = new Map();
    if (compIds.length > 0) {
      const logoMap = await buildBestOfficialTeamLogoMap(compIds, canSeeAdminOnly === 1);
      const teamRows = await query(
        `
        WITH comp_teams AS (
          SELECT
            m.competition_id AS official_group_id,
            t.id AS team_id,
            t.name AS team_name
          FROM official_matches m
          INNER JOIN teams t ON t.id = m.home_team_id
          LEFT JOIN leagues l ON l.id = t.league_id
          WHERE m.competition_id IN (${compIds.map(() => '?').join(', ')})
            AND (? = 1 OR COALESCE(m.is_admin_only, 0) = 0)
            AND (l.id IS NULL OR COALESCE(l.is_official_squad_public, 0) = 1)

          UNION ALL

          SELECT
            m.competition_id AS official_group_id,
            t.id AS team_id,
            t.name AS team_name
          FROM official_matches m
          INNER JOIN teams t ON t.id = m.away_team_id
          LEFT JOIN leagues l ON l.id = t.league_id
          WHERE m.competition_id IN (${compIds.map(() => '?').join(', ')})
            AND (? = 1 OR COALESCE(m.is_admin_only, 0) = 0)
            AND (l.id IS NULL OR COALESCE(l.is_official_squad_public, 0) = 1)
        ),
        ranked AS (
          SELECT
            official_group_id,
            team_id,
            team_name,
            ROW_NUMBER() OVER (
              PARTITION BY official_group_id, LOWER(TRIM(team_name))
              ORDER BY team_id DESC
            ) AS rn
          FROM comp_teams
          WHERE team_name IS NOT NULL AND TRIM(team_name) <> ''
        )
        SELECT
          official_group_id,
          team_id,
          team_name
        FROM ranked
        WHERE rn = 1
        `,
        [...compIds, canSeeAdminOnly, ...compIds, canSeeAdminOnly]
      );

      for (const r of Array.isArray(teamRows) ? teamRows : []) {
        const gid = safeInt(r.official_group_id);
        const name = String(r.team_name || '').trim();
        const norm = normalizeTeamNameForFavorite(name);
        const logoPath = pickBestOfficialTeamLogo(logoMap, gid, name, null);
        if (!gid || !name) continue;
        if (!teamsByGroup.has(gid)) teamsByGroup.set(gid, new Map());
        teamsByGroup.get(gid).set(norm, {
          id: safeInt(r.team_id),
          name,
          logo_path: logoPath,
          logo_url: logoUrlForPath(logoPath),
        });
      }
    }

    const prefsByGroup = new Map();
    for (const p of Array.isArray(prefs) ? prefs : []) {
      const gid = safeInt(p.official_group_id);
      if (!gid) continue;
      if (!prefsByGroup.has(gid)) prefsByGroup.set(gid, { heart: new Set(), notify: new Set() });
      const display = String(p.team_name_display || '').trim();
      if (!display) continue;
      if (safeInt(p.is_heart) === 1) prefsByGroup.get(gid).heart.add(display);
      if (safeInt(p.notifications_enabled) === 1) prefsByGroup.get(gid).notify.add(display);
    }

    const competitionsEnriched = competitions.map((c) => {
      const gid = safeInt(c.id);
      const teams = Array.from((teamsByGroup.get(gid) || new Map()).values()).sort((a, b) =>
        String(a?.name || '').localeCompare(String(b?.name || ''), 'it')
      );
      const pref = prefsByGroup.get(gid) || { heart: new Set(), notify: new Set() };
      return {
        id: gid,
        name: c.name,
        teams,
        heart_team_names: Array.from(pref.heart),
        notify_team_names: Array.from(pref.notify),
      };
    });

    return res.json({
      // Shape usata dalla UI (MatchesScreen): competitions[] con teams + preferenze
      competitions: competitionsEnriched,

      // Campi legacy/diagnostici (non più necessari al client, ma manteniamo compatibilità)
      preferences: prefs,
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento follow-setup', error: err.message });
  }
});

// PUT /matches/follow-preferences — salva preferenze (stelline + notifiche squadra)
router.put('/matches/follow-preferences', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const competitions = Array.isArray(req.body?.competitions) ? req.body.competitions : [];

    // Strategia semplice: per ogni gruppo, upsert per le squadre presenti e cancella quelle non più presenti.
    for (const c of competitions) {
      const groupId = Number(c?.official_group_id);
      if (!groupId || groupId <= 0) continue;
      const heartNames = Array.isArray(c?.heart_team_names) ? c.heart_team_names : [];
      const notifyNames = Array.isArray(c?.notify_team_names) ? c.notify_team_names : [];

      const wantedNorms = new Set();
      const rowsToUpsert = [];

      for (const name of heartNames) {
        const display = String(name || '').trim();
        if (!display) continue;
        const norm = normalizeTeamNameForFavorite(display);
        wantedNorms.add(norm);
        rowsToUpsert.push({ norm, display, is_heart: 1, notifications_enabled: 1 });
      }
      for (const name of notifyNames) {
        const display = String(name || '').trim();
        if (!display) continue;
        const norm = normalizeTeamNameForFavorite(display);
        wantedNorms.add(norm);
        // se non è già cuore, allora è solo notify
        if (!rowsToUpsert.some((r) => r.norm === norm)) {
          rowsToUpsert.push({ norm, display, is_heart: 0, notifications_enabled: 1 });
        }
      }

      // cancella preferenze non più presenti per quel gruppo
      if (wantedNorms.size === 0) {
        await query(`DELETE FROM user_official_team_favorites WHERE user_id = ? AND official_group_id = ?`, [userId, groupId]);
      } else {
        const ph = Array.from(wantedNorms).map(() => '?').join(', ');
        await query(
          `DELETE FROM user_official_team_favorites WHERE user_id = ? AND official_group_id = ? AND team_name_norm NOT IN (${ph})`,
          [userId, groupId, ...Array.from(wantedNorms)]
        );
      }

      for (const r of rowsToUpsert) {
        await query(
          `
          INSERT INTO user_official_team_favorites
            (user_id, official_group_id, team_name_norm, team_name_display, is_heart, notifications_enabled)
          VALUES
            (?, ?, ?, ?, ?, ?)
          ON CONFLICT (user_id, official_group_id, team_name_norm) DO UPDATE SET
            team_name_display = EXCLUDED.team_name_display,
            is_heart = EXCLUDED.is_heart,
            notifications_enabled = EXCLUDED.notifications_enabled,
            updated_at = NOW()
          `,
          [userId, groupId, r.norm, r.display, r.is_heart, r.notifications_enabled]
        );
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore salvataggio preferenze', error: err.message });
  }
});

// ==========================
// ADMIN (Gestione Partite)
// ==========================

// GET /admin/competitions
router.get('/admin/competitions', authenticateToken, requireSuperuserLevels([1, 2]), async (_req, res) => {
  try {
    const rows = await query(
      `SELECT og.id, og.name,
              COALESCE(og.is_match_competition_enabled, 1) AS is_match_competition_enabled,
              COALESCE(og.show_teams_in_matches_strip, 0) AS show_teams_in_matches_strip
       FROM official_league_groups og
       ORDER BY og.name ASC`
    );
    return res.json(rows);
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento competizioni admin', error: err.message });
  }
});

// PUT /admin/competitions/:competitionId — toggle visibilità e strip
router.put('/admin/competitions/:competitionId', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const id = Number(req.params.competitionId);
    if (!id || id <= 0) return res.status(400).json({ message: 'competitionId non valido' });

    const sets = [];
    const params = [];
    if (req.body?.is_match_competition_enabled != null) {
      sets.push('is_match_competition_enabled = ?');
      params.push(Number(req.body.is_match_competition_enabled) ? 1 : 0);
    }
    if (req.body?.show_teams_in_matches_strip != null) {
      sets.push('show_teams_in_matches_strip = ?');
      params.push(Number(req.body.show_teams_in_matches_strip) ? 1 : 0);
    }
    if (sets.length === 0) return res.status(400).json({ message: 'Nessun campo da aggiornare' });
    params.push(id);
    await query(`UPDATE official_league_groups SET ${sets.join(', ')} WHERE id = ?`, params);

    return res.json({ message: 'Competizione aggiornata', id });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore aggiornamento competizione', error: err.message });
  }
});

// Due gironi (stesso router admin /api — evita 404 se /superuser non è aggiornato sul server)
router.put(
  '/admin/official-groups/:groupId/leagues/:leagueId/two-official-groups',
  authenticateToken,
  requireSuperuserLevels([1, 2]),
  async (req, res) => {
    try {
      await ensureLeagueOfficialGironiSchema();
      const groupId = Number(req.params.groupId);
      const leagueId = Number(req.params.leagueId);
      if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });
      if (!leagueId || leagueId <= 0) return res.status(400).json({ message: 'ID lega non valido' });
      const raw = req.body?.enabled;
      const enabled =
        raw === true ||
        raw === 1 ||
        String(raw || '').trim() === '1' ||
        String(raw || '').trim().toLowerCase() === 'true';

      const belongs = await query(
        `SELECT id FROM leagues WHERE id = ? AND official_group_id = ? LIMIT 1`,
        [leagueId, groupId]
      );
      if (!belongs.length) return res.status(404).json({ message: 'Lega non trovata nel gruppo selezionato' });

      await query(`UPDATE leagues SET official_two_groups = ? WHERE id = ?`, [enabled ? 1 : 0, leagueId]);
      if (!enabled) {
        await query(`DELETE FROM league_official_team_gironi WHERE league_id = ?`, [leagueId]);
      }
      return res.json({ ok: true, league_id: leagueId, official_two_groups: enabled ? 1 : 0 });
    } catch (error) {
      return res.status(500).json({ message: 'Errore aggiornamento due gironi', error: error.message });
    }
  }
);

router.get(
  '/admin/official-groups/:groupId/leagues/:leagueId/official-gironi-teams',
  authenticateToken,
  requireSuperuserLevels([1, 2]),
  async (req, res) => {
    try {
      await ensureLeagueOfficialGironiSchema();
      const groupId = Number(req.params.groupId);
      const leagueId = Number(req.params.leagueId);
      if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });
      if (!leagueId || leagueId <= 0) return res.status(400).json({ message: 'ID lega non valido' });

      const belongs = await query(
        `SELECT COALESCE(official_two_groups, 0) AS two_g
         FROM leagues WHERE id = ? AND official_group_id = ? LIMIT 1`,
        [leagueId, groupId]
      );
      if (!belongs.length) return res.status(404).json({ message: 'Lega non trovata nel gruppo selezionato' });

      const rows = await query(
        `SELECT t.id, t.name, g.girone_index AS girone_index
         FROM teams t
         LEFT JOIN league_official_team_gironi g ON g.league_id = t.league_id AND g.team_id = t.id
         WHERE t.league_id = ?
         ORDER BY t.name ASC, t.id ASC`,
        [leagueId]
      );
      return res.json({
        ok: true,
        league_id: leagueId,
        official_two_groups: Number(belongs[0].two_g || 0),
        teams: rows || [],
      });
    } catch (error) {
      return res.status(500).json({ message: 'Errore caricamento squadre gironi', error: error.message });
    }
  }
);

router.put(
  '/admin/official-groups/:groupId/leagues/:leagueId/official-gironi-teams',
  authenticateToken,
  requireSuperuserLevels([1, 2]),
  async (req, res) => {
    try {
      await ensureLeagueOfficialGironiSchema();
      const groupId = Number(req.params.groupId);
      const leagueId = Number(req.params.leagueId);
      if (!groupId || groupId <= 0) return res.status(400).json({ message: 'ID gruppo non valido' });
      if (!leagueId || leagueId <= 0) return res.status(400).json({ message: 'ID lega non valido' });

      const leagueRows = await query(
        `SELECT id, COALESCE(official_two_groups, 0) AS two_g
         FROM leagues WHERE id = ? AND official_group_id = ? LIMIT 1`,
        [leagueId, groupId]
      );
      if (!leagueRows.length) return res.status(404).json({ message: 'Lega non trovata nel gruppo selezionato' });
      if (Number(leagueRows[0].two_g) !== 1) {
        return res.status(400).json({ message: 'Attiva prima "Due gironi" per questa lega' });
      }

      const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
      const teamRows = await query(`SELECT id FROM teams WHERE league_id = ?`, [leagueId]);
      const allowedTeamIds = new Set((teamRows || []).map((r) => Number(r.id)));

      const normalized = [];
      for (const a of assignments) {
        const tid = Number(a?.team_id);
        const gi = Number(a?.girone_index);
        if (!Number.isFinite(tid) || tid <= 0 || !allowedTeamIds.has(tid)) {
          return res.status(400).json({ message: `team_id non valido nella lega: ${a?.team_id}` });
        }
        if (!Number.isFinite(gi) || (gi !== 1 && gi !== 2)) {
          return res.status(400).json({ message: 'girone_index deve essere 1 o 2' });
        }
        normalized.push({ team_id: tid, girone_index: gi });
      }

      await query(`DELETE FROM league_official_team_gironi WHERE league_id = ?`, [leagueId]);
      for (const { team_id, girone_index } of normalized) {
        await query(
          `INSERT INTO league_official_team_gironi (league_id, team_id, girone_index) VALUES (?, ?, ?)`,
          [leagueId, team_id, girone_index]
        );
      }

      const out = await query(
        `SELECT t.id, t.name, g.girone_index AS girone_index
         FROM teams t
         LEFT JOIN league_official_team_gironi g ON g.league_id = t.league_id AND g.team_id = t.id
         WHERE t.league_id = ?
         ORDER BY t.name ASC, t.id ASC`,
        [leagueId]
      );
      return res.json({ ok: true, league_id: leagueId, teams: out || [] });
    } catch (error) {
      return res.status(500).json({ message: 'Errore salvataggio gironi squadre', error: error.message });
    }
  }
);

// GET /admin/matches?date=YYYY-MM-DD
router.get('/admin/matches', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const date = String(req.query?.date || '').trim();

    const rows = await query(
      `
      SELECT
        m.id,
        m.competition_id,
        COALESCE(NULLIF(to_jsonb(m)->>'is_admin_only','')::int, COALESCE(m.is_admin_only, 0), 0) AS is_admin_only,
        og.name AS competition_name,
        m.home_team_id,
        ht.league_id AS home_league_id,
        ht.name AS home_team_name,
        m.away_team_id,
        at.league_id AS away_league_id,
        at.name AS away_team_name,
        m.kickoff_at,
        COALESCE(m.status, 'scheduled') AS status,
        m.venue,
        m.referee,
        ms.name AS match_stage,
        NULLIF(to_jsonb(m)->>'match_stage_id','')::int AS match_stage_id,
        m.home_score,
        m.away_score,
        NULLIF(to_jsonb(m)->>'notes', '') AS notes,
        COALESCE(NULLIF(to_jsonb(m)->>'regulation_half_minutes','')::int, NULL) AS regulation_half_minutes,
        COALESCE(NULLIF(to_jsonb(m)->>'extra_time_enabled','')::int, NULL) AS extra_time_enabled,
        COALESCE(NULLIF(to_jsonb(m)->>'extra_first_half_minutes','')::int, NULL) AS extra_first_half_minutes,
        COALESCE(NULLIF(to_jsonb(m)->>'extra_second_half_minutes','')::int, NULL) AS extra_second_half_minutes,
        COALESCE(NULLIF(to_jsonb(m)->>'penalties_enabled','')::int, NULL) AS penalties_enabled
      FROM official_matches m
      INNER JOIN official_league_groups og ON og.id = m.competition_id
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      LEFT JOIN official_match_stages ms ON ms.id = NULLIF(to_jsonb(m)->>'match_stage_id','')::int
      WHERE (NULLIF(?, '') IS NULL OR (m.kickoff_at AT TIME ZONE 'Europe/Rome')::date = NULLIF(?, '')::date)
      ORDER BY m.kickoff_at ASC, m.id ASC
      `,
      [date, date]
    );
    return res.json({ date, matches: rows });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento partite admin', error: err.message });
  }
});

// GET /admin/matches/competition/:competitionId/teams
router.get('/admin/matches/competition/:competitionId/teams', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    await ensureLeagueOfficialGironiSchema();
    const competitionId = Number(req.params.competitionId);
    const onlyLeagues = Number(req.query?.only_leagues) === 1;
    const leagueIdsCsv = String(req.query?.league_ids || '').trim();

    const officialLeagues = await query(
      `SELECT
         id,
         name,
         official_group_id,
         access_code,
         NULLIF(to_jsonb(leagues)->>'reference_year','')::int AS reference_year,
         COALESCE(official_two_groups, 0) AS official_two_groups
       FROM leagues
       WHERE official_group_id = ? AND COALESCE(is_official, 0) = 1
       ORDER BY name ASC, id ASC`,
      [competitionId]
    );

    if (onlyLeagues) return res.json({ official_leagues: officialLeagues, teams: [] });

    const leagueIds = leagueIdsCsv
      ? leagueIdsCsv
          .split(',')
          .map((x) => Number(String(x).trim()))
          .filter((x) => Number.isFinite(x) && x > 0)
      : [];
    if (!leagueIds.length) return res.json({ official_leagues: officialLeagues, teams: [] });

    const teams = await query(
      `SELECT t.id, t.name, t.league_id, g.girone_index AS girone_index
       FROM teams t
       LEFT JOIN league_official_team_gironi g
         ON g.league_id = t.league_id AND g.team_id = t.id
       WHERE t.league_id IN (${leagueIds.map(() => '?').join(', ')})
       ORDER BY t.name ASC, t.id ASC`,
      leagueIds
    );

    return res.json({ official_leagues: officialLeagues, teams });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento squadre competizione', error: err.message });
  }
});

// POST /admin/matches — crea match
router.post('/admin/matches', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const competitionId = Number(req.body?.competition_id);
    const leagueId = Number(req.body?.league_id);
    const homeTeamRaw = req.body?.home_team_id;
    const awayTeamRaw = req.body?.away_team_id;
    const homeTeamId =
      homeTeamRaw == null || String(homeTeamRaw).trim() === '' ? null : Number(homeTeamRaw);
    const awayTeamId =
      awayTeamRaw == null || String(awayTeamRaw).trim() === '' ? null : Number(awayTeamRaw);
    const kickoffAt = String(req.body?.kickoff_at || '').trim();
    const homeTeamValid = homeTeamId == null || (Number.isFinite(homeTeamId) && homeTeamId > 0);
    const awayTeamValid = awayTeamId == null || (Number.isFinite(awayTeamId) && awayTeamId > 0);
    if (!competitionId || !leagueId || !kickoffAt || !homeTeamValid || !awayTeamValid) {
      return res.status(400).json({ message: 'Dati partita non validi' });
    }
    if (homeTeamId != null && awayTeamId != null && Number(homeTeamId) === Number(awayTeamId)) {
      return res.status(400).json({ message: 'Squadra casa e ospite non possono coincidere' });
    }

    const leagueRows = await query(
      `SELECT id FROM leagues WHERE id = ? AND official_group_id = ? LIMIT 1`,
      [leagueId, competitionId]
    );
    if (!Array.isArray(leagueRows) || leagueRows.length === 0) {
      return res.status(400).json({ message: 'Lega non valida per la competizione selezionata' });
    }

    const venue = req.body?.venue != null ? String(req.body.venue).trim() : null;
    const referee = req.body?.referee != null ? String(req.body.referee).trim() : null;
    const isAdminOnly = parseBooleanishInt(req.body?.is_admin_only, 0);
    const { stageId: matchStageId } = await resolveMatchStageInput(req.body?.match_stage_id);
    const gironiErrCreate = await assertOfficialGironiTeamsSameGroup(leagueId, matchStageId, homeTeamId, awayTeamId);
    if (gironiErrCreate) return res.status(400).json({ message: gironiErrCreate });
    if (Number(matchStageId) === 3) {
      const finalRows = await query(
        `
        SELECT id
        FROM official_matches
        WHERE league_id = ?
          AND NULLIF(to_jsonb(official_matches)->>'match_stage_id','')::int = 3
        ORDER BY id ASC
        LIMIT 1
        `,
        [leagueId]
      );
      if (Array.isArray(finalRows) && finalRows.length > 0) {
        return res.status(400).json({
          message:
            'Esiste già una Finale per questa lega. Modifica prima la partita Finale esistente.',
        });
      }
    }
    const regulationHalfMinutesRaw = Number(req.body?.regulation_half_minutes);
    const regulationHalfMinutes =
      Number.isFinite(regulationHalfMinutesRaw) && regulationHalfMinutesRaw >= 15 && regulationHalfMinutesRaw <= 60
        ? Math.trunc(regulationHalfMinutesRaw)
        : 30;
    const extraTimeEnabled = Number(req.body?.extra_time_enabled) ? 1 : 0;
    const extraFirstHalfRaw = Number(req.body?.extra_first_half_minutes);
    const extraSecondHalfRaw = Number(req.body?.extra_second_half_minutes);
    const extraFirstHalfMinutes =
      extraTimeEnabled === 1 && Number.isFinite(extraFirstHalfRaw) && extraFirstHalfRaw >= 1 && extraFirstHalfRaw <= 45
        ? Math.trunc(extraFirstHalfRaw)
        : 0;
    const extraSecondHalfMinutes =
      extraTimeEnabled === 1 && Number.isFinite(extraSecondHalfRaw) && extraSecondHalfRaw >= 1 && extraSecondHalfRaw <= 45
        ? Math.trunc(extraSecondHalfRaw)
        : 0;
    const penaltiesEnabled = Number(req.body?.penalties_enabled) ? 1 : 0;

    const rows = await query(
      `
      INSERT INTO official_matches
        (
          competition_id, league_id, home_team_id, away_team_id, kickoff_at, status, notes, created_by, venue, referee, match_stage_id,
          regulation_half_minutes, extra_time_enabled, extra_first_half_minutes, extra_second_half_minutes, penalties_enabled,
          home_score, away_score, is_admin_only, created_at
        )
      VALUES
        (?, ?, ?, ?, (?::timestamp AT TIME ZONE 'Europe/Rome'), 'scheduled', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NOW())
      RETURNING id
      `,
      [
        competitionId,
        leagueId,
        homeTeamId,
        awayTeamId,
        kickoffAt,
        userId,
        venue,
        referee,
        matchStageId,
        regulationHalfMinutes,
        extraTimeEnabled,
        extraFirstHalfMinutes,
        extraSecondHalfMinutes,
        penaltiesEnabled,
        isAdminOnly,
      ]
    );
    const id = rows[0]?.id;
    return res.json({ ok: true, id });
  } catch (err) {
    if (
      String(err?.code || '') === '23502' &&
      (String(err?.column || '') === 'home_team_id' || String(err?.column || '') === 'away_team_id')
    ) {
      return res.status(400).json({
        message:
          'Il database richiede ancora squadra casa/ospite. Applica la migrazione per consentire partite con squadre non definite.',
      });
    }
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore creazione partita', error: err.message });
  }
});

// PUT /admin/matches/publish-hidden — rende visibili tutte le partite nascoste (deve stare prima di /admin/matches/:matchId)
router.put('/admin/matches/publish-hidden', authenticateToken, requireSuperuserLevels([1, 2]), async (_req, res) => {
  try {
    const rows = await query(
      `
      UPDATE official_matches
      SET is_admin_only = 0
      WHERE COALESCE(is_admin_only, 0) = 1
      RETURNING id
      `
    );
    return res.json({
      ok: true,
      updated: Array.isArray(rows) ? rows.length : 0,
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore pubblicazione partite nascoste', error: err.message });
  }
});

// PUT /admin/matches/:matchId — update base
router.put('/admin/matches/:matchId', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    const competitionId = Number(req.body?.competition_id);
    const leagueId = Number(req.body?.league_id);
    const homeTeamRaw = req.body?.home_team_id;
    const awayTeamRaw = req.body?.away_team_id;
    const homeTeamId = homeTeamRaw == null || String(homeTeamRaw).trim() === '' ? null : Number(homeTeamRaw);
    const awayTeamId = awayTeamRaw == null || String(awayTeamRaw).trim() === '' ? null : Number(awayTeamRaw);
    const kickoffAt = req.body?.kickoff_at != null ? String(req.body.kickoff_at).trim() : null;
    const homeScore = req.body?.home_score != null && req.body.home_score !== '' ? Number(req.body.home_score) : null;
    const awayScore = req.body?.away_score != null && req.body.away_score !== '' ? Number(req.body.away_score) : null;
    const status = req.body?.status != null ? String(req.body.status).trim() : null;
    const notes = req.body?.notes != null ? String(req.body.notes).trim() : null;
    const regulationHalfMinutesRaw = Number(req.body?.regulation_half_minutes);
    const regulationHalfMinutes =
      Number.isFinite(regulationHalfMinutesRaw) && regulationHalfMinutesRaw >= 15 && regulationHalfMinutesRaw <= 60
        ? Math.trunc(regulationHalfMinutesRaw)
        : 30;
    const extraTimeEnabled = Number(req.body?.extra_time_enabled) ? 1 : 0;
    const extraFirstHalfRaw = Number(req.body?.extra_first_half_minutes);
    const extraSecondHalfRaw = Number(req.body?.extra_second_half_minutes);
    const extraFirstHalfMinutes =
      extraTimeEnabled === 1 && Number.isFinite(extraFirstHalfRaw) && extraFirstHalfRaw >= 1 && extraFirstHalfRaw <= 45
        ? Math.trunc(extraFirstHalfRaw)
        : 0;
    const extraSecondHalfMinutes =
      extraTimeEnabled === 1 && Number.isFinite(extraSecondHalfRaw) && extraSecondHalfRaw >= 1 && extraSecondHalfRaw <= 45
        ? Math.trunc(extraSecondHalfRaw)
        : 0;
    const penaltiesEnabled = Number(req.body?.penalties_enabled) ? 1 : 0;
    const venue = req.body?.venue != null ? String(req.body.venue).trim() : null;
    const referee = req.body?.referee != null ? String(req.body.referee).trim() : null;
    const isAdminOnly = parseBooleanishInt(req.body?.is_admin_only, 0);
    const { stageId: matchStageId } = await resolveMatchStageInput(req.body?.match_stage_id);
    if (!matchId || !competitionId || !leagueId || !kickoffAt) {
      return res.status(400).json({ message: 'Dati partita non validi' });
    }
    const homeTeamValid = homeTeamId == null || (Number.isFinite(homeTeamId) && homeTeamId > 0);
    const awayTeamValid = awayTeamId == null || (Number.isFinite(awayTeamId) && awayTeamId > 0);
    if (!homeTeamValid || !awayTeamValid) {
      return res.status(400).json({ message: 'Squadre non valide' });
    }
    if (homeTeamId != null && awayTeamId != null && Number(homeTeamId) === Number(awayTeamId)) {
      return res.status(400).json({ message: 'Squadra casa e ospite non possono coincidere' });
    }
    const leagueRows = await query(
      `SELECT id FROM leagues WHERE id = ? AND official_group_id = ? LIMIT 1`,
      [leagueId, competitionId]
    );
    if (!Array.isArray(leagueRows) || leagueRows.length === 0) {
      return res.status(400).json({ message: 'Lega non valida per la competizione selezionata' });
    }

    const gironiErr = await assertOfficialGironiTeamsSameGroup(leagueId, matchStageId, homeTeamId, awayTeamId);
    if (gironiErr) return res.status(400).json({ message: gironiErr });

    if (Number(matchStageId) === 3) {
      const finalRows = await query(
        `
        SELECT id
        FROM official_matches
        WHERE league_id = ?
          AND id <> ?
          AND NULLIF(to_jsonb(official_matches)->>'match_stage_id','')::int = 3
        ORDER BY id ASC
        LIMIT 1
        `,
        [leagueId, matchId]
      );
      if (Array.isArray(finalRows) && finalRows.length > 0) {
        return res.status(400).json({
          message:
            'Esiste già una Finale per questa lega. Modifica prima la partita Finale esistente.',
        });
      }
    }

    const updatedRows = await query(
      `
      UPDATE official_matches
      SET
        competition_id = ?,
        league_id = ?,
        home_team_id = ?,
        away_team_id = ?,
        kickoff_at = COALESCE((?::timestamp AT TIME ZONE 'Europe/Rome'), kickoff_at),
        home_score = ?,
        away_score = ?,
        status = COALESCE(?, status),
        notes = ?,
        venue = ?,
        referee = ?,
        match_stage_id = ?,
        is_admin_only = ?,
        regulation_half_minutes = ?,
        extra_time_enabled = ?,
        extra_first_half_minutes = ?,
        extra_second_half_minutes = ?,
        penalties_enabled = ?
      WHERE id = ?
      RETURNING id, COALESCE(is_admin_only, 0) AS is_admin_only
      `,
      [
        competitionId,
        leagueId,
        homeTeamId,
        awayTeamId,
        kickoffAt,
        homeScore,
        awayScore,
        status,
        notes,
        venue,
        referee,
        matchStageId,
        isAdminOnly,
        regulationHalfMinutes,
        extraTimeEnabled,
        extraFirstHalfMinutes,
        extraSecondHalfMinutes,
        penaltiesEnabled,
        matchId,
      ]
    );
    return res.json({ ok: true, match: updatedRows?.[0] || null });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore aggiornamento partita', error: err.message });
  }
});

// PUT /admin/matches/:matchId/meta — venue/referee/stage/kickoff (kickoff opzionale)
router.put('/admin/matches/:matchId/meta', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    if (!matchId) return res.status(400).json({ message: 'ID partita non valido' });

    const venue = req.body?.venue != null ? String(req.body.venue).trim() : null;
    const referee = req.body?.referee != null ? String(req.body.referee).trim() : null;
    const updateKickoff = req.body?.kickoff_at !== undefined;
    const kickoffAt = updateKickoff ? String(req.body.kickoff_at || '').trim() : null;
    if (updateKickoff && !kickoffAt) {
      return res.status(400).json({ message: 'Data e ora non validi' });
    }

    let matchStageId = null;
    if (req.body?.match_stage_id !== undefined) {
      const resolved = await resolveMatchStageInput(req.body.match_stage_id);
      matchStageId = resolved.stageId;
    } else {
      const stageRows = await query(
        `SELECT NULLIF(to_jsonb(m)->>'match_stage_id','')::int AS match_stage_id
         FROM official_matches m
         WHERE m.id = ?
         LIMIT 1`,
        [matchId]
      );
      matchStageId = stageRows[0]?.match_stage_id != null ? Number(stageRows[0].match_stage_id) : null;
    }

    const sets = ['venue = ?', 'referee = ?', 'match_stage_id = ?'];
    const params = [venue, referee, matchStageId];
    if (updateKickoff) {
      sets.push(`kickoff_at = (?::timestamp AT TIME ZONE 'Europe/Rome')`);
      params.push(kickoffAt);
    }
    params.push(matchId);
    await query(`UPDATE official_matches SET ${sets.join(', ')} WHERE id = ?`, params);
    return res.json({ ok: true });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore aggiornamento meta partita', error: err.message });
  }
});

// PUT /admin/matches/:matchId/stats — score only (legacy: no standings_text column)
router.put('/admin/matches/:matchId/stats', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    const homeScore = req.body?.home_score != null && req.body.home_score !== '' ? Number(req.body.home_score) : null;
    const awayScore = req.body?.away_score != null && req.body.away_score !== '' ? Number(req.body.away_score) : null;
    await query(`UPDATE official_matches SET home_score = ?, away_score = ? WHERE id = ?`, [homeScore, awayScore, matchId]);
    return res.json({ ok: true });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore aggiornamento stats partita', error: err.message });
  }
});

// POST /admin/matches/:matchId/events — add event
router.post('/admin/matches/:matchId/events', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const matchId = Number(req.params.matchId);
    const eventType = String(req.body?.event_type || '').trim();
    const minute = req.body?.minute != null && req.body.minute !== '' ? Number(req.body.minute) : null;
    const teamSide = req.body?.team_side != null ? String(req.body.team_side).trim() : null;
    const teamId = Number(req.body?.team_id);
    const playerId = Number(req.body?.player_id);
    const assistPlayerId = Number(req.body?.assist_player_id);
    const teamIdDb = Number.isFinite(teamId) && teamId > 0 ? teamId : null;
    const playerIdDb = Number.isFinite(playerId) && playerId > 0 ? playerId : null;
    const assistPlayerIdDb = Number.isFinite(assistPlayerId) && assistPlayerId > 0 ? assistPlayerId : null;
    const payloadObj = buildEventPayloadForDb(req.body);
    const title = buildEventTitleForDb(eventType, teamSide, payloadObj);
    const payloadJson = payloadObj ? JSON.stringify(payloadObj) : null;
    if (!eventType) return res.status(400).json({ message: 'event_type mancante' });

    let rows;
    const insertWithoutCreatedBy = async (withStructuredColumns = true) => {
      if (withStructuredColumns) {
        return await query(
          `
          INSERT INTO official_match_events
            (match_id, event_type, minute, team_side, team_id, player_id, assist_player_id, title, payload_json, created_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, NOW())
          RETURNING id
          `,
          [matchId, eventType, minute, teamSide, teamIdDb, playerIdDb, assistPlayerIdDb, title, payloadJson]
        );
      }
      return await query(
        `
        INSERT INTO official_match_events
          (match_id, event_type, minute, team_side, title, payload_json, created_at)
        VALUES
          (?, ?, ?, ?, ?, ?::jsonb, NOW())
        RETURNING id
        `,
        [matchId, eventType, minute, teamSide, title, payloadJson]
      );
    };

    try {
      // nessun created_by sugli eventi. Se la colonna non esiste, non deve bloccare l'inserimento.
      rows = await insertWithoutCreatedBy(true);
    } catch (err2) {
      if (err2 && err2.code === '42703' && /(team_id|player_id|assist_player_id)/i.test(String(err2.message || ''))) {
        rows = await insertWithoutCreatedBy(false);
      // Se qualcuno ha aggiunto la colonna created_by sul DB, prova a valorizzarla.
      } else if (err2 && err2.code === '42703' && /created_by/i.test(String(err2.message || ''))) {
        rows = await query(
          `
          INSERT INTO official_match_events
            (match_id, event_type, minute, team_side, team_id, player_id, assist_player_id, title, payload_json, created_by, created_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, NOW())
          RETURNING id
          `,
          [matchId, eventType, minute, teamSide, teamIdDb, playerIdDb, assistPlayerIdDb, title, payloadJson, userId]
        );
      } else if (err2 && err2.code === '23505' && String(err2.constraint || '') === 'official_match_events_pkey') {
        // Sequence id sfalsata (es. dopo import dati). Riallinea e ritenta una volta.
        await query(
          `
          SELECT setval(
            pg_get_serial_sequence('official_match_events','id'),
            (SELECT COALESCE(MAX(id), 0) + 1 FROM official_match_events),
            false
          )
          `
        );
        rows = await insertWithoutCreatedBy(true);
      } else {
        throw err2;
      }
    }
    const insertRows = getInsertRows(rows);
    const eventId = Number(insertRows[0]?.id || 0);

    if (eventType === 'match_end') {
      const live = await fetchOfficialMatchLiveScore(matchId);
      if (live) {
        await query(`UPDATE official_matches SET home_score = ?, away_score = ? WHERE id = ?`, [
          live.home,
          live.away,
          matchId,
        ]);
      }
    }

    let notificationStats = null;
    try {
      notificationStats = await notifyUsersForOfficialMatchEvent({
        eventId,
        matchId,
        eventType,
        payload: payloadObj || {},
        teamSide,
      });
    } catch (_notifyErr) {
      notificationStats = {
        targeted_users: 0,
        reserved: 0,
        sent: 0,
        invalidated: 0,
        errors: 1,
      };
    }
    return res.json({
      ok: true,
      id: eventId || null,
      notifications: notificationStats || {
        targeted_users: 0,
        reserved: 0,
        sent: 0,
        invalidated: 0,
        errors: 0,
      },
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore inserimento evento', error: err.message });
  }
});

// PUT /admin/matches/:matchId/events/:eventId — update single live event
router.put('/admin/matches/:matchId/events/:eventId', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    const eventId = Number(req.params.eventId);
    const eventType = String(req.body?.event_type || '').trim();
    const minute = req.body?.minute != null && req.body.minute !== '' ? Number(req.body.minute) : null;
    const teamSide = req.body?.team_side != null ? String(req.body.team_side).trim() : null;
    const teamId = Number(req.body?.team_id);
    const playerId = Number(req.body?.player_id);
    const assistPlayerId = Number(req.body?.assist_player_id);
    const teamIdDb = Number.isFinite(teamId) && teamId > 0 ? teamId : null;
    const playerIdDb = Number.isFinite(playerId) && playerId > 0 ? playerId : null;
    const assistPlayerIdDb = Number.isFinite(assistPlayerId) && assistPlayerId > 0 ? assistPlayerId : null;
    if (!matchId || !eventId || !eventType) return res.status(400).json({ message: 'Parametri evento non validi' });

    const payloadObj = buildEventPayloadForDb(req.body);
    const title = buildEventTitleForDb(eventType, teamSide, payloadObj);
    const payloadJson = payloadObj ? JSON.stringify(payloadObj) : null;

    try {
      await query(
        `
        UPDATE official_match_events
        SET event_type = ?, minute = ?, team_side = ?, team_id = ?, player_id = ?, assist_player_id = ?, title = ?, payload_json = ?::jsonb
        WHERE id = ? AND match_id = ?
        `,
        [eventType, minute, teamSide, teamIdDb, playerIdDb, assistPlayerIdDb, title, payloadJson, eventId, matchId]
      );
    } catch (err2) {
      if (err2 && err2.code === '42703' && /(team_id|player_id|assist_player_id)/i.test(String(err2.message || ''))) {
        await query(
          `
          UPDATE official_match_events
          SET event_type = ?, minute = ?, team_side = ?, title = ?, payload_json = ?::jsonb
          WHERE id = ? AND match_id = ?
          `,
          [eventType, minute, teamSide, title, payloadJson, eventId, matchId]
        );
      } else {
        throw err2;
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore aggiornamento evento', error: err.message });
  }
});

// DELETE /admin/matches/:matchId/events/:eventId — delete single live event
router.delete('/admin/matches/:matchId/events/:eventId', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    const eventId = Number(req.params.eventId);
    if (!matchId || !eventId) return res.status(400).json({ message: 'Parametri evento non validi' });
    await query(`DELETE FROM official_match_events WHERE id = ? AND match_id = ?`, [eventId, matchId]);
    return res.json({ ok: true });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore eliminazione evento', error: err.message });
  }
});

// DELETE /admin/matches/:matchId
router.delete('/admin/matches/:matchId', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    if (!Number.isFinite(matchId) || matchId <= 0) {
      return res.status(400).json({ message: 'matchId non valido' });
    }

    await query('BEGIN');
    await query(`DELETE FROM user_official_match_notifications WHERE match_id = ?`, [matchId]);
    await query(`DELETE FROM user_official_match_favorites WHERE match_id = ?`, [matchId]);
    await query(`DELETE FROM official_match_events WHERE match_id = ?`, [matchId]);
    await query(`DELETE FROM official_matches WHERE id = ?`, [matchId]);
    await query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    try {
      await query('ROLLBACK');
    } catch (_rollbackErr) {}
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore eliminazione partita', error: err.message });
  }
});

// Standings ties: ordini manuali admin per parimerito.
router.get('/admin/matches/standings/ties', authenticateToken, requireSuperuserLevels([1]), async (req, res) => {
  try {
    const competitionId = Number(req.query?.competition_id);
    if (!Number.isFinite(competitionId) || competitionId <= 0) return res.json({ ties: [] });

    await ensureStandingsTieOrderTable();
    const leagues = await query(
      `
      SELECT id, name
      FROM leagues
      WHERE official_group_id = ?
        AND COALESCE(is_official, 0) = 1
      ORDER BY NULLIF(to_jsonb(leagues)->>'reference_year','')::int DESC NULLS LAST, id DESC
      `,
      [competitionId]
    );

    const ties = [];
    for (const l of leagues || []) {
      const leagueId = Number(l.id);
      if (!Number.isFinite(leagueId) || leagueId <= 0) continue;
      const standings = await computeStandingsFromMatches({ leagueId, groupId: competitionId });
      const byPoints = new Map();
      for (const row of standings || []) {
        const pts = Number(row.points);
        if (!Number.isFinite(pts)) continue;
        if (!byPoints.has(pts)) byPoints.set(pts, []);
        byPoints.get(pts).push(row);
      }
      for (const [points, teams] of byPoints.entries()) {
        if (!Array.isArray(teams) || teams.length < 2) continue;
        ties.push({
          league_id: leagueId,
          league_name: l.name || `Lega ${leagueId}`,
          points,
          teams: teams.map((t) => ({
            team_id: Number(t.team_id),
            team_name: t.team_name,
            goal_diff: Number(t.goal_diff),
            goals_for: Number(t.gf || 0),
            points: Number(t.points),
          })),
        });
      }
    }
    return res.json({ ties });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento parimerito', error: err.message });
  }
});
router.post('/admin/matches/standings/ties/resolve', authenticateToken, requireSuperuserLevels([1]), async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const leagueId = Number(req.body?.league_id);
    const points = Number(req.body?.points);
    const orderedTeamIds = Array.isArray(req.body?.ordered_team_ids)
      ? req.body.ordered_team_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
      : [];
    if (!Number.isFinite(leagueId) || leagueId <= 0 || !Number.isFinite(points) || orderedTeamIds.length < 2) {
      return res.status(400).json({ message: 'Ordine parimerito non valido' });
    }

    const leagueRows = await query(
      `SELECT official_group_id FROM leagues WHERE id = ? LIMIT 1`,
      [leagueId]
    );
    const competitionId = Number(req.body?.competition_id || leagueRows[0]?.official_group_id);
    if (!Number.isFinite(competitionId) || competitionId <= 0) {
      return res.status(400).json({ message: 'Competizione non valida' });
    }

    await ensureStandingsTieOrderTable();
    await query(
      `
      INSERT INTO official_standings_tie_orders
        (competition_id, league_id, points, ordered_team_ids, created_by, created_at, updated_at)
      VALUES
        (?, ?, ?, ?::jsonb, ?, NOW(), NOW())
      ON CONFLICT (competition_id, league_id, points)
      DO UPDATE SET
        ordered_team_ids = EXCLUDED.ordered_team_ids,
        updated_at = NOW()
      `,
      [competitionId, leagueId, Math.trunc(points), JSON.stringify(orderedTeamIds), userId || null]
    );
    return res.json({ ok: true });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore salvataggio ordine parimerito', error: err.message });
  }
});

// Match details options: venues/referees/stages
router.get('/admin/match-details', authenticateToken, requireSuperuserLevels([1, 2]), async (_req, res) => {
  try {
    const venues = await query(`SELECT id, name FROM official_match_venues ORDER BY name ASC`);
    const referees = await query(`SELECT id, name FROM official_match_referees ORDER BY name ASC`);
    const stages = await query(
      `SELECT
         id,
         name,
         COALESCE(NULLIF(to_jsonb(s)->>'default_regulation_half_minutes','')::int, 30) AS default_regulation_half_minutes,
         COALESCE(NULLIF(to_jsonb(s)->>'default_extra_time_enabled','')::int, 0) AS default_extra_time_enabled,
         COALESCE(NULLIF(to_jsonb(s)->>'default_extra_first_half_minutes','')::int, 15) AS default_extra_first_half_minutes,
         COALESCE(NULLIF(to_jsonb(s)->>'default_extra_second_half_minutes','')::int, 15) AS default_extra_second_half_minutes,
         COALESCE(NULLIF(to_jsonb(s)->>'default_penalties_enabled','')::int, 0) AS default_penalties_enabled
       FROM official_match_stages s
       ORDER BY name ASC`
    );
    return res.json({ venues, referees, stages });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento match-details', error: err.message });
  }
});

router.post('/admin/match-details/venues', authenticateToken, requireSuperuserLevels([1]), async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'name mancante' });
    let rows;
    try {
      rows = await query(
        `INSERT INTO official_match_venues (name, created_by, created_at) VALUES (?, ?, NOW()) RETURNING id`,
        [name, userId]
      );
    } catch (err2) {
      if (err2 && err2.code === '42703' && /created_by/i.test(String(err2.message || ''))) {
        rows = await query(`INSERT INTO official_match_venues (name, created_at) VALUES (?, NOW()) RETURNING id`, [name]);
      } else {
        throw err2;
      }
    }
    return res.json({ ok: true, id: rows[0]?.id });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    if (err?.code === '23505') return res.status(409).json({ message: 'Luogo già presente' });
    return res.status(500).json({ message: 'Errore creazione venue', error: err.message });
  }
});
router.delete('/admin/match-details/venues/:id', authenticateToken, requireSuperuserLevels([1]), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await query(`DELETE FROM official_match_venues WHERE id = ?`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore eliminazione venue', error: err.message });
  }
});

router.post('/admin/match-details/referees', authenticateToken, requireSuperuserLevels([1]), async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'name mancante' });
    let rows;
    try {
      rows = await query(
        `INSERT INTO official_match_referees (name, created_by, created_at) VALUES (?, ?, NOW()) RETURNING id`,
        [name, userId]
      );
    } catch (err2) {
      if (err2 && err2.code === '42703' && /created_by/i.test(String(err2.message || ''))) {
        rows = await query(`INSERT INTO official_match_referees (name, created_at) VALUES (?, NOW()) RETURNING id`, [name]);
      } else {
        throw err2;
      }
    }
    return res.json({ ok: true, id: rows[0]?.id });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    if (err?.code === '23505') return res.status(409).json({ message: 'Arbitro già presente' });
    return res.status(500).json({ message: 'Errore creazione referee', error: err.message });
  }
});
router.put('/admin/match-details/referees/:id', authenticateToken, requireSuperuserLevels([1]), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body?.name || '').trim();
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'id non valido' });
    if (!name) return res.status(400).json({ message: 'name mancante' });

    const oldRows = await query(
      `SELECT name FROM official_match_referees WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!oldRows.length) return res.status(404).json({ message: 'Arbitro non trovato' });

    const oldName = String(oldRows[0]?.name || '').trim();
    await query(`UPDATE official_match_referees SET name = ? WHERE id = ?`, [name, id]);
    if (oldName && oldName !== name) {
      await query(`UPDATE official_matches SET referee = ? WHERE referee = ?`, [name, oldName]);
    }
    return res.json({ ok: true, id, name });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    if (err?.code === '23505') return res.status(409).json({ message: 'Arbitro già presente' });
    return res.status(500).json({ message: 'Errore aggiornamento referee', error: err.message });
  }
});
router.delete('/admin/match-details/referees/:id', authenticateToken, requireSuperuserLevels([1]), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await query(`DELETE FROM official_match_referees WHERE id = ?`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore eliminazione referee', error: err.message });
  }
});

router.post('/admin/match-details/stages', authenticateToken, requireSuperuserLevels([1]), async (req, res) => {
  try {
    const userId = Number(req.user?.userId);
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'name mancante' });
    const dHalf = safeInt(req.body?.default_regulation_half_minutes, 30);
    const dExtraEnabled = Number(req.body?.default_extra_time_enabled) ? 1 : 0;
    const dExtra1 = safeInt(req.body?.default_extra_first_half_minutes, 15);
    const dExtra2 = safeInt(req.body?.default_extra_second_half_minutes, 15);
    const dPens = Number(req.body?.default_penalties_enabled) ? 1 : 0;

    let rows;
    try {
      rows = await query(
        `
        INSERT INTO official_match_stages
          (name, created_by, created_at, default_regulation_half_minutes, default_extra_time_enabled, default_extra_first_half_minutes, default_extra_second_half_minutes, default_penalties_enabled)
        VALUES
          (?, ?, NOW(), ?, ?, ?, ?, ?)
        RETURNING id
        `,
        [name, userId, dHalf, dExtraEnabled, dExtra1, dExtra2, dPens]
      );
    } catch (err2) {
      if (err2 && err2.code === '42703' && /created_by/i.test(String(err2.message || ''))) {
        rows = await query(
          `
          INSERT INTO official_match_stages
            (name, created_at, default_regulation_half_minutes, default_extra_time_enabled, default_extra_first_half_minutes, default_extra_second_half_minutes, default_penalties_enabled)
          VALUES
            (?, NOW(), ?, ?, ?, ?, ?)
          RETURNING id
          `,
          [name, dHalf, dExtraEnabled, dExtra1, dExtra2, dPens]
        );
      } else {
        throw err2;
      }
    }
    return res.json({ ok: true, id: rows[0]?.id });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    if (err?.code === '23505') return res.status(409).json({ message: 'Tipologia giornata già presente' });
    return res.status(500).json({ message: 'Errore creazione stage', error: err.message });
  }
});

router.put('/admin/match-details/stages/:id', authenticateToken, requireSuperuserLevels([1]), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const dHalf = safeInt(req.body?.default_regulation_half_minutes, 30);
    const dExtraEnabled = Number(req.body?.default_extra_time_enabled) ? 1 : 0;
    const dExtra1 = safeInt(req.body?.default_extra_first_half_minutes, 15);
    const dExtra2 = safeInt(req.body?.default_extra_second_half_minutes, 15);
    const dPens = Number(req.body?.default_penalties_enabled) ? 1 : 0;
    await query(
      `
      UPDATE official_match_stages
      SET
        default_regulation_half_minutes = ?,
        default_extra_time_enabled = ?,
        default_extra_first_half_minutes = ?,
        default_extra_second_half_minutes = ?,
        default_penalties_enabled = ?
      WHERE id = ?
      `,
      [dHalf, dExtraEnabled, dExtra1, dExtra2, dPens, id]
    );
    return res.json({ ok: true });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore update stage', error: err.message });
  }
});

router.delete('/admin/match-details/stages/:id', authenticateToken, requireSuperuserLevels([1]), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await query(`DELETE FROM official_match_stages WHERE id = ?`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore eliminazione stage', error: err.message });
  }
});

module.exports = router;

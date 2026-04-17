const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function isMissingDbObjectError(err) {
  return err && (err.code === '42P01' || err.code === '42703'); // undefined_table / undefined_column
}

function matchesNotConfigured(res, err) {
  return res.status(410).json({
    message: 'Gestione partite non configurata sul DB (tabelle/colonne mancanti)',
    error: err?.message,
    code: err?.code,
  });
}

function getInsertRows(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  return [];
}

function eventNotificationTitle(eventType) {
  if (eventType === 'match_start') return 'Inizio partita';
  if (eventType === 'match_end') return 'Fine partita';
  if (eventType === 'goal') return 'Goal';
  if (eventType === 'own_goal') return 'Autogol';
  return null;
}

function eventNotificationBody({ eventType, homeTeamName, awayTeamName, payload }) {
  const matchLabel = `${homeTeamName || 'Casa'} - ${awayTeamName || 'Trasferta'}`;
  const playerName = String(payload?.player_name || '').trim();
  if (eventType === 'match_start') return `${matchLabel}: la partita e iniziata.`;
  if (eventType === 'match_end') return `${matchLabel}: la partita e terminata.`;
  if (eventType === 'goal') return playerName ? `${matchLabel}: gol di ${playerName}.` : `${matchLabel}: gol.`;
  if (eventType === 'own_goal') return playerName ? `${matchLabel}: autogol di ${playerName}.` : `${matchLabel}: autogol.`;
  return null;
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

async function notifyUsersForOfficialMatchEvent({ eventId, matchId, eventType, payload }) {
  const title = eventNotificationTitle(eventType);
  if (!title) return { targeted_users: 0, reserved: 0, sent: 0, invalidated: 0, errors: 0 };

  const matchRows = await safeQuery(
    `SELECT m.id, m.competition_id, m.home_team_id, m.away_team_id,
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

  // Stessa logica target di api.php collectOfficialMatchEventPushTargets:
  // campanella sulla partita OR preferiti squadra (gruppo ufficiale + nome normalizzato) con notifiche attive.
  const byMatchRows = await safeQuery(
    `SELECT mn.user_id, upt.expo_push_token
     FROM user_official_match_notifications mn
     JOIN user_push_tokens upt ON upt.user_id = mn.user_id AND upt.is_active = 1
     WHERE mn.match_id = ? AND COALESCE(mn.enabled, 0) = 1`,
    [matchId]
  );
  let fromMatchBellUsers = 0;
  const matchBellSeen = new Set();
  for (const r of byMatchRows || []) {
    const u = Number(r.user_id);
    if (u && !matchBellSeen.has(u)) {
      matchBellSeen.add(u);
      fromMatchBellUsers += 1;
    }
    addTarget(r.user_id, r.expo_push_token);
  }

  let fromTeamFavoriteUsers = 0;
  const teamFavSeen = new Set();
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
      for (const r of byTeamRows || []) {
        const u = Number(r.user_id);
        if (u && !teamFavSeen.has(u)) {
          teamFavSeen.add(u);
          fromTeamFavoriteUsers += 1;
        }
        addTarget(r.user_id, r.expo_push_token);
      }
    }
  }

  const body = eventNotificationBody({
    eventType,
    homeTeamName: match.home_team_name,
    awayTeamName: match.away_team_name,
    payload,
  });
  if (!body) return { targeted_users: targetsByUser.size, reserved: 0, sent: 0, invalidated: 0, errors: 0 };

  let reserved = 0;
  const messages = [];
  const evId = Number(eventId);
  for (const [userId, tokenSet] of targetsByUser.entries()) {
    // Schema allineato a api.php: user_official_match_event_sent (user_id, match_event_id), INSERT IGNORE / ON CONFLICT
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
    debug: {
      // id nell'endpoint events è l'id riga official_match_events, non user_id
      official_match_event_id: evId || null,
      match_id: Number(matchId),
      competition_id: compId || null,
      // Campanella partita: solo match_id (nessun nome squadra in user_official_match_notifications)
      users_with_match_bell: fromMatchBellUsers,
      // Preferiti: confronto su team_name_norm + official_group_id (= competition_id partita)
      users_with_team_favorite_bell: fromTeamFavoriteUsers,
      home_team_norm: homeNorm || null,
      away_team_norm: awayNorm || null,
    },
  };
}

function normalizeTeamNameForFavorite(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '');
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
  const clockTime = body?.clock_time != null ? String(body.clock_time).trim() : '';
  const out = {};
  if (playerName) out.player_name = playerName;
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
  if (eventType === 'own_goal') return pn ? `Autogol - ${pn}` : 'Autogol';
  if (eventType === 'yellow_card') return pn ? `Ammonizione - ${pn}` : 'Ammonizione';
  if (eventType === 'red_card') return pn ? `Espulsione - ${pn}` : 'Espulsione';
  if (eventType === 'penalty_missed') return pn ? `Rigore sbagliato - ${pn}` : 'Rigore sbagliato';
  if (eventType === 'match_start') return 'Inizio partita';
  if (eventType === 'match_end') return 'Fine partita';
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
  const title = ev.title || buildEventTitleForDb(ev.event_type, ev.team_side, nextPayload);
  return {
    id: Number(ev.id),
    match_id: Number(ev.match_id),
    event_type: ev.event_type,
    minute: ev.minute != null ? Number(ev.minute) : null,
    team_side: ev.team_side,
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

async function computeStandingsFromMatches({ leagueId, groupId }) {
  const teams = await query(
    `
    SELECT
      t.id,
      t.name,
      t.league_id,
      COALESCE(NULLIF(to_jsonb(t)->>'logo_path',''), NULLIF(t.logo_path, '')) AS logo_path
    FROM teams t
    WHERE t.league_id = ?
    ORDER BY t.id ASC
    `,
    [leagueId]
  );
  const teamMap = new Map((Array.isArray(teams) ? teams : []).map((t) => [Number(t.id), t]));
  if (teamMap.size === 0) return [];

  // Match della competizione che coinvolgono team di questa lega
  const matches = await query(
    `
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
    `,
    [groupId, leagueId, leagueId]
  );

  const matchIds = (Array.isArray(matches) ? matches : []).map((m) => Number(m.id)).filter((x) => x > 0);
  const eventsByMatch = new Map();
  if (matchIds.length) {
    const ph = matchIds.map(() => '?').join(', ');
    const evs = await query(
      `
      SELECT match_id, event_type, team_side
      FROM official_match_events
      WHERE match_id IN (${ph}) AND event_type IN ('goal','own_goal')
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

  const scoreFromEvents = (mid) => {
    const evs = eventsByMatch.get(mid) || [];
    let h = 0;
    let a = 0;
    for (const e of evs) {
      if (e.event_type === 'goal') {
        if (e.team_side === 'home') h += 1;
        if (e.team_side === 'away') a += 1;
      } else if (e.event_type === 'own_goal') {
        if (e.team_side === 'home') a += 1;
        if (e.team_side === 'away') h += 1;
      }
    }
    return { home: h, away: a, has: evs.length > 0 };
  };

  for (const m of Array.isArray(matches) ? matches : []) {
    const homeId = Number(m.home_team_id);
    const awayId = Number(m.away_team_id);
    if (!table.has(homeId) || !table.has(awayId)) continue;

    const evScore = scoreFromEvents(Number(m.id));
    const hs = evScore.has ? evScore.home : (m.home_score != null ? Number(m.home_score) : null);
    const as = evScore.has ? evScore.away : (m.away_score != null ? Number(m.away_score) : null);
    if (hs == null || as == null) continue; // non giocata/risultato non disponibile

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
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
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
      goal_diff: Number(r.goal_diff),
      points: Number(r.points),
      team_logo_path: lp,
      team_logo_url: logoUrlForPath(lp),
    };
  });
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
      WITH ev_scores AS (
        SELECT
          e.match_id,
          SUM(CASE
                WHEN e.event_type = 'goal' AND e.team_side = 'home' THEN 1
                WHEN e.event_type = 'own_goal' AND e.team_side = 'away' THEN 1
                ELSE 0
              END)::int AS ev_home,
          SUM(CASE
                WHEN e.event_type = 'goal' AND e.team_side = 'away' THEN 1
                WHEN e.event_type = 'own_goal' AND e.team_side = 'home' THEN 1
                ELSE 0
              END)::int AS ev_away
        FROM official_match_events e
        WHERE e.event_type IN ('goal','own_goal')
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
      )
      SELECT
        m.id,
        m.competition_id,
        og.name AS competition_name,
        m.kickoff_at,
        COALESCE(m.status, 'scheduled') AS status,
        m.notes,
        m.venue,
        m.referee,
        m.match_stage,
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
        COALESCE(fm.match_id IS NOT NULL, false) AS is_favorite_match,
        COALESCE(mn.enabled, 0) AS notifications_enabled,
        COALESCE(lp.last_phase_type, NULL) AS last_phase_type,
        COALESCE(lp.last_phase_minute, NULL) AS last_phase_minute,
        COALESCE(pe.live_phase_events, '[]'::json) AS live_phase_events
      FROM official_matches m
      INNER JOIN official_league_groups og ON og.id = m.competition_id
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      LEFT JOIN ev_scores evs ON evs.match_id = m.id
      LEFT JOIN last_phase lp ON lp.match_id = m.id
      LEFT JOIN phase_events pe ON pe.match_id = m.id
      LEFT JOIN user_official_match_favorites fm ON fm.user_id = ? AND fm.match_id = m.id
      LEFT JOIN user_official_match_notifications mn ON mn.user_id = ? AND mn.match_id = m.id
      WHERE (m.kickoff_at AT TIME ZONE 'Europe/Rome')::date = ?::date
      ORDER BY (fm.match_id IS NOT NULL) DESC, m.kickoff_at ASC, m.id ASC
      `,
      [userId, userId, date]
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

// GET /matches/:matchId/detail — dettaglio match con tabs (overview/formazione/classifica) come legacy api.php
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
        m.home_team_id,
        m.away_team_id,
        m.kickoff_at,
        COALESCE(m.status, 'scheduled') AS status,
        m.venue,
        m.referee,
        m.match_stage,
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
      INNER JOIN teams ht ON ht.id = m.home_team_id
      INNER JOIN teams at ON at.id = m.away_team_id
      LEFT JOIN user_official_match_favorites fm ON fm.user_id = ? AND fm.match_id = m.id
      LEFT JOIN user_official_match_notifications mn ON mn.user_id = ? AND mn.match_id = m.id
      WHERE m.id = ?
      LIMIT 1
      `,
      [userId, userId, matchId]
    );
    const matchRow = rows[0];
    if (!matchRow) return res.status(404).json({ message: 'Partita non trovata' });

    const homeTeam = await getTeamMeta(Number(matchRow.home_team_id));
    const awayTeam = await getTeamMeta(Number(matchRow.away_team_id));

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

    const rawEvents = await query(
      `
      SELECT id, match_id, event_type, minute, team_side, title, payload_json, created_at
      FROM official_match_events
      WHERE match_id = ?
      ORDER BY minute ASC, id ASC
      `,
      [matchId]
    );

    const events = (Array.isArray(rawEvents) ? rawEvents : []).map(enrichEventForApi);

    // Compatibilità timezone legacy: se il solo evento match_start arriva con created_at
    // sfasato di ore (default DB/trigger errato), lo riallineiamo all'orario attuale
    // per evitare cronometri che partono da ~120'.
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

    const homeLineup = await getTeamPlayersLineup(Number(match.home_team_id));
    const awayLineup = await getTeamPlayersLineup(Number(match.away_team_id));

    // Standings: legacy calcola da lega ufficiale (se home/away nella stessa lega)
    let standings = [];
    try {
      const homeLeagueId = Number(match.home_league_id || 0);
      const awayLeagueId = Number(match.away_league_id || 0);
      if (homeLeagueId > 0 && homeLeagueId === awayLeagueId) {
        standings = await computeStandingsFromMatches({
          leagueId: homeLeagueId,
          groupId: Number(match.competition_id),
        });
      }
    } catch (err) {
      // se la tabella non esiste, standings resta vuota (compatibile legacy)
      standings = [];
    }

    return res.json({
      match,
      lineups: { home: homeLineup, away: awayLineup },
      team_players: { home: homeLineup, away: awayLineup },
      events: correctedEvents,
      standings,
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
        `DELETE FROM user_official_team_favorites WHERE user_id = ? AND official_group_id = ? AND team_name_norm = ?`,
        [userId, groupId, teamNameNorm]
      );
    }
    return res.json({ ok: true, official_group_id: groupId, team_name: teamName, is_favorite: isFavorite });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore aggiornamento preferito squadra', error: err.message });
  }
});

// GET /matches/follow-setup — competizioni visibili, squadre e preferenze utente
router.get('/matches/follow-setup', authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?.userId);

    const competitions = await listCompetitionsOnlyEnabled();
    const compIds = competitions.map((c) => Number(c.id)).filter((x) => x > 0);

    const prefs = await query(
      `SELECT official_group_id, team_name_norm, team_name_display, COALESCE(is_heart, 0) AS is_heart, COALESCE(notifications_enabled, 0) AS notifications_enabled
       FROM user_official_team_favorites
       WHERE user_id = ?
       ORDER BY official_group_id ASC, team_name_norm ASC`,
      [userId]
    );

    // Squadre presenti nelle partite di ciascuna competizione (allineato al legacy: non dipende da leagues.is_official)
    const teamsByGroup = new Map();
    if (compIds.length > 0) {
      const teamRows = await query(
        `
        SELECT DISTINCT
          m.competition_id AS official_group_id,
          t.name AS team_name
        FROM official_matches m
        INNER JOIN teams t ON t.id = m.home_team_id
        WHERE m.competition_id IN (${compIds.map(() => '?').join(', ')})
        UNION
        SELECT DISTINCT
          m.competition_id AS official_group_id,
          t.name AS team_name
        FROM official_matches m
        INNER JOIN teams t ON t.id = m.away_team_id
        WHERE m.competition_id IN (${compIds.map(() => '?').join(', ')})
        `,
        [...compIds, ...compIds]
      );

      for (const r of Array.isArray(teamRows) ? teamRows : []) {
        const gid = safeInt(r.official_group_id);
        const name = String(r.team_name || '').trim();
        if (!gid || !name) continue;
        if (!teamsByGroup.has(gid)) teamsByGroup.set(gid, new Set());
        teamsByGroup.get(gid).add(name);
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
      const teams = Array.from(teamsByGroup.get(gid) || []).sort((a, b) => a.localeCompare(b, 'it'));
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
    // (Allineato allo spirito dell'api.php: salva per nome normalizzato.)
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
      `SELECT og.id, og.name, COALESCE(og.is_match_competition_enabled, 1) AS is_match_competition_enabled
       FROM official_league_groups og
       ORDER BY og.name ASC`
    );
    return res.json(rows);
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore caricamento competizioni admin', error: err.message });
  }
});

// PUT /admin/competitions/:competitionId — toggle visibilità
router.put('/admin/competitions/:competitionId', authenticateToken, requireSuperuserLevels([1]), async (req, res) => {
  try {
    const id = Number(req.params.competitionId);
    const enabled = Number(req.body?.is_match_competition_enabled) ? 1 : 0;
    if (!id || id <= 0) return res.status(400).json({ message: 'competitionId non valido' });
    await query(`UPDATE official_league_groups SET is_match_competition_enabled = ? WHERE id = ?`, [enabled, id]);
    return res.json({ message: 'Visibilità competizione aggiornata', id, is_match_competition_enabled: enabled });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore aggiornamento competizione', error: err.message });
  }
});

// GET /admin/matches?date=YYYY-MM-DD
router.get('/admin/matches', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const date = String(req.query?.date || '').trim();
    if (!date) return res.status(400).json({ message: 'date mancante' });

    const rows = await query(
      `
      SELECT
        m.id,
        m.competition_id,
        og.name AS competition_name,
        m.home_team_id,
        ht.name AS home_team_name,
        m.away_team_id,
        at.name AS away_team_name,
        m.kickoff_at,
        COALESCE(m.status, 'scheduled') AS status,
        m.venue,
        m.referee,
        m.match_stage,
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
      WHERE (m.kickoff_at AT TIME ZONE 'Europe/Rome')::date = ?::date
      ORDER BY m.kickoff_at ASC, m.id ASC
      `,
      [date]
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
    const competitionId = Number(req.params.competitionId);
    const onlyLeagues = Number(req.query?.only_leagues) === 1;
    const leagueIdsCsv = String(req.query?.league_ids || '').trim();

    const officialLeagues = await query(
      `SELECT id, name, official_group_id, access_code
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
      `SELECT t.id, t.name, t.league_id
       FROM teams t
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
    const homeTeamId = Number(req.body?.home_team_id);
    const awayTeamId = Number(req.body?.away_team_id);
    const kickoffAt = String(req.body?.kickoff_at || '').trim();
    if (!competitionId || !homeTeamId || !awayTeamId || !kickoffAt) {
      return res.status(400).json({ message: 'Dati partita non validi' });
    }

    const venue = req.body?.venue != null ? String(req.body.venue).trim() : null;
    const referee = req.body?.referee != null ? String(req.body.referee).trim() : null;
    const matchStage = req.body?.match_stage != null ? String(req.body.match_stage).trim() : null;

    const rows = await query(
      `
      INSERT INTO official_matches
        (competition_id, home_team_id, away_team_id, kickoff_at, status, notes, created_by, venue, referee, match_stage, home_score, away_score, created_at)
      VALUES
        (?, ?, ?, ?::timestamp, 'scheduled', NULL, ?, ?, ?, ?, NULL, NULL, NOW())
      RETURNING id
      `,
      [competitionId, homeTeamId, awayTeamId, kickoffAt, userId, venue, referee, matchStage]
    );
    const id = rows[0]?.id;
    return res.json({ ok: true, id });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore creazione partita', error: err.message });
  }
});

// PUT /admin/matches/:matchId — update base
router.put('/admin/matches/:matchId', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    const kickoffAt = req.body?.kickoff_at != null ? String(req.body.kickoff_at).trim() : null;
    const homeScore = req.body?.home_score != null && req.body.home_score !== '' ? Number(req.body.home_score) : null;
    const awayScore = req.body?.away_score != null && req.body.away_score !== '' ? Number(req.body.away_score) : null;
    const status = req.body?.status != null ? String(req.body.status).trim() : null;
    const notes = req.body?.notes != null ? String(req.body.notes).trim() : null;

    await query(
      `
      UPDATE official_matches
      SET
        kickoff_at = COALESCE(?::timestamp, kickoff_at),
        home_score = ?,
        away_score = ?,
        status = COALESCE(?, status),
        notes = ?
      WHERE id = ?
      `,
      [kickoffAt, homeScore, awayScore, status, notes, matchId]
    );
    return res.json({ ok: true });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore aggiornamento partita', error: err.message });
  }
});

// PUT /admin/matches/:matchId/meta — venue/referee/stage
router.put('/admin/matches/:matchId/meta', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    const venue = req.body?.venue != null ? String(req.body.venue).trim() : null;
    const referee = req.body?.referee != null ? String(req.body.referee).trim() : null;
    const matchStage = req.body?.match_stage != null ? String(req.body.match_stage).trim() : null;
    await query(
      `UPDATE official_matches SET venue = ?, referee = ?, match_stage = ? WHERE id = ?`,
      [venue, referee, matchStage, matchId]
    );
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
    const payloadObj = buildEventPayloadForDb(req.body);
    const title = buildEventTitleForDb(eventType, teamSide, payloadObj);
    const payloadJson = payloadObj ? JSON.stringify(payloadObj) : null;
    if (!eventType) return res.status(400).json({ message: 'event_type mancante' });

    let rows;
    const insertWithoutCreatedBy = async () =>
      await query(
        `
        INSERT INTO official_match_events
          (match_id, event_type, minute, team_side, title, payload_json, created_at)
        VALUES
          (?, ?, ?, ?, ?, ?::jsonb, NOW())
        RETURNING id
        `,
        [matchId, eventType, minute, teamSide, title, payloadJson]
      );

    try {
      // Legacy api.php: nessun created_by sugli eventi. Se la colonna non esiste, non deve bloccare l'inserimento.
      rows = await insertWithoutCreatedBy();
    } catch (err2) {
      // Se qualcuno ha aggiunto la colonna created_by sul DB, prova a valorizzarla.
      if (err2 && err2.code === '42703' && /created_by/i.test(String(err2.message || ''))) {
        rows = await query(
          `
          INSERT INTO official_match_events
            (match_id, event_type, minute, team_side, title, payload_json, created_by, created_at)
          VALUES
            (?, ?, ?, ?, ?, ?::jsonb, ?, NOW())
          RETURNING id
          `,
          [matchId, eventType, minute, teamSide, title, payloadJson, userId]
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
        rows = await insertWithoutCreatedBy();
      } else {
        throw err2;
      }
    }
    const insertRows = getInsertRows(rows);
    const eventId = Number(insertRows[0]?.id || 0);
    let notificationStats = null;
    try {
      notificationStats = await notifyUsersForOfficialMatchEvent({
        eventId,
        matchId,
        eventType,
        payload: payloadObj || {},
      });
    } catch (notifyErr) {
      console.error('Official match event push error:', notifyErr?.message || notifyErr);
      notificationStats = {
        targeted_users: 0,
        reserved: 0,
        sent: 0,
        invalidated: 0,
        errors: 1,
        debug_error: String(notifyErr?.message || notifyErr || 'unknown_error'),
      };
    }
    return res.json({
      ok: true,
      id: eventId || null,
      notifications:
        notificationStats ||
        ({
          targeted_users: 0,
          reserved: 0,
          sent: 0,
          invalidated: 0,
          errors: 0,
          debug: { reason: 'notify_stats_missing' },
        }),
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore inserimento evento', error: err.message });
  }
});

// DELETE /admin/matches/:matchId
router.delete('/admin/matches/:matchId', authenticateToken, requireSuperuserLevels([1, 2]), async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    await query(`DELETE FROM official_match_events WHERE match_id = ?`, [matchId]);
    await query(`DELETE FROM official_matches WHERE id = ?`, [matchId]);
    return res.json({ ok: true });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore eliminazione partita', error: err.message });
  }
});

// Standings ties endpoints (placeholder compatibile UI)
router.get('/admin/matches/standings/ties', authenticateToken, requireSuperuserLevels([1]), async (_req, res) => {
  return res.json({ ties: [] });
});
router.post('/admin/matches/standings/ties/resolve', authenticateToken, requireSuperuserLevels([1]), async (_req, res) => {
  return res.json({ ok: true });
});

// Match details options: venues/referees/stages
router.get('/admin/match-details', authenticateToken, requireSuperuserLevels([1]), async (_req, res) => {
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
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'name mancante' });
    const rows = await query(`INSERT INTO official_match_venues (name) VALUES (?) RETURNING id`, [name]);
    return res.json({ ok: true, id: rows[0]?.id });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
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
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'name mancante' });
    const rows = await query(`INSERT INTO official_match_referees (name) VALUES (?) RETURNING id`, [name]);
    return res.json({ ok: true, id: rows[0]?.id });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
    return res.status(500).json({ message: 'Errore creazione referee', error: err.message });
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

    const rows = await query(
      `
      INSERT INTO official_match_stages
        (name, created_by, default_regulation_half_minutes, default_extra_time_enabled, default_extra_first_half_minutes, default_extra_second_half_minutes, default_penalties_enabled)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
      RETURNING id
      `,
      [name, userId, dHalf, dExtraEnabled, dExtra1, dExtra2, dPens]
    );
    return res.json({ ok: true, id: rows[0]?.id });
  } catch (err) {
    if (isMissingDbObjectError(err)) return matchesNotConfigured(res, err);
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

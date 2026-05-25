const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

let notificationsTablesReady = false;
async function ensureNotificationsTables() {
  if (notificationsTablesReady) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS user_push_tokens (
         id SERIAL PRIMARY KEY,
         user_id INTEGER NOT NULL,
         expo_push_token TEXT NOT NULL UNIQUE,
         platform TEXT NULL,
         is_active INTEGER NOT NULL DEFAULT 1,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );
    await query(
      `CREATE TABLE IF NOT EXISTS push_notification_sends (
         id SERIAL PRIMARY KEY,
         user_id INTEGER NOT NULL,
         league_id INTEGER NOT NULL,
         giornata INTEGER NULL,
         notification_type TEXT NOT NULL,
         dedupe_key TEXT NOT NULL UNIQUE,
         payload_json JSONB NULL,
         sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );
    try {
      await query(
        `ALTER TABLE user_push_tokens
         ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
         ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
         ALTER COLUMN last_seen_at TYPE TIMESTAMPTZ USING last_seen_at AT TIME ZONE 'UTC'`
      );
    } catch (_) {}
    try {
      await query(
        `ALTER TABLE push_notification_sends
         ALTER COLUMN sent_at TYPE TIMESTAMPTZ USING sent_at AT TIME ZONE 'UTC'`
      );
    } catch (_) {}
    notificationsTablesReady = true;
  } catch (_) {}
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function getCronSecretFromRequest(req) {
  const hdr = String(req.headers['x-cron-secret'] || '').trim();
  return hdr;
}

async function getActiveTokensByUserIds(userIds) {
  if (!Array.isArray(userIds) || userIds.length <= 0) return new Map();
  const uniqueIds = [...new Set(userIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))];
  if (uniqueIds.length <= 0) return new Map();
  const placeholders = uniqueIds.map(() => '?').join(',');
  const rows = await query(
    `SELECT user_id, expo_push_token
     FROM user_push_tokens
     WHERE is_active = 1
       AND user_id IN (${placeholders})`,
    uniqueIds
  );
  const map = new Map();
  for (const r of rows || []) {
    const uid = Number(r.user_id);
    const tok = String(r.expo_push_token || '').trim();
    if (!uid || !tok) continue;
    if (!map.has(uid)) map.set(uid, []);
    map.get(uid).push(tok);
  }
  return map;
}

async function markTokenInactive(token) {
  const tok = String(token || '').trim();
  if (!tok) return;
  try {
    await query(
      `UPDATE user_push_tokens
       SET is_active = 0, updated_at = NOW()
       WHERE expo_push_token = ?`,
      [tok]
    );
  } catch (_) {
    // no-op
  }
}

async function sendExpoMessages(messages) {
  if (!Array.isArray(messages) || messages.length <= 0) {
    return { sent: 0, invalidated: 0, errors: 0, deliveredDedupeKeys: [] };
  }
  let sent = 0;
  let invalidated = 0;
  let errors = 0;
  const deliveredDedupeKeys = new Set();
  const chunkSize = 100;
  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunk = messages.slice(i, i + chunkSize);
    const payloadChunk = chunk.map(({ _dedupe_key, ...payload }) => payload);
    try {
      const resp = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payloadChunk),
      });
      const data = await resp.json().catch(() => ({}));
      const results = Array.isArray(data?.data) ? data.data : [];
      for (let j = 0; j < chunk.length; j += 1) {
        const r = results[j] || {};
        const msg = chunk[j];
        if (r.status === 'ok') {
          sent += 1;
          const key = String(msg?._dedupe_key || '').trim();
          if (key) deliveredDedupeKeys.add(key);
          continue;
        }
        errors += 1;
        const expoErr = String(r?.details?.error || r?.message || '');
        if (/DeviceNotRegistered/i.test(expoErr)) {
          await markTokenInactive(msg?.to);
          invalidated += 1;
        }
      }
    } catch (_) {
      errors += chunk.length;
    }
  }
  return { sent, invalidated, errors, deliveredDedupeKeys: [...deliveredDedupeKeys] };
}

function buildDedupeKey({ userId, leagueId, giornata, type }) {
  return `${type}:${leagueId}:${giornata == null ? 'na' : giornata}:${userId}`;
}

async function reserveNotificationSend({ userId, leagueId, giornata, type, payloadJson }) {
  const dedupeKey = buildDedupeKey({ userId, leagueId, giornata, type });
  const result = await query(
    `INSERT INTO push_notification_sends
       (user_id, league_id, giornata, notification_type, dedupe_key, payload_json)
     VALUES (?, ?, ?, ?, ?, ?::jsonb)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [userId, leagueId, giornata ?? null, type, dedupeKey, JSON.stringify(payloadJson || {})]
  );
  // query() for INSERT returns { rows: [...] }, while SELECT returns array.
  const insertRows = Array.isArray(result) ? result : result?.rows;
  return !!(Array.isArray(insertRows) && insertRows[0] && insertRows[0].id);
}

async function releaseNotificationSendsByDedupeKeys(keys) {
  const list = [...new Set((keys || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (list.length <= 0) return 0;
  const placeholders = list.map(() => '?').join(',');
  try {
    await query(
      `DELETE FROM push_notification_sends
       WHERE dedupe_key IN (${placeholders})`,
      list
    );
    return list.length;
  } catch (_) {
    return 0;
  }
}

function lineupMemberKey(leagueId, userId, giornata) {
  return `${Number(leagueId)}:${Number(userId)}:${Number(giornata)}`;
}

function calculatedCandidateKey(leagueId, giornata) {
  return `${Number(leagueId)}:${Number(giornata)}`;
}

async function batchReserveNotificationSends(entries, chunkSize = 200) {
  const reservedKeys = new Set();
  if (!Array.isArray(entries) || entries.length <= 0) return reservedKeys;

  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize);
    const valuePlaceholders = [];
    const params = [];
    for (const entry of chunk) {
      const userId = Number(entry.userId);
      const leagueId = Number(entry.leagueId);
      const giornata = entry.giornata == null ? null : Number(entry.giornata);
      const type = String(entry.type || '').trim();
      if (!userId || !leagueId || !type) continue;
      valuePlaceholders.push('(?, ?, ?, ?, ?, ?::jsonb)');
      params.push(
        userId,
        leagueId,
        Number.isFinite(giornata) ? giornata : null,
        type,
        buildDedupeKey({ userId, leagueId, giornata, type }),
        JSON.stringify(entry.payloadJson || {})
      );
    }
    if (valuePlaceholders.length <= 0) continue;

    const result = await query(
      `INSERT INTO push_notification_sends
         (user_id, league_id, giornata, notification_type, dedupe_key, payload_json)
       VALUES ${valuePlaceholders.join(', ')}
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING dedupe_key`,
      params
    );
    const insertRows = Array.isArray(result) ? result : result?.rows;
    for (const row of insertRows || []) {
      const key = String(row?.dedupe_key || '').trim();
      if (key) reservedKeys.add(key);
    }
  }
  return reservedKeys;
}

async function loadSubmittedLineupKeySet(entries, chunkSize = 400) {
  const keys = new Set();
  if (!Array.isArray(entries) || entries.length <= 0) return keys;

  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize);
    const tuplePlaceholders = chunk.map(() => '(?, ?, ?)').join(', ');
    const params = [];
    for (const entry of chunk) {
      params.push(Number(entry.leagueId), Number(entry.userId), Number(entry.giornata));
    }
    const rows = await query(
      `SELECT league_id, user_id, giornata
       FROM user_lineups
       WHERE (league_id, user_id, giornata) IN (${tuplePlaceholders})`,
      params
    );
    for (const row of rows || []) {
      keys.add(lineupMemberKey(row.league_id, row.user_id, row.giornata));
    }
  }
  return keys;
}

async function loadFormationReminderMemberRows() {
  return await query(
    `WITH near_matchday AS (
       SELECT DISTINCT ON (md.league_id) md.league_id, md.giornata
       FROM matchdays md
       WHERE (md.deadline AT TIME ZONE 'Europe/Rome') > (NOW() AT TIME ZONE 'Europe/Rome')
         AND ((md.deadline AT TIME ZONE 'Europe/Rome') - INTERVAL '60 minutes') <= (NOW() AT TIME ZONE 'Europe/Rome')
       ORDER BY md.league_id, md.deadline ASC
     )
     SELECT l.id AS league_id, l.name AS league_name, lm.user_id, nm.giornata,
            COALESCE(ulp.notifications_enabled, 1) AS notifications_enabled
     FROM leagues l
     JOIN league_members lm ON lm.league_id = l.id
     JOIN near_matchday nm ON nm.league_id = COALESCE(NULLIF(l.linked_to_league_id, 0), l.id)
     LEFT JOIN user_league_prefs ulp ON ulp.user_id = lm.user_id AND ulp.league_id = l.id
     WHERE COALESCE(l.auto_lineup_mode, 0) = 0`
  );
}

async function buildCalculatedSuppressionKeySet(candidates) {
  const suppressed = new Set();
  if (!Array.isArray(candidates) || candidates.length <= 0) return suppressed;

  const nowYear = await getCurrentCalendarYearItaly();
  const leagueIds = [...new Set(candidates.map((c) => Number(c.league_id)).filter((x) => x > 0))];
  if (leagueIds.length <= 0) return suppressed;

  const leaguePlaceholders = leagueIds.map(() => '?').join(',');
  const leagueRows = await query(
    `SELECT id, linked_to_league_id, reference_year
     FROM leagues
     WHERE id IN (${leaguePlaceholders})`,
    leagueIds
  );
  const effectiveByLeague = new Map();
  const refYearByLeague = new Map();
  for (const row of leagueRows || []) {
    const leagueId = Number(row.id);
    const linked = Number(row.linked_to_league_id || 0);
    const effectiveLeagueId = linked > 0 ? linked : leagueId;
    effectiveByLeague.set(leagueId, effectiveLeagueId);
    const refYear = Number(row.reference_year);
    if (Number.isFinite(refYear)) refYearByLeague.set(leagueId, refYear);
  }

  const deadlinePairs = new Map();
  for (const candidate of candidates) {
    const leagueId = Number(candidate.league_id);
    const giornata = Number(candidate.giornata);
    if (!leagueId || !giornata) continue;
    const effectiveLeagueId = effectiveByLeague.get(leagueId) || leagueId;
    deadlinePairs.set(`${effectiveLeagueId}:${giornata}`, { effectiveLeagueId, giornata });
  }
  const uniquePairs = [...deadlinePairs.values()];
  if (uniquePairs.length <= 0) return suppressed;

  const pairPlaceholders = uniquePairs.map(() => '(?, ?)').join(', ');
  const pairParams = [];
  for (const pair of uniquePairs) {
    pairParams.push(pair.effectiveLeagueId, pair.giornata);
  }
  const deadlineRows = await query(
    `SELECT league_id, giornata,
            EXTRACT(YEAR FROM (deadline AT TIME ZONE 'Europe/Rome'))::int AS deadline_year
     FROM matchdays
     WHERE (league_id, giornata) IN (${pairPlaceholders})`,
    pairParams
  );
  const deadlineYearByPair = new Map();
  for (const row of deadlineRows || []) {
    deadlineYearByPair.set(
      `${Number(row.league_id)}:${Number(row.giornata)}`,
      Number(row.deadline_year)
    );
  }

  for (const candidate of candidates) {
    const leagueId = Number(candidate.league_id);
    const giornata = Number(candidate.giornata);
    if (!leagueId || !giornata) continue;
    const effectiveLeagueId = effectiveByLeague.get(leagueId) || leagueId;
    const deadlineYear = deadlineYearByPair.get(`${effectiveLeagueId}:${giornata}`);
    if (Number.isFinite(deadlineYear) && deadlineYear < nowYear) {
      suppressed.add(calculatedCandidateKey(leagueId, giornata));
      continue;
    }
    if (!Number.isFinite(deadlineYear)) {
      const refYear = refYearByLeague.get(leagueId);
      if (Number.isFinite(refYear) && refYear < nowYear) {
        suppressed.add(calculatedCandidateKey(leagueId, giornata));
      }
    }
  }
  return suppressed;
}

async function buildCalculatedMatchdayCandidateRows() {
  // Limit a finestra recente per evitare flood al primo run.
  return await query(
    `SELECT mr.league_id, mr.giornata,
            MAX(
              COALESCE(
                NULLIF(to_jsonb(mr)->>'created_at', '')::timestamptz,
                NULLIF(to_jsonb(mr)->>'calculated_at', '')::timestamptz,
                NOW()
              )
            ) AS calculated_at,
            MAX(l.name) AS league_name
     FROM matchday_results mr
     JOIN leagues l ON l.id = mr.league_id
     GROUP BY mr.league_id, mr.giornata
     HAVING MAX(
       COALESCE(
         NULLIF(to_jsonb(mr)->>'created_at', '')::timestamptz,
         NULLIF(to_jsonb(mr)->>'calculated_at', '')::timestamptz,
         NOW()
       )
     ) >= NOW() - INTERVAL '24 hours'`
  );
}

async function sendCalculatedMatchdayNotifications() {
  const candidates = await buildCalculatedMatchdayCandidateRows();
  if (!Array.isArray(candidates) || candidates.length <= 0) {
    return {
      candidates: 0,
      reserved: 0,
      skipped_no_token: 0,
      skipped_past_calendar_year: 0,
      released_failed_reservations: 0,
      sent: 0,
      invalidated: 0,
      errors: 0,
    };
  }

  const candidateLeagueIds = [...new Set(candidates.map((c) => Number(c.league_id)).filter((x) => x > 0))];
  const suppressedKeys = await buildCalculatedSuppressionKeySet(candidates);
  const leaguePlaceholders = candidateLeagueIds.map(() => '?').join(',');
  const memberRows = await query(
    `SELECT lm.user_id, lm.league_id, COALESCE(ulp.notifications_enabled, 1) AS notifications_enabled
     FROM league_members lm
     LEFT JOIN user_league_prefs ulp ON ulp.user_id = lm.user_id AND ulp.league_id = lm.league_id
     WHERE lm.league_id IN (${leaguePlaceholders})`,
    candidateLeagueIds
  );

  const membersByLeague = new Map();
  for (const m of memberRows || []) {
    const lid = Number(m.league_id);
    const uid = Number(m.user_id);
    const enabled = Number(m.notifications_enabled === 0 ? 0 : 1);
    if (!lid || !uid || enabled !== 1) continue;
    if (!membersByLeague.has(lid)) membersByLeague.set(lid, []);
    membersByLeague.get(lid).push(uid);
  }

  const distinctUsers = [...new Set((memberRows || []).map((x) => Number(x.user_id)).filter((x) => x > 0))];
  const tokensByUser = await getActiveTokensByUserIds(distinctUsers);
  const reserveEntries = [];
  const pendingMessages = [];
  let skippedNoToken = 0;
  let skippedPastCalendarYear = 0;

  for (const c of candidates) {
    const leagueId = Number(c.league_id);
    const giornata = Number(c.giornata);
    if (!leagueId || !giornata) continue;
    if (suppressedKeys.has(calculatedCandidateKey(leagueId, giornata))) {
      skippedPastCalendarYear += 1;
      continue;
    }
    const userIds = membersByLeague.get(leagueId) || [];
    for (const userId of userIds) {
      const tokens = tokensByUser.get(userId) || [];
      if (tokens.length <= 0) {
        skippedNoToken += 1;
        continue;
      }
      const dedupeKey = buildDedupeKey({ userId, leagueId, giornata, type: 'matchday_calculated' });
      reserveEntries.push({
        userId,
        leagueId,
        giornata,
        type: 'matchday_calculated',
        payloadJson: { league_id: leagueId, giornata },
      });
      pendingMessages.push({
        dedupeKey,
        tokens,
        title: 'Giornata calcolata',
        body: `${c.league_name || 'Lega'}: calcolata la ${giornata}a giornata.`,
        data: { type: 'matchday_calculated', league_id: leagueId, giornata },
      });
    }
  }

  const reservedDedupeKeys = await batchReserveNotificationSends(reserveEntries);
  const messages = [];
  for (const pending of pendingMessages) {
    if (!reservedDedupeKeys.has(pending.dedupeKey)) continue;
    for (const token of pending.tokens) {
      messages.push({
        to: token,
        _dedupe_key: pending.dedupeKey,
        sound: 'default',
        title: pending.title,
        body: pending.body,
        data: pending.data,
      });
    }
  }

  const pushStats = await sendExpoMessages(messages);
  const delivered = new Set((pushStats.deliveredDedupeKeys || []).map((x) => String(x || '').trim()).filter(Boolean));
  const failedReserved = [...reservedDedupeKeys].filter((k) => !delivered.has(k));
  const releasedFailedReservations = await releaseNotificationSendsByDedupeKeys(failedReserved);
  return {
    candidates: candidates.length,
    reserved: reservedDedupeKeys.size,
    skipped_no_token: skippedNoToken,
    skipped_past_calendar_year: skippedPastCalendarYear,
    released_failed_reservations: releasedFailedReservations,
    sent: pushStats.sent,
    invalidated: pushStats.invalidated,
    errors: pushStats.errors,
  };
}

async function sendFormationDeadlineReminders() {
  // - reminder "dovuto" quando deadline-60m <= NOW()
  // - non inviare storico (deadline deve essere ancora futura)
  // - dedupe DB: una sola notifica per user/lega/giornata
  const memberRows = await loadFormationReminderMemberRows();
  if (!Array.isArray(memberRows) || memberRows.length <= 0) {
    return {
      scanned: 0,
      candidates: 0,
      reserved: 0,
      skipped_no_token: 0,
      skipped_no_due_deadline: 0,
      skipped_lineup_already_submitted: 0,
      skipped_notifications_disabled: 0,
      sent: 0,
      invalidated: 0,
      errors: 0,
    };
  }

  let candidates = 0;
  let skippedNoToken = 0;
  let skippedNotificationsDisabled = 0;
  const eligibleRows = [];

  for (const row of memberRows) {
    const leagueId = Number(row.league_id);
    const userId = Number(row.user_id);
    const giornata = Number(row.giornata);
    const notificationsEnabled = Number(row.notifications_enabled === 0 ? 0 : 1);
    if (!leagueId || !userId || !giornata) continue;
    if (notificationsEnabled !== 1) {
      skippedNotificationsDisabled += 1;
      continue;
    }
    candidates += 1;
    eligibleRows.push({ leagueId, userId, giornata, leagueName: row.league_name });
  }

  const distinctUsers = [...new Set(eligibleRows.map((x) => x.userId).filter((x) => x > 0))];
  const tokensByUser = await getActiveTokensByUserIds(distinctUsers);
  const submittedLineups = await loadSubmittedLineupKeySet(eligibleRows);

  const reserveEntries = [];
  const pendingMessages = [];
  let skippedLineupAlreadySubmitted = 0;

  for (const row of eligibleRows) {
    const memberKey = lineupMemberKey(row.leagueId, row.userId, row.giornata);
    if (submittedLineups.has(memberKey)) {
      skippedLineupAlreadySubmitted += 1;
      continue;
    }
    const tokens = tokensByUser.get(row.userId) || [];
    if (tokens.length <= 0) {
      skippedNoToken += 1;
      continue;
    }
    const dedupeKey = buildDedupeKey({
      userId: row.userId,
      leagueId: row.leagueId,
      giornata: row.giornata,
      type: 'formation_deadline_1h',
    });
    reserveEntries.push({
      userId: row.userId,
      leagueId: row.leagueId,
      giornata: row.giornata,
      type: 'formation_deadline_1h',
      payloadJson: { league_id: row.leagueId, giornata: row.giornata },
    });
    pendingMessages.push({
      dedupeKey,
      tokens,
      leagueName: row.leagueName,
      leagueId: row.leagueId,
      giornata: row.giornata,
    });
  }

  const reservedDedupeKeys = await batchReserveNotificationSends(reserveEntries);
  const messages = [];
  for (const pending of pendingMessages) {
    if (!reservedDedupeKeys.has(pending.dedupeKey)) continue;
    for (const token of pending.tokens) {
      messages.push({
        to: token,
        _dedupe_key: pending.dedupeKey,
        sound: 'default',
        title: 'Promemoria formazione',
        body: `${pending.leagueName || 'Lega'}: manca circa 1 ora alla scadenza della ${pending.giornata}a giornata.`,
        data: {
          type: 'formation_deadline',
          league_id: pending.leagueId,
          giornata: pending.giornata,
        },
      });
    }
  }

  const pushStats = await sendExpoMessages(messages);
  const delivered = new Set((pushStats.deliveredDedupeKeys || []).map((x) => String(x || '').trim()).filter(Boolean));
  const failedReserved = [...reservedDedupeKeys].filter((k) => !delivered.has(k));
  const releasedFailedReservations = await releaseNotificationSendsByDedupeKeys(failedReserved);
  return {
    scanned: memberRows.length,
    candidates,
    reserved: reservedDedupeKeys.size,
    skipped_no_token: skippedNoToken,
    skipped_no_due_deadline: 0,
    skipped_lineup_already_submitted: skippedLineupAlreadySubmitted,
    skipped_notifications_disabled: skippedNotificationsDisabled,
    released_failed_reservations: releasedFailedReservations,
    sent: pushStats.sent,
    invalidated: pushStats.invalidated,
    errors: pushStats.errors,
  };
}

async function runNotificationsCronJob() {
  const startedAt = Date.now();
  await ensureNotificationsTables();
  const reminderStats = await sendFormationDeadlineReminders();
  const calcStats = await sendCalculatedMatchdayNotifications();
  return {
    duration_ms: Date.now() - startedAt,
    calculated: calcStats,
    formation_reminders: reminderStats,
  };
}

async function getEffectiveLeagueIdForNotifications(leagueId) {
  try {
    const rows = await query(
      `SELECT linked_to_league_id FROM leagues WHERE id = ? LIMIT 1`,
      [leagueId]
    );
    const linked = Number(rows[0]?.linked_to_league_id || 0);
    return linked > 0 ? linked : Number(leagueId);
  } catch (_) {
    return Number(leagueId);
  }
}

/** Anno solare (Europe/Rome) della deadline della giornata in matchdays; null se manca la riga. */
async function getMatchdayDeadlineCalendarYear(leagueId, giornata) {
  const g = Number(giornata);
  const lid = Number(leagueId);
  if (!lid || !Number.isFinite(g)) return null;
  try {
    const effectiveId = await getEffectiveLeagueIdForNotifications(lid);
    const mdRows = await query(
      `SELECT EXTRACT(YEAR FROM (deadline AT TIME ZONE 'Europe/Rome'))::int AS y
       FROM matchdays
       WHERE league_id = ? AND giornata = ?
       LIMIT 1`,
      [effectiveId, g]
    );
    const y = Number(mdRows[0]?.y);
    return Number.isFinite(y) ? y : null;
  } catch (_) {
    return null;
  }
}

async function getCurrentCalendarYearItaly() {
  try {
    const rows = await query(
      `SELECT EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Europe/Rome'))::int AS y`
    );
    const y = Number(rows[0]?.y);
    return Number.isFinite(y) ? y : new Date().getFullYear();
  } catch (_) {
    return new Date().getFullYear();
  }
}

/**
 * Non inviare push "giornata calcolata" per giornate di anno solare già passato rispetto ad oggi (Europe/Rome),
 * tipico quando l'admin ricalcola/corregge stagioni vecchie.
 */
async function shouldSuppressMatchdayCalculatedPush(leagueId, giornata) {
  const deadlineYear = await getMatchdayDeadlineCalendarYear(leagueId, giornata);
  const nowYear = await getCurrentCalendarYearItaly();
  if (deadlineYear != null && deadlineYear < nowYear) return true;
  if (deadlineYear == null) {
    try {
      const refRows = await query(
        `SELECT reference_year FROM leagues WHERE id = ? LIMIT 1`,
        [Number(leagueId)]
      );
      const ry = Number(refRows[0]?.reference_year);
      if (Number.isFinite(ry) && ry < nowYear) return true;
    } catch (_) {
      /* ignore */
    }
  }
  return false;
}

async function triggerCalculatedNotificationForLeagueMatchday(leagueId, giornata) {
  const lid = Number(leagueId);
  const g = Number(giornata);
  if (!lid || !g) {
    return { candidates: 0, reserved: 0, sent: 0, invalidated: 0, errors: 0 };
  }
  if (await shouldSuppressMatchdayCalculatedPush(lid, g)) {
    return {
      candidates: 0,
      reserved: 0,
      skipped_no_token: 0,
      skipped_past_calendar_year: 1,
      released_failed_reservations: 0,
      sent: 0,
      invalidated: 0,
      errors: 0,
    };
  }
  await ensureNotificationsTables();
  const leagueRows = await query(
    `SELECT id AS league_id, name AS league_name
     FROM leagues
     WHERE id = ?
     LIMIT 1`,
    [lid]
  );
  if (!Array.isArray(leagueRows) || !leagueRows[0]) {
    return { candidates: 0, reserved: 0, sent: 0, invalidated: 0, errors: 0 };
  }
  const allMembers = await query(
    `SELECT lm.user_id, lm.league_id, COALESCE(ulp.notifications_enabled, 1) AS notifications_enabled
     FROM league_members lm
     LEFT JOIN user_league_prefs ulp ON ulp.user_id = lm.user_id AND ulp.league_id = lm.league_id
     WHERE lm.league_id = ?`,
    [lid]
  );
  const userIds = (allMembers || [])
    .filter((m) => Number(m.notifications_enabled === 0 ? 0 : 1) === 1)
    .map((m) => Number(m.user_id))
    .filter((x) => x > 0);
  const tokensByUser = await getActiveTokensByUserIds(userIds);
  const messages = [];
  let reserved = 0;
  let skippedNoToken = 0;
  const reservedDedupeKeys = new Set();
  for (const userId of userIds) {
    const tokens = tokensByUser.get(userId) || [];
    if (tokens.length <= 0) {
      skippedNoToken += 1;
      continue;
    }
    const reservedOk = await reserveNotificationSend({
      userId,
      leagueId: lid,
      giornata: g,
      type: 'matchday_calculated',
      payloadJson: { league_id: lid, giornata: g },
    });
    if (!reservedOk) continue;
    reserved += 1;
    const dedupeKey = buildDedupeKey({ userId, leagueId: lid, giornata: g, type: 'matchday_calculated' });
    reservedDedupeKeys.add(dedupeKey);
    for (const token of tokens) {
      messages.push({
        to: token,
        _dedupe_key: dedupeKey,
        sound: 'default',
        title: 'Giornata calcolata',
        body: `${leagueRows[0].league_name || 'Lega'}: calcolata la ${g}a giornata.`,
        data: { type: 'matchday_calculated', league_id: lid, giornata: g },
      });
    }
  }
  const pushStats = await sendExpoMessages(messages);
  const delivered = new Set((pushStats.deliveredDedupeKeys || []).map((x) => String(x || '').trim()).filter(Boolean));
  const failedReserved = [...reservedDedupeKeys].filter((k) => !delivered.has(k));
  const releasedFailedReservations = await releaseNotificationSendsByDedupeKeys(failedReserved);
  return {
    candidates: 1,
    reserved,
    skipped_no_token: skippedNoToken,
    skipped_past_calendar_year: 0,
    released_failed_reservations: releasedFailedReservations,
    sent: pushStats.sent,
    invalidated: pushStats.invalidated,
    errors: pushStats.errors,
  };
}

router.post('/register-token', authenticateToken, async (req, res) => {
  try {
    await ensureNotificationsTables();
    const userId = Number(req.user?.userId);
    const expoToken = String(req.body?.token || '').trim();
    const platform = String(req.body?.platform || '').trim() || null;

    const validPrefix = expoToken.startsWith('ExponentPushToken') || expoToken.startsWith('ExpoPushToken');
    if (!expoToken || !validPrefix) {
      return res.status(400).json({ message: 'Token push non valido' });
    }

    await query(
      `INSERT INTO user_push_tokens (user_id, expo_push_token, platform, is_active, updated_at, last_seen_at)
       VALUES (?, ?, ?, 1, NOW(), NOW())
       ON CONFLICT (expo_push_token)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         platform = EXCLUDED.platform,
         is_active = 1,
         updated_at = NOW(),
         last_seen_at = NOW()`,
      [userId, expoToken, platform]
    );

    return res.json({ message: 'Token push registrato' });
  } catch (error) {
    return res.status(500).json({ message: 'Errore registrazione token push', error: error.message });
  }
});

router.post('/run-cron', async (req, res) => {
  try {
    const expectedSecret = String(process.env.CRON_SECRET || '').trim();
    if (!expectedSecret) {
      return res.status(500).json({ message: 'CRON_SECRET non configurato sul backend' });
    }
    const provided = getCronSecretFromRequest(req);
    if (!provided || provided !== expectedSecret) {
      return res.status(401).json({ message: 'Unauthorized cron trigger' });
    }
    const startedAt = Date.now();
    const stats = await runNotificationsCronJob();
    return res.json({ ok: true, duration_ms: Date.now() - startedAt, stats });
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'Errore esecuzione cron notifiche', error: error.message });
  }
});

module.exports = router;
module.exports.runNotificationsCronJob = runNotificationsCronJob;
module.exports.triggerCalculatedNotificationForLeagueMatchday = triggerCalculatedNotificationForLeagueMatchday;

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
  const rows = await query(
    `INSERT INTO push_notification_sends
       (user_id, league_id, giornata, notification_type, dedupe_key, payload_json)
     VALUES (?, ?, ?, ?, ?, ?::jsonb)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [userId, leagueId, giornata ?? null, type, dedupeKey, JSON.stringify(payloadJson || {})]
  );
  return !!(Array.isArray(rows) && rows[0] && rows[0].id);
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
      released_failed_reservations: 0,
      sent: 0,
      invalidated: 0,
      errors: 0,
      debug: { reason: 'no_recent_calculated_matchdays_last_24h' },
    };
  }
  const allMembers = await query(
    `SELECT lm.user_id, lm.league_id, COALESCE(ulp.notifications_enabled, 1) AS notifications_enabled
     FROM league_members lm
     LEFT JOIN user_league_prefs ulp ON ulp.user_id = lm.user_id AND ulp.league_id = lm.league_id`
  );
  const membersByLeague = new Map();
  for (const m of allMembers || []) {
    const lid = Number(m.league_id);
    const uid = Number(m.user_id);
    const enabled = Number(m.notifications_enabled === 0 ? 0 : 1);
    if (!lid || !uid || enabled !== 1) continue;
    if (!membersByLeague.has(lid)) membersByLeague.set(lid, []);
    membersByLeague.get(lid).push(uid);
  }

  const distinctUsers = [...new Set((allMembers || []).map((x) => Number(x.user_id)).filter((x) => x > 0))];
  const tokensByUser = await getActiveTokensByUserIds(distinctUsers);
  const messages = [];
  let reserved = 0;
  let skippedNoToken = 0;
  const reservedDedupeKeys = new Set();

  for (const c of candidates) {
    const leagueId = Number(c.league_id);
    const giornata = Number(c.giornata);
    if (!leagueId || !giornata) continue;
    const userIds = membersByLeague.get(leagueId) || [];
    for (const userId of userIds) {
      const tokens = tokensByUser.get(userId) || [];
      if (tokens.length <= 0) {
        skippedNoToken += 1;
        continue;
      }
      const reservedOk = await reserveNotificationSend({
        userId,
        leagueId,
        giornata,
        type: 'matchday_calculated',
        payloadJson: { league_id: leagueId, giornata },
      });
      if (!reservedOk) continue;
      reserved += 1;
      const dedupeKey = buildDedupeKey({ userId, leagueId, giornata, type: 'matchday_calculated' });
      reservedDedupeKeys.add(dedupeKey);
      for (const token of tokens) {
        messages.push({
          to: token,
          _dedupe_key: dedupeKey,
          sound: 'default',
          title: 'Giornata calcolata',
          body: `${c.league_name || 'Lega'}: calcolata la ${giornata}a giornata.`,
          data: {
            type: 'matchday_calculated',
            league_id: leagueId,
            giornata,
          },
        });
      }
    }
  }

  const pushStats = await sendExpoMessages(messages);
  const delivered = new Set((pushStats.deliveredDedupeKeys || []).map((x) => String(x || '').trim()).filter(Boolean));
  const failedReserved = [...reservedDedupeKeys].filter((k) => !delivered.has(k));
  const releasedFailedReservations = await releaseNotificationSendsByDedupeKeys(failedReserved);
  return {
    candidates: candidates.length,
    reserved,
    skipped_no_token: skippedNoToken,
    released_failed_reservations: releasedFailedReservations,
    sent: pushStats.sent,
    invalidated: pushStats.invalidated,
    errors: pushStats.errors,
    debug: {
      recent_window_hours: 24,
      leagues_with_candidates: candidates.length,
    },
  };
}

async function sendFormationDeadlineReminders() {
  // Logica allineata alla vecchia api.php:
  // - reminder "dovuto" quando deadline-60m <= NOW()
  // - non inviare storico (deadline deve essere ancora futura)
  // - dedupe DB: una sola notifica per user/lega/giornata
  const leagueRows = await query(
    `SELECT l.id AS league_id, l.name AS league_name, COALESCE(l.auto_lineup_mode, 0) AS auto_lineup_mode,
            l.linked_to_league_id, lm.user_id, COALESCE(ulp.notifications_enabled, 1) AS notifications_enabled
     FROM leagues l
     JOIN league_members lm ON lm.league_id = l.id
     LEFT JOIN user_league_prefs ulp ON ulp.user_id = lm.user_id AND ulp.league_id = l.id
     WHERE COALESCE(l.auto_lineup_mode, 0) = 0`
  );
  if (!Array.isArray(leagueRows) || leagueRows.length <= 0) {
    return { scanned: 0, candidates: 0, reserved: 0, sent: 0, invalidated: 0, errors: 0 };
  }
  const distinctUsers = [...new Set(leagueRows.map((x) => Number(x.user_id)).filter((x) => x > 0))];
  const tokensByUser = await getActiveTokensByUserIds(distinctUsers);
  const messages = [];
  let candidates = 0;
  let reserved = 0;
  let skippedNoToken = 0;
  let skippedNoDueDeadline = 0;
  let skippedLineupAlreadySubmitted = 0;
  let skippedNotificationsDisabled = 0;
  const reservedDedupeKeys = new Set();

  for (const row of leagueRows) {
    const leagueId = Number(row.league_id);
    const userId = Number(row.user_id);
    const notificationsEnabled = Number(row.notifications_enabled === 0 ? 0 : 1);
    if (!leagueId || !userId) continue;
    if (notificationsEnabled !== 1) {
      skippedNotificationsDisabled += 1;
      continue;
    }
    const effectiveLeagueId = Number(row.linked_to_league_id || 0) > 0 ? Number(row.linked_to_league_id) : leagueId;
    const nearRows = await query(
      `SELECT giornata, deadline
       FROM matchdays
       WHERE league_id = ?
         AND (deadline AT TIME ZONE 'Europe/Rome') > (NOW() AT TIME ZONE 'Europe/Rome')
         AND ((deadline AT TIME ZONE 'Europe/Rome') - INTERVAL '60 minutes') <= (NOW() AT TIME ZONE 'Europe/Rome')
       ORDER BY deadline ASC
       LIMIT 1`,
      [effectiveLeagueId]
    );
    const target = nearRows[0];
    if (!target) {
      skippedNoDueDeadline += 1;
      continue;
    }
    const giornata = Number(target.giornata);
    if (!giornata) continue;
    candidates += 1;
    const tokens = tokensByUser.get(userId) || [];
    if (tokens.length <= 0) {
      skippedNoToken += 1;
      continue;
    }
    const lineupRows = await query(
      `SELECT 1
       FROM user_lineups
       WHERE league_id = ? AND user_id = ? AND giornata = ?
       LIMIT 1`,
      [leagueId, userId, giornata]
    );
    if (Array.isArray(lineupRows) && lineupRows.length > 0) {
      skippedLineupAlreadySubmitted += 1;
      continue;
    }
    const reservedOk = await reserveNotificationSend({
      userId,
      leagueId,
      giornata,
      type: 'formation_deadline_1h',
      payloadJson: { league_id: leagueId, giornata },
    });
    if (!reservedOk) continue;
    reserved += 1;
    const dedupeKey = buildDedupeKey({ userId, leagueId, giornata, type: 'formation_deadline_1h' });
    reservedDedupeKeys.add(dedupeKey);
    for (const token of tokens) {
      messages.push({
        to: token,
        _dedupe_key: dedupeKey,
        sound: 'default',
        title: 'Promemoria formazione',
        body: `${row.league_name || 'Lega'}: manca circa 1 ora alla scadenza della ${giornata}a giornata.`,
        data: {
          type: 'formation_deadline',
          league_id: leagueId,
          giornata,
        },
      });
    }
  }

  const pushStats = await sendExpoMessages(messages);
  const delivered = new Set((pushStats.deliveredDedupeKeys || []).map((x) => String(x || '').trim()).filter(Boolean));
  const failedReserved = [...reservedDedupeKeys].filter((k) => !delivered.has(k));
  const releasedFailedReservations = await releaseNotificationSendsByDedupeKeys(failedReserved);
  return {
    scanned: leagueRows.length,
    candidates,
    reserved,
    skipped_no_token: skippedNoToken,
    skipped_no_due_deadline: skippedNoDueDeadline,
    skipped_lineup_already_submitted: skippedLineupAlreadySubmitted,
    skipped_notifications_disabled: skippedNotificationsDisabled,
    released_failed_reservations: releasedFailedReservations,
    sent: pushStats.sent,
    invalidated: pushStats.invalidated,
    errors: pushStats.errors,
  };
}

async function runNotificationsCronJob() {
  await ensureNotificationsTables();
  const [calcStats, reminderStats] = await Promise.all([
    sendCalculatedMatchdayNotifications(),
    sendFormationDeadlineReminders(),
  ]);
  return { calculated: calcStats, formation_reminders: reminderStats };
}

async function triggerCalculatedNotificationForLeagueMatchday(leagueId, giornata) {
  const lid = Number(leagueId);
  const g = Number(giornata);
  if (!lid || !g) {
    return { candidates: 0, reserved: 0, sent: 0, invalidated: 0, errors: 0, debug: { reason: 'invalid_params' } };
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
    return { candidates: 0, reserved: 0, sent: 0, invalidated: 0, errors: 0, debug: { reason: 'league_not_found' } };
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
    released_failed_reservations: releasedFailedReservations,
    sent: pushStats.sent,
    invalidated: pushStats.invalidated,
    errors: pushStats.errors,
    debug: { mode: 'immediate_after_calculation', league_id: lid, giornata: g },
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
    console.error('Register push token error:', error);
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
    const stats = await runNotificationsCronJob();
    return res.json({ ok: true, stats });
  } catch (error) {
    console.error('Notifications cron run error:', error);
    return res.status(500).json({ ok: false, message: 'Errore esecuzione cron notifiche', error: error.message });
  }
});

module.exports = router;
module.exports.runNotificationsCronJob = runNotificationsCronJob;
module.exports.triggerCalculatedNotificationForLeagueMatchday = triggerCalculatedNotificationForLeagueMatchday;

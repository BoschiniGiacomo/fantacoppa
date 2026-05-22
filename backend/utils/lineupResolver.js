const { query } = require('../config/database');
const { AUTO_MODULES } = require('./autoLineup');

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

async function buildFallbackLineupFromRoster(leagueId, userId, numeroTitolari) {
  const rows = await query(
    `SELECT p.id, p.role
     FROM user_players up
     JOIN players p ON p.id = up.player_id
     WHERE up.league_id = ? AND up.user_id = ?
       AND COALESCE(p.is_injured, 0) = 0
     ORDER BY p.id ASC`,
    [leagueId, userId]
  );
  if (!rows.length) return null;

  const byRole = { P: [], D: [], C: [], A: [] };
  rows.forEach((r) => {
    const role = String(r.role || '').trim();
    if (Object.prototype.hasOwnProperty.call(byRole, role)) {
      byRole[role].push(Number(r.id));
    }
  });
  if (!byRole.P.length) return null;

  const n = Math.max(0, Number(numeroTitolari || 11));
  if (n <= 0) return null;
  const movSlots = Math.max(0, n - 1);

  const moduleEntries = Object.entries(AUTO_MODULES)
    .map(([modulo, arr]) => ({ modulo, d: Number(arr[0] || 0), c: Number(arr[1] || 0), a: Number(arr[2] || 0) }))
    .filter((m) => (m.d + m.c + m.a) === movSlots)
    .sort((a, b) => {
      if (a.d !== b.d) return b.d - a.d;
      if (a.c !== b.c) return b.c - a.c;
      return b.a - a.a;
    });

  const chosenModule = moduleEntries.find((m) =>
    byRole.D.length >= m.d && byRole.C.length >= m.c && byRole.A.length >= m.a
  );
  if (!chosenModule) return null;

  const used = new Set();
  const pick = (role, count) => {
    const out = [];
    for (const pid of byRole[role]) {
      if (used.has(pid)) continue;
      out.push(pid);
      used.add(pid);
      if (out.length >= count) break;
    }
    return out;
  };

  const titolari = [
    ...pick('P', 1),
    ...pick('D', chosenModule.d),
    ...pick('C', chosenModule.c),
    ...pick('A', chosenModule.a),
  ].slice(0, n);

  const panchina = rows
    .map((r) => Number(r.id))
    .filter((pid) => Number.isFinite(pid) && pid > 0 && !used.has(pid));

  return {
    modulo: chosenModule.modulo,
    titolari,
    panchina,
  };
}

/**
 * Risolve modulo + titolari + panchina: giornata corrente → G-1 → G-2 → … → fallback rosa.
 */
async function resolveUserLineup(leagueId, userId, giornata, numeroTitolari, options = {}) {
  const recoverPrevious = options.recoverPrevious !== false;
  const injuryMap = options.injuryMap || {};
  const applyInjury = typeof options.applyInjury === 'function'
    ? options.applyInjury
    : (ids) => (Array.isArray(ids) ? ids : []);

  const n = Math.max(1, Number(numeroTitolari || 10));
  const lineRows = await query(
    `SELECT modulo, titolari, panchina
     FROM user_lineups
     WHERE user_id = ? AND league_id = ? AND giornata = ?
     LIMIT 1`,
    [userId, leagueId, giornata]
  );

  let titolari = applyInjury(parseIdsArray(lineRows[0]?.titolari), injuryMap).slice(0, n);
  let panchina = applyInjury(parseIdsArray(lineRows[0]?.panchina), injuryMap);
  let modulo = String(lineRows[0]?.modulo || '').trim();
  let formationRecovered = false;
  let formationRecoveryKind = null;

  if (titolari.length > 0) {
    return { modulo, titolari, panchina, formationRecovered, formationRecoveryKind };
  }

  if (recoverPrevious) {
    const prevRows = await query(
      `SELECT giornata, modulo, titolari, panchina
       FROM user_lineups
       WHERE user_id = ? AND league_id = ? AND giornata < ?
       ORDER BY giornata DESC`,
      [userId, leagueId, giornata]
    );
    for (const row of prevRows) {
      const prevTit = applyInjury(parseIdsArray(row.titolari), injuryMap).slice(0, n);
      if (prevTit.length > 0) {
        titolari = prevTit;
        panchina = applyInjury(parseIdsArray(row.panchina), injuryMap);
        modulo = String(row.modulo || '').trim() || modulo;
        formationRecovered = true;
        formationRecoveryKind = 'previous_matchday';
        break;
      }
    }
  }

  if (titolari.length < 1) {
    const generated = await buildFallbackLineupFromRoster(leagueId, userId, n);
    if (generated && generated.titolari.length > 0) {
      titolari = applyInjury(generated.titolari, injuryMap).slice(0, n);
      panchina = applyInjury(generated.panchina, injuryMap);
      modulo = String(generated.modulo || '').trim() || modulo;
      formationRecovered = true;
      formationRecoveryKind = 'roster_fallback';
    }
  }

  return { modulo, titolari, panchina, formationRecovered, formationRecoveryKind };
}

function parseLineupSlotIds(raw) {
  if (Array.isArray(raw)) {
    return raw.map((x) => {
      const n = Number(x);
      return Number.isFinite(n) && n > 0 ? n : 0;
    });
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parseLineupSlotIds(parsed);
    } catch (_) {
      return [];
    }
  }
  return [];
}

function expectedStarterSlotCount(modulo, numeroTitolari) {
  const n = Math.max(1, Number(numeroTitolari || 10));
  const movSlots = Math.max(0, n - 1);
  const mod = AUTO_MODULES[String(modulo || '').trim()];
  if (mod && Number(mod[0] || 0) + Number(mod[1] || 0) + Number(mod[2] || 0) === movSlots) {
    return n;
  }
  return n;
}

function titolariIdsToSlots(raw, modulo, numeroTitolari) {
  const slotCount = expectedStarterSlotCount(modulo, numeroTitolari);
  let arr = parseLineupSlotIds(raw);
  const hasZeros = arr.some((x) => x === 0);
  if (!hasZeros && arr.length > 0) {
    const slots = Array(slotCount).fill(0);
    arr.forEach((id, i) => {
      if (i < slotCount && id > 0) slots[i] = id;
    });
    return slots;
  }
  while (arr.length < slotCount) arr.push(0);
  return arr.slice(0, slotCount);
}

async function getEffectiveLeagueId(leagueId) {
  try {
    const rows = await query(
      `SELECT linked_to_league_id FROM leagues WHERE id = ? LIMIT 1`,
      [leagueId]
    );
    const linked = Number(rows[0]?.linked_to_league_id || 0);
    return linked > 0 ? linked : leagueId;
  } catch (_) {
    return leagueId;
  }
}

async function getMatchdayEditAvailability({ leagueId, effectiveLeagueId, giornata }) {
  const leagueRows = await query(
    `SELECT COALESCE(enable_next_matchday_from_next_day, 1) AS enable_next_matchday_from_next_day
     FROM leagues WHERE id = ? LIMIT 1`,
    [leagueId]
  );
  const enabled = Number(leagueRows[0]?.enable_next_matchday_from_next_day ?? 1) === 1;
  if (!enabled) return { canEdit: true, releaseAt: null };

  const prevGiornata = Number(giornata) - 1;
  if (prevGiornata < 1) return { canEdit: true, releaseAt: null };

  const prevRows = await query(
    `SELECT
        to_char(
          (
            (date_trunc('day', (deadline AT TIME ZONE 'Europe/Rome')) + interval '1 day')
            AT TIME ZONE 'Europe/Rome'
          ),
          'YYYY-MM-DD"T"HH24:MI:SSOF'
        ) AS release_at,
        CASE WHEN NOW() >= (
          (date_trunc('day', (deadline AT TIME ZONE 'Europe/Rome')) + interval '1 day')
          AT TIME ZONE 'Europe/Rome'
        ) THEN 1 ELSE 0 END AS can_edit
     FROM matchdays
     WHERE league_id = ? AND giornata = ?
     LIMIT 1`,
    [effectiveLeagueId, prevGiornata]
  );

  const releaseAt = prevRows[0]?.release_at || null;
  if (!releaseAt) return { canEdit: true, releaseAt: null };

  const canEdit = Number(prevRows[0]?.can_edit || 0) === 1;
  return { canEdit, releaseAt };
}

/**
 * Rimuove un giocatore venduto dalle formazioni ancora modificabili (deadline futura + canEdit).
 */
async function removePlayerFromEditableLineups(userId, leagueId, playerId) {
  const pid = Number(playerId);
  const uid = Number(userId);
  const lid = Number(leagueId);
  if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(uid) || uid <= 0 || !Number.isFinite(lid) || lid <= 0) {
    return { updated: false, starterRemoved: false, matchdays: [] };
  }

  const effectiveLeagueId = await getEffectiveLeagueId(lid);
  const leagueRows = await query(
    `SELECT COALESCE(numero_titolari, 10) AS numero_titolari FROM leagues WHERE id = ? LIMIT 1`,
    [lid]
  );
  const numeroTitolari = Number(leagueRows[0]?.numero_titolari || 10);

  const lineupRows = await query(
    `SELECT giornata, modulo, titolari, panchina
     FROM user_lineups
     WHERE user_id = ? AND league_id = ?`,
    [uid, lid]
  );

  let starterRemoved = false;
  const matchdays = [];

  for (const row of lineupRows || []) {
    const giornata = Number(row.giornata);
    if (!Number.isFinite(giornata) || giornata <= 0) continue;

    const dRows = await query(
      `SELECT deadline FROM matchdays WHERE league_id = ? AND giornata = ? LIMIT 1`,
      [effectiveLeagueId, giornata]
    );
    const deadline = dRows[0]?.deadline;
    if (deadline && new Date(deadline) < new Date()) continue;

    const editAvailability = await getMatchdayEditAvailability({
      leagueId: lid,
      effectiveLeagueId,
      giornata,
    });
    if (!editAvailability.canEdit) continue;

    const modulo = String(row.modulo || '').trim();
    const titSlots = titolariIdsToSlots(row.titolari, modulo, numeroTitolari);
    let panchina = parseIdsArray(row.panchina);

    let inStarter = false;
    for (let i = 0; i < titSlots.length; i += 1) {
      if (titSlots[i] === pid) {
        titSlots[i] = 0;
        inStarter = true;
      }
    }
    const hadBench = panchina.includes(pid);
    panchina = panchina.filter((id) => id !== pid);

    if (!inStarter && !hadBench) continue;

    if (inStarter) starterRemoved = true;

    await query(
      `UPDATE user_lineups
       SET titolari = ?, panchina = ?
       WHERE user_id = ? AND league_id = ? AND giornata = ?`,
      [JSON.stringify(titSlots), JSON.stringify(panchina), uid, lid, giornata]
    );
    matchdays.push(giornata);
  }

  return {
    updated: matchdays.length > 0,
    starterRemoved,
    matchdays,
  };
}

async function persistUserLineup(leagueId, userId, giornata, lineup) {
  if (!lineup || !Array.isArray(lineup.titolari) || lineup.titolari.length < 1) return;
  try {
    await query(
      `INSERT INTO user_lineups (user_id, league_id, giornata, modulo, titolari, panchina)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, league_id, giornata)
       DO UPDATE SET
         modulo = EXCLUDED.modulo,
         titolari = EXCLUDED.titolari,
         panchina = EXCLUDED.panchina`,
      [
        userId,
        leagueId,
        giornata,
        String(lineup.modulo || ''),
        JSON.stringify(lineup.titolari),
        JSON.stringify(Array.isArray(lineup.panchina) ? lineup.panchina : []),
      ]
    );
  } catch (_) {
    // Ignora errori di persistenza.
  }
}

module.exports = {
  parseIdsArray,
  parseLineupSlotIds,
  titolariIdsToSlots,
  expectedStarterSlotCount,
  getEffectiveLeagueId,
  getMatchdayEditAvailability,
  removePlayerFromEditableLineups,
  buildFallbackLineupFromRoster,
  resolveUserLineup,
  persistUserLineup,
};

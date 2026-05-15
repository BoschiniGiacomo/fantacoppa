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
  buildFallbackLineupFromRoster,
  resolveUserLineup,
  persistUserLineup,
};

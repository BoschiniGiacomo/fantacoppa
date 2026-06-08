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

function buildStarterRolesFromModulo(modulo, slotCount) {
  const n = Math.max(1, Number(slotCount || 1));
  const mod = AUTO_MODULES[String(modulo || '').trim()];
  if (mod) {
    const [d, c, a] = mod;
    const roles = ['P', ...Array(d).fill('D'), ...Array(c).fill('C'), ...Array(a).fill('A')];
    while (roles.length < n) roles.push('C');
    return roles.slice(0, n);
  }
  return Array(n).fill('C');
}

function applyInjuryToSlots(slots, injuryMap) {
  const map = injuryMap || {};
  return (Array.isArray(slots) ? slots : []).map((raw) => {
    const id = Number(raw) || 0;
    if (id <= 0) return 0;
    const mapped = Number(map[id] || id);
    return Number.isFinite(mapped) && mapped > 0 ? mapped : 0;
  });
}

function applyInjuryMap(ids, injuryMap) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const out = [];
  const used = new Set();
  ids.forEach((rawId) => {
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) return;
    const mapped = Number(injuryMap[id] || id);
    if (!Number.isFinite(mapped) || mapped <= 0 || used.has(mapped)) return;
    used.add(mapped);
    out.push(mapped);
  });
  return out;
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
    (rows || []).forEach((r) => {
      const injuredId = Number(r.injured_id);
      const replacementId = Number(r.injury_replacement_player_id);
      if (
        Number.isFinite(injuredId) && injuredId > 0
        && Number.isFinite(replacementId) && replacementId > 0
        && replacementId !== injuredId
      ) {
        map[injuredId] = replacementId;
      }
    });
    return map;
  } catch (_) {
    return {};
  }
}

async function runInParallelChunks(items, chunkSize, worker) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(chunkSize) || 1);
  for (let i = 0; i < list.length; i += size) {
    const chunk = list.slice(i, i + size);
    await Promise.all(chunk.map((item) => worker(item)));
  }
}

function revertReplacementPlayerId(id, replacementId, injuredId) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return n;
  return n === replacementId ? injuredId : n;
}

function revertReplacementInSlots(raw, replacementId, injuredId) {
  return parseLineupSlotIds(raw).map((id) => revertReplacementPlayerId(id, replacementId, injuredId));
}

function revertReplacementInBench(raw, replacementId, injuredId) {
  return parseIdsArray(raw).map((id) => revertReplacementPlayerId(id, replacementId, injuredId));
}

function isLineupEditableForInjurySwap(meta, calculatedGiornate, giornata) {
  const g = Number(giornata);
  if (!Number.isFinite(g) || g <= 0) return false;
  if (calculatedGiornate.has(g)) return false;
  if (!meta) return false;
  if (Number(meta.deadline_passed || 0) === 1) return false;
  if (Number(meta.can_edit || 0) !== 1) return false;
  return true;
}

async function canMutateLineupForInjury(leagueId, giornata) {
  const lid = Number(leagueId);
  const g = Number(giornata);
  if (!Number.isFinite(lid) || lid <= 0 || !Number.isFinite(g) || g <= 0) return false;
  const effectiveLeagueId = await getEffectiveLeagueId(lid);
  const [matchdayMeta, calcRows] = await Promise.all([
    loadMatchdayEditMeta(lid, effectiveLeagueId),
    query(
      `SELECT COUNT(*)::int AS c
       FROM matchday_results
       WHERE league_id = ? AND giornata = ?`,
      [lid, g]
    ).catch(() => [{ c: 0 }]),
  ]);
  const calculatedGiornate = new Set();
  if (Number(calcRows[0]?.c || 0) > 0) calculatedGiornate.add(g);
  return isLineupEditableForInjurySwap(matchdayMeta.get(g), calculatedGiornate, g);
}

/**
 * Sostituisce gli infortunati solo nelle formazioni ancora modificabili
 * (stesse regole di scadenza/can_edit del salvataggio formazione).
 */
async function propagateInjuryReplacementsToLineups(leagueId) {
  const lid = Number(leagueId);
  if (!Number.isFinite(lid) || lid <= 0) {
    return { updatedLineups: 0, matchdays: [] };
  }

  const injuryMap = await getInjuryReplacementMap(lid);
  const injuredIds = new Set(
    Object.keys(injuryMap || {})
      .map((k) => Number(k))
      .filter((id) => Number.isFinite(id) && id > 0)
  );
  if (injuredIds.size === 0) {
    return { updatedLineups: 0, matchdays: [] };
  }

  const effectiveLeagueId = await getEffectiveLeagueId(lid);
  const [lineupRows, matchdayMeta, calculatedRows] = await Promise.all([
    query(
      `SELECT user_id, giornata, modulo, titolari, panchina
       FROM user_lineups
       WHERE league_id = ?`,
      [lid]
    ),
    loadMatchdayEditMeta(lid, effectiveLeagueId),
    query(
      `SELECT DISTINCT giornata
       FROM matchday_results
       WHERE league_id = ?`,
      [lid]
    ).catch(() => []),
  ]);
  const calculatedGiornate = new Set(
    (calculatedRows || [])
      .map((r) => Number(r.giornata))
      .filter((g) => Number.isFinite(g) && g > 0)
  );

  const pendingUpdates = [];

  for (const row of lineupRows || []) {
    const giornata = Number(row.giornata);
    if (!Number.isFinite(giornata) || giornata <= 0) continue;

    const meta = matchdayMeta.get(giornata);
    if (!isLineupEditableForInjurySwap(meta, calculatedGiornate, giornata)) continue;

    const rowTitRaw = parseIdsArray(row.titolari);
    const rowBenRaw = parseIdsArray(row.panchina);
    if (![...rowTitRaw, ...rowBenRaw].some((id) => injuredIds.has(id))) continue;

    const patchedTitolari = applyInjuryMap(rowTitRaw, injuryMap);
    const patchedPanchina = applyInjuryMap(rowBenRaw, injuryMap);
    const changed =
      patchedTitolari.length !== rowTitRaw.length
      || patchedPanchina.length !== rowBenRaw.length
      || patchedTitolari.some((id, i) => id !== rowTitRaw[i])
      || patchedPanchina.some((id, i) => id !== rowBenRaw[i]);
    if (!changed) continue;

    pendingUpdates.push({
      userId: Number(row.user_id),
      giornata,
      titolari: JSON.stringify(patchedTitolari),
      panchina: JSON.stringify(patchedPanchina),
    });
  }

  let updatedLineups = 0;
  const matchdaysSet = new Set();
  await runInParallelChunks(pendingUpdates, 40, async (item) => {
    try {
      await query(
        `UPDATE user_lineups
         SET titolari = ?, panchina = ?
         WHERE user_id = ? AND league_id = ? AND giornata = ?`,
        [item.titolari, item.panchina, item.userId, lid, item.giornata]
      );
      updatedLineups += 1;
      matchdaysSet.add(item.giornata);
    } catch (err) {
      console.error('propagateInjuryReplacementsToLineups: update failed', {
        leagueId: lid,
        userId: item.userId,
        giornata: item.giornata,
        err: err?.message || err,
      });
    }
  });

  return {
    updatedLineups,
    matchdays: [...matchdaysSet].sort((a, b) => a - b),
  };
}

/**
 * Ripristina l'infortunato in tutte le formazioni salvate dove compare il sostituto
 * (anche giornate scadute/calcolate: solo swap id, senza ricalcolo).
 */
async function revertInjuryReplacementsInLineups(leagueId, injuredPlayerId, replacementPlayerId) {
  const lid = Number(leagueId);
  const injuredId = Number(injuredPlayerId);
  const replacementId = Number(replacementPlayerId);
  if (!Number.isFinite(lid) || lid <= 0 || !Number.isFinite(injuredId) || injuredId <= 0
    || !Number.isFinite(replacementId) || replacementId <= 0 || injuredId === replacementId) {
    return { updatedLineups: 0, matchdays: [] };
  }

  const lineupRows = await query(
    `SELECT user_id, giornata, titolari, panchina
     FROM user_lineups
     WHERE league_id = ?`,
    [lid]
  );

  const pendingUpdates = [];

  for (const row of lineupRows || []) {
    const giornata = Number(row.giornata);
    if (!Number.isFinite(giornata) || giornata <= 0) continue;

    const rowTitRaw = parseLineupSlotIds(row.titolari);
    const rowBenRaw = parseIdsArray(row.panchina);
    if (![...rowTitRaw, ...rowBenRaw].some((id) => Number(id) === replacementId)) continue;

    const patchedTitolari = revertReplacementInSlots(row.titolari, replacementId, injuredId);
    const patchedPanchina = revertReplacementInBench(row.panchina, replacementId, injuredId);
    const changed =
      patchedTitolari.length !== rowTitRaw.length
      || patchedPanchina.length !== rowBenRaw.length
      || patchedTitolari.some((id, i) => id !== rowTitRaw[i])
      || patchedPanchina.some((id, i) => id !== rowBenRaw[i]);
    if (!changed) continue;

    pendingUpdates.push({
      userId: Number(row.user_id),
      giornata,
      titolari: JSON.stringify(patchedTitolari),
      panchina: JSON.stringify(patchedPanchina),
    });
  }

  let updatedLineups = 0;
  const matchdaysSet = new Set();
  await runInParallelChunks(pendingUpdates, 40, async (item) => {
    try {
      await query(
        `UPDATE user_lineups
         SET titolari = ?, panchina = ?
         WHERE user_id = ? AND league_id = ? AND giornata = ?`,
        [item.titolari, item.panchina, item.userId, lid, item.giornata]
      );
      updatedLineups += 1;
      matchdaysSet.add(item.giornata);
    } catch (err) {
      console.error('revertInjuryReplacementsInLineups: update failed', {
        leagueId: lid,
        userId: item.userId,
        giornata: item.giornata,
        err: err?.message || err,
      });
    }
  });

  return {
    updatedLineups,
    matchdays: [...matchdaysSet].sort((a, b) => a - b),
  };
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
 * Metadati giornate in un'unica query (evita N+1 su svincolo).
 */
async function loadMatchdayEditMeta(leagueId, effectiveLeagueId) {
  const rows = await query(
    `SELECT m.giornata,
            m.deadline,
            CASE
              WHEN m.deadline IS NOT NULL AND m.deadline <= NOW() THEN 1
              ELSE 0
            END AS deadline_passed,
            CASE
              WHEN COALESCE(l.enable_next_matchday_from_next_day, 1) = 0 THEN 1
              WHEN m.giornata <= 1 THEN 1
              WHEN prev.deadline IS NULL THEN 1
              WHEN NOW() >= (
                (date_trunc('day', (prev.deadline AT TIME ZONE 'Europe/Rome')) + interval '1 day')
                AT TIME ZONE 'Europe/Rome'
              ) THEN 1
              ELSE 0
            END AS can_edit
     FROM matchdays m
     JOIN leagues l ON l.id = ?
     LEFT JOIN matchdays prev
       ON prev.league_id = m.league_id AND prev.giornata = m.giornata - 1
     WHERE m.league_id = ?`,
    [leagueId, effectiveLeagueId]
  );
  const byGiornata = new Map();
  (rows || []).forEach((r) => {
    byGiornata.set(Number(r.giornata), r);
  });
  return byGiornata;
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
  const [leagueRows, lineupRows, matchdayMeta] = await Promise.all([
    query(
      `SELECT COALESCE(numero_titolari, 10) AS numero_titolari FROM leagues WHERE id = ? LIMIT 1`,
      [lid]
    ),
    query(
      `SELECT giornata, modulo, titolari, panchina
       FROM user_lineups
       WHERE user_id = ? AND league_id = ?`,
      [uid, lid]
    ),
    loadMatchdayEditMeta(lid, effectiveLeagueId),
  ]);
  const numeroTitolari = Number(leagueRows[0]?.numero_titolari || 10);

  let starterRemoved = false;
  const matchdays = [];

  for (const row of lineupRows || []) {
    const giornata = Number(row.giornata);
    if (!Number.isFinite(giornata) || giornata <= 0) continue;

    const meta = matchdayMeta.get(giornata);
    if (meta) {
      if (Number(meta.deadline_passed || 0) === 1) continue;
      if (Number(meta.can_edit || 0) !== 1) continue;
    }

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

    try {
      await query(
        `UPDATE user_lineups
         SET titolari = ?, panchina = ?
         WHERE user_id = ? AND league_id = ? AND giornata = ?`,
        [JSON.stringify(titSlots), JSON.stringify(panchina), uid, lid, giornata]
      );
      matchdays.push(giornata);
    } catch (err) {
      console.error('removePlayerFromEditableLineups: update failed', { uid, lid, giornata, playerId: pid, err: err?.message || err });
    }
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
  buildStarterRolesFromModulo,
  applyInjuryToSlots,
  applyInjuryMap,
  getInjuryReplacementMap,
  propagateInjuryReplacementsToLineups,
  revertInjuryReplacementsInLineups,
  isLineupEditableForInjurySwap,
  canMutateLineupForInjury,
  expectedStarterSlotCount,
  getEffectiveLeagueId,
  getMatchdayEditAvailability,
  removePlayerFromEditableLineups,
  buildFallbackLineupFromRoster,
  resolveUserLineup,
  persistUserLineup,
};

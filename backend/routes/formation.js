const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { buildAutoLineupFromVotes } = require('../utils/autoLineup');
const { computeBonusTotal } = require('../utils/bonus');
const { resolveUserLineup, persistUserLineup } = require('../utils/lineupResolver');

const AUTO_MODULES = {
  '1-1-1': [1, 1, 1],
  '1-1-2': [1, 1, 2], '1-2-1': [1, 2, 1], '2-1-1': [2, 1, 1],
  '1-2-2': [1, 2, 2], '2-2-1': [2, 2, 1], '2-1-2': [2, 1, 2], '3-1-1': [3, 1, 1],
  '2-2-2': [2, 2, 2], '3-2-1': [3, 2, 1], '2-3-1': [2, 3, 1], '1-3-2': [1, 3, 2], '3-1-2': [3, 1, 2],
  '3-2-2': [3, 2, 2], '2-3-2': [2, 3, 2], '2-2-3': [2, 2, 3], '4-2-1': [4, 2, 1], '3-3-1': [3, 3, 1], '4-3-1': [4, 3, 1],
  '3-3-2': [3, 3, 2], '3-2-3': [3, 2, 3], '2-3-3': [2, 3, 3], '4-2-2': [4, 2, 2],
  '3-3-3': [3, 3, 3], '4-2-3': [4, 2, 3], '3-4-2': [3, 4, 2], '5-2-2': [5, 2, 2],
  '4-3-2': [4, 3, 2], '3-5-1': [3, 5, 1], '4-4-1': [4, 4, 1],
  '4-4-2': [4, 4, 2], '4-3-3': [4, 3, 3], '3-5-2': [3, 5, 2], '4-5-1': [4, 5, 1], '5-3-2': [5, 3, 2],
  '3-4-3': [3, 4, 3],
};

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

async function getMatchdayEditAvailability({ leagueId, effectiveLeagueId, giornata }) {
  const leagueRows = await query(
    `SELECT COALESCE(enable_next_matchday_from_next_day, 1) AS enable_next_matchday_from_next_day
     FROM leagues
     WHERE id = ?
     LIMIT 1`,
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

async function getInjuryReplacementMap(leagueId) {
  try {
    const rows = await query(
      `SELECT p.id AS injured_id, p.injury_replacement_player_id
       FROM players p
       JOIN teams t ON t.id = p.team_id
       WHERE t.league_id = ?
         AND COALESCE(p.is_injured, 0) = 1
         AND p.injury_replacement_player_id IS NOT NULL`,
      [leagueId]
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
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const out = [];
  const used = new Set();
  ids.forEach((rawId) => {
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) return;
    const mapped = Number(injuryMap[id] || id);
    if (!Number.isFinite(mapped) || mapped <= 0) return;
    if (used.has(mapped)) return;
    used.add(mapped);
    out.push(mapped);
  });
  return out;
}

// GET /api/formation/:leagueId/matchdays
router.get('/:leagueId/matchdays', authenticateToken, async (req, res) => {
  try {
    const leagueId = Number(req.params.leagueId);
    const userId = Number(req.user.userId);
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    const [rows, lineupRows] = await Promise.all([
      query(
        `SELECT giornata,
                to_char((deadline AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-DD HH24:MI:SS') AS deadline
         FROM matchdays
         WHERE league_id = ?
         ORDER BY giornata ASC`,
        [effectiveLeagueId]
      ),
      query(
        `SELECT giornata FROM user_lineups
         WHERE user_id = ? AND league_id = ?`,
        [userId, leagueId]
      ),
    ]);
    const lineupSet = new Set(lineupRows.map(r => Number(r.giornata)));
    const enriched = rows.map(r => ({
      ...r,
      has_formation: lineupSet.has(Number(r.giornata)),
    }));
    res.json(enriched);
  } catch (_) {
    res.json([]);
  }
});

// GET /api/formation/:leagueId/:giornata/deadline
router.get('/:leagueId/:giornata/deadline', authenticateToken, async (req, res) => {
  try {
    const leagueId = Number(req.params.leagueId);
    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    const giornata = Number(req.params.giornata);
    const rows = await query(
      `SELECT to_char((deadline AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-DD HH24:MI:SS') AS deadline
       FROM matchdays
       WHERE league_id = ? AND giornata = ?
       LIMIT 1`,
      [effectiveLeagueId, giornata]
    );
    const deadline = rows[0]?.deadline || null;
    res.json({ deadline, isExpired: deadline ? new Date(deadline) < new Date() : false });
  } catch (_) {
    res.json({ deadline: null, isExpired: false });
  }
});

// GET /api/formation/:leagueId/:giornata
router.get('/:leagueId/:giornata', authenticateToken, async (req, res) => {
  try {
    const t0 = Date.now();
    const leagueId = Number(req.params.leagueId);
    const giornata = Number(req.params.giornata);
    const userId = Number(req.user.userId);

    // Phase 1: all independent queries in parallel
    const [effectiveLeagueId, injuryMap, lineupRows] = await Promise.all([
      getEffectiveLeagueId(leagueId),
      getInjuryReplacementMap(leagueId),
      query(
        `SELECT modulo, titolari, panchina
         FROM user_lineups
         WHERE user_id = ? AND league_id = ? AND giornata = ?
         LIMIT 1`,
        [userId, leagueId, giornata]
      ),
    ]);

    // Phase 2: queries needing effectiveLeagueId
    const [dRows, calcRows] = await Promise.all([
      query(
        `SELECT to_char((deadline AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-DD HH24:MI:SS') AS deadline
         FROM matchdays
         WHERE league_id = ? AND giornata = ?
         LIMIT 1`,
        [effectiveLeagueId, giornata]
      ),
      query(
        `SELECT COUNT(*)::int AS c
         FROM matchday_results
         WHERE league_id = ? AND giornata = ?`,
        [leagueId, giornata]
      ).catch(() => [{ c: 0 }]),
    ]);

    const deadline = dRows[0]?.deadline || null;
    const isExpired = deadline ? new Date(deadline) < new Date() : false;
    const isCalculated = Number(calcRows[0]?.c || 0) > 0;
    let row = lineupRows[0];
    let formationRecovered = false;

    const leagueRows = await query(
      `SELECT COALESCE(recover_previous_lineup_if_missing, 1) AS recover_previous_lineup_if_missing,
              COALESCE(auto_lineup_mode, 0) AS auto_lineup_mode,
              COALESCE(numero_titolari, 10) AS numero_titolari
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [leagueId]
    );
    const recoverPrevious = Number(leagueRows[0]?.recover_previous_lineup_if_missing ?? 1) === 1;
    const autoLineupMode = Number(leagueRows[0]?.auto_lineup_mode || 0) === 1;
    const numeroTitolari = Number(leagueRows[0]?.numero_titolari || 10);

    if (autoLineupMode) {
      const [bonusRows, voteRows] = await Promise.all([
        query(
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
        ).catch(() => []),
        query(
          `SELECT player_id, rating, goals, assists, yellow_cards, red_cards,
                  goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet,
                  pallone_fuori, briso, no_divisa
           FROM player_ratings
           WHERE league_id = ? AND giornata = ?`,
          [effectiveLeagueId, giornata]
        ).catch(() => []),
      ]);
      const bonusSettings = bonusRows[0] || { enable_bonus_malus: 1 };
      const votesByPlayer = {};
      voteRows.forEach((r) => { votesByPlayer[Number(r.player_id)] = r; });
      const generated = await buildAutoLineupFromVotes({
        leagueId,
        userId,
        numeroTitolari,
        votesByPlayer,
        bonusSettings,
        use6Politico: false,
        computeBonusTotal,
      });
      if (generated && generated.titolari.length > 0) {
        const tit = applyInjuryMap(generated.titolari, injuryMap).slice(0, numeroTitolari);
        const ben = applyInjuryMap(generated.panchina, injuryMap);
        row = {
          modulo: generated.modulo || '',
          titolari: JSON.stringify(tit),
          panchina: JSON.stringify(ben),
        };
        formationRecovered = true;
      }
    } else if (!row && isExpired && !isCalculated && recoverPrevious) {
      const resolved = await resolveUserLineup(leagueId, userId, giornata, numeroTitolari, {
        recoverPrevious: true,
        injuryMap,
        applyInjury: (ids, map) => applyInjuryMap(ids, map),
      });
      if (resolved.titolari.length > 0) {
        row = {
          modulo: resolved.modulo || '',
          titolari: JSON.stringify(resolved.titolari),
          panchina: JSON.stringify(resolved.panchina),
        };
        formationRecovered = !!resolved.formationRecovered;
        if (resolved.formationRecoveryKind === 'roster_fallback') {
          await persistUserLineup(leagueId, userId, giornata, resolved);
        }
      }
    }

    if (row && !isCalculated && !autoLineupMode) {
      const patchedTitolari = applyInjuryMap(parseIdsArray(row.titolari), injuryMap);
      const patchedPanchina = applyInjuryMap(parseIdsArray(row.panchina), injuryMap);
      const rowTitRaw = parseIdsArray(row.titolari);
      const rowBenRaw = parseIdsArray(row.panchina);
      const changed =
        patchedTitolari.length !== rowTitRaw.length
        || patchedPanchina.length !== rowBenRaw.length
        || patchedTitolari.some((id, i) => id !== rowTitRaw[i])
        || patchedPanchina.some((id, i) => id !== rowBenRaw[i]);
      if (changed) {
        row = {
          ...row,
          titolari: JSON.stringify(patchedTitolari),
          panchina: JSON.stringify(patchedPanchina),
        };
        try {
          await query(
            `UPDATE user_lineups
             SET titolari = ?, panchina = ?
             WHERE user_id = ? AND league_id = ? AND giornata = ?`,
            [row.titolari, row.panchina, userId, leagueId, giornata]
          );
          formationRecovered = true;
        } catch (_) {
          // Ignore persistence failures.
        }
      }
    }

    const formation = row
      ? { modulo: row.modulo, titolari: row.titolari, panchina: row.panchina }
      : null;

    // Phase 3: formationPlayers + editAvailability in parallel
    const formationPlayersPromise = (async () => {
      if (!row) return [];
      const ids = [...parseIdsArray(row.titolari), ...parseIdsArray(row.panchina)];
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length === 0) return [];
      const placeholders = uniqueIds.map(() => '?').join(',');
      try {
        return await query(
          `SELECT p.id, p.first_name, p.last_name, p.role, t.name AS team_name
           FROM players p
           LEFT JOIN teams t ON t.id = p.team_id
           WHERE p.id IN (${placeholders})`,
          uniqueIds
        );
      } catch (_) { return []; }
    })();

    const [formationPlayers, editAvailability] = await Promise.all([
      formationPlayersPromise,
      getMatchdayEditAvailability({ leagueId, effectiveLeagueId, giornata }),
    ]);

    console.log(`[PERF][GET /formation/:id/:g] leagueId=${leagueId} g=${giornata} TOTAL=${Date.now() - t0}ms`);
    res.json({
      formation,
      formation_players: formationPlayers,
      formation_recovered: formationRecovered,
      deadline,
      isExpired,
      ...editAvailability,
    });
  } catch (_) {
    res.json({
      formation: null,
      formation_players: [],
      formation_recovered: false,
      deadline: null,
      isExpired: false,
      canEdit: true,
      releaseAt: null,
    });
  }
});

// POST /api/formation/:leagueId/:giornata
router.post('/:leagueId/:giornata', authenticateToken, async (req, res) => {
  try {
    const leagueId = Number(req.params.leagueId);
    const giornata = Number(req.params.giornata);
    const userId = Number(req.user.userId);
    const modulo = String(req.body?.modulo || '').trim();
    const injuryMap = await getInjuryReplacementMap(leagueId);
    const titolari = JSON.stringify(applyInjuryMap(parseIdsArray(req.body?.titolari), injuryMap));
    const panchina = JSON.stringify(applyInjuryMap(parseIdsArray(req.body?.panchina), injuryMap));

    if (!modulo) return res.status(400).json({ message: 'Modulo obbligatorio' });

    const effectiveLeagueId = await getEffectiveLeagueId(leagueId);
    const dRows = await query(
      `SELECT to_char((deadline AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-DD HH24:MI:SS') AS deadline
       FROM matchdays
       WHERE league_id = ? AND giornata = ?
       LIMIT 1`,
      [effectiveLeagueId, giornata]
    );
    const deadline = dRows[0]?.deadline || null;
    const isExpired = deadline ? new Date(deadline) < new Date() : false;
    if (isExpired) {
      return res.status(400).json({ message: 'La scadenza per questa giornata è passata' });
    }

    const editAvailability = await getMatchdayEditAvailability({
      leagueId,
      effectiveLeagueId,
      giornata,
    });
    if (!editAvailability.canEdit) {
      return res.status(400).json({
        message: 'Formazione modificabile dal giorno successivo alla scadenza della giornata precedente',
        releaseAt: editAvailability.releaseAt,
      });
    }

    await query(
      `INSERT INTO user_lineups (user_id, league_id, giornata, modulo, titolari, panchina)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, league_id, giornata)
       DO UPDATE SET
         modulo = EXCLUDED.modulo,
         titolari = EXCLUDED.titolari,
         panchina = EXCLUDED.panchina`,
      [userId, leagueId, giornata, modulo, titolari, panchina]
    );
    res.json({ message: 'Formazione salvata' });
  } catch (error) {
    console.error('Save formation error:', error);
    res.status(500).json({ message: 'Errore salvataggio formazione' });
  }
});

module.exports = router;

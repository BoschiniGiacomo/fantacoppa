const { query } = require('../config/database');
const { normalizeVoteRating } = require('./voteRating');

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
  '5-4-1': [5, 4, 1], '5-2-3': [5, 2, 3], '3-4-3': [3, 4, 3],
};

function pickTopPlayers(players, count) {
  if (!Array.isArray(players) || count <= 0) return [];
  return players
    .slice()
    .sort((a, b) => (b.total - a.total) || (a.id - b.id))
    .slice(0, count);
}

function modulesForMovSlots(movSlots) {
  return Object.entries(AUTO_MODULES)
    .map(([modulo, arr]) => ({
      modulo,
      d: Number(arr[0] || 0),
      c: Number(arr[1] || 0),
      a: Number(arr[2] || 0),
    }))
    .filter((m) => (m.d + m.c + m.a) === movSlots);
}

/**
 * Formazione automatica per una singola giornata:
 * ordina la rosa per fantavoto (voto + bonus/malus) e sceglie il modulo valido
 * che massimizza la somma dei titolari.
 */
async function buildAutoLineupFromVotes({
  leagueId,
  userId,
  numeroTitolari,
  votesByPlayer,
  bonusSettings,
  use6Politico,
  computeBonusTotal,
}) {
  const rows = await query(
    `SELECT p.id, p.role
     FROM user_players up
     JOIN players p ON p.id = up.player_id
     WHERE up.league_id = ? AND up.user_id = ?
       AND COALESCE(p.is_injured, 0) = 0`,
    [leagueId, userId]
  );
  if (!rows.length) return null;

  const enriched = rows.map((p) => {
    const vote = votesByPlayer[Number(p.id)] || {};
    let rating = normalizeVoteRating(vote.rating || 0);
    if (rating <= 0 && use6Politico) rating = 6;
    const bonus = rating > 0 ? computeBonusTotal({ ...vote, rating }, bonusSettings) : 0;
    return {
      id: Number(p.id),
      role: String(p.role || '').trim(),
      total: rating > 0 ? (rating + bonus) : 0,
      hasVote: rating > 0,
    };
  });

  const valid = enriched.filter((p) => p.hasVote);
  const n = Math.max(0, Number(numeroTitolari || 11));
  if (!valid.length || n <= 0) return null;

  const portieri = valid.filter((p) => p.role === 'P');
  const difensori = valid.filter((p) => p.role === 'D');
  const centrocampisti = valid.filter((p) => p.role === 'C');
  const attaccanti = valid.filter((p) => p.role === 'A');

  const bestGk = pickTopPlayers(portieri, 1);
  if (!bestGk.length) return null;

  const movSlots = Math.max(0, n - bestGk.length);
  const candidateModules = modulesForMovSlots(movSlots);

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
      best = { total, modulo: mod.modulo, chosen };
    }
  }

  let titolari = [];
  let modulo = '';
  if (best) {
    titolari = best.chosen.map((p) => p.id);
    modulo = best.modulo;
  } else {
    titolari = valid
      .slice()
      .sort((a, b) => (b.total - a.total) || (a.id - b.id))
      .slice(0, n)
      .map((p) => p.id);
    const counts = { D: 0, C: 0, A: 0 };
    enriched.forEach((p) => {
      if (titolari.includes(p.id) && counts[p.role] != null) counts[p.role] += 1;
    });
    const match = modulesForMovSlots(movSlots).find((m) =>
      counts.D >= m.d && counts.C >= m.c && counts.A >= m.a
    );
    modulo = match?.modulo || '';
  }

  const used = new Set(titolari);
  const panchina = rows
    .map((r) => Number(r.id))
    .filter((pid) => Number.isFinite(pid) && pid > 0 && !used.has(pid));

  return { modulo, titolari, panchina };
}

/** Compat: ritorna solo gli ID titolari (uso legacy). */
async function buildAutoLineupIds(opts) {
  const built = await buildAutoLineupFromVotes(opts);
  return built?.titolari || [];
}

module.exports = {
  AUTO_MODULES,
  buildAutoLineupFromVotes,
  buildAutoLineupIds,
  modulesForMovSlots,
};

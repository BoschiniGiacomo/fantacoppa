const { query } = require('../config/database');
const {
  getEffectiveLeagueId,
  propagateInjuryReplacementsToLineups,
  revertInjuryReplacementsInLineups,
} = require('./lineupResolver');

/**
 * Leghe del bacino: lega corrente + parent effettivo + figli collegati al parent.
 */
async function resolveLinkedLeagueIds(leagueId) {
  const lid = Number(leagueId);
  if (!Number.isFinite(lid) || lid <= 0) return [];

  const effectiveId = await getEffectiveLeagueId(lid);
  const ids = new Set([lid, effectiveId]);

  try {
    const rows = await query(
      `SELECT id FROM leagues WHERE id = ? OR id = ? OR linked_to_league_id = ?`,
      [lid, effectiveId, effectiveId]
    );
    (rows || []).forEach((r) => {
      const n = Number(r.id);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    });
  } catch (_) {
    /* */
  }

  return [...ids];
}

async function applyInjuryReplacementToRoster(leagueId, injuredPlayerId, replacementPlayerId) {
  const lid = Number(leagueId);
  const injuredId = Number(injuredPlayerId);
  const replacementId = Number(replacementPlayerId);
  if (!lid || !injuredId || !replacementId || injuredId === replacementId) {
    return { affectedOwners: 0, replacementsAdded: 0, alreadyHadReplacement: 0 };
  }

  const statsRows = await query(
    `SELECT
        COUNT(DISTINCT up.user_id)::int AS affected_owners,
        COUNT(DISTINCT CASE WHEN rep.user_id IS NOT NULL THEN up.user_id END)::int AS already_had_replacement
     FROM user_players up
     LEFT JOIN user_players rep
       ON rep.league_id = up.league_id
      AND rep.user_id = up.user_id
      AND rep.player_id = ?
     WHERE up.league_id = ? AND up.player_id = ?`,
    [replacementId, lid, injuredId]
  );

  const insertResult = await query(
    `INSERT INTO user_players (user_id, league_id, player_id)
     SELECT DISTINCT up.user_id, ?::integer, ?::integer
     FROM user_players up
     WHERE up.league_id = ?::integer AND up.player_id = ?::integer
       AND NOT EXISTS (
         SELECT 1
         FROM user_players existing
         WHERE existing.league_id = up.league_id
           AND existing.user_id = up.user_id
           AND existing.player_id = ?::integer
       )
     ON CONFLICT (user_id, league_id, player_id) DO NOTHING
     RETURNING user_id`,
    [lid, replacementId, lid, injuredId, replacementId]
  );

  return {
    affectedOwners: Number(statsRows[0]?.affected_owners || 0),
    replacementsAdded: Number(insertResult?.affectedRows ?? insertResult?.rows?.length ?? 0),
    alreadyHadReplacement: Number(statsRows[0]?.already_had_replacement || 0),
  };
}

/**
 * Stessi player_id in tutte le leghe collegate: aggiorna infortunio sul giocatore ufficiale,
 * rose e formazioni non scadute in ogni lega del bacino.
 */
async function applyInjuryReplacementAcrossLeagues(sourceLeagueId, injuredPlayerId, replacementPlayerId) {
  const injuredId = Number(injuredPlayerId);
  const replacementId = Number(replacementPlayerId);
  if (!Number.isFinite(injuredId) || injuredId <= 0 || !Number.isFinite(replacementId) || replacementId <= 0) {
    return {
      linked_leagues: [],
      leagues_updated: [],
      per_league: [],
      affected_owners: 0,
      replacements_added: 0,
      already_had_replacement: 0,
      lineups_updated: 0,
      lineup_matchdays: [],
    };
  }

  await query(
    `UPDATE players
     SET is_injured = 1,
         injury_replacement_player_id = ?
     WHERE id = ?`,
    [replacementId, injuredId]
  );

  const linkedLeagueIds = await resolveLinkedLeagueIds(sourceLeagueId);
  const perLeague = [];
  let totalReplacementsAdded = 0;
  let totalAlreadyHadReplacement = 0;
  let totalAffectedOwners = 0;
  let totalLineupsUpdated = 0;
  const allMatchdays = new Set();

  for (const leagueId of linkedLeagueIds) {
    let roster = { replacementsAdded: 0, alreadyHadReplacement: 0, affectedOwners: 0 };
    try {
      roster = await applyInjuryReplacementToRoster(leagueId, injuredId, replacementId);
    } catch (rosterErr) {
      console.error('[INJURY][roster] insert failed', {
        leagueId,
        injuredId,
        replacementId,
        err: rosterErr?.message || rosterErr,
      });
    }
    const lineups = await propagateInjuryReplacementsToLineups(leagueId);
    console.log('[INJURY][propagate]', {
      leagueId,
      injuredId,
      replacementId,
      lineups_updated: lineups.updatedLineups,
      matchdays: lineups.matchdays,
    });

    totalReplacementsAdded += roster.replacementsAdded;
    totalAlreadyHadReplacement += roster.alreadyHadReplacement;
    totalAffectedOwners += roster.affectedOwners;
    totalLineupsUpdated += lineups.updatedLineups;
    (lineups.matchdays || []).forEach((g) => allMatchdays.add(g));

    perLeague.push({
      league_id: leagueId,
      injured_player_id: injuredId,
      replacement_player_id: replacementId,
      replacements_added: roster.replacementsAdded,
      already_had_replacement: roster.alreadyHadReplacement,
      lineups_updated: lineups.updatedLineups,
    });
  }

  return {
    linked_leagues: linkedLeagueIds,
    leagues_updated: linkedLeagueIds,
    per_league: perLeague,
    affected_owners: totalAffectedOwners,
    replacements_added: totalReplacementsAdded,
    already_had_replacement: totalAlreadyHadReplacement,
    lineups_updated: totalLineupsUpdated,
    lineup_matchdays: [...allMatchdays].sort((a, b) => a - b),
  };
}

/**
 * Rimuove l'infortunio e ripristina l'id originale in tutte le formazioni salvate con il sostituto.
 */
async function revertInjuryReplacementAcrossLeagues(sourceLeagueId, injuredPlayerId, replacementPlayerId) {
  const injuredId = Number(injuredPlayerId);
  const replacementId = Number(replacementPlayerId);
  if (!Number.isFinite(injuredId) || injuredId <= 0 || !Number.isFinite(replacementId) || replacementId <= 0) {
    return {
      linked_leagues: [],
      lineups_updated: 0,
      lineup_matchdays: [],
      per_league: [],
    };
  }

  const linkedLeagueIds = await resolveLinkedLeagueIds(sourceLeagueId);
  const perLeague = [];
  let totalLineupsUpdated = 0;
  const allMatchdays = new Set();

  for (const leagueId of linkedLeagueIds) {
    const lineups = await revertInjuryReplacementsInLineups(leagueId, injuredId, replacementId);
    totalLineupsUpdated += lineups.updatedLineups;
    (lineups.matchdays || []).forEach((g) => allMatchdays.add(g));
    perLeague.push({
      league_id: leagueId,
      injured_player_id: injuredId,
      replacement_player_id: replacementId,
      lineups_updated: lineups.updatedLineups,
    });
  }

  return {
    linked_leagues: linkedLeagueIds,
    lineups_updated: totalLineupsUpdated,
    lineup_matchdays: [...allMatchdays].sort((a, b) => a - b),
    per_league: perLeague,
  };
}

module.exports = {
  resolveLinkedLeagueIds,
  applyInjuryReplacementToRoster,
  applyInjuryReplacementAcrossLeagues,
  revertInjuryReplacementAcrossLeagues,
};

const { normalizeVoteRating } = require('./voteRating');

function buildTeamHasVoteSet(votesByPlayer, playersById) {
  const teams = new Set();
  Object.keys(votesByPlayer || {}).forEach((rawPid) => {
    const pid = Number(rawPid);
    const rating = normalizeVoteRating(votesByPlayer[pid]?.rating || 0);
    if (rating <= 0) return;
    const teamId = Number(playersById[pid]?.team_id || 0);
    if (teamId > 0) teams.add(teamId);
  });
  return teams;
}

function findFirstBenchSubstitute(panchina, role, votesByPlayer, playersById) {
  const wantedRole = String(role || '').trim();
  if (!wantedRole) return null;
  const bench = Array.isArray(panchina) ? panchina : [];
  for (const benchId of bench) {
    const bid = Number(benchId);
    if (!Number.isFinite(bid) || bid <= 0) continue;
    if (String(playersById[bid]?.role || '').trim() !== wantedRole) continue;
    if (normalizeVoteRating(votesByPlayer[bid]?.rating || 0) > 0) return bid;
  }
  return null;
}

/**
 * Punteggio titolari con sostituzione panchina (ordine panchina) e 4.5 se abilitato.
 * Panchina vuota: nessun errore; con "voto aiuto" attivo → 4.5 nel bonus (voto base titolare resta 0).
 * La squadra reale deve avere almeno un voto in giornata per attivare sostituzione / 4.5.
 */
function scoreResolvedLineup({
  titolari,
  panchina,
  votesByPlayer,
  playersById,
  enableSvFallbackVote = false,
  use6Politico = false,
  bonusSettings,
  computeBonusTotal,
}) {
  const teamHasVote = buildTeamHasVoteSet(votesByPlayer, playersById);
  const safePanchina = Array.isArray(panchina) ? panchina : [];
  let punteggio = 0;
  let hasRealVotes = false;
  const playerScores = [];
  const formationSlots = [];

  for (const titolareId of titolari || []) {
    const tid = Number(titolareId);
    if (!Number.isFinite(tid) || tid <= 0) continue;

    const vote = votesByPlayer[tid] || {};
    const displayRating = normalizeVoteRating(vote.rating || 0);
    let scoringRating = displayRating;
    let scoringPlayerId = tid;
    let scoringVote = vote;
    let substituteId = null;
    let pendingTeamVote = false;
    let svHelpScore = 0;

    if (scoringRating > 0) hasRealVotes = true;

    if (scoringRating <= 0 && use6Politico) {
      scoringRating = 6;
      scoringPlayerId = tid;
      scoringVote = { ...vote, rating: 6 };
    } else if (scoringRating <= 0) {
      const role = String(playersById[tid]?.role || '').trim();
      const teamId = Number(playersById[tid]?.team_id || 0);
      const squadPlayed = teamId > 0 && teamHasVote.has(teamId);

      if (!squadPlayed) {
        pendingTeamVote = true;
        scoringRating = 0;
      } else {
        const subId = findFirstBenchSubstitute(safePanchina, role, votesByPlayer, playersById);
        if (subId) {
          substituteId = subId;
          scoringPlayerId = subId;
          scoringVote = votesByPlayer[subId] || {};
          scoringRating = normalizeVoteRating(scoringVote.rating || 0);
          if (scoringRating > 0) hasRealVotes = true;
        } else if (enableSvFallbackVote) {
          svHelpScore = 4.5;
          scoringRating = 0;
          scoringPlayerId = tid;
          scoringVote = { ...vote, rating: 0 };
        }
      }
    }

    if (scoringRating <= 0 && svHelpScore <= 0) {
      formationSlots.push({
        titolare_id: tid,
        scoring_player_id: tid,
        substitute_id: substituteId,
        pending_team_vote: pendingTeamVote,
        display_rating: displayRating,
        rating: 0,
        sv_fallback_score: 0,
        bonus_total: 0,
        total_score: 0,
      });
      continue;
    }

    const bonusTotal = computeBonusTotal(
      { ...scoringVote, rating: scoringRating > 0 ? scoringRating : 0 },
      bonusSettings
    );
    const bonusWithHelp = Number((bonusTotal + svHelpScore).toFixed(2));
    const score = Number((scoringRating + bonusWithHelp).toFixed(2));
    punteggio += score;

    const p = playersById[scoringPlayerId] || playersById[tid];
    playerScores.push({
      player_id: scoringPlayerId,
      titolare_id: tid,
      player_name: p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : `Giocatore ${scoringPlayerId}`,
      player_role: p?.role || null,
      display_rating: displayRating,
      rating: normalizeVoteRating(scoringRating),
      sv_fallback_score: svHelpScore,
      goals: Number(scoringVote.goals || 0),
      assists: Number(scoringVote.assists || 0),
      yellow_cards: Number(scoringVote.yellow_cards || 0),
      red_cards: Number(scoringVote.red_cards || 0),
      goals_conceded: Number(scoringVote.goals_conceded || 0),
      own_goals: Number(scoringVote.own_goals || 0),
      penalty_missed: Number(scoringVote.penalty_missed || 0),
      penalty_saved: Number(scoringVote.penalty_saved || 0),
      clean_sheet: Number(scoringVote.clean_sheet || 0),
      pallone_fuori: Number(scoringVote.pallone_fuori || 0),
      briso: Number(scoringVote.briso || 0),
      no_divisa: Number(scoringVote.no_divisa || 0),
      bonus_total: bonusWithHelp,
      total_score: score,
    });

    formationSlots.push({
      titolare_id: tid,
      scoring_player_id: scoringPlayerId,
      substitute_id: substituteId,
      pending_team_vote: pendingTeamVote,
      display_rating: displayRating,
      rating: normalizeVoteRating(scoringRating),
      sv_fallback_score: svHelpScore,
      bonus_total: bonusWithHelp,
      total_score: score,
    });
  }

  return {
    punteggio: Number(punteggio.toFixed(2)),
    hasRealVotes,
    playerScores,
    formationSlots,
  };
}

module.exports = {
  buildTeamHasVoteSet,
  findFirstBenchSubstitute,
  scoreResolvedLineup,
};

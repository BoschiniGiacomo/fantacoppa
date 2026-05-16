const { normalizeVoteRating } = require('./voteRating');

const EMPTY_BONUS_VOTE = {
  goals: 0,
  assists: 0,
  yellow_cards: 0,
  red_cards: 0,
  goals_conceded: 0,
  own_goals: 0,
  penalty_missed: 0,
  penalty_saved: 0,
  clean_sheet: 0,
  pallone_fuori: 0,
  briso: 0,
  no_divisa: 0,
};

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

/**
 * Primo panchinaro dello stesso ruolo con voto, non ancora usato (1 sub → 1 titolare).
 */
function findFirstBenchSubstitute(panchina, role, votesByPlayer, playersById, usedBenchIds) {
  const wantedRole = String(role || '').trim();
  if (!wantedRole) return null;
  const bench = Array.isArray(panchina) ? panchina : [];
  const used = usedBenchIds instanceof Set ? usedBenchIds : new Set();
  for (const benchId of bench) {
    const bid = Number(benchId);
    if (!Number.isFinite(bid) || bid <= 0) continue;
    if (used.has(bid)) continue;
    if (String(playersById[bid]?.role || '').trim() !== wantedRole) continue;
    if (normalizeVoteRating(votesByPlayer[bid]?.rating || 0) > 0) return bid;
  }
  return null;
}

function pickBonusFields(vote) {
  const v = vote || {};
  return {
    goals: Number(v.goals || 0),
    assists: Number(v.assists || 0),
    yellow_cards: Number(v.yellow_cards || 0),
    red_cards: Number(v.red_cards || 0),
    goals_conceded: Number(v.goals_conceded || 0),
    own_goals: Number(v.own_goals || 0),
    penalty_missed: Number(v.penalty_missed || 0),
    penalty_saved: Number(v.penalty_saved || 0),
    clean_sheet: Number(v.clean_sheet || 0),
    pallone_fuori: Number(v.pallone_fuori || 0),
    briso: Number(v.briso || 0),
    no_divisa: Number(v.no_divisa || 0),
  };
}

/**
 * Punteggio titolari: sostituzione panchina (ordine, 1 sub = 1 titolare), 4.5 aiuto senza bonus/malus del titolare S.V.
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
  const usedBenchIds = new Set();
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
      scoringVote = { ...EMPTY_BONUS_VOTE, ...vote, rating: 6 };
    } else if (scoringRating <= 0) {
      const role = String(playersById[tid]?.role || '').trim();
      const teamId = Number(playersById[tid]?.team_id || 0);
      const squadPlayed = teamId > 0 && teamHasVote.has(teamId);

      if (!squadPlayed) {
        pendingTeamVote = true;
        scoringRating = 0;
        scoringVote = { ...EMPTY_BONUS_VOTE, rating: 0 };
      } else {
        const subId = findFirstBenchSubstitute(
          safePanchina,
          role,
          votesByPlayer,
          playersById,
          usedBenchIds
        );
        if (subId) {
          substituteId = subId;
          scoringPlayerId = subId;
          usedBenchIds.add(subId);
          scoringVote = votesByPlayer[subId] || {};
          scoringRating = normalizeVoteRating(scoringVote.rating || 0);
          if (scoringRating > 0) hasRealVotes = true;
        } else if (enableSvFallbackVote) {
          svHelpScore = 4.5;
          scoringRating = 0;
          scoringPlayerId = tid;
          scoringVote = { ...EMPTY_BONUS_VOTE, rating: 0 };
        } else {
          scoringRating = 0;
          scoringVote = { ...EMPTY_BONUS_VOTE, rating: 0 };
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
        ...EMPTY_BONUS_VOTE,
      });
      continue;
    }

    const bonusFields = svHelpScore > 0
      ? { ...EMPTY_BONUS_VOTE }
      : pickBonusFields(scoringVote);

    const bonusTotal = computeBonusTotal(
      { ...bonusFields, rating: scoringRating > 0 ? scoringRating : 0 },
      bonusSettings
    );
    const bonusWithHelp = Number((bonusTotal + svHelpScore).toFixed(2));
    const score = Number((scoringRating + bonusWithHelp).toFixed(2));
    punteggio += score;

    const p = playersById[scoringPlayerId] || playersById[tid];
    const slotPayload = {
      titolare_id: tid,
      scoring_player_id: scoringPlayerId,
      substitute_id: substituteId,
      pending_team_vote: pendingTeamVote,
      display_rating: displayRating,
      rating: normalizeVoteRating(scoringRating),
      sv_fallback_score: svHelpScore,
      bonus_total: bonusWithHelp,
      total_score: score,
      ...bonusFields,
    };

    playerScores.push({
      player_id: scoringPlayerId,
      titolare_id: tid,
      player_name: p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : `Giocatore ${scoringPlayerId}`,
      player_role: p?.role || null,
      ...slotPayload,
    });

    formationSlots.push(slotPayload);
  }

  return {
    punteggio: Number(punteggio.toFixed(2)),
    hasRealVotes,
    playerScores,
    formationSlots,
    used_bench_ids: [...usedBenchIds],
  };
}

module.exports = {
  buildTeamHasVoteSet,
  findFirstBenchSubstitute,
  scoreResolvedLineup,
  EMPTY_BONUS_VOTE,
};

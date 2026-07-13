/** Pre-partita shootout: somma al punteggio mostrato, non alle statistiche. */

function finiteShootoutSideScore(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function hasPreShootoutListScore(match) {
  const h = finiteShootoutSideScore(match?.home_pre_shootout_score);
  const a = finiteShootoutSideScore(match?.away_pre_shootout_score);
  return h != null && a != null;
}

export function hasPostMatchShootoutListScore(match) {
  const h = finiteShootoutSideScore(match?.home_shootout_score);
  const a = finiteShootoutSideScore(match?.away_shootout_score);
  return h != null && a != null;
}

function regularListScore(match) {
  const hs = Number(match?.live_home_score ?? match?.home_score);
  const as = Number(match?.live_away_score ?? match?.away_score);
  const hasRegular = Number.isFinite(hs) && Number.isFinite(as);
  return {
    home: hasRegular ? hs : 0,
    away: hasRegular ? as : 0,
    hasRegular,
  };
}

/** Punteggio lista/card: gol regolamentari + shootout pre-partita; rigori post-partita separati. */
export function matchDisplayScoreParts(match) {
  const reg = regularListScore(match);
  const hasPre = hasPreShootoutListScore(match);
  const preHome = hasPre ? Number(match.home_pre_shootout_score) : 0;
  const preAway = hasPre ? Number(match.away_pre_shootout_score) : 0;
  const hasRig = hasPostMatchShootoutListScore(match);
  const rigHome = hasRig ? Number(match.home_shootout_score) : null;
  const rigAway = hasRig ? Number(match.away_shootout_score) : null;

  const combinedHome = reg.home + preHome;
  const combinedAway = reg.away + preAway;

  return {
    /** Hero / risultato combinato (regolamentari + shootout pre-partita). */
    home: combinedHome,
    away: combinedAway,
    /** Liste partite: con rigori solo gol reg. prima del "|", altrimenti reg+pre. */
    listHome: hasRig ? reg.home : combinedHome,
    listAway: hasRig ? reg.away : combinedAway,
    show: hasPre || reg.hasRegular,
    hasPre,
    hasRig,
    rigHome,
    rigAway,
    regHome: reg.home,
    regAway: reg.away,
  };
}

export function combinePreShootoutWithRegular(regularHome, regularAway, preHome, preAway) {
  return {
    home: (Number(regularHome) || 0) + (Number(preHome) || 0),
    away: (Number(regularAway) || 0) + (Number(preAway) || 0),
  };
}

export function matchDisplayScoreForSide(match, side) {
  const parts = matchDisplayScoreParts(match);
  if (side === 'home') {
    return {
      score: parts.show ? parts.listHome : null,
      shootoutScore: parts.hasRig ? parts.rigHome : null,
    };
  }
  return {
    score: parts.show ? parts.listAway : null,
    shootoutScore: parts.hasRig ? parts.rigAway : null,
  };
}

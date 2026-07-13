/** Pre-partita shootout: somma al punteggio mostrato, non alle statistiche. */

export function hasPreShootoutListScore(match) {
  const h = Number(match?.home_pre_shootout_score);
  const a = Number(match?.away_pre_shootout_score);
  return Number.isFinite(h) && Number.isFinite(a);
}

export function hasPostMatchShootoutListScore(match) {
  const h = Number(match?.home_shootout_score);
  const a = Number(match?.away_shootout_score);
  return Number.isFinite(h) && Number.isFinite(a);
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

  return {
    home: reg.home + preHome,
    away: reg.away + preAway,
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
      score: parts.show ? parts.home : null,
      shootoutScore: parts.hasRig ? parts.rigHome : null,
    };
  }
  return {
    score: parts.show ? parts.away : null,
    shootoutScore: parts.hasRig ? parts.rigAway : null,
  };
}

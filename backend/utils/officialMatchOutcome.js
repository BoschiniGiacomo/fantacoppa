function isRegularGoalEventType(eventType) {
  const t = String(eventType || '').trim();
  return t === 'goal' || t === 'penalty_goal';
}

function resolveOfficialMatchOutcome({
  regHome,
  regAway,
  preHome = 0,
  preAway = 0,
  rigHome = 0,
  rigAway = 0,
  hasRig = false,
}) {
  const rh = Number(regHome) || 0;
  const ra = Number(regAway) || 0;
  if (hasRig && rh === ra) {
    return { home: Number(rigHome) || 0, away: Number(rigAway) || 0 };
  }
  return { home: rh + (Number(preHome) || 0), away: ra + (Number(preAway) || 0) };
}

function tallyOfficialMatchEventScores(events, homeTeamId, awayTeamId) {
  let homeGoals = 0;
  let awayGoals = 0;
  let homePreShootout = 0;
  let awayPreShootout = 0;
  let homeRig = 0;
  let awayRig = 0;
  let hasGoalEvents = false;
  let hasRigEvents = false;
  let hasPreEvents = false;
  const homeId = Number(homeTeamId);
  const awayId = Number(awayTeamId);

  for (const e of events || []) {
    const evTeamId = Number(e.team_id);
    const byTeamId = Number.isFinite(evTeamId) && evTeamId > 0 && homeId > 0 && awayId > 0;
    if (e.event_type === 'shootout_goal') {
      hasRigEvents = true;
      if (byTeamId) {
        if (evTeamId === homeId) homeRig += 1;
        if (evTeamId === awayId) awayRig += 1;
      } else {
        if (e.team_side === 'home') homeRig += 1;
        if (e.team_side === 'away') awayRig += 1;
      }
    } else if (e.event_type === 'shootout_missed') {
      hasRigEvents = true;
    } else if (e.event_type === 'pre_shootout_goal') {
      hasPreEvents = true;
      if (byTeamId) {
        if (evTeamId === homeId) homePreShootout += 1;
        if (evTeamId === awayId) awayPreShootout += 1;
      } else {
        if (e.team_side === 'home') homePreShootout += 1;
        if (e.team_side === 'away') awayPreShootout += 1;
      }
    } else if (e.event_type === 'pre_shootout_missed') {
      hasPreEvents = true;
    } else if (isRegularGoalEventType(e.event_type)) {
      hasGoalEvents = true;
      if (byTeamId) {
        if (evTeamId === homeId) homeGoals += 1;
        if (evTeamId === awayId) awayGoals += 1;
      } else {
        if (e.team_side === 'home') homeGoals += 1;
        if (e.team_side === 'away') awayGoals += 1;
      }
    } else if (e.event_type === 'own_goal') {
      hasGoalEvents = true;
      if (byTeamId) {
        if (evTeamId === homeId) awayGoals += 1;
        if (evTeamId === awayId) homeGoals += 1;
      } else {
        if (e.team_side === 'home') awayGoals += 1;
        if (e.team_side === 'away') homeGoals += 1;
      }
    }
  }

  return {
    homeGoals,
    awayGoals,
    homePreShootout,
    awayPreShootout,
    homeRig,
    awayRig,
    hasGoalEvents,
    hasRigEvents,
    hasPreEvents,
  };
}

function determineKnockoutMatchWinner(match) {
  if (!match) return null;
  const hs = match.home_score != null ? Number(match.home_score) : null;
  const as = match.away_score != null ? Number(match.away_score) : null;
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;

  const hasRig = match.home_shootout_score != null && match.away_shootout_score != null;
  const outcome = resolveOfficialMatchOutcome({
    regHome: hs,
    regAway: as,
    preHome: match.home_pre_shootout_score != null ? Number(match.home_pre_shootout_score) : 0,
    preAway: match.away_pre_shootout_score != null ? Number(match.away_pre_shootout_score) : 0,
    rigHome: hasRig ? Number(match.home_shootout_score) : 0,
    rigAway: hasRig ? Number(match.away_shootout_score) : 0,
    hasRig,
  });

  if (outcome.home > outcome.away) {
    return {
      team_id: match.home_team_id != null ? Number(match.home_team_id) : null,
      team_name: match.home_team_name != null ? String(match.home_team_name) : null,
      logo_path: match.home_team_logo_path || null,
    };
  }
  if (outcome.away > outcome.home) {
    return {
      team_id: match.away_team_id != null ? Number(match.away_team_id) : null,
      team_name: match.away_team_name != null ? String(match.away_team_name) : null,
      logo_path: match.away_team_logo_path || null,
    };
  }
  return null;
}

function buildHallMatchFromRow(row, evRows) {
  if (!row) return null;
  const mid = Number(row.id);
  const homeId = Number(row.home_team_id);
  const awayId = Number(row.away_team_id);

  let hs = row.home_score != null ? Number(row.home_score) : null;
  let as = row.away_score != null ? Number(row.away_score) : null;

  const tallied = tallyOfficialMatchEventScores(evRows, homeId, awayId);
  if (tallied.hasGoalEvents) {
    hs = tallied.homeGoals;
    as = tallied.awayGoals;
  }

  const hasPre = tallied.hasPreEvents;
  const homePre = hasPre ? tallied.homePreShootout : null;
  const awayPre = hasPre ? tallied.awayPreShootout : null;
  const hasRig = tallied.hasRigEvents;
  const hps = hasRig ? tallied.homeRig : null;
  const aps = hasRig ? tallied.awayRig : null;

  return {
    id: mid,
    home_team_id: homeId,
    home_team_name: row.home_team_name != null ? String(row.home_team_name) : undefined,
    home_team_logo_path: row.home_team_logo_path != null ? row.home_team_logo_path : undefined,
    away_team_id: awayId,
    away_team_name: row.away_team_name != null ? String(row.away_team_name) : undefined,
    away_team_logo_path: row.away_team_logo_path != null ? row.away_team_logo_path : undefined,
    home_score: Number.isFinite(hs) ? hs : null,
    away_score: Number.isFinite(as) ? as : null,
    home_pre_shootout_score: homePre,
    away_pre_shootout_score: awayPre,
    home_shootout_score: Number.isFinite(hps) && Number.isFinite(aps) ? hps : null,
    away_shootout_score: Number.isFinite(hps) && Number.isFinite(aps) ? aps : null,
  };
}

module.exports = {
  isRegularGoalEventType,
  resolveOfficialMatchOutcome,
  tallyOfficialMatchEventScores,
  determineKnockoutMatchWinner,
  buildHallMatchFromRow,
};

/** Coppia squadre (andata/ritorno) indipendente da chi è in casa. */
import { matchOutcomeScoreParts } from './matchDisplayScore';

export function knockoutTiePairKey(match) {
  const h = Number(match?.home_team_id);
  const a = Number(match?.away_team_id);
  if (!Number.isFinite(h) || !Number.isFinite(a) || h <= 0 || a <= 0) {
    return `mid-${Number(match?.id) || 0}`;
  }
  return h < a ? `${h}-${a}` : `${a}-${h}`;
}

function parseKickoffMs(kickoff) {
  if (!kickoff) return 0;
  const t = new Date(kickoff).getTime();
  return Number.isFinite(t) ? t : 0;
}

function sortLegsChronologically(legs) {
  return [...legs].sort(
    (a, b) => parseKickoffMs(a?.kickoff_at) - parseKickoffMs(b?.kickoff_at) || Number(a?.id) - Number(b?.id)
  );
}

/**
 * Raggruppa partite a eliminazione in accoppiamenti (max 2 leg per coppia).
 */
export function groupKnockoutMatchesIntoTies(matches, maxTies = 2) {
  const raw = (Array.isArray(matches) ? matches : []).filter((m) => m && m.id != null);
  const byPair = new Map();
  for (const m of raw) {
    const key = knockoutTiePairKey(m);
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(m);
  }

  const ties = [];
  for (const legsRaw of byPair.values()) {
    const legs = sortLegsChronologically(legsRaw).slice(0, 2);
    const first = legs[0];
    if (!first) continue;

    const teamA = {
      id: Number(first.home_team_id),
      name: first.home_team_name,
      logo_url: first.home_team_logo_url,
      logo_path: first.home_team_logo_path,
    };
    const teamB = {
      id: Number(first.away_team_id),
      name: first.away_team_name,
      logo_url: first.away_team_logo_url,
      logo_path: first.away_team_logo_path,
    };

    let aggA = 0;
    let aggB = 0;
    let aggComplete = legs.length > 0;
    for (const leg of legs) {
      const hs = leg.home_score;
      const as = leg.away_score;
      if (hs == null || as == null || !Number.isFinite(Number(hs)) || !Number.isFinite(Number(as))) {
        aggComplete = false;
        break;
      }
      const outcome = matchOutcomeScoreParts(leg);
      const hId = Number(leg.home_team_id);
      if (hId === teamA.id) {
        aggA += outcome.home;
        aggB += outcome.away;
      } else {
        aggA += outcome.away;
        aggB += outcome.home;
      }
    }

    ties.push({
      legs,
      twoLegged: legs.length > 1,
      teamA,
      teamB,
      aggregate: aggComplete && legs.length > 1 ? { home: aggA, away: aggB } : null,
      latestMatchId: legs[legs.length - 1]?.id ?? null,
    });
  }

  ties.sort((a, b) => parseKickoffMs(a.legs[0]?.kickoff_at) - parseKickoffMs(b.legs[0]?.kickoff_at));
  const cap = Number.isFinite(Number(maxTies)) && Number(maxTies) > 0 ? Math.trunc(Number(maxTies)) : 2;
  return ties.slice(0, cap);
}

/** Semifinali: al più 2 accoppiamenti. */
export function groupSemifinalsIntoTies(semifinals) {
  return groupKnockoutMatchesIntoTies(semifinals, 2);
}

/** Quarti (stage_id 4): al più 4 accoppiamenti. */
export function groupQuarterfinalsIntoTies(quarterfinals) {
  return groupKnockoutMatchesIntoTies(quarterfinals, 4);
}

export const EMPTY_OFFICIAL_KNOCKOUT = { quarterfinals: [], semifinals: [], final: null };

/** Loghi tabellone fasi finali (Q / SF / finale): stesso ingombro ovunque. */
export const KNOCKOUT_BRACKET_LOGO_SIZE = 30;

export function hasOfficialKnockoutBracket(knockout) {
  const k = knockout || EMPTY_OFFICIAL_KNOCKOUT;
  return (
    (Array.isArray(k.quarterfinals) && k.quarterfinals.length > 0) ||
    (Array.isArray(k.semifinals) && k.semifinals.length > 0) ||
    !!k.final
  );
}

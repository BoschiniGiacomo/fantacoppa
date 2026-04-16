export const hasPlayersInField = (value) => {
  if (value == null) return false;

  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    return value.some((entry) => hasPlayersInField(entry));
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0;
  }

  if (typeof value === 'object') {
    const values = Object.values(value);
    if (values.length === 0) return false;
    return values.some((entry) => hasPlayersInField(entry));
  }

  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw || raw === '[]' || raw === '{}' || raw.toLowerCase() === 'null') return false;

    try {
      const parsed = JSON.parse(raw);
      return hasPlayersInField(parsed);
    } catch (_) {
      const parts = raw
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length > 0) return true;

      return /\d+/.test(raw);
    }
  }

  return false;
};

export const hasSubmittedFormationPayload = (payload) => {
  if (!payload) return false;

  const formation = payload.formation;
  if (hasPlayersInField(formation)) return true;

  if (formation && typeof formation === 'object') {
    if (hasPlayersInField(formation.titolari) || hasPlayersInField(formation.panchina)) {
      return true;
    }
  }

  if (hasPlayersInField(payload.titolari) || hasPlayersInField(payload.panchina)) {
    return true;
  }

  return false;
};

export const detectSubmittedFormation = async (leagueId, formationService) => {
  const mdRes = await formationService.getMatchdays(leagueId);
  const matchdays = Array.isArray(mdRes?.data) ? mdRes.data : [];
  if (matchdays.length === 0) return false;

  const checks = await Promise.all(
    matchdays.map(async (matchday) => {
      try {
        const fRes = await formationService.getFormation(leagueId, matchday.giornata);
        return hasSubmittedFormationPayload(fRes?.data);
      } catch (_) {
        return false;
      }
    })
  );

  return checks.some(Boolean);
};

export const syncSubmittedFormationOnboarding = async ({ leagueId, formationService, markDone }) => {
  if (!leagueId || typeof markDone !== 'function') return false;
  const hasSubmitted = await detectSubmittedFormation(leagueId, formationService);
  if (hasSubmitted) {
    markDone('submitted_formation');
  }
  return hasSubmitted;
};

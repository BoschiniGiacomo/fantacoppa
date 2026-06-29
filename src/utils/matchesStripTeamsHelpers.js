export function teamLogoLookupKey(competitionId, teamName) {
  const norm = String(teamName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '');
  return `${Number(competitionId)}:${norm}`;
}

export function buildFollowLogoLookup(competitions) {
  const map = new Map();
  (Array.isArray(competitions) ? competitions : []).forEach((c) => {
    const compId = Number(c?.id);
    if (!compId) return;
    (Array.isArray(c.teams) ? c.teams : []).forEach((t) => {
      const name = String(typeof t === 'string' ? t : t?.name || '').trim();
      if (!name) return;
      const key = teamLogoLookupKey(compId, name);
      map.set(key, {
        logo_path: typeof t === 'string' ? null : t?.logo_path ?? null,
        logo_url: typeof t === 'string' ? null : t?.logo_url ?? null,
      });
    });
  });
  return map;
}

export function applyFollowLogosToStripTeams(stripTeams, logoLookup) {
  if (!logoLookup?.size) return stripTeams;
  return stripTeams.map((t) => {
    const key = teamLogoLookupKey(t.competition_id, t.name);
    const best = logoLookup.get(key);
    if (!best?.logo_path && !best?.logo_url) return t;
    return {
      ...t,
      logo_path: best.logo_path || t.logo_path,
      logo_url: best.logo_url || t.logo_url,
    };
  });
}

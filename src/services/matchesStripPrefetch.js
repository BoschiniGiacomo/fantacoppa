import { matchesService } from './api';
import { getOrFetchStripTeams, writeStripTeamsDisk } from './matchesStripTeamsCache';
import {
  applyFollowLogosToStripTeams,
  buildFollowLogoLookup,
} from '../utils/matchesStripTeamsHelpers';

async function fetchStripTeamsFromNetwork(token) {
  const [stripRes, followRes] = await Promise.all([
    matchesService.getStripTeams(),
    token ? matchesService.getFollowSetup().catch(() => null) : Promise.resolve(null),
  ]);
  const stripTeams = Array.isArray(stripRes?.data?.teams) ? stripRes.data.teams : [];
  const logoLookup = buildFollowLogoLookup(followRes?.data?.competitions);
  return applyFollowLogosToStripTeams(stripTeams, logoLookup);
}

/**
 * Carica squadre striscia Partite (cache + dedup in-flight).
 * @param {string|null} token
 * @param {{ force?: boolean }} [opts]
 */
export async function fetchAndCacheStripTeams(token, opts = {}) {
  const force = !!opts?.force;
  return getOrFetchStripTeams({
    token,
    force,
    fetcher: fetchStripTeamsFromNetwork,
  });
}

/** Invalida e rifetch (es. dopo salvataggio preferenze follow). */
export async function refreshStripTeams(token) {
  return fetchAndCacheStripTeams(token, { force: true });
}

/** Scrive in cache locale senza rete (uso raro / test). */
export async function seedStripTeamsCache(teams) {
  await writeStripTeamsDisk(Array.isArray(teams) ? teams : [], Date.now());
}

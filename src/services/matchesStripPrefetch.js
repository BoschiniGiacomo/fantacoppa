import { matchesService } from './api';
import { writeStripTeamsDisk } from './matchesStripTeamsCache';
import {
  applyFollowLogosToStripTeams,
  buildFollowLogoLookup,
} from '../utils/matchesStripTeamsHelpers';

/** Carica squadre striscia Partite e aggiorna cache memoria + disco. */
export async function fetchAndCacheStripTeams(token) {
  const [stripRes, followRes] = await Promise.all([
    matchesService.getStripTeams(),
    token ? matchesService.getFollowSetup().catch(() => null) : Promise.resolve(null),
  ]);
  const stripTeams = Array.isArray(stripRes?.data?.teams) ? stripRes.data.teams : [];
  const logoLookup = buildFollowLogoLookup(followRes?.data?.competitions);
  const teams = applyFollowLogosToStripTeams(stripTeams, logoLookup);
  await writeStripTeamsDisk(teams);
  return teams;
}

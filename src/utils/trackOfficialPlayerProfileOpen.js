import { matchesService } from '../services/api';

/** Track silenzioso apertura scheda giocatore ufficiale (dedupe lato server). */
export function trackOfficialPlayerProfileOpen({ playerId, leagueId, competitionId } = {}) {
  const pid = Number(playerId);
  if (!Number.isFinite(pid) || pid <= 0) return;
  const lid = Number(leagueId);
  const cid = Number(competitionId);
  void matchesService
    .trackPlayerProfileOpen({
      player_id: pid,
      league_id: Number.isFinite(lid) && lid > 0 ? lid : undefined,
      competition_id: Number.isFinite(cid) && cid > 0 ? cid : undefined,
    })
    .catch(() => {});
}

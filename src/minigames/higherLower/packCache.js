import { matchesService } from '../../services/api';
import { filterPlayablePlayers } from './engine';

const PACK_TTL_MS = 12 * 60 * 1000;

/** @type {{ groupId: number, players: any[], at: number } | null} */
let memory = null;

let inflight = null; // Promise shared per group

export function peekHigherLowerPack(groupId) {
  const gid = Number(groupId);
  if (!gid || !memory || Number(memory.groupId) !== gid) return null;
  if (Date.now() - memory.at > PACK_TTL_MS) return null;
  if (!Array.isArray(memory.players) || memory.players.length < 2) return null;
  return memory.players;
}

export function storeHigherLowerPack(groupId, players) {
  const gid = Number(groupId);
  const list = filterPlayablePlayers(players);
  if (!gid || list.length < 2) return list;
  memory = { groupId: gid, players: list, at: Date.now() };
  return list;
}

/**
 * Fetch pack (condiviso se già in corso). Aggiorna sempre la cache memoria.
 */
export async function fetchHigherLowerPackCached(groupId, { force = false } = {}) {
  const gid = Number(groupId);
  if (!gid) return [];

  if (!force) {
    const peeked = peekHigherLowerPack(gid);
    if (peeked) return peeked;
  }

  if (inflight && inflight.groupId === gid) {
    return inflight.promise;
  }

  const promise = (async () => {
    const res = await matchesService.getHigherLowerPack(gid);
    return storeHigherLowerPack(gid, res?.data?.players || []);
  })().finally(() => {
    if (inflight?.groupId === gid) inflight = null;
  });

  inflight = { groupId: gid, promise };
  return promise;
}

export function warmHigherLowerPack(groupId) {
  const gid = Number(groupId);
  if (!gid) return;
  if (peekHigherLowerPack(gid)) return;
  fetchHigherLowerPackCached(gid).catch(() => {});
}

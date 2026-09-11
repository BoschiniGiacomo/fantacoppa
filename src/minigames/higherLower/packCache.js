import { matchesService } from '../../services/api';
import { filterPlayablePlayers } from './engine';

const PACK_TTL_MS = 12 * 60 * 1000;
/** Bump per invalidare cache memoria client dopo cambi formato pack. */
const PACK_CACHE_VERSION = 3;

/** @type {{ version: number, groupId: number, players: any[], groupMaxYear: number|null, at: number } | null} */
let memory = null;

let inflight = null; // Promise shared per group

function isFresh(gid) {
  if (!gid || !memory || Number(memory.groupId) !== gid) return false;
  if (memory.version !== PACK_CACHE_VERSION) return false;
  if (Date.now() - memory.at > PACK_TTL_MS) return false;
  if (!Array.isArray(memory.players) || memory.players.length < 2) return false;
  return true;
}

export function peekHigherLowerPack(groupId) {
  const gid = Number(groupId);
  if (!isFresh(gid)) return null;
  return memory.players;
}

export function peekHigherLowerGroupMaxYear(groupId) {
  const gid = Number(groupId);
  if (!isFresh(gid)) return null;
  return memory.groupMaxYear;
}

export function storeHigherLowerPack(groupId, players, groupMaxYear = null) {
  const gid = Number(groupId);
  const list = filterPlayablePlayers(players);
  if (!gid || list.length < 2) return list;
  let maxYear = Number.isFinite(Number(groupMaxYear)) ? Number(groupMaxYear) : null;
  if (maxYear == null) {
    for (const p of list) {
      const y = Number(p?.last_edition_year);
      if (!Number.isFinite(y)) continue;
      if (maxYear == null || y > maxYear) maxYear = y;
    }
  }
  memory = {
    version: PACK_CACHE_VERSION,
    groupId: gid,
    players: list,
    groupMaxYear: maxYear,
    at: Date.now(),
  };
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
    return storeHigherLowerPack(
      gid,
      res?.data?.players || [],
      res?.data?.group_max_year,
    );
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

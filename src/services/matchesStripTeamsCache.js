import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = 'matches_strip_teams_v1';
const META_KEY = 'matches_strip_teams_meta_v1';

/** Strip cuoricini: non rifetchare al focus se più fresco di così. */
export const STRIP_TEAMS_TTL_MS = 10 * 60 * 1000;

let memoryTeams = null;
let memoryFetchedAt = 0;
let inflightPromise = null;

export function peekStripTeamsMemory() {
  return memoryTeams;
}

export function getStripTeamsFetchedAt() {
  return memoryFetchedAt > 0 ? memoryFetchedAt : 0;
}

export function isStripTeamsFresh(ttlMs = STRIP_TEAMS_TTL_MS) {
  if (!Array.isArray(memoryTeams) || memoryFetchedAt <= 0) return false;
  return Date.now() - memoryFetchedAt <= ttlMs;
}

export async function readStripTeamsDisk() {
  if (memoryTeams) return memoryTeams;
  try {
    const [raw, metaRaw] = await Promise.all([
      AsyncStorage.getItem(CACHE_KEY),
      AsyncStorage.getItem(META_KEY),
    ]);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    memoryTeams = parsed;
    try {
      const meta = metaRaw ? JSON.parse(metaRaw) : null;
      const ts = Number(meta?.fetchedAt);
      memoryFetchedAt = Number.isFinite(ts) && ts > 0 ? ts : 0;
    } catch {
      memoryFetchedAt = 0;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeStripTeamsDisk(teams, fetchedAt = Date.now()) {
  const list = Array.isArray(teams) ? teams : [];
  memoryTeams = list;
  memoryFetchedAt = list.length ? fetchedAt : 0;
  try {
    if (list.length === 0) {
      await Promise.all([
        AsyncStorage.removeItem(CACHE_KEY),
        AsyncStorage.removeItem(META_KEY),
      ]);
    } else {
      await Promise.all([
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify(list)),
        AsyncStorage.setItem(META_KEY, JSON.stringify({ fetchedAt: memoryFetchedAt })),
      ]);
    }
  } catch {}
}

export function clearStripTeamsCache() {
  memoryTeams = null;
  memoryFetchedAt = 0;
  inflightPromise = null;
  AsyncStorage.multiRemove([CACHE_KEY, META_KEY]).catch(() => {});
}

/**
 * Loader condiviso: una sola richiesta in-flight; TTL evita refetch inutili.
 * @param {{ token?: string|null, force?: boolean, fetcher: (token) => Promise<any[]> }} opts
 */
export async function getOrFetchStripTeams({ token = null, force = false, fetcher }) {
  if (!force && isStripTeamsFresh()) {
    return memoryTeams || [];
  }
  if (inflightPromise) {
    return inflightPromise;
  }
  if (typeof fetcher !== 'function') {
    return memoryTeams || [];
  }
  inflightPromise = Promise.resolve()
    .then(() => fetcher(token))
    .then(async (teams) => {
      const list = Array.isArray(teams) ? teams : [];
      await writeStripTeamsDisk(list, Date.now());
      return list;
    })
    .finally(() => {
      inflightPromise = null;
    });
  return inflightPromise;
}

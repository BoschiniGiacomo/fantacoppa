import { Image } from 'react-native';
import { matchesService } from '../services/api';
import { resolveDisplayMediaUriSync } from './resolveDisplayMediaUri';
import { warmStableMediaIndex, resolveMediaLocalFirst } from './stableMediaDiskCache';

let memoryPlayers = null;
let memoryFetchedAt = 0;
let inflight = null;

const TTL_MS = 5 * 60 * 1000;

function prefetchPlayerPhotos(players) {
  const list = Array.isArray(players) ? players : [];
  for (const p of list) {
    const path = String(p?.photo_path || '').trim();
    if (!path) continue;
    const sync = resolveDisplayMediaUriSync({ photoPath: path, asset: 'player_photo' });
    if (sync?.uri) {
      Image.prefetch(sync.uri).catch(() => {});
    }
    // Warm disk/memory in background (non blocca UI)
    void resolveMediaLocalFirst(path, { asset: 'player_photo', silent: true });
  }
}

export function peekTrendingPlayersMemory() {
  if (!memoryPlayers) return null;
  if (Date.now() - memoryFetchedAt > TTL_MS) return null;
  return memoryPlayers;
}

export async function fetchTrendingPlayersCached({ force = false } = {}) {
  warmStableMediaIndex();
  if (!force) {
    const mem = peekTrendingPlayersMemory();
    if (mem) return mem;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await matchesService.getTrendingPlayers();
      const players = Array.isArray(res?.data?.players) ? res.data.players : [];
      memoryPlayers = players;
      memoryFetchedAt = Date.now();
      prefetchPlayerPhotos(players);
      return players;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

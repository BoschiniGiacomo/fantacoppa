import AsyncStorage from '@react-native-async-storage/async-storage';
import { HIGHER_LOWER_GAME_KEY } from './metrics';

/** Evita di ripescare gli stessi giocatori tra una partita e l’altra. */
export const SEEN_COOLDOWN_MS = 15 * 60 * 1000;

const localKey = (groupId) => `@fc_minigame_best_${HIGHER_LOWER_GAME_KEY}_${groupId}`;
const seenKey = (groupId) => `@fc_minigame_seen_${HIGHER_LOWER_GAME_KEY}_${groupId}`;

export async function getLocalBest(groupId) {
  try {
    const raw = await AsyncStorage.getItem(localKey(groupId));
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
  } catch (_) {
    return 0;
  }
}

export async function setLocalBest(groupId, score) {
  const next = Math.max(0, Math.trunc(Number(score) || 0));
  try {
    const prev = await getLocalBest(groupId);
    if (next <= prev) return prev;
    await AsyncStorage.setItem(localKey(groupId), String(next));
    return next;
  } catch (_) {
    return next;
  }
}

export async function mergeBest(groupId, serverBest) {
  const local = await getLocalBest(groupId);
  const remote = Math.max(0, Math.trunc(Number(serverBest) || 0));
  const best = Math.max(local, remote);
  if (best > local) {
    try {
      await AsyncStorage.setItem(localKey(groupId), String(best));
    } catch (_) {}
  }
  return best;
}

async function readSeenMap(groupId) {
  if (!groupId) return {};
  try {
    const raw = await AsyncStorage.getItem(seenKey(groupId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function pruneSeenMap(map, now = Date.now()) {
  const next = {};
  for (const [id, ts] of Object.entries(map || {})) {
    const t = Number(ts);
    if (!Number.isFinite(t)) continue;
    if (now - t < SEEN_COOLDOWN_MS) next[String(id)] = t;
  }
  return next;
}

/** Entity id visti di recente (ancora in cooldown). */
export async function getCooldownEntityIds(groupId, now = Date.now()) {
  const pruned = pruneSeenMap(await readSeenMap(groupId), now);
  return Object.keys(pruned)
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
}

/** Segna giocatori incontrati ora (refresh del timer da 15 min). */
export async function markPlayersSeen(groupId, entityIds, now = Date.now()) {
  if (!groupId) return [];
  const ids = (entityIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
  if (!ids.length) return getCooldownEntityIds(groupId, now);

  const pruned = pruneSeenMap(await readSeenMap(groupId), now);
  for (const id of ids) {
    pruned[String(id)] = now;
  }
  try {
    await AsyncStorage.setItem(seenKey(groupId), JSON.stringify(pruned));
  } catch (_) {}
  return Object.keys(pruned)
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
}

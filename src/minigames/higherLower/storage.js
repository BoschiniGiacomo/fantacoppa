import AsyncStorage from '@react-native-async-storage/async-storage';
import { HIGHER_LOWER_GAME_KEY } from './metrics';

const localKey = (groupId) => `@fc_minigame_best_${HIGHER_LOWER_GAME_KEY}_${groupId}`;

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

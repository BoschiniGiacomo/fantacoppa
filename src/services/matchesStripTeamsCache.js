import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = 'matches_strip_teams_v1';

let memoryTeams = null;

export function peekStripTeamsMemory() {
  return memoryTeams;
}

export async function readStripTeamsDisk() {
  if (memoryTeams) return memoryTeams;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    memoryTeams = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeStripTeamsDisk(teams) {
  const list = Array.isArray(teams) ? teams : [];
  memoryTeams = list;
  try {
    if (list.length === 0) {
      await AsyncStorage.removeItem(CACHE_KEY);
    } else {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(list));
    }
  } catch {}
}

export function clearStripTeamsCache() {
  memoryTeams = null;
  AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
}

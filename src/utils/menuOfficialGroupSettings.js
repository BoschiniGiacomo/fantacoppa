import api from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = '@menu_official_group_v1';

/** undefined = non ancora noto; null = nessun gruppo; object = gruppo. */
let memoryLoaded = false;
let memoryValue = null;
let inflight = null;

function normalizeGroup(data) {
  if (!data || !data.id) return null;
  return {
    id: Number(data.id),
    name: String(data.name || ''),
    logo_path: data.logo_path ? String(data.logo_path) : null,
  };
}

function setMemory(value) {
  memoryLoaded = true;
  memoryValue = value;
}

/** Sync: undefined se non in cache, altrimenti null|group. */
export function peekMenuOfficialGroup() {
  if (!memoryLoaded) return undefined;
  return memoryValue;
}

export function seedMenuOfficialGroup(value) {
  setMemory(normalizeGroup(value));
}

async function readDisk() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (parsed && parsed._v === 1) {
      return parsed.group == null ? null : normalizeGroup(parsed.group);
    }
  } catch (_) {}
  return undefined;
}

async function writeDisk(group) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ _v: 1, group }));
  } catch (_) {}
}

export async function getMenuOfficialGroup({ force = false } = {}) {
  if (!force && memoryLoaded) {
    void refreshMenuOfficialGroup().catch(() => {});
    return memoryValue;
  }

  if (!force && !memoryLoaded) {
    const disk = await readDisk();
    if (disk !== undefined) {
      setMemory(disk);
      void refreshMenuOfficialGroup().catch(() => {});
      return disk;
    }
  }

  return refreshMenuOfficialGroup();
}

export async function refreshMenuOfficialGroup() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await api.get('/public/menu-official-group');
      const group = normalizeGroup(res.data);
      setMemory(group);
      await writeDisk(group);
      return group;
    } catch (_) {
      if (!memoryLoaded) {
        setMemory(null);
        await writeDisk(null);
      }
      return memoryLoaded ? memoryValue : null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Prefetch non bloccante (login / bootstrap Partite). */
export function warmMenuOfficialGroup() {
  return getMenuOfficialGroup().catch(() => null);
}

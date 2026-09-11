import api, { superuserService } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const PROMO_SLIDE_DEFS = [
  {
    id: 'minigames',
    label: 'Minigiochi',
    hint: 'Richiede almeno un minigioco visibile e un gruppo menu',
    requiresMinigame: true,
  },
  {
    id: 'player_compare',
    label: 'Chi vince il confronto?',
    hint: 'Confronto statistiche giocatori',
  },
];

export const MINIGAME_DEFS = [
  {
    id: 'higher_lower',
    label: 'Higher or Lower',
    gameKey: 'higher_lower',
  },
];

export const DEFAULT_SISTEMA_SETTINGS = {
  slides: PROMO_SLIDE_DEFS.map((s) => ({ id: s.id, visible: true })),
  minigames: MINIGAME_DEFS.map((m) => ({ id: m.id, visible: true })),
};

const KNOWN_SLIDES = new Set(PROMO_SLIDE_DEFS.map((s) => s.id));
const KNOWN_MINIGAMES = new Set(MINIGAME_DEFS.map((m) => m.id));
const CACHE_KEY = '@sistema_settings_v1';

let memoryLoaded = false;
let memoryValue = null;
let inflight = null;

export function normalizeSistemaSettings(raw) {
  const parsed = raw && typeof raw === 'object' ? raw : {};
  const incomingSlides = Array.isArray(parsed.slides) ? parsed.slides : [];
  const incomingMinigames = Array.isArray(parsed.minigames) ? parsed.minigames : [];

  const slideById = new Map();
  incomingSlides.forEach((s, idx) => {
    const id = String(s?.id || '').trim();
    if (!KNOWN_SLIDES.has(id) || slideById.has(id)) return;
    slideById.set(id, { id, visible: !!s.visible, _order: idx });
  });
  DEFAULT_SISTEMA_SETTINGS.slides.forEach((def, idx) => {
    if (!slideById.has(def.id)) {
      slideById.set(def.id, { id: def.id, visible: def.visible, _order: 1000 + idx });
    }
  });
  const slides = [...slideById.values()]
    .sort((a, b) => a._order - b._order)
    .map(({ id, visible }) => ({ id, visible: !!visible }));

  const miniById = new Map();
  incomingMinigames.forEach((m, idx) => {
    const id = String(m?.id || '').trim();
    if (!KNOWN_MINIGAMES.has(id) || miniById.has(id)) return;
    miniById.set(id, { id, visible: !!m.visible, _order: idx });
  });
  DEFAULT_SISTEMA_SETTINGS.minigames.forEach((def, idx) => {
    if (!miniById.has(def.id)) {
      miniById.set(def.id, { id: def.id, visible: def.visible, _order: 1000 + idx });
    }
  });
  const minigames = [...miniById.values()]
    .sort((a, b) => a._order - b._order)
    .map(({ id, visible }) => ({ id, visible: !!visible }));

  const anyMinigameVisible = minigames.some((m) => m.visible);
  return {
    slides: slides.map((s) =>
      s.id === 'minigames' && !anyMinigameVisible ? { ...s, visible: false } : s
    ),
    minigames,
  };
}

function setMemory(value) {
  memoryLoaded = true;
  memoryValue = normalizeSistemaSettings(value);
}

/** Sync: null se non ancora in cache. */
export function peekSistemaSettings() {
  if (!memoryLoaded || !memoryValue) return null;
  return memoryValue;
}

export function seedSistemaSettings(value) {
  setMemory(value);
}

async function readDisk() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed._v === 1 && parsed.settings) {
      return normalizeSistemaSettings(parsed.settings);
    }
  } catch (_) {}
  return null;
}

async function writeDisk(settings) {
  try {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ _v: 1, settings: normalizeSistemaSettings(settings) }),
    );
  } catch (_) {}
}

export function getVisibleMinigames(settings) {
  const normalized = normalizeSistemaSettings(settings);
  return normalized.minigames.filter((m) => m.visible);
}

export function getVisiblePromoSlideIds(settings, { hasMenuGroup = false } = {}) {
  const normalized = normalizeSistemaSettings(settings);
  const anyMinigame = normalized.minigames.some((m) => m.visible);
  return normalized.slides
    .filter((s) => {
      if (!s.visible) return false;
      if (s.id === 'minigames') return anyMinigame && !!hasMenuGroup;
      return true;
    })
    .map((s) => s.id);
}

export async function getSistemaSettings({ force = false } = {}) {
  if (!force && memoryLoaded && memoryValue) {
    void refreshSistemaSettings().catch(() => {});
    return memoryValue;
  }

  if (!force && !memoryLoaded) {
    const disk = await readDisk();
    if (disk) {
      setMemory(disk);
      void refreshSistemaSettings().catch(() => {});
      return disk;
    }
  }

  return refreshSistemaSettings();
}

export async function refreshSistemaSettings() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await api.get('/public/sistema-settings');
      const normalized = normalizeSistemaSettings(res.data);
      setMemory(normalized);
      await writeDisk(normalized);
      return normalized;
    } catch (_) {
      const fallback = normalizeSistemaSettings(DEFAULT_SISTEMA_SETTINGS);
      if (!memoryLoaded) {
        setMemory(fallback);
        await writeDisk(fallback);
      }
      return memoryLoaded ? memoryValue : fallback;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function warmSistemaSettings() {
  return getSistemaSettings().catch(() => normalizeSistemaSettings(DEFAULT_SISTEMA_SETTINGS));
}

export async function saveSistemaSettings(next) {
  const normalized = normalizeSistemaSettings(next);
  const res = await superuserService.updateSistemaSettings(normalized);
  const saved = normalizeSistemaSettings(res.data || normalized);
  setMemory(saved);
  await writeDisk(saved);
  return saved;
}

export function toggleSlideVisible(settings, slideId, visible) {
  const normalized = normalizeSistemaSettings(settings);
  const anyMinigame = normalized.minigames.some((m) => m.visible);
  if (slideId === 'minigames' && visible && !anyMinigame) {
    return normalized;
  }
  return normalizeSistemaSettings({
    ...normalized,
    slides: normalized.slides.map((s) =>
      s.id === slideId ? { ...s, visible: !!visible } : s
    ),
  });
}

export function toggleMinigameVisible(settings, minigameId, visible) {
  const normalized = normalizeSistemaSettings(settings);
  const minigames = normalized.minigames.map((m) =>
    m.id === minigameId ? { ...m, visible: !!visible } : m
  );
  return normalizeSistemaSettings({ ...normalized, minigames });
}

export function moveSlide(settings, slideId, direction) {
  const normalized = normalizeSistemaSettings(settings);
  const slides = [...normalized.slides];
  const visibleIndices = slides
    .map((s, i) => (s.visible ? i : -1))
    .filter((i) => i >= 0);
  const posInVisible = visibleIndices.findIndex((i) => slides[i].id === slideId);
  if (posInVisible < 0) return normalized;
  const targetPos = direction === 'up' ? posInVisible - 1 : posInVisible + 1;
  if (targetPos < 0 || targetPos >= visibleIndices.length) return normalized;
  const from = visibleIndices[posInVisible];
  const to = visibleIndices[targetPos];
  const tmp = slides[from];
  slides[from] = slides[to];
  slides[to] = tmp;
  return normalizeSistemaSettings({ ...normalized, slides });
}

import { useCallback, useRef } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { marketService } from '../services/api';
import {
  patchHomeLeaguesMarketLocked,
  patchMarketBootstrapBlockStatus,
  patchSquadBootstrapBlockStatus,
} from '../services/leagueWarmCache';

export const MARKET_BLOCK_CHANGED = 'marketBlockChanged';

/** Poll leggero: solo GET /market/:id/blocked (no lista giocatori). */
export const MARKET_BLOCK_POLL_MS = 3500;

export function emitMarketBlockChanged(leagueId) {
  const id = Number(leagueId);
  if (!Number.isFinite(id) || id <= 0) return;
  DeviceEventEmitter.emit(MARKET_BLOCK_CHANGED, { leagueId: id });
}

/**
 * Mantiene aggiornato lo stato blocco/sblocco mercato mentre la schermata è in focus,
 * senza rifare il bootstrap pesante (giocatori/rosa).
 */
export function useMarketBlockPoll(leagueId, { onStatus, enabled = true } = {}) {
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const leagueIdRef = useRef(leagueId);
  leagueIdRef.current = leagueId;

  const refresh = useCallback(async () => {
    const id = Number(leagueIdRef.current);
    if (!Number.isFinite(id) || id <= 0) return;
    try {
      const res = await marketService.isBlocked(id);
      const data = res?.data || {};
      const blocked = Boolean(data.blocked);
      const block_reason = String(data.block_reason || 'none');
      const globalBlocked = Boolean(data.global_blocked);
      patchMarketBootstrapBlockStatus(id, { blocked, block_reason });
      patchSquadBootstrapBlockStatus(id, { blocked });
      patchHomeLeaguesMarketLocked(id, globalBlocked);
      onStatusRef.current?.({ blocked, block_reason, global_blocked: globalBlocked });
    } catch (_) {
      /* silent: non disturbare UX se il poll fallisce */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      let cancelled = false;
      let timer = null;

      const tick = async () => {
        if (cancelled) return;
        if (AppState.currentState !== 'active') return;
        await refresh();
      };

      tick();
      timer = setInterval(tick, MARKET_BLOCK_POLL_MS);

      const eventSub = DeviceEventEmitter.addListener(MARKET_BLOCK_CHANGED, (payload) => {
        if (Number(payload?.leagueId) === Number(leagueIdRef.current)) {
          refresh();
        }
      });

      const appSub = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh();
      });

      return () => {
        cancelled = true;
        if (timer) clearInterval(timer);
        eventSub.remove();
        appSub.remove();
      };
    }, [enabled, refresh, leagueId])
  );
}

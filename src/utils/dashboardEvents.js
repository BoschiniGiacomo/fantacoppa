import { DeviceEventEmitter } from 'react-native';

// Set globale di leghe da nascondere nella dashboard
// Popolato da qualsiasi schermata, letto da DashboardScreen in ogni loadLeagues
export const hiddenLeagues = new Set();

// Toast in coda per la dashboard
export let pendingToast = null;

/** Evento: { leagueId, count } — richieste join pending cambiate (admin). */
export const JOIN_REQUESTS_CHANGED = 'JOIN_REQUESTS_CHANGED';

export function hideLeague(leagueId, message) {
  const id = typeof leagueId === 'string' ? parseInt(leagueId) : leagueId;
  hiddenLeagues.add(id);
  if (message) pendingToast = { text: message, type: 'success' };
  // Rimuovi dal filtro dopo 15 secondi (l'API avrà sicuramente finito)
  setTimeout(() => hiddenLeagues.delete(id), 15000);
}

export function showDashboardError(message) {
  pendingToast = { text: message, type: 'error' };
}

export function consumePendingToast() {
  const t = pendingToast;
  pendingToast = null;
  return t;
}

export function emitJoinRequestsChanged(leagueId, count) {
  const id = Number(leagueId);
  const n = Math.max(0, Number(count) || 0);
  if (!Number.isFinite(id) || id <= 0) return;
  DeviceEventEmitter.emit(JOIN_REQUESTS_CHANGED, { leagueId: id, count: n });
}

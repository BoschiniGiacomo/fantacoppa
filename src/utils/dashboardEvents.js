// Set globale di leghe da nascondere nella dashboard
// Popolato da qualsiasi schermata, letto da DashboardScreen in ogni loadLeagues
export const hiddenLeagues = new Set();

// Toast in coda per la dashboard
export let pendingToast = null;

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

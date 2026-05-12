/**
 * Mappa il progresso reale 0–1 in riempimento barra: molto movimento all'inizio,
 * sempre meno pixel per incremento vicino al 100% (ease-out cubico).
 */
export function mapRawProgressToBarFill01(raw) {
  const t = Math.min(1, Math.max(0, Number(raw) || 0));
  return 1 - (1 - t) ** 3;
}

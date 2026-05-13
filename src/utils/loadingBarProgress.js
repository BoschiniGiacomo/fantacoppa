/**
 * Mappa il progresso reale 0–1 in riempimento barra.
 * Ease-out: parte veloce e rallenta alla fine.
 */
export function mapRawProgressToBarFill01(raw) {
  const t = Math.min(1, Math.max(0, Number(raw) || 0));
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

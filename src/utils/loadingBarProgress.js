/**
 * Mappa il progresso reale 0–1 in riempimento barra.
 * Lineare: il valore raw segue le fasi reali (auth + prefetch); evita che la barra
 * sembri già piena a metà bootstrap e poi resti ferma in fondo (comportamento del vecchio ease-out cubico).
 */
export function mapRawProgressToBarFill01(raw) {
  const t = Math.min(1, Math.max(0, Number(raw) || 0));
  return t;
}

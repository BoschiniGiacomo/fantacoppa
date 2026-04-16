/**
 * Geometria anello minuto (senza SVG): due metà con overflow + bordo ruotato.
 * Mappa 0..60 secondi → angoli stabili (niente float strani tra un tick e l’altro).
 * Il gruppo progress è ruotato di -90° così 0% parte dall’alto, senso orario.
 */

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/** Angoli nel sistema locale (0° = destra, senso orario) prima del wrapper -90° sul container. */
export function computeHalfRotations(p) {
  const u = clamp01(p);
  if (u <= 0.5) {
    return { rightDeg: u * 360, leftDeg: 180 };
  }
  const left = 180 + (u - 0.5) * 360;
  return { rightDeg: 180, leftDeg: Math.min(left, 359.998) };
}

/** Indice secondo nel minuto da progress 0..1 (61 stati: 0..60, 60 = giro completo). */
export function progressToSecondIndex(progress) {
  const u = clamp01(progress);
  if (u >= 1 - 1e-9) return 60;
  return Math.min(59, Math.floor(u * 60 + 1e-9));
}

const BY_SECOND = [];
for (let s = 0; s <= 60; s++) {
  const p = s >= 60 ? 1 - 1e-9 : s / 60;
  BY_SECOND[s] = computeHalfRotations(p);
}

export const MINUTE_RING_ROTATIONS_BY_SECOND = BY_SECOND;

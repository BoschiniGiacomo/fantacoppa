/**
 * Distribuzione D-C-A (senza portiere) per N titolari totali (4–11).
 * Sempre 1 portiere + outfield.
 */
const OUTFIELD_BY_STARTERS = {
  4: [1, 1, 1],
  5: [2, 1, 1],
  6: [2, 2, 1],
  7: [2, 2, 2],
  8: [3, 2, 2],
  9: [3, 3, 2],
  10: [3, 3, 3],
  11: [4, 3, 3],
};

export const ROLE_COLORS = {
  P: '#0d6efd',
  D: '#198754',
  C: '#e6a817',
  A: '#dc3545',
};

/**
 * @param {number} startersCount 4–11
 * @returns {{ role: 'P'|'D'|'C'|'A', row: number, indexInRow: number, rowSize: number }[]}
 */
export function buildStartersSlots(startersCount) {
  const n = Math.min(11, Math.max(4, startersCount || 11));
  const [d, c, a] = OUTFIELD_BY_STARTERS[n] || [4, 3, 3];
  const rows = [
    { role: 'A', count: a },
    { role: 'C', count: c },
    { role: 'D', count: d },
    { role: 'P', count: 1 },
  ];
  const slots = [];
  rows.forEach((row, rowIndex) => {
    for (let i = 0; i < row.count; i += 1) {
      slots.push({
        role: row.role,
        row: rowIndex,
        indexInRow: i,
        rowSize: row.count,
      });
    }
  });
  return slots;
}

export function formationLabel(startersCount) {
  const n = Math.min(11, Math.max(4, startersCount || 11));
  const [d, c, a] = OUTFIELD_BY_STARTERS[n] || [4, 3, 3];
  return `1-${d}-${c}-${a}`;
}

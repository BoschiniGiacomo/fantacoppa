export const HIGHER_LOWER_GAME_KEY = 'higher_lower';

export const METRICS = [
  {
    key: 'appearances',
    field: 'appearances',
    /** Usato in “più o meno X …” */
    compareLabel: 'presenze',
    unitLabel: 'presenze',
  },
  {
    key: 'goals',
    field: 'goals',
    compareLabel: 'gol',
    unitLabel: 'gol',
  },
  {
    key: 'trophies',
    field: 'trophies',
    compareLabel: 'trofei',
    unitLabel: 'trofei',
  },
  {
    key: 'teams_count',
    field: 'teams_count',
    compareLabel: 'squadre',
    unitLabel: 'squadre',
    /** Template con {bottom} e {top} (cognomi). */
    promptTemplate: '{bottom} ha giocato per più o meno squadre di {top}?',
  },
  {
    key: 'editions_played',
    field: 'editions_played',
    compareLabel: 'edizioni',
    unitLabel: 'edizioni',
  },
];

function stripBirthYearNameSuffix(name) {
  return String(name || '')
    .replace(/\s*\(\s*'\d{2}\s*\)\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nome corto per la domanda (cognome se disponibile). */
export function promptPlayerName(player, fallback = 'lui') {
  const full = stripBirthYearNameSuffix(player?.name);
  if (!full) return fallback;
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  return parts[parts.length - 1];
}

/**
 * Domanda: cognome del sotto vs cognome del sopra.
 * Es. "Boschini ha più o meno trofei di Bimbi?"
 * Squadre: "Grossi ha giocato per più o meno squadre di Crivaro?"
 */
export function buildComparePrompt(metric, cardA, cardB) {
  const bottomName = promptPlayerName(cardB, 'questo');
  const topName = promptPlayerName(cardA, 'quello');
  if (metric?.promptTemplate) {
    return String(metric.promptTemplate)
      .replace(/\{bottom\}/g, bottomName)
      .replace(/\{top\}/g, topName);
  }
  const label = metric?.compareLabel || metric?.unitLabel || 'valore';
  return `${bottomName} ha più o meno ${label} di ${topName}?`;
}

export function getMetricValue(player, metric) {
  if (!player || !metric) return 0;
  return Number(player[metric.field]) || 0;
}

export function pickRandomMetric(metrics = METRICS, cardA = null, excludeKey = null) {
  const list = Array.isArray(metrics) && metrics.length ? metrics : METRICS;
  const exclude = excludeKey != null ? String(excludeKey) : null;

  const preferred = list.filter((m) => {
    if (exclude && m.key === exclude) return false;
    if (cardA && !(getMetricValue(cardA, m) > 0)) return false;
    return true;
  });
  if (preferred.length) {
    return preferred[Math.floor(Math.random() * preferred.length)];
  }

  const withoutPrev = list.filter((m) => !(exclude && m.key === exclude));
  const pool = withoutPrev.length ? withoutPrev : list;
  if (cardA) {
    const withValue = pool.filter((m) => getMetricValue(cardA, m) > 0);
    if (withValue.length) {
      return withValue[Math.floor(Math.random() * withValue.length)];
    }
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

export const HIGHER_LOWER_GAME_KEY = 'higher_lower';

export const METRICS = [
  {
    key: 'appearances',
    field: 'appearances',
    prompt: 'Chi ha più presenze?',
    unitLabel: 'presenze',
  },
  {
    key: 'goals',
    field: 'goals',
    prompt: 'Chi ha fatto più gol?',
    unitLabel: 'gol',
  },
  {
    key: 'trophies',
    field: 'trophies',
    prompt: 'Chi ha vinto più trofei?',
    unitLabel: 'trofei',
  },
  {
    key: 'teams_count',
    field: 'teams_count',
    prompt: 'Chi ha giocato in più squadre?',
    unitLabel: 'squadre',
  },
  {
    key: 'editions_played',
    field: 'editions_played',
    prompt: 'Chi ha giocato più edizioni?',
    unitLabel: 'edizioni',
  },
];

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

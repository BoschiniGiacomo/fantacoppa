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

export function pickRandomMetric(metrics = METRICS) {
  if (!metrics.length) return METRICS[0];
  return metrics[Math.floor(Math.random() * metrics.length)];
}

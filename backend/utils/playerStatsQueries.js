const { query } = require('../config/database');
const { SQL_WHERE_PRESENCE_VOTE, SQL_WHERE_SCORED_VOTE } = require('./voteRating');

const BONUS_SCORE_SQL = `
  pr.rating
  + CASE WHEN COALESCE(bs.enable_goal, 0) = 1 THEN COALESCE(bs.bonus_goal, 0) * COALESCE(pr.goals, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_assist, 0) = 1 THEN COALESCE(bs.bonus_assist, 0) * COALESCE(pr.assists, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_yellow_card, 0) = 1 THEN COALESCE(bs.malus_yellow_card, 0) * COALESCE(pr.yellow_cards, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_red_card, 0) = 1 THEN COALESCE(bs.malus_red_card, 0) * COALESCE(pr.red_cards, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_goals_conceded, 0) = 1 THEN COALESCE(bs.malus_goals_conceded, 0) * COALESCE(pr.goals_conceded, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_own_goal, 0) = 1 THEN COALESCE(bs.malus_own_goal, 0) * COALESCE(pr.own_goals, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_penalty_missed, 0) = 1 THEN COALESCE(bs.malus_penalty_missed, 0) * COALESCE(pr.penalty_missed, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_penalty_saved, 0) = 1 THEN COALESCE(bs.bonus_penalty_saved, 0) * COALESCE(pr.penalty_saved, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_clean_sheet, 0) = 1 THEN COALESCE(bs.bonus_clean_sheet, 0) * COALESCE(pr.clean_sheet, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_pallone_fuori, 0) = 1 THEN COALESCE(bs.malus_pallone_fuori, 0) * COALESCE(pr.pallone_fuori, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_briso, 0) = 1 THEN COALESCE(bs.bonus_briso, 0) * COALESCE(pr.briso, 0) ELSE 0 END
  + CASE WHEN COALESCE(bs.enable_no_divisa, 0) = 1 THEN COALESCE(bs.malus_no_divisa, 0) * COALESCE(pr.no_divisa, 0) ELSE 0 END
`;

function safeNumber(value, decimals = null) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return decimals == null ? n : Number(n.toFixed(decimals));
}

function safeRate(numerator, denominator, decimals = 2) {
  const num = Number(numerator || 0);
  const den = Number(denominator || 0);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
  return safeNumber(num / den, decimals);
}

function emptyFantaStats() {
  return {
    games_played: 0,
    games_with_rating: 0,
    avg_rating: 0,
    avg_rating_with_bonus: 0,
    team_matchdays: 0,
    presence_pct: 0,
    goals_per_game: 0,
    assists_per_game: 0,
    yellow_cards_per_game: 0,
    red_cards_per_game: 0,
    clean_sheets_per_game: 0,
    penalty_saved_per_game: 0,
    goals_conceded_per_game: 0,
    total_clean_sheets: 0,
    total_penalty_saved: 0,
    total_goals_conceded: 0,
    total_pallone_fuori: 0,
    total_briso: 0,
    total_no_divisa: 0,
  };
}

function emptyAnalytics() {
  return {
    totals: {
      games_played: 0,
      total_goals: 0,
      total_assists: 0,
      total_yellow_cards: 0,
      total_red_cards: 0,
      total_own_goals: 0,
      total_penalty_missed: 0,
      total_clean_sheets: 0,
      total_penalty_saved: 0,
      total_goals_conceded: 0,
      total_briso: 0,
    },
    efficiency: {
      goals_per_presence: 0,
      assists_per_presence: 0,
      goal_involvement_per_presence: 0,
      scored_vote_pct: 0,
      cards_per_presence: 0,
      clean_sheet_pct: 0,
      goals_conceded_per_presence: 0,
    },
    distribution: [
      { label: '<5', count: 0 },
      { label: '5-6', count: 0 },
      { label: '6-6.5', count: 0 },
      { label: '6.5-7', count: 0 },
      { label: '≥7', count: 0 },
    ],
    form_series: [],
    favourite_opponent: null,
  };
}

async function countClusterPlayerNonGhostMatchdays(playerIds, leagueIds) {
  if (!playerIds.length || !leagueIds.length) return 0;

  const playerPh = playerIds.map(() => '?').join(',');
  const leaguesPh = leagueIds.map(() => '?').join(',');

  const rows = await query(
    `SELECT COUNT(*)::int AS team_matchdays
     FROM (
       SELECT DISTINCT md.league_id, md.giornata
       FROM matchdays md
       INNER JOIN teams t ON t.league_id = md.league_id
       INNER JOIN players p ON p.team_id = t.id
       WHERE p.id IN (${playerPh})
         AND md.league_id IN (${leaguesPh})
         AND COALESCE(md.is_ghost, 0) = 0
     ) scoped`,
    [...playerIds, ...leagueIds]
  );

  return Number(rows[0]?.team_matchdays || 0);
}

async function fetchPlayerFantaStats(playerIds, leagueIds) {
  if (!playerIds.length || !leagueIds.length) return emptyFantaStats();

  const playerPh = playerIds.map(() => '?').join(',');
  const leaguesPh = leagueIds.map(() => '?').join(',');
  const params = [...playerIds, ...leagueIds];

  const rows = await query(
    `WITH vote_rows AS (
       SELECT
         pr.league_id,
         pr.giornata,
         pr.player_id,
         pr.rating::float AS rating,
         (${BONUS_SCORE_SQL})::float AS rating_with_bonus,
         COALESCE(pr.goals, 0) AS goals,
         COALESCE(pr.assists, 0) AS assists,
         COALESCE(pr.yellow_cards, 0) AS yellow_cards,
         COALESCE(pr.red_cards, 0) AS red_cards,
         COALESCE(pr.goals_conceded, 0) AS goals_conceded,
         COALESCE(pr.penalty_saved, 0) AS penalty_saved,
         COALESCE(pr.clean_sheet, 0) AS clean_sheet,
         COALESCE(pr.pallone_fuori, 0) AS pallone_fuori,
         COALESCE(pr.briso, 0) AS briso,
         COALESCE(pr.no_divisa, 0) AS no_divisa
       FROM player_ratings pr
       LEFT JOIN league_bonus_settings bs ON bs.league_id = pr.league_id
       INNER JOIN matchdays md
         ON md.league_id = pr.league_id
        AND md.giornata = pr.giornata
        AND COALESCE(md.is_ghost, 0) = 0
       WHERE pr.player_id IN (${playerPh})
         AND pr.league_id IN (${leaguesPh})
         AND pr.rating > 0
     ),
     presence AS (
       SELECT DISTINCT ON (league_id, giornata)
         league_id,
         giornata,
         goals,
         assists,
         yellow_cards,
         red_cards,
         goals_conceded,
         penalty_saved,
         clean_sheet,
         pallone_fuori,
         briso,
         no_divisa
       FROM vote_rows
       ORDER BY league_id, giornata, player_id DESC
     ),
     scored AS (
       SELECT DISTINCT ON (league_id, giornata)
         league_id,
         giornata,
         rating,
         rating_with_bonus
       FROM vote_rows
       WHERE rating > 0
       ORDER BY league_id, giornata, player_id DESC
     )
     SELECT
       (SELECT COUNT(*)::int FROM presence) AS games_played,
       (SELECT COUNT(*)::int FROM scored) AS games_with_rating,
       (SELECT AVG(rating) FROM scored) AS avg_rating,
       (SELECT AVG(rating_with_bonus) FROM scored) AS avg_rating_with_bonus,
       (SELECT COALESCE(SUM(goals), 0) FROM presence) AS total_goals,
       (SELECT COALESCE(SUM(assists), 0) FROM presence) AS total_assists,
       (SELECT COALESCE(SUM(yellow_cards), 0) FROM presence) AS total_yellow_cards,
       (SELECT COALESCE(SUM(red_cards), 0) FROM presence) AS total_red_cards,
       (SELECT COALESCE(SUM(goals_conceded), 0) FROM presence) AS total_goals_conceded,
       (SELECT COALESCE(SUM(penalty_saved), 0) FROM presence) AS total_penalty_saved,
       (SELECT COALESCE(SUM(clean_sheet), 0) FROM presence) AS total_clean_sheets,
       (SELECT COALESCE(SUM(pallone_fuori), 0) FROM presence) AS total_pallone_fuori,
       (SELECT COALESCE(SUM(briso), 0) FROM presence) AS total_briso,
       (SELECT COALESCE(SUM(no_divisa), 0) FROM presence) AS total_no_divisa
     FROM (SELECT 1) AS _one`,
    params
  );

  const r = rows[0] || {};
  const gamesPlayed = Number(r.games_played || 0);
  const teamMatchdays = await countClusterPlayerNonGhostMatchdays(playerIds, leagueIds);

  return {
    games_played: gamesPlayed,
    games_with_rating: gamesPlayed,
    avg_rating: safeNumber(r.avg_rating, 2),
    avg_rating_with_bonus: safeNumber(r.avg_rating_with_bonus, 2),
    team_matchdays: teamMatchdays,
    presence_pct: teamMatchdays > 0 ? safeNumber((gamesPlayed / teamMatchdays) * 100, 1) : 0,
    goals_per_game: safeRate(r.total_goals, gamesPlayed, 2),
    assists_per_game: safeRate(r.total_assists, gamesPlayed, 2),
    yellow_cards_per_game: safeRate(r.total_yellow_cards, gamesPlayed, 2),
    red_cards_per_game: safeRate(r.total_red_cards, gamesPlayed, 2),
    clean_sheets_per_game: safeRate(r.total_clean_sheets, gamesPlayed, 2),
    penalty_saved_per_game: safeRate(r.total_penalty_saved, gamesPlayed, 2),
    goals_conceded_per_game: safeRate(r.total_goals_conceded, gamesPlayed, 2),
    total_clean_sheets: Number(r.total_clean_sheets || 0),
    total_penalty_saved: Number(r.total_penalty_saved || 0),
    total_goals_conceded: Number(r.total_goals_conceded || 0),
    total_pallone_fuori: Number(r.total_pallone_fuori || 0),
    total_briso: Number(r.total_briso || 0),
    total_no_divisa: Number(r.total_no_divisa || 0),
  };
}

function bucketVoteRating(rating) {
  const n = Number(rating);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 5) return '<5';
  if (n < 6) return '5-6';
  if (n < 6.5) return '6-6.5';
  if (n < 7) return '6.5-7';
  return '≥7';
}

function buildDistributionFromRatings(ratings) {
  const buckets = new Map([
    ['<5', 0],
    ['5-6', 0],
    ['6-6.5', 0],
    ['6.5-7', 0],
    ['≥7', 0],
  ]);
  for (const rating of ratings) {
    const key = bucketVoteRating(rating);
    if (key) buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return [...buckets.entries()].map(([label, count]) => ({ label, count }));
}

async function fetchPlayerAnalytics(playerIds, leagueIds, playerRole = '') {
  if (!playerIds.length || !leagueIds.length) return emptyAnalytics();

  const playerPh = playerIds.map(() => '?').join(',');
  const leaguesPh = leagueIds.map(() => '?').join(',');
  const params = [...playerIds, ...leagueIds];

  const [aggregateRows, seriesRows] = await Promise.all([
    query(
      `WITH vote_rows AS (
         SELECT
           pr.league_id,
           pr.giornata,
           pr.player_id,
           pr.rating::float AS rating,
           (${BONUS_SCORE_SQL})::float AS rating_with_bonus,
           COALESCE(pr.goals, 0) AS goals,
           COALESCE(pr.assists, 0) AS assists,
           COALESCE(pr.yellow_cards, 0) AS yellow_cards,
           COALESCE(pr.red_cards, 0) AS red_cards,
           COALESCE(pr.goals_conceded, 0) AS goals_conceded,
           COALESCE(pr.own_goals, 0) AS own_goals,
           COALESCE(pr.penalty_missed, 0) AS penalty_missed,
           COALESCE(pr.penalty_saved, 0) AS penalty_saved,
           COALESCE(pr.clean_sheet, 0) AS clean_sheet,
           COALESCE(pr.briso, 0) AS briso
         FROM player_ratings pr
         LEFT JOIN league_bonus_settings bs ON bs.league_id = pr.league_id
         WHERE pr.player_id IN (${playerPh})
           AND pr.league_id IN (${leaguesPh})
           AND ${SQL_WHERE_PRESENCE_VOTE}
       ),
       presence AS (
         SELECT DISTINCT ON (league_id, giornata)
           league_id,
           giornata,
           goals,
           assists,
           yellow_cards,
           red_cards,
           goals_conceded,
           own_goals,
           penalty_missed,
           penalty_saved,
           clean_sheet,
           briso
         FROM vote_rows
         ORDER BY league_id, giornata, player_id DESC
       ),
       scored AS (
         SELECT DISTINCT ON (league_id, giornata)
           league_id,
           giornata,
           rating
         FROM vote_rows
         WHERE rating > 0
         ORDER BY league_id, giornata, player_id DESC
       )
       SELECT
         (SELECT COUNT(*)::int FROM presence) AS games_played,
         (SELECT COUNT(*)::int FROM scored) AS games_with_rating,
         (SELECT COALESCE(SUM(goals), 0) FROM presence) AS total_goals,
         (SELECT COALESCE(SUM(assists), 0) FROM presence) AS total_assists,
         (SELECT COALESCE(SUM(yellow_cards), 0) FROM presence) AS total_yellow_cards,
         (SELECT COALESCE(SUM(red_cards), 0) FROM presence) AS total_red_cards,
         (SELECT COALESCE(SUM(own_goals), 0) FROM presence) AS total_own_goals,
         (SELECT COALESCE(SUM(penalty_missed), 0) FROM presence) AS total_penalty_missed,
         (SELECT COALESCE(SUM(penalty_saved), 0) FROM presence) AS total_penalty_saved,
         (SELECT COALESCE(SUM(clean_sheet), 0) FROM presence) AS total_clean_sheets,
         (SELECT COALESCE(SUM(goals_conceded), 0) FROM presence) AS total_goals_conceded,
         (SELECT COALESCE(SUM(briso), 0) FROM presence) AS total_briso
       FROM (SELECT 1) AS _one`,
      params
    ),
    query(
      `WITH vote_rows AS (
         SELECT
           pr.league_id,
           pr.giornata,
           pr.player_id,
           pr.rating::float AS rating,
           (${BONUS_SCORE_SQL})::float AS rating_with_bonus
         FROM player_ratings pr
         LEFT JOIN league_bonus_settings bs ON bs.league_id = pr.league_id
         WHERE pr.player_id IN (${playerPh})
           AND pr.league_id IN (${leaguesPh})
           AND ${SQL_WHERE_PRESENCE_VOTE}
       ),
       deduped AS (
         SELECT DISTINCT ON (league_id, giornata)
           league_id,
           giornata,
           rating,
           rating_with_bonus
         FROM vote_rows
         ORDER BY league_id, giornata, player_id DESC
       )
       SELECT
         d.giornata,
         d.rating,
         d.rating_with_bonus,
         NULLIF(to_jsonb(l)->>'reference_year', '')::int AS reference_year
       FROM deduped d
       INNER JOIN leagues l ON l.id = d.league_id
       ORDER BY reference_year ASC NULLS LAST, d.giornata ASC`,
      params
    ),
  ]);

  const agg = aggregateRows[0] || {};
  const gamesPlayed = Number(agg.games_played || 0);
  const gamesWithRating = Number(agg.games_with_rating || 0);
  const totalGoals = Number(agg.total_goals || 0);
  const totalAssists = Number(agg.total_assists || 0);
  const totalYellow = Number(agg.total_yellow_cards || 0);
  const totalRed = Number(agg.total_red_cards || 0);
  const totalCleanSheets = Number(agg.total_clean_sheets || 0);
  const totalPenaltySaved = Number(agg.total_penalty_saved || 0);
  const totalGoalsConceded = Number(agg.total_goals_conceded || 0);
  const role = String(playerRole || '').trim().toUpperCase();

  const scoredRatings = (seriesRows || [])
    .map((row) => Number(row.rating))
    .filter((rating) => Number.isFinite(rating) && rating > 0);

  const favouriteOpponent = await fetchFavouriteOpponent(playerIds, leagueIds, role);

  return {
    totals: {
      games_played: gamesPlayed,
      total_goals: totalGoals,
      total_assists: totalAssists,
      total_yellow_cards: totalYellow,
      total_red_cards: totalRed,
      total_own_goals: Number(agg.total_own_goals || 0),
      total_penalty_missed: Number(agg.total_penalty_missed || 0),
      total_clean_sheets: totalCleanSheets,
      total_penalty_saved: totalPenaltySaved,
      total_goals_conceded: totalGoalsConceded,
      total_briso: Number(agg.total_briso || 0),
    },
    efficiency: {
      goals_per_presence: safeRate(totalGoals, gamesPlayed, 2),
      assists_per_presence: safeRate(totalAssists, gamesPlayed, 2),
      goal_involvement_per_presence: safeRate(totalGoals + totalAssists, gamesPlayed, 2),
      scored_vote_pct: gamesPlayed > 0 ? safeNumber((gamesWithRating / gamesPlayed) * 100, 1) : 0,
      cards_per_presence: safeRate(totalYellow + totalRed, gamesPlayed, 2),
      clean_sheet_pct: role === 'P' && gamesPlayed > 0
        ? safeNumber((totalCleanSheets / gamesPlayed) * 100, 1)
        : 0,
      goals_conceded_per_presence: role === 'P' ? safeRate(totalGoalsConceded, gamesPlayed, 2) : 0,
    },
    distribution: buildDistributionFromRatings(scoredRatings),
    form_series: (seriesRows || []).map((row) => ({
      giornata: Number(row.giornata),
      reference_year: row.reference_year != null ? Number(row.reference_year) : null,
      rating: safeNumber(row.rating, 2),
      rating_with_bonus: safeNumber(row.rating_with_bonus, 2),
      is_scored: Number(row.rating) > 0,
    })),
    favourite_opponent: favouriteOpponent,
  };
}

async function fetchFavouriteOpponent(playerIds, leagueIds, playerRole) {
  if (!playerIds.length || !leagueIds.length) return null;

  const isGoalkeeper = String(playerRole || '').trim().toUpperCase() === 'P';
  const statColumn = isGoalkeeper ? 'clean_sheet' : 'goals';
  const kind = isGoalkeeper ? 'clean_sheets' : 'goals';

  const playerPh = playerIds.map(() => '?').join(',');
  const leaguesPh = leagueIds.map(() => '?').join(',');
  const params = [...playerIds, ...leagueIds];

  try {
    const rows = await query(
      `WITH player_votes AS (
         SELECT
           pr.league_id,
           pr.giornata,
           COALESCE(pr.goals, 0) AS goals,
           COALESCE(pr.clean_sheet, 0) AS clean_sheet,
           p.team_id
         FROM player_ratings pr
         INNER JOIN players p ON p.id = pr.player_id
         WHERE pr.player_id IN (${playerPh})
           AND pr.league_id IN (${leaguesPh})
           AND ${SQL_WHERE_PRESENCE_VOTE}
       ),
       linked AS (
         SELECT pv.*, l.official_match_id
         FROM player_votes pv
         INNER JOIN official_match_matchday_links l
           ON l.league_id = pv.league_id
          AND l.team_id = pv.team_id
          AND l.giornata = pv.giornata
       ),
       with_opponent AS (
         SELECT
           linked.goals,
           linked.clean_sheet,
           CASE
             WHEN m.home_team_id = linked.team_id THEN m.away_team_id
             WHEN m.away_team_id = linked.team_id THEN m.home_team_id
             ELSE NULL
           END AS opponent_team_id
         FROM linked
         INNER JOIN official_matches m ON m.id = linked.official_match_id
       ),
       filtered AS (
         SELECT opponent_team_id,
                CASE WHEN ? = 'goals' THEN goals ELSE clean_sheet END AS stat_value
         FROM with_opponent
         WHERE opponent_team_id IS NOT NULL
       )
       SELECT
         f.opponent_team_id,
         SUM(f.stat_value)::int AS value,
         COALESCE(NULLIF(to_jsonb(t)->>'name',''), NULLIF(t.name,''), '') AS team_name,
         COALESCE(NULLIF(to_jsonb(t)->>'logo_path',''), NULLIF(t.logo_path, ''), '') AS team_logo_path
       FROM filtered f
       INNER JOIN teams t ON t.id = f.opponent_team_id
       WHERE f.stat_value > 0
       GROUP BY f.opponent_team_id, t.name, to_jsonb(t), t.logo_path
       ORDER BY value DESC, team_name ASC
       LIMIT 1`,
      [...params, statColumn]
    );

    const row = rows[0];
    if (!row || Number(row.value || 0) <= 0) return null;

    return {
      kind,
      team_id: Number(row.opponent_team_id) || null,
      team_name: String(row.team_name || '').trim() || null,
      team_logo_path: String(row.team_logo_path || '').trim() || null,
      value: Number(row.value || 0),
    };
  } catch (_) {
    return null;
  }
}

module.exports = {
  BONUS_SCORE_SQL,
  safeNumber,
  safeRate,
  emptyFantaStats,
  emptyAnalytics,
  fetchPlayerFantaStats,
  fetchPlayerAnalytics,
  fetchFavouriteOpponent,
};

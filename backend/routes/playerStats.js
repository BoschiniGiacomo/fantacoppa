const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

async function getLeagueOfficialMeta(leagueId) {
  const rows = await query(
    `SELECT COALESCE(is_official, 0) AS is_official, official_group_id
     FROM leagues
     WHERE id = ?
     LIMIT 1`,
    [leagueId]
  );
  if (!rows.length) return null;
  return {
    is_official: Number(rows[0].is_official || 0),
    official_group_id: rows[0].official_group_id ? Number(rows[0].official_group_id) : null,
  };
}

function safeNumber(value, decimals = null) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return decimals == null ? n : Number(n.toFixed(decimals));
}

function mapStatsRow(statsRow, bonusRow) {
  const s = statsRow || {};
  const b = bonusRow || {};
  return {
    games_played: Number(s.games_played || 0),
    games_with_rating: Number(s.games_with_rating || 0),
    avg_rating: safeNumber(s.avg_rating, 2),
    avg_rating_with_bonus: safeNumber(b.avg_rating_with_bonus, 2),
    total_goals: Number(s.total_goals || 0),
    total_assists: Number(s.total_assists || 0),
    total_yellow_cards: Number(s.total_yellow_cards || 0),
    total_red_cards: Number(s.total_red_cards || 0),
    total_goals_conceded: Number(s.total_goals_conceded || 0),
    total_own_goals: Number(s.total_own_goals || 0),
    total_penalty_missed: Number(s.total_penalty_missed || 0),
    total_penalty_saved: Number(s.total_penalty_saved || 0),
    total_clean_sheets: Number(s.total_clean_sheets || 0),
  };
}

router.get('/:playerId/stats/:leagueId', authenticateToken, async (req, res) => {
  try {
    const playerId = Number(req.params.playerId);
    const leagueId = Number(req.params.leagueId);
    if (!playerId || !leagueId) return res.status(400).json({ message: 'Parametri non validi' });

    const playerRows = await query(
      `SELECT id, first_name, last_name, role, rating
       FROM players
       WHERE id = ?
       LIMIT 1`,
      [playerId]
    );
    if (!playerRows.length) return res.status(404).json({ message: 'Giocatore non trovato' });

    const statsRows = await query(
      `SELECT
         COUNT(DISTINCT giornata) AS games_played,
         AVG(rating) AS avg_rating,
         COALESCE(SUM(goals), 0) AS total_goals,
         COALESCE(SUM(assists), 0) AS total_assists,
         COALESCE(SUM(yellow_cards), 0) AS total_yellow_cards,
         COALESCE(SUM(red_cards), 0) AS total_red_cards,
         COALESCE(SUM(goals_conceded), 0) AS total_goals_conceded,
         COALESCE(SUM(own_goals), 0) AS total_own_goals,
         COALESCE(SUM(penalty_missed), 0) AS total_penalty_missed,
         COALESCE(SUM(penalty_saved), 0) AS total_penalty_saved,
         COALESCE(SUM(clean_sheet), 0) AS total_clean_sheets,
         COUNT(CASE WHEN rating > 0 THEN 1 END) AS games_with_rating
       FROM player_ratings
       WHERE player_id = ? AND league_id = ? AND rating > 0`,
      [playerId, leagueId]
    );

    const bonusRows = await query(
      `SELECT
         AVG(
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
         ) AS avg_rating_with_bonus
       FROM player_ratings pr
       LEFT JOIN league_bonus_settings bs ON bs.league_id = pr.league_id
       WHERE pr.player_id = ? AND pr.league_id = ? AND pr.rating > 0`,
      [playerId, leagueId]
    );

    return res.json({
      player: {
        id: Number(playerRows[0].id),
        first_name: playerRows[0].first_name,
        last_name: playerRows[0].last_name,
        role: playerRows[0].role,
        rating: safeNumber(playerRows[0].rating),
      },
      stats: mapStatsRow(statsRows[0], bonusRows[0]),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento statistiche giocatore', error: error.message });
  }
});

router.get('/:playerId/stats/aggregated/:leagueId', authenticateToken, async (req, res) => {
  try {
    const playerId = Number(req.params.playerId);
    const leagueId = Number(req.params.leagueId);
    if (!playerId || !leagueId) return res.status(400).json({ message: 'Parametri non validi' });

    const leagueMetaRows = await query(
      `SELECT id, linked_to_league_id, COALESCE(is_official, 0) AS is_official, official_group_id
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [leagueId]
    );
    const leagueMeta = leagueMetaRows[0];
    if (!leagueMeta) return res.status(404).json({ message: 'Lega non trovata' });

    let groupId = leagueMeta.official_group_id ? Number(leagueMeta.official_group_id) : null;
    if (!groupId && Number(leagueMeta.linked_to_league_id || 0) > 0) {
      const linkedMeta = await getLeagueOfficialMeta(Number(leagueMeta.linked_to_league_id));
      groupId = linkedMeta?.official_group_id ? Number(linkedMeta.official_group_id) : null;
    }
    if (!groupId) {
      return res.status(404).json({ message: 'Statistiche aggregate non disponibili per questa lega' });
    }

    const playerRows = await query(
      `SELECT id, first_name, last_name, role, rating
       FROM players
       WHERE id = ?
       LIMIT 1`,
      [playerId]
    );
    if (!playerRows.length) return res.status(404).json({ message: 'Giocatore non trovato' });
    const basePlayer = playerRows[0];

    const groupLeagueRows = await query(
      `SELECT id
       FROM leagues
       WHERE official_group_id = ? AND COALESCE(is_official, 0) = 1`,
      [groupId]
    );
    const groupLeagueIds = groupLeagueRows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    if (!groupLeagueIds.length) {
      return res.status(404).json({ message: 'Statistiche aggregate non disponibili per questo gruppo ufficiale' });
    }

    const clusterRows = await query(
      `SELECT DISTINCT pcm2.player_id
       FROM player_clusters pc
       JOIN player_cluster_members pcm1 ON pcm1.cluster_id = pc.id
       JOIN player_cluster_members pcm2 ON pcm2.cluster_id = pc.id
       WHERE pc.official_group_id = ?
         AND pc.status = 'approved'
         AND pcm1.player_id = ?`,
      [groupId, playerId]
    );
    let aggregatedPlayerIds = clusterRows.map((r) => Number(r.player_id)).filter((n) => Number.isFinite(n) && n > 0);

    if (!aggregatedPlayerIds.length) {
      const sameNameRows = await query(
        `SELECT p.id
         FROM players p
         JOIN teams t ON t.id = p.team_id
         JOIN leagues l ON l.id = t.league_id
         WHERE l.official_group_id = ?
           AND COALESCE(l.is_official, 0) = 1
           AND p.role = ?
           AND LOWER(TRIM(COALESCE(p.first_name, ''))) = LOWER(TRIM(COALESCE(?, '')))
           AND LOWER(TRIM(COALESCE(p.last_name, ''))) = LOWER(TRIM(COALESCE(?, '')))`,
        [groupId, basePlayer.role, basePlayer.first_name, basePlayer.last_name]
      );
      aggregatedPlayerIds = sameNameRows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    }

    const idsSet = new Set(aggregatedPlayerIds);
    idsSet.add(playerId);
    aggregatedPlayerIds = Array.from(idsSet);
    if (!aggregatedPlayerIds.length) {
      return res.status(404).json({ message: 'Statistiche aggregate non disponibili per questo giocatore' });
    }

    const playerPh = aggregatedPlayerIds.map(() => '?').join(',');
    const leaguesPh = groupLeagueIds.map(() => '?').join(',');

    const statsRows = await query(
      `SELECT
         COUNT(DISTINCT pr.giornata) AS games_played,
         AVG(pr.rating) AS avg_rating,
         COALESCE(SUM(pr.goals), 0) AS total_goals,
         COALESCE(SUM(pr.assists), 0) AS total_assists,
         COALESCE(SUM(pr.yellow_cards), 0) AS total_yellow_cards,
         COALESCE(SUM(pr.red_cards), 0) AS total_red_cards,
         COALESCE(SUM(pr.goals_conceded), 0) AS total_goals_conceded,
         COALESCE(SUM(pr.own_goals), 0) AS total_own_goals,
         COALESCE(SUM(pr.penalty_missed), 0) AS total_penalty_missed,
         COALESCE(SUM(pr.penalty_saved), 0) AS total_penalty_saved,
         COALESCE(SUM(pr.clean_sheet), 0) AS total_clean_sheets,
         COUNT(CASE WHEN pr.rating > 0 THEN 1 END) AS games_with_rating
       FROM player_ratings pr
       WHERE pr.player_id IN (${playerPh})
         AND pr.league_id IN (${leaguesPh})
         AND pr.rating > 0`,
      [...aggregatedPlayerIds, ...groupLeagueIds]
    );

    const bonusRows = await query(
      `SELECT
         AVG(
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
         ) AS avg_rating_with_bonus
       FROM player_ratings pr
       LEFT JOIN league_bonus_settings bs ON bs.league_id = pr.league_id
       WHERE pr.player_id IN (${playerPh})
         AND pr.league_id IN (${leaguesPh})
         AND pr.rating > 0`,
      [...aggregatedPlayerIds, ...groupLeagueIds]
    );

    return res.json({
      player: {
        id: Number(basePlayer.id),
        first_name: basePlayer.first_name,
        last_name: basePlayer.last_name,
        role: basePlayer.role,
        rating: safeNumber(basePlayer.rating),
      },
      stats: mapStatsRow(statsRows[0], bonusRows[0]),
      meta: {
        official_group_id: groupId,
        leagues_count: groupLeagueIds.length,
        players_count: aggregatedPlayerIds.length,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Errore caricamento statistiche aggregate', error: error.message });
  }
});

module.exports = router;

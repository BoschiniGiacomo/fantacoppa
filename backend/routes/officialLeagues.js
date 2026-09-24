const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// GET /api/official-leagues/available
router.get('/available', authenticateToken, async (_req, res) => {
  try {
    const rows = await query(
      `SELECT
         l.id,
         l.name,
         og.name AS official_group_name,
         og.logo_path AS group_logo_path,
         (
           SELECT COUNT(*)::int
           FROM teams t
           WHERE t.league_id = l.id
         ) AS team_count,
         (
           SELECT COUNT(*)::int
           FROM players p
           INNER JOIN teams t ON t.id = p.team_id
           WHERE t.league_id = l.id
         ) AS player_count,
         (
           SELECT COALESCE(
             json_agg(
               json_build_object(
                 'name', x.name,
                 'logo_path', x.logo_path,
                 'jersey_color', x.jersey_color
               )
             ),
             '[]'::json
           )
           FROM (
             SELECT
               t.name,
               COALESCE(t.logo_path, '') AS logo_path,
               COALESCE(t.jersey_color, '#667eea') AS jersey_color
             FROM teams t
             WHERE t.league_id = l.id
             ORDER BY
               CASE
                 WHEN COALESCE(NULLIF(TRIM(t.logo_path), ''), NULL) IS NOT NULL THEN 0
                 ELSE 1
               END,
               t.name ASC
             LIMIT 8
           ) x
         ) AS team_logos
       FROM leagues l
       LEFT JOIN official_league_groups og ON og.id = l.official_group_id
       WHERE COALESCE(l.is_official, 0) = 1
         AND COALESCE(l.is_visible_for_linking, 1) = 1
       ORDER BY l.name ASC, l.id ASC`
    );

    const normalized = (rows || []).map((r) => {
      let logos = r.team_logos;
      if (typeof logos === 'string') {
        try {
          logos = JSON.parse(logos);
        } catch (_) {
          logos = [];
        }
      }
      if (!Array.isArray(logos)) logos = [];
      return {
        id: r.id,
        name: r.name,
        official_group_name: r.official_group_name || null,
        group_logo_path: r.group_logo_path || null,
        team_count: Number(r.team_count) || 0,
        player_count: Number(r.player_count) || 0,
        team_logos: logos,
      };
    });

    return res.json(normalized);
  } catch (error) {
    console.error('Official leagues available error:', error);
    res.status(500).json({ message: 'Errore caricamento leghe ufficiali disponibili' });
  }
});

module.exports = router;

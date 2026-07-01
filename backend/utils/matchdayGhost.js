const { query } = require('../config/database');

let schemaReady = false;

async function ensureMatchdaysGhostSchema() {
  if (schemaReady) return;
  await query(
    `ALTER TABLE matchdays ADD COLUMN IF NOT EXISTS is_ghost SMALLINT NOT NULL DEFAULT 0`
  );
  schemaReady = true;
}

async function getLeagueMemberRole(userId, leagueId) {
  const rows = await query(
    `SELECT role FROM league_members WHERE user_id = ? AND league_id = ? LIMIT 1`,
    [userId, leagueId]
  );
  return rows[0]?.role != null ? String(rows[0].role) : null;
}

function memberCanSeeGhostMatchdays(role) {
  return role === 'admin' || role === 'pagellatore' || role === 'superuser_viewer';
}

async function userCanSeeGhostMatchdays(userId, leagueId) {
  const role = await getLeagueMemberRole(userId, leagueId);
  return memberCanSeeGhostMatchdays(role);
}

async function isOfficialLeague(leagueId) {
  const rows = await query(
    `SELECT COALESCE(l.is_official, 0)::int AS is_official,
            l.official_group_id,
            COALESCE(pl.is_official, 0)::int AS parent_is_official,
            pl.official_group_id AS parent_official_group_id
     FROM leagues l
     LEFT JOIN leagues pl ON pl.id = l.linked_to_league_id
     WHERE l.id = ?
     LIMIT 1`,
    [leagueId]
  );
  const row = rows[0];
  if (!row) return false;
  if (Number(row.is_official) === 1 || Number(row.parent_is_official) === 1) return true;
  const groupId = Number(row.official_group_id || row.parent_official_group_id || 0);
  return Number.isFinite(groupId) && groupId > 0;
}

async function isGhostMatchday(effectiveLeagueId, giornata) {
  await ensureMatchdaysGhostSchema();
  const g = Number(giornata);
  if (!Number.isFinite(g) || g <= 0) return false;
  const rows = await query(
    `SELECT COALESCE(is_ghost, 0)::int AS is_ghost
     FROM matchdays
     WHERE league_id = ? AND giornata = ?
     LIMIT 1`,
    [effectiveLeagueId, g]
  );
  return Number(rows[0]?.is_ghost) === 1;
}

function filterGhostMatchdaysForUser(rows, canSeeGhost) {
  if (canSeeGhost) return rows || [];
  return (rows || []).filter((r) => Number(r.is_ghost) !== 1);
}

/** Subquery for leagues list: next competitive giornata (excludes ghost). */
const CURRENT_MATCHDAY_SUBQUERY = `(
  SELECT (COALESCE(MAX(mr.giornata), 0) + 1)::int
  FROM matchday_results mr
  INNER JOIN matchdays md_cm
    ON md_cm.league_id = COALESCE(NULLIF(l.linked_to_league_id, 0), l.id)
   AND md_cm.giornata = mr.giornata
   AND COALESCE(md_cm.is_ghost, 0) = 0
  WHERE mr.league_id = l.id
) AS current_matchday`;

module.exports = {
  ensureMatchdaysGhostSchema,
  getLeagueMemberRole,
  memberCanSeeGhostMatchdays,
  userCanSeeGhostMatchdays,
  isOfficialLeague,
  isGhostMatchday,
  filterGhostMatchdaysForUser,
  CURRENT_MATCHDAY_SUBQUERY,
};

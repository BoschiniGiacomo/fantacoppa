const { query } = require('../config/database');

function isMissingDbObjectError(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

/** Tipologia giornata "Gironi" in official_match_stages (default progetto: id = 1). */
const OFFICIAL_MATCH_STAGE_GIRONI_ID = 1;

let leagueOfficialGironiSchemaReady = false;

async function ensureLeagueOfficialGironiSchema() {
  if (leagueOfficialGironiSchemaReady) return;
  try {
    await query(`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS official_two_groups smallint NOT NULL DEFAULT 0`);
  } catch (err) {
    if (!isMissingDbObjectError(err)) throw err;
  }
  await query(`
    CREATE TABLE IF NOT EXISTS league_official_team_gironi (
      league_id integer NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
      team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      girone_index smallint NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (league_id, team_id),
      CONSTRAINT league_official_team_gironi_idx_chk CHECK (girone_index IN (1, 2))
    )
  `);
  leagueOfficialGironiSchemaReady = true;
}

/**
 * @returns {Promise<string|null>} messaggio errore o null se ok / non applicabile
 */
async function assertOfficialGironiTeamsSameGroup(leagueId, matchStageId, homeTeamId, awayTeamId) {
  await ensureLeagueOfficialGironiSchema();
  if (Number(matchStageId) !== OFFICIAL_MATCH_STAGE_GIRONI_ID) return null;
  const lr = await query(
    `SELECT COALESCE(official_two_groups, 0) AS two_g FROM leagues WHERE id = ? LIMIT 1`,
    [leagueId]
  );
  if (!Array.isArray(lr) || !lr.length || Number(lr[0].two_g) !== 1) return null;
  if (
    homeTeamId == null ||
    awayTeamId == null ||
    !Number.isFinite(Number(homeTeamId)) ||
    !Number.isFinite(Number(awayTeamId))
  )
    return null;
  const rows = await query(
    `SELECT team_id, girone_index FROM league_official_team_gironi WHERE league_id = ? AND team_id IN (?, ?)`,
    [leagueId, homeTeamId, awayTeamId]
  );
  const map = new Map((rows || []).map((r) => [Number(r.team_id), Number(r.girone_index)]));
  const gh = map.get(Number(homeTeamId));
  const ga = map.get(Number(awayTeamId));
  if (gh == null || ga == null) {
    return 'Per le partite di gironi questa lega richiede che entrambe le squadre siano assegnate a un girone (Superuser → Ufficiali).';
  }
  if (gh !== ga) {
    return 'Partita di gironi: le due squadre devono appartenere allo stesso girone.';
  }
  return null;
}

module.exports = {
  OFFICIAL_MATCH_STAGE_GIRONI_ID,
  ensureLeagueOfficialGironiSchema,
  assertOfficialGironiTeamsSameGroup,
};

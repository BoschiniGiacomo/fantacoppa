const { query } = require('../config/database');
const { recomputeAndStoreOfficialGroupAbsoluteStats } = require('./officialGroupAbsoluteStatsStore');

const inflightByGroupId = new Map();

async function resolveOfficialGroupIdFromLeague(leagueId) {
  let currentId = Number(leagueId);
  const seen = new Set();

  while (Number.isFinite(currentId) && currentId > 0 && !seen.has(currentId)) {
    seen.add(currentId);
    const leagueMetaRows = await query(
      `SELECT id, linked_to_league_id, official_group_id
       FROM leagues
       WHERE id = ?
       LIMIT 1`,
      [currentId],
    );
    const leagueMeta = leagueMetaRows[0];
    if (!leagueMeta) break;

    const groupId = leagueMeta.official_group_id ? Number(leagueMeta.official_group_id) : null;
    if (groupId) return groupId;

    currentId = Number(leagueMeta.linked_to_league_id || 0);
  }

  return null;
}

async function resolveOfficialGroupIdFromMatch(matchId) {
  const mid = Number(matchId);
  if (!Number.isFinite(mid) || mid <= 0) return null;

  const rows = await query(
    `SELECT competition_id FROM official_matches WHERE id = ? LIMIT 1`,
    [mid],
  );
  const groupId = Number(rows[0]?.competition_id || 0);
  return Number.isFinite(groupId) && groupId > 0 ? groupId : null;
}

async function scheduleOfficialGroupAbsoluteStatsRefresh(groupId) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return null;

  if (inflightByGroupId.has(gid)) {
    return inflightByGroupId.get(gid);
  }

  const job = (async () => {
    try {
      return await recomputeAndStoreOfficialGroupAbsoluteStats(gid);
    } catch (error) {
      console.error('[OfficialGroupAbsoluteStatsRefresh] refresh failed:', {
        groupId: gid,
        message: error?.message || String(error),
      });
      return { upserted: 0, failed: true };
    } finally {
      inflightByGroupId.delete(gid);
    }
  })();

  inflightByGroupId.set(gid, job);
  return job;
}

async function scheduleOfficialGroupAbsoluteStatsRefreshForLeague(leagueId) {
  try {
    const groupId = await resolveOfficialGroupIdFromLeague(leagueId);
    if (!groupId) return null;
    void scheduleOfficialGroupAbsoluteStatsRefresh(groupId);
    return groupId;
  } catch (error) {
    console.error('[OfficialGroupAbsoluteStatsRefresh] resolve league failed:', {
      leagueId,
      message: error?.message || String(error),
    });
    return null;
  }
}

async function scheduleOfficialGroupAbsoluteStatsRefreshForMatch(matchId) {
  try {
    const groupId = await resolveOfficialGroupIdFromMatch(matchId);
    if (!groupId) return null;
    void scheduleOfficialGroupAbsoluteStatsRefresh(groupId);
    return groupId;
  } catch (error) {
    console.error('[OfficialGroupAbsoluteStatsRefresh] resolve match failed:', {
      matchId,
      message: error?.message || String(error),
    });
    return null;
  }
}

module.exports = {
  resolveOfficialGroupIdFromLeague,
  resolveOfficialGroupIdFromMatch,
  scheduleOfficialGroupAbsoluteStatsRefresh,
  scheduleOfficialGroupAbsoluteStatsRefreshForLeague,
  scheduleOfficialGroupAbsoluteStatsRefreshForMatch,
};

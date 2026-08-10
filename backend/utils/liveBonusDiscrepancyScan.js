/**
 * Confronta i bonus “diretta” (official_match_events → buildLiveDirectBonusFromEvents)
 * con i valori salvati in player_ratings per le partite collegate a giornate.
 * Stessa logica usata al salvataggio voti (saveMatchVotes).
 */
const { query } = require('../config/database');
const { isPresenceVoteRating } = require('./voteRating');
const {
  ensureOfficialMatchMatchdayLinksSchema,
  getBonusSettings,
  loadRatingsForGiornata,
  fetchMatchLiveDirectEvents,
  buildLiveDirectBonusFromEvents,
  mergeVoteWithLiveDirect,
  ALL_LIVE_DIRECT_FIELDS,
} = require('./officialMatchMatchdayLinks');

const FIELD_LABELS = {
  goals: 'Gol',
  assists: 'Assist',
  own_goals: 'Autogol',
  yellow_cards: 'Ammonizioni',
  red_cards: 'Espulsioni',
  penalty_missed: 'Rigori sbagliati',
};

function emptyLiveFields() {
  const out = {};
  for (const f of ALL_LIVE_DIRECT_FIELDS) out[f] = 0;
  return out;
}

function pickLiveFields(row) {
  const out = emptyLiveFields();
  for (const f of ALL_LIVE_DIRECT_FIELDS) {
    out[f] = Number(row?.[f] || 0);
  }
  return out;
}

function hasAnyLiveStat(fields) {
  return ALL_LIVE_DIRECT_FIELDS.some((f) => Number(fields?.[f] || 0) !== 0);
}

function diffLiveFields(expected, actual) {
  const diffs = [];
  for (const field of ALL_LIVE_DIRECT_FIELDS) {
    const from_diretta = Number(expected?.[field] || 0);
    const from_voti = Number(actual?.[field] || 0);
    if (from_diretta !== from_voti) {
      diffs.push({
        field,
        label: FIELD_LABELS[field] || field,
        from_diretta,
        from_voti,
        fix_to: from_diretta,
      });
    }
  }
  return diffs;
}

function formatMatchLabel(row) {
  const home = String(row.home_team_name || 'Casa').trim();
  const away = String(row.away_team_name || 'Trasferta').trim();
  const stage = String(row.stage_label || '').trim();
  const kick = row.kickoff_short || row.kickoff_at || null;
  const bits = [`${home} – ${away}`];
  if (stage) bits.push(stage);
  if (kick) bits.push(String(kick));
  return bits.join(' · ');
}

function playerDisplayName(p) {
  const first = String(p.first_name || '').trim();
  const last = String(p.last_name || '').trim();
  return `${first} ${last}`.trim() || `Giocatore #${p.id}`;
}

/**
 * @param {number} groupId
 * @param {{ leagueId?: number|null }} [options]
 */
async function scanOfficialGroupLiveBonusDiscrepancies(groupId, options = {}) {
  await ensureOfficialMatchMatchdayLinksSchema();
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) {
    const err = new Error('ID gruppo non valido');
    err.status = 400;
    throw err;
  }

  const filterLeagueId = options.leagueId != null ? Number(options.leagueId) : null;
  const hasLeagueFilter = Number.isFinite(filterLeagueId) && filterLeagueId > 0;

  const groupRows = await query(
    `SELECT id, name FROM official_league_groups WHERE id = ? LIMIT 1`,
    [gid]
  );
  if (!groupRows.length) {
    const err = new Error('Gruppo ufficiale non trovato');
    err.status = 404;
    throw err;
  }

  const linkRows = await query(
    `SELECT
       l.id AS link_id,
       l.official_match_id AS match_id,
       l.league_id,
       l.team_id,
       l.matchday_id,
       l.giornata,
       t.name AS team_name,
       lg.name AS league_name,
       lg.reference_year,
       COALESCE(NULLIF(lg.linked_to_league_id, 0), lg.id) AS effective_league_id,
       m.kickoff_at,
       to_char((m.kickoff_at AT TIME ZONE 'Europe/Rome'), 'DD/MM/YYYY HH24:MI') AS kickoff_short,
       COALESCE(NULLIF(TRIM(ms.name), ''), '') AS stage_label,
       ht.name AS home_team_name,
       at.name AS away_team_name,
       m.home_team_id,
       m.away_team_id
     FROM official_match_matchday_links l
     INNER JOIN official_matches m ON m.id = l.official_match_id
     INNER JOIN teams t ON t.id = l.team_id
     INNER JOIN leagues lg ON lg.id = l.league_id
     LEFT JOIN teams ht ON ht.id = m.home_team_id
     LEFT JOIN teams at ON at.id = m.away_team_id
     LEFT JOIN official_match_stages ms
       ON ms.id = NULLIF(to_jsonb(m)->>'match_stage_id','')::int
     WHERE lg.official_group_id = ?
       AND (
         m.competition_id = ?
         OR m.league_id IN (SELECT id FROM leagues WHERE official_group_id = ?)
       )
       ${hasLeagueFilter ? 'AND l.league_id = ?' : ''}
     ORDER BY
       lg.reference_year DESC NULLS LAST,
       m.kickoff_at ASC NULLS LAST,
       m.id ASC,
       l.team_id ASC`,
    hasLeagueFilter ? [gid, gid, gid, filterLeagueId] : [gid, gid, gid]
  );

  if (!linkRows.length) {
    return {
      group_id: gid,
      group_name: groupRows[0].name,
      scanned_matches: 0,
      scanned_links: 0,
      discrepancy_count: 0,
      player_count: 0,
      match_count: 0,
      matches: [],
      players: [],
    };
  }

  const matchIds = [...new Set(linkRows.map((r) => Number(r.match_id)).filter((n) => n > 0))];
  const teamIds = [...new Set(linkRows.map((r) => Number(r.team_id)).filter((n) => n > 0))];
  const leagueIds = [...new Set(linkRows.map((r) => Number(r.league_id)).filter((n) => n > 0))];

  const [playersRows, clusterRows, ...bonusSettingChunks] = await Promise.all([
    teamIds.length
      ? query(
          `SELECT p.id, p.first_name, p.last_name, p.role, p.team_id, t.name AS team_name
           FROM players p
           INNER JOIN teams t ON t.id = p.team_id
           WHERE p.team_id IN (${teamIds.map(() => '?').join(', ')})
           ORDER BY p.team_id ASC, p.last_name ASC, p.first_name ASC`,
          teamIds
        )
      : Promise.resolve([]),
    query(
      `SELECT pc.id AS cluster_id, pcm.player_id,
              (
                SELECT TRIM(CONCAT(COALESCE(p2.first_name, ''), ' ', COALESCE(p2.last_name, '')))
                FROM player_cluster_members pcm2
                INNER JOIN players p2 ON p2.id = pcm2.player_id
                WHERE pcm2.cluster_id = pc.id
                ORDER BY pcm2.created_at ASC, pcm2.player_id ASC
                LIMIT 1
              ) AS cluster_name
       FROM player_clusters pc
       INNER JOIN player_cluster_members pcm ON pcm.cluster_id = pc.id
       WHERE pc.official_group_id = ?
         AND pc.status = 'approved'`,
      [gid]
    ).catch(() => []),
    ...leagueIds.map((lid) => getBonusSettings(lid).then((s) => [lid, s])),
  ]);

  const playersByTeam = new Map();
  const playerById = new Map();
  for (const p of playersRows || []) {
    const pid = Number(p.id);
    const tid = Number(p.team_id);
    if (!playersByTeam.has(tid)) playersByTeam.set(tid, []);
    playersByTeam.get(tid).push(p);
    playerById.set(pid, p);
  }

  const clusterByPlayer = new Map();
  for (const c of clusterRows || []) {
    const pid = Number(c.player_id);
    if (!pid) continue;
    clusterByPlayer.set(pid, {
      cluster_id: Number(c.cluster_id),
      cluster_name: String(c.cluster_name || '').trim() || null,
    });
  }

  const bonusByLeague = new Map(bonusSettingChunks);

  // Events per match (batch)
  const eventsByMatch = new Map();
  await Promise.all(
    matchIds.map(async (mid) => {
      eventsByMatch.set(mid, await fetchMatchLiveDirectEvents(mid));
    })
  );

  // Ratings keyed by effectiveLeagueId|giornata
  const ratingJobs = new Map();
  for (const link of linkRows) {
    const eff = Number(link.effective_league_id);
    const g = Number(link.giornata);
    const tid = Number(link.team_id);
    if (!eff || !g) continue;
    const key = `${eff}|${g}`;
    if (!ratingJobs.has(key)) ratingJobs.set(key, { leagueId: eff, giornata: g, playerIds: new Set() });
    for (const p of playersByTeam.get(tid) || []) {
      ratingJobs.get(key).playerIds.add(Number(p.id));
    }
  }

  const ratingsByKey = new Map();
  await Promise.all(
    [...ratingJobs.entries()].map(async ([key, job]) => {
      const ids = [...job.playerIds];
      const map = await loadRatingsForGiornata(job.leagueId, job.giornata, ids.length ? ids : null);
      ratingsByKey.set(key, map);
    })
  );

  /** @type {Map<number, any>} */
  const matchBuckets = new Map();
  /** @type {Map<string, any>} */
  const playerAgg = new Map();

  for (const link of linkRows) {
    const matchId = Number(link.match_id);
    const teamId = Number(link.team_id);
    const leagueId = Number(link.league_id);
    const giornata = Number(link.giornata);
    const effectiveLeagueId = Number(link.effective_league_id);
    const teamPlayers = playersByTeam.get(teamId) || [];
    if (!teamPlayers.length || !giornata) continue;

    const playerIds = teamPlayers.map((p) => Number(p.id));
    const bonusSettings = bonusByLeague.get(leagueId) || null;
    const events = eventsByMatch.get(matchId) || [];
    const liveByPlayer = buildLiveDirectBonusFromEvents(events, bonusSettings, playerIds);
    const ratings = ratingsByKey.get(`${effectiveLeagueId}|${giornata}`) || {};

    for (const p of teamPlayers) {
      const pid = Number(p.id);
      const dbVote = ratings[String(pid)] || ratings[pid] || null;
      const liveRow = liveByPlayer[pid] || null;
      const expected = pickLiveFields(mergeVoteWithLiveDirect(dbVote || {}, liveRow));
      const actual = pickLiveFields(dbVote || {});
      const diffs = diffLiveFields(expected, actual);

      const hasDb = !!dbVote;
      const hasPresence = hasDb && isPresenceVoteRating(dbVote.rating);
      const liveRelevant = !!liveRow || hasAnyLiveStat(actual);

      if (!diffs.length) continue;
      // Evita rumore: solo se c'è almeno un voto salvato, oppure eventi live per il giocatore
      if (!hasDb && !liveRow) continue;
      if (!liveRelevant && !hasAnyLiveStat(expected)) continue;

      const issueType = !hasDb
        ? 'missing_votes'
        : !hasPresence && hasAnyLiveStat(expected)
          ? 'no_presence_with_diretta'
          : 'field_mismatch';

      const cluster = clusterByPlayer.get(pid) || null;
      const fixHints = diffs.map(
        (d) => `${d.label}: voti=${d.from_voti} → diretta=${d.fix_to}`
      );

      const entry = {
        player_id: pid,
        player_name: playerDisplayName(p),
        role: String(p.role || '').trim().toUpperCase() || null,
        team_id: teamId,
        team_name: String(link.team_name || p.team_name || '').trim(),
        league_id: leagueId,
        league_name: String(link.league_name || '').trim(),
        reference_year: link.reference_year != null ? Number(link.reference_year) : null,
        giornata,
        matchday_id: Number(link.matchday_id) || null,
        issue_type: issueType,
        has_votes_row: hasDb,
        has_presence_vote: hasPresence,
        cluster_id: cluster?.cluster_id || null,
        cluster_name: cluster?.cluster_name || null,
        is_cluster: !!cluster,
        expected,
        actual,
        diffs,
        fix_summary: fixHints.join(' · '),
      };

      if (!matchBuckets.has(matchId)) {
        matchBuckets.set(matchId, {
          match_id: matchId,
          label: formatMatchLabel(link),
          kickoff_at: link.kickoff_at || null,
          home_team_name: String(link.home_team_name || '').trim(),
          away_team_name: String(link.away_team_name || '').trim(),
          stage_label: String(link.stage_label || '').trim() || null,
          league_id: leagueId,
          league_name: String(link.league_name || '').trim(),
          reference_year: link.reference_year != null ? Number(link.reference_year) : null,
          players: [],
        });
      }
      matchBuckets.get(matchId).players.push(entry);

      const aggKey = cluster ? `c:${cluster.cluster_id}` : `p:${pid}`;
      if (!playerAgg.has(aggKey)) {
        playerAgg.set(aggKey, {
          key: aggKey,
          kind: cluster ? 'cluster' : 'player',
          cluster_id: cluster?.cluster_id || null,
          cluster_name: cluster?.cluster_name || null,
          player_id: cluster ? null : pid,
          player_name: cluster ? cluster.cluster_name || playerDisplayName(p) : playerDisplayName(p),
          member_player_ids: cluster ? [] : [pid],
          total_diffs: 0,
          matches_affected: [],
          field_totals: emptyLiveFields(),
          field_totals_voti: emptyLiveFields(),
          field_totals_diretta: emptyLiveFields(),
        });
      }
      const agg = playerAgg.get(aggKey);
      if (cluster && !agg.member_player_ids.includes(pid)) {
        agg.member_player_ids.push(pid);
      }
      agg.total_diffs += diffs.length;
      for (const f of ALL_LIVE_DIRECT_FIELDS) {
        agg.field_totals_diretta[f] += Number(expected[f] || 0);
        agg.field_totals_voti[f] += Number(actual[f] || 0);
        agg.field_totals[f] += Number(expected[f] || 0) - Number(actual[f] || 0);
      }
      agg.matches_affected.push({
        match_id: matchId,
        label: formatMatchLabel(link),
        giornata,
        team_name: entry.team_name,
        player_id: pid,
        player_name: entry.player_name,
        reference_year: entry.reference_year,
        issue_type: issueType,
        fix_summary: entry.fix_summary,
        diffs,
      });
    }
  }

  const matches = [...matchBuckets.values()]
    .map((m) => ({
      ...m,
      player_count: m.players.length,
      discrepancy_count: m.players.reduce((n, p) => n + p.diffs.length, 0),
    }))
    .sort((a, b) => {
      const ay = a.reference_year || 0;
      const by = b.reference_year || 0;
      if (by !== ay) return by - ay;
      const at = a.kickoff_at ? new Date(a.kickoff_at).getTime() : 0;
      const bt = b.kickoff_at ? new Date(b.kickoff_at).getTime() : 0;
      return at - bt;
    });

  const players = [...playerAgg.values()]
    .map((p) => {
      const netDiffs = ALL_LIVE_DIRECT_FIELDS.filter((f) => Number(p.field_totals[f] || 0) !== 0).map((f) => ({
        field: f,
        label: FIELD_LABELS[f] || f,
        diretta_sum: Number(p.field_totals_diretta[f] || 0),
        voti_sum: Number(p.field_totals_voti[f] || 0),
        delta: Number(p.field_totals[f] || 0),
      }));
      return {
        ...p,
        match_count: p.matches_affected.length,
        net_field_diffs: netDiffs,
        net_summary: netDiffs
          .map((d) => `${d.label}: voti=${d.voti_sum} · diretta=${d.diretta_sum}`)
          .join(' · '),
      };
    })
    .sort((a, b) => b.match_count - a.match_count || String(a.player_name).localeCompare(String(b.player_name)));

  const discrepancy_count = matches.reduce((n, m) => n + m.discrepancy_count, 0);

  return {
    group_id: gid,
    group_name: groupRows[0].name,
    scanned_matches: matchIds.length,
    scanned_links: linkRows.length,
    discrepancy_count,
    player_count: players.length,
    match_count: matches.length,
    field_labels: FIELD_LABELS,
    matches,
    players,
  };
}

module.exports = {
  scanOfficialGroupLiveBonusDiscrepancies,
  FIELD_LABELS,
  ALL_LIVE_DIRECT_FIELDS,
};

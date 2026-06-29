/** Normalizzazione nome squadra (allineata a matches.js). */
function normalizeTeamNameForStorage(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '');
}

function slugifyForFilename(norm, maxLen = 48) {
  const slug = String(norm || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen);
  return slug || 'team';
}

/** Prefisso file: official_team_g{groupId}_{slug}_ */
function buildOfficialTeamLogoPrefix(groupId, teamName) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return null;
  const slug = slugifyForFilename(normalizeTeamNameForStorage(teamName));
  return `official_team_g${gid}_${slug}_`;
}

function buildOfficialTeamLogoFilename(groupId, teamName, ext, ts = Math.floor(Date.now() / 1000)) {
  const prefix = buildOfficialTeamLogoPrefix(groupId, teamName);
  if (!prefix) return null;
  const safeExt = String(ext || '.png').toLowerCase();
  return `${prefix}${ts}${safeExt.startsWith('.') ? safeExt : `.${safeExt}`}`;
}

function buildPlayerClusterPhotoFilename(clusterId, ext, ts, rand) {
  const cid = Number(clusterId);
  if (!Number.isFinite(cid) || cid <= 0) return null;
  const safeExt = String(ext || '.jpg').toLowerCase();
  const r = String(rand || Math.random().toString(36).slice(2, 8));
  return `player_cluster_${cid}_${ts}_${r}${safeExt.startsWith('.') ? safeExt : `.${safeExt}`}`;
}

function buildPlayerSoloPhotoFilename(playerId, ext, ts, rand) {
  const pid = Number(playerId);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  const safeExt = String(ext || '.jpg').toLowerCase();
  const r = String(rand || Math.random().toString(36).slice(2, 8));
  return `player_solo_${pid}_${ts}_${r}${safeExt.startsWith('.') ? safeExt : `.${safeExt}`}`;
}

/** Estrae timestamp da nomi file legacy o canonici. */
function extractUploadTimestamp(filename) {
  const name = String(filename || '');
  const m =
    name.match(/_(\d{10,13})_[a-z0-9]+\.[a-z]+$/i) ||
    name.match(/_(\d{10})\.[a-z]+$/i) ||
    name.match(/_(\d{10,13})\.[a-z]+$/i);
  return m ? Number(m[1]) : 0;
}

module.exports = {
  normalizeTeamNameForStorage,
  slugifyForFilename,
  buildOfficialTeamLogoPrefix,
  buildOfficialTeamLogoFilename,
  buildPlayerClusterPhotoFilename,
  buildPlayerSoloPhotoFilename,
  extractUploadTimestamp,
};

const { buildOfficialTeamLogoPrefix } = require('./mediaCanonical');

async function listStorageFilenames(supabase, folder, limit = 2000) {
  const { data, error } = await supabase.storage.from('uploads').list(folder, { limit });
  if (error || !Array.isArray(data)) return [];
  return data.map((f) => String(f?.name || '').trim()).filter(Boolean);
}

async function removeStoragePaths(supabase, relativePaths) {
  const paths = (relativePaths || []).map((p) => String(p).replace(/^uploads\//, '')).filter(Boolean);
  if (!paths.length || !supabase) return;
  await supabase.storage.from('uploads').remove(paths).catch(() => {});
}

/** Rimuove vecchi logo per (gruppo ufficiale, nome squadra) e formati legacy per team_id. */
async function removeOfficialTeamLogoVariants(supabase, { groupId, teamName, teamIds = [] }) {
  const folder = 'official_team_logos';
  const names = await listStorageFilenames(supabase, folder);
  if (!names.length) return;

  const prefix = buildOfficialTeamLogoPrefix(groupId, teamName);
  const teamIdSet = new Set((teamIds || []).map((id) => Number(id)).filter((id) => id > 0));
  const toDelete = names
    .filter((name) => {
      if (prefix && name.startsWith(prefix)) return true;
      for (const tid of teamIdSet) {
        if (name.startsWith(`official_team_${tid}_`)) return true;
        if (new RegExp(`^official_team_${tid}\\.(jpg|jpeg|png|webp)$`, 'i').test(name)) return true;
      }
      return false;
    })
    .map((name) => `${folder}/${name}`);

  await removeStoragePaths(supabase, toDelete);
}

/** Rimuove foto precedenti del cluster o del singolo giocatore. */
async function removePlayerPhotoVariants(supabase, { clusterId, playerId, memberPlayerIds = [] }) {
  const folder = 'player_photos';
  const names = await listStorageFilenames(supabase, folder);
  if (!names.length) return;

  const cid = Number(clusterId);
  const memberSet = new Set((memberPlayerIds || []).map((id) => Number(id)).filter((id) => id > 0));
  if (Number.isFinite(playerId) && playerId > 0) memberSet.add(Number(playerId));

  const toDelete = names.filter((name) => {
    if (Number.isFinite(cid) && cid > 0 && name.startsWith(`player_cluster_${cid}_`)) return true;
    for (const pid of memberSet) {
      if (name.startsWith(`player_${pid}_`)) return true;
      if (name.startsWith(`player_solo_${pid}_`)) return true;
    }
    return false;
  }).map((name) => `${folder}/${name}`);

  await removeStoragePaths(supabase, toDelete);
}

module.exports = {
  listStorageFilenames,
  removeStoragePaths,
  removeOfficialTeamLogoVariants,
  removePlayerPhotoVariants,
};

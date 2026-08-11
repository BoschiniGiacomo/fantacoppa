import {
  leagueService,
  teamsService,
  squadService,
  formationService,
} from './api';
import { hiddenLeagues } from '../utils/dashboardEvents';
import { parseAppDate } from '../utils/dateTime';

/** Dati mostrabili subito dopo prefetch; la schermata rifà la fetch salvo warm molto fresco. */
export const WARM_MAX_AGE_MS = 120000;
/**
 * Skip rete solo se il warm è più fresco di così (tipicamente subito dopo login/prefetch).
 * Oltre questa soglia: paint da warm + refetch obbligatorio → niente dati “vecchi” ambigui.
 */
export const WARM_NETWORK_SKIP_MAX_AGE_MS = 30000;


const dashboardById = new Map();
const leagueDetailById = new Map();
const teamsRowsById = new Map();
const marketBootstrapById = new Map();
const squadBootstrapById = new Map();
const standingsFullById = new Map();
const formationMatchdaysById = new Map();
const leagueSettingsById = new Map();
const squadPlayersDataById = new Map();
const formationPayloadByKey = new Map();
const teamDetailByKey = new Map();

/** Lista leghe (GET /leagues) salvata durante prefetch bootstrap: primo paint Dashboard senza secondo spinner full-screen. */
let homeLeaguesBootstrapSnapshot = null;

function filterLeaguesForDashboardVisibility(normalizedList) {
  const list = Array.isArray(normalizedList) ? normalizedList : [];
  return hiddenLeagues.size > 0 ? list.filter((l) => !hiddenLeagues.has(l.id)) : list;
}

export function setHomeLeaguesBootstrapSnapshot(normalizedList) {
  homeLeaguesBootstrapSnapshot = {
    leagues: filterLeaguesForDashboardVisibility(normalizedList),
    ts: Date.now(),
  };
}

/** null = nessuno snapshot; array (anche vuota) = dati freschi per la home dopo bootstrap. */
export function peekHomeLeaguesBootstrapSnapshot() {
  if (!homeLeaguesBootstrapSnapshot) return null;
  if (Date.now() - homeLeaguesBootstrapSnapshot.ts > 180000) return null;
  return homeLeaguesBootstrapSnapshot.leagues;
}

export function clearHomeLeaguesBootstrapSnapshot() {
  homeLeaguesBootstrapSnapshot = null;
}

function nid(leagueId) {
  const n = Number(leagueId);
  return Number.isFinite(n) ? n : null;
}

function isStale(row) {
  return !row || Date.now() - row.ts > WARM_MAX_AGE_MS;
}

function warmMetaFromRow(row) {
  if (isStale(row)) return null;
  const ageMs = Date.now() - row.ts;
  return {
    ageMs,
    skipNetwork: ageMs >= 0 && ageMs <= WARM_NETWORK_SKIP_MAX_AGE_MS,
  };
}

/** Meta warm per decidere se saltare il refetch rete (null = assente/scaduto per display). */
export function getDashboardWarmMeta(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  return warmMetaFromRow(dashboardById.get(id));
}

export function getLeagueDetailWarmMeta(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  return warmMetaFromRow(leagueDetailById.get(id));
}

export function getTeamsRowsWarmMeta(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  return warmMetaFromRow(teamsRowsById.get(id));
}

export function getMarketBootstrapWarmMeta(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  return warmMetaFromRow(marketBootstrapById.get(id));
}

export function getSquadBootstrapWarmMeta(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  return warmMetaFromRow(squadBootstrapById.get(id));
}

export function getStandingsFullWarmMeta(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  return warmMetaFromRow(standingsFullById.get(id));
}

export function getFormationMatchdaysWarmMeta(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  return warmMetaFromRow(formationMatchdaysById.get(id));
}

export function getLeagueSettingsWarmMeta(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  return warmMetaFromRow(leagueSettingsById.get(id));
}

export function getSquadPlayersWarmMeta(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  return warmMetaFromRow(squadPlayersDataById.get(id));
}

export function getTeamDetailWarmMeta(leagueId, userId) {
  const lid = nid(leagueId);
  const uid = nid(userId);
  if (lid == null || uid == null) return null;
  return warmMetaFromRow(teamDetailByKey.get(`${lid}:${uid}`));
}

/** true solo se tutti i meta esistono e sono in finestra skip. */
export function canSkipWarmNetwork(metas) {
  const list = Array.isArray(metas) ? metas : [];
  if (!list.length) return false;
  return list.every((m) => m && m.skipNetwork === true);
}


export function peekDashboard(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  const row = dashboardById.get(id);
  if (isStale(row)) return null;
  return row.payload;
}

export function setDashboard(leagueId, payload) {
  const id = nid(leagueId);
  if (id == null) return;
  dashboardById.set(id, { payload: payload && typeof payload === 'object' ? payload : {}, ts: Date.now() });
}

export function peekLeagueDetail(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  const row = leagueDetailById.get(id);
  if (isStale(row)) return null;
  return row.data;
}

export function setLeagueDetail(leagueId, data) {
  const id = nid(leagueId);
  if (id == null) return;
  leagueDetailById.set(id, { data, ts: Date.now() });
}

/** null = nessuna cache; array (anche vuota) = cache valida */
export function peekTeamsRows(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  const row = teamsRowsById.get(id);
  if (isStale(row)) return null;
  return Array.isArray(row.rows) ? row.rows : [];
}

export function setTeamsRows(leagueId, rows) {
  const id = nid(leagueId);
  if (id == null) return;
  teamsRowsById.set(id, { rows: Array.isArray(rows) ? rows : [], ts: Date.now() });
}

/** Mercato con filtri default (tutti i ruoli, senza ricerca) — come all’ingresso in MarketScreen */
export function peekMarketBootstrapDefault(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  const row = marketBootstrapById.get(id);
  if (isStale(row)) return null;
  return row.data && typeof row.data === 'object' ? row.data : null;
}

export function setMarketBootstrapDefault(leagueId, data) {
  const id = nid(leagueId);
  if (id == null) return;
  marketBootstrapById.set(id, { data: data && typeof data === 'object' ? data : {}, ts: Date.now() });
}

export function peekSquadBootstrap(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  const row = squadBootstrapById.get(id);
  if (isStale(row)) return null;
  return row.data && typeof row.data === 'object' ? row.data : null;
}

export function setSquadBootstrap(leagueId, data) {
  const id = nid(leagueId);
  if (id == null) return;
  if (!data || typeof data !== 'object') return;
  // Evita di avvelenare il warm con payload errore/vuoti non strutturati.
  if (data.message && data.role_limits == null && data.league == null && data.players == null && data.squad == null) {
    return;
  }
  squadBootstrapById.set(id, { data, ts: Date.now() });
}

export function setSquadPlayersData(leagueId, data) {
  const id = nid(leagueId);
  if (id == null) return;
  if (!data || typeof data !== 'object') return;
  squadPlayersDataById.set(id, { data, ts: Date.now() });
}

/** Aggiorna solo lo stato blocco mercato nel warm (senza invalidare lista giocatori/budget). */
export function patchMarketBootstrapBlockStatus(leagueId, { blocked, block_reason } = {}) {
  const id = nid(leagueId);
  if (id == null) return;
  const row = marketBootstrapById.get(id);
  if (!row?.data || typeof row.data !== 'object') return;
  const nextBlocked = Boolean(blocked);
  const nextReason = String(block_reason || (nextBlocked ? 'global' : 'none'));
  row.data = {
    ...row.data,
    blocked: nextBlocked,
    market_blocked: nextBlocked,
    block_reason: nextReason,
  };
}

export function patchSquadBootstrapBlockStatus(leagueId, { blocked } = {}) {
  const id = nid(leagueId);
  if (id == null) return;
  const row = squadBootstrapById.get(id);
  if (!row?.data || typeof row.data !== 'object') return;
  row.data = {
    ...row.data,
    market_blocked: Boolean(blocked),
  };
}

/** Aggiorna badge mercato nella snapshot home senza rifare GET /leagues. */
export function patchHomeLeaguesMarketLocked(leagueId, marketLocked) {
  const id = nid(leagueId);
  if (id == null || !homeLeaguesBootstrapSnapshot?.leagues) return;
  const locked = marketLocked ? 1 : 0;
  homeLeaguesBootstrapSnapshot.leagues = homeLeaguesBootstrapSnapshot.leagues.map((l) =>
    Number(l?.id) === id ? { ...l, market_locked: locked } : l
  );
  const dash = dashboardById.get(id);
  if (dash?.payload && typeof dash.payload === 'object') {
    dash.payload = { ...dash.payload, market_locked: locked };
  }
}

export function peekStandingsFull(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  const row = standingsFullById.get(id);
  if (isStale(row)) return null;
  return row.data;
}

export function setStandingsFull(leagueId, data) {
  const id = nid(leagueId);
  if (id == null) return;
  standingsFullById.set(id, { data, ts: Date.now() });
}

/** null = assente; [] = nessuna giornata */
export function peekFormationMatchdays(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  const row = formationMatchdaysById.get(id);
  if (isStale(row)) return null;
  return Array.isArray(row.matchdays) ? row.matchdays : [];
}

export function setFormationMatchdays(leagueId, matchdays) {
  const id = nid(leagueId);
  if (id == null) return;
  formationMatchdaysById.set(id, {
    matchdays: Array.isArray(matchdays) ? matchdays : [],
    ts: Date.now(),
  });
}

export function peekLeagueSettings(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  const row = leagueSettingsById.get(id);
  if (isStale(row)) return null;
  return row.data && typeof row.data === 'object' ? row.data : null;
}

export function setLeagueSettings(leagueId, data) {
  const id = nid(leagueId);
  if (id == null) return;
  leagueSettingsById.set(id, { data: data && typeof data === 'object' ? data : {}, ts: Date.now() });
}

/** Risposta grezza di GET /squad/:leagueId (oggetto con players, ecc.) */
export function peekSquadPlayersData(leagueId) {
  const id = nid(leagueId);
  if (id == null) return null;
  const row = squadPlayersDataById.get(id);
  if (isStale(row)) return null;
  return row.data && typeof row.data === 'object' ? row.data : null;
}

function formationPayloadKey(leagueId, giornata) {
  const lid = nid(leagueId);
  const g = Number(giornata);
  if (lid == null || !Number.isFinite(g)) return null;
  return `${lid}:${g}`;
}

/** null = non in cache */
export function peekFormationPayload(leagueId, giornata) {
  const k = formationPayloadKey(leagueId, giornata);
  if (!k) return null;
  const row = formationPayloadByKey.get(k);
  if (isStale(row)) return null;
  return row.payload != null ? row.payload : null;
}

export function getFormationPayloadWarmMeta(leagueId, giornata) {
  const k = formationPayloadKey(leagueId, giornata);
  if (!k) return null;
  return warmMetaFromRow(formationPayloadByKey.get(k));
}

export function setFormationPayload(leagueId, giornata, payload) {
  const k = formationPayloadKey(leagueId, giornata);
  if (!k) return;
  formationPayloadByKey.set(k, { payload, ts: Date.now() });
}

export function peekTeamDetail(leagueId, userId) {
  const lid = nid(leagueId);
  const uid = nid(userId);
  if (lid == null || uid == null) return null;
  const k = `${lid}:${uid}`;
  const row = teamDetailByKey.get(k);
  if (isStale(row)) return null;
  return row.payload && typeof row.payload === 'object' ? row.payload : null;
}

export function setTeamDetail(leagueId, userId, payload) {
  const lid = nid(leagueId);
  const uid = nid(userId);
  if (lid == null || uid == null) return;
  const k = `${lid}:${uid}`;
  teamDetailByKey.set(k, { payload: payload && typeof payload === 'object' ? payload : {}, ts: Date.now() });
}

export function pickDefaultFormationGiornata(matchdays) {
  const md = Array.isArray(matchdays) ? matchdays : [];
  if (!md.length) return null;
  const now = Date.now();
  const future = md.find((m) => {
    const d = parseAppDate(m?.deadline);
    return d && d.getTime() > now;
  });
  if (future != null) return Number(future.giornata) || null;
  const last = md[md.length - 1];
  return Number(last?.giornata) || null;
}

export function invalidateLeagueWarmCache(leagueId) {
  const id = nid(leagueId);
  if (id == null) return;
  dashboardById.delete(id);
  leagueDetailById.delete(id);
  teamsRowsById.delete(id);
  marketBootstrapById.delete(id);
  squadBootstrapById.delete(id);
  standingsFullById.delete(id);
  formationMatchdaysById.delete(id);
  leagueSettingsById.delete(id);
  squadPlayersDataById.delete(id);
  for (const k of formationPayloadByKey.keys()) {
    if (k.startsWith(`${id}:`)) formationPayloadByKey.delete(k);
  }
  for (const k of teamDetailByKey.keys()) {
    if (k.startsWith(`${id}:`)) teamDetailByKey.delete(k);
  }
}

export function invalidateAllLeagueWarmCache() {
  dashboardById.clear();
  leagueDetailById.clear();
  teamsRowsById.clear();
  marketBootstrapById.clear();
  squadBootstrapById.clear();
  standingsFullById.clear();
  formationMatchdaysById.clear();
  leagueSettingsById.clear();
  squadPlayersDataById.clear();
  formationPayloadByKey.clear();
  teamDetailByKey.clear();
  clearHomeLeaguesBootstrapSnapshot();
}

function normalizeLeagueList(raw) {
  const data = Array.isArray(raw) ? raw : [];
  return data.map((league) => ({
    ...league,
    favorite: Number(league?.favorite) === 1 || league?.favorite === true,
    archived: Number(league?.archived) === 1 || league?.archived === true,
    notifications_enabled:
      Number(league?.notifications_enabled) === 1 || league?.notifications_enabled === true,
    is_official: Number(league?.is_official) === 1 || league?.is_official === true,
    reference_year: (() => {
      const y = Number(league?.reference_year);
      return Number.isFinite(y) ? y : null;
    })(),
    official_group_id: (() => {
      const g = Number(league?.official_group_id);
      return Number.isFinite(g) && g > 0 ? g : null;
    })(),
  }));
}

function isOfficialLeague(league) {
  return Number(league?.is_official) === 1 || league?.is_official === true;
}

function referenceYearOf(league) {
  const y = Number(league?.reference_year);
  return Number.isFinite(y) ? y : null;
}

function officialGroupIdOf(league) {
  const g = Number(league?.official_group_id);
  return Number.isFinite(g) && g > 0 ? g : null;
}

/**
 * Una sola lega ufficiale con `reference_year` === anno di calendario (per prefetch leggero).
 * Se più candidate: `official_group_id` minore, poi `id` lega minore.
 */
export function pickOfficialCurrentYearLeagueId(normalizedList, calendarYear = new Date().getFullYear()) {
  const year = Number.isFinite(Number(calendarYear)) ? Number(calendarYear) : new Date().getFullYear();
  const list = Array.isArray(normalizedList) ? normalizedList : [];
  const candidates = list.filter((l) => {
    if (!isOfficialLeague(l)) return false;
    if (referenceYearOf(l) !== year) return false;
    if (hiddenLeagues.size > 0 && hiddenLeagues.has(l.id)) return false;
    return nid(l?.id) != null;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const ga = officialGroupIdOf(a);
    const gb = officialGroupIdOf(b);
    const ha = ga != null ? ga : Number.POSITIVE_INFINITY;
    const hb = gb != null ? gb : Number.POSITIVE_INFINITY;
    if (ha !== hb) return ha - hb;
    const ia = nid(a.id);
    const ib = nid(b.id);
    return (ia ?? 0) - (ib ?? 0);
  });
  return nid(candidates[0].id);
}

/**
 * Ordine prefetch: leghe ufficiali prima; tra ufficiali prima `reference_year` === anno di calendario;
 * poi preferite non archiviate, altre non archiviate, archiviate.
 */
export function sortLeaguesForPrefetch(normalizedList, calendarYear = new Date().getFullYear()) {
  const list = Array.isArray(normalizedList) ? [...normalizedList] : [];
  list.sort((a, b) => {
    const oa = isOfficialLeague(a);
    const ob = isOfficialLeague(b);
    if (oa !== ob) return oa ? -1 : 1;

    if (oa) {
      const ya = referenceYearOf(a);
      const yb = referenceYearOf(b);
      const ca = ya === calendarYear;
      const cb = yb === calendarYear;
      if (ca !== cb) return ca ? -1 : 1;
      if (ya != null && yb != null && ya !== yb) return yb - ya;
      if (ya != null && yb == null) return -1;
      if (ya == null && yb != null) return 1;
    }

    const bucket = (l) => {
      if (l.favorite && !l.archived) return 0;
      if (!l.archived) return 1;
      return 2;
    };
    const ba = bucket(a);
    const bb = bucket(b);
    if (ba !== bb) return ba - bb;
    return 0;
  });
  return list;
}

export function pickPrefetchLeagueIds(normalizedList, maxLeagues, calendarYear = new Date().getFullYear()) {
  const list = Array.isArray(normalizedList) ? normalizedList : [];
  const filtered =
    hiddenLeagues.size > 0 ? list.filter((l) => !hiddenLeagues.has(l.id)) : list;
  // Prefetch solo leghe non archiviate (se meno di maxLeagues, carica solo quelle).
  const nonArchived = filtered.filter((l) => !l.archived);
  const year = Number.isFinite(Number(calendarYear)) ? Number(calendarYear) : new Date().getFullYear();
  const officialCurrentId = pickOfficialCurrentYearLeagueId(nonArchived, year);
  /** Prefetch warm: al massimo una lega ufficiale (stagione anno corrente); le altre ufficiali escluse per non appesantire. */
  const eligible = nonArchived.filter((l) => {
    if (!isOfficialLeague(l)) return true;
    return officialCurrentId != null && nid(l?.id) === officialCurrentId;
  });
  const merged = sortLeaguesForPrefetch(eligible, year);
  const seen = new Set();
  const out = [];
  const limit = Number.isFinite(Number(maxLeagues)) ? Math.max(0, Number(maxLeagues)) : 3;
  for (const l of merged) {
    const leagueNid = nid(l?.id);
    if (leagueNid == null || seen.has(leagueNid)) continue;
    seen.add(leagueNid);
    out.push(leagueNid);
    if (out.length >= limit) break;
  }
  return out;
}

async function mapPool(items, concurrency, iterator) {
  if (!items.length) return;
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await iterator(items[i], i);
    }
  });
  await Promise.all(workers);
}

const MAX_FORMATION_PREFETCH_PER_LEAGUE = 5;

/**
 * Dopo login/sessione valida: prefetch per leghe in ordine {@link sortLeaguesForPrefetch}.
 * Default: max 3 leghe non archiviate; formazioni ultime 5 (corrente + precedenti).
 * @param {{ onProgress?: (0..1) => void, maxLeagues?: number, concurrency?: number, userId?: number|string, calendarYear?: number }} opts
 */
export async function prefetchLeagueWarmData(opts = {}) {
  const { onProgress, maxLeagues = 3, concurrency = 2, userId: userIdOpt, calendarYear } = opts;
  const year = Number.isFinite(Number(calendarYear)) ? Number(calendarYear) : new Date().getFullYear();
  const userId = nid(userIdOpt);
  const report = (v) => {
    try {
      onProgress?.(Math.max(0, Math.min(1, v)));
    } catch (_) {}
  };
  try {
    const res = await leagueService.getAll();
    const normalized = normalizeLeagueList(res?.data);
    setHomeLeaguesBootstrapSnapshot(normalized);
    const ids = pickPrefetchLeagueIds(normalized, maxLeagues, year);
    report(0.06);
    if (!ids.length) {
      report(1);
      return;
    }
    let done = 0;
    const bump = () => {
      done += 1;
      report(0.06 + (0.94 * done) / ids.length);
    };

    await mapPool(ids, concurrency, async (id) => {
      try {
        const baseCalls = [
          leagueService.getDashboardData(id),
          leagueService.getById(id),
          teamsService.getTeams(id),
          // Mercato: niente prefetch login (dump fino a 1000 giocatori). Si carica all'apertura schermata.
          squadService.getBootstrap(id),
          leagueService.getStandingsFull(id),
          formationService.getMatchdays(id),
          squadService.getSquad(id),
          leagueService.getSettings(id),
        ];
        if (userId != null) {
          baseCalls.push(teamsService.getTeamDetail(id, userId));
        }
        const results = await Promise.allSettled(baseCalls);
        let ri = 0;
        const dashR = results[ri++];
        const detailR = results[ri++];
        const teamsR = results[ri++];
        const squadBootR = results[ri++];
        const standingsR = results[ri++];
        const matchdaysR = results[ri++];
        const squadListR = results[ri++];
        const settingsR = results[ri++];
        const teamDetailR = userId != null ? results[ri++] : null;

        if (dashR.status === 'fulfilled') {
          const payload = dashR.value?.data;
          if (payload && typeof payload === 'object') setDashboard(id, payload);
        }
        if (detailR.status === 'fulfilled') {
          const d = detailR.value?.data;
          const leagueData = Array.isArray(d) ? d[0] : d;
          if (leagueData && typeof leagueData === 'object') setLeagueDetail(id, leagueData);
        }
        if (teamsR.status === 'fulfilled') {
          const rows = teamsR.value?.data;
          setTeamsRows(id, Array.isArray(rows) ? rows : []);
        }
        if (squadBootR.status === 'fulfilled') {
          const data = squadBootR.value?.data;
          if (data && typeof data === 'object' && (data.role_limits != null || data.league != null || Array.isArray(data.players) || Array.isArray(data.squad))) {
            setSquadBootstrap(id, data);
          }
        }
        if (standingsR.status === 'fulfilled') {
          setStandingsFull(id, standingsR.value?.data);
        }
        let md = [];
        if (matchdaysR.status === 'fulfilled') {
          md = Array.isArray(matchdaysR.value?.data) ? matchdaysR.value.data : [];
          setFormationMatchdays(id, md);
        }
        if (squadListR.status === 'fulfilled') {
          const sd = squadListR.value?.data;
          // Non cacheare liste vuote “sosette”: senza players/squad array validi ignora.
          if (sd && typeof sd === 'object' && (Array.isArray(sd.players) || Array.isArray(sd.squad))) {
            setSquadPlayersData(id, sd);
          }
        }
        if (settingsR.status === 'fulfilled') {
          const sd = settingsR.value?.data;
          if (sd && typeof sd === 'object') setLeagueSettings(id, sd);
        }
        if (teamDetailR?.status === 'fulfilled' && userId != null) {
          const payload = teamDetailR.value?.data;
          if (payload && typeof payload === 'object') setTeamDetail(id, userId, payload);
        }

        const defaultG = pickDefaultFormationGiornata(md);
        const prefetchGiornate = [];
        if (defaultG != null) {
          const sortedG = [...new Set(
            md.map((m) => Number(m?.giornata)).filter((g) => Number.isFinite(g))
          )].sort((a, b) => a - b);
          const idx = sortedG.indexOf(defaultG);
          const end = idx >= 0 ? idx : sortedG.length - 1;
          const start = Math.max(0, end - (MAX_FORMATION_PREFETCH_PER_LEAGUE - 1));
          for (let i = end; i >= start; i -= 1) {
            prefetchGiornate.push(sortedG[i]);
          }
        }
        // Cap di sicurezza (ultime N rispetto alla giornata default).
        const limitedGiornate = prefetchGiornate.slice(0, MAX_FORMATION_PREFETCH_PER_LEAGUE);

        await Promise.all(
          limitedGiornate.map(async (g) => {
            try {
              const fr = await formationService.getFormation(id, g);
              setFormationPayload(id, g, fr?.data);
            } catch (_) {}
          })
        );
      } finally {
        bump();
      }
    });
    report(1);
  } catch (_) {
    report(1);
  }
}

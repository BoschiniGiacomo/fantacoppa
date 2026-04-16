import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// URL API configurabile via env Expo:
// EXPO_PUBLIC_API_BASE_URL=https://.../api.php oppure http://<ip>:3000/api
// Se non definita, fallback al backend storico Altervista.
export const API_BASE_URL =
  (typeof process !== 'undefined' && process?.env?.EXPO_PUBLIC_API_BASE_URL)
    ? String(process.env.EXPO_PUBLIC_API_BASE_URL).trim()
    : 'http://localhost:3000/api';
// Legacy Altervista disabilitato: l'app deve usare solo il backend nuovo.

/** Unisce base e segmento senza new URL() (con .../api.php il resolver URL del browser/RN sbaglia). */
export function apiFileUrl(suffix = '') {
  const base = String(API_BASE_URL).replace(/\/+$/, '');
  const s = String(suffix).replace(/^\/+/, '');
  return s ? `${base}/${s}` : base;
}

/** Base URL della cartella del sito (parent di api.php): qui risiedono uploads/… */
export function publicUploadBaseUrl() {
  // Se API_BASE_URL è .../api, ritorna il parent (server) per servire uploads/
  // Es: http://192.168.0.62:3000/api -> http://192.168.0.62:3000
  const s = String(API_BASE_URL).replace(/\/+$/, '');
  return s.endsWith('/api') ? s.slice(0, -4) : s.replace(/\/?api\.php$/i, '');
}

/** URL assoluto per path tipo uploads/official_team_logos/… (stesso schema di Partite / dettaglio match). */
export function publicAssetUrl(relativePath) {
  if (relativePath == null) return null;
  const p = String(relativePath).trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  // Supabase Storage public bucket "uploads"
  // Esempio path: uploads/official_team_logos/foo.png
  const envSupabaseUrl =
    (typeof process !== 'undefined' && process?.env?.EXPO_PUBLIC_SUPABASE_URL)
      ? String(process.env.EXPO_PUBLIC_SUPABASE_URL).trim()
      : '';
  const supabaseUrl =
    envSupabaseUrl ||
    ((typeof process !== 'undefined' && process?.env?.SUPABASE_URL) ? String(process.env.SUPABASE_URL).trim() : '');

  if (supabaseUrl && p.replace(/^\/+/, '').startsWith('uploads/')) {
    const clean = p.replace(/^\/+/, '');
    const url = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${clean}`;
    return url;
  }
  const base = publicUploadBaseUrl();
  const url = `${base}/${p.replace(/^\/+/, '')}`;
  return url;
}

/**
 * Su iOS / Expo non esiste android.versionCode → prima era sempre 0 → API 426 su ogni richiesta.
 * Usa anche ios.buildNumber e extra.appVersionCode (allineati ad app.json).
 */
function resolveAppVersionCode() {
  const ex = Constants.expoConfig;
  if (!ex) return 999;
  const android = ex.android?.versionCode;
  if (typeof android === 'number' && android > 0) return android;
  const iosBn = ex.ios?.buildNumber;
  if (iosBn != null && String(iosBn).trim() !== '') {
    const n = parseInt(String(iosBn).replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const extra = ex.extra?.appVersionCode;
  if (typeof extra === 'number' && extra > 0) return extra;
  if (typeof extra === 'string' && parseInt(extra, 10) > 0) return parseInt(extra, 10);
  return 999;
}

const APP_VERSION_CODE = String(resolveAppVersionCode());
const APP_VERSION_NAME = String(Constants.expoConfig?.version ?? '0.0.0');

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

let unauthorizedHandler = null;
let isHandlingUnauthorized = false;
let updateRequiredHandler = null;
let isHandlingUpdateRequired = false;

export const setUnauthorizedHandler = (handler) => {
  unauthorizedHandler = handler;
};

export const setUpdateRequiredHandler = (handler) => {
  updateRequiredHandler = handler;
};

// Interceptor per aggiungere il token alle richieste
api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    config.headers['X-App-Version-Code'] = APP_VERSION_CODE;
    config.headers['X-App-Version'] = APP_VERSION_NAME;
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor per gestire errori di autenticazione
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalConfig = error?.config || {};
    const status = error?.response?.status;

    if (error.code === 'ECONNABORTED') {
      error.message = 'Timeout API: verifica che backend e rete locale siano raggiungibili.';
    } else if (error.message === 'Network Error') {
      error.message = 'Backend non raggiungibile: controlla IP locale, backend acceso e firewall.';
    }

    const isUpdateRequired = error.response?.status === 426
      || error.response?.data?.code === 'UPDATE_REQUIRED';

    if (isUpdateRequired && !isHandlingUpdateRequired) {
      isHandlingUpdateRequired = true;
      try {
        if (typeof updateRequiredHandler === 'function') {
          await updateRequiredHandler(error.response?.data || {});
        }
      } finally {
        isHandlingUpdateRequired = false;
      }
    }

    if (error.response?.status === 401) {
      // Token scaduto/non valido: svuota storage e notifica l'app
      if (!isHandlingUnauthorized) {
        isHandlingUnauthorized = true;
        try {
          await AsyncStorage.removeItem('authToken');
          await AsyncStorage.removeItem('user');
          if (typeof unauthorizedHandler === 'function') {
            await unauthorizedHandler();
          }
        } finally {
          isHandlingUnauthorized = false;
        }
      }
    }
    return Promise.reject(error);
  }
);

const buildVersionHeaders = () => ({
  'X-App-Version-Code': APP_VERSION_CODE,
  'X-App-Version': APP_VERSION_NAME,
});

const buildAuthVersionHeaders = async () => {
  const token = await AsyncStorage.getItem('authToken');
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...buildVersionHeaders(),
  };
};

// Servizio di autenticazione
export const authService = {
  setAuthToken: (token) => {
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete api.defaults.headers.common['Authorization'];
    }
  },
  // URL assoluto + baseURL vuoto: garantisce .../api.php/auth/forgot-password (evita 404 "Endpoint non trovato").
  forgotPassword: (email) =>
    api.post(apiFileUrl('auth/forgot-password'), { email }, { baseURL: '' }),
  
  changePassword: (currentPassword, newPassword, confirmPassword) => {
    return api.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
      confirm_password: confirmPassword,
    });
  },

  login: (username, password) => {
    return api.post('/auth/login', { username, password });
  },

  register: (username, email, password) => {
    return api.post('/auth/register', { username, email, password });
  },

  logout: () => {
    return api.post('/auth/logout');
  },
  deleteAccount: (password) => {
    return api.post('/auth/delete-account', { password });
  },
  validateSession: () => api.get('/auth/verify'),
};

// Servizio per le leghe
export const leagueService = {
  getAll: () => api.get('/leagues'),
  getAllLeagues: () => api.get('/leagues/all'),
  getById: (id) => api.get(`/leagues/${id}`),
  create: (data) => api.post('/leagues', data),
  join: (leagueId, accessCode) => api.post(`/leagues/${leagueId}/join`, { accessCode }),
  leave: (leagueId) => api.post(`/leagues/${leagueId}/leave`),
  search: (query) => api.get(`/leagues/search?q=${encodeURIComponent(query)}`),
  getStandings: (leagueId, limit = 5) => api.get(`/leagues/${leagueId}/standings?limit=${limit}`),
  getStandingsFull: (leagueId) => api.get(`/leagues/${leagueId}/standings/full`),
  getMatchdayResults: (leagueId, giornata) => api.get(`/leagues/${leagueId}/standings/matchday/${giornata}`),
  getMatchdayFormation: (leagueId, giornata, userId) => api.get(`/leagues/${leagueId}/standings/matchday/${giornata}/formation/${userId}`),
  getUserStats: (leagueId) => api.get(`/leagues/${leagueId}/user-stats`),
  updatePrefs: (leagueId, prefs) => api.post(`/leagues/${leagueId}/prefs`, prefs),
  updateTeamInfo: (leagueId, teamName, coachName) => api.put(`/leagues/${leagueId}/team-info`, { team_name: teamName, coach_name: coachName }),
  uploadTeamLogo: async (leagueId, imageUri) => {
    const formData = new FormData();
    const filename = imageUri.split('/').pop();
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1] === 'jpg' ? 'jpeg' : match[1]}` : 'image/jpeg';
    
    formData.append('logo', {
      uri: imageUri,
      name: filename,
      type: type,
    });
    
    const headers = await buildAuthVersionHeaders();
    const doUpload = () =>
      axios.post(`${API_BASE_URL}/leagues/${leagueId}/team-info/logo`, formData, {
        headers: {
          ...headers,
          'Content-Type': 'multipart/form-data',
        },
        timeout: 30000,
      });
    try {
      return await doUpload();
    } catch (err) {
      const isNet = err?.message === 'Network Error' || err?.code === 'ECONNABORTED';
      if (!isNet) throw err;
      return await doUpload();
    }
  },
  removeTeamLogo: (leagueId) => api.delete(`/leagues/${leagueId}/team-info/logo`),
  selectDefaultLogo: (leagueId, logoId) => api.post(`/leagues/${leagueId}/team-info/logo/default`, { logo_id: logoId }),
  checkTeamInfo: (leagueId) => api.get(`/leagues/${leagueId}/team-info/check`),
  getMembers: (leagueId) => api.get(`/leagues/${leagueId}/members`),
  leaveLeagueInfo: (leagueId) => api.get(`/leagues/${leagueId}/leave/info`),
  leaveLeague: (leagueId, newAdminId = null) => api.post(`/leagues/${leagueId}/leave`, { new_admin_id: newAdminId }),
  removeUser: (leagueId, userId) => api.post(`/leagues/${leagueId}/remove-user`, { user_id: userId }),
  changeRole: (leagueId, memberId, newRole) => api.post(`/leagues/${leagueId}/change-role`, { member_id: memberId, new_role: newRole }),
  // Join requests
  getJoinRequests: (leagueId) => api.get(`/leagues/${leagueId}/join-requests`),
  approveJoinRequest: (leagueId, requestId) => api.post(`/leagues/${leagueId}/join-requests/${requestId}/approve`),
  rejectJoinRequest: (leagueId, requestId) => api.post(`/leagues/${leagueId}/join-requests/${requestId}/reject`),
  getSettings: (leagueId) => api.get(`/leagues/${leagueId}/settings`),
  updateSettings: (leagueId, settings) => api.put(`/leagues/${leagueId}/settings`, settings),
  updateBonusSettings: (leagueId, bonusSettings) => api.put(`/leagues/${leagueId}/bonus-settings`, bonusSettings),
  // Teams management
  getTeams: (leagueId) => api.get(`/leagues/${leagueId}/teams`),
  addTeam: (leagueId, teamName) => api.post(`/leagues/${leagueId}/teams`, { name: teamName }),
  uploadOfficialTeamLogo: async (leagueId, teamId, imageUri) => {
    const formData = new FormData();
    const filename = imageUri.split('/').pop();
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1] === 'jpg' ? 'jpeg' : match[1]}` : 'image/jpeg';
    formData.append('logo', {
      uri: imageUri,
      name: filename,
      type,
    });
    const headers = await buildAuthVersionHeaders();
    const doUpload = () =>
      axios.post(`${API_BASE_URL}/leagues/${leagueId}/teams/${teamId}/logo`, formData, {
        headers: {
          ...headers,
          'Content-Type': 'multipart/form-data',
        },
        timeout: 30000,
      });
    try {
      return await doUpload();
    } catch (err) {
      const isNet = err?.message === 'Network Error' || err?.code === 'ECONNABORTED';
      if (!isNet) throw err;
      return await doUpload();
    }
  },
  removeOfficialTeamLogo: (leagueId, teamId) => api.delete(`/leagues/${leagueId}/teams/${teamId}/logo`),
  /** Colore maglia (#RRGGBB / #RGB) per formazioni partite; stringa vuota o null = predefinito app */
  updateOfficialTeamJerseyColor: (leagueId, teamId, jerseyColor) =>
    api.put(`/leagues/${leagueId}/teams/${teamId}`, { jersey_color: jerseyColor }),
  deleteTeam: (leagueId, teamId) => api.delete(`/leagues/${leagueId}/teams/${teamId}`),
  // Matchdays management
  getMatchdays: (leagueId) => api.get(`/leagues/${leagueId}/matchdays`),
  saveMatchday: (leagueId, matchdayData) => api.post(`/leagues/${leagueId}/matchdays`, matchdayData),
  deleteMatchday: (leagueId, matchdayId) => api.delete(`/leagues/${leagueId}/matchdays/${matchdayId}`),
  // CSV management
  downloadTemplateTeams: async (leagueId) => {
    const headers = await buildAuthVersionHeaders();
    const response = await fetch(`${API_BASE_URL}/leagues/${leagueId}/csv/template/teams`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error('Errore nel download');
    return response;
  },
  downloadTemplatePlayers: async (leagueId) => {
    const headers = await buildAuthVersionHeaders();
    const response = await fetch(`${API_BASE_URL}/leagues/${leagueId}/csv/template/players`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error('Errore nel download');
    return response;
  },
  exportTeams: async (leagueId) => {
    const headers = await buildAuthVersionHeaders();
    const response = await fetch(`${API_BASE_URL}/leagues/${leagueId}/csv/export/teams`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error('Errore nell\'export');
    return response;
  },
  exportPlayers: async (leagueId) => {
    const headers = await buildAuthVersionHeaders();
    const response = await fetch(`${API_BASE_URL}/leagues/${leagueId}/csv/export/players`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) throw new Error('Errore nell\'export');
    return response;
  },
  importCSV: async (leagueId, fileUri, fileName) => {
    const headers = await buildAuthVersionHeaders();
    const formData = new FormData();
    formData.append('csv_file', {
      uri: fileUri,
      type: 'text/csv',
      name: fileName || 'import.csv',
    });
    
    const response = await fetch(`${API_BASE_URL}/leagues/${leagueId}/csv/import`, {
      method: 'POST',
      headers,
      body: formData,
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Errore nell\'import' }));
      throw new Error(error.message || 'Errore nell\'import');
    }
    
    return response.json();
  },
  getTeamPlayers: async (leagueId, teamId) => {
    return api.get(`/leagues/${leagueId}/teams/${teamId}/players`);
  },
  addPlayer: async (leagueId, teamId, playerData) => {
    return api.post(`/leagues/${leagueId}/teams/${teamId}/players`, playerData);
  },
  updatePlayer: async (leagueId, teamId, playerId, playerData) => {
    return api.put(`/leagues/${leagueId}/teams/${teamId}/players/${playerId}`, playerData);
  },
  deletePlayer: async (leagueId, teamId, playerId) => {
    return api.delete(`/leagues/${leagueId}/teams/${teamId}/players/${playerId}`);
  },
  // Metodi per inserimento voti
  getVotesMatchdays: async (leagueId) => {
    return api.get(`/leagues/${leagueId}/votes/matchdays`);
  },
  getVotesPlayers: async (leagueId) => {
    return api.get(`/leagues/${leagueId}/votes/players`);
  },
  getVotesForMatchday: async (leagueId, giornata) => {
    return api.get(`/leagues/${leagueId}/votes/${giornata}`);
  },
  saveVotes: async (leagueId, giornata, ratings, saveTeamOnly = null) => {
    return api.post(`/leagues/${leagueId}/votes/${giornata}`, {
      ratings,
      save_team_only: saveTeamOnly
    });
  },
  getBonusSettings: async (leagueId) => {
    return api.get(`/leagues/${leagueId}/bonus-settings`);
  },
  // Matchday calculation
  calculateMatchday: async (leagueId, giornata, use6Politico = false, force = false) => {
    return api.post(`/leagues/${leagueId}/calculate/${giornata}`, { use_6_politico: use6Politico, force });
  },
  getLiveScores: async (leagueId, giornata) => {
    return api.get(`/leagues/${leagueId}/live/${giornata}`);
  },
  getMatchdayStatus: async (leagueId) => {
    return api.get(`/leagues/${leagueId}/matchday-status`);
  },
  // Official leagues for linking
  getAvailableOfficialLeagues: () => api.get('/official-leagues/available'),
};

// Servizio per il mercato
export const marketService = {
  getPlayers: (leagueId, filters = {}) => {
    const params = new URLSearchParams();
    if (filters.role) params.append('role', filters.role);
    if (filters.search) params.append('search', filters.search);
    return api.get(`/market/${leagueId}/players?${params.toString()}`);
  },
  buyPlayer: (leagueId, playerId) => api.post(`/market/${leagueId}/buy`, { playerId }),
  getBudget: (leagueId) => api.get(`/market/${leagueId}/budget`),
  isBlocked: (leagueId) => api.get(`/market/${leagueId}/blocked`),
  getSettings: (leagueId) => api.get(`/market/${leagueId}/manage`),
  updateSettings: (leagueId, setting, value) => api.post(`/market/${leagueId}/manage`, { setting, value }),
  updateUserBlock: (leagueId, userId, blocked) => api.post(`/market/${leagueId}/user-block`, { user_id: userId, blocked }),
};

// Servizio per la rosa
export const squadService = {
  getSquad: (leagueId) => api.get(`/squad/${leagueId}`),
  removePlayer: (leagueId, playerId) => api.delete(`/squad/${leagueId}/players/${playerId}`),
  getRoleLimits: (leagueId) => api.get(`/squad/${leagueId}/limits`),
};

// Servizio per le formazioni
export const formationService = {
  getFormation: (leagueId, giornata) => api.get(`/formation/${leagueId}/${giornata}`),
  saveFormation: (leagueId, giornata, data) => api.post(`/formation/${leagueId}/${giornata}`, data),
  getMatchdays: (leagueId) => api.get(`/formation/${leagueId}/matchdays`),
  getDeadline: (leagueId, giornata) => api.get(`/formation/${leagueId}/${giornata}/deadline`),
};

// Servizio per il profilo
export const profileService = {
  getProfile: () => api.get('/profile'),
  updateProfile: (data) => api.put('/profile', data),
};

export const notificationService = {
  // Stesso motivo di forgotPassword: con baseURL .../api.php, path assoluto /foo va a dominio/foo (404).
  registerPushToken: (token, platform) =>
    api.post(
      apiFileUrl('notifications/register-token'),
      { token, platform },
      { baseURL: '' }
    ),
};

export const matchesService = {
  getByDate: (dateYmd) =>
    api.get(`matches?date=${encodeURIComponent(dateYmd)}`, {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    }),
  getCompetitions: () => api.get('competitions'),
  getDetail: (matchId) => api.get(`matches/${matchId}/detail`),
  toggleMatchNotifications: (matchId, enabled) =>
    api.post('matches/notifications/toggle', { match_id: matchId, enabled: enabled ? 1 : 0 }),
  setFavoriteMatch: (matchId, isFavorite) =>
    api.post('matches/favorites/match', { match_id: matchId, is_favorite: isFavorite ? 1 : 0 }),
  setFavoriteTeam: (officialGroupId, teamName, isFavorite) =>
    api.post('matches/favorites/team', {
      official_group_id: officialGroupId,
      team_name: teamName,
      is_favorite: isFavorite ? 1 : 0,
    }),
  /** Competizioni, squadre ufficiali e preferenze utente (stellina + notifiche squadra) */
  getFollowSetup: () => api.get('matches/follow-setup'),
  /** Body: { competitions: [{ official_group_id, heart_team_names[], notify_team_names[] }] } */
  saveFollowPreferences: (payload) => api.put('matches/follow-preferences', payload),
};

export const adminMatchesService = {
  getByDate: (dateYmd) => api.get(`admin/matches?date=${encodeURIComponent(dateYmd)}`),
  /** Solo elenco leghe: onlyLeagues=true. Squadre: passa leagueIds con almeno un id (stessa lega = nomi univoci, niente dedup lato client). */
  getCompetitionTeams: (competitionId, leagueIds = [], onlyLeagues = false) => {
    const params = new URLSearchParams();
    if (onlyLeagues) {
      params.set('only_leagues', '1');
    } else if (Array.isArray(leagueIds) && leagueIds.length > 0) {
      params.set('league_ids', leagueIds.join(','));
    }
    const q = params.toString() ? `?${params.toString()}` : '';
    return api.get(`admin/matches/competition/${competitionId}/teams${q}`);
  },
  create: (payload) => api.post('admin/matches', payload),
  update: (matchId, payload) => api.put(`admin/matches/${matchId}`, payload),
  updateMeta: (matchId, payload) => api.put(`admin/matches/${matchId}/meta`, payload),
  addEvent: (matchId, payload) => api.post(`admin/matches/${matchId}/events`, payload),
  updateStats: (matchId, payload) => api.put(`admin/matches/${matchId}/stats`, payload),
  getStandingsTies: (competitionId) => api.get(`admin/matches/standings/ties?competition_id=${encodeURIComponent(competitionId)}`),
  resolveStandingsTie: (payload) => api.post('admin/matches/standings/ties/resolve', payload),
  remove: (matchId) => api.delete(`admin/matches/${matchId}`),
};

export const adminCompetitionsService = {
  getAll: () => api.get('admin/competitions'),
  setVisibleForMatches: (competitionId, isEnabled) =>
    api.put(`admin/competitions/${competitionId}`, {
      is_match_competition_enabled: isEnabled ? 1 : 0,
    }),
};

export const adminMatchDetailsService = {
  getAll: () => api.get('admin/match-details'),
  createVenue: (name) => api.post('admin/match-details/venues', { name }),
  createReferee: (name) => api.post('admin/match-details/referees', { name }),
  /** `defaults`: preset durata/supplementari/rigori (stessi campi restituiti dal GET stages) */
  createStage: (name, defaults = {}) => api.post('admin/match-details/stages', { name, ...defaults }),
  updateStageTimingDefaults: (stageId, defaults) => api.put(`admin/match-details/stages/${stageId}`, defaults),
  removeVenue: (id) => api.delete(`admin/match-details/venues/${id}`),
  removeReferee: (id) => api.delete(`admin/match-details/referees/${id}`),
  removeStage: (id) => api.delete(`admin/match-details/stages/${id}`),
};

// Servizio per le squadre
export const teamsService = {
  getTeams: (leagueId) => api.get(`/teams/${leagueId}`),
  getTeamDetail: (leagueId, userId) => api.get(`/teams/${leagueId}/${userId}`),
};

// Servizio per superuser
export const superuserService = {
  getUsers: () => api.get('/superuser/users'),
  toggleSuperuser: (userId) => api.post(`/superuser/users/${userId}/toggle-superuser`),
  getLeagues: () => api.get('/superuser/leagues'),
  deleteLeague: (leagueId) => api.delete(`/superuser/leagues/${leagueId}`),
  joinLeagueAsAdmin: (leagueId) => api.post(`/superuser/leagues/${leagueId}/join-as-admin`),
  // Gruppi ufficiali
  getOfficialGroups: () => api.get('/superuser/official-groups'),
  createOfficialGroup: (data) => api.post('/superuser/official-groups', data),
  updateOfficialGroup: (groupId, data) => api.put(`/superuser/official-groups/${groupId}`, data),
  deleteOfficialGroup: (groupId) => api.delete(`/superuser/official-groups/${groupId}`),
  getOfficialGroupLeagues: (groupId) => api.get(`/superuser/official-groups/${groupId}/leagues`),
  setLeagueOfficial: (leagueId, data) => api.put(`/superuser/leagues/${leagueId}/official`, data),
  toggleVisibleForLinking: (leagueId) => api.put(`/superuser/leagues/${leagueId}/visible-for-linking`),

  // Player cluster management
  getPlayerClusterSuggestions: (groupId) => api.get(`/superuser/player-clusters/suggestions/${groupId}`),
  createPlayerCluster: (data) => api.post('/superuser/player-clusters', data),
  approvePlayerCluster: (clusterId) => api.put(`/superuser/player-clusters/${clusterId}/approve`),
  rejectPlayerCluster: (clusterId) => api.put(`/superuser/player-clusters/${clusterId}/reject`),
  addPlayerToCluster: (clusterId, playerId) => api.post(`/superuser/player-clusters/${clusterId}/players`, { player_id: playerId }),
  getPlayerClusters: (groupId, status) => {
    const url = `/superuser/player-clusters/${groupId}${status ? `?status=${status}` : ''}`;
    return api.get(url);
  },
  searchPlayers: (groupId, query, leagueId) => {
    let url = `/superuser/players/search/${groupId}`;
    const params = [];
    if (query) params.push(`q=${encodeURIComponent(query)}`);
    if (leagueId) params.push(`league_id=${leagueId}`);
    if (params.length > 0) url += `?${params.join('&')}`;
    return api.get(url);
  },
};

// Player statistics service
export const playerStatsService = {
  getPlayerStats: (playerId, leagueId) => api.get(`/players/${playerId}/stats/${leagueId}`),
  getPlayerAggregatedStats: (playerId, leagueId) => api.get(`/players/${playerId}/stats/aggregated/${leagueId}`),
};

export default api;


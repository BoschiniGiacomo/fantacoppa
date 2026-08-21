import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  TextInput,
  Modal,
  Image,
  Switch,
  Platform,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import LoopingVideoView from '../components/LoopingVideoView';
import AppLoadingFullScreenModal from '../components/AppLoadingFullScreenModal';
import { useAuth } from '../context/AuthContext';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { superuserService, publicAssetUrl } from '../services/api';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getAppLoadingMediaSettings,
  saveAppLoadingMediaFromPicker,
  clearAppLoadingMedia,
  guessPickMediaType,
} from '../utils/appLoadingMediaSettings';
import {
  getLoginLogoSettings,
  saveLoginLogoFromPicker,
  clearLoginLogo,
} from '../utils/loginLogoSettings';
import {
  getLoginBackgroundSettings,
  saveLoginBackgroundFromPicker,
  clearLoginBackground,
} from '../utils/loginBackgroundSettings';
import {
  getMatchBackgroundSettings,
  saveMatchBackgroundFromPicker,
  clearMatchBackground,
} from '../utils/matchBackgroundSettings';
import { useAuthBranding } from '../context/AuthBrandingContext';

function matchesNameSearch(displayName, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const name = String(displayName || '').trim().toLowerCase();
  if (!name) return false;
  return q.split(/\s+/).filter(Boolean).every((part) => name.includes(part));
}

function clusterMatchesNameSearch(cluster, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  const players = cluster?.players;
  if (!Array.isArray(players) || players.length === 0) return false;
  return players.some((p) => {
    const full = (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`).trim();
    return (
      matchesNameSearch(full, q) ||
      matchesNameSearch(p.first_name, q) ||
      matchesNameSearch(p.last_name, q)
    );
  });
}

const CLUSTER_ROLE_LABEL = {
  P: 'Portiere',
  D: 'Difensore',
  C: 'Centrocampista',
  A: 'Attaccante',
};

function formatClusterPlayerRole(role) {
  const code = String(role || '').trim().toUpperCase();
  if (!code) return '—';
  return CLUSTER_ROLE_LABEL[code] ? `${CLUSTER_ROLE_LABEL[code]} (${code})` : code;
}

function formatBirthYear(value) {
  const y = Number(value);
  if (!Number.isFinite(y) || y < 1900) return null;
  return String(y);
}

const BIRTH_YEAR_FILTER_NONE = 'none';

function clusterHasNoBirthYear(leagues) {
  return !(leagues || []).some((l) => formatBirthYear(l.birth_year));
}

function summarizeBirthYears(leagues) {
  const years = [...new Set(
    (leagues || []).map((l) => formatBirthYear(l.birth_year)).filter(Boolean)
  )];
  if (!years.length) return null;
  return years.length === 1 ? years[0] : years.join(' / ');
}

function getSuggestedClusterBirthYear(leagues) {
  const years = [...new Set(
    (leagues || []).map((l) => formatBirthYear(l.birth_year)).filter(Boolean)
  )];
  return years.length === 1 ? years[0] : '';
}

function countClusterMembersMissingBirthYear(leagues) {
  return (leagues || []).filter((l) => !formatBirthYear(l.birth_year)).length;
}

const CLUSTER_ROLE_OPTIONS = ['P', 'D', 'C', 'A'];

function normalizeClusterRoleCode(role) {
  const code = String(role || '').trim().toUpperCase();
  return CLUSTER_ROLE_OPTIONS.includes(code) ? code : '';
}

function getSuggestedClusterRole(leagues) {
  const roles = [...new Set(
    (leagues || []).map((l) => normalizeClusterRoleCode(l.role)).filter(Boolean),
  )];
  return roles.length === 1 ? roles[0] : '';
}

function getClusterUniformRole(leagues) {
  const list = leagues || [];
  if (!list.length) return null;
  const roles = list.map((l) => normalizeClusterRoleCode(l.role)).filter(Boolean);
  if (roles.length !== list.length) return null;
  const unique = [...new Set(roles)];
  return unique.length === 1 ? unique[0] : null;
}

function countClusterMembersNotMatchingRole(leagues, targetRole) {
  const code = normalizeClusterRoleCode(targetRole);
  if (!code) return (leagues || []).length;
  return (leagues || []).filter((l) => normalizeClusterRoleCode(l.role) !== code).length;
}

function getClusterUniformBirthYear(leagues) {
  const list = leagues || [];
  if (!list.length) return null;
  const years = list.map((l) => formatBirthYear(l.birth_year)).filter(Boolean);
  if (years.length !== list.length) return null;
  const unique = [...new Set(years)];
  return unique.length === 1 ? unique[0] : null;
}

function formatClusterBirthYearShort(value) {
  const y = formatBirthYear(value);
  if (!y) return null;
  return `'${y.slice(-2)}`;
}

function formatClusterListTitle(name, leagues) {
  const years = [...new Set(
    (leagues || []).map((l) => formatBirthYear(l.birth_year)).filter(Boolean)
  )];
  if (!years.length) return name;
  const yearSuffix = years.map((y) => formatClusterBirthYearShort(y)).join(' / ');
  return `${name} (${yearSuffix})`;
}

function clusterHasMultipleRoles(leagues) {
  const roles = new Set(
    (leagues || [])
      .map((l) => String(l.role || '').trim().toUpperCase())
      .filter(Boolean),
  );
  return roles.size > 1;
}

function clusterMatchesFilters(item, filters) {
  if (filters.groupId != null && Number(item.group_id) !== Number(filters.groupId)) return false;

  const leagueYears = filters.leagueYears || [];
  if (leagueYears.length > 0) {
    const selectedLeagueYears = new Set(leagueYears.map(Number));
    const hasLeagueYear = (item.leagues || []).some(
      (l) => selectedLeagueYears.has(Number(l.reference_year)),
    );
    if (!hasLeagueYear) return false;
  }

  const birthYears = filters.birthYears || [];
  if (birthYears.length > 0) {
    const leagues = item.leagues || [];
    const matches = birthYears.some((filterYear) => {
      if (filterYear === BIRTH_YEAR_FILTER_NONE) return clusterHasNoBirthYear(leagues);
      const birthYearStr = String(filterYear);
      return leagues.some((l) => formatBirthYear(l.birth_year) === birthYearStr);
    });
    if (!matches) return false;
  }

  if (filters.multiRoleOnly && !clusterHasMultipleRoles(item.leagues || [])) return false;

  return true;
}

function buildSuggestionPlayerList(suggestion) {
  const entries = [];
  const seen = new Set();
  const existingIds = new Set(
    (suggestion?.existing_leagues || []).map((l) => Number(l.player_id)).filter((id) => id > 0)
  );
  for (const l of [...(suggestion?.existing_leagues || []), ...(suggestion?.new_leagues || [])]) {
    const pid = Number(l.player_id);
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    const refYear = l.reference_year != null ? Number(l.reference_year) : null;
    entries.push({
      player_id: pid,
      league_id: Number(l.league_id) || null,
      league_name: l.league_name || '-',
      reference_year: Number.isFinite(refYear) ? refYear : null,
      team_name: l.team_name || '-',
      role: l.role || null,
      birth_year: l.birth_year ?? null,
      in_cluster: existingIds.has(pid),
    });
  }
  return entries.sort((a, b) => {
    const ya = Number(a.reference_year);
    const yb = Number(b.reference_year);
    const aHasYear = Number.isFinite(ya);
    const bHasYear = Number.isFinite(yb);
    if (aHasYear && bHasYear && ya !== yb) return yb - ya;
    if (aHasYear && !bHasYear) return -1;
    if (!aHasYear && bHasYear) return 1;
    return String(a.league_name).localeCompare(String(b.league_name), 'it');
  });
}

function hasDuplicateSelectedLeague(players, selected) {
  const leagueCounts = new Map();
  for (const p of players || []) {
    if (!selected?.[p.player_id]) continue;
    const lid = Number(p.league_id);
    if (!Number.isFinite(lid) || lid <= 0) continue;
    leagueCounts.set(lid, (leagueCounts.get(lid) || 0) + 1);
    if (leagueCounts.get(lid) > 1) return true;
  }
  return false;
}

function buildApprovedClustersList(allClusters) {
  return (allClusters || [])
    .map((cluster) => {
      const clusterId = Number(cluster.id);
      const players = Array.isArray(cluster.players) ? cluster.players : [];
      const first = players[0];
      const displayName = first
        ? `${first.first_name || ''} ${first.last_name || ''}`.trim() || '—'
        : 'Cluster vuoto';
      const leagues = players.map((player) => ({
        id: Number(player.league_id),
        name: player.league_name || '',
        group_name: cluster.group_name,
        group_id: cluster.group_id,
        player_id: Number(player.id),
        cluster_id: clusterId,
        team_name: player.team_name || '',
        role: player.role || null,
        birth_year: player.birth_year != null ? Number(player.birth_year) : null,
        reference_year: player.reference_year != null && Number.isFinite(Number(player.reference_year))
          ? Number(player.reference_year)
          : null,
      }));
      return {
        cluster_id: clusterId,
        is_single_player: false,
        name: displayName,
        group_name: cluster.group_name || '',
        group_id: cluster.group_id,
        players_count: players.length,
        leagues,
        clusters: [{ id: clusterId, group_name: cluster.group_name, created_at: cluster.created_at }],
        created_at: cluster.created_at,
      };
    })
    .sort((a, b) => {
      const nameCmp = a.name.localeCompare(b.name, 'it');
      if (nameCmp !== 0) return nameCmp;
      return Number(b.cluster_id) - Number(a.cluster_id);
    });
}

function buildUnclusteredPlayersList(players, groupMeta) {
  const groupId = Number(groupMeta?.group_id);
  const groupName = groupMeta?.group_name || '';
  return (players || []).map((player) => {
    const playerId = Number(player.player_id || player.id);
    const displayName = `${player.first_name || ''} ${player.last_name || ''}`.trim() || '—';
    const league = {
      id: Number(player.league_id),
      name: player.league_name || '',
      group_name: groupName,
      group_id: groupId,
      player_id: playerId,
      cluster_id: null,
      team_name: player.team_name || '',
      role: player.role || null,
      birth_year: player.birth_year != null ? Number(player.birth_year) : null,
      reference_year: player.reference_year != null && Number.isFinite(Number(player.reference_year))
        ? Number(player.reference_year)
        : null,
    };
    return {
      cluster_id: null,
      is_single_player: true,
      player_id: playerId,
      name: displayName,
      group_name: groupName,
      group_id: groupId,
      players_count: 1,
      leagues: [league],
      clusters: [],
      created_at: null,
    };
  });
}

export default function SuperUserScreen() {
  const { user } = useAuth();
  const { refresh: refreshAuthBranding } = useAuthBranding();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState('users'); // 'users', 'leagues', 'officials', 'clusters', 'appSettings'
  const [users, setUsers] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [officialGroups, setOfficialGroups] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingLeagues, setLoadingLeagues] = useState(false);
  const [loadingOfficialGroups, setLoadingOfficialGroups] = useState(false);
  const [refreshingUsers, setRefreshingUsers] = useState(false);
  const [refreshingLeagues, setRefreshingLeagues] = useState(false);
  const [refreshingOfficialGroups, setRefreshingOfficialGroups] = useState(false);
  const [sortColumn, setSortColumn] = useState('is_online'); // 'username', 'last_login', 'is_online', 'is_superuser'
  const [sortDirection, setSortDirection] = useState('desc'); // 'asc', 'desc' - 'desc' per mostrare prima gli online
  const [selectedUserDetail, setSelectedUserDetail] = useState(null);
  const [userDetailDraftUsername, setUserDetailDraftUsername] = useState('');
  const [userDetailDraftEmail, setUserDetailDraftEmail] = useState('');
  const [userDetailDraftPassword, setUserDetailDraftPassword] = useState('');
  const [userDetailEditingField, setUserDetailEditingField] = useState(null); // 'username' | 'email' | 'password' | null
  const [userDetailPasswordVisible, setUserDetailPasswordVisible] = useState(false);
  const [userDetailPasswordUnlocked, setUserDetailPasswordUnlocked] = useState(false);
  const [savingUserDetail, setSavingUserDetail] = useState(false);
  const [userDetailLeagues, setUserDetailLeagues] = useState([]);
  const [loadingUserDetailLeagues, setLoadingUserDetailLeagues] = useState(false);
  const [userDetailLeagueSearch, setUserDetailLeagueSearch] = useState('');
  const [searchText, setSearchText] = useState('');
  const [showUserFilters, setShowUserFilters] = useState(false);
  const [userFilters, setUserFilters] = useState({
    statuses: [], // 'online' | 'offline'
    roles: [], // 0 | 1 | 2
    accessFrom: null, // Date | null
    accessTo: null, // Date | null
  });
  const [userAccessDatePicker, setUserAccessDatePicker] = useState(null); // 'from' | 'to' | null
  const [userFilterMenuLayout, setUserFilterMenuLayout] = useState(null);
  const userFilterBtnRef = useRef(null);
  const { width: windowWidth } = useWindowDimensions();
  const [leagueFilters, setLeagueFilters] = useState({
    officialOnly: false,
    linking: [], // 'on' | 'off'
    visibility: [], // 'visible' | 'members_only'
    privacy: [], // 'public' | 'private'
    membersMin: '', // string digits
    membersMax: '',
  });
  const [leagueSearchText, setLeagueSearchText] = useState('');
  const [showLeagueFilters, setShowLeagueFilters] = useState(false);
  const [leagueFilterMenuLayout, setLeagueFilterMenuLayout] = useState(null);
  const leagueFilterBtnRef = useRef(null);
  const [showOfficialGroupModal, setShowOfficialGroupModal] = useState(false);
  const [selectedLeagueForOfficial, setSelectedLeagueForOfficial] = useState(null);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [selectedGroupForEdit, setSelectedGroupForEdit] = useState(null);
  const [showGroupDetailModal, setShowGroupDetailModal] = useState(false);
  const [uploadingGroupLogo, setUploadingGroupLogo] = useState(false);
  const [togglingMenuGroupId, setTogglingMenuGroupId] = useState(null);
  const [referenceYearDrafts, setReferenceYearDrafts] = useState({});
  const [expandedGroupLeagueIds, setExpandedGroupLeagueIds] = useState({});
  /** @type {Record<string, Array<{id:number,name:string,girone_index?:number|null}>>} */
  const [gironiTeamsByLeague, setGironiTeamsByLeague] = useState({});
  const [savingReferenceYearByLeague, setSavingReferenceYearByLeague] = useState({});
  const [yearPickerLeague, setYearPickerLeague] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  
  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };
  
  // Player cluster management
  const [clusters, setClusters] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showClusterModal, setShowClusterModal] = useState(false);
  const [showNeverPlayedModal, setShowNeverPlayedModal] = useState(false);
  const [neverPlayedPlayers, setNeverPlayedPlayers] = useState([]);
  const [loadingNeverPlayed, setLoadingNeverPlayed] = useState(false);
  const [neverPlayedSearchText, setNeverPlayedSearchText] = useState('');
  const [neverPlayedYearFilter, setNeverPlayedYearFilter] = useState(null); // null = tutti, 'none' = senza anno, number = anno
  const [deletingNeverPlayedId, setDeletingNeverPlayedId] = useState(null);
  const [showLiveBonusDiscrepancyModal, setShowLiveBonusDiscrepancyModal] = useState(false);
  const [discrepancyGroupId, setDiscrepancyGroupId] = useState(null);
  const [loadingLiveBonusDiscrepancies, setLoadingLiveBonusDiscrepancies] = useState(false);
  const [liveBonusDiscrepancyResult, setLiveBonusDiscrepancyResult] = useState(null);
  const [discrepancyViewMode, setDiscrepancyViewMode] = useState('matches'); // 'matches' | 'players'
  const [discrepancySearchText, setDiscrepancySearchText] = useState('');
  const [expandedDiscrepancyMatchIds, setExpandedDiscrepancyMatchIds] = useState({});
  const [expandedDiscrepancyPlayerKeys, setExpandedDiscrepancyPlayerKeys] = useState({});
  const [discrepancyInfoOpen, setDiscrepancyInfoOpen] = useState(false);
  const [showClusterYearGapsModal, setShowClusterYearGapsModal] = useState(false);
  const [yearGapsGroupId, setYearGapsGroupId] = useState(null);
  const [loadingClusterYearGaps, setLoadingClusterYearGaps] = useState(false);
  const [clusterYearGapsResult, setClusterYearGapsResult] = useState(null);
  const [yearGapsSearchText, setYearGapsSearchText] = useState('');
  const [yearGapsYearFilter, setYearGapsYearFilter] = useState(null); // null = tutti gli anni buco
  const [yearGapsInfoOpen, setYearGapsInfoOpen] = useState(false);
  const [yearGapsFillTarget, setYearGapsFillTarget] = useState(null); // { cluster, gap }
  const [yearGapsFillRole, setYearGapsFillRole] = useState('C');
  const [yearGapsFillTeamId, setYearGapsFillTeamId] = useState(null);
  const [savingYearGapsFill, setSavingYearGapsFill] = useState(false);
  const [clusterFilterStatus, setClusterFilterStatus] = useState(null); // null, 'pending', 'approved', 'rejected'
  const [clusterTabSearchText, setClusterTabSearchText] = useState('');
  const [showClusterFilters, setShowClusterFilters] = useState(false);
  const [clusterFilters, setClusterFilters] = useState({
    groupId: null,
    leagueYears: [],
    birthYears: [],
    multiRoleOnly: false,
    includeSingles: false,
  });
  const [openClusterFilterSection, setOpenClusterFilterSection] = useState(null);
  const [clusterModalSearchText, setClusterModalSearchText] = useState('');
  const [suggestionEditModal, setSuggestionEditModal] = useState(null);
  const [showCreateClusterModal, setShowCreateClusterModal] = useState(false);
  const [searchPlayersQuery, setSearchPlayersQuery] = useState('');
  const [searchedPlayers, setSearchedPlayers] = useState([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [selectedPlayersForCluster, setSelectedPlayersForCluster] = useState([]);
  
  // Approved clusters grouped by player
  const [approvedClustersByPlayer, setApprovedClustersByPlayer] = useState([]);
  const [unclusteredPlayersByPlayer, setUnclusteredPlayersByPlayer] = useState([]);
  const [loadingApprovedClusters, setLoadingApprovedClusters] = useState(false);
  const [refreshingApprovedClusters, setRefreshingApprovedClusters] = useState(false);
  const [showPlayerClusterDetail, setShowPlayerClusterDetail] = useState(false);
  const [selectedPlayerCluster, setSelectedPlayerCluster] = useState(null);
  const [availablePlayersToAdd, setAvailablePlayersToAdd] = useState([]);
  const [loadingAvailablePlayers, setLoadingAvailablePlayers] = useState(false);
  const [showAddPlayers, setShowAddPlayers] = useState(false);
  const [hasAvailablePlayers, setHasAvailablePlayers] = useState(false);
  const [removingLeagueKey, setRemovingLeagueKey] = useState(null);
  const [clusterBirthYearDraft, setClusterBirthYearDraft] = useState('');
  const [showClusterBirthYearPicker, setShowClusterBirthYearPicker] = useState(false);
  const [savingClusterBirthYear, setSavingClusterBirthYear] = useState(false);
  const [clusterRoleDraft, setClusterRoleDraft] = useState('');
  const [showClusterRolePicker, setShowClusterRolePicker] = useState(false);
  const [savingClusterRole, setSavingClusterRole] = useState(false);
  const [officialGroupsDisabled, setOfficialGroupsDisabled] = useState(false);

  const [appLoadingPreview, setAppLoadingPreview] = useState({ uri: null, type: null, name: null });
  const [appLoadingPickStaging, setAppLoadingPickStaging] = useState(null);
  const [pickingAppLoading, setPickingAppLoading] = useState(false);
  const [appLoadingSimulateOpen, setAppLoadingSimulateOpen] = useState(false);
  const [simulateProgress, setSimulateProgress] = useState(0);
  const [loadingSectionOpen, setLoadingSectionOpen] = useState(false);
  const [logoSectionOpen, setLogoSectionOpen] = useState(false);
  const [loginLogoPreview, setLoginLogoPreview] = useState(null);
  const [pickingLoginLogo, setPickingLoginLogo] = useState(false);
  const [loginBackgroundSectionOpen, setLoginBackgroundSectionOpen] = useState(false);
  const [loginBackgroundPreview, setLoginBackgroundPreview] = useState(null);
  const [pickingLoginBackground, setPickingLoginBackground] = useState(false);
  const [matchBackgroundSectionOpen, setMatchBackgroundSectionOpen] = useState(false);
  const [matchBackgroundPreview, setMatchBackgroundPreview] = useState(null);
  const [pickingMatchBackground, setPickingMatchBackground] = useState(false);
  
  const isSuperuser = !!(user?.is_superuser === true || user?.is_superuser === 1 || user?.is_superuser === '1');
  const activeAppLoadingPreview = appLoadingPickStaging || appLoadingPreview;
  const isFeatureDisabledError = (error) => Number(error?.response?.status) === 410;
  
  // Verifica permessi
  useEffect(() => {
    if (!isSuperuser) {
      showToast('Non hai i permessi per accedere a questa sezione');
      setTimeout(() => navigation.goBack(), 2500);
    }
  }, [isSuperuser, navigation]);

  // Carica giocatori singoli solo quando il filtro è attivo
  useEffect(() => {
    if (!isSuperuser || !clusterFilters.includeSingles) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const allSingles = await fetchAllUnclusteredPlayers();
        if (!cancelled) setUnclusteredPlayersByPlayer(allSingles);
      } catch (error) {
        if (cancelled) return;
        console.error('Error loading unclustered players:', error);
        showToast('Impossibile caricare i giocatori singoli');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperuser, clusterFilters.includeSingles]);
  
  // Carica utenti
  const loadUsers = async ({ silent = false } = {}) => {
    if (!isSuperuser) return;
    try {
      // Spinner a pieno schermo solo al primo caricamento (lista vuota)
      if (!silent && users.length === 0) setLoadingUsers(true);
      const response = await superuserService.getUsers();
      setUsers(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error loading users:', error);
      showToast('Impossibile caricare gli utenti');
    } finally {
      setLoadingUsers(false);
      setRefreshingUsers(false);
    }
  };
  
  // Carica leghe
  const loadLeagues = async ({ silent = false } = {}) => {
    if (!isSuperuser) return;
    try {
      if (!silent) setLoadingLeagues(true);
      const response = await superuserService.getLeagues();
      const raw = response?.data;
      setLeagues(Array.isArray(raw) ? raw : []);
    } catch (error) {
      console.error('Error loading leagues:', error);
      showToast('Impossibile caricare le leghe');
    } finally {
      setLoadingLeagues(false);
      setRefreshingLeagues(false);
    }
  };

  const patchLeagueLocal = (leagueId, patch) => {
    const id = Number(leagueId);
    if (!id) return;
    setLeagues((prev) =>
      (Array.isArray(prev) ? prev : []).map((l) =>
        Number(l.id) === id ? { ...l, ...patch } : l
      )
    );
  };
  
  // Carica gruppi ufficiali
  const loadOfficialGroups = async () => {
    if (!isSuperuser) return;
    try {
      setLoadingOfficialGroups(true);
      const response = await superuserService.getOfficialGroups();
      setOfficialGroups(response.data || []);
      setOfficialGroupsDisabled(false);
    } catch (error) {
      if (isFeatureDisabledError(error)) {
        setOfficialGroups([]);
        setOfficialGroupsDisabled(true);
        return;
      }
      console.error('Error loading official groups:', error);
      showToast('Impossibile caricare i gruppi ufficiali');
    } finally {
      setLoadingOfficialGroups(false);
      setRefreshingOfficialGroups(false);
    }
  };

  const handleToggleMainMenuGroup = async (item) => {
    if (!item?.id) return;
    const isSelected = Number(item.show_in_main_menu) === 1;
    setTogglingMenuGroupId(item.id);
    try {
      await superuserService.setOfficialGroupMainMenu(item.id, !isSelected);
      const nextFlag = isSelected ? 0 : 1;
      setOfficialGroups((prev) =>
        prev.map((group) => ({
          ...group,
          show_in_main_menu: group.id === item.id ? nextFlag : 0,
        }))
      );
      setSelectedGroupForEdit((prev) =>
        prev && prev.id === item.id ? { ...prev, show_in_main_menu: nextFlag } : prev
      );
      showToast(
        isSelected ? 'Gruppo rimosso dal menu principale' : `"${item.name}" mostrato nel menu principale`,
        'success'
      );
    } catch (error) {
      console.error('Error toggling main menu group:', error);
      showToast('Impossibile aggiornare il menu principale');
    } finally {
      setTogglingMenuGroupId(null);
    }
  };
  
  // Carica suggerimenti cluster per un gruppo
  const loadClusterSuggestions = async (groupId) => {
    if (!isSuperuser || !groupId) return;
    try {
      setLoadingSuggestions(true);
      const response = await superuserService.getPlayerClusterSuggestions(groupId);
      const list = Array.isArray(response?.data?.suggestions) ? response.data.suggestions : [];
      setSuggestions(list);
    } catch (error) {
      console.error('Error loading cluster suggestions:', error);
      showToast('Impossibile caricare i suggerimenti');
    } finally {
      setLoadingSuggestions(false);
    }
  };
  
  // Carica cluster per un gruppo
  const clusterApiErrorMessage = (error, fallback) => {
    if (error?.response?.data?.message) return String(error.response.data.message);
    if (error?.code === 'ECONNABORTED') return 'Il server impiega troppo tempo: riprova tra poco.';
    if (error?.message) return String(error.message);
    return fallback;
  };

  const loadClusters = async (groupId, status = null) => {
    const gid = Number(groupId);
    if (!isSuperuser || !Number.isFinite(gid) || gid <= 0) return;
    try {
      setLoadingClusters(true);
      const response = await superuserService.getPlayerClusters(gid, status);
      const list = Array.isArray(response?.data?.clusters) ? response.data.clusters : [];
      setClusters(list);
    } catch (error) {
      console.error('Error loading clusters:', error);
      showToast(clusterApiErrorMessage(error, 'Impossibile caricare i cluster'));
    } finally {
      setLoadingClusters(false);
    }
  };
  
  const fetchAllApprovedClusters = async () => {
    const groupsResponse = await superuserService.getOfficialGroups();
    const groups = groupsResponse.data || [];
    const allClusters = [];
    for (const group of groups) {
      try {
        const clustersResponse = await superuserService.getPlayerClusters(group.id, 'approved');
        const clusters = clustersResponse.data?.clusters || [];
        clusters.forEach((cluster) => {
          cluster.group_name = group.name;
          cluster.group_id = group.id;
        });
        allClusters.push(...clusters);
      } catch (error) {
        console.error(`Error loading clusters for group ${group.id}:`, error);
      }
    }
    return allClusters;
  };

  const fetchAllUnclusteredPlayers = async () => {
    const groupsResponse = await superuserService.getOfficialGroups();
    const groups = groupsResponse.data || [];
    const allSingles = [];
    for (const group of groups) {
      try {
        const res = await superuserService.getUnclusteredPlayers(group.id);
        const players = res.data?.players || [];
        allSingles.push(
          ...buildUnclusteredPlayersList(players, {
            group_id: group.id,
            group_name: group.name,
          }),
        );
      } catch (error) {
        console.error(`Error loading unclustered players for group ${group.id}:`, error);
      }
    }
    return allSingles.sort((a, b) => {
      const nameCmp = a.name.localeCompare(b.name, 'it');
      if (nameCmp !== 0) return nameCmp;
      return Number(a.player_id) - Number(b.player_id);
    });
  };

  // Carica tutti i cluster approvati raggruppati per giocatore
  const loadApprovedClustersByPlayer = async ({ includeSingles = false } = {}) => {
    if (!isSuperuser) return;
    try {
      setLoadingApprovedClusters(true);
      if (includeSingles) {
        const [allClusters, allSingles] = await Promise.all([
          fetchAllApprovedClusters(),
          fetchAllUnclusteredPlayers(),
        ]);
        setApprovedClustersByPlayer(buildApprovedClustersList(allClusters));
        setUnclusteredPlayersByPlayer(allSingles);
      } else {
        const allClusters = await fetchAllApprovedClusters();
        setApprovedClustersByPlayer(buildApprovedClustersList(allClusters));
      }
    } catch (error) {
      if (isFeatureDisabledError(error)) {
        setApprovedClustersByPlayer([]);
        setUnclusteredPlayersByPlayer([]);
        setOfficialGroupsDisabled(true);
        return;
      }
      console.error('Error loading approved clusters:', error);
      showToast('Impossibile caricare i cluster approvati');
    } finally {
      setLoadingApprovedClusters(false);
      setRefreshingApprovedClusters(false);
    }
  };

  const refreshSelectedPlayerClusterAfterChange = async (clusterId) => {
    const allClusters = await fetchAllApprovedClusters();
    const updatedList = buildApprovedClustersList(allClusters);
    setApprovedClustersByPlayer(updatedList);
    const updatedCluster = updatedList.find((c) => Number(c.cluster_id) === Number(clusterId));
    if (updatedCluster && (updatedCluster.leagues || []).length > 0) {
      setSelectedPlayerCluster(updatedCluster);
      setClusterBirthYearDraft(getSuggestedClusterBirthYear(updatedCluster.leagues));
      setClusterRoleDraft(getSuggestedClusterRole(updatedCluster.leagues));
      const groupId = updatedCluster.leagues[0]?.group_id;
      const existingLeagueIds = updatedCluster.leagues.map((l) => l.id);
      if (groupId) {
        await checkAvailablePlayers(updatedCluster.name, groupId, existingLeagueIds);
      }
    } else {
      setShowPlayerClusterDetail(false);
      setSelectedPlayerCluster(null);
      setShowAddPlayers(false);
      setAvailablePlayersToAdd([]);
      setHasAvailablePlayers(false);
    }
  };

  const handleRemovePlayerFromClusterLeague = (league) => {
    if (!selectedPlayerCluster || !league?.cluster_id || !league?.player_id) return;
    const leagueLabel = league.name || 'questa lega';
    const teamLabel = league.team_name || 'squadra sconosciuta';
    const roleLabel = formatClusterPlayerRole(league.role);
    const playerName = selectedPlayerCluster.name;
    setConfirmModal({
      title: 'Dissocia dal cluster',
      message: `Dissociare ${playerName} da "${leagueLabel}" (${league.group_name || 'gruppo'}) — ${teamLabel}, ${roleLabel}?`,
      confirmText: 'Dissocia',
      destructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        const removeKey = `${league.cluster_id}-${league.player_id}`;
        setRemovingLeagueKey(removeKey);
        try {
          await superuserService.removePlayerFromCluster(league.cluster_id, league.player_id);
          showToast('Giocatore dissociato dal cluster', 'success');
          await refreshSelectedPlayerClusterAfterChange(league.cluster_id);
        } catch (error) {
          console.error('Error removing player from cluster:', error);
          showToast(error.response?.data?.message || 'Errore durante la dissociazione');
        } finally {
          setRemovingLeagueKey(null);
        }
      },
    });
  };

  const refreshSelectedSinglePlayerAfterChange = async (playerId) => {
    const allSingles = await fetchAllUnclusteredPlayers();
    setUnclusteredPlayersByPlayer(allSingles);
    const updated = allSingles.find((s) => Number(s.player_id) === Number(playerId));
    if (updated) {
      setSelectedPlayerCluster(updated);
      setClusterBirthYearDraft(getSuggestedClusterBirthYear(updated.leagues));
      setClusterRoleDraft(getSuggestedClusterRole(updated.leagues));
      return;
    }
    setShowPlayerClusterDetail(false);
    setSelectedPlayerCluster(null);
  };

  const handleApplyClusterBirthYear = async (yearOverride) => {
    if (!selectedPlayerCluster) return;
    const isSingle = !!selectedPlayerCluster.is_single_player;
    const clusterId = selectedPlayerCluster.cluster_id;
    const playerId = Number(
      selectedPlayerCluster.player_id || selectedPlayerCluster.leagues?.[0]?.player_id,
    );
    if (!isSingle && !clusterId) return;
    if (isSingle && (!Number.isFinite(playerId) || playerId <= 0)) return;

    const leagues = selectedPlayerCluster.leagues || [];
    const yearStr = String(yearOverride !== undefined ? yearOverride : clusterBirthYearDraft || '').trim();
    if (!yearStr) {
      const anyHasYear = leagues.some((l) => formatBirthYear(l.birth_year));
      if (!anyHasYear) return;
    } else if (getClusterUniformBirthYear(leagues) === yearStr) {
      return;
    }
    if (yearStr && (!/^\d{4}$/.test(yearStr) || Number(yearStr) < 1900 || Number(yearStr) > new Date().getFullYear())) {
      showToast('Anno non valido');
      return;
    }
    if (yearOverride !== undefined) setClusterBirthYearDraft(yearStr);
    setSavingClusterBirthYear(true);
    try {
      if (isSingle) {
        await superuserService.setPlayerBirthYear(playerId, yearStr || null);
        showToast(
          yearStr ? `Anno ${yearStr} aggiornato` : 'Anno di nascita rimosso',
          'success',
        );
        await refreshSelectedSinglePlayerAfterChange(playerId);
      } else {
        await superuserService.setClusterBirthYear(clusterId, yearStr || null);
        await refreshSelectedPlayerClusterAfterChange(clusterId);
      }
    } catch (error) {
      console.error('Error setting birth year:', error);
      showToast(error.response?.data?.message || 'Errore aggiornamento anno');
    } finally {
      setSavingClusterBirthYear(false);
    }
  };

  const handleApplyClusterRole = async (roleOverride) => {
    if (!selectedPlayerCluster) return;
    const isSingle = !!selectedPlayerCluster.is_single_player;
    const clusterId = selectedPlayerCluster.cluster_id;
    const playerId = Number(
      selectedPlayerCluster.player_id || selectedPlayerCluster.leagues?.[0]?.player_id,
    );
    if (!isSingle && !clusterId) return;
    if (isSingle && (!Number.isFinite(playerId) || playerId <= 0)) return;

    const leagues = selectedPlayerCluster.leagues || [];
    const roleCode = normalizeClusterRoleCode(
      roleOverride !== undefined ? roleOverride : clusterRoleDraft,
    );
    if (!roleCode) return;
    if (getClusterUniformRole(leagues) === roleCode) return;

    if (roleOverride !== undefined) setClusterRoleDraft(roleCode);
    setSavingClusterRole(true);
    try {
      if (isSingle) {
        await superuserService.setPlayerRole(playerId, roleCode);
        showToast(`Ruolo ${roleCode} aggiornato`, 'success');
        await refreshSelectedSinglePlayerAfterChange(playerId);
      } else {
        await superuserService.setClusterRole(clusterId, roleCode);
        showToast(`Ruolo ${roleCode} applicato a tutto il cluster`, 'success');
        await refreshSelectedPlayerClusterAfterChange(clusterId);
      }
    } catch (error) {
      console.error('Error setting role:', error);
      showToast(error.response?.data?.message || 'Errore aggiornamento ruolo');
    } finally {
      setSavingClusterRole(false);
    }
  };

  const showBirthYearPropagationConfirm = ({ birthYear, missingCount, onApplyAll, onAddOnly }) => {
    const countLabel = missingCount === 1 ? '1 giocatore' : `${missingCount} giocatori`;
    setConfirmModal({
      title: 'Anno di nascita del cluster',
      message:
        `Nel cluster ci sono ancora ${countLabel} senza anno di nascita. ` +
        `Quello che stai aggiungendo ha anno ${birthYear}.\n\n` +
        `Vuoi impostare ${birthYear} come anno di nascita per tutti i giocatori del cluster?`,
      confirmText: `Applica ${birthYear} a tutti`,
      secondaryText: 'Aggiungi senza aggiornare',
      onConfirm: async () => {
        setConfirmModal(null);
        await onApplyAll();
      },
      onSecondary: async () => {
        setConfirmModal(null);
        await onAddOnly();
      },
    });
  };

  const executeApproveSuggestion = async (suggestion, groupId, applyBirthYearToCluster, playerIdsOverride = null, forceNewCluster = false) => {
    const allPlayerIds = Array.isArray(playerIdsOverride) && playerIdsOverride.length
      ? playerIdsOverride.map(Number).filter((id) => id > 0)
      : [
        ...(suggestion.existing_leagues || []).map((l) => l.player_id),
        ...(suggestion.all_new_player_ids || []),
      ];
    const payload = {
      official_group_id: groupId,
      cluster_id: forceNewCluster ? null : (suggestion.cluster_id || null),
      player_ids: allPlayerIds,
    };
    if (applyBirthYearToCluster === true || applyBirthYearToCluster === false) {
      payload.apply_birth_year_to_cluster = applyBirthYearToCluster;
    }
    const res = await superuserService.approveSuggestion(payload);
    showToast(res.data?.message || 'Cluster approvato', 'success');
    await loadClusterSuggestions(groupId);
    await loadClusters(groupId, clusterFilterStatus);
  };

  const handleApproveSuggestion = (suggestion, groupId, playerIdsOverride = null, forceNewCluster = false) => {
    const birthYear = suggestion.birth_year;
    const missingInCluster = (suggestion.missing_birth_year_in_cluster || []).length;
    const missingInNew = (suggestion.missing_birth_year_new || []).length;
    const hasNewWithYear = (suggestion.new_leagues || []).some((l) => l.birth_year === birthYear);
    const extendingExisting = !!suggestion.cluster_id && !forceNewCluster;
    const needsPrompt =
      birthYear != null
      && hasNewWithYear
      && (extendingExisting ? missingInCluster > 0 : missingInCluster + missingInNew > 0);

    const run = async (applyBirthYearToCluster) => {
      try {
        await executeApproveSuggestion(suggestion, groupId, applyBirthYearToCluster, playerIdsOverride, forceNewCluster);
      } catch (error) {
        const data = error.response?.data;
        if (error.response?.status === 409 && data?.code === 'CONFIRM_BIRTH_YEAR_PROPAGATION') {
          showBirthYearPropagationConfirm({
            birthYear: data.birth_year,
            missingCount: data.missing_count,
            onApplyAll: () => run(true),
            onAddOnly: () => run(false),
          });
          return;
        }
        showToast(data?.message || 'Errore approvazione');
      }
    };

    if (needsPrompt) {
      const missingCount = extendingExisting ? missingInCluster : missingInCluster + missingInNew;
      showBirthYearPropagationConfirm({
        birthYear,
        missingCount,
        onApplyAll: () => run(true),
        onAddOnly: () => run(false),
      });
      return;
    }
    run(undefined);
  };

  const handleDismissSuggestion = async (suggestion, groupId) => {
    try {
      const allPlayerIds = [
        ...(suggestion.existing_leagues || []).map((l) => l.player_id),
        ...(suggestion.all_new_player_ids || []),
      ];
      await superuserService.dismissSuggestion({
        official_group_id: groupId,
        player_ids: allPlayerIds,
      });
      showToast('Suggerimento nascosto', 'success');
      await loadClusterSuggestions(groupId);
    } catch (error) {
      showToast(error.response?.data?.message || 'Errore');
    }
  };

  const openSuggestionEditModal = (suggestion, mode = 'extend') => {
    const allPlayers = buildSuggestionPlayerList(suggestion);
    const players = mode === 'new' ? allPlayers.filter((p) => !p.in_cluster) : allPlayers;
    const selected = {};
    players.forEach((p) => {
      selected[p.player_id] = mode === 'extend' ? !!p.in_cluster : false;
    });
    setSuggestionEditModal({ suggestion, players, selected, mode });
  };

  const closeSuggestionEditModal = () => {
    setSuggestionEditModal(null);
  };

  const toggleSuggestionEditPlayer = (playerId, value) => {
    if (suggestionEditModal) {
      const target = (suggestionEditModal.players || []).find((p) => Number(p.player_id) === Number(playerId));
      if (target?.in_cluster) return;
    }
    if (value && suggestionEditModal) {
      const target = (suggestionEditModal.players || []).find((p) => Number(p.player_id) === Number(playerId));
      const targetLeagueId = Number(target?.league_id);
      if (Number.isFinite(targetLeagueId) && targetLeagueId > 0) {
        const conflict = (suggestionEditModal.players || []).some(
          (p) =>
            suggestionEditModal.selected?.[p.player_id]
            && Number(p.league_id) === targetLeagueId
            && Number(p.player_id) !== Number(playerId)
        );
        if (conflict) {
          showToast('C\'è già un giocatore selezionato per questa lega/stagione');
          return;
        }
      }
    }
    setSuggestionEditModal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        selected: { ...prev.selected, [playerId]: value },
      };
    });
  };

  const handleSaveSuggestionEdit = () => {
    if (!suggestionEditModal || !selectedGroupForEdit?.id) return;
    const { suggestion, selected, mode = 'extend' } = suggestionEditModal;
    const existingIds = new Set(
      (suggestion.existing_leagues || []).map((l) => Number(l.player_id)).filter((id) => id > 0)
    );
    const playerIds = Object.entries(selected)
      .filter(([, on]) => on)
      .map(([id]) => Number(id))
      .filter((id) => id > 0);

    if (mode === 'new') {
      const newOnlyIds = playerIds.filter((id) => !existingIds.has(id));
      if (newOnlyIds.length < 1) {
        showToast('Seleziona almeno un giocatore per il nuovo cluster');
        return;
      }
      if (hasDuplicateSelectedLeague(suggestionEditModal.players, selected)) {
        showToast('Non puoi associare due giocatori della stessa lega/stagione');
        return;
      }
      const groupId = Number(selectedGroupForEdit.id);
      setSuggestionEditModal(null);
      handleApproveSuggestion(suggestion, groupId, newOnlyIds, true);
      return;
    }

    if (suggestion.cluster_id) {
      const newSelected = playerIds.filter((id) => !existingIds.has(id));
      if (newSelected.length === 0) {
        showToast('Seleziona almeno un giocatore non ancora nel cluster');
        return;
      }
    } else if (playerIds.length < 2) {
      showToast('Seleziona almeno 2 giocatori per creare il cluster');
      return;
    }

    if (hasDuplicateSelectedLeague(suggestionEditModal.players, selected)) {
      showToast('Non puoi associare due giocatori della stessa lega/stagione');
      return;
    }

    const groupId = Number(selectedGroupForEdit.id);
    setSuggestionEditModal(null);
    handleApproveSuggestion(suggestion, groupId, playerIds, false);
  };
  
  // Approva cluster
  const handleApproveCluster = async (clusterId, groupId) => {
    try {
      await superuserService.approvePlayerCluster(clusterId);
      showToast('Cluster approvato', 'success');
      await loadClusters(groupId, clusterFilterStatus);
    } catch (error) {
      console.error('Error approving cluster:', error);
      showToast(error.response?.data?.message || 'Errore durante l\'approvazione');
    }
  };
  
  // Rifiuta cluster
  const handleRejectCluster = async (clusterId, groupId) => {
    try {
      await superuserService.rejectPlayerCluster(clusterId);
      showToast('Cluster rifiutato', 'success');
      await loadClusters(groupId, clusterFilterStatus);
    } catch (error) {
      console.error('Error rejecting cluster:', error);
      showToast(error.response?.data?.message || 'Errore durante il rifiuto');
    }
  };
  
  // Cerca giocatori
  const searchPlayers = async (groupId, query, leagueId = null) => {
    if (!isSuperuser || !groupId) return;
    try {
      setLoadingPlayers(true);
      const response = await superuserService.searchPlayers(groupId, query, leagueId);
      setSearchedPlayers(response.data.players || []);
    } catch (error) {
      console.error('Error searching players:', error);
      showToast('Impossibile cercare i giocatori');
    } finally {
      setLoadingPlayers(false);
    }
  };
  
  // Verifica se ci sono giocatori disponibili da aggiungere
  const checkAvailablePlayers = async (playerName, groupId, existingLeagueIds) => {
    if (!isSuperuser || !groupId || !playerName) {
      setHasAvailablePlayers(false);
      return;
    }
    try {
      // Estrai nome e cognome dal nome completo
      const nameParts = playerName.trim().split(' ');
      if (nameParts.length < 2) {
        setHasAvailablePlayers(false);
        return;
      }
      
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ');
      
      // Cerca giocatori con lo stesso nome nelle leghe del gruppo
      const response = await superuserService.searchPlayers(groupId, `${firstName} ${lastName}`);
      const allPlayers = response.data.players || [];
      
      // Filtra solo quelli che non sono già nelle leghe del giocatore cluster
      const availablePlayers = allPlayers.filter(player => {
        // Costruisci il nome completo del giocatore
        const playerFullName = `${player.first_name || ''} ${player.last_name || ''}`.trim();
        // Verifica che il nome corrisponda esattamente
        if (playerFullName.toLowerCase() !== playerName.toLowerCase()) {
          return false;
        }
        // Verifica che non sia già in una lega del cluster
        return !existingLeagueIds.includes(player.league_id);
      });
      
      const hasAvailable = availablePlayers.length > 0;
      setHasAvailablePlayers(hasAvailable);
      
    } catch (error) {
      console.error('Error checking available players:', error);
      setHasAvailablePlayers(false);
    }
  };
  
  // Cerca altre copie del giocatore nelle leghe del gruppo
  const searchAvailablePlayersForCluster = async (playerName, groupId, existingLeagueIds) => {
    if (!isSuperuser || !groupId || !playerName) return;
    try {
      setLoadingAvailablePlayers(true);
      
      // Estrai nome e cognome dal nome completo
      const nameParts = playerName.trim().split(' ');
      if (nameParts.length < 2) {
        setAvailablePlayersToAdd([]);
        setShowAddPlayers(true);
        return;
      }
      
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ');
      
      // Cerca giocatori con lo stesso nome nelle leghe del gruppo
      const response = await superuserService.searchPlayers(groupId, `${firstName} ${lastName}`);
      const allPlayers = response.data.players || [];
      
      // Filtra solo quelli che non sono già nelle leghe del giocatore cluster
      const availablePlayers = allPlayers.filter(player => {
        // Costruisci il nome completo del giocatore
        const playerFullName = `${player.first_name || ''} ${player.last_name || ''}`.trim();
        // Verifica che il nome corrisponda esattamente
        if (playerFullName.toLowerCase() !== playerName.toLowerCase()) {
          return false;
        }
        // Verifica che non sia già in una lega del cluster
        return !existingLeagueIds.includes(player.league_id);
      });
      
      setAvailablePlayersToAdd(availablePlayers);
      setShowAddPlayers(true);
      const hasAvailable = availablePlayers.length > 0;
      setHasAvailablePlayers(hasAvailable);
    } catch (error) {
      console.error('Error searching available players:', error);
      showToast('Impossibile cercare i giocatori disponibili');
    } finally {
      setLoadingAvailablePlayers(false);
    }
  };
  
  const executeAddPlayerToCluster = async (clusterId, playerId, applyBirthYearToCluster, afterSuccess) => {
    const options =
      applyBirthYearToCluster === true || applyBirthYearToCluster === false
        ? { apply_birth_year_to_cluster: applyBirthYearToCluster }
        : {};
    const res = await superuserService.addPlayerToCluster(clusterId, playerId, options);
    showToast(res.data?.message || 'Giocatore aggiunto al cluster', 'success');
    if (afterSuccess) await afterSuccess();
  };

  // Aggiungi giocatore al cluster approvato
  const handleAddPlayerToApprovedCluster = (playerToAdd) => {
    if (!selectedPlayerCluster || !playerToAdd) return;

    const clusterId = Number(selectedPlayerCluster.cluster_id || selectedPlayerCluster.clusters?.[0]?.id);
    if (!clusterId) {
      showToast('Cluster non trovato');
      return;
    }

    const playerBirthYear =
      playerToAdd.birth_year != null && Number.isFinite(Number(playerToAdd.birth_year))
        ? Number(playerToAdd.birth_year)
        : null;
    const missingInCluster = (selectedPlayerCluster.leagues || []).filter(
      (l) => l.birth_year == null || l.birth_year === ''
    ).length;

    const afterSuccess = async () => {
      await refreshSelectedPlayerClusterAfterChange(clusterId);
      setAvailablePlayersToAdd((prev) => {
        const updated = prev.filter((p) => p.id !== playerToAdd.id);
        if (updated.length === 0) {
          setShowAddPlayers(false);
          setHasAvailablePlayers(false);
        }
        return updated;
      });
    };

    const run = async (applyBirthYearToCluster) => {
      try {
        await executeAddPlayerToCluster(
          clusterId,
          playerToAdd.id,
          applyBirthYearToCluster,
          afterSuccess
        );
      } catch (error) {
        const data = error.response?.data;
        if (error.response?.status === 409 && data?.code === 'CONFIRM_BIRTH_YEAR_PROPAGATION') {
          showBirthYearPropagationConfirm({
            birthYear: data.birth_year,
            missingCount: data.missing_count,
            onApplyAll: () => run(true),
            onAddOnly: () => run(false),
          });
          return;
        }
        console.error('Error adding player to cluster:', error);
        showToast(data?.message || 'Errore durante l\'aggiunta del giocatore');
      }
    };

    if (playerBirthYear && missingInCluster > 0) {
      showBirthYearPropagationConfirm({
        birthYear: playerBirthYear,
        missingCount: missingInCluster,
        onApplyAll: () => run(true),
        onAddOnly: () => run(false),
      });
      return;
    }
    run(undefined);
  };
  
  // Crea cluster manuale
  const handleCreateManualCluster = async (groupId) => {
    if (selectedPlayersForCluster.length < 2) {
      showToast('Seleziona almeno 2 giocatori');
      return;
    }
    try {
      await superuserService.createPlayerCluster({
        official_group_id: groupId,
        player_ids: selectedPlayersForCluster.map(p => p.id),
        suggested_by_system: false,
        status: 'pending'
      });
      showToast('Cluster creato e in attesa di approvazione', 'success');
      setShowCreateClusterModal(false);
      setSelectedPlayersForCluster([]);
      setSearchPlayersQuery('');
      await loadClusters(groupId, clusterFilterStatus);
    } catch (error) {
      console.error('Error creating manual cluster:', error);
      showToast(error.response?.data?.message || 'Errore durante la creazione del cluster');
    }
  };
  
  // Aggiungi giocatore a cluster esistente (lista cluster)
  const handleAddPlayerToCluster = (clusterId, playerId, groupId) => {
    const run = async (applyBirthYearToCluster) => {
      try {
        await executeAddPlayerToCluster(clusterId, playerId, applyBirthYearToCluster, async () => {
          await loadClusters(groupId, clusterFilterStatus);
        });
      } catch (error) {
        const data = error.response?.data;
        if (error.response?.status === 409 && data?.code === 'CONFIRM_BIRTH_YEAR_PROPAGATION') {
          showBirthYearPropagationConfirm({
            birthYear: data.birth_year,
            missingCount: data.missing_count,
            onApplyAll: () => run(true),
            onAddOnly: () => run(false),
          });
          return;
        }
        console.error('Error adding player to cluster:', error);
        showToast(data?.message || 'Errore durante l\'aggiunta');
      }
    };
    run(undefined);
  };
  
  // Carica dati quando cambia tab
  useEffect(() => {
    if (isSuperuser) {
      if (activeTab === 'users') {
        void loadUsers({ silent: users.length > 0 });
      } else if (activeTab === 'leagues') {
        void loadLeagues({ silent: leagues.length > 0 });
      } else if (activeTab === 'officials') {
        loadOfficialGroups();
      }
    }
  }, [activeTab, isSuperuser]);

  useEffect(() => {
    if (!isSuperuser || activeTab !== 'appSettings') return;
    getAppLoadingMediaSettings().then(setAppLoadingPreview);
    getLoginLogoSettings().then(setLoginLogoPreview);
    getLoginBackgroundSettings().then(setLoginBackgroundPreview);
    getMatchBackgroundSettings().then(setMatchBackgroundPreview);
  }, [activeTab, isSuperuser]);

  useEffect(() => {
    if (!appLoadingSimulateOpen) {
      setSimulateProgress(0);
      return;
    }
    let frame;
    const start = Date.now();
    const cycleMs = 4800;
    const tick = () => {
      const phase = ((Date.now() - start) % cycleMs) / cycleMs;
      setSimulateProgress(phase);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [appLoadingSimulateOpen]);

  const handlePickAppLoadingMedia = async () => {
    if (!isSuperuser) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'image/gif',
          'image/png',
          'image/jpeg',
          'video/mp4',
          'video/quicktime',
          'video/webm',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];
      const pickType = guessPickMediaType(asset.mimeType, asset.name);
      setAppLoadingPickStaging({
        uri: asset.uri,
        type: pickType,
        name: asset.name || 'file',
      });
      setPickingAppLoading(true);
      const saved = await saveAppLoadingMediaFromPicker(asset);
      setAppLoadingPreview(saved);
      showToast('Schermata di caricamento aggiornata', 'success');
    } catch (e) {
      console.error('App loading media pick:', e);
      showToast(e?.message || 'Impossibile importare il file');
    } finally {
      setAppLoadingPickStaging(null);
      setPickingAppLoading(false);
    }
  };

  const handleClearAppLoadingMedia = async () => {
    if (!isSuperuser) return;
    try {
      setPickingAppLoading(true);
      setAppLoadingPickStaging(null);
      await clearAppLoadingMedia();
      setAppLoadingPreview({ uri: null, type: null, name: null });
      showToast('Ripristinata schermata predefinita', 'success');
    } catch (e) {
      showToast(e?.message || 'Impossibile rimuovere il file');
    } finally {
      setPickingAppLoading(false);
    }
  };

  const handlePickLoginLogo = async () => {
    if (!isSuperuser) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];
      setPickingLoginLogo(true);
      const saved = await saveLoginLogoFromPicker(asset);
      setLoginLogoPreview(saved);
      await refreshAuthBranding();
      showToast('Logo login aggiornato', 'success');
    } catch (e) {
      console.error('Login logo pick:', e);
      showToast(e?.message || 'Impossibile importare il file');
    } finally {
      setPickingLoginLogo(false);
    }
  };

  const handleClearLoginLogo = async () => {
    if (!isSuperuser) return;
    try {
      setPickingLoginLogo(true);
      await clearLoginLogo();
      setLoginLogoPreview(null);
      await refreshAuthBranding();
      showToast('Logo login rimosso, verrà visualizzata la scritta predefinita', 'success');
    } catch (e) {
      showToast(e?.message || 'Impossibile rimuovere il logo');
    } finally {
      setPickingLoginLogo(false);
    }
  };

  const handlePickLoginBackground = async () => {
    if (!isSuperuser) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];
      setPickingLoginBackground(true);
      const saved = await saveLoginBackgroundFromPicker(asset);
      setLoginBackgroundPreview(saved);
      await refreshAuthBranding();
      showToast('Sfondo login aggiornato', 'success');
    } catch (e) {
      console.error('Login background pick:', e);
      showToast(e?.message || 'Impossibile importare il file');
    } finally {
      setPickingLoginBackground(false);
    }
  };

  const handleClearLoginBackground = async () => {
    if (!isSuperuser) return;
    try {
      setPickingLoginBackground(true);
      await clearLoginBackground();
      setLoginBackgroundPreview(null);
      await refreshAuthBranding();
      showToast('Sfondo login rimosso, verrà usato lo sfondo predefinito', 'success');
    } catch (e) {
      showToast(e?.message || 'Impossibile rimuovere lo sfondo');
    } finally {
      setPickingLoginBackground(false);
    }
  };

  const handlePickMatchBackground = async () => {
    if (!isSuperuser) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];
      setPickingMatchBackground(true);
      const saved = await saveMatchBackgroundFromPicker(asset);
      setMatchBackgroundPreview(saved);
      showToast('Sfondo partita aggiornato', 'success');
    } catch (e) {
      console.error('Match background pick:', e);
      showToast(e?.message || 'Impossibile importare il file');
    } finally {
      setPickingMatchBackground(false);
    }
  };

  const handleClearMatchBackground = async () => {
    if (!isSuperuser) return;
    try {
      setPickingMatchBackground(true);
      await clearMatchBackground();
      const bundled = await getMatchBackgroundSettings();
      setMatchBackgroundPreview(bundled);
      showToast('Sfondo partita ripristinato al predefinito in-app', 'success');
    } catch (e) {
      showToast(e?.message || 'Impossibile ripristinare lo sfondo');
    } finally {
      setPickingMatchBackground(false);
    }
  };
  
  // Imposta livello superuser: 0 = nessun ruolo, 1 = super user, 2 = gestore partite
  const handleSetSuperuserLevel = async (userId, currentLevel, nextLevel) => {
    if (Number(currentLevel || 0) === Number(nextLevel || 0)) return;
    const labels = {
      0: 'nessun ruolo',
      1: 'super user',
      2: 'gestore partite',
    };
    setConfirmModal({
      title: 'Aggiorna ruolo utente',
      message: `Confermi il cambio ruolo a "${labels[nextLevel] || 'nessun ruolo'}"?`,
      confirmText: 'Conferma',
      caution: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await superuserService.setSuperuserLevel(userId, nextLevel);
          setSelectedUserDetail((prev) => (
            prev && Number(prev.id) === Number(userId)
              ? { ...prev, is_superuser: nextLevel }
              : prev
          ));
          await loadUsers({ silent: true });
          showToast(`Ruolo aggiornato: ${labels[nextLevel] || 'nessun ruolo'}`, 'success');
        } catch (error) {
          console.error('Error updating superuser level:', error);
          showToast(error.response?.data?.message || 'Errore durante l\'operazione');
        }
      },
    });
  };

  const roleLabelForUser = (suLevel) => {
    const n = Number(suLevel || 0);
    if (n === 2) return 'Gestore partite';
    if (n === 1) return 'Super user';
    return 'Utente';
  };

  const renderUserRoleIcon = (suLevel, { size = 16, compact = false } = {}) => {
    const n = Number(suLevel || 0);
    const badgeStyle = compact
      ? [styles.userRoleBadgeCompact]
      : [styles.userRoleBadge];
    if (n === 2) {
      return (
        <View style={[...badgeStyle, styles.roleOptionActiveManager]}>
          <Ionicons name="football" size={size} color="#fff" />
        </View>
      );
    }
    if (n === 1) {
      return (
        <View style={[...badgeStyle, styles.roleOptionActiveSuper]}>
          <Ionicons name="star" size={size} color="#fff" />
        </View>
      );
    }
    return (
      <View style={[...badgeStyle, styles.roleOptionActiveUser]}>
        <Ionicons name="person" size={size} color="#fff" />
      </View>
    );
  };

  const renderUserRoleSelector = (user, { compact = false } = {}) => {
    const suLevel = Number(user?.is_superuser || 0);
    const iconSize = compact ? 14 : 18;
    // Ordine per importanza: utente → gestore partite → super user
    return (
      <View style={[styles.roleSelector, !compact && styles.roleSelectorInDetail]}>
        <TouchableOpacity
          style={[
            styles.roleOption,
            !compact && styles.roleOptionInDetail,
            suLevel === 0 && styles.roleOptionActiveUser,
          ]}
          onPress={() => handleSetSuperuserLevel(user.id, suLevel, 0)}
        >
          <Ionicons
            name={suLevel === 0 ? 'person' : 'person-outline'}
            size={iconSize}
            color={suLevel === 0 ? '#fff' : '#2f6fed'}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.roleOption,
            !compact && styles.roleOptionInDetail,
            suLevel === 2 && styles.roleOptionActiveManager,
          ]}
          onPress={() => handleSetSuperuserLevel(user.id, suLevel, 2)}
        >
          <Ionicons
            name={suLevel === 2 ? 'football' : 'football-outline'}
            size={iconSize}
            color={suLevel === 2 ? '#fff' : '#2e7d32'}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.roleOption,
            !compact && styles.roleOptionInDetail,
            suLevel === 1 && styles.roleOptionActiveSuper,
          ]}
          onPress={() => handleSetSuperuserLevel(user.id, suLevel, 1)}
        >
          <Ionicons
            name={suLevel === 1 ? 'star' : 'star-outline'}
            size={iconSize}
            color={suLevel === 1 ? '#fff' : '#f4b400'}
          />
        </TouchableOpacity>
      </View>
    );
  };

  const openUserDetail = (user) => {
    if (!user) return;
    setSelectedUserDetail(user);
    setUserDetailDraftUsername(String(user.username || ''));
    setUserDetailDraftEmail(String(user.email || ''));
    setUserDetailDraftPassword('');
    setUserDetailEditingField(null);
    setUserDetailPasswordVisible(false);
    setUserDetailPasswordUnlocked(false);
    setUserDetailLeagues([]);
    setUserDetailLeagueSearch('');
    void loadUserDetailLeagues(user.id);
  };

  const closeUserDetail = () => {
    setSelectedUserDetail(null);
    setUserDetailDraftUsername('');
    setUserDetailDraftEmail('');
    setUserDetailDraftPassword('');
    setUserDetailEditingField(null);
    setUserDetailPasswordVisible(false);
    setUserDetailPasswordUnlocked(false);
    setSavingUserDetail(false);
    setUserDetailLeagues([]);
    setUserDetailLeagueSearch('');
    setLoadingUserDetailLeagues(false);
  };

  const loadUserDetailLeagues = async (userId) => {
    const uid = Number(userId);
    if (!uid) return;
    try {
      setLoadingUserDetailLeagues(true);
      const res = await superuserService.getUserLeagues(uid);
      const list = Array.isArray(res.data?.leagues) ? res.data.leagues : [];
      setUserDetailLeagues(list);
    } catch (error) {
      console.error('Error loading user leagues:', error);
      setUserDetailLeagues([]);
      showToast(error.response?.data?.message || 'Errore caricamento leghe utente');
    } finally {
      setLoadingUserDetailLeagues(false);
    }
  };

  const filteredUserDetailLeagues = useMemo(() => {
    const q = userDetailLeagueSearch.trim().toLowerCase();
    if (!q) return userDetailLeagues;
    return userDetailLeagues.filter((lg) => {
      const leagueName = String(lg.league_name || '').toLowerCase();
      const teamName = String(lg.team_name || '').toLowerCase();
      return leagueName.includes(q) || teamName.includes(q);
    });
  }, [userDetailLeagues, userDetailLeagueSearch]);

  const requestDoubleConfirm = ({ title, message, confirmText = 'Conferma', destructive = true, onFinal }) => {
    setConfirmModal({
      title,
      message,
      confirmText: 'Continua',
      destructive,
      onConfirm: () => {
        setConfirmModal(null);
        setConfirmModal({
          title: 'Conferma definitiva',
          message: `${message}\n\nSei sicuro? L'operazione verrà applicata subito.`,
          confirmText,
          destructive,
          onConfirm: async () => {
            setConfirmModal(null);
            await onFinal?.();
          },
        });
      },
    });
  };

  const saveUserDetailUsername = () => {
    const user = selectedUserDetail;
    if (!user) return;
    const next = String(userDetailDraftUsername || '').trim();
    if (!next || next.length < 2) {
      showToast('Nome utente non valido');
      return;
    }
    if (next === String(user.username || '')) {
      setUserDetailEditingField(null);
      return;
    }
    requestDoubleConfirm({
      title: 'Modifica nome utente',
      message: `Cambiare il nome utente da "${user.username}" a "${next}"?`,
      confirmText: 'Salva nome',
      onFinal: async () => {
        try {
          setSavingUserDetail(true);
          await superuserService.updateUserUsername(user.id, next);
          setSelectedUserDetail((prev) => (prev ? { ...prev, username: next } : prev));
          setUserDetailEditingField(null);
          await loadUsers({ silent: true });
          showToast('Nome utente aggiornato', 'success');
        } catch (error) {
          showToast(error.response?.data?.message || 'Errore aggiornamento nome utente');
        } finally {
          setSavingUserDetail(false);
        }
      },
    });
  };

  const saveUserDetailEmail = () => {
    const user = selectedUserDetail;
    if (!user) return;
    const next = String(userDetailDraftEmail || '').trim().toLowerCase();
    if (!next || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      showToast('Email non valida');
      return;
    }
    if (next === String(user.email || '').trim().toLowerCase()) {
      setUserDetailEditingField(null);
      return;
    }
    requestDoubleConfirm({
      title: 'Modifica email',
      message: `Cambiare l'email da "${user.email}" a "${next}"?`,
      confirmText: 'Salva email',
      onFinal: async () => {
        try {
          setSavingUserDetail(true);
          await superuserService.updateUserEmail(user.id, next);
          setSelectedUserDetail((prev) => (prev ? { ...prev, email: next } : prev));
          setUserDetailEditingField(null);
          await loadUsers({ silent: true });
          showToast('Email aggiornata', 'success');
        } catch (error) {
          showToast(error.response?.data?.message || 'Errore aggiornamento email');
        } finally {
          setSavingUserDetail(false);
        }
      },
    });
  };

  const unlockUserDetailPassword = () => {
    setConfirmModal({
      title: 'Modificare la password?',
      message: `Vuoi cambiare la password di "${selectedUserDetail?.username || 'questo utente'}"?`,
      confirmText: 'Continua',
      destructive: true,
      onConfirm: () => {
        setConfirmModal(null);
        setConfirmModal({
          title: 'Conferma',
          message: 'Confermi di voler impostare una nuova password per questo account?',
          confirmText: 'Procedi',
          destructive: true,
          onConfirm: () => {
            setConfirmModal(null);
            setUserDetailPasswordUnlocked(true);
            setUserDetailEditingField('password');
            setUserDetailDraftPassword('');
            setUserDetailPasswordVisible(false);
          },
        });
      },
    });
  };

  const toggleUserDetailPasswordVisible = () => {
    if (!userDetailPasswordUnlocked) {
      unlockUserDetailPassword();
      return;
    }
    if (userDetailPasswordVisible) {
      setUserDetailPasswordVisible(false);
      return;
    }
    setConfirmModal({
      title: 'Mostrare la password?',
      message: 'Confermi di voler visualizzare la password in chiaro (quella che stai impostando)?',
      confirmText: 'Continua',
      destructive: true,
      onConfirm: () => {
        setConfirmModal(null);
        setConfirmModal({
          title: 'Conferma visualizzazione',
          message: 'La password sarà visibile a schermo. Procedi solo se sei in un ambiente sicuro.',
          confirmText: 'Mostra',
          destructive: true,
          onConfirm: () => {
            setConfirmModal(null);
            setUserDetailPasswordVisible(true);
          },
        });
      },
    });
  };

  const saveUserDetailPassword = () => {
    const user = selectedUserDetail;
    if (!user) return;
    const next = String(userDetailDraftPassword || '').trim();
    if (!next || next.length < 6) {
      showToast('La password deve essere di almeno 6 caratteri');
      return;
    }
    requestDoubleConfirm({
      title: 'Modifica password',
      message: `Impostare una nuova password per "${user.username}"?`,
      confirmText: 'Salva password',
      onFinal: async () => {
        try {
          setSavingUserDetail(true);
          await superuserService.updateUserPassword(user.id, next);
          setUserDetailDraftPassword('');
          setUserDetailEditingField(null);
          setUserDetailPasswordVisible(false);
          setUserDetailPasswordUnlocked(false);
          showToast('Password aggiornata', 'success');
        } catch (error) {
          showToast(error.response?.data?.message || 'Errore aggiornamento password');
        } finally {
          setSavingUserDetail(false);
        }
      },
    });
  };
  
  // Elimina lega
  const handleDeleteLeague = (leagueId, leagueName) => {
    setConfirmModal({
      title: 'Elimina Lega',
      message: `Sei sicuro di voler eliminare la lega "${leagueName}"? Questa azione è irreversibile.`,
      confirmText: 'Elimina',
      destructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await superuserService.deleteLeague(leagueId);
          setLeagues((prev) =>
            (Array.isArray(prev) ? prev : []).filter((l) => Number(l.id) !== Number(leagueId))
          );
          showToast('Lega eliminata con successo', 'success');
        } catch (error) {
          console.error('Error deleting league:', error);
          showToast(error.response?.data?.message || 'Errore durante l\'eliminazione');
        }
      },
    });
  };
  
  // Entra in lega come admin
  const handleJoinLeagueAsAdmin = async (leagueId) => {
    try {
      await superuserService.joinLeagueAsAdmin(leagueId);
      showToast('Aggiunto come admin alla lega', 'success');
      setTimeout(() => navigation.navigate('League', { leagueId }), 1500);
    } catch (error) {
      console.error('Error joining league as admin:', error);
      showToast(error.response?.data?.message || 'Errore durante l\'operazione');
    }
  };
  
  // Gestisce il click sul checkbox "ufficiale" di una lega
  const handleToggleLeagueOfficial = async (league) => {
    if (league.is_official) {
      setConfirmModal({
        title: 'Rimuovi Lega Ufficiale',
        message: `Sei sicuro di voler rimuovere "${league.name}" dallo stato ufficiale?`,
        confirmText: 'Rimuovi',
        destructive: true,
        onConfirm: async () => {
          setConfirmModal(null);
          try {
            const res = await superuserService.setLeagueOfficial(league.id, { is_official: false });
            const updated = res?.data?.league;
            patchLeagueLocal(league.id, {
              is_official: 0,
              official_group_id: null,
              official_group_name: null,
              ...(updated || {}),
            });
          } catch (error) {
            console.error('Error removing official status:', error);
            showToast(error.response?.data?.message || 'Errore durante l\'operazione');
          }
        },
      });
    } else {
      // Apri modal per selezionare/creare gruppo
      setSelectedLeagueForOfficial(league);
      setShowOfficialGroupModal(true);
      // Carica i gruppi se non sono già stati caricati
      if (!officialGroupsDisabled && officialGroups.length === 0) {
        loadOfficialGroups();
      }
    }
  };
  
  // Gestisce la selezione di un gruppo per una lega
  const handleSelectGroupForLeague = async (groupId) => {
    if (!selectedLeagueForOfficial) return;
    const leagueId = selectedLeagueForOfficial.id;
    const group = (officialGroups || []).find((g) => Number(g.id) === Number(groupId));
    
    try {
      const res = await superuserService.setLeagueOfficial(leagueId, {
        is_official: true,
        official_group_id: groupId,
      });
      const updated = res?.data?.league;
      setShowOfficialGroupModal(false);
      setSelectedLeagueForOfficial(null);
      patchLeagueLocal(leagueId, {
        is_official: 1,
        official_group_id: Number(groupId),
        official_group_name: updated?.official_group_name || group?.name || null,
        ...(updated || {}),
      });
    } catch (error) {
      console.error('Error setting league official:', error);
      if (isFeatureDisabledError(error)) {
        setOfficialGroupsDisabled(true);
      } else {
        showToast(error.response?.data?.message || 'Errore durante l\'operazione');
      }
    }
  };
  
  // Crea un nuovo gruppo ufficiale
  const handleCreateOfficialGroup = async () => {
    if (!newGroupName.trim()) {
      showToast('Il nome del gruppo è obbligatorio');
      return;
    }
    
    try {
      const response = await superuserService.createOfficialGroup({
        name: newGroupName.trim(),
        description: newGroupDescription.trim() || null,
      });
      setShowCreateGroupModal(false);
      setNewGroupName('');
      setNewGroupDescription('');
      const created = response?.data?.group || response?.data;
      if (created?.id) {
        setOfficialGroups((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          if (list.some((g) => Number(g.id) === Number(created.id))) return list;
          return [created, ...list];
        });
      } else {
        await loadOfficialGroups();
      }
      // Se c'era una lega selezionata, assegnala al nuovo gruppo
      if (selectedLeagueForOfficial && created?.id) {
        await handleSelectGroupForLeague(created.id);
      }
    } catch (error) {
      console.error('Error creating official group:', error);
      showToast(error.response?.data?.message || 'Errore durante la creazione del gruppo');
    }
  };

  const handleOfficialGroupLogoEditPress = () => {
    if (uploadingGroupLogo) return;
    if (selectedGroupForEdit?.logo_path) {
      setConfirmModal({
        title: 'Logo gruppo',
        message: 'Vuoi sostituire il logo o rimuoverlo?',
        confirmText: 'Scegli immagine',
        secondaryText: 'Rimuovi',
        onConfirm: () => {
          setConfirmModal(null);
          void handlePickOfficialGroupLogo();
        },
        onSecondary: () => {
          setConfirmModal(null);
          setConfirmModal({
            title: 'Rimuovi logo',
            message: 'Vuoi rimuovere il logo di questo gruppo?',
            confirmText: 'Rimuovi',
            destructive: true,
            onConfirm: () => {
              setConfirmModal(null);
              void handleRemoveOfficialGroupLogo();
            },
          });
        },
      });
      return;
    }
    void handlePickOfficialGroupLogo();
  };

  const handlePickOfficialGroupLogo = async () => {
    const groupId = Number(selectedGroupForEdit?.id);
    if (!groupId) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showToast('Concedi accesso alla galleria per selezionare un logo');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaType?.Images || 'images',
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) return;
      const picked = result.assets[0];
      const sizeMb = Number(picked?.fileSize || 0) > 0 ? Number(picked.fileSize) / (1024 * 1024) : 0;
      if (sizeMb > 2) {
        showToast('Il file è troppo grande. Massimo 2MB');
        return;
      }
      setUploadingGroupLogo(true);
      const res = await superuserService.uploadOfficialGroupLogo(groupId, picked.uri);
      const logoPath = res?.data?.logo_path || null;
      setSelectedGroupForEdit((prev) => (prev ? { ...prev, logo_path: logoPath } : prev));
      setOfficialGroups((prev) =>
        (Array.isArray(prev) ? prev : []).map((g) =>
          Number(g.id) === groupId ? { ...g, logo_path: logoPath } : g
        )
      );
      showToast('Logo gruppo aggiornato', 'success');
    } catch (error) {
      showToast(error.response?.data?.message || error.message || 'Errore caricamento logo');
    } finally {
      setUploadingGroupLogo(false);
    }
  };

  const handleRemoveOfficialGroupLogo = async () => {
    const groupId = Number(selectedGroupForEdit?.id);
    if (!groupId) return;
    try {
      setUploadingGroupLogo(true);
      await superuserService.removeOfficialGroupLogo(groupId);
      setSelectedGroupForEdit((prev) => (prev ? { ...prev, logo_path: null } : prev));
      setOfficialGroups((prev) =>
        (Array.isArray(prev) ? prev : []).map((g) =>
          Number(g.id) === groupId ? { ...g, logo_path: null } : g
        )
      );
      showToast('Logo gruppo rimosso', 'success');
    } catch (error) {
      showToast(error.response?.data?.message || error.message || 'Errore rimozione logo');
    } finally {
      setUploadingGroupLogo(false);
    }
  };

  const handleSaveLeagueReferenceYear = async (groupId, leagueId, overrideDraft = null) => {
    const draft = String(overrideDraft ?? referenceYearDrafts[String(leagueId)] ?? '').trim();
    if (draft !== '') {
      const n = Number(draft);
      if (!Number.isFinite(n) || n < 1900 || n > 2500) {
        showToast('Anno riferimento non valido (1900-2500)');
        return false;
      }
    }
    try {
      setSavingReferenceYearByLeague((prev) => ({ ...prev, [leagueId]: true }));
      const payloadYear = draft === '' ? null : Math.trunc(Number(draft));
      await superuserService.updateOfficialLeagueReferenceYear(groupId, leagueId, payloadYear);
      setSelectedGroupForEdit((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          leagues: (prev.leagues || []).map((l) =>
            Number(l.id) === Number(leagueId) ? { ...l, reference_year: payloadYear } : l
          ),
        };
      });
      showToast('Anno riferimento salvato', 'success');
      return true;
    } catch (error) {
      console.error('Error saving league reference year:', error);
      showToast(error?.response?.data?.message || 'Errore salvataggio anno riferimento');
      return false;
    } finally {
      setSavingReferenceYearByLeague((prev) => ({ ...prev, [leagueId]: false }));
    }
  };

  const handleToggleOfficialSquadPublic = async (groupId, league) => {
    try {
      const res = await superuserService.toggleOfficialSquadPublic(groupId, league.id);
      const next = Number(res?.data?.is_official_squad_public ?? 0);
      setSelectedGroupForEdit((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          leagues: (prev.leagues || []).map((l) =>
            Number(l.id) === Number(league.id) ? { ...l, is_official_squad_public: next } : l
          ),
        };
      });
      showToast(
        next ? 'Rosa e statistiche ufficiali visibili nella app' : 'Rosa e statistiche nascoste (bozza)',
        'success'
      );
    } catch (error) {
      console.error('Error toggling official squad public:', error);
      showToast(error?.response?.data?.message || 'Errore durante l\'operazione');
    }
  };

  const handleToggleTwoOfficialGroups = async (groupId, league, enabled) => {
    try {
      await superuserService.setOfficialLeagueTwoGroups(groupId, league.id, enabled);
      setSelectedGroupForEdit((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          leagues: (prev.leagues || []).map((l) =>
            Number(l.id) === Number(league.id) ? { ...l, official_two_groups: enabled ? 1 : 0 } : l
          ),
        };
      });
      if (enabled) {
        try {
          const res = await superuserService.getOfficialLeagueGironiTeams(groupId, league.id);
          setGironiTeamsByLeague((prev) => ({ ...prev, [league.id]: res.data?.teams || [] }));
        } catch (_) {
          showToast('Impossibile caricare le squadre per i gironi');
        }
      } else {
        setGironiTeamsByLeague((prev) => {
          const next = { ...prev };
          delete next[league.id];
          return next;
        });
      }
      showToast(
        enabled
          ? 'Due gironi attivi: assegna ogni squadra a G. A o G. B'
          : 'Due gironi disattivati per questa lega',
        'success'
      );
    } catch (error) {
      console.error('Error toggling two official groups:', error);
      showToast(error?.response?.data?.message || 'Errore durante l\'operazione');
    }
  };

  const handleAssignTeamGirone = async (groupId, leagueId, teamId, gironeIndex) => {
    const list = [...(gironiTeamsByLeague[leagueId] || [])];
    if (list.length === 0) return;
    const next = list.map((t) =>
      Number(t.id) === Number(teamId) ? { ...t, girone_index: gironeIndex } : t
    );
    const assignments = next
      .filter((t) => t.girone_index === 1 || t.girone_index === 2)
      .map((t) => ({ team_id: t.id, girone_index: Number(t.girone_index) }));
    try {
      const res = await superuserService.saveOfficialLeagueGironiTeams(groupId, leagueId, assignments);
      setGironiTeamsByLeague((prev) => ({ ...prev, [leagueId]: res.data?.teams || next }));
    } catch (error) {
      console.error('Error saving girone assignment:', error);
      showToast(error?.response?.data?.message || 'Salvataggio girone non riuscito');
    }
  };

  const selectableReferenceYears = useMemo(() => {
    const nowYear = new Date().getFullYear();
    const years = [];
    for (let y = nowYear + 2; y >= nowYear - 25; y -= 1) years.push(y);
    return years;
  }, []);

  const selectableBirthYears = useMemo(() => {
    const maxY = new Date().getFullYear();
    const years = [];
    for (let y = maxY; y >= 1960; y -= 1) years.push(y);
    return years;
  }, []);
  
  // Gestisce il toggle "visibile per collegamento"
  const handleToggleVisibleForLinking = async (league) => {
    try {
      const res = await superuserService.toggleVisibleForLinking(league.id);
      const next = res?.data?.is_visible_for_linking;
      if (next == null) {
        await loadLeagues({ silent: true });
        return;
      }
      patchLeagueLocal(league.id, { is_visible_for_linking: Number(next) });
    } catch (error) {
      console.error('Error toggling visible for linking:', error);
      showToast(error.response?.data?.message || 'Errore durante l\'operazione');
    }
  };

  const handleToggleHiddenFromDiscovery = async (league) => {
    try {
      const res = await superuserService.toggleLeagueHiddenFromDiscovery(league.id);
      const next = res?.data?.is_hidden_from_discovery;
      if (next == null) {
        await loadLeagues({ silent: true });
        return;
      }
      patchLeagueLocal(league.id, { is_hidden_from_discovery: Number(next) });
    } catch (error) {
      console.error('Error toggling hidden from discovery:', error);
      showToast(error.response?.data?.message || 'Errore durante l\'operazione');
    }
  };
  
  // Filtra le leghe (ricerca + filtri)
  const filteredLeagues = useMemo(() => {
    let list = Array.isArray(leagues) ? leagues : [];
    if (leagueFilters.officialOnly) {
      list = list.filter((league) => Number(league.is_official) > 0);
    }

    const linking = Array.isArray(leagueFilters.linking) ? leagueFilters.linking : [];
    if (linking.length > 0) {
      const wantOn = linking.includes('on');
      const wantOff = linking.includes('off');
      list = list.filter((league) => {
        // Collegamento ha senso solo per ufficiali; off include anche le non ufficiali
        const isOfficial = Number(league.is_official) > 0;
        const on = isOfficial && Number(league.is_visible_for_linking ?? 1) === 1;
        return (wantOn && on) || (wantOff && !on);
      });
    }

    const visibility = Array.isArray(leagueFilters.visibility) ? leagueFilters.visibility : [];
    if (visibility.length > 0) {
      const wantVisible = visibility.includes('visible');
      const wantMembersOnly = visibility.includes('members_only');
      list = list.filter((league) => {
        const membersOnly = Number(league.is_hidden_from_discovery || 0) === 1;
        return (wantVisible && !membersOnly) || (wantMembersOnly && membersOnly);
      });
    }

    const privacy = Array.isArray(leagueFilters.privacy) ? leagueFilters.privacy : [];
    if (privacy.length > 0) {
      const wantPublic = privacy.includes('public');
      const wantPrivate = privacy.includes('private');
      list = list.filter((league) => {
        const isPrivate = Number(league.is_private || 0) === 1 || !!league.access_code;
        return (wantPrivate && isPrivate) || (wantPublic && !isPrivate);
      });
    }

    const minRaw = String(leagueFilters.membersMin || '').trim();
    const maxRaw = String(leagueFilters.membersMax || '').trim();
    const minN = minRaw === '' ? null : Number(minRaw);
    const maxN = maxRaw === '' ? null : Number(maxRaw);
    if ((minN != null && Number.isFinite(minN)) || (maxN != null && Number.isFinite(maxN))) {
      list = list.filter((league) => {
        const count = Number(league.member_count || 0);
        if (minN != null && Number.isFinite(minN) && count < minN) return false;
        if (maxN != null && Number.isFinite(maxN) && count > maxN) return false;
        return true;
      });
    }

    const q = leagueSearchText.trim().toLowerCase();
    if (q) {
      list = list.filter((league) => {
        const name = String(league.name || '').toLowerCase();
        const group = String(league.official_group_name || '').toLowerCase();
        return name.includes(q) || group.includes(q);
      });
    }
    return list;
  }, [leagues, leagueFilters, leagueSearchText]);

  const hasActiveLeagueFilters =
    !!leagueFilters.officialOnly
    || (leagueFilters.linking || []).length > 0
    || (leagueFilters.visibility || []).length > 0
    || (leagueFilters.privacy || []).length > 0
    || String(leagueFilters.membersMin || '').trim() !== ''
    || String(leagueFilters.membersMax || '').trim() !== '';

  const clearLeagueFilters = () => {
    setLeagueFilters({
      officialOnly: false,
      linking: [],
      visibility: [],
      privacy: [],
      membersMin: '',
      membersMax: '',
    });
  };

  const closeLeagueFilters = () => {
    setShowLeagueFilters(false);
  };

  const toggleLeagueLinkingFilter = (value) => {
    setLeagueFilters((prev) => {
      const current = Array.isArray(prev.linking) ? prev.linking : [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, linking: next };
    });
  };

  const toggleLeagueVisibilityFilter = (value) => {
    setLeagueFilters((prev) => {
      const current = Array.isArray(prev.visibility) ? prev.visibility : [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, visibility: next };
    });
  };

  const toggleLeaguePrivacyFilter = (value) => {
    setLeagueFilters((prev) => {
      const current = Array.isArray(prev.privacy) ? prev.privacy : [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, privacy: next };
    });
  };

  const setLeagueMembersBound = (key, raw) => {
    const digits = String(raw || '').replace(/[^\d]/g, '');
    setLeagueFilters((prev) => ({ ...prev, [key]: digits }));
  };
  
  // Formatta data/ora
  const formatDateTime = (dateString) => {
    if (!dateString) return 'Mai';
    const date = new Date(dateString);
    return date.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  /** Ultimo accesso compatto per la lista utenti */
  const formatUserLastAccessCompact = (dateString) => {
    if (!dateString) return 'Mai';
    const date = new Date(dateString);
    if (!Number.isFinite(date.getTime())) return 'Mai';
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const dayDiff = Math.round((startToday - startThat) / 86400000);
    if (dayDiff === 0) {
      return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    }
    if (dayDiff === 1) return 'Ieri';
    if (dayDiff > 1 && dayDiff < 7) return `${dayDiff}g fa`;
    return date.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });
  };

  const formatCreationDate = (dateString) => {
    if (!dateString) return '—';
    const date = new Date(dateString);
    return date.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const getLeagueDisplayYear = (league) => {
    const draft = String(referenceYearDrafts[String(league?.id)] ?? '').trim();
    if (draft) return draft;
    if (league?.reference_year != null && String(league.reference_year).trim() !== '') {
      return String(league.reference_year);
    }
    return '—';
  };

  const closeGroupDetailModal = () => {
    setShowGroupDetailModal(false);
    setSelectedGroupForEdit(null);
    setReferenceYearDrafts({});
    setGironiTeamsByLeague({});
    setExpandedGroupLeagueIds({});
  };

  const handleOpenGroupClusters = async () => {
    const gid = Number(selectedGroupForEdit?.id);
    if (!gid) return;
    setShowClusterModal(true);
    setClusterFilterStatus(null);
    await loadClusterSuggestions(gid);
  };

  const loadNeverPlayedPlayers = async (groupId) => {
    const gid = Number(groupId);
    if (!gid) return;
    try {
      setLoadingNeverPlayed(true);
      const res = await superuserService.getNeverPlayedPlayers(gid);
      setNeverPlayedPlayers(Array.isArray(res.data?.players) ? res.data.players : []);
    } catch (error) {
      console.error('Error loading never-played players:', error);
      showToast(error.response?.data?.message || 'Errore caricamento giocatori senza partite');
      setNeverPlayedPlayers([]);
    } finally {
      setLoadingNeverPlayed(false);
    }
  };

  const handleOpenNeverPlayedPlayers = async () => {
    const gid = Number(selectedGroupForEdit?.id);
    if (!gid) return;
    setNeverPlayedSearchText('');
    setNeverPlayedYearFilter(null);
    setShowNeverPlayedModal(true);
    await loadNeverPlayedPlayers(gid);
  };

  const closeNeverPlayedModal = () => {
    setShowNeverPlayedModal(false);
    setNeverPlayedSearchText('');
    setNeverPlayedYearFilter(null);
    setNeverPlayedPlayers([]);
    setDeletingNeverPlayedId(null);
  };

  const openLiveBonusDiscrepancyModal = () => {
    setLiveBonusDiscrepancyResult(null);
    setDiscrepancySearchText('');
    setDiscrepancyViewMode('matches');
    setDiscrepancyInfoOpen(false);
    setExpandedDiscrepancyMatchIds({});
    setExpandedDiscrepancyPlayerKeys({});
    const firstId = officialGroups?.[0]?.id != null ? Number(officialGroups[0].id) : null;
    setDiscrepancyGroupId(firstId);
    setShowLiveBonusDiscrepancyModal(true);
  };

  const openClusterYearGapsModal = () => {
    setClusterYearGapsResult(null);
    setYearGapsSearchText('');
    setYearGapsYearFilter(null);
    setYearGapsInfoOpen(false);
    setYearGapsFillTarget(null);
    setYearGapsFillRole('C');
    setYearGapsFillTeamId(null);
    const firstId = officialGroups?.[0]?.id != null ? Number(officialGroups[0].id) : null;
    setYearGapsGroupId(firstId);
    setShowClusterYearGapsModal(true);
  };

  const closeClusterYearGapsModal = () => {
    setShowClusterYearGapsModal(false);
    setLoadingClusterYearGaps(false);
    setClusterYearGapsResult(null);
    setYearGapsSearchText('');
    setYearGapsYearFilter(null);
    setYearGapsInfoOpen(false);
    setYearGapsFillTarget(null);
    setSavingYearGapsFill(false);
  };

  const loadClusterYearGaps = async (groupId) => {
    const gid = Number(groupId);
    if (!gid) {
      showToast('Seleziona un gruppo ufficiale');
      return;
    }
    try {
      setLoadingClusterYearGaps(true);
      setClusterYearGapsResult(null);
      setYearGapsFillTarget(null);
      const res = await superuserService.getClusterYearGaps(gid);
      setClusterYearGapsResult(res.data || null);
    } catch (error) {
      console.error('Error loading cluster year gaps:', error);
      showToast(error.response?.data?.message || 'Errore scansione buchi anni');
      setClusterYearGapsResult(null);
    } finally {
      setLoadingClusterYearGaps(false);
    }
  };

  const openYearGapsFill = (cluster, gap) => {
    setYearGapsFillTarget({ cluster, gap });
    setYearGapsFillRole(gap?.suggested_role || 'C');
    setYearGapsFillTeamId(
      gap?.suggested_team_id != null ? Number(gap.suggested_team_id) : null
    );
  };

  const submitYearGapsFill = async ({ useExistingPlayerId = null } = {}) => {
    const cluster = yearGapsFillTarget?.cluster;
    const gap = yearGapsFillTarget?.gap;
    if (!cluster?.cluster_id || !gap?.reference_year) return;
    if (!useExistingPlayerId && !yearGapsFillTeamId) {
      showToast('Seleziona una squadra');
      return;
    }
    try {
      setSavingYearGapsFill(true);
      const body = useExistingPlayerId
        ? {
            reference_year: gap.reference_year,
            player_id: useExistingPlayerId,
          }
        : {
            reference_year: gap.reference_year,
            team_id: Number(yearGapsFillTeamId),
            role: yearGapsFillRole,
            birth_year: gap.suggested_birth_year ?? null,
          };
      const res = await superuserService.fillClusterYearGap(cluster.cluster_id, body);
      showToast(res.data?.message || 'Anno aggiunto al cluster');
      setYearGapsFillTarget(null);
      await loadClusterYearGaps(yearGapsGroupId);
    } catch (error) {
      console.error('Error filling cluster year gap:', error);
      showToast(error.response?.data?.message || 'Errore creazione/aggiunta giocatore');
    } finally {
      setSavingYearGapsFill(false);
    }
  };

  const yearGapsYearOptions = useMemo(() => {
    const years = new Set();
    const list = Array.isArray(clusterYearGapsResult?.clusters)
      ? clusterYearGapsResult.clusters
      : [];
    for (const c of list) {
      for (const g of c.gaps || []) {
        const y = Number(g.reference_year);
        if (Number.isFinite(y) && y > 0) years.add(y);
      }
    }
    return [...years].sort((a, b) => a - b);
  }, [clusterYearGapsResult]);

  const filteredClusterYearGaps = useMemo(() => {
    const list = Array.isArray(clusterYearGapsResult?.clusters)
      ? clusterYearGapsResult.clusters
      : [];
    const yearFilter = yearGapsYearFilter != null ? Number(yearGapsYearFilter) : null;
    const q = yearGapsSearchText.trim().toLowerCase();

    return list
      .map((c) => {
        const gaps = Array.isArray(c.gaps) ? c.gaps : [];
        const filteredGaps = yearFilter != null
          ? gaps.filter((g) => Number(g.reference_year) === yearFilter)
          : gaps;
        if (yearFilter != null && filteredGaps.length === 0) return null;
        return { ...c, gaps: filteredGaps };
      })
      .filter(Boolean)
      .filter((c) => {
        if (!q) return true;
        const hay = [
          c.name,
          c.first_name,
          c.last_name,
          ...(c.present_years || []).map(String),
          ...(c.gaps || []).flatMap((g) => [String(g.reference_year), g.league_name, g.suggested_team_name]),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return q.split(/\s+/).every((part) => hay.includes(part));
      });
  }, [clusterYearGapsResult, yearGapsSearchText, yearGapsYearFilter]);

  const closeLiveBonusDiscrepancyModal = () => {
    setShowLiveBonusDiscrepancyModal(false);
    setLoadingLiveBonusDiscrepancies(false);
    setLiveBonusDiscrepancyResult(null);
    setDiscrepancySearchText('');
    setDiscrepancyInfoOpen(false);
    setExpandedDiscrepancyMatchIds({});
    setExpandedDiscrepancyPlayerKeys({});
  };

  const loadLiveBonusDiscrepancies = async (groupId) => {
    const gid = Number(groupId);
    if (!gid) {
      showToast('Seleziona un gruppo ufficiale');
      return;
    }
    try {
      setLoadingLiveBonusDiscrepancies(true);
      setLiveBonusDiscrepancyResult(null);
      setExpandedDiscrepancyMatchIds({});
      setExpandedDiscrepancyPlayerKeys({});
      const res = await superuserService.getLiveBonusDiscrepancies(gid);
      setLiveBonusDiscrepancyResult(res.data || null);
    } catch (error) {
      console.error('Error loading live-bonus discrepancies:', error);
      showToast(error.response?.data?.message || 'Errore scansione discrepanze');
      setLiveBonusDiscrepancyResult(null);
    } finally {
      setLoadingLiveBonusDiscrepancies(false);
    }
  };

  const discrepancyIssueLabel = (issueType) => {
    if (issueType === 'missing_votes') return 'Voti non salvati';
    if (issueType === 'no_presence_with_diretta') return 'Diretta senza presenza';
    return 'Valori diversi';
  };

  const filteredDiscrepancyMatches = useMemo(() => {
    const list = Array.isArray(liveBonusDiscrepancyResult?.matches)
      ? liveBonusDiscrepancyResult.matches
      : [];
    const q = discrepancySearchText.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => {
      const hay = [
        m.label,
        m.league_name,
        m.home_team_name,
        m.away_team_name,
        ...(m.players || []).flatMap((p) => [p.player_name, p.team_name, p.cluster_name, p.fix_summary]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return q.split(/\s+/).every((part) => hay.includes(part));
    });
  }, [liveBonusDiscrepancyResult, discrepancySearchText]);

  const filteredDiscrepancyPlayers = useMemo(() => {
    const list = Array.isArray(liveBonusDiscrepancyResult?.players)
      ? liveBonusDiscrepancyResult.players
      : [];
    const q = discrepancySearchText.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => {
      const hay = [
        p.player_name,
        p.cluster_name,
        p.net_summary,
        ...(p.matches_affected || []).flatMap((m) => [m.label, m.team_name, m.fix_summary]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return q.split(/\s+/).every((part) => hay.includes(part));
    });
  }, [liveBonusDiscrepancyResult, discrepancySearchText]);

  const neverPlayedYearOptions = useMemo(() => {
    const years = new Set();
    let hasNone = false;
    neverPlayedPlayers.forEach((p) => {
      if (p.reference_year != null && Number.isFinite(Number(p.reference_year))) {
        years.add(Number(p.reference_year));
      } else {
        hasNone = true;
      }
    });
    return {
      years: [...years].sort((a, b) => b - a),
      hasNone,
    };
  }, [neverPlayedPlayers]);

  const filteredNeverPlayedPlayers = useMemo(() => {
    let list = neverPlayedPlayers;
    if (neverPlayedYearFilter === 'none') {
      list = list.filter((p) => p.reference_year == null || !Number.isFinite(Number(p.reference_year)));
    } else if (neverPlayedYearFilter != null) {
      list = list.filter((p) => Number(p.reference_year) === Number(neverPlayedYearFilter));
    }
    const q = neverPlayedSearchText.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => {
      const name = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase();
      const team = String(p.team_name || '').toLowerCase();
      const league = String(p.league_name || '').toLowerCase();
      const year = p.reference_year != null ? String(p.reference_year) : '';
      return name.includes(q) || team.includes(q) || league.includes(q) || year.includes(q);
    });
  }, [neverPlayedPlayers, neverPlayedSearchText, neverPlayedYearFilter]);

  const neverPlayedGrouped = useMemo(() => {
    const map = new Map();
    filteredNeverPlayedPlayers.forEach((p) => {
      const key = `${p.league_id}`;
      if (!map.has(key)) {
        map.set(key, {
          league_id: p.league_id,
          league_name: p.league_name,
          reference_year: p.reference_year,
          players: [],
        });
      }
      map.get(key).players.push(p);
    });
    return [...map.values()];
  }, [filteredNeverPlayedPlayers]);

  const performDeleteNeverPlayedPlayer = async (player) => {
    const gid = Number(selectedGroupForEdit?.id);
    const pid = Number(player?.player_id);
    if (!gid || !pid) return;
    try {
      setDeletingNeverPlayedId(pid);
      const res = await superuserService.deleteNeverPlayedPlayer(gid, pid);
      setNeverPlayedPlayers((prev) => prev.filter((p) => Number(p.player_id) !== pid));
      const deletedClusters = Number(res?.data?.clusters_deleted || 0);
      showToast(
        deletedClusters > 0
          ? `Giocatore eliminato (anche ${deletedClusters} cluster vuot${deletedClusters === 1 ? 'o' : 'i'})`
          : 'Giocatore eliminato',
        'success'
      );
    } catch (error) {
      const msg = error.response?.data?.message || 'Errore eliminazione giocatore';
      showToast(msg);
    } finally {
      setDeletingNeverPlayedId(null);
    }
  };

  const requestDeleteNeverPlayedPlayer = (player) => {
    if (!player) return;
    if (player.in_user_squad || player.can_delete === false) {
      setConfirmModal({
        title: 'Eliminazione non consentita',
        message:
          'Questo giocatore fa parte della rosa di un utente in questa lega. '
          + 'Rimuovilo prima dalla rosa fantacalcio, poi riprova.',
        confirmText: 'Ho capito',
        onConfirm: () => setConfirmModal(null),
      });
      return;
    }

    const displayName = `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Giocatore';
    const meta = [
      player.team_name,
      player.league_name,
      player.reference_year != null ? String(player.reference_year) : null,
    ].filter(Boolean).join(' · ');

    setConfirmModal({
      title: 'Eliminare giocatore?',
      message: `Vuoi eliminare ${displayName}${meta ? ` (${meta})` : ''}?\n\nComparirà solo se non ha mai giocato (nessun voto reale né S.V.).`,
      confirmText: 'Continua',
      destructive: true,
      onConfirm: () => {
        setConfirmModal(null);
        setConfirmModal({
          title: 'Conferma definitiva',
          message:
            `Stai per eliminare definitivamente ${displayName} e tutti i dati collegati `
            + `(voti N.D., membership cluster, riferimenti).\n\nL'operazione non è reversibile.`,
          confirmText: 'Elimina definitivamente',
          destructive: true,
          onConfirm: () => {
            setConfirmModal(null);
            void performDeleteNeverPlayedPlayer(player);
          },
        });
      },
    });
  };

  const toggleGroupLeagueExpanded = (leagueId) => {
    setExpandedGroupLeagueIds((prev) => ({
      ...prev,
      [leagueId]: !prev[leagueId],
    }));
  };
  
  // Verifica se utente è online (attività < 5 minuti)
  const isUserOnline = (lastActivity) => {
    if (!lastActivity) return false;
    const lastActivityTime = new Date(lastActivity).getTime();
    const now = Date.now();
    return (now - lastActivityTime) < 300000; // 5 minuti
  };
  
  // Gestisce l'ordinamento
  const handleSort = (column) => {
    if (sortColumn === column) {
      // Se già ordinato per questa colonna, inverte la direzione
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Nuova colonna: di base freccia in basso (desc)
      setSortColumn(column);
      setSortDirection('desc');
    }
  };
  
  // Ordina e filtra gli utenti
  const sortedUsers = useMemo(() => {
    let filtered = users;

    // Filtra per nome utente e/o email
    if (searchText.trim()) {
      const searchLower = searchText.toLowerCase().trim();
      filtered = filtered.filter((user) => {
        const usernameMatch = (user.username || '').toLowerCase().includes(searchLower);
        const emailMatch = (user.email || '').toLowerCase().includes(searchLower);
        return usernameMatch || emailMatch;
      });
    }

    const statuses = Array.isArray(userFilters.statuses) ? userFilters.statuses : [];
    if (statuses.length > 0) {
      const wantOnline = statuses.includes('online');
      const wantOffline = statuses.includes('offline');
      filtered = filtered.filter((user) => {
        const online = !!user.is_online;
        return (wantOnline && online) || (wantOffline && !online);
      });
    }

    const roles = Array.isArray(userFilters.roles) ? userFilters.roles : [];
    if (roles.length > 0) {
      const roleSet = new Set(roles.map((r) => Number(r)));
      filtered = filtered.filter((user) => roleSet.has(Number(user.is_superuser || 0)));
    }

    const fromTs = userFilters.accessFrom
      ? (() => {
          const d = new Date(userFilters.accessFrom);
          d.setHours(0, 0, 0, 0);
          return d.getTime();
        })()
      : null;
    const toTs = userFilters.accessTo
      ? (() => {
          const d = new Date(userFilters.accessTo);
          d.setHours(23, 59, 59, 999);
          return d.getTime();
        })()
      : null;
    if (fromTs != null || toTs != null) {
      filtered = filtered.filter((user) => {
        if (!user.last_login) return false;
        const ts = new Date(user.last_login).getTime();
        if (!Number.isFinite(ts)) return false;
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
        return true;
      });
    }

    // Ordina
    if (!sortColumn) return filtered;

    const loginTs = (u) => (u?.last_login ? new Date(u.last_login).getTime() : 0);

    const sorted = [...filtered].sort((a, b) => {
      let aVal, bVal;

      switch (sortColumn) {
        case 'username':
          aVal = (a.username || '').toLowerCase();
          bVal = (b.username || '').toLowerCase();
          break;
        case 'last_login':
          aVal = loginTs(a);
          bVal = loginTs(b);
          break;
        case 'is_online':
          aVal = a.is_online ? 1 : 0;
          bVal = b.is_online ? 1 : 0;
          break;
        case 'is_superuser':
          {
            const roleOrder = { 0: 0, 2: 1, 1: 2 };
            const aRole = Number(a?.is_superuser || 0);
            const bRole = Number(b?.is_superuser || 0);
            aVal = roleOrder[aRole] ?? 0;
            bVal = roleOrder[bRole] ?? 0;
          }
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;

      // A parità (es. stesso stato): secondo criterio = ultimo accesso (più recente prima)
      if (sortColumn !== 'last_login') {
        const aLogin = loginTs(a);
        const bLogin = loginTs(b);
        if (aLogin !== bLogin) return bLogin - aLogin;
      }
      return 0;
    });

    return sorted;
  }, [users, sortColumn, sortDirection, searchText, userFilters]);

  const hasActiveUserFilters =
    (userFilters.statuses || []).length > 0
    || (userFilters.roles || []).length > 0
    || !!userFilters.accessFrom
    || !!userFilters.accessTo;

  useEffect(() => {
    if (!showUserFilters) {
      setUserFilterMenuLayout(null);
      return undefined;
    }
    let cancelled = false;
    const measureAnchor = () => {
      const node = userFilterBtnRef?.current;
      if (!node || typeof node.measureInWindow !== 'function') return;
      try {
        node.measureInWindow((x, y, width, height) => {
          if (cancelled) return;
          if (
            typeof x !== 'number'
            || typeof y !== 'number'
            || typeof width !== 'number'
            || typeof height !== 'number'
          ) {
            return;
          }
          const panelWidth = Math.min(300, Math.max(240, windowWidth - 24));
          const left = Math.max(12, Math.min(x + width - panelWidth, windowWidth - panelWidth - 12));
          setUserFilterMenuLayout({
            left,
            top: y + height + 6,
            width: panelWidth,
          });
        });
      } catch {
        // Native node non ancora pronto
      }
    };
    measureAnchor();
    const retryTimer = setTimeout(measureAnchor, 64);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [showUserFilters, windowWidth]);

  useEffect(() => {
    if (!showLeagueFilters) {
      setLeagueFilterMenuLayout(null);
      return undefined;
    }
    let cancelled = false;
    const measureAnchor = () => {
      const node = leagueFilterBtnRef?.current;
      if (!node || typeof node.measureInWindow !== 'function') return;
      try {
        node.measureInWindow((x, y, width, height) => {
          if (cancelled) return;
          if (
            typeof x !== 'number'
            || typeof y !== 'number'
            || typeof width !== 'number'
            || typeof height !== 'number'
          ) {
            return;
          }
          const panelWidth = Math.min(300, Math.max(240, windowWidth - 24));
          const left = Math.max(12, Math.min(x + width - panelWidth, windowWidth - panelWidth - 12));
          setLeagueFilterMenuLayout({
            left,
            top: y + height + 6,
            width: panelWidth,
          });
        });
      } catch {
        // Native node non ancora pronto
      }
    };
    measureAnchor();
    const retryTimer = setTimeout(measureAnchor, 64);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [showLeagueFilters, windowWidth]);

  const toggleUserStatusFilter = (status) => {
    setUserFilters((prev) => {
      const current = Array.isArray(prev.statuses) ? prev.statuses : [];
      const next = current.includes(status)
        ? current.filter((s) => s !== status)
        : [...current, status];
      return { ...prev, statuses: next };
    });
  };

  const toggleUserRoleFilter = (role) => {
    const value = Number(role);
    setUserFilters((prev) => {
      const current = Array.isArray(prev.roles) ? prev.roles : [];
      const next = current.includes(value)
        ? current.filter((r) => r !== value)
        : [...current, value];
      return { ...prev, roles: next };
    });
  };

  const clearUserFilters = () => {
    setUserFilters({
      statuses: [],
      roles: [],
      accessFrom: null,
      accessTo: null,
    });
    setUserAccessDatePicker(null);
  };

  const closeUserFilters = () => {
    setShowUserFilters(false);
    setUserAccessDatePicker(null);
  };

  const formatUserFilterDate = (d) => {
    if (!d) return '—';
    const date = new Date(d);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const onUserAccessDateChange = (event, selectedDate) => {
    const field = userAccessDatePicker;
    if (Platform.OS === 'android') {
      setUserAccessDatePicker(null);
    }
    if (event?.type === 'dismissed' || !field) return;
    if (!selectedDate) return;
    const next = new Date(selectedDate);
    next.setHours(12, 0, 0, 0);
    setUserFilters((prev) => ({
      ...prev,
      [field === 'from' ? 'accessFrom' : 'accessTo']: next,
    }));
    if (Platform.OS === 'ios') {
      setUserAccessDatePicker(null);
    }
  };

  const filteredApprovedClustersByPlayer = useMemo(() => {
    const q = clusterTabSearchText.trim();
    const hasStructuralFilters = clusterFilters.groupId != null
      || (clusterFilters.leagueYears || []).length > 0
      || (clusterFilters.birthYears || []).length > 0
      || clusterFilters.multiRoleOnly;
    const clusters = approvedClustersByPlayer.filter((item) => {
      if (q && !matchesNameSearch(item.name, q)) return false;
      if (hasStructuralFilters && !clusterMatchesFilters(item, clusterFilters)) return false;
      return true;
    });
    if (!clusterFilters.includeSingles) return clusters;

    const singles = unclusteredPlayersByPlayer.filter((item) => {
      if (q && !matchesNameSearch(item.name, q)) return false;
      if (hasStructuralFilters && !clusterMatchesFilters(item, clusterFilters)) return false;
      return true;
    });

    return [...clusters, ...singles].sort((a, b) => {
      const nameCmp = a.name.localeCompare(b.name, 'it');
      if (nameCmp !== 0) return nameCmp;
      if (a.is_single_player !== b.is_single_player) return a.is_single_player ? 1 : -1;
      return Number(a.player_id || a.cluster_id || 0) - Number(b.player_id || b.cluster_id || 0);
    });
  }, [approvedClustersByPlayer, unclusteredPlayersByPlayer, clusterTabSearchText, clusterFilters]);

  const clusterFilterOptions = useMemo(() => {
    const groups = new Map();
    const leagueYears = new Set();
    const birthYears = new Set();
    const source = clusterFilters.includeSingles
      ? [...approvedClustersByPlayer, ...unclusteredPlayersByPlayer]
      : approvedClustersByPlayer;
    for (const item of source) {
      if (item.group_id != null) groups.set(item.group_id, item.group_name || '—');
      for (const l of item.leagues || []) {
        const ref = Number(l.reference_year);
        if (Number.isFinite(ref)) leagueYears.add(ref);
        const by = formatBirthYear(l.birth_year);
        if (by) birthYears.add(Number(by));
      }
    }
    return {
      groups: [...groups.entries()]
        .map(([id, name]) => ({ id: Number(id), name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'it')),
      leagueYears: [...leagueYears].sort((a, b) => b - a),
      birthYears: [...birthYears].sort((a, b) => b - a),
    };
  }, [approvedClustersByPlayer, unclusteredPlayersByPlayer, clusterFilters.includeSingles]);

  const hasActiveClusterFilters = clusterFilters.groupId != null
    || (clusterFilters.leagueYears || []).length > 0
    || (clusterFilters.birthYears || []).length > 0
    || clusterFilters.multiRoleOnly
    || clusterFilters.includeSingles;

  const clusterFilterSectionSummaries = useMemo(() => {
    const groupName = clusterFilterOptions.groups.find(
      (g) => Number(g.id) === Number(clusterFilters.groupId),
    )?.name;
    const leagueYearCount = (clusterFilters.leagueYears || []).length;
    const birthYearCount = (clusterFilters.birthYears || []).length;
    return {
      group: clusterFilters.groupId != null ? (groupName || 'Selezionato') : null,
      leagueYear: leagueYearCount > 0 ? `${leagueYearCount} selezionat${leagueYearCount === 1 ? 'o' : 'i'}` : null,
      birthYear: birthYearCount > 0 ? `${birthYearCount} selezionat${birthYearCount === 1 ? 'o' : 'i'}` : null,
      multiRole: clusterFilters.multiRoleOnly ? 'Più di un ruolo' : null,
      singles: clusterFilters.includeSingles ? 'Inclusi' : null,
    };
  }, [clusterFilters, clusterFilterOptions.groups]);

  const toggleClusterFilterSection = (sectionKey) => {
    setOpenClusterFilterSection((prev) => (prev === sectionKey ? null : sectionKey));
  };

  const toggleClusterFilter = (key, value) => {
    setClusterFilters((prev) => ({
      ...prev,
      [key]: prev[key] === value ? null : value,
    }));
  };

  const toggleClusterFilterArray = (key, value) => {
    setClusterFilters((prev) => {
      const current = Array.isArray(prev[key]) ? prev[key] : [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  };

  const clearClusterFilters = () => {
    setClusterFilters({
      groupId: null,
      leagueYears: [],
      birthYears: [],
      multiRoleOnly: false,
      includeSingles: false,
    });
  };

  const filteredSuggestions = useMemo(() => {
    const q = clusterModalSearchText.trim();
    if (!q) return suggestions;
    return suggestions.filter((s) => matchesNameSearch(s.name, q));
  }, [suggestions, clusterModalSearchText]);

  const filteredClusters = useMemo(() => {
    const q = clusterModalSearchText.trim();
    if (!q) return clusters;
    return clusters.filter((c) => clusterMatchesNameSearch(c, q));
  }, [clusters, clusterModalSearchText]);
  
  if (!isSuperuser) {
    return null; // Non mostrare nulla se non è superuser
  }
  
  const renderUserItem = ({ item }) => {
    const suLevel = Number(item?.is_superuser || 0);
    const initial = String(item.username || '?').trim().charAt(0).toUpperCase() || '?';
    const online = !!item.is_online;
    return (
      <TouchableOpacity
        style={styles.userRow}
        onPress={() => openUserDetail(item)}
        activeOpacity={0.72}
      >
        <View style={styles.userAvatar}>
          <Text style={styles.userAvatarText}>{initial}</Text>
          <View style={[styles.userOnlineDot, online && styles.userOnlineDotOn]} />
        </View>

        <View style={styles.userInfoColumn}>
          <Text style={styles.userName} numberOfLines={1}>{item.username}</Text>
          <Text style={styles.userLastAccessSub} numberOfLines={1}>
            {formatUserLastAccessCompact(item.last_login)}
            {' · '}
            {online ? 'Online' : 'Offline'}
          </Text>
        </View>

        <View style={styles.buttonColumn}>
          {renderUserRoleIcon(suLevel)}
        </View>
      </TouchableOpacity>
    );
  };

  const renderUsersSkeleton = () => (
    <View style={styles.usersSkeletonWrap}>
      {Array.from({ length: 8 }).map((_, idx) => (
        <View key={`usk-${idx}`} style={styles.userRowSkeleton}>
          <View style={styles.userAvatarSkeleton} />
          <View style={styles.userSkeletonLines}>
            <View style={[styles.userSkeletonBar, { width: `${58 + (idx % 3) * 10}%` }]} />
            <View style={[styles.userSkeletonBar, styles.userSkeletonBarShort]} />
          </View>
          <View style={styles.userRoleSkeleton} />
        </View>
      ))}
    </View>
  );

  const renderLeaguesSkeleton = () => (
    <View style={styles.leaguesSkeletonWrap}>
      {Array.from({ length: 6 }).map((_, idx) => (
        <View key={`lsk-${idx}`} style={styles.leagueRowSkeleton}>
          <View style={styles.leagueIconSkeleton} />
          <View style={styles.leagueSkeletonLines}>
            <View style={[styles.userSkeletonBar, { width: `${52 + (idx % 3) * 12}%` }]} />
            <View style={[styles.userSkeletonBar, styles.userSkeletonBarShort]} />
            <View style={[styles.userSkeletonBar, { width: '42%', marginTop: 8 }]} />
          </View>
        </View>
      ))}
    </View>
  );
  
  const renderLeagueItem = ({ item }) => {
    const isOfficial = Number(item?.is_official || 0) > 0;
    const isHiddenFromDiscovery = Number(item?.is_hidden_from_discovery || 0) === 1;
    const isVisibleForLinking = Number(item?.is_visible_for_linking ?? 1) === 1;
    const isPrivate = Number(item?.is_private || 0) === 1 || !!item?.access_code;
    const memberCount = Number(item?.member_count || 0);

    return (
      <View style={styles.leagueRow}>
        <View style={styles.leagueRowTop}>
          <View style={[styles.leagueAvatar, isOfficial && styles.leagueAvatarOfficial]}>
            <Ionicons
              name={isOfficial ? 'ribbon' : 'trophy-outline'}
              size={18}
              color={isOfficial ? '#667eea' : '#94a3b8'}
            />
          </View>
          <View style={styles.leagueRowMain}>
            <View style={styles.leagueNameRow}>
              <Text style={styles.leagueName} numberOfLines={1}>{item.name}</Text>
              <TouchableOpacity
                onPress={() => handleToggleLeagueOfficial(item)}
                style={styles.officialCheckbox}
                hitSlop={8}
              >
                <Ionicons
                  name={isOfficial ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={isOfficial ? '#667eea' : '#cbd5e1'}
                />
              </TouchableOpacity>
            </View>
            {isOfficial && item.official_group_name ? (
              <Text style={styles.leagueOfficialGroup} numberOfLines={1}>
                Gruppo · {item.official_group_name}
              </Text>
            ) : null}
            <Text style={styles.leagueMeta} numberOfLines={1}>
              {memberCount} {memberCount === 1 ? 'membro' : 'membri'}
              {' · '}
              {isPrivate ? 'Privata' : 'Pubblica'}
              {' · '}
              {formatCreationDate(item.created_at)}
            </Text>
          </View>
        </View>

        <View style={styles.leagueChipRow}>
          {isOfficial ? (
            <TouchableOpacity
              onPress={() => handleToggleVisibleForLinking(item)}
              activeOpacity={0.75}
              style={[
                styles.leagueChip,
                isVisibleForLinking ? styles.leagueChipLinkOn : styles.leagueChipMuted,
              ]}
            >
              <Ionicons
                name={isVisibleForLinking ? 'link' : 'unlink-outline'}
                size={14}
                color={isVisibleForLinking ? '#4f46e5' : '#94a3b8'}
              />
              <Text
                style={[
                  styles.leagueChipText,
                  isVisibleForLinking && styles.leagueChipTextOn,
                ]}
                numberOfLines={1}
              >
                {isVisibleForLinking ? 'Collegamento on' : 'Collegamento off'}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => handleToggleHiddenFromDiscovery(item)}
            activeOpacity={0.75}
            style={[
              styles.leagueChip,
              isHiddenFromDiscovery ? styles.leagueChipWarn : styles.leagueChipMuted,
            ]}
          >
            <Ionicons
              name={isHiddenFromDiscovery ? 'eye-off-outline' : 'eye-outline'}
              size={14}
              color={isHiddenFromDiscovery ? '#c2410c' : '#94a3b8'}
            />
            <Text
              style={[
                styles.leagueChipText,
                isHiddenFromDiscovery && styles.leagueChipTextWarn,
              ]}
              numberOfLines={1}
            >
              {isHiddenFromDiscovery ? 'Solo iscritti' : 'Visibile'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.leagueActions}>
          <TouchableOpacity
            style={styles.leagueActionButton}
            onPress={() => navigation.navigate('League', { leagueId: item.id })}
          >
            <Ionicons name="eye-outline" size={16} color="#667eea" />
            <Text style={styles.leagueActionText}>Vedi</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.leagueActionButton, styles.leagueActionButtonAdmin]}
            onPress={() => handleJoinLeagueAsAdmin(item.id)}
          >
            <Ionicons name="shield-outline" size={16} color="#15803d" />
            <Text style={[styles.leagueActionText, styles.leagueActionTextAdmin]}>Admin</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.leagueActionButton, styles.leagueActionButtonDanger]}
            onPress={() => handleDeleteLeague(item.id, item.name)}
          >
            <Ionicons name="trash-outline" size={16} color="#dc2626" />
            <Text style={[styles.leagueActionText, styles.leagueActionTextDanger]}>Elimina</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };
  
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#667eea" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Super User</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Tab Navigation */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabContainer}
        contentContainerStyle={styles.tabScrollContent}
      >
        <TouchableOpacity
          style={[styles.tab, activeTab === 'users' && styles.tabActive]}
          onPress={() => setActiveTab('users')}
        >
          <Ionicons 
            name={activeTab === 'users' ? "people" : "people-outline"} 
            size={20} 
            color={activeTab === 'users' ? '#667eea' : '#666'} 
          />
          <Text style={[styles.tabText, activeTab === 'users' && styles.tabTextActive]}>
            Utenti
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'leagues' && styles.tabActive]}
          onPress={() => setActiveTab('leagues')}
        >
          <Ionicons 
            name={activeTab === 'leagues' ? "trophy" : "trophy-outline"} 
            size={20} 
            color={activeTab === 'leagues' ? '#667eea' : '#666'} 
          />
          <Text style={[styles.tabText, activeTab === 'leagues' && styles.tabTextActive]}>
            Leghe
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'officials' && styles.tabActive]}
          onPress={() => setActiveTab('officials')}
        >
          <Ionicons 
            name={activeTab === 'officials' ? "ribbon" : "ribbon-outline"} 
            size={20} 
            color={activeTab === 'officials' ? '#667eea' : '#666'} 
          />
          <Text style={[styles.tabText, activeTab === 'officials' && styles.tabTextActive]}>
            Ufficiali
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'clusters' && styles.tabActive]}
          onPress={() => {
            setActiveTab('clusters');
            if (approvedClustersByPlayer.length === 0) {
              loadApprovedClustersByPlayer();
            }
          }}
        >
          <Ionicons 
            name={activeTab === 'clusters' ? "people" : "people-outline"} 
            size={20} 
            color={activeTab === 'clusters' ? '#667eea' : '#666'} 
          />
          <Text style={[styles.tabText, activeTab === 'clusters' && styles.tabTextActive]}>
            Cluster
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'appSettings' && styles.tabActive]}
          onPress={() => setActiveTab('appSettings')}
        >
          <Ionicons
            name={activeTab === 'appSettings' ? 'settings' : 'settings-outline'}
            size={20}
            color={activeTab === 'appSettings' ? '#667eea' : '#666'}
          />
          <Text
            style={[
              styles.tabText,
              activeTab === 'appSettings' && styles.tabTextActive,
              styles.tabAppSettingsLabel,
            ]}
            numberOfLines={2}
          >
            Impostazioni app
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Tab Content */}
      <View style={styles.content}>
        {activeTab === 'users' && (
          <>
            <View style={styles.usersSearchRow}>
              <View style={[styles.usersSearchContainer, styles.usersSearchContainerFlex]}>
                <Ionicons name="search" size={18} color="#94a3b8" style={styles.searchIcon} />
                <TextInput
                  style={styles.usersSearchInput}
                  placeholder="Cerca nome o email…"
                  placeholderTextColor="#94a3b8"
                  value={searchText}
                  onChangeText={setSearchText}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {searchText.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchText('')} style={styles.clearButton} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color="#94a3b8" />
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                ref={userFilterBtnRef}
                style={[styles.usersFilterBtn, hasActiveUserFilters && styles.usersFilterBtnActive]}
                onPress={() => setShowUserFilters(true)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="options-outline"
                  size={20}
                  color={hasActiveUserFilters ? '#667eea' : '#94a3b8'}
                />
                <View
                  style={[
                    styles.usersFilterCountBadge,
                    hasActiveUserFilters && styles.usersFilterCountBadgeActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.usersFilterCountBadgeText,
                      hasActiveUserFilters && styles.usersFilterCountBadgeTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {sortedUsers.length}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.usersSortBar}>
              <TouchableOpacity
                style={[styles.usersSortChip, sortColumn === 'username' && styles.usersSortChipActive]}
                onPress={() => handleSort('username')}
              >
                <Text style={[styles.usersSortChipText, sortColumn === 'username' && styles.usersSortChipTextActive]}>
                  Utente
                </Text>
                {sortColumn === 'username' ? (
                  <Ionicons
                    name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color="#667eea"
                  />
                ) : null}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.usersSortChip, sortColumn === 'last_login' && styles.usersSortChipActive]}
                onPress={() => handleSort('last_login')}
              >
                <Text style={[styles.usersSortChipText, sortColumn === 'last_login' && styles.usersSortChipTextActive]}>
                  Accesso
                </Text>
                {sortColumn === 'last_login' ? (
                  <Ionicons
                    name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color="#667eea"
                  />
                ) : null}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.usersSortChip, sortColumn === 'is_online' && styles.usersSortChipActive]}
                onPress={() => handleSort('is_online')}
              >
                <Text style={[styles.usersSortChipText, sortColumn === 'is_online' && styles.usersSortChipTextActive]}>
                  Stato
                </Text>
                {sortColumn === 'is_online' ? (
                  <Ionicons
                    name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color="#667eea"
                  />
                ) : null}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.usersSortChip, sortColumn === 'is_superuser' && styles.usersSortChipActive]}
                onPress={() => handleSort('is_superuser')}
              >
                <Text
                  style={[styles.usersSortChipText, sortColumn === 'is_superuser' && styles.usersSortChipTextActive]}
                  numberOfLines={1}
                >
                  Ruolo
                </Text>
                {sortColumn === 'is_superuser' ? (
                  <Ionicons
                    name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color="#667eea"
                  />
                ) : null}
              </TouchableOpacity>
            </View>

            {loadingUsers && users.length === 0 ? (
              renderUsersSkeleton()
            ) : (
              <FlatList
                data={sortedUsers}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderUserItem}
                initialNumToRender={16}
                maxToRenderPerBatch={20}
                windowSize={9}
                removeClippedSubviews
                keyboardShouldPersistTaps="handled"
                refreshControl={
                  <RefreshControl
                    refreshing={refreshingUsers}
                    tintColor="#667eea"
                    colors={['#667eea']}
                    onRefresh={() => {
                      setRefreshingUsers(true);
                      void loadUsers({ silent: true });
                    }}
                  />
                }
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Ionicons name="people-outline" size={44} color="#cbd5e1" />
                    <Text style={styles.emptyText}>
                      {searchText.trim() || hasActiveUserFilters ? 'Nessun risultato' : 'Nessun utente'}
                    </Text>
                  </View>
                }
                contentContainerStyle={styles.usersListContent}
              />
            )}

            <Modal
              visible={showUserFilters}
              transparent
              animationType="fade"
              onRequestClose={closeUserFilters}
            >
              <View style={styles.userFilterMenuRoot}>
                <Pressable
                  style={styles.userFilterMenuBackdrop}
                  onPress={closeUserFilters}
                  accessibilityRole="button"
                  accessibilityLabel="Chiudi filtri utenti"
                />
                {userFilterMenuLayout ? (
                  <View
                    style={[
                      styles.userFilterDropdown,
                      {
                        top: userFilterMenuLayout.top,
                        left: userFilterMenuLayout.left,
                        width: userFilterMenuLayout.width,
                      },
                    ]}
                  >
                    <View style={styles.userFilterDropdownHeader}>
                      <Text style={styles.userFilterDropdownTitle}>Filtri</Text>
                      <TouchableOpacity
                        style={[
                          styles.userFilterPresetChip,
                          !hasActiveUserFilters && styles.userFilterPresetChipActive,
                        ]}
                        onPress={clearUserFilters}
                        activeOpacity={0.75}
                      >
                        <Text
                          style={[
                            styles.userFilterPresetChipText,
                            !hasActiveUserFilters && styles.userFilterPresetChipTextActive,
                          ]}
                        >
                          Azzera
                        </Text>
                        {!hasActiveUserFilters ? (
                          <Ionicons name="checkmark" size={12} color="#4f46e5" />
                        ) : null}
                      </TouchableOpacity>
                    </View>

                    <ScrollView
                      style={styles.userFilterDropdownScroll}
                      contentContainerStyle={styles.userFilterDropdownScrollContent}
                      showsVerticalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      bounces={false}
                      nestedScrollEnabled
                    >
                      <Text style={styles.userFilterSectionLabel}>Stato</Text>
                      {[
                        { key: 'online', label: 'Online', icon: 'radio-button-on' },
                        { key: 'offline', label: 'Offline', icon: 'radio-button-off' },
                      ].map((opt, idx, arr) => {
                        const on = (userFilters.statuses || []).includes(opt.key);
                        return (
                          <TouchableOpacity
                            key={opt.key}
                            style={[
                              styles.userFilterDropdownItem,
                              on && styles.userFilterDropdownItemOn,
                              idx === arr.length - 1 && styles.userFilterDropdownItemLast,
                            ]}
                            onPress={() => toggleUserStatusFilter(opt.key)}
                            activeOpacity={0.8}
                          >
                            <View style={styles.userFilterDropdownItemLeft}>
                              <Ionicons
                                name={opt.icon}
                                size={15}
                                color={on ? '#4f46e5' : '#94a3b8'}
                              />
                              <Text
                                style={[
                                  styles.userFilterDropdownItemText,
                                  on && styles.userFilterDropdownItemTextOn,
                                ]}
                              >
                                {opt.label}
                              </Text>
                            </View>
                            <View style={[styles.userFilterCheck, on && styles.userFilterCheckOn]}>
                              {on ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
                            </View>
                          </TouchableOpacity>
                        );
                      })}

                      <Text style={styles.userFilterSectionLabel}>Ruolo</Text>
                      {[
                        { key: 0, label: 'Utente', icon: 'person-outline' },
                        { key: 2, label: 'Gestore partite', icon: 'football' },
                        { key: 1, label: 'Super user', icon: 'star-outline' },
                      ].map((opt, idx, arr) => {
                        const on = (userFilters.roles || []).includes(opt.key);
                        return (
                          <TouchableOpacity
                            key={`role-${opt.key}`}
                            style={[
                              styles.userFilterDropdownItem,
                              on && styles.userFilterDropdownItemOn,
                              idx === arr.length - 1 && styles.userFilterDropdownItemLast,
                            ]}
                            onPress={() => toggleUserRoleFilter(opt.key)}
                            activeOpacity={0.8}
                          >
                            <View style={styles.userFilterDropdownItemLeft}>
                              <Ionicons
                                name={opt.icon}
                                size={15}
                                color={on ? '#4f46e5' : '#94a3b8'}
                              />
                              <Text
                                style={[
                                  styles.userFilterDropdownItemText,
                                  on && styles.userFilterDropdownItemTextOn,
                                ]}
                              >
                                {opt.label}
                              </Text>
                            </View>
                            <View style={[styles.userFilterCheck, on && styles.userFilterCheckOn]}>
                              {on ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
                            </View>
                          </TouchableOpacity>
                        );
                      })}

                      <Text style={styles.userFilterSectionLabel}>Accesso</Text>
                      {[
                        { field: 'from', key: 'accessFrom', label: 'Dal' },
                        { field: 'to', key: 'accessTo', label: 'Al' },
                      ].map((opt, idx, arr) => {
                        const value = userFilters[opt.key];
                        const on = !!value;
                        return (
                          <View
                            key={opt.field}
                            style={[
                              styles.userFilterDropdownItem,
                              on && styles.userFilterDropdownItemOn,
                              idx === arr.length - 1 && styles.userFilterDropdownItemLast,
                            ]}
                          >
                            <TouchableOpacity
                              style={styles.userFilterDropdownItemLeft}
                              onPress={() => setUserAccessDatePicker(opt.field)}
                              activeOpacity={0.8}
                            >
                              <Ionicons
                                name="calendar-outline"
                                size={15}
                                color={on ? '#4f46e5' : '#94a3b8'}
                              />
                              <Text
                                style={[
                                  styles.userFilterDropdownItemText,
                                  on && styles.userFilterDropdownItemTextOn,
                                ]}
                              >
                                {opt.label}
                              </Text>
                              <Text
                                style={[
                                  styles.userFilterDateValue,
                                  on && styles.userFilterDateValueOn,
                                ]}
                                numberOfLines={1}
                              >
                                {formatUserFilterDate(value)}
                              </Text>
                            </TouchableOpacity>
                            {on ? (
                              <TouchableOpacity
                                onPress={() =>
                                  setUserFilters((prev) => ({ ...prev, [opt.key]: null }))
                                }
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              >
                                <Ionicons name="close-circle" size={18} color="#94a3b8" />
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity
                                onPress={() => setUserAccessDatePicker(opt.field)}
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              >
                                <Ionicons name="add-circle-outline" size={18} color="#94a3b8" />
                              </TouchableOpacity>
                            )}
                          </View>
                        );
                      })}

                      {userAccessDatePicker ? (
                        <View style={styles.userFilterDatePickerWrap}>
                          <DateTimePicker
                            value={
                              (userAccessDatePicker === 'from'
                                ? userFilters.accessFrom
                                : userFilters.accessTo) || new Date()
                            }
                            mode="date"
                            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                            onChange={onUserAccessDateChange}
                            maximumDate={new Date()}
                          />
                        </View>
                      ) : null}
                    </ScrollView>
                  </View>
                ) : null}
              </View>
            </Modal>
          </>
        )}

        {activeTab === 'leagues' && (
          <>
            <View style={styles.leaguesSearchRow}>
              <View style={[styles.usersSearchContainer, styles.usersSearchContainerFlex]}>
                <Ionicons name="search" size={18} color="#94a3b8" style={styles.searchIcon} />
                <TextInput
                  style={styles.usersSearchInput}
                  placeholder="Cerca lega o gruppo…"
                  placeholderTextColor="#94a3b8"
                  value={leagueSearchText}
                  onChangeText={setLeagueSearchText}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {leagueSearchText.length > 0 ? (
                  <TouchableOpacity
                    onPress={() => setLeagueSearchText('')}
                    style={styles.clearButton}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={18} color="#94a3b8" />
                  </TouchableOpacity>
                ) : null}
              </View>
              <TouchableOpacity
                ref={leagueFilterBtnRef}
                style={[styles.usersFilterBtn, hasActiveLeagueFilters && styles.usersFilterBtnActive]}
                onPress={() => setShowLeagueFilters(true)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="options-outline"
                  size={20}
                  color={hasActiveLeagueFilters ? '#667eea' : '#94a3b8'}
                />
                <View
                  style={[
                    styles.usersFilterCountBadge,
                    hasActiveLeagueFilters && styles.usersFilterCountBadgeActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.usersFilterCountBadgeText,
                      hasActiveLeagueFilters && styles.usersFilterCountBadgeTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {filteredLeagues.length}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            {hasActiveLeagueFilters ? (
              <View style={styles.leaguesFilterHintRow}>
                {leagueFilters.officialOnly ? (
                  <View style={styles.leaguesFilterHintChip}>
                    <Ionicons name="ribbon" size={12} color="#4f46e5" />
                    <Text style={styles.leaguesFilterHintText}>Ufficiali</Text>
                  </View>
                ) : null}
                {(leagueFilters.linking || []).includes('on') ? (
                  <View style={styles.leaguesFilterHintChip}>
                    <Text style={styles.leaguesFilterHintText}>Collegamento on</Text>
                  </View>
                ) : null}
                {(leagueFilters.linking || []).includes('off') ? (
                  <View style={styles.leaguesFilterHintChip}>
                    <Text style={styles.leaguesFilterHintText}>Collegamento off</Text>
                  </View>
                ) : null}
                {(leagueFilters.visibility || []).includes('visible') ? (
                  <View style={styles.leaguesFilterHintChip}>
                    <Text style={styles.leaguesFilterHintText}>Visibile</Text>
                  </View>
                ) : null}
                {(leagueFilters.visibility || []).includes('members_only') ? (
                  <View style={styles.leaguesFilterHintChip}>
                    <Text style={styles.leaguesFilterHintText}>Solo iscritti</Text>
                  </View>
                ) : null}
                {(leagueFilters.privacy || []).includes('public') ? (
                  <View style={styles.leaguesFilterHintChip}>
                    <Text style={styles.leaguesFilterHintText}>Pubblica</Text>
                  </View>
                ) : null}
                {(leagueFilters.privacy || []).includes('private') ? (
                  <View style={styles.leaguesFilterHintChip}>
                    <Text style={styles.leaguesFilterHintText}>Privata</Text>
                  </View>
                ) : null}
                {String(leagueFilters.membersMin || '').trim() !== ''
                  || String(leagueFilters.membersMax || '').trim() !== '' ? (
                  <View style={styles.leaguesFilterHintChip}>
                    <Text style={styles.leaguesFilterHintText}>
                      Membri
                      {String(leagueFilters.membersMin || '').trim() !== ''
                        ? ` ≥${String(leagueFilters.membersMin).trim()}`
                        : ''}
                      {String(leagueFilters.membersMax || '').trim() !== ''
                        ? ` ≤${String(leagueFilters.membersMax).trim()}`
                        : ''}
                    </Text>
                  </View>
                ) : null}
                <TouchableOpacity onPress={clearLeagueFilters} hitSlop={8} style={styles.leaguesFilterClearChip}>
                  <Ionicons name="close" size={14} color="#64748b" />
                </TouchableOpacity>
              </View>
            ) : null}

            {loadingLeagues && leagues.length === 0 ? (
              renderLeaguesSkeleton()
            ) : (
              <FlatList
                data={filteredLeagues}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderLeagueItem}
                initialNumToRender={12}
                maxToRenderPerBatch={16}
                windowSize={9}
                removeClippedSubviews
                keyboardShouldPersistTaps="handled"
                refreshControl={
                  <RefreshControl
                    refreshing={refreshingLeagues}
                    tintColor="#667eea"
                    colors={['#667eea']}
                    onRefresh={() => {
                      setRefreshingLeagues(true);
                      void loadLeagues({ silent: true });
                    }}
                  />
                }
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Ionicons name="trophy-outline" size={44} color="#cbd5e1" />
                    <Text style={styles.emptyText}>
                      {leagueSearchText.trim() || hasActiveLeagueFilters
                        ? 'Nessun risultato'
                        : 'Nessuna lega'}
                    </Text>
                  </View>
                }
                contentContainerStyle={styles.leaguesListContent}
              />
            )}

            <Modal
              visible={showLeagueFilters}
              transparent
              animationType="fade"
              onRequestClose={closeLeagueFilters}
            >
              <View style={styles.userFilterMenuRoot}>
                <Pressable
                  style={styles.userFilterMenuBackdrop}
                  onPress={closeLeagueFilters}
                  accessibilityRole="button"
                  accessibilityLabel="Chiudi filtri leghe"
                />
                {leagueFilterMenuLayout ? (
                  <View
                    style={[
                      styles.userFilterDropdown,
                      {
                        top: leagueFilterMenuLayout.top,
                        left: leagueFilterMenuLayout.left,
                        width: leagueFilterMenuLayout.width,
                      },
                    ]}
                  >
                    <View style={styles.userFilterDropdownHeader}>
                      <Text style={styles.userFilterDropdownTitle}>Filtri</Text>
                      <TouchableOpacity
                        style={[
                          styles.userFilterPresetChip,
                          !hasActiveLeagueFilters && styles.userFilterPresetChipActive,
                        ]}
                        onPress={clearLeagueFilters}
                        activeOpacity={0.75}
                      >
                        <Text
                          style={[
                            styles.userFilterPresetChipText,
                            !hasActiveLeagueFilters && styles.userFilterPresetChipTextActive,
                          ]}
                        >
                          Azzera
                        </Text>
                        {!hasActiveLeagueFilters ? (
                          <Ionicons name="checkmark" size={12} color="#4f46e5" />
                        ) : null}
                      </TouchableOpacity>
                    </View>

                    <ScrollView
                      style={styles.userFilterDropdownScroll}
                      contentContainerStyle={styles.userFilterDropdownScrollContent}
                      showsVerticalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      bounces={false}
                    >
                      <Text style={styles.userFilterSectionLabel}>Tipo</Text>
                      <TouchableOpacity
                        style={[
                          styles.userFilterDropdownItem,
                          leagueFilters.officialOnly && styles.userFilterDropdownItemOn,
                          styles.userFilterDropdownItemLast,
                        ]}
                        onPress={() =>
                          setLeagueFilters((prev) => ({
                            ...prev,
                            officialOnly: !prev.officialOnly,
                          }))
                        }
                        activeOpacity={0.8}
                      >
                        <View style={styles.userFilterDropdownItemLeft}>
                          <Ionicons
                            name="ribbon-outline"
                            size={15}
                            color={leagueFilters.officialOnly ? '#4f46e5' : '#94a3b8'}
                          />
                          <Text
                            style={[
                              styles.userFilterDropdownItemText,
                              leagueFilters.officialOnly && styles.userFilterDropdownItemTextOn,
                            ]}
                          >
                            Solo ufficiali
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.userFilterCheck,
                            leagueFilters.officialOnly && styles.userFilterCheckOn,
                          ]}
                        >
                          {leagueFilters.officialOnly ? (
                            <Ionicons name="checkmark" size={12} color="#fff" />
                          ) : null}
                        </View>
                      </TouchableOpacity>

                      <Text style={styles.userFilterSectionLabel}>Collegamento</Text>
                      {[
                        { key: 'on', label: 'Collegamento on', icon: 'link' },
                        { key: 'off', label: 'Collegamento off', icon: 'unlink-outline' },
                      ].map((opt, idx, arr) => {
                        const on = (leagueFilters.linking || []).includes(opt.key);
                        return (
                          <TouchableOpacity
                            key={opt.key}
                            style={[
                              styles.userFilterDropdownItem,
                              on && styles.userFilterDropdownItemOn,
                              idx === arr.length - 1 && styles.userFilterDropdownItemLast,
                            ]}
                            onPress={() => toggleLeagueLinkingFilter(opt.key)}
                            activeOpacity={0.8}
                          >
                            <View style={styles.userFilterDropdownItemLeft}>
                              <Ionicons
                                name={opt.icon}
                                size={15}
                                color={on ? '#4f46e5' : '#94a3b8'}
                              />
                              <Text
                                style={[
                                  styles.userFilterDropdownItemText,
                                  on && styles.userFilterDropdownItemTextOn,
                                ]}
                              >
                                {opt.label}
                              </Text>
                            </View>
                            <View style={[styles.userFilterCheck, on && styles.userFilterCheckOn]}>
                              {on ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
                            </View>
                          </TouchableOpacity>
                        );
                      })}

                      <Text style={styles.userFilterSectionLabel}>Visibilità</Text>
                      {[
                        { key: 'visible', label: 'Visibile', icon: 'eye-outline' },
                        { key: 'members_only', label: 'Solo iscritti', icon: 'eye-off-outline' },
                      ].map((opt, idx, arr) => {
                        const on = (leagueFilters.visibility || []).includes(opt.key);
                        return (
                          <TouchableOpacity
                            key={opt.key}
                            style={[
                              styles.userFilterDropdownItem,
                              on && styles.userFilterDropdownItemOn,
                              idx === arr.length - 1 && styles.userFilterDropdownItemLast,
                            ]}
                            onPress={() => toggleLeagueVisibilityFilter(opt.key)}
                            activeOpacity={0.8}
                          >
                            <View style={styles.userFilterDropdownItemLeft}>
                              <Ionicons
                                name={opt.icon}
                                size={15}
                                color={on ? '#4f46e5' : '#94a3b8'}
                              />
                              <Text
                                style={[
                                  styles.userFilterDropdownItemText,
                                  on && styles.userFilterDropdownItemTextOn,
                                ]}
                              >
                                {opt.label}
                              </Text>
                            </View>
                            <View style={[styles.userFilterCheck, on && styles.userFilterCheckOn]}>
                              {on ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
                            </View>
                          </TouchableOpacity>
                        );
                      })}

                      <Text style={styles.userFilterSectionLabel}>Accesso lega</Text>
                      {[
                        { key: 'public', label: 'Pubblica', icon: 'globe-outline' },
                        { key: 'private', label: 'Privata', icon: 'lock-closed-outline' },
                      ].map((opt, idx, arr) => {
                        const on = (leagueFilters.privacy || []).includes(opt.key);
                        return (
                          <TouchableOpacity
                            key={opt.key}
                            style={[
                              styles.userFilterDropdownItem,
                              on && styles.userFilterDropdownItemOn,
                              idx === arr.length - 1 && styles.userFilterDropdownItemLast,
                            ]}
                            onPress={() => toggleLeaguePrivacyFilter(opt.key)}
                            activeOpacity={0.8}
                          >
                            <View style={styles.userFilterDropdownItemLeft}>
                              <Ionicons
                                name={opt.icon}
                                size={15}
                                color={on ? '#4f46e5' : '#94a3b8'}
                              />
                              <Text
                                style={[
                                  styles.userFilterDropdownItemText,
                                  on && styles.userFilterDropdownItemTextOn,
                                ]}
                              >
                                {opt.label}
                              </Text>
                            </View>
                            <View style={[styles.userFilterCheck, on && styles.userFilterCheckOn]}>
                              {on ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
                            </View>
                          </TouchableOpacity>
                        );
                      })}

                      <Text style={styles.userFilterSectionLabel}>Numero membri</Text>
                      <View style={styles.leagueMembersFilterRow}>
                        <View style={styles.leagueMembersFilterField}>
                          <Text style={styles.leagueMembersFilterLabel}>Min</Text>
                          <TextInput
                            style={styles.leagueMembersFilterInput}
                            value={String(leagueFilters.membersMin || '')}
                            onChangeText={(t) => setLeagueMembersBound('membersMin', t)}
                            placeholder="—"
                            placeholderTextColor="#94a3b8"
                            keyboardType="number-pad"
                            maxLength={5}
                          />
                        </View>
                        <Text style={styles.leagueMembersFilterSep}>–</Text>
                        <View style={styles.leagueMembersFilterField}>
                          <Text style={styles.leagueMembersFilterLabel}>Max</Text>
                          <TextInput
                            style={styles.leagueMembersFilterInput}
                            value={String(leagueFilters.membersMax || '')}
                            onChangeText={(t) => setLeagueMembersBound('membersMax', t)}
                            placeholder="—"
                            placeholderTextColor="#94a3b8"
                            keyboardType="number-pad"
                            maxLength={5}
                          />
                        </View>
                      </View>
                    </ScrollView>
                  </View>
                ) : null}
              </View>
            </Modal>
          </>
        )}

        {activeTab === 'officials' && (
          <>
            {loadingOfficialGroups ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#667eea" />
              </View>
            ) : (
              <View style={styles.officialsTabBody}>
                <FlatList
                  data={officialGroups}
                  keyExtractor={(item) => item.id.toString()}
                  style={styles.officialsList}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.officialGroupItem}
                      onPress={async () => {
                        try {
                          const response = await superuserService.getOfficialGroupLeagues(item.id);
                          const leaguesInGroup = response.data.leagues || [];
                          setSelectedGroupForEdit({
                            ...item,
                            ...(response.data?.group || {}),
                            leagues: leaguesInGroup,
                          });
                          const nextDrafts = {};
                          leaguesInGroup.forEach((lg) => {
                            nextDrafts[String(lg.id)] = lg?.reference_year != null ? String(lg.reference_year) : '';
                          });
                          setReferenceYearDrafts(nextDrafts);
                          setShowGroupDetailModal(true);
                          leaguesInGroup.forEach((lg) => {
                            if (Number(lg.official_two_groups) === 1) {
                              void (async () => {
                                try {
                                  const gt = await superuserService.getOfficialLeagueGironiTeams(item.id, lg.id);
                                  setGironiTeamsByLeague((prev) => ({
                                    ...prev,
                                    [lg.id]: gt.data?.teams || [],
                                  }));
                                } catch (_) {
                                  /* ignore */
                                }
                              })();
                            }
                          });
                        } catch (error) {
                          console.error('Error loading group leagues:', error);
                          showToast('Impossibile caricare le leghe del gruppo');
                        }
                      }}
                    >
                      <View style={styles.officialGroupInfo}>
                        <Text style={styles.officialGroupName}>{item.name}</Text>
                        {item.description && (
                          <Text style={styles.officialGroupDescription}>{item.description}</Text>
                        )}
                        <Text style={styles.officialGroupStats}>
                          {item.league_count} leghe • Creato da {item.created_by_username} • {formatDateTime(item.created_at)}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color="#ccc" />
                    </TouchableOpacity>
                  )}
                  refreshControl={
                    <RefreshControl refreshing={refreshingOfficialGroups} onRefresh={() => {
                      setRefreshingOfficialGroups(true);
                      loadOfficialGroups();
                    }} />
                  }
                  ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                      <Ionicons name="ribbon-outline" size={48} color="#ccc" />
                      <Text style={styles.emptyText}>Nessun gruppo ufficiale trovato</Text>
                    </View>
                  }
                  contentContainerStyle={styles.listContent}
                />
                <TouchableOpacity
                  style={[styles.liveBonusRepairBtn, styles.clusterYearGapsBtn]}
                  onPress={openClusterYearGapsModal}
                  activeOpacity={0.85}
                >
                  <View style={[styles.liveBonusRepairBtnIcon, styles.clusterYearGapsBtnIcon]}>
                    <Ionicons name="git-commit-outline" size={20} color="#fff" />
                  </View>
                  <View style={styles.liveBonusRepairBtnTextWrap}>
                    <Text style={styles.liveBonusRepairBtnTitle}>Buchi anni cluster</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#bfdbfe" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.liveBonusRepairBtn, { marginBottom: 12 + Math.max(insets.bottom, 8) }]}
                  onPress={openLiveBonusDiscrepancyModal}
                  activeOpacity={0.85}
                >
                  <View style={styles.liveBonusRepairBtnIcon}>
                    <Ionicons name="build" size={20} color="#fff" />
                  </View>
                  <View style={styles.liveBonusRepairBtnTextWrap}>
                    <Text style={styles.liveBonusRepairBtnTitle}>Ripara discrepanze</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#c7d2fe" />
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {activeTab === 'clusters' && (
          <>
            <View style={styles.clusterSearchRow}>
              <View style={[styles.searchContainer, styles.clusterSearchContainer]}>
                <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Cerca per nome o cognome..."
                  placeholderTextColor="#999"
                  value={clusterTabSearchText}
                  onChangeText={setClusterTabSearchText}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {clusterTabSearchText.length > 0 && (
                  <TouchableOpacity onPress={() => setClusterTabSearchText('')} style={styles.clearButton}>
                    <Ionicons name="close-circle" size={20} color="#999" />
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                style={[styles.clusterFilterBtn, hasActiveClusterFilters && styles.clusterFilterBtnActive]}
                onPress={() => {
                  setOpenClusterFilterSection(null);
                  setShowClusterFilters(true);
                }}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="options-outline"
                  size={20}
                  color={hasActiveClusterFilters ? '#667eea' : '#94a3b8'}
                />
                <View style={[
                  styles.clusterFilterCountBadge,
                  hasActiveClusterFilters && styles.clusterFilterCountBadgeActive,
                ]}
                >
                  <Text
                    style={[
                      styles.clusterFilterCountBadgeText,
                      hasActiveClusterFilters && styles.clusterFilterCountBadgeTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {filteredApprovedClustersByPlayer.length}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
            {loadingApprovedClusters ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#667eea" />
              </View>
            ) : (
              <FlatList
                data={filteredApprovedClustersByPlayer}
                keyExtractor={(item) => (
                  item.is_single_player
                    ? `single-${item.group_id}-${item.player_id}`
                    : `cluster-${item.cluster_id}`
                )}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.playerClusterItem}
                    onPress={async () => {
                      setSelectedPlayerCluster(item);
                      setClusterBirthYearDraft(getSuggestedClusterBirthYear(item.leagues));
                      setClusterRoleDraft(getSuggestedClusterRole(item.leagues));
                      setShowPlayerClusterDetail(true);
                      if (item.leagues.length > 0) {
                        const groupId = item.leagues[0]?.group_id;
                        const existingLeagueIds = item.leagues.map((l) => l.id);
                        if (groupId) {
                          await checkAvailablePlayers(item.name, groupId, existingLeagueIds);
                        }
                      }
                    }}
                  >
                    <View style={styles.playerClusterInfo}>
                      <View style={styles.playerClusterNameRow}>
                        <Text style={styles.playerClusterName}>
                          {formatClusterListTitle(item.name, item.leagues)}
                        </Text>
                        {item.is_single_player ? (
                          <View style={styles.playerClusterSingleBadge}>
                            <Text style={styles.playerClusterSingleBadgeText}>Singolo</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.playerClusterLeaguesCount}>
                        {item.is_single_player
                          ? `1 edizione${item.group_name ? ` · ${item.group_name}` : ''}`
                          : `${item.players_count} ${item.players_count === 1 ? 'edizione' : 'edizioni'}${item.group_name ? ` · ${item.group_name}` : ''}`}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#999" />
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Ionicons name="people-outline" size={64} color="#ccc" />
                    <Text style={styles.emptyText}>
                      {clusterTabSearchText.trim() || hasActiveClusterFilters
                        ? 'Nessun risultato trovato'
                        : 'Nessun cluster approvato'}
                    </Text>
                    <Text style={styles.emptySubtext}>
                      {clusterTabSearchText.trim() || hasActiveClusterFilters
                        ? 'Prova con altri criteri di ricerca o filtri'
                        : 'I giocatori approvati come cluster appariranno qui'}
                    </Text>
                  </View>
                }
                refreshControl={
                  <RefreshControl
                    refreshing={refreshingApprovedClusters}
                    onRefresh={() => {
                      setRefreshingApprovedClusters(true);
                      loadApprovedClustersByPlayer({ includeSingles: clusterFilters.includeSingles });
                    }}
                  />
                }
                contentContainerStyle={styles.listContent}
              />
            )}
          </>
        )}

      <Modal
        visible={showClusterFilters}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowClusterFilters(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.clusterFiltersSheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
            <View style={styles.clusterFiltersHeader}>
              <Text style={styles.clusterFiltersTitle}>Filtri</Text>
              <TouchableOpacity
                onPress={() => setShowClusterFilters(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.clusterFiltersBody}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.clusterFilterHint}>
                Apri una sezione per scegliere il filtro da applicare.
              </Text>

              <View style={styles.clusterFilterAccordion}>
                <TouchableOpacity
                  style={styles.clusterFilterAccordionHeader}
                  onPress={() => toggleClusterFilterSection('group')}
                  activeOpacity={0.75}
                >
                  <View style={styles.clusterFilterAccordionHeaderMain}>
                    <Text style={styles.clusterFilterAccordionTitle}>Gruppo ufficiale</Text>
                    {clusterFilterSectionSummaries.group ? (
                      <Text style={styles.clusterFilterAccordionSummary} numberOfLines={1}>
                        {clusterFilterSectionSummaries.group}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons
                    name={openClusterFilterSection === 'group' ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color="#94a3b8"
                  />
                </TouchableOpacity>
                {openClusterFilterSection === 'group' ? (
                  <View style={styles.clusterFilterAccordionBody}>
                    <View style={styles.clusterFilterChips}>
                      {clusterFilterOptions.groups.length > 0 ? (
                        clusterFilterOptions.groups.map((group) => {
                          const active = clusterFilters.groupId === group.id;
                          return (
                            <TouchableOpacity
                              key={group.id}
                              style={[styles.clusterFilterChip, active && styles.clusterFilterChipActive]}
                              onPress={() => toggleClusterFilter('groupId', group.id)}
                            >
                              <Text
                                style={[styles.clusterFilterChipText, active && styles.clusterFilterChipTextActive]}
                                numberOfLines={1}
                              >
                                {group.name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })
                      ) : (
                        <Text style={styles.clusterFilterEmpty}>Nessun gruppo</Text>
                      )}
                    </View>
                  </View>
                ) : null}
              </View>

              <View style={styles.clusterFilterAccordion}>
                <TouchableOpacity
                  style={styles.clusterFilterAccordionHeader}
                  onPress={() => toggleClusterFilterSection('leagueYear')}
                  activeOpacity={0.75}
                >
                  <View style={styles.clusterFilterAccordionHeaderMain}>
                    <Text style={styles.clusterFilterAccordionTitle}>Anno lega</Text>
                    {clusterFilterSectionSummaries.leagueYear ? (
                      <Text style={styles.clusterFilterAccordionSummary}>
                        {clusterFilterSectionSummaries.leagueYear}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons
                    name={openClusterFilterSection === 'leagueYear' ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color="#94a3b8"
                  />
                </TouchableOpacity>
                {openClusterFilterSection === 'leagueYear' ? (
                  <View style={styles.clusterFilterAccordionBody}>
                    <View style={styles.clusterFilterChips}>
                      {clusterFilterOptions.leagueYears.length > 0 ? (
                        clusterFilterOptions.leagueYears.map((year) => {
                          const active = (clusterFilters.leagueYears || []).includes(year);
                          return (
                            <TouchableOpacity
                              key={`ly-${year}`}
                              style={[styles.clusterFilterChip, styles.clusterFilterChipCompact, active && styles.clusterFilterChipActive]}
                              onPress={() => toggleClusterFilterArray('leagueYears', year)}
                            >
                              <Text style={[styles.clusterFilterChipText, active && styles.clusterFilterChipTextActive]}>
                                {year}
                              </Text>
                            </TouchableOpacity>
                          );
                        })
                      ) : (
                        <Text style={styles.clusterFilterEmpty}>Nessun anno</Text>
                      )}
                    </View>
                  </View>
                ) : null}
              </View>

              <View style={styles.clusterFilterAccordion}>
                <TouchableOpacity
                  style={styles.clusterFilterAccordionHeader}
                  onPress={() => toggleClusterFilterSection('birthYear')}
                  activeOpacity={0.75}
                >
                  <View style={styles.clusterFilterAccordionHeaderMain}>
                    <Text style={styles.clusterFilterAccordionTitle}>Anno di nascita</Text>
                    {clusterFilterSectionSummaries.birthYear ? (
                      <Text style={styles.clusterFilterAccordionSummary}>
                        {clusterFilterSectionSummaries.birthYear}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons
                    name={openClusterFilterSection === 'birthYear' ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color="#94a3b8"
                  />
                </TouchableOpacity>
                {openClusterFilterSection === 'birthYear' ? (
                  <View style={styles.clusterFilterAccordionBody}>
                    <View style={styles.clusterFilterChips}>
                      <TouchableOpacity
                        style={[
                          styles.clusterFilterChip,
                          styles.clusterFilterChipCompact,
                          (clusterFilters.birthYears || []).includes(BIRTH_YEAR_FILTER_NONE) && styles.clusterFilterChipActive,
                        ]}
                        onPress={() => toggleClusterFilterArray('birthYears', BIRTH_YEAR_FILTER_NONE)}
                      >
                        <Text
                          style={[
                            styles.clusterFilterChipText,
                            (clusterFilters.birthYears || []).includes(BIRTH_YEAR_FILTER_NONE) && styles.clusterFilterChipTextActive,
                          ]}
                        >
                          Nessuno
                        </Text>
                      </TouchableOpacity>
                      {clusterFilterOptions.birthYears.map((year) => {
                        const active = (clusterFilters.birthYears || []).includes(year);
                        return (
                          <TouchableOpacity
                            key={`by-${year}`}
                            style={[styles.clusterFilterChip, styles.clusterFilterChipCompact, active && styles.clusterFilterChipActive]}
                            onPress={() => toggleClusterFilterArray('birthYears', year)}
                          >
                            <Text style={[styles.clusterFilterChipText, active && styles.clusterFilterChipTextActive]}>
                              {formatClusterBirthYearShort(year)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
              </View>

              <View style={styles.clusterFilterAccordion}>
                <TouchableOpacity
                  style={styles.clusterFilterAccordionHeader}
                  onPress={() => toggleClusterFilterSection('multiRole')}
                  activeOpacity={0.75}
                >
                  <View style={styles.clusterFilterAccordionHeaderMain}>
                    <Text style={styles.clusterFilterAccordionTitle}>Ruolo</Text>
                    {clusterFilterSectionSummaries.multiRole ? (
                      <Text style={styles.clusterFilterAccordionSummary}>
                        {clusterFilterSectionSummaries.multiRole}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons
                    name={openClusterFilterSection === 'multiRole' ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color="#94a3b8"
                  />
                </TouchableOpacity>
                {openClusterFilterSection === 'multiRole' ? (
                  <View style={styles.clusterFilterAccordionBody}>
                    <View style={styles.clusterFilterChips}>
                      <TouchableOpacity
                        style={[
                          styles.clusterFilterChip,
                          clusterFilters.multiRoleOnly && styles.clusterFilterChipActive,
                        ]}
                        onPress={() => setClusterFilters((prev) => ({
                          ...prev,
                          multiRoleOnly: !prev.multiRoleOnly,
                        }))}
                      >
                        <Text
                          style={[
                            styles.clusterFilterChipText,
                            clusterFilters.multiRoleOnly && styles.clusterFilterChipTextActive,
                          ]}
                        >
                          Più di un ruolo
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </View>

              <View style={styles.clusterFilterAccordion}>
                <TouchableOpacity
                  style={styles.clusterFilterAccordionHeader}
                  onPress={() => toggleClusterFilterSection('singles')}
                  activeOpacity={0.75}
                >
                  <View style={styles.clusterFilterAccordionHeaderMain}>
                    <Text style={styles.clusterFilterAccordionTitle}>Giocatori singoli</Text>
                    {clusterFilterSectionSummaries.singles ? (
                      <Text style={styles.clusterFilterAccordionSummary}>
                        {clusterFilterSectionSummaries.singles}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons
                    name={openClusterFilterSection === 'singles' ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color="#94a3b8"
                  />
                </TouchableOpacity>
                {openClusterFilterSection === 'singles' ? (
                  <View style={styles.clusterFilterAccordionBody}>
                    <Text style={styles.clusterFilterHint}>
                      Attiva per includere anche i giocatori non in un cluster.
                    </Text>
                    <View style={styles.clusterFilterChips}>
                      <TouchableOpacity
                        style={[
                          styles.clusterFilterChip,
                          clusterFilters.includeSingles && styles.clusterFilterChipActive,
                        ]}
                        onPress={() => setClusterFilters((prev) => ({
                          ...prev,
                          includeSingles: !prev.includeSingles,
                        }))}
                      >
                        <Text
                          style={[
                            styles.clusterFilterChipText,
                            clusterFilters.includeSingles && styles.clusterFilterChipTextActive,
                          ]}
                        >
                          Mostra giocatori singoli
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </View>
            </ScrollView>
            {hasActiveClusterFilters ? (
              <View style={styles.clusterFiltersFooter}>
                <TouchableOpacity style={styles.clusterFiltersReset} onPress={clearClusterFilters}>
                  <Text style={styles.clusterFiltersResetText}>Azzera filtri</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

        {activeTab === 'appSettings' && (
          <ScrollView
            style={styles.appSettingsRoot}
            contentContainerStyle={styles.appSettingsScroll}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.appSettingsTitle}>Impostazioni app</Text>

            <View style={styles.appSettingsCard}>
              <TouchableOpacity
                style={styles.collapsibleHeader}
                onPress={() => setLoadingSectionOpen((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.appSettingsSectionTitle}>Schermata di caricamento (9:16)</Text>
                <Ionicons
                  name={loadingSectionOpen ? 'chevron-up' : 'chevron-down'}
                  size={22}
                  color="#666"
                />
              </TouchableOpacity>

              {loadingSectionOpen && (
                <>
                  <TouchableOpacity
                    style={[styles.appSettingsPrimaryBtn, pickingAppLoading && styles.appSettingsBtnDisabled]}
                    onPress={handlePickAppLoadingMedia}
                    disabled={pickingAppLoading}
                  >
                    {pickingAppLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.appSettingsPrimaryBtnText}>Scegli file (GIF / immagine / video)</Text>
                    )}
                  </TouchableOpacity>

                  {!activeAppLoadingPreview?.uri ? (
                    <Text style={[styles.appSettingsMuted, { marginTop: 14 }]}>
                      {`Nessun file: in caricamento reale vedrai solo lo spinner.`}
                    </Text>
                  ) : (
                    <>
                      <Text style={styles.appSettingsPreviewTitle}>Anteprima sul telefono</Text>
                      <View style={styles.appLoadingPreviewStage}>
                        {activeAppLoadingPreview.type === 'video' ? (
                          <LoopingVideoView
                            uri={activeAppLoadingPreview.uri}
                            style={StyleSheet.absoluteFillObject}
                            contentFit="cover"
                          />
                        ) : (
                          <Image
                            source={{ uri: activeAppLoadingPreview.uri }}
                            style={StyleSheet.absoluteFillObject}
                            resizeMode="cover"
                          />
                        )}
                        {pickingAppLoading && appLoadingPickStaging ? (
                          <View style={styles.appLoadingPreviewUploadOverlay}>
                            <ActivityIndicator color="#fff" size="large" />
                            <Text style={styles.appLoadingPreviewUploadText}>Invio al server…</Text>
                          </View>
                        ) : null}
                      </View>
                      {activeAppLoadingPreview.name ? (
                        <Text style={styles.appSettingsFileName} numberOfLines={2}>
                          {activeAppLoadingPreview.name}
                        </Text>
                      ) : null}
                    </>
                  )}

                  <TouchableOpacity
                    style={[styles.appSettingsOutlineBtn, { marginTop: 4 }]}
                    onPress={() => setAppLoadingSimulateOpen(true)}
                    disabled={pickingAppLoading}
                  >
                    <Ionicons name="phone-portrait-outline" size={20} color="#667eea" />
                    <Text style={styles.appSettingsOutlineBtnText}>Anteprima a tutto schermo (loop)</Text>
                  </TouchableOpacity>

                  {activeAppLoadingPreview?.uri ? (
                    <TouchableOpacity
                      style={styles.appSettingsSecondaryBtn}
                      onPress={handleClearAppLoadingMedia}
                      disabled={pickingAppLoading}
                    >
                      <Text style={styles.appSettingsSecondaryBtnText}>Rimuovi personalizzazione</Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              )}
            </View>

            <View style={[styles.appSettingsCard, { marginTop: 16 }]}>
              <TouchableOpacity
                style={styles.collapsibleHeader}
                onPress={() => setLogoSectionOpen((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.appSettingsSectionTitle}>Logo pagina di login</Text>
                <Ionicons
                  name={logoSectionOpen ? 'chevron-up' : 'chevron-down'}
                  size={22}
                  color="#666"
                />
              </TouchableOpacity>

              {logoSectionOpen && (
                <>

                  <TouchableOpacity
                    style={[styles.appSettingsPrimaryBtn, pickingLoginLogo && styles.appSettingsBtnDisabled]}
                    onPress={handlePickLoginLogo}
                    disabled={pickingLoginLogo}
                  >
                    {pickingLoginLogo ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.appSettingsPrimaryBtnText}>Scegli immagine</Text>
                    )}
                  </TouchableOpacity>

                  {loginLogoPreview?.uri ? (
                    <>
                      <Text style={styles.appSettingsPreviewTitle}>Anteprima</Text>
                      <View style={styles.loginLogoPreviewBox}>
                        <Image
                          source={{ uri: loginLogoPreview.uri }}
                          style={styles.loginLogoPreviewImg}
                          resizeMode="contain"
                        />
                      </View>
                      <TouchableOpacity
                        style={styles.appSettingsSecondaryBtn}
                        onPress={handleClearLoginLogo}
                        disabled={pickingLoginLogo}
                      >
                        <Text style={styles.appSettingsSecondaryBtnText}>Rimuovi logo (torna alla scritta)</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <Text style={[styles.appSettingsMuted, { marginTop: 14 }]}>
                      Nessun logo caricato: verrà visualizzata la scritta predefinita.
                    </Text>
                  )}
                </>
              )}
            </View>

            <View style={[styles.appSettingsCard, { marginTop: 16 }]}>
              <TouchableOpacity
                style={styles.collapsibleHeader}
                onPress={() => setLoginBackgroundSectionOpen((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.appSettingsSectionTitle}>Sfondo pagina di login</Text>
                <Ionicons
                  name={loginBackgroundSectionOpen ? 'chevron-up' : 'chevron-down'}
                  size={22}
                  color="#666"
                />
              </TouchableOpacity>

              {loginBackgroundSectionOpen && (
                <>

                  <TouchableOpacity
                    style={[styles.appSettingsPrimaryBtn, pickingLoginBackground && styles.appSettingsBtnDisabled]}
                    onPress={handlePickLoginBackground}
                    disabled={pickingLoginBackground}
                  >
                    {pickingLoginBackground ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.appSettingsPrimaryBtnText}>Scegli immagine</Text>
                    )}
                  </TouchableOpacity>

                  {loginBackgroundPreview?.uri ? (
                    <>
                      <Text style={styles.appSettingsPreviewTitle}>Anteprima</Text>
                      <View style={styles.appLoadingPreviewStage}>
                        <Image
                          source={{ uri: loginBackgroundPreview.uri }}
                          style={StyleSheet.absoluteFillObject}
                          resizeMode="cover"
                        />
                      </View>
                      <TouchableOpacity
                        style={styles.appSettingsSecondaryBtn}
                        onPress={handleClearLoginBackground}
                        disabled={pickingLoginBackground}
                      >
                        <Text style={styles.appSettingsSecondaryBtnText}>
                          Rimuovi sfondo (torna al grigio predefinito)
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <Text style={[styles.appSettingsMuted, { marginTop: 14 }]}>
                      Di default viene usato lo sfondo grigio.
                    </Text>
                  )}
                </>
              )}
            </View>

            <View style={[styles.appSettingsCard, { marginTop: 16 }]}>
              <TouchableOpacity
                style={styles.collapsibleHeader}
                onPress={() => setMatchBackgroundSectionOpen((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.appSettingsSectionTitle}>Sfondo partita</Text>
                <Ionicons
                  name={matchBackgroundSectionOpen ? 'chevron-up' : 'chevron-down'}
                  size={22}
                  color="#666"
                />
              </TouchableOpacity>

              {matchBackgroundSectionOpen && (
                <>
                  <Text style={[styles.appSettingsMuted, { marginTop: 4, marginBottom: 10 }]}>
                    Immagine landscape (~2:1) per la zona alta della partita ufficiale (loghi,
                    risultato, marcatori). Lo sfondo in-app è già scurito per il contrasto del testo.
                  </Text>

                  <TouchableOpacity
                    style={[styles.appSettingsPrimaryBtn, pickingMatchBackground && styles.appSettingsBtnDisabled]}
                    onPress={handlePickMatchBackground}
                    disabled={pickingMatchBackground}
                  >
                    {pickingMatchBackground ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.appSettingsPrimaryBtnText}>Scegli immagine</Text>
                    )}
                  </TouchableOpacity>

                  {matchBackgroundPreview?.uri ? (
                    <>
                      <Text style={styles.appSettingsPreviewTitle}>Anteprima hero</Text>
                      <View style={styles.matchBackgroundPreviewStage}>
                        <Image
                          source={{ uri: matchBackgroundPreview.uri }}
                          style={StyleSheet.absoluteFillObject}
                          resizeMode="cover"
                        />
                        <View style={styles.matchBackgroundPreviewScrim} />
                        <View style={styles.matchBackgroundPreviewMock}>
                          <View style={styles.matchBackgroundPreviewTeam} />
                          <Text style={styles.matchBackgroundPreviewScore}>1 – 0</Text>
                          <View style={styles.matchBackgroundPreviewTeam} />
                        </View>
                      </View>
                      <TouchableOpacity
                        style={styles.appSettingsSecondaryBtn}
                        onPress={handleClearMatchBackground}
                        disabled={pickingMatchBackground}
                      >
                        <Text style={styles.appSettingsSecondaryBtnText}>
                          Rimuovi custom (torna allo sfondo in-app)
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <Text style={[styles.appSettingsMuted, { marginTop: 14 }]}>
                      Anteprima non disponibile. Verrà usato lo sfondo predefinito in-app.
                    </Text>
                  )}
                </>
              )}
            </View>
          </ScrollView>
        )}
      </View>

      {/* Modal per selezionare/creare gruppo ufficiale */}
      <Modal
        visible={showOfficialGroupModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowOfficialGroupModal(false);
          setSelectedLeagueForOfficial(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Gestisci Lega Ufficiale</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowOfficialGroupModal(false);
                  setSelectedLeagueForOfficial(null);
                }}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            {selectedLeagueForOfficial && (
              <Text style={styles.modalSubtitle}>
                Seleziona il gruppo per "{selectedLeagueForOfficial.name}"
              </Text>
            )}
            
            <ScrollView style={styles.modalScrollView}>
              {officialGroups.map((group) => (
                <TouchableOpacity
                  key={group.id}
                  style={styles.groupOptionItem}
                  onPress={() => handleSelectGroupForLeague(group.id)}
                >
                  <View style={styles.groupOptionInfo}>
                    <Text style={styles.groupOptionName}>{group.name}</Text>
                    {group.description && (
                      <Text style={styles.groupOptionDescription}>{group.description}</Text>
                    )}
                    <Text style={styles.groupOptionStats}>
                      {group.league_count} leghe
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#667eea" />
                </TouchableOpacity>
              ))}
              
              <TouchableOpacity
                style={styles.createGroupButton}
                onPress={() => setShowCreateGroupModal(true)}
              >
                <Ionicons name="add-circle" size={24} color="#667eea" />
                <Text style={styles.createGroupButtonText}>Crea Nuovo Gruppo</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal per creare nuovo gruppo */}
      <Modal
        visible={showCreateGroupModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowCreateGroupModal(false);
          setNewGroupName('');
          setNewGroupDescription('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Crea Nuovo Gruppo</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowCreateGroupModal(false);
                  setNewGroupName('');
                  setNewGroupDescription('');
                }}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalScrollView}>
              <View style={styles.modalInputContainer}>
                <Text style={styles.modalLabel}>Nome Gruppo *</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Es: Coppa dei cantoni"
                  value={newGroupName}
                  onChangeText={setNewGroupName}
                />
              </View>
              
              <View style={styles.modalInputContainer}>
                <Text style={styles.modalLabel}>Descrizione</Text>
                <TextInput
                  style={[styles.modalInput, styles.modalTextArea]}
                  placeholder="Descrizione opzionale del gruppo"
                  value={newGroupDescription}
                  onChangeText={setNewGroupDescription}
                  multiline
                  numberOfLines={3}
                />
              </View>
              
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={handleCreateOfficialGroup}
              >
                <Text style={styles.modalButtonText}>Crea Gruppo</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal per dettagli gruppo ufficiale */}
      <Modal
        visible={showGroupDetailModal}
        animationType="slide"
        transparent={true}
        onRequestClose={closeGroupDetailModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={[styles.modalHeader, styles.groupDetailModalHeader]}>
              <View style={styles.groupDetailHeaderActions}>
                <TouchableOpacity
                  style={styles.groupDetailHeaderIconBtn}
                  onPress={() => void handleOpenGroupClusters()}
                  accessibilityLabel="Gestisci cluster giocatori"
                >
                  <Ionicons name="people-outline" size={22} color="#667eea" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.groupDetailHeaderIconBtn}
                  onPress={() => void handleOpenNeverPlayedPlayers()}
                  accessibilityLabel="Giocatori senza partite"
                >
                  <Ionicons name="person-remove-outline" size={22} color="#667eea" />
                </TouchableOpacity>
                {selectedGroupForEdit ? (
                  <TouchableOpacity
                    style={[
                      styles.groupDetailHeaderIconBtn,
                      Number(selectedGroupForEdit.show_in_main_menu) === 1 &&
                        styles.groupDetailHeaderIconBtnActive,
                    ]}
                    onPress={() => handleToggleMainMenuGroup(selectedGroupForEdit)}
                    disabled={togglingMenuGroupId === selectedGroupForEdit.id}
                    accessibilityRole="switch"
                    accessibilityState={{
                      checked: Number(selectedGroupForEdit.show_in_main_menu) === 1,
                    }}
                    accessibilityLabel={
                      Number(selectedGroupForEdit.show_in_main_menu) === 1
                        ? 'Rimuovi dal pulsante del menu principale'
                        : 'Mostra nel pulsante del menu principale'
                    }
                  >
                    {togglingMenuGroupId === selectedGroupForEdit.id ? (
                      <ActivityIndicator size="small" color="#667eea" />
                    ) : (
                      <MaterialCommunityIcons
                        name="dock-bottom"
                        size={22}
                        color={
                          Number(selectedGroupForEdit.show_in_main_menu) === 1 ? '#667eea' : '#94a3b8'
                        }
                      />
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>
              <Text style={styles.groupDetailModalHeaderTitle}>Gruppo ufficiale</Text>
              <TouchableOpacity style={styles.groupDetailHeaderIconBtn} onPress={closeGroupDetailModal}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>
            
            {selectedGroupForEdit && (
              <>
                <View style={styles.groupProfileHero}>
                  <View style={styles.groupLogoHeroContainer}>
                    {uploadingGroupLogo ? (
                      <View style={styles.groupLogoHeroCircle}>
                        <ActivityIndicator size="large" color="#667eea" />
                      </View>
                    ) : selectedGroupForEdit.logo_path ? (
                      <View style={styles.groupLogoHeroWrapper}>
                        <Image
                          source={{ uri: publicAssetUrl(selectedGroupForEdit.logo_path) }}
                          style={styles.groupLogoHeroImage}
                        />
                        <TouchableOpacity
                          style={styles.groupLogoEditBadge}
                          onPress={handleOfficialGroupLogoEditPress}
                          disabled={uploadingGroupLogo}
                        >
                          <Ionicons name="create-outline" size={18} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.groupLogoHeroWrapper}>
                        <View style={styles.groupLogoHeroCircle}>
                          <Ionicons name="trophy-outline" size={48} color="#94a3b8" />
                        </View>
                        <TouchableOpacity
                          style={styles.groupLogoEditBadge}
                          onPress={handleOfficialGroupLogoEditPress}
                          disabled={uploadingGroupLogo}
                        >
                          <Ionicons name="create-outline" size={18} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                  <Text style={styles.groupProfileName}>{selectedGroupForEdit.name || 'Gruppo Ufficiale'}</Text>
                  {selectedGroupForEdit.description ? (
                    <Text style={styles.groupProfileDescription}>{selectedGroupForEdit.description}</Text>
                  ) : null}
                </View>

              <ScrollView style={styles.modalScrollView} contentContainerStyle={{ paddingBottom: 20 }}>
                <Text style={styles.groupDetailSectionTitle}>
                  Leghe del Gruppo ({selectedGroupForEdit.leagues?.length || 0})
                </Text>
                
                {selectedGroupForEdit.leagues && selectedGroupForEdit.leagues.length > 0 ? (
                  selectedGroupForEdit.leagues.map((league) => {
                    const isExpanded = !!expandedGroupLeagueIds[league.id];
                    return (
                    <View key={league.id} style={styles.groupLeagueItem}>
                      <TouchableOpacity
                        style={styles.groupLeagueHeader}
                        onPress={() => toggleGroupLeagueExpanded(league.id)}
                        activeOpacity={0.75}
                      >
                        <View style={styles.groupLeagueHeaderText}>
                          <Text style={styles.groupLeagueName} numberOfLines={2}>
                            {league.name}
                          </Text>
                          <Text style={styles.groupLeagueSummary}>
                            Anno {getLeagueDisplayYear(league)} • Creato il {formatCreationDate(league.created_at)}
                          </Text>
                        </View>
                        <Ionicons
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={18}
                          color="#94a3b8"
                        />
                      </TouchableOpacity>
                      {isExpanded ? (
                      <View style={styles.groupLeagueExpandedBody}>
                      <View style={styles.groupLeagueReferenceYearRow}>
                        <TouchableOpacity
                          style={styles.groupLeagueReferenceYearPickerBtn}
                          onPress={() => setYearPickerLeague(league)}
                        >
                          <Ionicons name="calendar-outline" size={16} color="#667eea" />
                          <Text style={styles.groupLeagueReferenceYearPickerBtnText}>
                            {String(referenceYearDrafts[String(league.id)] ?? '').trim() || 'Seleziona anno'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.groupLeagueReferenceYearClearBtn}
                          onPress={() => setReferenceYearDrafts((prev) => ({ ...prev, [String(league.id)]: '' }))}
                        >
                          <Ionicons name="close-circle-outline" size={18} color="#999" />
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity
                        onPress={() =>
                          handleToggleOfficialSquadPublic(selectedGroupForEdit.id, league)
                        }
                        activeOpacity={0.7}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          marginTop: 10,
                          paddingVertical: 8,
                          paddingHorizontal: 10,
                          borderRadius: 8,
                          backgroundColor:
                            Number(league.is_official_squad_public || 0) === 1 ? '#e8f5e9' : '#fff8e1',
                          borderWidth: 1,
                          borderColor:
                            Number(league.is_official_squad_public || 0) === 1 ? '#a5d6a7' : '#ffe082',
                          alignSelf: 'stretch',
                        }}
                      >
                        <Ionicons
                          name={
                            Number(league.is_official_squad_public || 0) === 1
                              ? 'people'
                              : 'people-outline'
                          }
                          size={18}
                          color={
                            Number(league.is_official_squad_public || 0) === 1 ? '#2e7d32' : '#f57f17'
                          }
                        />
                        <Text
                          style={{
                            flex: 1,
                            fontSize: 12,
                            fontWeight: '600',
                            color:
                              Number(league.is_official_squad_public || 0) === 1 ? '#2e7d32' : '#e65100',
                            marginLeft: 8,
                          }}
                        >
                          {Number(league.is_official_squad_public || 0) === 1
                            ? 'Pubblicata: rosa, classifica girone e stats visibili negli anni della squadra ufficiale'
                            : 'Bozza: anno non compare nei selettori (anti-spoiler)'}
                        </Text>
                        <Ionicons
                          name={
                            Number(league.is_official_squad_public || 0) === 1
                              ? 'toggle'
                              : 'toggle-outline'
                          }
                          size={22}
                          color={
                            Number(league.is_official_squad_public || 0) === 1 ? '#2e7d32' : '#bbb'
                          }
                        />
                      </TouchableOpacity>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginTop: 12,
                          paddingVertical: 6,
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569', flex: 1, paddingRight: 8 }}>
                          Due gironi (in Gestione partite: tipologia Gironi solo stesso girone)
                        </Text>
                        <Switch
                          value={Number(league.official_two_groups || 0) === 1}
                          onValueChange={(v) => handleToggleTwoOfficialGroups(selectedGroupForEdit.id, league, v)}
                          trackColor={{ false: '#ccc', true: '#a5b4fc' }}
                          thumbColor={Number(league.official_two_groups || 0) === 1 ? '#667eea' : '#f4f3f4'}
                        />
                      </View>
                      {Number(league.official_two_groups || 0) === 1 ? (
                        <View style={{ marginTop: 8, paddingBottom: 4 }}>
                          <Text style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
                            Assegna ogni squadra a G. A o G. B.
                          </Text>
                          {(gironiTeamsByLeague[league.id] || []).length === 0 ? (
                            <Text style={{ fontSize: 12, color: '#94a3b8' }}>Caricamento squadre…</Text>
                          ) : (
                            (gironiTeamsByLeague[league.id] || []).map((tm) => (
                              <View
                                key={`gir-${league.id}-${tm.id}`}
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  marginBottom: 8,
                                }}
                              >
                                <Text style={{ flex: 1, fontSize: 13, color: '#1e293b', marginRight: 8 }} numberOfLines={1}>
                                  {tm.name}
                                </Text>
                                <View style={{ flexDirection: 'row' }}>
                                  <TouchableOpacity
                                    onPress={() =>
                                      handleAssignTeamGirone(selectedGroupForEdit.id, league.id, tm.id, 1)
                                    }
                                    style={{
                                      paddingHorizontal: 10,
                                      paddingVertical: 6,
                                      borderRadius: 8,
                                      borderWidth: 1,
                                      borderColor: Number(tm.girone_index) === 1 ? '#4f46e5' : '#e2e8f0',
                                      backgroundColor: Number(tm.girone_index) === 1 ? '#eef2ff' : '#fff',
                                      marginRight: 6,
                                    }}
                                  >
                                    <Text
                                      style={{
                                        fontSize: 12,
                                        fontWeight: '700',
                                        color: Number(tm.girone_index) === 1 ? '#4f46e5' : '#64748b',
                                      }}
                                    >
                                      G. A
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    onPress={() =>
                                      handleAssignTeamGirone(selectedGroupForEdit.id, league.id, tm.id, 2)
                                    }
                                    style={{
                                      paddingHorizontal: 10,
                                      paddingVertical: 6,
                                      borderRadius: 8,
                                      borderWidth: 1,
                                      borderColor: Number(tm.girone_index) === 2 ? '#4f46e5' : '#e2e8f0',
                                      backgroundColor: Number(tm.girone_index) === 2 ? '#eef2ff' : '#fff',
                                    }}
                                  >
                                    <Text
                                      style={{
                                        fontSize: 12,
                                        fontWeight: '700',
                                        color: Number(tm.girone_index) === 2 ? '#4f46e5' : '#64748b',
                                      }}
                                    >
                                      G. B
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            ))
                          )}
                        </View>
                      ) : null}
                      </View>
                      ) : null}
                    </View>
                    );
                  })
                ) : (
                  <Text style={styles.groupDetailEmpty}>
                    Nessuna lega in questo gruppo
                  </Text>
                )}
                
                <View style={styles.groupDetailActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonDanger]}
                    onPress={() => {
                      setConfirmModal({
                        title: 'Elimina Gruppo',
                        message: `Sei sicuro di voler eliminare il gruppo "${selectedGroupForEdit.name}"? Le leghe perderanno lo stato ufficiale.`,
                        confirmText: 'Elimina',
                        destructive: true,
                        onConfirm: async () => {
                          setConfirmModal(null);
                          try {
                            await superuserService.deleteOfficialGroup(selectedGroupForEdit.id);
                            closeGroupDetailModal();
                            await loadOfficialGroups();
                            await loadLeagues({ silent: true });
                            showToast('Gruppo eliminato con successo', 'success');
                          } catch (error) {
                            console.error('Error deleting group:', error);
                            showToast(error.response?.data?.message || 'Errore durante l\'eliminazione');
                          }
                        },
                      });
                    }}
                  >
                    <Ionicons name="trash" size={18} color="#fff" />
                    <Text style={styles.modalButtonText}>Elimina Gruppo</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!yearPickerLeague}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setYearPickerLeague(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.yearPickerModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Seleziona Anno</Text>
              <TouchableOpacity onPress={() => setYearPickerLeague(null)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            <Text style={styles.yearPickerModalSubtitle}>
              {yearPickerLeague?.name || 'Lega ufficiale'}
            </Text>
            <ScrollView style={styles.yearPickerScroll} contentContainerStyle={styles.yearPickerGrid}>
              {selectableReferenceYears.map((year) => {
                const selected = String(referenceYearDrafts[String(yearPickerLeague?.id)] ?? '') === String(year);
                return (
                  <TouchableOpacity
                    key={year}
                    style={[styles.yearChip, selected ? styles.yearChipActive : null]}
                    onPress={() =>
                      setReferenceYearDrafts((prev) => ({ ...prev, [String(yearPickerLeague?.id)]: String(year) }))
                    }
                  >
                    <Text style={[styles.yearChipText, selected ? styles.yearChipTextActive : null]}>{year}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={styles.yearPickerActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSecondary, styles.yearPickerActionButton]}
                onPress={() => {
                  if (!yearPickerLeague) return;
                  setReferenceYearDrafts((prev) => ({ ...prev, [String(yearPickerLeague.id)]: '' }));
                  setYearPickerLeague(null);
                }}
              >
                <Text style={[styles.modalButtonText, styles.yearPickerActionButtonText, { color: '#667eea' }]}>Nessun anno</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary, styles.yearPickerActionButton]}
                disabled={!!savingReferenceYearByLeague[yearPickerLeague?.id]}
                onPress={async () => {
                  if (!yearPickerLeague || !selectedGroupForEdit?.id) return;
                  const leagueId = yearPickerLeague.id;
                  const groupId = selectedGroupForEdit.id;
                  const draft = String(referenceYearDrafts[String(leagueId)] ?? '').trim();
                  const ok = await handleSaveLeagueReferenceYear(groupId, leagueId, draft);
                  if (ok !== false) setYearPickerLeague(null);
                }}
              >
                {savingReferenceYearByLeague[yearPickerLeague?.id] ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalButtonText, styles.yearPickerActionButtonText]}>Salva anno</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal per gestire cluster giocatori */}
      <Modal
        visible={showClusterModal && selectedGroupForEdit !== null}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowClusterModal(false);
          setClusterFilterStatus(null);
          setClusterModalSearchText('');
          setSuggestionEditModal(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Gestisci Cluster</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowClusterModal(false);
                  setClusterFilterStatus(null);
                  setClusterModalSearchText('');
                  setSuggestionEditModal(null);
                }}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            {selectedGroupForEdit && (
              <View style={{ flex: 1 }}>
                {/* Filtri status */}
                <View style={styles.clusterFilters}>
                  <TouchableOpacity
                    style={[styles.clusterFilterButton, clusterFilterStatus === null && styles.clusterFilterButtonActive]}
                    onPress={() => {
                      setClusterFilterStatus(null);
                      loadClusterSuggestions(Number(selectedGroupForEdit.id));
                    }}
                  >
                    <Text style={[styles.clusterFilterText, clusterFilterStatus === null && styles.clusterFilterTextActive]}>Suggeriti</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.clusterFilterButton, clusterFilterStatus === 'approved' && styles.clusterFilterButtonActive]}
                    onPress={() => {
                      setClusterFilterStatus('approved');
                      loadClusters(Number(selectedGroupForEdit.id), 'approved');
                    }}
                  >
                    <Text style={[styles.clusterFilterText, clusterFilterStatus === 'approved' && styles.clusterFilterTextActive]}>Approvati</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.clusterModalSearchContainer}>
                  <Ionicons name="search" size={18} color="#999" style={styles.searchIcon} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Cerca per nome o cognome..."
                    placeholderTextColor="#999"
                    value={clusterModalSearchText}
                    onChangeText={setClusterModalSearchText}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {clusterModalSearchText.length > 0 && (
                    <TouchableOpacity onPress={() => setClusterModalSearchText('')} style={styles.clearButton}>
                      <Ionicons name="close-circle" size={18} color="#999" />
                    </TouchableOpacity>
                  )}
                </View>
                
                <ScrollView 
                  style={styles.modalScrollView}
                >
                  {/* Suggerimenti automatici */}
                  {clusterFilterStatus === null && (
                    <>
                      <Text style={styles.clusterSectionTitle}>
                        Suggerimenti{clusterModalSearchText.trim() ? ` (${filteredSuggestions.length})` : ''}
                      </Text>
                      {loadingSuggestions ? (
                        <ActivityIndicator size="small" color="#667eea" style={{ padding: 20 }} />
                      ) : filteredSuggestions.length > 0 ? (
                        filteredSuggestions.map((suggestion, index) => (
                          <View
                            key={`${suggestion.name}-${suggestion.birth_year || 'no-year'}-${index}`}
                            style={styles.suggestionRow}
                          >
                            <View style={styles.suggestionInfo}>
                              <Text style={styles.suggestionPlayerName}>{suggestion.name}</Text>
                              <Text style={styles.suggestionLeagueLabel}>
                                {(suggestion.existing_leagues || []).length > 0
                                  ? (suggestion.existing_leagues || []).map((l) => suggestion.role_changed ? `${l.league_name} (${l.role})` : l.league_name).join(', ')
                                  : 'new'}
                                {'  →  '}
                                {(suggestion.new_leagues || []).map((l) => suggestion.role_changed ? `${l.league_name} (${l.role})` : l.league_name).join(', ')}
                              </Text>
                              {suggestion.role_changed && (
                                <Text style={styles.suggestionRoleWarning}>⚠ Ruolo diverso tra le leghe</Text>
                              )}
                              {suggestion.birth_year ? (
                                <Text style={styles.suggestionBirthYearRef}>
                                  Anno di nascita: {suggestion.birth_year}
                                </Text>
                              ) : null}
                              {(suggestion.missing_birth_year_in_cluster || []).length > 0 ? (
                                <Text style={styles.suggestionBirthYearWarning}>
                                  ⚠ In cluster senza anno: {(suggestion.missing_birth_year_in_cluster || []).map((l) => l.league_name).join(', ')}
                                </Text>
                              ) : null}
                              {(suggestion.missing_birth_year_new || []).length > 0 ? (
                                <Text style={styles.suggestionBirthYearWarning}>
                                  ⚠ Da associare senza anno: {(suggestion.missing_birth_year_new || []).map((l) => l.league_name).join(', ')}
                                </Text>
                              ) : null}
                            </View>
                            <View style={styles.suggestionActionsCol}>
                              <View style={styles.suggestionActionsRow}>
                                <TouchableOpacity
                                  style={styles.suggestionApprove}
                                  onPress={() => handleApproveSuggestion(suggestion, selectedGroupForEdit.id)}
                                >
                                  <Ionicons name="checkmark" size={20} color="#4CAF50" />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.suggestionDismiss}
                                  onPress={() => handleDismissSuggestion(suggestion, selectedGroupForEdit.id)}
                                >
                                  <Ionicons name="close" size={20} color="#F44336" />
                                </TouchableOpacity>
                              </View>
                              <View style={styles.suggestionActionsRow}>
                                {suggestion.cluster_id ? (
                                  <TouchableOpacity
                                    style={styles.suggestionNew}
                                    onPress={() => openSuggestionEditModal(suggestion, 'new')}
                                    accessibilityLabel="Crea nuovo cluster"
                                  >
                                    <Text style={styles.suggestionNewText}>NEW</Text>
                                  </TouchableOpacity>
                                ) : null}
                                <TouchableOpacity
                                  style={styles.suggestionEdit}
                                  onPress={() => openSuggestionEditModal(suggestion, 'extend')}
                                >
                                  <Ionicons name="create-outline" size={18} color="#667eea" />
                                </TouchableOpacity>
                              </View>
                            </View>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.clusterEmptyText}>
                          {clusterModalSearchText.trim()
                            ? 'Nessun suggerimento per questa ricerca'
                            : 'Nessun suggerimento disponibile'}
                        </Text>
                      )}
                      
                      <TouchableOpacity
                        style={[styles.modalButton, styles.modalButtonPrimary, { marginTop: 16 }]}
                        onPress={() => {
                          setShowCreateClusterModal(true);
                          searchPlayers(selectedGroupForEdit.id, '');
                        }}
                      >
                        <Ionicons name="add" size={18} color="#fff" />
                        <Text style={styles.modalButtonText}>Crea Cluster Manuale</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  
                  {/* Cluster esistenti — solo nel tab Approvati */}
                  {clusterFilterStatus === 'approved' && (
                    <>
                      <Text style={styles.clusterSectionTitle}>
                        Cluster ({filteredClusters.length}
                        {clusterModalSearchText.trim() && clusters.length !== filteredClusters.length
                          ? ` / ${clusters.length}`
                          : ''}
                        )
                      </Text>
                      {loadingClusters ? (
                        <ActivityIndicator size="small" color="#667eea" />
                      ) : filteredClusters.length > 0 ? (
                        filteredClusters.map((cluster) => {
                          const players = Array.isArray(cluster.players) ? cluster.players : [];
                          const playerName = players.length
                            ? `${players[0].first_name || ''} ${players[0].last_name || ''}`.trim() || '—'
                            : '—';
                          const leagues = players.map((p) => p.league_name).filter(Boolean).join(', ') || '—';
                          return (
                            <View key={cluster.id} style={styles.clusterItem}>
                              <View style={styles.clusterInfo}>
                                <Text style={styles.clusterPlayerName}>{playerName}</Text>
                                <Text style={styles.clusterPlayerLeague}>
                                  {players.length} {players.length === 1 ? 'giocatore' : 'giocatori'}
                                  {' · '}
                                  {leagues}
                                </Text>
                              </View>
                            </View>
                          );
                        })
                      ) : (
                        <Text style={styles.clusterEmptyText}>
                          {clusterModalSearchText.trim()
                            ? 'Nessun cluster per questa ricerca'
                            : 'Nessun cluster trovato'}
                        </Text>
                      )}
                    </>
                  )}
                </ScrollView>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal giocatori iscritti ma mai giocati */}
      <Modal
        visible={showNeverPlayedModal && selectedGroupForEdit !== null}
        animationType="slide"
        transparent={true}
        onRequestClose={closeNeverPlayedModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Mai giocato</Text>
              <TouchableOpacity onPress={closeNeverPlayedModal}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            {selectedGroupForEdit ? (
              <View style={{ flex: 1 }}>
                <View style={styles.neverPlayedIntro}>
                  <View style={styles.neverPlayedIntroIcon}>
                    <Ionicons name="person-remove-outline" size={20} color="#667eea" />
                  </View>
                  <Text style={styles.neverPlayedIntroText}>
                    Giocatori in rosa ufficiale senza alcun voto di presenza in quella lega.
                    {'\n'}
                    Contano come “mai giocato”: nessun voto oppure solo N.D. — esclusi chi ha almeno 1 S.V. o 1 voto reale.
                  </Text>
                </View>

                {(neverPlayedYearOptions.years.length > 0 || neverPlayedYearOptions.hasNone) ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.neverPlayedYearFilters}
                    contentContainerStyle={styles.neverPlayedYearFiltersContent}
                  >
                    <TouchableOpacity
                      style={[
                        styles.neverPlayedYearChipBtn,
                        neverPlayedYearFilter == null && styles.neverPlayedYearChipBtnActive,
                      ]}
                      onPress={() => setNeverPlayedYearFilter(null)}
                    >
                      <Text
                        style={[
                          styles.neverPlayedYearChipBtnText,
                          neverPlayedYearFilter == null && styles.neverPlayedYearChipBtnTextActive,
                        ]}
                      >
                        Tutti
                      </Text>
                    </TouchableOpacity>
                    {neverPlayedYearOptions.years.map((year) => {
                      const active = Number(neverPlayedYearFilter) === Number(year);
                      return (
                        <TouchableOpacity
                          key={`np-year-${year}`}
                          style={[
                            styles.neverPlayedYearChipBtn,
                            active && styles.neverPlayedYearChipBtnActive,
                          ]}
                          onPress={() => setNeverPlayedYearFilter(year)}
                        >
                          <Text
                            style={[
                              styles.neverPlayedYearChipBtnText,
                              active && styles.neverPlayedYearChipBtnTextActive,
                            ]}
                          >
                            {year}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                    {neverPlayedYearOptions.hasNone ? (
                      <TouchableOpacity
                        style={[
                          styles.neverPlayedYearChipBtn,
                          neverPlayedYearFilter === 'none' && styles.neverPlayedYearChipBtnActive,
                        ]}
                        onPress={() => setNeverPlayedYearFilter('none')}
                      >
                        <Text
                          style={[
                            styles.neverPlayedYearChipBtnText,
                            neverPlayedYearFilter === 'none' && styles.neverPlayedYearChipBtnTextActive,
                          ]}
                        >
                          Senza anno
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </ScrollView>
                ) : null}

                <View style={styles.clusterModalSearchContainer}>
                  <Ionicons name="search" size={18} color="#999" style={styles.searchIcon} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Cerca nome, squadra o lega..."
                    placeholderTextColor="#999"
                    value={neverPlayedSearchText}
                    onChangeText={setNeverPlayedSearchText}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {neverPlayedSearchText.length > 0 ? (
                    <TouchableOpacity onPress={() => setNeverPlayedSearchText('')} style={styles.clearButton}>
                      <Ionicons name="close-circle" size={18} color="#999" />
                    </TouchableOpacity>
                  ) : null}
                </View>

                <View style={styles.neverPlayedCountBar}>
                  <Text style={styles.neverPlayedCountText}>
                    {loadingNeverPlayed
                      ? 'Caricamento…'
                      : `${filteredNeverPlayedPlayers.length} giocator${filteredNeverPlayedPlayers.length === 1 ? 'e' : 'i'}`}
                    {!loadingNeverPlayed
                      && (neverPlayedSearchText.trim() || neverPlayedYearFilter != null)
                      && neverPlayedPlayers.length !== filteredNeverPlayedPlayers.length
                      ? ` su ${neverPlayedPlayers.length}`
                      : ''}
                  </Text>
                  <TouchableOpacity
                    style={styles.neverPlayedRefreshBtn}
                    onPress={() => void loadNeverPlayedPlayers(selectedGroupForEdit.id)}
                    disabled={loadingNeverPlayed}
                  >
                    <Ionicons name="refresh" size={16} color="#667eea" />
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.modalScrollView} contentContainerStyle={{ paddingBottom: 24 }}>
                  {loadingNeverPlayed ? (
                    <ActivityIndicator size="small" color="#667eea" style={{ padding: 28 }} />
                  ) : neverPlayedGrouped.length === 0 ? (
                    <View style={styles.neverPlayedEmpty}>
                      <Ionicons name="checkmark-circle-outline" size={36} color="#94a3b8" />
                      <Text style={styles.neverPlayedEmptyTitle}>
                        {neverPlayedSearchText.trim() || neverPlayedYearFilter != null
                          ? 'Nessun risultato'
                          : 'Nessun giocatore da pulire'}
                      </Text>
                      <Text style={styles.neverPlayedEmptySub}>
                        {neverPlayedSearchText.trim() || neverPlayedYearFilter != null
                          ? 'Prova un altro filtro di ricerca o anno.'
                          : 'Tutti i giocatori del gruppo hanno almeno un S.V. o un voto reale.'}
                      </Text>
                    </View>
                  ) : (
                    neverPlayedGrouped.map((group) => (
                      <View key={`np-league-${group.league_id}`} style={styles.neverPlayedLeagueBlock}>
                        <View style={styles.neverPlayedLeagueHeader}>
                          <Text style={styles.neverPlayedLeagueTitle} numberOfLines={1}>
                            {group.league_name || 'Lega'}
                          </Text>
                          {group.reference_year != null ? (
                            <View style={styles.neverPlayedYearChip}>
                              <Text style={styles.neverPlayedYearChipText}>{group.reference_year}</Text>
                            </View>
                          ) : null}
                          <Text style={styles.neverPlayedLeagueCount}>{group.players.length}</Text>
                        </View>

                        {group.players.map((player) => {
                          const pid = Number(player.player_id);
                          const locked = !!player.in_user_squad || player.can_delete === false;
                          const deleting = deletingNeverPlayedId === pid;
                          const name = `${player.first_name || ''} ${player.last_name || ''}`.trim() || '—';
                          return (
                            <View
                              key={`np-${pid}`}
                              style={[styles.neverPlayedRow, locked && styles.neverPlayedRowLocked]}
                            >
                              <View style={[
                                styles.neverPlayedRoleBadge,
                                player.role === 'P' && { backgroundColor: '#dbeafe' },
                                player.role === 'D' && { backgroundColor: '#dcfce7' },
                                player.role === 'C' && { backgroundColor: '#fef3c7' },
                                player.role === 'A' && { backgroundColor: '#fee2e2' },
                              ]}>
                                <Text style={[
                                  styles.neverPlayedRoleBadgeText,
                                  player.role === 'P' && { color: '#1d4ed8' },
                                  player.role === 'D' && { color: '#15803d' },
                                  player.role === 'C' && { color: '#a16207' },
                                  player.role === 'A' && { color: '#b91c1c' },
                                ]}>{player.role || '?'}</Text>
                              </View>
                              <View style={styles.neverPlayedInfo}>
                                <Text style={styles.neverPlayedName} numberOfLines={1}>{name}</Text>
                                <Text style={styles.neverPlayedMeta} numberOfLines={1}>
                                  {player.team_name || 'Squadra'}
                                  {player.birth_year ? ` · '${String(player.birth_year).slice(-2)}` : ''}
                                  {player.nd_vote_count > 0 ? ` · ${player.nd_vote_count} N.D.` : ' · nessun voto'}
                                </Text>
                                {locked ? (
                                  <Text style={styles.neverPlayedLockHint}>In rosa utente — non eliminabile</Text>
                                ) : null}
                              </View>
                              {deleting ? (
                                <ActivityIndicator size="small" color="#e53935" />
                              ) : (
                                <TouchableOpacity
                                  style={[
                                    styles.neverPlayedDeleteBtn,
                                    locked && styles.neverPlayedDeleteBtnLocked,
                                  ]}
                                  onPress={() => requestDeleteNeverPlayedPlayer(player)}
                                  hitSlop={8}
                                  accessibilityLabel={locked ? 'Non eliminabile' : 'Elimina giocatore'}
                                >
                                  <Ionicons
                                    name={locked ? 'lock-closed' : 'close'}
                                    size={18}
                                    color={locked ? '#94a3b8' : '#e53935'}
                                  />
                                </TouchableOpacity>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    ))
                  )}
                </ScrollView>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Modal buchi anni cluster */}
      <Modal
        visible={showClusterYearGapsModal}
        animationType="slide"
        transparent={true}
        onRequestClose={closeClusterYearGapsModal}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              styles.discrepancyModalContent,
              { paddingBottom: Math.max(insets.bottom, 8) },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { flex: 1, marginRight: 8 }]} numberOfLines={1}>
                Buchi anni cluster
              </Text>
              <TouchableOpacity
                style={[
                  styles.discrepancyInfoIconBtn,
                  yearGapsInfoOpen && styles.discrepancyInfoIconBtnActive,
                ]}
                onPress={() => setYearGapsInfoOpen((v) => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Info sui buchi anni"
              >
                <Ionicons
                  name="information-circle-outline"
                  size={22}
                  color={yearGapsInfoOpen ? '#0369a1' : '#64748b'}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={closeClusterYearGapsModal} hitSlop={8}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <View style={styles.discrepancyModalBody}>
              {yearGapsInfoOpen ? (
                <View style={styles.discrepancyInfoBanner}>
                  <Text style={styles.discrepancyInfoBannerText}>
                    Trova cluster con anni saltati (es. presenti nel 2004 e 2006 ma non nel 2005).
                    {'\n'}
                    Da qui puoi creare il giocatore nell’anno mancante e aggiungerlo al cluster.
                  </Text>
                </View>
              ) : null}

              <Text style={styles.discrepancySectionLabel}>Gruppo ufficiale</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.neverPlayedYearFilters}
                contentContainerStyle={styles.neverPlayedYearFiltersContent}
              >
                {(officialGroups || []).map((g) => {
                  const active = Number(yearGapsGroupId) === Number(g.id);
                  return (
                    <TouchableOpacity
                      key={`yg-g-${g.id}`}
                      style={[
                        styles.neverPlayedYearChipBtn,
                        active && styles.neverPlayedYearChipBtnActive,
                      ]}
                      onPress={() => {
                        setYearGapsGroupId(Number(g.id));
                        setClusterYearGapsResult(null);
                        setYearGapsFillTarget(null);
                        setYearGapsYearFilter(null);
                      }}
                    >
                      <Text
                        style={[
                          styles.neverPlayedYearChipBtnText,
                          active && styles.neverPlayedYearChipBtnTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {g.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <TouchableOpacity
                style={[
                  styles.discrepancyScanBtn,
                  (!yearGapsGroupId || loadingClusterYearGaps) && styles.discrepancyScanBtnDisabled,
                ]}
                onPress={() => void loadClusterYearGaps(yearGapsGroupId)}
                disabled={!yearGapsGroupId || loadingClusterYearGaps}
                activeOpacity={0.85}
              >
                {loadingClusterYearGaps ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="search" size={18} color="#fff" />
                )}
                <Text style={styles.discrepancyScanBtnText}>
                  {loadingClusterYearGaps ? 'Scansione in corso…' : 'Avvia ricerca'}
                </Text>
              </TouchableOpacity>

              {clusterYearGapsResult ? (
                <View style={{ flex: 1, minHeight: 0 }}>
                  <View style={styles.discrepancySummaryBar}>
                    <Text style={styles.discrepancySummaryText}>
                      {clusterYearGapsResult.count || 0} cluster con buchi
                      {filteredClusterYearGaps.length !== (clusterYearGapsResult.count || 0)
                        || yearGapsYearFilter != null
                        || yearGapsSearchText.trim()
                        ? ` · ${filteredClusterYearGaps.length} in elenco`
                        : ''}
                    </Text>
                  </View>

                  {yearGapsYearOptions.length > 0 ? (
                    <>
                      <Text style={styles.discrepancySectionLabel}>Anno buco</Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.neverPlayedYearFilters}
                        contentContainerStyle={styles.neverPlayedYearFiltersContent}
                      >
                        <TouchableOpacity
                          style={[
                            styles.neverPlayedYearChipBtn,
                            yearGapsYearFilter == null && styles.neverPlayedYearChipBtnActive,
                          ]}
                          onPress={() => {
                            setYearGapsYearFilter(null);
                            setYearGapsFillTarget(null);
                          }}
                        >
                          <Text
                            style={[
                              styles.neverPlayedYearChipBtnText,
                              yearGapsYearFilter == null && styles.neverPlayedYearChipBtnTextActive,
                            ]}
                          >
                            Tutti
                          </Text>
                        </TouchableOpacity>
                        {yearGapsYearOptions.map((year) => {
                          const active = Number(yearGapsYearFilter) === Number(year);
                          return (
                            <TouchableOpacity
                              key={`yg-yf-${year}`}
                              style={[
                                styles.neverPlayedYearChipBtn,
                                active && styles.neverPlayedYearChipBtnActive,
                              ]}
                              onPress={() => {
                                setYearGapsYearFilter(Number(year));
                                setYearGapsFillTarget(null);
                              }}
                            >
                              <Text
                                style={[
                                  styles.neverPlayedYearChipBtnText,
                                  active && styles.neverPlayedYearChipBtnTextActive,
                                ]}
                              >
                                {year}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </>
                  ) : null}

                  <View style={[styles.searchContainer, { marginHorizontal: 0, marginBottom: 8 }]}>
                    <Ionicons name="search" size={18} color="#999" style={styles.searchIcon} />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Cerca giocatore…"
                      placeholderTextColor="#999"
                      value={yearGapsSearchText}
                      onChangeText={setYearGapsSearchText}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {yearGapsSearchText.length > 0 ? (
                      <TouchableOpacity onPress={() => setYearGapsSearchText('')} style={styles.clearButton}>
                        <Ionicons name="close-circle" size={18} color="#999" />
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  <ScrollView style={styles.modalScrollView} contentContainerStyle={{ paddingBottom: 24 }}>
                    {filteredClusterYearGaps.length === 0 ? (
                      <View style={styles.neverPlayedEmpty}>
                        <Ionicons name="checkmark-circle-outline" size={36} color="#94a3b8" />
                        <Text style={styles.neverPlayedEmptyTitle}>
                          {yearGapsSearchText.trim() || yearGapsYearFilter != null
                            ? 'Nessun risultato'
                            : 'Nessun buco trovato'}
                        </Text>
                        <Text style={styles.neverPlayedEmptySub}>
                          {yearGapsSearchText.trim() || yearGapsYearFilter != null
                            ? 'Prova un altro anno o filtro di ricerca.'
                            : 'Tutti i cluster hanno gli anni continui tra il primo e l’ultimo.'}
                        </Text>
                      </View>
                    ) : (
                      filteredClusterYearGaps.map((cluster) => {
                        const fillOpen =
                          yearGapsFillTarget?.cluster?.cluster_id === cluster.cluster_id;
                        return (
                          <View key={`yg-c-${cluster.cluster_id}`} style={styles.yearGapsClusterCard}>
                            <Text style={styles.yearGapsClusterName} numberOfLines={1}>
                              {cluster.name}
                            </Text>
                            <Text style={styles.yearGapsPresentLine}>
                              Presente: {(cluster.present_years || []).join(' · ') || '—'}
                            </Text>
                            <View style={styles.yearGapsMissingRow}>
                              {(cluster.gaps || []).map((gap) => {
                                const active =
                                  fillOpen
                                  && Number(yearGapsFillTarget?.gap?.reference_year) === Number(gap.reference_year);
                                return (
                                  <TouchableOpacity
                                    key={`yg-g-${cluster.cluster_id}-${gap.reference_year}`}
                                    style={[
                                      styles.yearGapsMissingChip,
                                      active && styles.yearGapsMissingChipActive,
                                    ]}
                                    onPress={() => openYearGapsFill(cluster, gap)}
                                    activeOpacity={0.8}
                                  >
                                    <Text
                                      style={[
                                        styles.yearGapsMissingChipText,
                                        active && styles.yearGapsMissingChipTextActive,
                                      ]}
                                    >
                                      Manca {gap.reference_year}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>

                            {fillOpen && yearGapsFillTarget?.gap ? (
                              <View style={styles.yearGapsFillPanel}>
                                <Text style={styles.yearGapsFillTitle}>
                                  Aggiungi {cluster.name} · {yearGapsFillTarget.gap.reference_year}
                                </Text>
                                <Text style={styles.yearGapsFillHint}>
                                  {yearGapsFillTarget.gap.league_name || 'Lega'}
                                  {yearGapsFillTarget.gap.suggested_birth_year
                                    ? ` · nascita ${yearGapsFillTarget.gap.suggested_birth_year}`
                                    : ''}
                                </Text>

                                {(yearGapsFillTarget.gap.existing_players || []).length > 0 ? (
                                  <View style={styles.yearGapsExistingBlock}>
                                    <Text style={styles.discrepancySectionLabel}>Già in rosa</Text>
                                    {yearGapsFillTarget.gap.existing_players.map((ep) => (
                                      <TouchableOpacity
                                        key={`yg-ex-${ep.player_id}`}
                                        style={[
                                          styles.yearGapsExistingBtn,
                                          savingYearGapsFill && styles.discrepancyScanBtnDisabled,
                                        ]}
                                        disabled={savingYearGapsFill}
                                        onPress={() => void submitYearGapsFill({ useExistingPlayerId: ep.player_id })}
                                      >
                                        <Ionicons name="link" size={16} color="#1d4ed8" />
                                        <Text style={styles.yearGapsExistingBtnText} numberOfLines={2}>
                                          Aggiungi esistente · {ep.team_name || 'Squadra'}
                                          {ep.role ? ` (${ep.role})` : ''}
                                        </Text>
                                      </TouchableOpacity>
                                    ))}
                                  </View>
                                ) : null}

                                <Text style={styles.discrepancySectionLabel}>Ruolo</Text>
                                <View style={styles.yearGapsRoleRow}>
                                  {['P', 'D', 'C', 'A'].map((r) => {
                                    const active = yearGapsFillRole === r;
                                    return (
                                      <TouchableOpacity
                                        key={`yg-role-${r}`}
                                        style={[
                                          styles.yearGapsRoleChip,
                                          active && styles.yearGapsRoleChipActive,
                                          r === 'P' && active && { backgroundColor: '#1d4ed8' },
                                          r === 'D' && active && { backgroundColor: '#15803d' },
                                          r === 'C' && active && { backgroundColor: '#a16207' },
                                          r === 'A' && active && { backgroundColor: '#b91c1c' },
                                        ]}
                                        onPress={() => setYearGapsFillRole(r)}
                                      >
                                        <Text
                                          style={[
                                            styles.yearGapsRoleChipText,
                                            active && styles.yearGapsRoleChipTextActive,
                                          ]}
                                        >
                                          {r}
                                        </Text>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>

                                <Text style={styles.discrepancySectionLabel}>Squadra</Text>
                                <ScrollView
                                  horizontal
                                  showsHorizontalScrollIndicator={false}
                                  contentContainerStyle={styles.yearGapsTeamChips}
                                >
                                  {(yearGapsFillTarget.gap.teams || []).map((t) => {
                                    const active = Number(yearGapsFillTeamId) === Number(t.team_id);
                                    const suggested =
                                      Number(yearGapsFillTarget.gap.suggested_team_id) === Number(t.team_id);
                                    return (
                                      <TouchableOpacity
                                        key={`yg-t-${t.team_id}`}
                                        style={[
                                          styles.yearGapsTeamChip,
                                          suggested && !active && styles.yearGapsTeamChipSuggested,
                                          active && styles.yearGapsTeamChipActive,
                                        ]}
                                        onPress={() => setYearGapsFillTeamId(Number(t.team_id))}
                                      >
                                        <Text
                                          style={[
                                            styles.yearGapsTeamChipText,
                                            active && styles.yearGapsTeamChipTextActive,
                                          ]}
                                          numberOfLines={1}
                                        >
                                          {suggested ? '★ ' : ''}{t.team_name}
                                        </Text>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </ScrollView>

                                <TouchableOpacity
                                  style={[
                                    styles.yearGapsCreateBtn,
                                    (savingYearGapsFill || !yearGapsFillTeamId) && styles.discrepancyScanBtnDisabled,
                                  ]}
                                  disabled={savingYearGapsFill || !yearGapsFillTeamId}
                                  onPress={() => void submitYearGapsFill()}
                                  activeOpacity={0.85}
                                >
                                  {savingYearGapsFill ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                  ) : (
                                    <Ionicons name="person-add" size={18} color="#fff" />
                                  )}
                                  <Text style={styles.yearGapsCreateBtnText}>
                                    Crea e aggiungi al cluster
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            ) : null}
                          </View>
                        );
                      })
                    )}
                  </ScrollView>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal scansione discrepanze diretta ↔ voti */}
      <Modal
        visible={showLiveBonusDiscrepancyModal}
        animationType="slide"
        transparent={true}
        onRequestClose={closeLiveBonusDiscrepancyModal}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              styles.discrepancyModalContent,
              { paddingBottom: Math.max(insets.bottom, 8) },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { flex: 1, marginRight: 8 }]} numberOfLines={1}>
                Discrepanze diretta / voti
              </Text>
              <TouchableOpacity
                style={[
                  styles.discrepancyInfoIconBtn,
                  discrepancyInfoOpen && styles.discrepancyInfoIconBtnActive,
                ]}
                onPress={() => setDiscrepancyInfoOpen((v) => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Info sul confronto"
              >
                <Ionicons
                  name="information-circle-outline"
                  size={22}
                  color={discrepancyInfoOpen ? '#4338ca' : '#64748b'}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={closeLiveBonusDiscrepancyModal} hitSlop={8}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <View style={styles.discrepancyModalBody}>
              {discrepancyInfoOpen ? (
                <View style={styles.discrepancyInfoBanner}>
                  <Text style={styles.discrepancyInfoBannerText}>
                    Confronta gol, assist, cartellini e altri bonus della diretta con quelli salvati nei voti.
                    {'\n'}
                    Per ogni partita indica cosa correggere (valore voti → valore diretta).
                  </Text>
                </View>
              ) : null}

              <Text style={styles.discrepancySectionLabel}>Gruppo ufficiale</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.neverPlayedYearFilters}
                contentContainerStyle={styles.neverPlayedYearFiltersContent}
              >
                {(officialGroups || []).map((g) => {
                  const active = Number(discrepancyGroupId) === Number(g.id);
                  return (
                    <TouchableOpacity
                      key={`disc-g-${g.id}`}
                      style={[
                        styles.neverPlayedYearChipBtn,
                        active && styles.neverPlayedYearChipBtnActive,
                      ]}
                      onPress={() => {
                        setDiscrepancyGroupId(Number(g.id));
                        setLiveBonusDiscrepancyResult(null);
                      }}
                    >
                      <Text
                        style={[
                          styles.neverPlayedYearChipBtnText,
                          active && styles.neverPlayedYearChipBtnTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {g.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <TouchableOpacity
                style={[
                  styles.discrepancyScanBtn,
                  (!discrepancyGroupId || loadingLiveBonusDiscrepancies) && styles.discrepancyScanBtnDisabled,
                ]}
                onPress={() => void loadLiveBonusDiscrepancies(discrepancyGroupId)}
                disabled={!discrepancyGroupId || loadingLiveBonusDiscrepancies}
                activeOpacity={0.85}
              >
                {loadingLiveBonusDiscrepancies ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="search" size={18} color="#fff" />
                )}
                <Text style={styles.discrepancyScanBtnText}>
                  {loadingLiveBonusDiscrepancies ? 'Scansione in corso…' : 'Avvia ricerca'}
                </Text>
              </TouchableOpacity>

              {liveBonusDiscrepancyResult ? (
                <View style={{ flex: 1, minHeight: 0 }}>
                  <View style={styles.discrepancySummaryBar}>
                    <Text style={styles.discrepancySummaryText}>
                      {liveBonusDiscrepancyResult.match_count || 0} partite ·{' '}
                      {liveBonusDiscrepancyResult.player_count || 0} giocatori/cluster ·{' '}
                      {liveBonusDiscrepancyResult.discrepancy_count || 0} differenze
                    </Text>
                    <Text style={styles.discrepancySummarySub}>
                      Scansionate {liveBonusDiscrepancyResult.scanned_matches || 0} partite collegate
                    </Text>
                  </View>

                  <View style={styles.discrepancyModeRow}>
                    <TouchableOpacity
                      style={[
                        styles.discrepancyModeChip,
                        discrepancyViewMode === 'matches' && styles.discrepancyModeChipActive,
                      ]}
                      onPress={() => setDiscrepancyViewMode('matches')}
                    >
                      <Text
                        style={[
                          styles.discrepancyModeChipText,
                          discrepancyViewMode === 'matches' && styles.discrepancyModeChipTextActive,
                        ]}
                      >
                        Per partita
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.discrepancyModeChip,
                        discrepancyViewMode === 'players' && styles.discrepancyModeChipActive,
                      ]}
                      onPress={() => setDiscrepancyViewMode('players')}
                    >
                      <Text
                        style={[
                          styles.discrepancyModeChipText,
                          discrepancyViewMode === 'players' && styles.discrepancyModeChipTextActive,
                        ]}
                      >
                        Per giocatore
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={[styles.searchContainer, { marginHorizontal: 0, marginBottom: 8 }]}>
                    <Ionicons name="search" size={18} color="#999" style={styles.searchIcon} />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Filtra partita, giocatore, squadra…"
                      placeholderTextColor="#999"
                      value={discrepancySearchText}
                      onChangeText={setDiscrepancySearchText}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {discrepancySearchText.length > 0 ? (
                      <TouchableOpacity onPress={() => setDiscrepancySearchText('')} style={styles.clearButton}>
                        <Ionicons name="close-circle" size={18} color="#999" />
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={styles.discrepancyListContent}
                    showsVerticalScrollIndicator={false}
                  >
                    {discrepancyViewMode === 'matches' ? (
                      filteredDiscrepancyMatches.length === 0 ? (
                        <View style={styles.neverPlayedEmpty}>
                          <Ionicons name="checkmark-circle-outline" size={40} color="#86efac" />
                          <Text style={styles.neverPlayedEmptyTitle}>
                            {discrepancySearchText.trim()
                              ? 'Nessun risultato per il filtro'
                              : 'Nessuna discrepanza'}
                          </Text>
                          <Text style={styles.neverPlayedEmptySub}>
                            {discrepancySearchText.trim()
                              ? 'Prova con altri termini'
                              : 'Diretta e voti sono allineati sulle partite collegate'}
                          </Text>
                        </View>
                      ) : (
                        filteredDiscrepancyMatches.map((match) => {
                          const expanded = !!expandedDiscrepancyMatchIds[String(match.match_id)];
                          return (
                            <View key={`disc-m-${match.match_id}`} style={styles.discrepancyCard}>
                              <TouchableOpacity
                                style={styles.discrepancyCardHeader}
                                onPress={() =>
                                  setExpandedDiscrepancyMatchIds((prev) => ({
                                    ...prev,
                                    [String(match.match_id)]: !prev[String(match.match_id)],
                                  }))
                                }
                                activeOpacity={0.75}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.discrepancyCardTitle} numberOfLines={2}>
                                    {match.label}
                                  </Text>
                                  <Text style={styles.discrepancyCardMeta}>
                                    {[
                                      match.league_name,
                                      match.reference_year ? String(match.reference_year) : null,
                                      `${match.player_count} giocatori`,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </Text>
                                </View>
                                <Ionicons
                                  name={expanded ? 'chevron-up' : 'chevron-down'}
                                  size={18}
                                  color="#94a3b8"
                                />
                              </TouchableOpacity>
                              {expanded
                                ? (match.players || []).map((p) => (
                                    <View
                                      key={`disc-mp-${match.match_id}-${p.player_id}-${p.giornata}`}
                                      style={styles.discrepancyPlayerBlock}
                                    >
                                      <View style={styles.discrepancyPlayerTitleRow}>
                                        <Text style={styles.discrepancyPlayerName} numberOfLines={1}>
                                          {p.player_name}
                                        </Text>
                                        {p.is_cluster ? (
                                          <View style={styles.discrepancyClusterBadge}>
                                            <Text style={styles.discrepancyClusterBadgeText}>Cluster</Text>
                                          </View>
                                        ) : null}
                                      </View>
                                      <Text style={styles.discrepancyPlayerMeta}>
                                        {p.team_name}
                                        {p.giornata != null ? ` · G${p.giornata}` : ''}
                                        {' · '}
                                        {discrepancyIssueLabel(p.issue_type)}
                                      </Text>
                                      {(p.diffs || []).map((d) => (
                                        <View
                                          key={`disc-d-${match.match_id}-${p.player_id}-${d.field}`}
                                          style={styles.discrepancyDiffRow}
                                        >
                                          <Text style={styles.discrepancyDiffLabel}>{d.label}</Text>
                                          <Text style={styles.discrepancyDiffValues}>
                                            voti {d.from_voti} → diretta {d.fix_to}
                                          </Text>
                                        </View>
                                      ))}
                                    </View>
                                  ))
                                : null}
                            </View>
                          );
                        })
                      )
                    ) : filteredDiscrepancyPlayers.length === 0 ? (
                      <View style={styles.neverPlayedEmpty}>
                        <Ionicons name="checkmark-circle-outline" size={40} color="#86efac" />
                        <Text style={styles.neverPlayedEmptyTitle}>
                          {discrepancySearchText.trim()
                            ? 'Nessun risultato per il filtro'
                            : 'Nessuna discrepanza'}
                        </Text>
                      </View>
                    ) : (
                      filteredDiscrepancyPlayers.map((p) => {
                        const expanded = !!expandedDiscrepancyPlayerKeys[String(p.key)];
                        return (
                          <View key={`disc-p-${p.key}`} style={styles.discrepancyCard}>
                            <TouchableOpacity
                              style={styles.discrepancyCardHeader}
                              onPress={() =>
                                setExpandedDiscrepancyPlayerKeys((prev) => ({
                                  ...prev,
                                  [String(p.key)]: !prev[String(p.key)],
                                }))
                              }
                              activeOpacity={0.75}
                            >
                              <View style={{ flex: 1 }}>
                                <View style={styles.discrepancyPlayerTitleRow}>
                                  <Text style={styles.discrepancyCardTitle} numberOfLines={1}>
                                    {p.player_name}
                                  </Text>
                                  {p.kind === 'cluster' ? (
                                    <View style={styles.discrepancyClusterBadge}>
                                      <Text style={styles.discrepancyClusterBadgeText}>Cluster</Text>
                                    </View>
                                  ) : null}
                                </View>
                                <Text style={styles.discrepancyCardMeta} numberOfLines={2}>
                                  {p.match_count} partite
                                  {p.net_summary ? ` · ${p.net_summary}` : ''}
                                </Text>
                              </View>
                              <Ionicons
                                name={expanded ? 'chevron-up' : 'chevron-down'}
                                size={18}
                                color="#94a3b8"
                              />
                            </TouchableOpacity>
                            {expanded
                              ? (p.matches_affected || []).map((m, idx) => (
                                  <View
                                    key={`disc-pm-${p.key}-${m.match_id}-${m.player_id}-${idx}`}
                                    style={styles.discrepancyPlayerBlock}
                                  >
                                    <Text style={styles.discrepancyPlayerName} numberOfLines={2}>
                                      {m.label}
                                    </Text>
                                    <Text style={styles.discrepancyPlayerMeta}>
                                      {m.team_name}
                                      {m.giornata != null ? ` · G${m.giornata}` : ''}
                                      {m.reference_year != null ? ` · ${m.reference_year}` : ''}
                                      {' · '}
                                      {discrepancyIssueLabel(m.issue_type)}
                                    </Text>
                                    {(m.diffs || []).map((d) => (
                                      <View
                                        key={`disc-pd-${p.key}-${m.match_id}-${d.field}-${idx}`}
                                        style={styles.discrepancyDiffRow}
                                      >
                                        <Text style={styles.discrepancyDiffLabel}>{d.label}</Text>
                                        <Text style={styles.discrepancyDiffValues}>
                                          voti {d.from_voti} → diretta {d.fix_to}
                                        </Text>
                                      </View>
                                    ))}
                                  </View>
                                ))
                              : null}
                          </View>
                        );
                      })
                    )}
                  </ScrollView>
                </View>
              ) : !loadingLiveBonusDiscrepancies ? (
                <View style={styles.neverPlayedEmpty}>
                  <Ionicons name="construct-outline" size={40} color="#cbd5e1" />
                  <Text style={styles.neverPlayedEmptyTitle}>Seleziona un gruppo e avvia la ricerca</Text>
                  <Text style={styles.neverPlayedEmptySub}>
                    Verranno confrontate solo le partite ufficiali collegate a una giornata voti.
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!suggestionEditModal}
        animationType="slide"
        transparent={true}
        onRequestClose={closeSuggestionEditModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.suggestionEditModalContent, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
            <View style={styles.suggestionEditHeader}>
              <View style={styles.suggestionEditHeaderText}>
                <Text style={styles.suggestionEditTitle}>
                  {suggestionEditModal?.mode === 'new' ? 'Nuovo cluster' : 'Associa giocatori'}
                </Text>
                <Text style={styles.suggestionEditSubtitle} numberOfLines={2}>
                  {suggestionEditModal?.suggestion?.name || '—'}
                </Text>
              </View>
              <TouchableOpacity style={styles.groupDetailHeaderIconBtn} onPress={closeSuggestionEditModal}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text style={styles.suggestionEditHint}>
              {suggestionEditModal?.mode === 'new'
                ? 'Seleziona i giocatori da includere nel nuovo cluster separato.'
                : 'I giocatori già nel cluster restano selezionati. Attiva gli altri switch per associarli.'}
            </Text>

            <ScrollView
              style={styles.suggestionEditList}
              contentContainerStyle={styles.suggestionEditListContent}
              showsVerticalScrollIndicator={false}
            >
              {(suggestionEditModal?.players || []).map((player) => {
                const pid = Number(player.player_id);
                const isOn = !!suggestionEditModal?.selected?.[pid];
                return (
                  <View
                    key={`sug-edit-${pid}`}
                    style={[styles.suggestionEditRow, player.in_cluster && styles.suggestionEditRowLocked]}
                  >
                    <View style={styles.suggestionEditRowInfo}>
                      <Text style={styles.suggestionEditLeague} numberOfLines={1}>
                        {player.reference_year ? `${player.reference_year} · ` : ''}
                        {player.league_name}
                      </Text>
                      <Text style={styles.suggestionEditMeta}>
                        {player.team_name || '—'}
                        {' • '}
                        {formatClusterPlayerRole(player.role)}
                        {player.birth_year ? ` • ${player.birth_year}` : ' • Anno n.d.'}
                      </Text>
                      {player.in_cluster ? (
                        <Text style={styles.suggestionEditInCluster}>Già nel cluster</Text>
                      ) : null}
                    </View>
                    <Switch
                      value={isOn}
                      onValueChange={(value) => toggleSuggestionEditPlayer(pid, value)}
                      disabled={!!player.in_cluster}
                      trackColor={{ false: '#d1d5db', true: '#a5b4fc' }}
                      thumbColor={isOn ? '#667eea' : '#f4f3f4'}
                    />
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.suggestionEditFooter}>
              <TouchableOpacity
                style={[styles.suggestionEditFooterBtn, styles.suggestionEditFooterBtnCancel]}
                onPress={closeSuggestionEditModal}
              >
                <Text style={styles.suggestionEditFooterBtnCancelText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.suggestionEditFooterBtn, styles.suggestionEditFooterBtnSave]}
                onPress={handleSaveSuggestionEdit}
              >
                <Ionicons
                  name={suggestionEditModal?.mode === 'new' ? 'add-circle' : 'checkmark'}
                  size={18}
                  color="#fff"
                />
                <Text style={styles.suggestionEditFooterBtnSaveText}>
                  {suggestionEditModal?.mode === 'new' ? 'Crea cluster' : 'Salva'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal per creare cluster manuale */}
      <Modal
        visible={showCreateClusterModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowCreateClusterModal(false);
          setSelectedPlayersForCluster([]);
          setSearchPlayersQuery('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Crea Cluster Manuale</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowCreateClusterModal(false);
                  setSelectedPlayersForCluster([]);
                  setSearchPlayersQuery('');
                }}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            {selectedGroupForEdit && (
              <View style={{ flex: 1 }}>
                <View style={styles.modalInputContainer}>
                  <Text style={styles.modalLabel}>Cerca Giocatore</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Nome giocatore..."
                    value={searchPlayersQuery}
                    onChangeText={(text) => {
                      setSearchPlayersQuery(text);
                      if (text.length > 2) {
                        searchPlayers(selectedGroupForEdit.id, text);
                      } else {
                        setSearchedPlayers([]);
                      }
                    }}
                  />
                </View>
                
                <ScrollView style={styles.modalScrollView}>
                  {loadingPlayers ? (
                    <ActivityIndicator size="small" color="#667eea" />
                  ) : searchedPlayers.length > 0 ? (
                    searchedPlayers.map((player) => {
                      const isSelected = selectedPlayersForCluster.some(p => p.id === player.id);
                      return (
                        <TouchableOpacity
                          key={player.id}
                          style={[styles.searchPlayerItem, isSelected && styles.searchPlayerItemSelected]}
                          onPress={() => {
                            if (isSelected) {
                              setSelectedPlayersForCluster(selectedPlayersForCluster.filter(p => p.id !== player.id));
                            } else {
                              setSelectedPlayersForCluster([...selectedPlayersForCluster, player]);
                            }
                          }}
                        >
                          <View style={styles.searchPlayerInfo}>
                            <Text style={styles.searchPlayerName}>{player.full_name}</Text>
                            <Text style={styles.searchPlayerDetails}>
                              {player.league_name} • {player.role} • {player.rating.toFixed(2)} {player.rating === 1 ? 'credito' : 'crediti'}
                            </Text>
                          </View>
                          {isSelected && (
                            <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
                          )}
                        </TouchableOpacity>
                      );
                    })
                  ) : (
                    <Text style={styles.clusterEmptyText}>
                      {searchPlayersQuery.length > 2 ? 'Nessun giocatore trovato' : 'Cerca un giocatore per iniziare'}
                    </Text>
                  )}
                  
                  {selectedPlayersForCluster.length > 0 && (
                    <>
                      <Text style={styles.clusterSectionTitle}>
                        Giocatori Selezionati ({selectedPlayersForCluster.length})
                      </Text>
                      {selectedPlayersForCluster.map((player) => (
                        <View key={player.id} style={styles.selectedPlayerItem}>
                          <Text style={styles.selectedPlayerName}>{player.full_name}</Text>
                          <Text style={styles.selectedPlayerDetails}>
                            {player.league_name} • {player.role}
                          </Text>
                        </View>
                      ))}
                    </>
                  )}
                </ScrollView>
                
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonPrimary, { marginTop: 16 }]}
                  onPress={() => handleCreateManualCluster(selectedGroupForEdit.id)}
                  disabled={selectedPlayersForCluster.length < 2}
                >
                  <Text style={styles.modalButtonText}>
                    Crea Cluster ({selectedPlayersForCluster.length} giocatori)
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal Dettagli Giocatore Cluster */}
      <Modal
        visible={showPlayerClusterDetail}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowPlayerClusterDetail(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.modalTitle}>
                  {selectedPlayerCluster
                    ? formatClusterListTitle(selectedPlayerCluster.name, selectedPlayerCluster.leagues)
                    : 'Dettagli Giocatore'}
                </Text>
                {selectedPlayerCluster ? (
                  <Text style={styles.modalTitleSub}>
                    {selectedPlayerCluster.is_single_player
                      ? `Giocatore singolo${selectedPlayerCluster.group_name ? ` · ${selectedPlayerCluster.group_name}` : ''}`
                      : `${selectedPlayerCluster.players_count ?? selectedPlayerCluster.leagues?.length ?? 0} ${(selectedPlayerCluster.players_count ?? selectedPlayerCluster.leagues?.length ?? 0) === 1 ? 'edizione' : 'edizioni'}${selectedPlayerCluster.group_name ? ` · ${selectedPlayerCluster.group_name}` : ''}`}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                onPress={() => {
                  setShowPlayerClusterDetail(false);
                  setSelectedPlayerCluster(null);
                  setShowAddPlayers(false);
                  setAvailablePlayersToAdd([]);
                  setHasAvailablePlayers(false);
                  setClusterBirthYearDraft('');
                  setShowClusterBirthYearPicker(false);
                  setClusterRoleDraft('');
                  setShowClusterRolePicker(false);
                }}
              >
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            {selectedPlayerCluster ? (() => {
              const missingBirthYearCount = countClusterMembersMissingBirthYear(selectedPlayerCluster.leagues);
              const mismatchedRoleCount = countClusterMembersNotMatchingRole(
                selectedPlayerCluster.leagues,
                clusterRoleDraft,
              );
              return (
              <View style={styles.clusterMetaWrap}>
                <View style={styles.clusterMetaBar}>
                  <View style={styles.clusterMetaField}>
                    <Text style={styles.clusterMetaLabel} numberOfLines={1}>Anno</Text>
                  <TouchableOpacity
                    style={[
                      styles.clusterMetaPill,
                      !selectedPlayerCluster.is_single_player
                        && missingBirthYearCount > 0
                        && clusterBirthYearDraft
                        ? styles.clusterMetaPillPending
                        : null,
                    ]}
                    onPress={() => setShowClusterBirthYearPicker(true)}
                    disabled={savingClusterBirthYear}
                    activeOpacity={0.7}
                  >
                    {savingClusterBirthYear ? (
                      <ActivityIndicator size="small" color="#94a3b8" />
                    ) : (
                      <>
                        <Text style={[
                          styles.clusterMetaValue,
                          !clusterBirthYearDraft && styles.clusterMetaValueEmpty,
                        ]}>
                          {clusterBirthYearDraft || '—'}
                        </Text>
                        <Ionicons name="chevron-down" size={14} color="#94a3b8" />
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                <View style={styles.clusterMetaField}>
                  <Text style={styles.clusterMetaLabel} numberOfLines={1}>Ruolo</Text>
                  <TouchableOpacity
                    style={[
                      styles.clusterMetaPill,
                      !selectedPlayerCluster.is_single_player
                        && mismatchedRoleCount > 0
                        && clusterRoleDraft
                        ? styles.clusterMetaPillPending
                        : null,
                    ]}
                    onPress={() => setShowClusterRolePicker(true)}
                    disabled={savingClusterRole}
                    activeOpacity={0.7}
                  >
                    {savingClusterRole ? (
                      <ActivityIndicator size="small" color="#94a3b8" />
                    ) : (
                      <>
                        <Text style={[
                          styles.clusterMetaValue,
                          !clusterRoleDraft && styles.clusterMetaValueEmpty,
                        ]}>
                          {clusterRoleDraft || '—'}
                        </Text>
                        <Ionicons name="chevron-down" size={14} color="#94a3b8" />
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                </View>

                {!selectedPlayerCluster.is_single_player && missingBirthYearCount > 0 && clusterBirthYearDraft ? (
                  <Text style={styles.clusterMetaPendingHint}>
                    {missingBirthYearCount} senza anno
                  </Text>
                ) : !selectedPlayerCluster.is_single_player && mismatchedRoleCount > 0 && clusterRoleDraft ? (
                  <Text style={styles.clusterMetaPendingHint}>
                    {mismatchedRoleCount === 1
                      ? '1 ruolo diverso'
                      : `${mismatchedRoleCount} ruoli diversi`}
                  </Text>
                ) : null}
              </View>
              );
            })() : null}
            
            {selectedPlayerCluster && (
              <ScrollView style={styles.modalScrollView} contentContainerStyle={{ paddingBottom: 20 }}>
                {/* Sezione giocatori disponibili da aggiungere */}
                {showAddPlayers && !selectedPlayerCluster.is_single_player && availablePlayersToAdd.length > 0 && (
                  <View style={styles.groupDetailSection}>
                    <Text style={styles.groupDetailSectionTitle}>
                      Giocatori Disponibili ({availablePlayersToAdd.length})
                    </Text>
                    {availablePlayersToAdd.map((player, index) => {
                      const playerFullName = `${player.first_name || ''} ${player.last_name || ''}`.trim() || player.name;
                      return (
                        <View key={index} style={styles.availablePlayerItem}>
                          <View style={styles.availablePlayerInfo}>
                            <Text style={styles.availablePlayerName}>{playerFullName}</Text>
                            <Text style={styles.availablePlayerLeague}>
                              {player.league_name}
                              {formatBirthYear(player.birth_year) ? ` • Anno ${formatBirthYear(player.birth_year)}` : ''}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.addToClusterButton}
                            onPress={() => handleAddPlayerToApprovedCluster(player)}
                          >
                            <Ionicons name="checkmark" size={20} color="#4CAF50" />
                            <Text style={styles.addToClusterButtonText}>Aggiungi</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                )}
                
                {showAddPlayers && !selectedPlayerCluster.is_single_player && availablePlayersToAdd.length === 0 && !loadingAvailablePlayers && (
                  <View style={styles.groupDetailSection}>
                    <Text style={styles.groupDetailEmpty}>
                      Nessun altro giocatore trovato con lo stesso nome
                    </Text>
                  </View>
                )}
                
                <View style={styles.groupDetailSection}>
                  <Text style={styles.groupDetailSectionTitle}>
                    Leghe ({selectedPlayerCluster.leagues.length})
                  </Text>
                  {selectedPlayerCluster.leagues.length > 0 ? (
                    selectedPlayerCluster.leagues.map((league, index) => {
                      const removeKey = `${league.cluster_id}-${league.player_id}`;
                      const isRemoving = removingLeagueKey === removeKey;
                      return (
                        <View key={`${league.cluster_id}-${league.player_id}-${index}`} style={styles.clusterLeagueRow}>
                          <View style={styles.clusterLeagueColLeague}>
                            <Text style={styles.groupLeagueName}>{league.name}</Text>
                            <Text style={styles.groupLeagueDetails}>{league.group_name}</Text>
                          </View>
                          <View style={styles.clusterLeagueColTeam}>
                            <Text style={styles.clusterLeagueTeamName} numberOfLines={2}>
                              {league.team_name || '—'}
                            </Text>
                            <Text style={styles.clusterLeagueRoleText}>
                              {formatClusterPlayerRole(league.role)}
                            </Text>
                          </View>
                          {!selectedPlayerCluster.is_single_player ? (
                            <TouchableOpacity
                              style={styles.clusterLeagueRemoveBtn}
                              onPress={() => handleRemovePlayerFromClusterLeague(league)}
                              disabled={isRemoving}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              {isRemoving ? (
                                <ActivityIndicator size="small" color="#e53935" />
                              ) : (
                                <Ionicons name="close-circle" size={26} color="#e53935" />
                              )}
                            </TouchableOpacity>
                          ) : (
                            <View style={styles.clusterLeagueRemoveBtn} />
                          )}
                        </View>
                      );
                    })
                  ) : (
                    <Text style={styles.groupDetailEmpty}>
                      Nessuna lega trovata
                    </Text>
                  )}
                </View>
              </ScrollView>
            )}
            
            {/* Floating Action Button per aggiungere giocatori */}
            {selectedPlayerCluster && !selectedPlayerCluster.is_single_player && hasAvailablePlayers && (
              <TouchableOpacity
                style={styles.fab}
                onPress={() => {
                  const groupId = selectedPlayerCluster.leagues[0]?.group_id;
                  const existingLeagueIds = selectedPlayerCluster.leagues.map(l => l.id);
                  if (groupId) {
                    searchAvailablePlayersForCluster(selectedPlayerCluster.name, groupId, existingLeagueIds);
                  }
                }}
                disabled={loadingAvailablePlayers}
              >
                {loadingAvailablePlayers ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="add" size={28} color="#fff" />
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={showClusterBirthYearPicker}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowClusterBirthYearPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.yearPickerModalContent, styles.clusterBirthYearPickerModal]}>
            <View style={styles.clusterBirthYearPickerHeader}>
              <Text style={styles.clusterBirthYearPickerTitle}>Anno di nascita</Text>
              <TouchableOpacity onPress={() => setShowClusterBirthYearPicker(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.yearPickerScroll} contentContainerStyle={styles.yearPickerGrid} showsVerticalScrollIndicator={false}>
              {selectableBirthYears.map((year) => {
                const selected = String(clusterBirthYearDraft) === String(year);
                return (
                  <TouchableOpacity
                    key={year}
                    style={[styles.yearChip, styles.clusterBirthYearChip, selected ? styles.yearChipActive : null]}
                    onPress={() => {
                      setShowClusterBirthYearPicker(false);
                      handleApplyClusterBirthYear(String(year));
                    }}
                    disabled={savingClusterBirthYear}
                  >
                    <Text style={[styles.yearChipText, selected ? styles.yearChipTextActive : null]}>{year}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={styles.clusterBirthYearClearLink}
              onPress={() => {
                setShowClusterBirthYearPicker(false);
                handleApplyClusterBirthYear('');
              }}
              disabled={savingClusterBirthYear}
            >
              <Text style={styles.clusterBirthYearClearLinkText}>Rimuovi anno</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showClusterRolePicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowClusterRolePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.clusterRolePickerBackdrop}
            activeOpacity={1}
            onPress={() => setShowClusterRolePicker(false)}
            accessibilityRole="button"
            accessibilityLabel="Chiudi selezione ruolo"
          />
          <View style={styles.clusterRolePickerSheet}>
            <View style={styles.clusterRolePickerHeader}>
              <Text style={styles.clusterRolePickerTitle}>Ruolo</Text>
              <TouchableOpacity onPress={() => setShowClusterRolePicker(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            <View style={styles.clusterRolePickerGrid}>
              {CLUSTER_ROLE_OPTIONS.map((roleCode) => {
                const selected = clusterRoleDraft === roleCode;
                return (
                  <TouchableOpacity
                    key={roleCode}
                    style={[styles.clusterRoleChip, selected ? styles.clusterRoleChipActive : null]}
                    onPress={() => {
                      setShowClusterRolePicker(false);
                      handleApplyClusterRole(roleCode);
                    }}
                    disabled={savingClusterRole}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.clusterRoleChipCode, selected ? styles.clusterRoleChipCodeActive : null]}>
                      {roleCode}
                    </Text>
                    <Text style={[styles.clusterRoleChipLabel, selected ? styles.clusterRoleChipLabelActive : null]}>
                      {CLUSTER_ROLE_LABEL[roleCode]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      <AppLoadingFullScreenModal
        visible={appLoadingSimulateOpen}
        uri={appLoadingPreview.uri}
        mediaType={appLoadingPreview.type}
        showClose
        onClose={() => setAppLoadingSimulateOpen(false)}
        progress={simulateProgress}
      />

      {toastMsg && (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      )}

      <Modal
        visible={!!selectedUserDetail}
        animationType="slide"
        transparent={true}
        onRequestClose={closeUserDetail}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              styles.userDetailModalContent,
              { paddingBottom: Math.max(insets.bottom, 12) },
            ]}
          >
            <View style={styles.userDetailSheetHeader}>
              <View style={styles.userDetailSheetHandle} />
              <View style={styles.userDetailSheetHeaderRow}>
                <Text style={styles.userDetailSheetTitle}>Scheda utente</Text>
                <TouchableOpacity
                  style={styles.userDetailCloseBtn}
                  onPress={closeUserDetail}
                  hitSlop={8}
                >
                  <Ionicons name="close" size={20} color="#64748b" />
                </TouchableOpacity>
              </View>
            </View>

            {selectedUserDetail ? (
              <ScrollView
                style={styles.userDetailScroll}
                contentContainerStyle={styles.userDetailScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* Hero */}
                <View style={styles.userDetailHero}>
                  <View style={styles.userDetailHeroAvatar}>
                    <Text style={styles.userDetailHeroAvatarText}>
                      {String(selectedUserDetail.username || '?').trim().charAt(0).toUpperCase() || '?'}
                    </Text>
                    <View
                      style={[
                        styles.userDetailHeroDot,
                        selectedUserDetail.is_online && styles.userDetailHeroDotOn,
                      ]}
                    />
                  </View>
                  <Text style={styles.userDetailHeroName} numberOfLines={1}>
                    {selectedUserDetail.username || '—'}
                  </Text>
                  <View style={styles.userDetailHeroMeta}>
                    <View
                      style={[
                        styles.userDetailStatusPill,
                        selectedUserDetail.is_online && styles.userDetailStatusPillOn,
                      ]}
                    >
                      <View
                        style={[
                          styles.userDetailStatusDot,
                          selectedUserDetail.is_online && styles.userDetailStatusDotOn,
                        ]}
                      />
                      <Text
                        style={[
                          styles.userDetailStatusPillText,
                          selectedUserDetail.is_online && styles.userDetailStatusPillTextOn,
                        ]}
                      >
                        {selectedUserDetail.is_online ? 'Online' : 'Offline'}
                      </Text>
                    </View>
                    <View style={styles.userDetailRolePill}>
                      {renderUserRoleIcon(selectedUserDetail.is_superuser, { size: 11, compact: true })}
                      <Text style={styles.userDetailRolePillText} numberOfLines={1}>
                        {roleLabelForUser(selectedUserDetail.is_superuser)}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.userDetailHeroAccess}>
                    Ultimo accesso · {formatDateTime(selectedUserDetail.last_login)}
                  </Text>
                </View>

                {/* Account */}
                <Text style={styles.userDetailSectionTitle}>Account</Text>
                <View style={styles.userDetailCard}>
                  {/* Username row */}
                  <View style={styles.userDetailCardRow}>
                    <View style={styles.userDetailCardIcon}>
                      <Ionicons name="person-outline" size={18} color="#667eea" />
                    </View>
                    <View style={styles.userDetailCardBody}>
                      <Text style={styles.userDetailCardLabel}>Nome utente</Text>
                      {userDetailEditingField === 'username' ? (
                        <>
                          <TextInput
                            style={styles.userDetailInput}
                            value={userDetailDraftUsername}
                            onChangeText={setUserDetailDraftUsername}
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!savingUserDetail}
                          />
                          <View style={styles.userDetailActions}>
                            <TouchableOpacity
                              style={styles.userDetailBtnGhost}
                              onPress={() => {
                                setUserDetailEditingField(null);
                                setUserDetailDraftUsername(String(selectedUserDetail.username || ''));
                              }}
                              disabled={savingUserDetail}
                            >
                              <Text style={styles.userDetailBtnGhostText}>Annulla</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.userDetailBtnPrimary, savingUserDetail && { opacity: 0.6 }]}
                              onPress={saveUserDetailUsername}
                              disabled={savingUserDetail}
                            >
                              {savingUserDetail ? (
                                <ActivityIndicator size="small" color="#fff" />
                              ) : (
                                <Text style={styles.userDetailBtnPrimaryText}>Salva</Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : (
                        <Text style={styles.userDetailCardValue} numberOfLines={1}>
                          {selectedUserDetail.username || '—'}
                        </Text>
                      )}
                    </View>
                    {userDetailEditingField !== 'username' ? (
                      <TouchableOpacity
                        style={styles.userDetailIconBtn}
                        onPress={() => {
                          setUserDetailEditingField('username');
                          setUserDetailDraftUsername(String(selectedUserDetail.username || ''));
                        }}
                        hitSlop={8}
                      >
                        <Ionicons name="pencil" size={16} color="#667eea" />
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  <View style={styles.userDetailCardDivider} />

                  {/* Email row */}
                  <View style={styles.userDetailCardRow}>
                    <View style={styles.userDetailCardIcon}>
                      <Ionicons name="mail-outline" size={18} color="#667eea" />
                    </View>
                    <View style={styles.userDetailCardBody}>
                      <Text style={styles.userDetailCardLabel}>Email</Text>
                      {userDetailEditingField === 'email' ? (
                        <>
                          <TextInput
                            style={styles.userDetailInput}
                            value={userDetailDraftEmail}
                            onChangeText={setUserDetailDraftEmail}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="email-address"
                            editable={!savingUserDetail}
                          />
                          <View style={styles.userDetailActions}>
                            <TouchableOpacity
                              style={styles.userDetailBtnGhost}
                              onPress={() => {
                                setUserDetailEditingField(null);
                                setUserDetailDraftEmail(String(selectedUserDetail.email || ''));
                              }}
                              disabled={savingUserDetail}
                            >
                              <Text style={styles.userDetailBtnGhostText}>Annulla</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.userDetailBtnPrimary, savingUserDetail && { opacity: 0.6 }]}
                              onPress={saveUserDetailEmail}
                              disabled={savingUserDetail}
                            >
                              {savingUserDetail ? (
                                <ActivityIndicator size="small" color="#fff" />
                              ) : (
                                <Text style={styles.userDetailBtnPrimaryText}>Salva</Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : (
                        <Text style={[styles.userDetailCardValue, styles.userDetailEmailValue]} numberOfLines={2}>
                          {selectedUserDetail.email || '—'}
                        </Text>
                      )}
                    </View>
                    {userDetailEditingField !== 'email' ? (
                      <TouchableOpacity
                        style={styles.userDetailIconBtn}
                        onPress={() => {
                          setUserDetailEditingField('email');
                          setUserDetailDraftEmail(String(selectedUserDetail.email || ''));
                        }}
                        hitSlop={8}
                      >
                        <Ionicons name="pencil" size={16} color="#667eea" />
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  <View style={styles.userDetailCardDivider} />

                  {/* Password row */}
                  <View style={styles.userDetailCardRow}>
                    <View style={styles.userDetailCardIcon}>
                      <Ionicons name="lock-closed-outline" size={18} color="#667eea" />
                    </View>
                    <View style={styles.userDetailCardBody}>
                      <Text style={styles.userDetailCardLabel}>Password</Text>
                      {!userDetailPasswordUnlocked ? (
                        <Text style={styles.userDetailCardValue}>••••••••</Text>
                      ) : (
                        <>
                          <View style={styles.userDetailPasswordRow}>
                            <TextInput
                              style={[styles.userDetailInput, { flex: 1, marginBottom: 0 }]}
                              value={userDetailDraftPassword}
                              onChangeText={setUserDetailDraftPassword}
                              placeholder="Nuova password (min. 6)"
                              placeholderTextColor="#94a3b8"
                              autoCapitalize="none"
                              autoCorrect={false}
                              secureTextEntry={!userDetailPasswordVisible}
                              editable={!savingUserDetail}
                            />
                            <TouchableOpacity onPress={toggleUserDetailPasswordVisible} hitSlop={8}>
                              <Ionicons
                                name={userDetailPasswordVisible ? 'eye' : 'eye-off-outline'}
                                size={22}
                                color={userDetailPasswordVisible ? '#667eea' : '#64748b'}
                              />
                            </TouchableOpacity>
                          </View>
                          <View style={styles.userDetailActions}>
                            <TouchableOpacity
                              style={styles.userDetailBtnGhost}
                              onPress={() => {
                                setUserDetailPasswordUnlocked(false);
                                setUserDetailPasswordVisible(false);
                                setUserDetailDraftPassword('');
                                setUserDetailEditingField(null);
                              }}
                              disabled={savingUserDetail}
                            >
                              <Text style={styles.userDetailBtnGhostText}>Annulla</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.userDetailBtnPrimary, savingUserDetail && { opacity: 0.6 }]}
                              onPress={saveUserDetailPassword}
                              disabled={savingUserDetail}
                            >
                              {savingUserDetail ? (
                                <ActivityIndicator size="small" color="#fff" />
                              ) : (
                                <Text style={styles.userDetailBtnPrimaryText}>Salva</Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        </>
                      )}
                    </View>
                    {!userDetailPasswordUnlocked ? (
                      <TouchableOpacity
                        style={styles.userDetailIconBtn}
                        onPress={unlockUserDetailPassword}
                        hitSlop={8}
                      >
                        <Ionicons name="key-outline" size={18} color="#667eea" />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>

                {/* Ruolo */}
                <Text style={styles.userDetailSectionTitle}>Permessi</Text>
                <View style={styles.userDetailCard}>
                  <Text style={styles.userDetailRoleCaption}>
                    Attuale: {roleLabelForUser(selectedUserDetail.is_superuser)}
                  </Text>
                  {renderUserRoleSelector(selectedUserDetail)}
                </View>

                {/* Leghe */}
                <Text style={styles.userDetailSectionTitle}>Leghe</Text>
                <View style={[styles.userDetailCard, { marginBottom: 8 }]}>
                  {loadingUserDetailLeagues ? (
                    <ActivityIndicator size="small" color="#667eea" style={{ paddingVertical: 12 }} />
                  ) : userDetailLeagues.length === 0 ? (
                    <Text style={styles.userDetailCardHint}>
                      Questo utente non è iscritto a nessuna lega.
                    </Text>
                  ) : (
                    <>
                      <View style={styles.userDetailLeagueSearch}>
                        <Ionicons name="search" size={16} color="#94a3b8" />
                        <TextInput
                          style={styles.userDetailLeagueSearchInput}
                          placeholder="Cerca lega o squadra…"
                          placeholderTextColor="#94a3b8"
                          value={userDetailLeagueSearch}
                          onChangeText={setUserDetailLeagueSearch}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        {userDetailLeagueSearch.length > 0 ? (
                          <TouchableOpacity
                            onPress={() => setUserDetailLeagueSearch('')}
                            hitSlop={8}
                          >
                            <Ionicons name="close-circle" size={16} color="#94a3b8" />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                      {filteredUserDetailLeagues.length === 0 ? (
                        <Text style={[styles.userDetailCardHint, { marginBottom: 0 }]}>
                          Nessuna lega o squadra trovata.
                        </Text>
                      ) : (
                        filteredUserDetailLeagues.map((lg, idx) => (
                          <View key={`ud-lg-${lg.league_id}`}>
                            {idx > 0 ? <View style={styles.userDetailCardDivider} /> : null}
                            <View style={styles.userDetailLeagueRow}>
                              <View style={styles.userDetailCardIcon}>
                                <Ionicons
                                  name={lg.is_official ? 'ribbon' : 'trophy-outline'}
                                  size={18}
                                  color="#667eea"
                                />
                              </View>
                              <View style={styles.userDetailCardBody}>
                                <View style={styles.userDetailLeagueTitleRow}>
                                  <Text style={styles.userDetailCardValue} numberOfLines={1}>
                                    {lg.league_name}
                                  </Text>
                                  {lg.reference_year != null ? (
                                    <View style={styles.userDetailLeagueYearChip}>
                                      <Text style={styles.userDetailLeagueYearChipText}>
                                        {lg.reference_year}
                                      </Text>
                                    </View>
                                  ) : null}
                                </View>
                                <Text style={styles.userDetailLeagueTeam} numberOfLines={1}>
                                  Squadra: {lg.team_name || '—'}
                                </Text>
                                {String(lg.member_role) === 'admin' ? (
                                  <Text style={styles.userDetailLeagueRole}>Admin lega</Text>
                                ) : null}
                              </View>
                            </View>
                          </View>
                        ))
                      )}
                    </>
                  )}
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal visible={!!confirmModal} transparent={true} animationType="fade" onRequestClose={() => setConfirmModal(null)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmContent}>
            <View style={styles.confirmIconWrap}>
              <Ionicons
                name={
                  confirmModal?.destructive
                    ? 'warning'
                    : confirmModal?.caution
                      ? 'warning'
                      : 'information-circle'
                }
                size={40}
                color={
                  confirmModal?.destructive
                    ? '#e53935'
                    : confirmModal?.caution
                      ? '#f59e0b'
                      : '#667eea'
                }
              />
            </View>
            <Text style={styles.confirmTitle}>{confirmModal?.title}</Text>
            <Text style={styles.confirmMessage}>{confirmModal?.message}</Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity style={styles.confirmBtnCancel} onPress={() => setConfirmModal(null)}>
                <Text style={styles.confirmBtnCancelText}>Annulla</Text>
              </TouchableOpacity>
              {confirmModal?.secondaryText ? (
                <TouchableOpacity style={styles.confirmBtnSecondary} onPress={() => confirmModal?.onSecondary?.()}>
                  <Text style={styles.confirmBtnSecondaryText}>{confirmModal.secondaryText}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.confirmBtnAction,
                  confirmModal?.destructive && { backgroundColor: '#e53935' },
                  confirmModal?.caution && !confirmModal?.destructive && { backgroundColor: '#f59e0b' },
                ]}
                onPress={() => confirmModal?.onConfirm?.()}
              >
                <Text style={styles.confirmBtnActionText}>{confirmModal?.confirmText || 'Conferma'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  tabContainer: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    maxHeight: 52,
  },
  tabScrollContent: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  tab: {
    minWidth: 108,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    backgroundColor: '#eef2ff',
    borderBottomColor: '#667eea',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#667eea',
    fontWeight: '700',
  },
  tabAppSettingsLabel: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 13,
    maxWidth: 92,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  clusterSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    gap: 8,
  },
  clusterSearchContainer: {
    flex: 1,
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 0,
  },
  clusterFilterBtn: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  clusterFilterBtnActive: {
    borderColor: '#c7d2fe',
    backgroundColor: '#f8f9ff',
  },
  clusterFilterCountBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  clusterFilterCountBadgeActive: {
    backgroundColor: '#667eea',
  },
  clusterFilterCountBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  clusterFilterCountBadgeTextActive: {
    color: '#fff',
  },
  clusterFiltersSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '72%',
  },
  clusterFiltersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  clusterFiltersTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
  },
  clusterFiltersBody: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  clusterFiltersFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8e8e8',
    paddingTop: 4,
    paddingHorizontal: 16,
  },
  clusterFilterHint: {
    fontSize: 13,
    color: '#94a3b8',
    marginBottom: 12,
    lineHeight: 18,
  },
  clusterFilterAccordion: {
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  clusterFilterAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  clusterFilterAccordionHeaderMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  clusterFilterAccordionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  clusterFilterAccordionSummary: {
    fontSize: 12,
    fontWeight: '600',
    color: '#667eea',
  },
  clusterFilterAccordionBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8e8e8',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: '#f8fafc',
  },
  clusterFilterSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
    marginTop: 4,
  },
  clusterFilterChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 0,
  },
  clusterFilterChip: {
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  clusterFilterChipCompact: {
    paddingHorizontal: 10,
    minWidth: 48,
    alignItems: 'center',
  },
  clusterFilterChipActive: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  clusterFilterChipText: {
    fontSize: 14,
    color: '#475569',
  },
  clusterFilterChipTextActive: {
    color: '#4f46e5',
    fontWeight: '600',
  },
  clusterFilterEmpty: {
    fontSize: 13,
    color: '#cbd5e1',
    fontStyle: 'italic',
  },
  clusterFiltersReset: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  clusterFiltersResetText: {
    fontSize: 13,
    color: '#94a3b8',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    padding: 0,
  },
  clearButton: {
    marginLeft: 8,
    padding: 4,
  },
  listContent: {
    padding: 16,
    paddingTop: 0,
    paddingLeft: 0,
    paddingRight: 0,
  },
  columnsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 0,
    paddingRight: 0,
    paddingVertical: 12,
    backgroundColor: '#667eea',
    borderBottomWidth: 1,
    borderBottomColor: '#5a6fd8',
    gap: 8,
  },
  columnHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
    textTransform: 'uppercase',
  },
  sortableColumn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 16,
    paddingRight: 0,
    paddingLeft: 0,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    marginLeft: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    gap: 8,
  },
  userInfoColumn: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  columnWithPadding: {
    paddingLeft: 16,
  },
  columnWithPaddingRight: {
    paddingRight: 12,
  },
  usersSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbe3ef',
  },
  usersSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    gap: 8,
  },
  usersSearchContainerFlex: {
    flex: 1,
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 0,
  },
  usersFilterBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  usersFilterBtnActive: {
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
  },
  usersFilterCountBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  usersFilterCountBadgeActive: {
    backgroundColor: '#667eea',
  },
  usersFilterCountBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  usersFilterCountBadgeTextActive: {
    color: '#fff',
  },
  userFilterMenuRoot: {
    flex: 1,
  },
  userFilterMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  userFilterDropdown: {
    position: 'absolute',
    maxHeight: 420,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
  },
  userFilterDropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8edf5',
    backgroundColor: '#f8fafc',
  },
  userFilterDropdownTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  userFilterPresetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  userFilterPresetChipActive: {
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
  },
  userFilterPresetChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
  },
  userFilterPresetChipTextActive: {
    color: '#4f46e5',
  },
  userFilterDropdownScroll: {
    maxHeight: 372,
  },
  userFilterDropdownScrollContent: {
    paddingVertical: 4,
    paddingBottom: 8,
  },
  userFilterSectionLabel: {
    marginTop: 8,
    marginBottom: 2,
    paddingHorizontal: 12,
    fontSize: 11,
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  userFilterDropdownItem: {
    minHeight: 42,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  userFilterDropdownItemLast: {
    borderBottomWidth: 0,
  },
  userFilterDropdownItemOn: {
    backgroundColor: '#eef2ff',
  },
  userFilterDropdownItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  userFilterDropdownItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    flexShrink: 1,
  },
  userFilterDropdownItemTextOn: {
    color: '#4f46e5',
    fontWeight: '700',
  },
  userFilterDateValue: {
    marginLeft: 'auto',
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
  },
  userFilterDateValueOn: {
    color: '#4f46e5',
  },
  userFilterCheck: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  userFilterCheckOn: {
    borderColor: '#667eea',
    backgroundColor: '#667eea',
  },
  userFilterDatePickerWrap: {
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  usersSearchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0f172a',
    paddingVertical: 0,
  },
  usersSortBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  usersSortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  usersSortChipActive: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  usersSortChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  usersSortChipTextActive: {
    color: '#667eea',
  },
  usersListContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    flexGrow: 1,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ececec',
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 10,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  userAvatarText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#667eea',
  },
  userOnlineDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#cbd5e1',
    borderWidth: 2,
    borderColor: '#fff',
  },
  userOnlineDotOn: {
    backgroundColor: '#22c55e',
  },
  userLastAccessSub: {
    marginTop: 2,
    fontSize: 12,
    color: '#64748b',
  },
  usersSkeletonWrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  userRowSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ececec',
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 10,
  },
  userAvatarSkeleton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#eef2f7',
  },
  userSkeletonLines: {
    flex: 1,
    gap: 8,
  },
  userSkeletonBar: {
    height: 11,
    borderRadius: 6,
    backgroundColor: '#eef2f7',
  },
  userSkeletonBarShort: {
    width: '42%',
    height: 9,
  },
  userRoleSkeleton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#eef2f7',
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    flexShrink: 1,
  },
  userDetailModalContent: {
    maxHeight: '90%',
    backgroundColor: '#f5f5f5',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    paddingBottom: 0,
    flex: 0,
    flexGrow: 0,
  },
  userDetailSheetHeader: {
    backgroundColor: '#fff',
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ececec',
  },
  userDetailSheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#dbe3ef',
    marginBottom: 10,
  },
  userDetailSheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  userDetailSheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  userDetailCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDetailScroll: {
    maxHeight: 520,
  },
  userDetailScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
  },
  userDetailHero: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ececec',
    paddingVertical: 20,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  userDetailHeroAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    position: 'relative',
  },
  userDetailHeroAvatarText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#667eea',
  },
  userDetailHeroDot: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#cbd5e1',
    borderWidth: 3,
    borderColor: '#fff',
  },
  userDetailHeroDotOn: {
    backgroundColor: '#22c55e',
  },
  userDetailHeroName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 10,
  },
  userDetailHeroMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  userDetailStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
  },
  userDetailStatusPillOn: {
    backgroundColor: '#dcfce7',
  },
  userDetailStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#94a3b8',
  },
  userDetailStatusDotOn: {
    backgroundColor: '#16a34a',
  },
  userDetailStatusPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  userDetailStatusPillTextOn: {
    color: '#15803d',
  },
  userDetailRolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
    maxWidth: '80%',
  },
  userDetailRolePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4338ca',
    flexShrink: 1,
  },
  userDetailHeroAccess: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  userDetailSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
    marginLeft: 2,
  },
  userDetailCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ececec',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  userDetailCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
  },
  userDetailCardIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  userDetailCardBody: {
    flex: 1,
    minWidth: 0,
  },
  userDetailCardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  userDetailCardValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  userDetailEmailValue: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  userDetailCardHint: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 8,
    lineHeight: 17,
  },
  userDetailCardDivider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginVertical: 6,
    marginLeft: 44,
  },
  userDetailLeagueSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  userDetailLeagueSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
    paddingVertical: 0,
  },
  userDetailLeagueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
  },
  userDetailLeagueTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userDetailLeagueYearChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
  },
  userDetailLeagueYearChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#667eea',
  },
  userDetailLeagueTeam: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: '500',
    color: '#64748b',
  },
  userDetailLeagueRole: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '700',
    color: '#a16207',
  },
  userDetailIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  userDetailField: {
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  userDetailFieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  userDetailLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  userDetailEditLink: {
    fontSize: 13,
    fontWeight: '700',
    color: '#667eea',
  },
  userDetailValue: {
    fontSize: 16,
    color: '#0f172a',
    fontWeight: '600',
  },
  userDetailInput: {
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    marginTop: 6,
    marginBottom: 10,
  },
  userDetailActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 2,
  },
  userDetailBtnGhost: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  userDetailBtnGhostText: {
    color: '#475569',
    fontWeight: '700',
    fontSize: 13,
  },
  userDetailBtnPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#667eea',
    minWidth: 88,
    alignItems: 'center',
  },
  userDetailBtnPrimaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  userDetailStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userDetailPasswordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  userDetailPasswordHint: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 8,
    marginTop: 4,
    lineHeight: 17,
  },
  userRoleBadgeCompact: {
    width: 18,
    height: 18,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  superuserBadge: {
    minWidth: 28,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  superuserBadgeSuper: {
    backgroundColor: '#ffc107',
  },
  superuserBadgeManager: {
    backgroundColor: '#2e7d32',
  },
  superuserBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  lastAccessColumn: {
    flex: 0.9,
    minWidth: 75,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  lastAccessText: {
    fontSize: 10,
    color: '#666',
  },
  statusColumn: {
    flex: 0.65,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 50,
  },
  buttonColumn: {
    flex: 0,
    width: 36,
    minWidth: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonColumnHeader: {
    flex: 0,
    width: 68,
    minWidth: 68,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f3f5',
    borderRadius: 8,
    padding: 2,
    width: '100%',
  },
  roleSelectorInDetail: {
    marginTop: 4,
    borderRadius: 12,
    padding: 4,
    backgroundColor: '#f8fafc',
  },
  roleOption: {
    flex: 1,
    minHeight: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  roleOptionInDetail: {
    minHeight: 40,
    borderRadius: 10,
  },
  userRoleBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDetailRoleCaption: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 2,
  },
  roleOptionActiveUser: {
    backgroundColor: '#2f6fed',
  },
  roleOptionActiveSuper: {
    backgroundColor: '#f4b400',
  },
  roleOptionActiveManager: {
    backgroundColor: '#2e7d32',
  },
  roleOptionText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#495057',
  },
  roleOptionTextActive: {
    color: '#fff',
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ccc',
    marginBottom: 4,
  },
  statusIndicatorOnline: {
    backgroundColor: '#28a745',
  },
  userStatus: {
    fontSize: 10,
    color: '#666',
    fontWeight: '500',
  },
  toggleSuperuserButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 13,
    paddingVertical: 13,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#667eea',
    minWidth: 42,
    minHeight: 42,
    overflow: 'hidden',
  },
  toggleSuperuserButtonActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  toggleSuperuserText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#667eea',
  },
  toggleSuperuserTextActive: {
    color: '#fff',
  },
  leagueRow: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ececec',
  },
  leagueRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  leagueAvatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leagueAvatarOfficial: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  leagueRowMain: {
    flex: 1,
    minWidth: 0,
  },
  leagueNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  leagueName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  officialCheckbox: {
    padding: 2,
  },
  leagueOfficialGroup: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: '#667eea',
  },
  leagueMeta: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '500',
    color: '#64748b',
  },
  leagueChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  leagueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  leagueChipMuted: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  leagueChipLinkOn: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  leagueChipWarn: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
  },
  leagueChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  leagueChipTextOn: {
    color: '#4f46e5',
  },
  leagueChipTextWarn: {
    color: '#c2410c',
  },
  leagueActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  leagueActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#f8f9ff',
    gap: 4,
    flex: 1,
    justifyContent: 'center',
  },
  leagueActionButtonAdmin: {
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
  },
  leagueActionButtonDanger: {
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  leagueActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#667eea',
  },
  leagueActionTextAdmin: {
    color: '#15803d',
  },
  leagueActionTextDanger: {
    color: '#dc2626',
  },
  leaguesSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    gap: 8,
  },
  leaguesFilterHintRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  leaguesFilterHintChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  leaguesFilterClearChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  leaguesFilterHintText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4f46e5',
  },
  leagueMembersFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 4,
  },
  leagueMembersFilterField: {
    flex: 1,
  },
  leagueMembersFilterLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  leagueMembersFilterInput: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  leagueMembersFilterSep: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '700',
    color: '#94a3b8',
  },
  leaguesListContent: {
    paddingTop: 4,
    paddingBottom: 24,
    flexGrow: 1,
  },
  leaguesSkeletonWrap: {
    paddingTop: 4,
  },
  leagueRowSkeleton: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ececec',
    backgroundColor: '#fff',
    flexDirection: 'row',
    gap: 12,
  },
  leagueIconSkeleton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#eef2ff',
  },
  leagueSkeletonLines: {
    flex: 1,
    justifyContent: 'center',
    gap: 6,
  },
  errorsPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  errorsPlaceholderText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
    marginBottom: 8,
  },
  errorsPlaceholderSubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 16,
  },
  playerClusterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  playerClusterInfo: {
    flex: 1,
  },
  playerClusterNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  playerClusterName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  playerClusterSingleBadge: {
    backgroundColor: '#eef2ff',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  playerClusterSingleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#667eea',
  },
  playerClusterLeaguesCount: {
    fontSize: 13,
    color: '#666',
  },
  modalHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addPlayerButton: {
    padding: 4,
  },
  availablePlayerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  availablePlayerInfo: {
    flex: 1,
  },
  availablePlayerName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  availablePlayerLeague: {
    fontSize: 13,
    color: '#666',
  },
  addToClusterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#e8f5e9',
    gap: 6,
  },
  addToClusterButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4CAF50',
  },
  filterContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterButtonActive: {
    // Stile attivo
  },
  filterText: {
    fontSize: 14,
    color: '#666',
  },
  filterTextActive: {
    color: '#667eea',
    fontWeight: '600',
  },
  officialGroupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  officialGroupInfo: {
    flex: 1,
  },
  officialGroupName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  officialGroupDescription: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  officialGroupStats: {
    fontSize: 12,
    color: '#999',
  },
  officialsTabBody: {
    flex: 1,
  },
  officialsList: {
    flex: 1,
  },
  liveBonusRepairBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#4338ca',
    gap: 12,
  },
  liveBonusRepairBtnIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveBonusRepairBtnTextWrap: {
    flex: 1,
  },
  liveBonusRepairBtnTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  liveBonusRepairBtnSub: {
    color: '#c7d2fe',
    fontSize: 12,
    marginTop: 2,
  },
  clusterYearGapsBtn: {
    backgroundColor: '#0369a1',
    marginBottom: 8,
  },
  clusterYearGapsBtnIcon: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  yearGapsClusterCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 10,
  },
  yearGapsClusterName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  yearGapsPresentLine: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
  },
  yearGapsMissingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  yearGapsMissingChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  yearGapsMissingChipActive: {
    backgroundColor: '#b91c1c',
    borderColor: '#991b1b',
  },
  yearGapsMissingChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#991b1b',
  },
  yearGapsMissingChipTextActive: {
    color: '#fff',
  },
  yearGapsFillPanel: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  yearGapsFillTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  yearGapsFillHint: {
    marginTop: 2,
    marginBottom: 8,
    fontSize: 12,
    color: '#64748b',
  },
  yearGapsExistingBlock: {
    marginBottom: 8,
  },
  yearGapsExistingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    marginBottom: 6,
  },
  yearGapsExistingBtnText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#1d4ed8',
  },
  yearGapsRoleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  yearGapsRoleChip: {
    width: 40,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e2e8f0',
  },
  yearGapsRoleChipActive: {
    backgroundColor: '#334155',
  },
  yearGapsRoleChipText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#475569',
  },
  yearGapsRoleChipTextActive: {
    color: '#fff',
  },
  yearGapsTeamChips: {
    gap: 8,
    paddingBottom: 4,
    marginBottom: 12,
  },
  yearGapsTeamChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    maxWidth: 200,
  },
  yearGapsTeamChipSuggested: {
    borderColor: '#38bdf8',
    backgroundColor: '#f0f9ff',
  },
  yearGapsTeamChipActive: {
    borderColor: '#0369a1',
    backgroundColor: '#0369a1',
  },
  yearGapsTeamChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  yearGapsTeamChipTextActive: {
    color: '#fff',
  },
  yearGapsCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0369a1',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  yearGapsCreateBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  discrepancySectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
    marginTop: 4,
  },
  discrepancyModalContent: {
    maxHeight: '94%',
    paddingBottom: 0,
  },
  discrepancyModalBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  discrepancyInfoIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  discrepancyInfoIconBtnActive: {
    backgroundColor: '#e0e7ff',
  },
  discrepancyInfoBanner: {
    backgroundColor: '#eef2ff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  discrepancyInfoBannerText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#4338ca',
  },
  discrepancyListContent: {
    paddingBottom: 4,
    flexGrow: 1,
  },
  discrepancyScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#667eea',
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  discrepancyScanBtnDisabled: {
    opacity: 0.55,
  },
  discrepancyScanBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  discrepancySummaryBar: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  discrepancySummaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  discrepancySummarySub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  discrepancyModeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  discrepancyModeChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  discrepancyModeChipActive: {
    backgroundColor: '#e0e7ff',
  },
  discrepancyModeChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  discrepancyModeChipTextActive: {
    color: '#4338ca',
  },
  discrepancyCard: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  discrepancyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
  },
  discrepancyCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    flexShrink: 1,
  },
  discrepancyCardMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 3,
  },
  discrepancyPlayerBlock: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
  },
  discrepancyPlayerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  discrepancyPlayerName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
    flexShrink: 1,
  },
  discrepancyPlayerMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
    marginBottom: 6,
  },
  discrepancyClusterBadge: {
    backgroundColor: '#ede9fe',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  discrepancyClusterBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6d28d9',
  },
  discrepancyDiffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 8,
  },
  discrepancyDiffLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  discrepancyDiffValues: {
    fontSize: 12,
    fontWeight: '700',
    color: '#b45309',
    flexShrink: 1,
    textAlign: 'right',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 100,
    flex: 1,
    position: 'relative',
    overflow: 'visible',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  modalTitleSub: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    paddingHorizontal: 16,
    paddingTop: 8,
    marginBottom: 16,
  },
  modalScrollView: {
    flex: 1,
    maxHeight: 600,
  },
  modalInputContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#fff',
  },
  modalTextArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 8,
    marginHorizontal: 16,
    marginTop: 8,
    gap: 8,
  },
  modalButtonPrimary: {
    backgroundColor: '#667eea',
  },
  modalButtonSecondary: {
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#667eea',
  },
  modalButtonDanger: {
    backgroundColor: '#dc3545',
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  groupOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  groupOptionInfo: {
    flex: 1,
  },
  groupOptionName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  groupOptionDescription: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  groupOptionStats: {
    fontSize: 12,
    color: '#999',
  },
  createGroupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#f0f4ff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    gap: 8,
  },
  createGroupButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#667eea',
  },
  groupDetailDescription: {
    fontSize: 14,
    color: '#666',
    paddingHorizontal: 16,
    marginBottom: 16,
    lineHeight: 20,
  },
  groupDetailModalHeader: {
    borderBottomWidth: 0,
    paddingBottom: 8,
    paddingTop: 14,
  },
  groupDetailHeaderIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e8ecf1',
  },
  groupDetailHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  groupDetailHeaderIconBtnActive: {
    backgroundColor: '#eef1ff',
    borderColor: '#c7d2fe',
  },
  neverPlayedIntro: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f5f7ff',
    borderWidth: 1,
    borderColor: '#e0e7ff',
  },
  neverPlayedIntroIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  neverPlayedIntroText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#475569',
    fontWeight: '500',
  },
  neverPlayedYearFilters: {
    flexGrow: 0,
    marginBottom: 8,
  },
  neverPlayedYearFiltersContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  neverPlayedYearChipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  neverPlayedYearChipBtnActive: {
    backgroundColor: '#eef2ff',
    borderColor: '#a5b4fc',
  },
  neverPlayedYearChipBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  neverPlayedYearChipBtnTextActive: {
    color: '#4338ca',
  },
  neverPlayedCountBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  neverPlayedCountText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  neverPlayedRefreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e8ecf1',
  },
  neverPlayedEmpty: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 40,
    gap: 8,
  },
  neverPlayedEmptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
    marginTop: 4,
  },
  neverPlayedEmptySub: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
  },
  neverPlayedLeagueBlock: {
    marginBottom: 14,
  },
  neverPlayedLeagueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 8,
    marginTop: 4,
  },
  neverPlayedLeagueTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    color: '#1e293b',
    letterSpacing: 0.2,
  },
  neverPlayedYearChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  neverPlayedYearChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4f46e5',
  },
  neverPlayedLeagueCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    minWidth: 18,
    textAlign: 'right',
  },
  neverPlayedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8ecf1',
  },
  neverPlayedRowLocked: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  neverPlayedRoleBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  neverPlayedRoleBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  neverPlayedInfo: {
    flex: 1,
    minWidth: 0,
  },
  neverPlayedName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  neverPlayedMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  neverPlayedLockHint: {
    fontSize: 11,
    fontWeight: '600',
    color: '#b45309',
    marginTop: 3,
  },
  neverPlayedDeleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  neverPlayedDeleteBtnLocked: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  groupDetailModalHeaderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  groupProfileHero: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
    backgroundColor: '#fff',
  },
  groupLogoHeroContainer: {
    marginBottom: 14,
    alignItems: 'center',
  },
  groupLogoHeroWrapper: {
    position: 'relative',
  },
  groupLogoHeroCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  groupLogoHeroImage: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 3,
    borderColor: '#667eea',
    backgroundColor: '#f1f5f9',
  },
  groupLogoEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  groupProfileName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1e293b',
    textAlign: 'center',
  },
  groupProfileDescription: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  groupDetailSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  groupLeagueItem: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e8ecf1',
    overflow: 'hidden',
  },
  groupLeagueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  groupLeagueHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  groupLeagueExpandedBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
  },
  clusterLeagueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 10,
    backgroundColor: '#f9f9f9',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
  },
  clusterLeagueColLeague: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  clusterLeagueColTeam: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
    paddingLeft: 4,
    borderLeftWidth: 1,
    borderLeftColor: '#e8e8e8',
  },
  clusterLeagueTeamName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  clusterLeagueRoleText: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  clusterMetaWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
    paddingBottom: 10,
  },
  clusterMetaBar: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 16,
  },
  clusterMetaField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  clusterMetaLabel: {
    fontSize: 13,
    color: '#94a3b8',
    minWidth: 42,
    flexShrink: 0,
  },
  clusterMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    minWidth: 64,
    minHeight: 30,
    justifyContent: 'center',
  },
  clusterMetaValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
    fontVariant: ['tabular-nums'],
  },
  clusterMetaValueEmpty: {
    fontWeight: '400',
    color: '#cbd5e1',
  },
  clusterMetaPillPending: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    backgroundColor: '#fff',
  },
  clusterMetaPendingHint: {
    fontSize: 12,
    color: '#94a3b8',
    paddingHorizontal: 16,
    marginTop: 6,
  },
  clusterBirthYearBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
    gap: 10,
  },
  clusterBirthYearLabel: {
    fontSize: 13,
    color: '#94a3b8',
    width: 36,
  },
  clusterBirthYearPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    minWidth: 64,
    minHeight: 30,
    justifyContent: 'center',
  },
  clusterBirthYearValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
    fontVariant: ['tabular-nums'],
  },
  clusterBirthYearValueEmpty: {
    fontWeight: '400',
    color: '#cbd5e1',
  },
  clusterBirthYearPillPending: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    backgroundColor: '#fff',
  },
  clusterBirthYearPendingHint: {
    fontSize: 12,
    color: '#94a3b8',
    flex: 1,
  },
  clusterBirthYearPickerModal: {
    paddingBottom: 12,
  },
  clusterBirthYearPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  clusterBirthYearPickerTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
  },
  clusterBirthYearChip: {
    minWidth: 56,
    paddingHorizontal: 10,
  },
  clusterBirthYearClearLink: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  clusterBirthYearClearLinkText: {
    fontSize: 13,
    color: '#94a3b8',
  },
  clusterRolePickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  clusterRolePickerSheet: {
    width: '100%',
    maxHeight: '50%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 16,
  },
  clusterRolePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  clusterRolePickerTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
  },
  clusterRolePickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
    justifyContent: 'center',
  },
  clusterRoleChip: {
    width: '47%',
    minWidth: 140,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 2,
  },
  clusterRoleChipActive: {
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
  },
  clusterRoleChipCode: {
    fontSize: 18,
    fontWeight: '800',
    color: '#334155',
  },
  clusterRoleChipCodeActive: {
    color: '#4f46e5',
  },
  clusterRoleChipLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
  },
  clusterRoleChipLabelActive: {
    color: '#4f46e5',
  },
  clusterLeagueRemoveBtn: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupLeagueName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
  },
  groupLeagueSummary: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  groupLeagueDetails: {
    fontSize: 13,
    color: '#666',
  },
  groupLeagueReferenceYearRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  groupLeagueReferenceYearPickerBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d6dcff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#f7f8ff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  groupLeagueReferenceYearPickerBtnText: {
    fontSize: 14,
    color: '#333',
  },
  groupLeagueReferenceYearClearBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  yearPickerModalContent: {
    width: '100%',
    height: '100%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  yearPickerScroll: {
    flex: 1,
  },
  yearPickerModalSubtitle: {
    fontSize: 14,
    color: '#666',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  yearPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  yearChip: {
    width: '31%',
    borderWidth: 1,
    borderColor: '#d9d9d9',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fafafa',
  },
  yearChipActive: {
    borderColor: '#667eea',
    backgroundColor: '#eef1ff',
  },
  yearChipText: {
    fontSize: 14,
    color: '#444',
    fontWeight: '600',
  },
  yearChipTextActive: {
    color: '#3e57d0',
  },
  yearPickerActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
  },
  yearPickerActionButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginHorizontal: 0,
    marginTop: 0,
    borderRadius: 10,
  },
  yearPickerActionButtonText: {
    fontSize: 16,
  },
  groupDetailEmpty: {
    fontSize: 14,
    color: '#999',
    paddingHorizontal: 16,
    paddingVertical: 20,
    textAlign: 'center',
  },
  groupDetailActions: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  // Cluster styles
  clusterFilters: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    gap: 8,
  },
  clusterModalSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
  },
  clusterFilterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  clusterFilterButtonActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  clusterFilterText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  clusterFilterTextActive: {
    color: '#fff',
  },
  clusterSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
  },
  suggestionRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e8ecf1',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  suggestionInfo: {
    flex: 1,
    minWidth: 0,
  },
  suggestionPlayerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#222',
  },
  suggestionLeagueLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  suggestionRoleWarning: {
    fontSize: 11,
    color: '#e6a800',
    fontWeight: '600',
    marginTop: 2,
  },
  suggestionBirthYearRef: {
    fontSize: 11,
    color: '#667eea',
    fontWeight: '600',
    marginTop: 2,
  },
  suggestionBirthYearWarning: {
    fontSize: 11,
    color: '#b45309',
    fontWeight: '600',
    marginTop: 2,
  },
  suggestionActionsCol: {
    flexShrink: 0,
    alignItems: 'flex-end',
    gap: 6,
    paddingTop: 1,
  },
  suggestionActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  suggestionNew: {
    width: 36,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ecfdf5',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  suggestionNewText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.6,
  },
  suggestionEdit: {
    width: 36,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#eef2ff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dbe4ff',
  },
  suggestionApprove: {
    width: 36,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e8f5e9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  suggestionDismiss: {
    width: 36,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fce4ec',
    justifyContent: 'center',
    alignItems: 'center',
  },
  suggestionEditModalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '78%',
    minHeight: 320,
  },
  suggestionEditHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
    gap: 12,
  },
  suggestionEditHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  suggestionEditTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1e293b',
  },
  suggestionEditSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#667eea',
    marginTop: 4,
  },
  suggestionEditHint: {
    fontSize: 12,
    color: '#64748b',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 8,
  },
  suggestionEditList: {
    flexGrow: 0,
    maxHeight: 360,
  },
  suggestionEditListContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  suggestionEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e8ecf1',
    gap: 12,
  },
  suggestionEditRowLocked: {
    backgroundColor: '#f1f5f9',
    borderColor: '#dbe4ff',
  },
  suggestionEditRowInfo: {
    flex: 1,
    minWidth: 0,
  },
  suggestionEditLeague: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  suggestionEditMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 3,
  },
  suggestionEditInCluster: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4f46e5',
    marginTop: 4,
  },
  suggestionEditFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
  },
  suggestionEditFooterBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  suggestionEditFooterBtnCancel: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  suggestionEditFooterBtnCancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#475569',
  },
  suggestionEditFooterBtnSave: {
    backgroundColor: '#667eea',
  },
  suggestionEditFooterBtnSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  clusterItem: {
    padding: 16,
    backgroundColor: '#f9f9f9',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  clusterInfo: {
    flex: 1,
  },
  clusterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  clusterStatus: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  clusterPlayersCount: {
    fontSize: 12,
    color: '#999',
  },
  clusterPlayer: {
    paddingVertical: 4,
  },
  clusterPlayerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  clusterPlayerLeague: {
    fontSize: 12,
    color: '#666',
  },
  clusterActions: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: 8,
  },
  clusterActionButton: {
    padding: 4,
  },
  clusterEmptyText: {
    fontSize: 14,
    color: '#999',
    paddingHorizontal: 16,
    paddingVertical: 20,
    textAlign: 'center',
  },
  searchPlayerItem: {
    padding: 16,
    backgroundColor: '#f9f9f9',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  searchPlayerItemSelected: {
    backgroundColor: '#e8f5e9',
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  searchPlayerInfo: {
    flex: 1,
  },
  searchPlayerName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  searchPlayerDetails: {
    fontSize: 12,
    color: '#666',
  },
  selectedPlayerItem: {
    padding: 12,
    backgroundColor: '#e8f5e9',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
  },
  selectedPlayerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  selectedPlayerDetails: {
    fontSize: 12,
    color: '#666',
  },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#667eea',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    zIndex: 1000,
  },
  toast: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 999,
  },
  toastError: { backgroundColor: '#e53935' },
  toastSuccess: { backgroundColor: '#2e7d32' },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    alignItems: 'center',
  },
  confirmIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff5f5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  confirmTitle: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8, textAlign: 'center' },
  confirmMessage: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  confirmButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, width: '100%' },
  confirmBtnCancel: { flexGrow: 1, flexBasis: '30%', minWidth: 100, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#f0f0f0' },
  confirmBtnCancelText: { color: '#333', fontSize: 14, fontWeight: '600' },
  confirmBtnSecondary: { flexGrow: 1, flexBasis: '30%', minWidth: 100, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#667eea' },
  confirmBtnSecondaryText: { color: '#667eea', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  confirmBtnAction: { flexGrow: 1, flexBasis: '30%', minWidth: 100, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#667eea' },
  confirmBtnActionText: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  appSettingsRoot: {
    flex: 1,
    backgroundColor: '#f4f5fa',
  },
  appSettingsScroll: {
    padding: 16,
    paddingBottom: 32,
  },
  appSettingsTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  appSettingsHint: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 20,
  },
  appSettingsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e8e8ee',
  },
  appSettingsSectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  loginLogoPreviewBox: {
    backgroundColor: 'transparent',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginLogoPreviewImg: {
    width: 180,
    height: 120,
  },
  appSettingsBody: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
    marginBottom: 12,
  },
  appSettingsProportionsBox: {
    backgroundColor: '#f0f1f7',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e4ef',
  },
  appSettingsProportionsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
  },
  appSettingsProportionsLine: {
    fontSize: 13,
    color: '#444',
    lineHeight: 20,
    marginTop: 4,
  },
  appSettingsOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#667eea',
    marginTop: 16,
    marginBottom: 4,
    backgroundColor: '#f8f9ff',
  },
  appSettingsOutlineBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#667eea',
  },
  appSettingsPreviewTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
    marginTop: 18,
    marginBottom: 10,
  },
  appLoadingPreviewStage: {
    width: '100%',
    maxHeight: 440,
    aspectRatio: 9 / 16,
    alignSelf: 'center',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: '#2a2a2a',
  },
  matchBackgroundPreviewStage: {
    width: '100%',
    aspectRatio: 2.2,
    alignSelf: 'center',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    justifyContent: 'center',
  },
  matchBackgroundPreviewScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
  },
  matchBackgroundPreviewMock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    zIndex: 1,
  },
  matchBackgroundPreviewTeam: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  matchBackgroundPreviewScore: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  appLoadingPreviewUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  appLoadingPreviewUploadText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  appSettingsFileName: {
    fontSize: 13,
    color: '#555',
    marginTop: 10,
    marginBottom: 4,
  },
  appSettingsPreviewFoot: {
    fontSize: 13,
    color: '#666',
    lineHeight: 19,
    marginTop: 6,
    marginBottom: 4,
  },
  appSettingsMuted: {
    fontSize: 14,
    color: '#999',
    marginBottom: 16,
    fontStyle: 'italic',
  },
  appSettingsPrimaryBtn: {
    backgroundColor: '#667eea',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  appSettingsPrimaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  appSettingsBtnDisabled: {
    opacity: 0.7,
  },
  appSettingsSecondaryBtn: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  appSettingsSecondaryBtnText: {
    color: '#667eea',
    fontSize: 15,
    fontWeight: '600',
  },
});


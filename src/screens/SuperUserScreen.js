import React, { useState, useEffect, useMemo } from 'react';
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
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
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
  const [searchText, setSearchText] = useState('');
  const [filterOfficialOnly, setFilterOfficialOnly] = useState(false);
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
  const [clusterFilterStatus, setClusterFilterStatus] = useState(null); // null, 'pending', 'approved', 'rejected'
  const [clusterTabSearchText, setClusterTabSearchText] = useState('');
  const [showClusterFilters, setShowClusterFilters] = useState(false);
  const [clusterFilters, setClusterFilters] = useState({
    groupId: null,
    leagueYears: [],
    birthYears: [],
    multiRoleOnly: false,
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
  
  // Carica utenti
  const loadUsers = async () => {
    if (!isSuperuser) return;
    try {
      setLoadingUsers(true);
      const response = await superuserService.getUsers();
      setUsers(response.data || []);
    } catch (error) {
      console.error('Error loading users:', error);
      showToast('Impossibile caricare gli utenti');
    } finally {
      setLoadingUsers(false);
      setRefreshingUsers(false);
    }
  };
  
  // Carica leghe
  const loadLeagues = async () => {
    if (!isSuperuser) return;
    try {
      setLoadingLeagues(true);
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

  // Carica tutti i cluster approvati raggruppati per giocatore
  const loadApprovedClustersByPlayer = async () => {
    if (!isSuperuser) return;
    try {
      setLoadingApprovedClusters(true);
      const allClusters = await fetchAllApprovedClusters();
      setApprovedClustersByPlayer(buildApprovedClustersList(allClusters));
    } catch (error) {
      if (isFeatureDisabledError(error)) {
        setApprovedClustersByPlayer([]);
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

  const handleApplyClusterBirthYear = async (yearOverride) => {
    if (!selectedPlayerCluster?.cluster_id) return;
    const clusterId = selectedPlayerCluster.cluster_id;
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
      await superuserService.setClusterBirthYear(clusterId, yearStr || null);
      await refreshSelectedPlayerClusterAfterChange(clusterId);
    } catch (error) {
      console.error('Error setting cluster birth year:', error);
      showToast(error.response?.data?.message || 'Errore aggiornamento anno');
    } finally {
      setSavingClusterBirthYear(false);
    }
  };

  const handleApplyClusterRole = async (roleOverride) => {
    if (!selectedPlayerCluster?.cluster_id) return;
    const clusterId = selectedPlayerCluster.cluster_id;
    const leagues = selectedPlayerCluster.leagues || [];
    const roleCode = normalizeClusterRoleCode(
      roleOverride !== undefined ? roleOverride : clusterRoleDraft,
    );
    if (!roleCode) return;
    if (getClusterUniformRole(leagues) === roleCode) return;

    if (roleOverride !== undefined) setClusterRoleDraft(roleCode);
    setSavingClusterRole(true);
    try {
      await superuserService.setClusterRole(clusterId, roleCode);
      showToast(`Ruolo ${roleCode} applicato a tutto il cluster`, 'success');
      await refreshSelectedPlayerClusterAfterChange(clusterId);
    } catch (error) {
      console.error('Error setting cluster role:', error);
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
        loadUsers();
      } else if (activeTab === 'leagues') {
        loadLeagues();
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
      destructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await superuserService.setSuperuserLevel(userId, nextLevel);
          await loadUsers();
          showToast(`Ruolo aggiornato: ${labels[nextLevel] || 'nessun ruolo'}`, 'success');
        } catch (error) {
          console.error('Error updating superuser level:', error);
          showToast(error.response?.data?.message || 'Errore durante l\'operazione');
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
          await loadLeagues();
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
            await superuserService.setLeagueOfficial(league.id, { is_official: false });
            await loadLeagues();
            await loadOfficialGroups();
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
    
    try {
      await superuserService.setLeagueOfficial(selectedLeagueForOfficial.id, {
        is_official: true,
        official_group_id: groupId,
      });
      setShowOfficialGroupModal(false);
      setSelectedLeagueForOfficial(null);
      await loadLeagues();
      await loadOfficialGroups();
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
      await loadOfficialGroups();
      // Se c'era una lega selezionata, assegnala al nuovo gruppo
      if (selectedLeagueForOfficial && response.data?.id) {
        await handleSelectGroupForLeague(response.data.id);
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
      await superuserService.toggleVisibleForLinking(league.id);
      await loadLeagues();
    } catch (error) {
      console.error('Error toggling visible for linking:', error);
      showToast(error.response?.data?.message || 'Errore durante l\'operazione');
    }
  };

  const handleToggleHiddenFromDiscovery = async (league) => {
    try {
      await superuserService.toggleLeagueHiddenFromDiscovery(league.id);
      await loadLeagues();
    } catch (error) {
      console.error('Error toggling hidden from discovery:', error);
      showToast(error.response?.data?.message || 'Errore durante l\'operazione');
    }
  };
  
  // Filtra le leghe (ufficiali o tutte)
  const filteredLeagues = useMemo(() => {
    const list = Array.isArray(leagues) ? leagues : [];
    if (!filterOfficialOnly) return list;
    return list.filter((league) => league.is_official);
  }, [leagues, filterOfficialOnly]);
  
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
      // Nuova colonna, ordine crescente di default
      setSortColumn(column);
      setSortDirection('asc');
    }
  };
  
  // Ordina e filtra gli utenti
  const sortedUsers = useMemo(() => {
    let filtered = users;
    
    // Filtra per nome utente e/o email
    if (searchText.trim()) {
      const searchLower = searchText.toLowerCase().trim();
      filtered = users.filter(user => {
        const usernameMatch = (user.username || '').toLowerCase().includes(searchLower);
        const emailMatch = (user.email || '').toLowerCase().includes(searchLower);
        return usernameMatch || emailMatch;
      });
    }
    
    // Ordina
    if (!sortColumn) return filtered;
    
    const sorted = [...filtered].sort((a, b) => {
      let aVal, bVal;
      
      switch (sortColumn) {
        case 'username':
          aVal = (a.username || '').toLowerCase();
          bVal = (b.username || '').toLowerCase();
          break;
        case 'last_login':
          aVal = a.last_login ? new Date(a.last_login).getTime() : 0;
          bVal = b.last_login ? new Date(b.last_login).getTime() : 0;
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
      return 0;
    });
    
    return sorted;
  }, [users, sortColumn, sortDirection, searchText]);

  const filteredApprovedClustersByPlayer = useMemo(() => {
    const q = clusterTabSearchText.trim();
    const hasFilters = clusterFilters.groupId != null
      || (clusterFilters.leagueYears || []).length > 0
      || (clusterFilters.birthYears || []).length > 0
      || clusterFilters.multiRoleOnly;
    return approvedClustersByPlayer.filter((item) => {
      if (q && !matchesNameSearch(item.name, q)) return false;
      if (hasFilters && !clusterMatchesFilters(item, clusterFilters)) return false;
      return true;
    });
  }, [approvedClustersByPlayer, clusterTabSearchText, clusterFilters]);

  const clusterFilterOptions = useMemo(() => {
    const groups = new Map();
    const leagueYears = new Set();
    const birthYears = new Set();
    for (const item of approvedClustersByPlayer) {
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
  }, [approvedClustersByPlayer]);

  const hasActiveClusterFilters = clusterFilters.groupId != null
    || (clusterFilters.leagueYears || []).length > 0
    || (clusterFilters.birthYears || []).length > 0
    || clusterFilters.multiRoleOnly;

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
    setClusterFilters({ groupId: null, leagueYears: [], birthYears: [], multiRoleOnly: false });
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
    const isSuper = suLevel > 0;
    const badgeText = suLevel === 2 ? 'GM' : 'SU';
    return (
    <View style={styles.userItem}>
      {/* Colonna 1: Nome utente e email */}
      <View style={[styles.userInfoColumn, styles.columnWithPadding]}>
        <View style={styles.userHeader}>
          <Text style={styles.userName}>{item.username}</Text>
          {isSuper && (
            <View
              style={[
                styles.superuserBadge,
                suLevel === 2 ? styles.superuserBadgeManager : styles.superuserBadgeSuper,
              ]}
            >
              <Text style={styles.superuserBadgeText}>{badgeText}</Text>
            </View>
          )}
        </View>
        <Text style={styles.userEmail} numberOfLines={1} ellipsizeMode="tail">{item.email}</Text>
      </View>
      
      {/* Colonna 2: Ultimo accesso */}
      <View style={styles.lastAccessColumn}>
        <Text style={styles.lastAccessText}>{formatDateTime(item.last_login)}</Text>
      </View>
      
      {/* Colonna 3: Stato */}
      <View style={styles.statusColumn}>
        <View style={[styles.statusIndicator, item.is_online && styles.statusIndicatorOnline]} />
        <Text style={styles.userStatus}>
          {item.is_online ? 'Online' : 'Offline'}
        </Text>
      </View>
      
      {/* Colonna 4: Ruolo utente */}
      <View style={[styles.buttonColumn, styles.columnWithPaddingRight]}>
        <View style={styles.roleSelector}>
          <TouchableOpacity
            style={[
              styles.roleOption,
              suLevel === 0 && styles.roleOptionActiveUser,
            ]}
            onPress={() => handleSetSuperuserLevel(item.id, suLevel, 0)}
          >
            <Ionicons
              name={suLevel === 0 ? 'person' : 'person-outline'}
              size={14}
              color={suLevel === 0 ? '#fff' : '#2f6fed'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.roleOption,
              suLevel === 1 && styles.roleOptionActiveSuper,
            ]}
            onPress={() => handleSetSuperuserLevel(item.id, suLevel, 1)}
          >
            <Ionicons
              name={suLevel === 1 ? 'star' : 'star-outline'}
              size={14}
              color={suLevel === 1 ? '#fff' : '#f4b400'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.roleOption,
              suLevel === 2 && styles.roleOptionActiveManager,
            ]}
            onPress={() => handleSetSuperuserLevel(item.id, suLevel, 2)}
          >
            <Ionicons
              name={suLevel === 2 ? 'football' : 'football-outline'}
              size={14}
              color={suLevel === 2 ? '#fff' : '#2e7d32'}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
  };
  
  const renderLeagueItem = ({ item }) => {
    const isOfficial = Number(item?.is_official || 0) > 0;
    const isHiddenFromDiscovery = Number(item?.is_hidden_from_discovery || 0) === 1;
    return (
    <View style={styles.leagueItem}>
      <View style={styles.leagueInfo}>
        <View style={styles.leagueNameRow}>
          <Text style={styles.leagueName}>{item.name}</Text>
          <TouchableOpacity
            onPress={() => handleToggleLeagueOfficial(item)}
            style={styles.officialCheckbox}
          >
            <Ionicons 
              name={isOfficial ? "checkmark-circle" : "ellipse-outline"} 
              size={24} 
              color={isOfficial ? "#667eea" : "#ccc"} 
            />
          </TouchableOpacity>
        </View>
        {isOfficial && item.official_group_name && (
          <Text style={styles.leagueOfficialGroup}>
            Gruppo: {item.official_group_name}
          </Text>
        )}
        {isOfficial && (
          <TouchableOpacity
            onPress={() => handleToggleVisibleForLinking(item)}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: 8,
              marginBottom: 4,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 8,
              backgroundColor: item.is_visible_for_linking ? '#e8f5e9' : '#f5f5f5',
              borderWidth: 1,
              borderColor: item.is_visible_for_linking ? '#a5d6a7' : '#ddd',
              alignSelf: 'flex-start',
            }}
          >
            <Ionicons 
              name={item.is_visible_for_linking ? "eye" : "eye-off-outline"} 
              size={18} 
              color={item.is_visible_for_linking ? "#2e7d32" : "#888"} 
            />
            <Text style={{ 
              fontSize: 13, 
              fontWeight: '600',
              color: item.is_visible_for_linking ? "#2e7d32" : "#888", 
              marginLeft: 6,
            }}>
              {item.is_visible_for_linking ? 'Visibile per collegamento' : 'Non visibile per collegamento'}
            </Text>
            <Ionicons 
              name={item.is_visible_for_linking ? "toggle" : "toggle-outline"} 
              size={22} 
              color={item.is_visible_for_linking ? "#2e7d32" : "#bbb"} 
              style={{ marginLeft: 8 }}
            />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => handleToggleHiddenFromDiscovery(item)}
          activeOpacity={0.7}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 8,
            marginBottom: 4,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 8,
            backgroundColor: isHiddenFromDiscovery ? '#fff3e0' : '#f5f5f5',
            borderWidth: 1,
            borderColor: isHiddenFromDiscovery ? '#ffcc80' : '#ddd',
            alignSelf: 'flex-start',
          }}
        >
          <Ionicons
            name={isHiddenFromDiscovery ? 'eye-off-outline' : 'eye-outline'}
            size={18}
            color={isHiddenFromDiscovery ? '#e65100' : '#666'}
          />
          <Text style={{
            fontSize: 13,
            fontWeight: '600',
            color: isHiddenFromDiscovery ? '#e65100' : '#555',
            marginLeft: 6,
            flexShrink: 1,
          }}
          >
            {isHiddenFromDiscovery
              ? 'Nascosta: solo chi inscritto la vede'
              : 'Visibile: la vede anche chi non è iscritto'}
          </Text>
          <Ionicons
            name={isHiddenFromDiscovery ? 'toggle' : 'toggle-outline'}
            size={22}
            color={isHiddenFromDiscovery ? '#e65100' : '#bbb'}
            style={{ marginLeft: 8 }}
          />
        </TouchableOpacity>
        <Text style={styles.leagueDetails}>
          {item.member_count} membri • {item.access_code ? 'Privata' : 'Pubblica'}
        </Text>
        <Text style={styles.leagueCreated}>
          Creata: {formatDateTime(item.created_at)}
        </Text>
      </View>
      <View style={styles.leagueActions}>
        <TouchableOpacity
          style={styles.leagueActionButton}
          onPress={() => navigation.navigate('League', { leagueId: item.id })}
        >
          <Ionicons name="eye" size={18} color="#667eea" />
          <Text style={styles.leagueActionText}>Vedi</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.leagueActionButton, styles.leagueActionButtonAdmin]}
          onPress={() => handleJoinLeagueAsAdmin(item.id)}
        >
          <Ionicons name="shield" size={18} color="#28a745" />
          <Text style={[styles.leagueActionText, styles.leagueActionTextAdmin]}>Admin</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.leagueActionButton, styles.leagueActionButtonDanger]}
          onPress={() => handleDeleteLeague(item.id, item.name)}
        >
          <Ionicons name="trash" size={18} color="#dc3545" />
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
            color={activeTab === 'users' ? '#fff' : '#666'} 
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
            color={activeTab === 'leagues' ? '#fff' : '#666'} 
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
            color={activeTab === 'officials' ? '#fff' : '#666'} 
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
            color={activeTab === 'clusters' ? '#fff' : '#666'} 
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
            color={activeTab === 'appSettings' ? '#fff' : '#666'}
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
            {/* Barra di ricerca */}
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Cerca per nome utente o email..."
                placeholderTextColor="#999"
                value={searchText}
                onChangeText={setSearchText}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchText.length > 0 && (
                <TouchableOpacity onPress={() => setSearchText('')} style={styles.clearButton}>
                  <Ionicons name="close-circle" size={20} color="#999" />
                </TouchableOpacity>
              )}
            </View>
            {loadingUsers ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#667eea" />
              </View>
            ) : (
              <>
                {/* Header colonne */}
                <View style={styles.columnsHeader}>
                  <TouchableOpacity 
                    style={[styles.userInfoColumn, styles.columnWithPadding, styles.sortableColumn]}
                    onPress={() => handleSort('username')}
                  >
                    <Text style={styles.columnHeaderText}>Utente</Text>
                    {sortColumn === 'username' && (
                      <Ionicons 
                        name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'} 
                        size={14} 
                        color="#667eea" 
                      />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.lastAccessColumn, styles.sortableColumn]}
                    onPress={() => handleSort('last_login')}
                  >
                    <Text style={styles.columnHeaderText}>Ultimo accesso</Text>
                    {sortColumn === 'last_login' && (
                      <Ionicons 
                        name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'} 
                        size={14} 
                        color="#fff" 
                      />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.statusColumn, styles.sortableColumn]}
                    onPress={() => handleSort('is_online')}
                  >
                    <Text style={styles.columnHeaderText}>Stato</Text>
                    {sortColumn === 'is_online' && (
                      <Ionicons 
                        name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'} 
                        size={14} 
                        color="#fff" 
                      />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.buttonColumnHeader, styles.columnWithPaddingRight, styles.sortableColumn]}
                    onPress={() => handleSort('is_superuser')}
                  >
                    <Text style={styles.columnHeaderText}>Ruolo</Text>
                    {sortColumn === 'is_superuser' && (
                      <Ionicons 
                        name={sortDirection === 'asc' ? 'chevron-up' : 'chevron-down'} 
                        size={14} 
                        color="#fff" 
                      />
                    )}
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={sortedUsers}
                  keyExtractor={(item) => item.id.toString()}
                  renderItem={renderUserItem}
                  refreshControl={
                    <RefreshControl refreshing={refreshingUsers} onRefresh={() => {
                      setRefreshingUsers(true);
                      loadUsers();
                    }} />
                  }
                  ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                      <Ionicons name="people-outline" size={48} color="#ccc" />
                      <Text style={styles.emptyText}>Nessun utente trovato</Text>
                    </View>
                  }
                  contentContainerStyle={styles.listContent}
                />
              </>
            )}
          </>
        )}

        {activeTab === 'leagues' && (
          <>
            {/* Filtro leghe ufficiali */}
            <View style={styles.filterContainer}>
              <TouchableOpacity
                style={[styles.filterButton, filterOfficialOnly && styles.filterButtonActive]}
                onPress={() => setFilterOfficialOnly(!filterOfficialOnly)}
              >
                <Ionicons 
                  name={filterOfficialOnly ? "checkbox" : "square-outline"} 
                  size={20} 
                  color={filterOfficialOnly ? "#667eea" : "#666"} 
                />
                <Text style={[styles.filterText, filterOfficialOnly && styles.filterTextActive]}>
                  Solo Leghe Ufficiali
                </Text>
              </TouchableOpacity>
            </View>
            {loadingLeagues ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#667eea" />
              </View>
            ) : (
              <FlatList
                data={filteredLeagues}
                keyExtractor={(item) => item.id.toString()}
                renderItem={renderLeagueItem}
                refreshControl={
                  <RefreshControl refreshing={refreshingLeagues} onRefresh={() => {
                    setRefreshingLeagues(true);
                    loadLeagues();
                  }} />
                }
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Ionicons name="trophy-outline" size={48} color="#ccc" />
                    <Text style={styles.emptyText}>
                      {filterOfficialOnly ? 'Nessuna lega ufficiale trovata' : 'Nessuna lega trovata'}
                    </Text>
                  </View>
                }
                contentContainerStyle={styles.listContent}
              />
            )}
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
              </TouchableOpacity>
            </View>
            {loadingApprovedClusters ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#667eea" />
              </View>
            ) : (
              <FlatList
                data={filteredApprovedClustersByPlayer}
                keyExtractor={(item) => `cluster-${item.cluster_id}`}
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
                      <Text style={styles.playerClusterName}>
                        {formatClusterListTitle(item.name, item.leagues)}
                      </Text>
                      <Text style={styles.playerClusterLeaguesCount}>
                        {item.players_count}{' '}
                        {item.players_count === 1 ? 'edizione' : 'edizioni'}
                        {item.group_name ? ` · ${item.group_name}` : ''}
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
                        ? 'Nessun cluster trovato'
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
                      loadApprovedClustersByPlayer();
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
                            await loadLeagues();
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
                    {selectedPlayerCluster.players_count ?? selectedPlayerCluster.leagues?.length ?? 0}
                    {' '}
                    {(selectedPlayerCluster.players_count ?? selectedPlayerCluster.leagues?.length ?? 0) === 1
                      ? 'edizione'
                      : 'edizioni'}
                    {selectedPlayerCluster.group_name ? ` · ${selectedPlayerCluster.group_name}` : ''}
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
                      missingBirthYearCount > 0 && clusterBirthYearDraft
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
                      mismatchedRoleCount > 0 && clusterRoleDraft
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

                {missingBirthYearCount > 0 && clusterBirthYearDraft ? (
                  <Text style={styles.clusterMetaPendingHint}>
                    {missingBirthYearCount} senza anno
                  </Text>
                ) : mismatchedRoleCount > 0 && clusterRoleDraft ? (
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
                {showAddPlayers && availablePlayersToAdd.length > 0 && (
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
                
                {showAddPlayers && availablePlayersToAdd.length === 0 && !loadingAvailablePlayers && (
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
            {selectedPlayerCluster && hasAvailablePlayers && (
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
      <Modal visible={!!confirmModal} transparent={true} animationType="fade" onRequestClose={() => setConfirmModal(null)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmContent}>
            <View style={styles.confirmIconWrap}>
              <Ionicons name={confirmModal?.destructive ? 'warning' : 'information-circle'} size={40} color={confirmModal?.destructive ? '#e53935' : '#667eea'} />
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
              <TouchableOpacity style={[styles.confirmBtnAction, confirmModal?.destructive && { backgroundColor: '#e53935' }]} onPress={() => confirmModal?.onConfirm?.()}>
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
  },
  tabActive: {
    backgroundColor: '#667eea',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#fff',
    fontWeight: '600',
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
  },
  clusterFilterBtnActive: {
    borderColor: '#c7d2fe',
    backgroundColor: '#f8f9ff',
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
    flex: 2,
    minWidth: 120,
  },
  columnWithPadding: {
    paddingLeft: 16,
  },
  columnWithPaddingRight: {
    paddingRight: 16,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
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
  userEmail: {
    fontSize: 11,
    color: '#666',
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
    flex: 1.7,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonColumnHeader: {
    flex: 1.5,
    minWidth: 100,
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
  roleOption: {
    flex: 1,
    minHeight: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
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
  leagueItem: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  leagueInfo: {
    marginBottom: 12,
    flex: 1,
  },
  leagueNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  leagueName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  officialCheckbox: {
    padding: 4,
    marginLeft: 8,
  },
  leagueOfficialGroup: {
    fontSize: 12,
    color: '#667eea',
    fontWeight: '500',
    marginBottom: 4,
  },
  leagueDetails: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  leagueCreated: {
    fontSize: 12,
    color: '#999',
  },
  leagueActions: {
    flexDirection: 'row',
    gap: 8,
  },
  leagueActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#667eea',
    gap: 4,
    flex: 1,
    justifyContent: 'center',
  },
  leagueActionButtonAdmin: {
    borderColor: '#28a745',
  },
  leagueActionButtonDanger: {
    borderColor: '#dc3545',
  },
  leagueActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#667eea',
  },
  leagueActionTextAdmin: {
    color: '#28a745',
  },
  leagueActionTextDanger: {
    color: '#dc3545',
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
  playerClusterName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
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


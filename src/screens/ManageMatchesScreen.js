import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { adminCompetitionsService, adminMatchDetailsService, adminMatchesService, superuserService } from '../services/api';
import { parseAppDate } from '../utils/dateTime';

/** Deve coincidere con `official_match_stages.id` per la tipologia «Gironi» (di solito 1). */
const OFFICIAL_MATCH_STAGE_GIRONI_ID = 1;

const TOAST_DURATION_MS = 2400;

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toYmd(dateObj) {
  const y = dateObj.getFullYear();
  const m = `${dateObj.getMonth() + 1}`.padStart(2, '0');
  const d = `${dateObj.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseSqlDateTime(value) {
  if (!value) return new Date();
  const d = parseAppDate(value);
  return !d || Number.isNaN(d.getTime()) ? new Date() : d;
}

function formatSqlDateTime(dateObj) {
  const y = dateObj.getFullYear();
  const m = `${dateObj.getMonth() + 1}`.padStart(2, '0');
  const d = `${dateObj.getDate()}`.padStart(2, '0');
  const hh = `${dateObj.getHours()}`.padStart(2, '0');
  const mm = `${dateObj.getMinutes()}`.padStart(2, '0');
  const ss = `${dateObj.getSeconds()}`.padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function formatDisplayDateTime(sqlDateTime) {
  const d = parseSqlDateTime(sqlDateTime);
  const dd = `${d.getDate()}`.padStart(2, '0');
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = `${d.getHours()}`.padStart(2, '0');
  const min = `${d.getMinutes()}`.padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

/** Etichetta visiva lega/edizione: anno se reference_year valorizzato, altrimenti nome lega. */
function leagueEditionDisplay(league) {
  if (!league) return '-';
  const refYear = league.reference_year;
  if (refYear != null && refYear !== '' && Number.isFinite(Number(refYear))) {
    return String(Math.trunc(Number(refYear)));
  }
  const name = String(league.name || '').trim();
  return name || '-';
}

/** Luogo predefinito in crea/modifica partita se esiste official_match_venues.id = 1. */
function defaultVenueNameFromList(venues) {
  const list = Array.isArray(venues) ? venues : [];
  const item = list.find((v) => Number(v?.id) === 1);
  return String(item?.name || '').trim();
}

export default function ManageMatchesScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const su = Number(user?.is_superuser || 0);
  const canManageMatches = su === 1 || su === 2;
  const canManageCompetitions = su === 1;
  const canManageMatchDetails = su === 1;

  const [activeTab, setActiveTab] = useState('matches');
  const [showCreateMatchForm, setShowCreateMatchForm] = useState(false);
  const [createMatchStep, setCreateMatchStep] = useState(1);
  const [showCreateTimingDetails, setShowCreateTimingDetails] = useState(false);
  const [showEditMatchForm, setShowEditMatchForm] = useState(false);
  const [editMatchStep, setEditMatchStep] = useState(1);
  const [showEditTimingDetails, setShowEditTimingDetails] = useState(false);
  const [editOriginal, setEditOriginal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState('');
  const [competitions, setCompetitions] = useState([]); // gruppi ufficiali usati come competizioni
  const [officialGroups, setOfficialGroups] = useState([]);
  const [matches, setMatches] = useState([]);
  const [filterCompetitionId, setFilterCompetitionId] = useState(null);
  const [filterLeagueId, setFilterLeagueId] = useState(null);
  const [filterTeamId, setFilterTeamId] = useState(null);
  const [filterTeams, setFilterTeams] = useState([]);
  const [filterMissingTeamsOnly, setFilterMissingTeamsOnly] = useState(false);
  const [filterVisibility, setFilterVisibility] = useState('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showVisibilityFilters, setShowVisibilityFilters] = useState(false);
  const [teamsByComp, setTeamsByComp] = useState({});
  const [leaguesByComp, setLeaguesByComp] = useState({});
  const [selectedLeagueIdByComp, setSelectedLeagueIdByComp] = useState({});

  const [competitionId, setCompetitionId] = useState(null);
  const [homeTeamId, setHomeTeamId] = useState(null);
  const [awayTeamId, setAwayTeamId] = useState(null);
  const [isAdminOnly, setIsAdminOnly] = useState(false);
  const [kickoffAt, setKickoffAt] = useState(`${todayYmd()} 20:45:00`);
  const [kickoffDateObj, setKickoffDateObj] = useState(parseSqlDateTime(`${todayYmd()} 20:45:00`));
  const [showKickoffPicker, setShowKickoffPicker] = useState(false);
  const [kickoffPickerMode, setKickoffPickerMode] = useState('date');
  const [showFilterDatePicker, setShowFilterDatePicker] = useState(false);
  const [editingMatchId, setEditingMatchId] = useState(null);
  const [venue, setVenue] = useState('');
  const [referee, setReferee] = useState('');
  const [matchStageId, setMatchStageId] = useState(null);
  const [regulationHalfMinutes, setRegulationHalfMinutes] = useState('30');
  const [extraTimeEnabled, setExtraTimeEnabled] = useState(false);
  const [extraFirstMinutes, setExtraFirstMinutes] = useState('15');
  const [extraSecondMinutes, setExtraSecondMinutes] = useState('15');
  const [extraSecondHalfEnabled, setExtraSecondHalfEnabled] = useState(true);
  const [penaltiesEnabled, setPenaltiesEnabled] = useState(false);
  const [newStageHalfMin, setNewStageHalfMin] = useState('30');
  const [newStageExtraTime, setNewStageExtraTime] = useState(false);
  const [newStageExtra1, setNewStageExtra1] = useState('15');
  const [newStageExtra2, setNewStageExtra2] = useState('15');
  const [newStageExtraSecondEnabled, setNewStageExtraSecondEnabled] = useState(true);
  const [newStagePenalties, setNewStagePenalties] = useState(false);
  const [stagePresetModal, setStagePresetModal] = useState(null);
  const [stagePresetDraft, setStagePresetDraft] = useState(null);
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [matchDetailsOptions, setMatchDetailsOptions] = useState({ venues: [], referees: [], stages: [] });
  const [newVenueName, setNewVenueName] = useState('');
  const [newRefereeName, setNewRefereeName] = useState('');
  const [newStageName, setNewStageName] = useState('');
  const [refereeListOpen, setRefereeListOpen] = useState(false);
  const [standingsTies, setStandingsTies] = useState([]);
  const [tieOrders, setTieOrders] = useState({});

  const toAdminOnlyFlag = (value) => {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 't' || normalized === 'yes';
  };

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), TOAST_DURATION_MS);
  };

  const selectedLeagueIdForForm = competitionId ? Number(selectedLeagueIdByComp[competitionId] || 0) : 0;

  const selectedTeams = useMemo(() => {
    if (!competitionId) return [];
    const rawTeams = teamsByComp[competitionId] || [];
    return [...rawTeams].sort((a, b) => String(a.name).localeCompare(String(b.name), 'it'));
  }, [teamsByComp, competitionId]);

  const gironiStageMatchBlocked = useMemo(() => {
    const league = (leaguesByComp[competitionId] || []).find(
      (l) => Number(l.id) === Number(selectedLeagueIdForForm)
    );
    if (!league || Number(league.official_two_groups) !== 1) return null;
    if (Number(matchStageId) !== OFFICIAL_MATCH_STAGE_GIRONI_ID) return null;
    if (!homeTeamId || !awayTeamId) return null;
    const home = selectedTeams.find((t) => Number(t.id) === Number(homeTeamId));
    const away = selectedTeams.find((t) => Number(t.id) === Number(awayTeamId));
    const gh = home?.girone_index != null && home.girone_index !== '' ? Number(home.girone_index) : null;
    const ga = away?.girone_index != null && away.girone_index !== '' ? Number(away.girone_index) : null;
    if (gh == null || Number.isNaN(gh) || ga == null || Number.isNaN(ga)) {
      return 'Per la tipologia Gironi con due gironi attivi, assegna entrambe le squadre a un girone (Superuser → Ufficiali).';
    }
    if (gh !== ga) {
      return 'Partita di gironi: le squadre selezionate sono in gironi diversi.';
    }
    return null;
  }, [
    leaguesByComp,
    competitionId,
    selectedLeagueIdForForm,
    matchStageId,
    homeTeamId,
    awayTeamId,
    selectedTeams,
  ]);

  const defaultVenueName = useMemo(
    () => defaultVenueNameFromList(matchDetailsOptions.venues),
    [matchDetailsOptions.venues]
  );

  /** Senza opzione "-" sul luogo: su step 3 forza un luogo se la lista è valorizzata. */
  useEffect(() => {
    const isVenueStep =
      (showCreateMatchForm && createMatchStep === 3) || (showEditMatchForm && editMatchStep === 3);
    if (!isVenueStep) return;
    const list = matchDetailsOptions.venues || [];
    if (!Array.isArray(list) || list.length === 0) return;
    if (String(venue || '').trim() !== '') return;
    const next = defaultVenueNameFromList(list) || String(list[0]?.name || '').trim();
    if (next) setVenue(next);
  }, [
    showCreateMatchForm,
    showEditMatchForm,
    createMatchStep,
    editMatchStep,
    matchDetailsOptions.venues,
    venue,
  ]);

  const filteredMatches = useMemo(() => {
    const competitionIdNum = Number(filterCompetitionId || 0);
    const leagueIdNum = Number(filterLeagueId || 0);
    const teamIdNum = Number(filterTeamId || 0);
    return (matches || []).filter((m) => {
      const compOk = !competitionIdNum || Number(m.competition_id) === competitionIdNum;
      if (!compOk) return false;
      const leagueOk =
        !leagueIdNum || Number(m.home_league_id) === leagueIdNum || Number(m.away_league_id) === leagueIdNum;
      if (!leagueOk) return false;
      const teamOk = !teamIdNum || Number(m.home_team_id) === teamIdNum || Number(m.away_team_id) === teamIdNum;
      if (!teamOk) return false;
      if (!filterMissingTeamsOnly) return true;
      const hasHome = Number.isFinite(Number(m.home_team_id)) && Number(m.home_team_id) > 0;
      const hasAway = Number.isFinite(Number(m.away_team_id)) && Number(m.away_team_id) > 0;
      return !hasHome || !hasAway;
    });
  }, [matches, filterCompetitionId, filterLeagueId, filterTeamId, filterMissingTeamsOnly]);

  const filteredMatchesWithVisibility = useMemo(() => {
    return filteredMatches.filter((m) => {
      const adminOnly = Number(m?.is_admin_only || 0) === 1;
      if (filterVisibility === 'hidden') return adminOnly;
      if (filterVisibility === 'all') return true;
      return !adminOnly;
    });
  }, [filteredMatches, filterVisibility]);

  const canSubmitMatch = Boolean(
    competitionId &&
      selectedLeagueIdForForm > 0 &&
      kickoffAt &&
      !(homeTeamId && awayTeamId && homeTeamId === awayTeamId) &&
      !gironiStageMatchBlocked
  );
  const canCreateStep1 = Boolean(kickoffAt && competitionId && selectedLeagueIdForForm > 0);
  const canCreateStep2 = !(homeTeamId && awayTeamId && homeTeamId === awayTeamId);
  const canCreateStep3 = !gironiStageMatchBlocked;

  const selectedCompetitionName = useMemo(
    () => competitions.find((c) => Number(c.id) === Number(competitionId))?.name || '-',
    [competitions, competitionId]
  );
  const selectedLeagueName = useMemo(() => {
    const league = (leaguesByComp[competitionId] || []).find((l) => Number(l.id) === Number(selectedLeagueIdForForm));
    return leagueEditionDisplay(league);
  }, [leaguesByComp, competitionId, selectedLeagueIdForForm]);
  const selectedHomeTeamName = useMemo(
    () => selectedTeams.find((t) => Number(t.id) === Number(homeTeamId))?.name || '-',
    [selectedTeams, homeTeamId]
  );
  const selectedAwayTeamName = useMemo(
    () => selectedTeams.find((t) => Number(t.id) === Number(awayTeamId))?.name || '-',
    [selectedTeams, awayTeamId]
  );
  const selectedStageName = useMemo(
    () => (matchDetailsOptions.stages || []).find((s) => Number(s.id) === Number(matchStageId))?.name || '-',
    [matchDetailsOptions.stages, matchStageId]
  );
  const selectedEditCompetitionName = useMemo(
    () => competitions.find((c) => Number(c.id) === Number(competitionId))?.name || '-',
    [competitions, competitionId]
  );
  const selectedEditLeagueName = useMemo(() => {
    const league = (leaguesByComp[competitionId] || []).find((l) => Number(l.id) === Number(selectedLeagueIdForForm));
    return leagueEditionDisplay(league);
  }, [leaguesByComp, competitionId, selectedLeagueIdForForm]);
  const selectedEditHomeTeamName = useMemo(
    () => selectedTeams.find((t) => Number(t.id) === Number(homeTeamId))?.name || '-',
    [selectedTeams, homeTeamId]
  );
  const selectedEditAwayTeamName = useMemo(
    () => selectedTeams.find((t) => Number(t.id) === Number(awayTeamId))?.name || '-',
    [selectedTeams, awayTeamId]
  );
  const editChangeRows = useMemo(() => {
    if (!editOriginal) return [];
    const rows = [];
    const pushRow = (label, beforeValue, afterValue) => {
      if (String(beforeValue) !== String(afterValue)) {
        rows.push({ label, before: String(beforeValue), after: String(afterValue) });
      }
    };
    pushRow('Data e ora', editOriginal.kickoffLabel, formatDisplayDateTime(kickoffAt));
    pushRow('Competizione', editOriginal.competitionName, selectedEditCompetitionName);
    pushRow('Edizione', editOriginal.leagueName, selectedEditLeagueName);
    pushRow('Squadra casa', editOriginal.homeTeamName, selectedEditHomeTeamName);
    pushRow('Squadra ospite', editOriginal.awayTeamName, selectedEditAwayTeamName);
    pushRow('Luogo', editOriginal.venue || '-', venue || '-');
    pushRow('Arbitro', editOriginal.referee || '-', referee || '-');
    pushRow('Tipologia giornata', editOriginal.stageName || '-', selectedStageName || '-');
    pushRow(
      'Visibilita',
      editOriginal.isAdminOnly ? 'Nascosta' : 'Visibile a tutti',
      isAdminOnly ? 'Nascosta' : 'Visibile a tutti'
    );
    pushRow('Tempo regolamentare', `${editOriginal.regulationHalfMinutes || 30}'`, `${regulationHalfMinutes || 30}'`);
    pushRow('Supplementari', editOriginal.extraTimeEnabled ? 'Si' : 'No', extraTimeEnabled ? 'Si' : 'No');
    pushRow('1° supp.', `${editOriginal.extraFirstMinutes || 0}'`, `${extraFirstMinutes || 0}'`);
    pushRow('2° supp.', `${editOriginal.extraSecondMinutes || 0}'`, `${extraSecondMinutes || 0}'`);
    pushRow('Rigori', editOriginal.penaltiesEnabled ? 'Si' : 'No', penaltiesEnabled ? 'Si' : 'No');
    return rows;
  }, [
    editOriginal,
    kickoffAt,
    selectedEditCompetitionName,
    selectedEditLeagueName,
    selectedEditHomeTeamName,
    selectedEditAwayTeamName,
    venue,
    referee,
    selectedStageName,
    isAdminOnly,
    regulationHalfMinutes,
    extraTimeEnabled,
    extraFirstMinutes,
    extraSecondMinutes,
    penaltiesEnabled,
  ]);

  const loadCompetitions = async () => {
    const res = await adminCompetitionsService.getAll();
    const list = Array.isArray(res?.data) ? res.data : [];
    const enabled = list.filter((g) => Number(g.is_match_competition_enabled) === 1);
    setCompetitions(enabled.map((g) => ({ id: Number(g.id), name: g.name })));
    if (competitionId && !enabled.some((g) => Number(g.id) === competitionId)) {
      setCompetitionId(enabled.length > 0 ? Number(enabled[0].id) : null);
    } else if (!competitionId && enabled.length > 0) {
      setCompetitionId(Number(enabled[0].id));
    }
  };

  const loadOfficialGroups = async () => {
    if (!canManageCompetitions) return;
    const res = await adminCompetitionsService.getAll();
    const list = Array.isArray(res?.data) ? res.data : [];
    setOfficialGroups(list);
  };

  const loadMatches = async () => {
    const res = await adminMatchesService.getByDate(date);
    setMatches(Array.isArray(res?.data?.matches) ? res.data.matches : []);
  };

  const loadMatchDetailsOptions = async () => {
    if (!canManageMatches) return;
    const res = await adminMatchDetailsService.getAll();
    setMatchDetailsOptions({
      venues: Array.isArray(res?.data?.venues) ? res.data.venues : [],
      referees: Array.isArray(res?.data?.referees) ? res.data.referees : [],
      stages: Array.isArray(res?.data?.stages) ? res.data.stages : [],
    });
  };

  const loadStandingsTies = async (competitionIdParam) => {
    if (!canManageCompetitions || !competitionIdParam) return;
    const res = await adminMatchesService.getStandingsTies(competitionIdParam);
    const ties = Array.isArray(res?.data?.ties) ? res.data.ties : [];
    setStandingsTies(ties);
    const nextOrders = {};
    ties.forEach((t) => {
      const key = `${Number(t.league_id)}-${Number(t.points)}`;
      nextOrders[key] = (Array.isArray(t.teams) ? t.teams : []).map((x) => Number(x.team_id));
    });
    setTieOrders(nextOrders);
  };

  const loadLeaguesForCompetition = async (compId) => {
    if (!compId) return [];
    const res = await adminMatchesService.getCompetitionTeams(compId, [], true);
    const leagues = Array.isArray(res?.data?.official_leagues) ? res.data.official_leagues : [];
    setLeaguesByComp((prev) => ({ ...prev, [compId]: leagues }));
    return leagues;
  };

  /**
   * Squadre della sola lega scelta. Passa overrideLeagueId subito dopo aver scelto la lega (setState è asincrono).
   * Senza lega valida: nessuna chiamata con tutte le leghe — lista vuota.
   */
  const loadTeamsForCompetition = async (compId, overrideLeagueId = undefined) => {
    if (!compId) return [];
    const fromState = Number(selectedLeagueIdByComp[compId] || 0);
    const selectedLeagueId =
      overrideLeagueId !== undefined && overrideLeagueId !== null
        ? Number(overrideLeagueId)
        : fromState;

    if (selectedLeagueId <= 0) {
      setTeamsByComp((prev) => ({ ...prev, [compId]: [] }));
      return [];
    }

    const res = await adminMatchesService.getCompetitionTeams(compId, [selectedLeagueId]);
    const teams = Array.isArray(res?.data?.teams) ? res.data.teams : [];
    const leagues = Array.isArray(res?.data?.official_leagues) ? res.data.official_leagues : [];
    if (leagues.length > 0) {
      setLeaguesByComp((prev) => ({ ...prev, [compId]: leagues }));
    }
    setTeamsByComp((prev) => ({ ...prev, [compId]: teams }));
    return teams;
  };

  const loadFilterTeamsForLeague = async (compId, leagueId) => {
    if (!compId || !leagueId) {
      setFilterTeams([]);
      return;
    }
    try {
      const res = await adminMatchesService.getCompetitionTeams(compId, [leagueId]);
      const teams = Array.isArray(res?.data?.teams) ? res.data.teams : [];
      setFilterTeams(teams);
    } catch (_) {
      setFilterTeams([]);
    }
  };

  const loadAll = async () => {
    try {
      setLoading(true);
      await Promise.all([loadCompetitions(), loadMatches(), loadOfficialGroups(), loadMatchDetailsOptions()]);
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Errore caricamento');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canManageMatches) loadAll();
  }, []);

  useEffect(() => {
    if (competitionId) {
      loadLeaguesForCompetition(competitionId).catch(() => {});
    }
  }, [competitionId]);

  useEffect(() => {
    if (activeTab === 'standings' && competitionId) {
      loadStandingsTies(competitionId).catch(() => {});
    }
  }, [activeTab, competitionId]);

  useEffect(() => {
    if (!canManageMatches) return;
    loadMatches().catch(() => {});
  }, [date]);

  const resetMatchTimingFields = () => {
    setRegulationHalfMinutes('30');
    setExtraTimeEnabled(false);
    setExtraFirstMinutes('15');
    setExtraSecondMinutes('15');
    setExtraSecondHalfEnabled(true);
    setPenaltiesEnabled(false);
  };

  const applyStageDefaultsToMatchForm = (stage) => {
    if (!stage) {
      resetMatchTimingFields();
      return;
    }
    const h = stage.default_regulation_half_minutes ?? 30;
    const et = !!Number(stage.default_extra_time_enabled);
    const ex1 = stage.default_extra_first_half_minutes;
    const ex2 = stage.default_extra_second_half_minutes;
    setRegulationHalfMinutes(String(h));
    setExtraTimeEnabled(et);
    setExtraFirstMinutes(String(ex1 != null ? ex1 : 15));
    setExtraSecondMinutes(String(ex2 != null ? ex2 : 15));
    setExtraSecondHalfEnabled(Number(ex2) > 0);
    setPenaltiesEnabled(!!Number(stage.default_penalties_enabled));
  };

  const selectMatchStageId = (stageIdRaw) => {
    const stageId = Number(stageIdRaw);
    const nextId = Number.isFinite(stageId) && stageId > 0 ? stageId : null;
    setMatchStageId(nextId);
    if (!nextId) {
      resetMatchTimingFields();
      return;
    }
    const st = (matchDetailsOptions.stages || []).find((s) => Number(s.id) === nextId);
    applyStageDefaultsToMatchForm(st || null);
  };

  const buildMatchTimingPayload = () => {
    let half = parseInt(regulationHalfMinutes, 10);
    if (!Number.isFinite(half) || half < 15 || half > 60) half = 30;
    const et = extraTimeEnabled ? 1 : 0;
    let ex1 = parseInt(extraFirstMinutes, 10);
    let ex2 = parseInt(extraSecondMinutes, 10);
    if (!Number.isFinite(ex1) || ex1 < 1 || ex1 > 45) ex1 = 15;
    if (!Number.isFinite(ex2) || ex2 < 1 || ex2 > 45) ex2 = 15;
    const useSecondExtraHalf = extraSecondHalfEnabled ? 1 : 0;
    return {
      regulation_half_minutes: half,
      extra_time_enabled: et,
      extra_first_half_minutes: et ? ex1 : 0,
      extra_second_half_minutes: et ? (useSecondExtraHalf ? ex2 : 0) : 0,
      penalties_enabled: penaltiesEnabled ? 1 : 0,
    };
  };

  const buildStageDefaultsPayload = (halfStr, etOn, ex1Str, ex2Str, secondExtraHalfOn, penOn) => {
    let h = parseInt(String(halfStr), 10);
    if (!Number.isFinite(h) || h < 15 || h > 60) h = 30;
    const et = etOn ? 1 : 0;
    let x1 = parseInt(String(ex1Str), 10);
    let x2 = parseInt(String(ex2Str), 10);
    if (!Number.isFinite(x1) || x1 < 1 || x1 > 45) x1 = 15;
    if (!Number.isFinite(x2) || x2 < 1 || x2 > 45) x2 = 15;
    const useSecondExtraHalf = !!secondExtraHalfOn;
    return {
      default_regulation_half_minutes: h,
      default_extra_time_enabled: et,
      default_extra_first_half_minutes: et ? x1 : 0,
      default_extra_second_half_minutes: et ? (useSecondExtraHalf ? x2 : 0) : 0,
      default_penalties_enabled: penOn ? 1 : 0,
    };
  };

  const openStagePresetEditor = (s) => {
    setStagePresetModal(s);
    setStagePresetDraft({
      half: String(s.default_regulation_half_minutes ?? 30),
      extraTime: !!Number(s.default_extra_time_enabled),
      ex1: String(s.default_extra_first_half_minutes ?? 15),
      ex2: String(s.default_extra_second_half_minutes ?? 15),
      extraSecondHalfEnabled: Number(s.default_extra_second_half_minutes) > 0,
      penalties: !!Number(s.default_penalties_enabled),
    });
  };

  const saveStagePresetFromModal = async () => {
    if (!stagePresetModal || !stagePresetDraft) return;
    try {
      const defs = buildStageDefaultsPayload(
        stagePresetDraft.half,
        stagePresetDraft.extraTime,
        stagePresetDraft.ex1,
        stagePresetDraft.ex2,
        stagePresetDraft.extraSecondHalfEnabled,
        stagePresetDraft.penalties
      );
      const res = await adminMatchDetailsService.updateStageTimingDefaults(stagePresetModal.id, defs);
      const n = res?.data?.matches_with_stage;
      setStagePresetModal(null);
      setStagePresetDraft(null);
      await loadMatchDetailsOptions();
      loadMatches().catch(() => {});
      if (typeof n === 'number' && n > 0) {
        showToast(`Preset salvato: aggiornate ${n} partit${n === 1 ? 'a' : 'e'} con questa tipologia`, 'success');
      } else {
        showToast('Preset tipologia salvato', 'success');
      }
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Salvataggio preset non riuscito');
    }
  };

  const matchTimingEditor = (
    <>
      <Text style={styles.label}>Durata tempi regolamentari (minuti per tempo)</Text>
      <View style={styles.rowWrap}>
        {[30, 45].map((m) => (
          <TouchableOpacity
            key={`half-${m}`}
            style={[styles.chip, regulationHalfMinutes === String(m) && styles.chipActive]}
            onPress={() => setRegulationHalfMinutes(String(m))}
          >
            <Text style={[styles.chipText, regulationHalfMinutes === String(m) && styles.chipTextActive]}>{m}′</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={regulationHalfMinutes}
        onChangeText={setRegulationHalfMinutes}
        keyboardType="number-pad"
        placeholder="15–60"
      />
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Supplementari</Text>
        <Switch
          value={extraTimeEnabled}
          onValueChange={(v) => {
            setExtraTimeEnabled(v);
            if (v) setExtraSecondHalfEnabled(true);
          }}
          trackColor={{ false: '#ccc', true: '#a5b4fc' }}
          thumbColor={extraTimeEnabled ? '#667eea' : '#f4f3f4'}
        />
      </View>
      {extraTimeEnabled ? (
        <>
          <Text style={styles.label}>1° supplementare (min)</Text>
          <TextInput style={styles.input} value={extraFirstMinutes} onChangeText={setExtraFirstMinutes} keyboardType="number-pad" placeholder="1–45" />
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>2° tempo supplementare</Text>
            <Switch
              value={extraSecondHalfEnabled}
              onValueChange={setExtraSecondHalfEnabled}
              trackColor={{ false: '#ccc', true: '#a5b4fc' }}
              thumbColor={extraSecondHalfEnabled ? '#667eea' : '#f4f3f4'}
            />
          </View>
          {extraSecondHalfEnabled ? (
            <>
          <Text style={styles.label}>2° supplementare (min)</Text>
          <TextInput style={styles.input} value={extraSecondMinutes} onChangeText={setExtraSecondMinutes} keyboardType="number-pad" placeholder="1–45" />
            </>
          ) : null}
        </>
      ) : null}
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Rigori</Text>
        <Switch value={penaltiesEnabled} onValueChange={setPenaltiesEnabled} trackColor={{ false: '#ccc', true: '#a5b4fc' }} thumbColor={penaltiesEnabled ? '#667eea' : '#f4f3f4'} />
      </View>
    </>
  );

  const createMatch = async () => {
    if (!canSubmitMatch) {
      showToast('Completa competizione, lega e kickoff.');
      return;
    }
    try {
      await adminMatchesService.create({
        competition_id: competitionId,
        league_id: selectedLeagueIdForForm,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        is_admin_only: isAdminOnly ? 1 : 0,
        kickoff_at: kickoffAt,
        status: 'scheduled',
        venue,
        referee,
        match_stage_id: matchStageId,
        ...buildMatchTimingPayload(),
      });
      setHomeTeamId(null);
      setAwayTeamId(null);
      setIsAdminOnly(false);
      setVenue(defaultVenueName);
      setReferee('');
      setMatchStageId(null);
      resetMatchTimingFields();
      await loadMatches();
      setShowCreateMatchForm(false);
      setCreateMatchStep(1);
      setShowCreateTimingDetails(false);
      showToast('Partita creata', 'success');
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Creazione non riuscita');
    }
  };

  const startEditMatch = async (match) => {
    try {
      const compId = Number(match.competition_id);
      const storedLeagueIdRaw = match?.league_id;
      const storedLeagueId =
        storedLeagueIdRaw == null || String(storedLeagueIdRaw).trim() === ''
          ? 0
          : Number(storedLeagueIdRaw);
      const storedLeagueName = String(match?.league_name || '').trim();
      const homeLeagueId = Number(match.home_league_id || 0);
      const awayLeagueId = Number(match.away_league_id || 0);
      let preselectedLeagueId = storedLeagueId > 0 ? storedLeagueId : (homeLeagueId > 0 ? homeLeagueId : (awayLeagueId > 0 ? awayLeagueId : 0));
      setCompetitionId(compId);
      const loadedLeagues = await loadLeaguesForCompetition(compId);
      if ((!preselectedLeagueId || preselectedLeagueId <= 0) && storedLeagueName) {
        const byName = (loadedLeagues || []).find(
          (l) => String(l?.name || '').trim().toLowerCase() === storedLeagueName.toLowerCase()
        );
        if (byName?.id) preselectedLeagueId = Number(byName.id);
      }
      if (!preselectedLeagueId || preselectedLeagueId <= 0) {
        const kickoffYear = parseSqlDateTime(String(match?.kickoff_at || '')).getFullYear();
        const leaguesWithYear = (loadedLeagues || [])
          .map((l) => ({
            id: Number(l?.id || 0),
            referenceYear: Number(l?.reference_year),
          }))
          .filter((x) => x.id > 0 && Number.isFinite(x.referenceYear));
        if (leaguesWithYear.length > 0 && Number.isFinite(kickoffYear)) {
          const notFuture = leaguesWithYear
            .filter((x) => x.referenceYear <= kickoffYear)
            .sort((a, b) => b.referenceYear - a.referenceYear);
          const pick = (notFuture[0] || leaguesWithYear.sort((a, b) => b.referenceYear - a.referenceYear)[0] || null);
          if (pick?.id) preselectedLeagueId = Number(pick.id);
        }
      }
      setSelectedLeagueIdByComp((prev) => ({ ...prev, [compId]: preselectedLeagueId > 0 ? preselectedLeagueId : 0 }));
      if (preselectedLeagueId > 0) {
        await loadTeamsForCompetition(compId, preselectedLeagueId);
      } else {
        setTeamsByComp((prev) => ({ ...prev, [compId]: [] }));
      }
      setHomeTeamId(
        match?.home_team_id == null || String(match.home_team_id).trim() === ''
          ? null
          : Number(match.home_team_id)
      );
      setAwayTeamId(
        match?.away_team_id == null || String(match.away_team_id).trim() === ''
          ? null
          : Number(match.away_team_id)
      );
      const matchAdminOnly =
        toAdminOnlyFlag(match?.is_admin_only) ||
        toAdminOnlyFlag(match?.isAdminOnly) ||
        toAdminOnlyFlag(match?.admin_only);
      setIsAdminOnly(matchAdminOnly);
      const parsedKickoff = parseSqlDateTime(String(match.kickoff_at || ''));
      setKickoffDateObj(parsedKickoff);
      setKickoffAt(formatSqlDateTime(parsedKickoff));
      setEditingMatchId(Number(match.id));
      const existingVenue = String(match?.venue || '').trim();
      setVenue(existingVenue || defaultVenueName);
      setReferee(match?.referee || '');
      setMatchStageId(match?.match_stage_id != null ? Number(match.match_stage_id) : null);
      setRegulationHalfMinutes(String(match?.regulation_half_minutes ?? 30));
      setExtraTimeEnabled(!!Number(match?.extra_time_enabled));
      setExtraFirstMinutes(String(match?.extra_first_half_minutes ?? 15));
      setExtraSecondMinutes(String(match?.extra_second_half_minutes ?? 15));
      setExtraSecondHalfEnabled(Number(match?.extra_second_half_minutes ?? 0) > 0);
      setPenaltiesEnabled(!!Number(match?.penalties_enabled));
      setHomeScore(match?.home_score === null || typeof match?.home_score === 'undefined' ? '' : String(match.home_score));
      setAwayScore(match?.away_score === null || typeof match?.away_score === 'undefined' ? '' : String(match.away_score));
      setEditOriginal({
        kickoffLabel: formatDisplayDateTime(String(match.kickoff_at || '')),
        competitionName: String(match?.competition_name || '-'),
        leagueName: (() => {
          const league = (loadedLeagues || []).find((l) => Number(l.id) === Number(preselectedLeagueId));
          if (league) return leagueEditionDisplay(league);
          const refYear = match?.league_reference_year ?? match?.reference_year;
          if (refYear != null && refYear !== '' && Number.isFinite(Number(refYear))) {
            return String(Math.trunc(Number(refYear)));
          }
          return String(match?.league_name || '-').trim() || '-';
        })(),
        homeTeamName: String(match?.home_team_name || '-'),
        awayTeamName: String(match?.away_team_name || '-'),
        venue: String(match?.venue || ''),
        referee: String(match?.referee || ''),
        stageName: String(match?.match_stage || '-'),
        isAdminOnly: matchAdminOnly,
        regulationHalfMinutes: Number(match?.regulation_half_minutes || 30),
        extraTimeEnabled: !!Number(match?.extra_time_enabled),
        extraFirstMinutes: Number(match?.extra_first_half_minutes || 0),
        extraSecondMinutes: Number(match?.extra_second_half_minutes || 0),
        penaltiesEnabled: !!Number(match?.penalties_enabled),
      });
      setEditMatchStep(1);
      setShowEditTimingDetails(false);
      setShowEditMatchForm(true);
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Impossibile preparare modifica');
    }
  };

  const saveEditedMatch = async () => {
    if (!editingMatchId) return;
    if (!canSubmitMatch) {
      showToast('Completa competizione, lega e kickoff.');
      return;
    }
    try {
      const payload = {
        competition_id: competitionId,
        league_id: selectedLeagueIdForForm,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        is_admin_only: isAdminOnly ? 1 : 0,
        kickoff_at: kickoffAt,
        status: 'scheduled',
        venue,
        referee,
        match_stage_id: matchStageId,
        ...buildMatchTimingPayload(),
      };
      const res = await adminMatchesService.update(editingMatchId, payload);
      await loadMatches();
      showToast('Partita aggiornata', 'success');
      setTimeout(() => {
        cancelEdit();
      }, TOAST_DURATION_MS);
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Aggiornamento non riuscito');
    }
  };

  const cancelEdit = () => {
    setEditingMatchId(null);
    setShowEditMatchForm(false);
    setEditMatchStep(1);
    setShowEditTimingDetails(false);
    setEditOriginal(null);
    setHomeTeamId(null);
    setAwayTeamId(null);
    setIsAdminOnly(false);
    const base = parseSqlDateTime(`${todayYmd()} 20:45:00`);
    setKickoffDateObj(base);
    setKickoffAt(formatSqlDateTime(base));
    setVenue('');
    setReferee('');
    setMatchStageId(null);
    resetMatchTimingFields();
    setHomeScore('');
    setAwayScore('');
  };

  const parseStandingsText = (text) =>
    String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const p = line.split(';').map((x) => x.trim());
        return {
          position: Number(p[0] || 0),
          team_name: p[1] || '',
          played: Number(p[2] || 0),
          goal_diff: Number(p[3] || 0),
          points: Number(p[4] || 0),
        };
      })
      .filter((r) => r.team_name);

  const openKickoffPicker = (mode) => {
    setKickoffPickerMode(mode);
    setShowKickoffPicker(true);
  };

  const selectLeagueForTeams = async (competitionIdParam, leagueId) => {
    setSelectedLeagueIdByComp((prev) => ({ ...prev, [competitionIdParam]: leagueId }));
    const nextTeams = (await loadTeamsForCompetition(competitionIdParam, leagueId)) || [];
    const ids = new Set(nextTeams.map((t) => Number(t.id)));
    setHomeTeamId((prev) => (ids.has(Number(prev)) ? prev : null));
    setAwayTeamId((prev) => (ids.has(Number(prev)) ? prev : null));
  };

  const onKickoffChange = (event, selectedDate) => {
    if (Platform.OS === 'android') {
      setShowKickoffPicker(false);
    }
    if (!selectedDate) return;
    const next = new Date(kickoffDateObj);
    if (kickoffPickerMode === 'date') {
      next.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    } else {
      next.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
    }
    setKickoffDateObj(next);
    setKickoffAt(formatSqlDateTime(next));
  };

  const onFilterDateChange = (event, selectedDate) => {
    if (Platform.OS === 'android') {
      setShowFilterDatePicker(false);
      if (event?.type === 'dismissed') return;
    }
    if (!selectedDate) return;
    setDate(toYmd(selectedDate));
  };

  const deleteMatch = async (id) => {
    setConfirmModal({
      title: 'Elimina partita',
      message: 'Vuoi eliminare questa partita?',
      confirmText: 'Elimina',
      destructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await adminMatchesService.remove(id);
          await loadMatches();
          showToast('Partita eliminata', 'success');
        } catch (e) {
          showToast(e?.response?.data?.message || e?.message || 'Eliminazione non riuscita');
        }
      },
    });
  };

  const publishAllHiddenMatches = async () => {
    setConfirmModal({
      title: 'Pubblica partite nascoste',
      message: 'Vuoi rendere visibili a tutti tutte le partite attualmente nascoste?',
      confirmText: 'Pubblica tutte',
      destructive: false,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const res = await adminMatchesService.publishHidden();
          const updated = Number(res?.data?.updated || 0);
          await loadMatches();
          showToast(
            updated > 0 ? `${updated} partite pubblicate` : 'Nessuna partita nascosta da pubblicare',
            'success'
          );
        } catch (e) {
          showToast(e?.response?.data?.message || e?.message || 'Pubblicazione non riuscita');
        }
      },
    });
  };

  const updateCompetitionField = async (groupId, field, newValue) => {
    const numVal = newValue ? 1 : 0;
    setOfficialGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, [field]: numVal } : g))
    );
    try {
      await adminCompetitionsService.update(groupId, { [field]: numVal });
      await loadCompetitions();
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Salvataggio non riuscito');
      await loadOfficialGroups();
    }
  };

  const createMatchDetailOption = async (type, name) => {
    const clean = String(name || '').trim();
    if (!clean) {
      showToast('Inserisci un valore valido');
      return;
    }
    try {
      if (type === 'venues') await adminMatchDetailsService.createVenue(clean);
      if (type === 'referees') await adminMatchDetailsService.createReferee(clean);
      if (type === 'stages') {
        const defs = buildStageDefaultsPayload(
          newStageHalfMin,
          newStageExtraTime,
          newStageExtra1,
          newStageExtra2,
          newStageExtraSecondEnabled,
          newStagePenalties
        );
        await adminMatchDetailsService.createStage(clean, defs);
      }
      await loadMatchDetailsOptions();
      if (type === 'venues') setNewVenueName('');
      if (type === 'referees') setNewRefereeName('');
      if (type === 'stages') {
        setNewStageName('');
        setNewStageHalfMin('30');
        setNewStageExtraTime(false);
        setNewStageExtra1('15');
        setNewStageExtra2('15');
        setNewStageExtraSecondEnabled(true);
        setNewStagePenalties(false);
      }
      showToast('Valore aggiunto', 'success');
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Creazione non riuscita');
    }
  };

  const removeMatchDetailOption = async (type, id) => {
    try {
      if (type === 'venues') await adminMatchDetailsService.removeVenue(id);
      if (type === 'referees') await adminMatchDetailsService.removeReferee(id);
      if (type === 'stages') await adminMatchDetailsService.removeStage(id);
      await loadMatchDetailsOptions();
      showToast('Valore eliminato', 'success');
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Eliminazione non riuscita');
    }
  };

  const saveMetaLineupsStandings = async () => {
    if (!editingMatchId) return;
    try {
      await adminMatchesService.updateMeta(editingMatchId, {
        venue,
        referee,
        match_stage_id: matchStageId,
        home_score: homeScore === '' ? null : Number(homeScore),
        away_score: awayScore === '' ? null : Number(awayScore),
        ...buildMatchTimingPayload(),
      });
      await adminMatchesService.updateStats(editingMatchId, {
        home_score: homeScore === '' ? null : Number(homeScore),
        away_score: awayScore === '' ? null : Number(awayScore),
      });
      showToast('Dettagli partita salvati', 'success');
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Salvataggio dettagli non riuscito');
    }
  };

  const onRefresh = async () => {
    try {
      setRefreshing(true);
      await loadAll();
      if (activeTab === 'standings' && competitionId) {
        await loadStandingsTies(competitionId);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const moveTieTeam = (key, index, delta) => {
    setTieOrders((prev) => {
      const curr = Array.isArray(prev[key]) ? [...prev[key]] : [];
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= curr.length) return prev;
      const tmp = curr[index];
      curr[index] = curr[nextIndex];
      curr[nextIndex] = tmp;
      return { ...prev, [key]: curr };
    });
  };

  const saveTieOrder = async (tie) => {
    const key = `${Number(tie.league_id)}-${Number(tie.points)}`;
    const orderedIds = tieOrders[key] || [];
    if (!Array.isArray(orderedIds) || orderedIds.length < 2) {
      showToast('Ordine non valido');
      return;
    }
    try {
      await adminMatchesService.resolveStandingsTie({
        league_id: Number(tie.league_id),
        points: Number(tie.points),
        ordered_team_ids: orderedIds,
      });
      await loadStandingsTies(competitionId);
      showToast('Ordine parimerito salvato', 'success');
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Salvataggio ordine non riuscito');
    }
  };

  if (!canManageMatches) {
    return (
      <View style={styles.center}>
        <Text style={styles.denied}>Accesso non autorizzato</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 6, 12) }]}>
        <Text style={styles.headerTitle}>Gestione Partite</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.subtabsScroll}
        contentContainerStyle={styles.subtabsRow}
      >
        <TouchableOpacity style={[styles.subtabBtn, activeTab === 'matches' && styles.subtabBtnActive]} onPress={() => setActiveTab('matches')}>
          <Text style={[styles.subtabText, activeTab === 'matches' && styles.subtabTextActive]}>Partite</Text>
        </TouchableOpacity>
        {canManageCompetitions && (
          <TouchableOpacity style={[styles.subtabBtn, activeTab === 'competitions' && styles.subtabBtnActive]} onPress={() => setActiveTab('competitions')}>
            <Text style={[styles.subtabText, activeTab === 'competitions' && styles.subtabTextActive]}>Competizioni</Text>
          </TouchableOpacity>
        )}
        {canManageMatchDetails && (
          <TouchableOpacity style={[styles.subtabBtn, activeTab === 'details' && styles.subtabBtnActive]} onPress={() => setActiveTab('details')}>
            <Text style={[styles.subtabText, activeTab === 'details' && styles.subtabTextActive]}>Dettagli partite</Text>
          </TouchableOpacity>
        )}
        {canManageCompetitions && (
          <TouchableOpacity style={[styles.subtabBtn, activeTab === 'standings' && styles.subtabBtnActive]} onPress={() => setActiveTab('standings')}>
            <Text style={[styles.subtabText, activeTab === 'standings' && styles.subtabTextActive]}>Classifiche</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {activeTab === 'matches' && (
          <>
            <View style={styles.matchesTopBar}>
              <Text style={styles.matchesTopBarTitle}>Partite esistenti</Text>
              <TouchableOpacity
                style={styles.matchesPlusBtn}
                onPress={() => {
                  const nextVisible = !showCreateMatchForm;
                  setShowCreateMatchForm(nextVisible);
                  if (nextVisible) {
                    setCreateMatchStep(1);
                    setShowCreateTimingDetails(false);
                    setIsAdminOnly(false);
                    setVenue(defaultVenueName);
                  }
                }}
              >
                <Ionicons name={showCreateMatchForm ? 'close' : 'add'} size={20} color="#667eea" />
              </TouchableOpacity>
            </View>

            {showCreateMatchForm ? null : null}

            <>
                <View style={styles.card}>
                  <Text style={styles.label}>Filtri</Text>
                  <View style={styles.filtersIconRow}>
                    <TouchableOpacity
                      style={[styles.iconFilterBtn, String(date || '').trim() && styles.iconFilterBtnActive]}
                      onPress={() => {
                        if (String(date || '').trim()) {
                          setDate('');
                          return;
                        }
                        setShowFilterDatePicker(true);
                      }}
                    >
                      <Ionicons name="calendar-outline" size={18} color={String(date || '').trim() ? '#4f46e5' : '#475569'} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.iconFilterBtn, showAdvancedFilters && styles.iconFilterBtnActive]}
                      onPress={() => setShowAdvancedFilters((v) => !v)}
                    >
                      <Ionicons name="filter-outline" size={18} color={showAdvancedFilters ? '#4f46e5' : '#475569'} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.iconFilterBtn, showVisibilityFilters && styles.iconFilterBtnActive]}
                      onPress={() => setShowVisibilityFilters((v) => !v)}
                    >
                      <Ionicons name="eye-outline" size={18} color={showVisibilityFilters ? '#4f46e5' : '#475569'} />
              </TouchableOpacity>
                  </View>
            </View>

                {showAdvancedFilters ? (
              <View style={styles.card}>
                    <Text style={styles.label}>Filtro competizione</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.rowWrap}>
                        <TouchableOpacity
                          style={[styles.chip, !filterCompetitionId && styles.chipActive]}
                          onPress={() => {
                            setFilterCompetitionId(null);
                            setFilterLeagueId(null);
                            setFilterTeamId(null);
                            setFilterTeams([]);
                            setFilterMissingTeamsOnly(false);
                          }}
                        >
                          <Text style={[styles.chipText, !filterCompetitionId && styles.chipTextActive]}>Tutte</Text>
                        </TouchableOpacity>
                        {competitions.map((c) => (
                          <TouchableOpacity
                            key={`filter-comp-existing-${c.id}`}
                            style={[styles.chip, Number(filterCompetitionId) === Number(c.id) && styles.chipActive]}
                            onPress={() => {
                              setFilterCompetitionId(Number(c.id));
                              setFilterLeagueId(null);
                              setFilterTeamId(null);
                              setFilterTeams([]);
                              loadLeaguesForCompetition(Number(c.id)).catch(() => {});
                            }}
                          >
                            <Text style={[styles.chipText, Number(filterCompetitionId) === Number(c.id) && styles.chipTextActive]}>
                              {c.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>

                    <Text style={styles.label}>Filtro edizione</Text>
                    {!filterCompetitionId ? <Text style={styles.muted}>Seleziona prima una competizione</Text> : null}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.rowWrap}>
                        <TouchableOpacity
                          style={[styles.chip, !filterLeagueId && styles.chipActive, !filterCompetitionId && styles.chipDisabled]}
                          disabled={!filterCompetitionId}
                          onPress={() => {
                            setFilterLeagueId(null);
                            setFilterTeamId(null);
                            setFilterTeams([]);
                          }}
                        >
                          <Text style={[styles.chipText, !filterLeagueId && styles.chipTextActive]}>Tutte</Text>
                        </TouchableOpacity>
                        {filterCompetitionId
                          ? ((leaguesByComp[filterCompetitionId] || []).map((l) => (
                              <TouchableOpacity
                                key={`filter-league-existing-${l.id}`}
                                style={[styles.chip, Number(filterLeagueId) === Number(l.id) && styles.chipActive]}
                                onPress={() => {
                                  setFilterLeagueId(Number(l.id));
                                  setFilterTeamId(null);
                                  loadFilterTeamsForLeague(Number(filterCompetitionId), Number(l.id));
                                }}
                              >
                                <Text style={[styles.chipText, Number(filterLeagueId) === Number(l.id) && styles.chipTextActive]}>
                                  {leagueEditionDisplay(l)}
                                </Text>
                              </TouchableOpacity>
                            )))
                          : null}
                      </View>
                    </ScrollView>

                    <Text style={styles.label}>Filtro squadra</Text>
                    {!filterCompetitionId || !filterLeagueId ? <Text style={styles.muted}>Seleziona prima competizione ed edizione</Text> : null}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.rowWrap}>
                        <TouchableOpacity
                          style={[
                            styles.chip,
                            !filterTeamId && styles.chipActive,
                            (!filterCompetitionId || !filterLeagueId) && styles.chipDisabled,
                          ]}
                          disabled={!filterCompetitionId || !filterLeagueId}
                          onPress={() => setFilterTeamId(null)}
                        >
                          <Text style={[styles.chipText, !filterTeamId && styles.chipTextActive]}>Tutte</Text>
                        </TouchableOpacity>
                        {filterCompetitionId && filterLeagueId
                          ? (filterTeams.map((t) => (
                              <TouchableOpacity
                                key={`filter-team-existing-${t.id}`}
                                style={[styles.chip, Number(filterTeamId) === Number(t.id) && styles.chipActive]}
                                onPress={() => setFilterTeamId(Number(t.id))}
                              >
                                <Text style={[styles.chipText, Number(filterTeamId) === Number(t.id) && styles.chipTextActive]}>
                                  {t.name}
                                </Text>
                              </TouchableOpacity>
                            )))
                          : null}
                      </View>
                    </ScrollView>

                  </View>
                ) : null}

                {showVisibilityFilters ? (
                  <View style={styles.card}>
                    <Text style={styles.label}>Filtro stato squadre</Text>
                    <View style={styles.rowWrap}>
                      <TouchableOpacity
                        style={[styles.chip, !filterMissingTeamsOnly && styles.chipActive]}
                        onPress={() => setFilterMissingTeamsOnly(false)}
                      >
                        <Text style={[styles.chipText, !filterMissingTeamsOnly && styles.chipTextActive]}>Tutte</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.chip, filterMissingTeamsOnly && styles.chipActive]}
                        onPress={() => setFilterMissingTeamsOnly(true)}
                      >
                        <Text style={[styles.chipText, filterMissingTeamsOnly && styles.chipTextActive]}>
                          Almeno una squadra da definire
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.label}>Filtro visibilita</Text>
                    <View style={styles.rowWrap}>
                      <TouchableOpacity
                        style={[styles.chip, filterVisibility === 'visible' && styles.chipActive]}
                        onPress={() => setFilterVisibility('visible')}
                      >
                        <Text style={[styles.chipText, filterVisibility === 'visible' && styles.chipTextActive]}>
                          Visibili a tutti
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.chip, filterVisibility === 'hidden' && styles.chipActive]}
                        onPress={() => setFilterVisibility('hidden')}
                      >
                        <Text style={[styles.chipText, filterVisibility === 'hidden' && styles.chipTextActive]}>
                          Nascoste
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.chip, filterVisibility === 'all' && styles.chipActive]}
                        onPress={() => setFilterVisibility('all')}
                      >
                        <Text style={[styles.chipText, filterVisibility === 'all' && styles.chipTextActive]}>
                          Tutte
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity style={[styles.primaryBtn, { marginTop: 10 }]} onPress={publishAllHiddenMatches}>
                      <Text style={styles.primaryBtnText}>Pubblica tutte</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>{String(date || '').trim() ? 'Partite del giorno' : 'Tutte le partite'}</Text>
                  {filteredMatchesWithVisibility.length === 0 ? <Text style={styles.muted}>Nessuna partita</Text> : null}
                  {filteredMatchesWithVisibility.map((m) => (
                    <View key={m.id} style={styles.matchRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.compText}>{m.competition_name}</Text>
                        <Text style={styles.matchText}>{m.home_team_name} vs {m.away_team_name}</Text>
                        <Text style={styles.muted}>{formatDisplayDateTime(m.kickoff_at)}</Text>
                      </View>
                      <View style={styles.matchActionsCol}>
                        <TouchableOpacity style={styles.editBtn} onPress={() => startEditMatch(m)}>
                          <Text style={styles.editBtnText}>Modifica</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteMatch(m.id)}>
                          <Text style={styles.deleteBtnText}>Elimina</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
                {editingMatchId ? null : null}
            </>
          </>
        )}

        {activeTab === 'competitions' && canManageCompetitions && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Competizioni (gruppi ufficiali)</Text>
            <Text style={styles.muted}>Scegli quali gruppi mostrare nel form "Nuova partita".</Text>
            {officialGroups.map((g) => (
              <View key={g.id} style={styles.groupRow}>
                <Text style={styles.groupName}>{g.name}</Text>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Visibile in nuova partita</Text>
                  <Switch
                    value={Number(g.is_match_competition_enabled) === 1}
                    onValueChange={(val) => updateCompetitionField(g.id, 'is_match_competition_enabled', val)}
                    trackColor={{ false: '#ccc', true: '#a5b4fc' }}
                    thumbColor={Number(g.is_match_competition_enabled) === 1 ? '#667eea' : '#f4f3f4'}
                  />
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Squadre in Partite</Text>
                  <Switch
                    value={Number(g.show_teams_in_matches_strip) === 1}
                    onValueChange={(val) => updateCompetitionField(g.id, 'show_teams_in_matches_strip', val)}
                    trackColor={{ false: '#ccc', true: '#a5b4fc' }}
                    thumbColor={Number(g.show_teams_in_matches_strip) === 1 ? '#667eea' : '#f4f3f4'}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
        {activeTab === 'details' && canManageMatchDetails && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Dettagli partite</Text>
            <Text style={styles.muted}>Gestisci i valori selezionabili per luogo, arbitro e tipologia giornata.</Text>

            <Text style={styles.label}>Nuovo luogo</Text>
            <View style={styles.actionsRow}>
              <TextInput style={[styles.input, { flex: 1 }]} value={newVenueName} onChangeText={setNewVenueName} placeholder="Es. Stadio Olimpico" />
              <TouchableOpacity style={[styles.primaryBtn, { marginTop: 0, paddingHorizontal: 12 }]} onPress={() => createMatchDetailOption('venues', newVenueName)}>
                <Text style={styles.primaryBtnText}>Aggiungi</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.rowWrap}>
              {(matchDetailsOptions.venues || []).map((v) => (
                <TouchableOpacity
                  key={`manage-venue-${v.id}`}
                  style={styles.deleteChip}
                  onPress={() =>
                    setConfirmModal({
                      title: 'Elimina luogo',
                      message: `Eliminare "${v.name}"?`,
                      confirmText: 'Elimina',
                      destructive: true,
                      onConfirm: async () => {
                        setConfirmModal(null);
                        await removeMatchDetailOption('venues', Number(v.id));
                      },
                    })
                  }
                >
                  <Text style={styles.deleteChipText}>✕ {v.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Nuovo arbitro</Text>
            <View style={styles.actionsRow}>
              <TextInput style={[styles.input, { flex: 1 }]} value={newRefereeName} onChangeText={setNewRefereeName} placeholder="Es. Daniele Orsato" />
              <TouchableOpacity style={[styles.primaryBtn, { marginTop: 0, paddingHorizontal: 12 }]} onPress={() => createMatchDetailOption('referees', newRefereeName)}>
                <Text style={styles.primaryBtnText}>Aggiungi</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.detailDropdownHeader}
              activeOpacity={0.75}
              onPress={() => setRefereeListOpen((v) => !v)}
            >
              <View style={styles.detailDropdownHeaderLeft}>
                <Ionicons name="people-outline" size={17} color="#667eea" />
                <Text style={styles.detailDropdownHeaderText}>
                  Elenco arbitri ({(matchDetailsOptions.referees || []).length})
                </Text>
              </View>
              <Ionicons name={refereeListOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#64748b" />
            </TouchableOpacity>
            {refereeListOpen ? (
              <View style={styles.refereeList}>
                {(matchDetailsOptions.referees || []).length === 0 ? (
                  <Text style={styles.muted}>Nessun arbitro inserito.</Text>
                ) : (
                  (matchDetailsOptions.referees || []).map((r) => (
                    <TouchableOpacity
                      key={`manage-ref-${r.id}`}
                      style={styles.refereeDeleteRow}
                      onPress={() =>
                        setConfirmModal({
                          title: 'Elimina arbitro',
                          message: `Eliminare "${r.name}"?`,
                          confirmText: 'Elimina',
                          destructive: true,
                          onConfirm: async () => {
                            setConfirmModal(null);
                            await removeMatchDetailOption('referees', Number(r.id));
                          },
                        })
                      }
                    >
                      <Text style={styles.refereeDeleteName} numberOfLines={1}>{r.name}</Text>
                      <Text style={styles.refereeDeleteIcon}>✕</Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            ) : null}

            <Text style={styles.label}>Nuova tipologia giornata</Text>
            <Text style={styles.muted}>Preset predefinito per le partite che useranno questa tipologia (modificabile sul singolo match).</Text>
            <View style={styles.actionsRow}>
              <TextInput style={[styles.input, { flex: 1 }]} value={newStageName} onChangeText={setNewStageName} placeholder="Es. Gironi / Quarti / Finale" />
              <TouchableOpacity style={[styles.primaryBtn, { marginTop: 0, paddingHorizontal: 12 }]} onPress={() => createMatchDetailOption('stages', newStageName)}>
                <Text style={styles.primaryBtnText}>Aggiungi</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>Preset per la nuova tipologia</Text>
            <View style={styles.rowWrap}>
              {[30, 45].map((m) => (
                <TouchableOpacity
                  key={`newst-half-${m}`}
                  style={[styles.chip, newStageHalfMin === String(m) && styles.chipActive]}
                  onPress={() => setNewStageHalfMin(String(m))}
                >
                  <Text style={[styles.chipText, newStageHalfMin === String(m) && styles.chipTextActive]}>{m}′</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.input} value={newStageHalfMin} onChangeText={setNewStageHalfMin} keyboardType="number-pad" placeholder="15–60" />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Supplementari</Text>
              <Switch
                value={newStageExtraTime}
                onValueChange={(v) => {
                  setNewStageExtraTime(v);
                  if (v) setNewStageExtraSecondEnabled(true);
                }}
                trackColor={{ false: '#ccc', true: '#a5b4fc' }}
                thumbColor={newStageExtraTime ? '#667eea' : '#f4f3f4'}
              />
            </View>
            {newStageExtraTime ? (
              <>
                <Text style={styles.label}>1° supplementare (min)</Text>
                <TextInput style={styles.input} value={newStageExtra1} onChangeText={setNewStageExtra1} keyboardType="number-pad" />
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>2° tempo supplementare</Text>
                  <Switch
                    value={newStageExtraSecondEnabled}
                    onValueChange={setNewStageExtraSecondEnabled}
                    trackColor={{ false: '#ccc', true: '#a5b4fc' }}
                    thumbColor={newStageExtraSecondEnabled ? '#667eea' : '#f4f3f4'}
                  />
                </View>
                {newStageExtraSecondEnabled ? (
                  <>
                    <Text style={styles.label}>2° supplementare (min)</Text>
                    <TextInput style={styles.input} value={newStageExtra2} onChangeText={setNewStageExtra2} keyboardType="number-pad" />
                  </>
                ) : null}
              </>
            ) : null}
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Rigori</Text>
              <Switch value={newStagePenalties} onValueChange={setNewStagePenalties} trackColor={{ false: '#ccc', true: '#a5b4fc' }} thumbColor={newStagePenalties ? '#667eea' : '#f4f3f4'} />
            </View>
            {(matchDetailsOptions.stages || []).map((s) => (
              <View key={`manage-stage-${s.id}`} style={styles.stageManageRow}>
                <Text style={styles.stageManageName}>{s.name}</Text>
                <View style={styles.stageManageActions}>
                  <TouchableOpacity style={styles.presetBtn} onPress={() => openStagePresetEditor(s)}>
                    <Text style={styles.presetBtnText}>Preset</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteChip}
                    onPress={() =>
                      setConfirmModal({
                        title: 'Elimina tipologia',
                        message: `Eliminare "${s.name}"?`,
                        confirmText: 'Elimina',
                        destructive: true,
                        onConfirm: async () => {
                          setConfirmModal(null);
                          await removeMatchDetailOption('stages', Number(s.id));
                        },
                      })
                    }
                  >
                    <Text style={styles.deleteChipText}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
        {activeTab === 'standings' && canManageCompetitions && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Classifiche - Parimerito</Text>
                <Text style={styles.label}>Competizione (gruppo leghe ufficiali)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.rowWrap}>
                {competitions.map((c) => (
                  <TouchableOpacity
                    key={`std-comp-${c.id}`}
                    style={[styles.chip, competitionId === c.id && styles.chipActive]}
                    onPress={() => {
                      setCompetitionId(c.id);
                      loadStandingsTies(c.id).catch(() => {});
                    }}
                  >
                    <Text style={[styles.chipText, competitionId === c.id && styles.chipTextActive]}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            {standingsTies.length === 0 ? <Text style={styles.muted}>Nessun parimerito attuale da risolvere.</Text> : null}
            {standingsTies.map((tie) => {
              const key = `${Number(tie.league_id)}-${Number(tie.points)}`;
              const order = tieOrders[key] || [];
              const teamMap = new Map((tie.teams || []).map((t) => [Number(t.team_id), t]));
              return (
                <View key={`tie-${key}`} style={styles.tieCard}>
                  <Text style={styles.groupName}>{tie.league_name}</Text>
                  <Text style={styles.groupMeta}>Pari a {tie.points} punti</Text>
                  {order.map((teamId, idx) => {
                    const t = teamMap.get(Number(teamId));
                    if (!t) return null;
                    return (
                      <View key={`tie-team-${key}-${teamId}`} style={styles.tieRow}>
                        <Text style={styles.tiePos}>{idx + 1}</Text>
                        <Text style={styles.tieTeam}>{t.team_name} (DR {t.goal_diff})</Text>
                        <View style={styles.tieArrows}>
                          <TouchableOpacity style={styles.iconBtnSmall} onPress={() => moveTieTeam(key, idx, -1)} disabled={idx === 0}>
                            <Ionicons name="chevron-up" size={16} color={idx === 0 ? '#bbb' : '#333'} />
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.iconBtnSmall} onPress={() => moveTieTeam(key, idx, 1)} disabled={idx === order.length - 1}>
                            <Ionicons name="chevron-down" size={16} color={idx === order.length - 1 ? '#bbb' : '#333'} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                  <TouchableOpacity style={styles.primaryBtn} onPress={() => saveTieOrder(tie)}>
                    <Text style={styles.primaryBtnText}>Salva ordine</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      <Modal
        visible={showCreateMatchForm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCreateMatchForm(false)}
      >
        <TouchableOpacity
          style={styles.confirmOverlay}
          activeOpacity={1}
          onPress={() => setShowCreateMatchForm(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.createMatchModalBox}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionTitle}>Nuova partita</Text>
              <Text style={styles.muted}>Step {createMatchStep} di 4</Text>

              {createMatchStep === 1 ? (
                <>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Nascondi partita</Text>
                    <Switch
                      value={isAdminOnly}
                      onValueChange={setIsAdminOnly}
                      trackColor={{ false: '#ccc', true: '#a5b4fc' }}
                      thumbColor={isAdminOnly ? '#667eea' : '#f4f3f4'}
                    />
                  </View>
                  <Text style={styles.label}>Data e ora inizio</Text>
                  <View style={styles.datetimeRow}>
                    <TouchableOpacity style={styles.datetimeBtn} onPress={() => openKickoffPicker('date')}>
                      <Text style={styles.datetimeBtnText}>Data: {kickoffAt.slice(0, 10)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.datetimeBtn} onPress={() => openKickoffPicker('time')}>
                      <Text style={styles.datetimeBtnText}>Ora: {kickoffAt.slice(11, 16)}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.label}>Competizione</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.rowWrap}>
                    {competitions.length === 0 ? <Text style={styles.muted}>Nessuna competizione visibile</Text> : null}
                    {competitions.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.chip, competitionId === c.id && styles.chipActive]}
                        onPress={() => {
                          setCompetitionId(c.id);
                          setHomeTeamId(null);
                          setAwayTeamId(null);
                          setSelectedLeagueIdByComp((prev) => ({ ...prev, [c.id]: 0 }));
                          setTeamsByComp((prev) => ({ ...prev, [c.id]: [] }));
                          loadLeaguesForCompetition(c.id).catch(() => {});
                        }}
                      >
                        <Text style={[styles.chipText, competitionId === c.id && styles.chipTextActive]}>{c.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                  <Text style={styles.label}>Edizione</Text>
                {!!competitionId && (leaguesByComp[competitionId] || []).length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.rowWrap}>
                        {(leaguesByComp[competitionId] || []).map((l) => {
                          const enabled = Number(selectedLeagueIdByComp[competitionId] || 0) === Number(l.id);
                          return (
                            <TouchableOpacity
                              key={`filter-league-${l.id}`}
                              style={[styles.chip, enabled && styles.chipActive]}
                              onPress={() => selectLeagueForTeams(competitionId, Number(l.id))}
                            >
                              <Text style={[styles.chipText, enabled && styles.chipTextActive]}>{leagueEditionDisplay(l)}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </ScrollView>
                  ) : (
                    <Text style={styles.muted}>Seleziona prima una competizione</Text>
                  )}
                  </>
                ) : null}

              {createMatchStep === 2 ? (
                <>
                  <Text style={styles.muted}>Se vuoi, puoi lasciare una o entrambe le squadre non definite.</Text>
                <Text style={styles.label}>Squadra casa</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.rowWrap}>
                    {selectedTeams.length === 0 ? <Text style={styles.muted}>Seleziona prima una lega ufficiale</Text> : null}
                    {selectedTeams.map((t) => (
                      <TouchableOpacity
                        key={`h-${t.id}`}
                        style={[styles.chip, homeTeamId === t.id && styles.chipActive, awayTeamId === t.id && styles.chipDisabled]}
                        disabled={awayTeamId === t.id}
                        onPress={() => setHomeTeamId(t.id)}
                      >
                        <Text style={[styles.chipText, homeTeamId === t.id && styles.chipTextActive]}>{t.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                  <Text style={styles.label}>Squadra ospite</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.rowWrap}>
                    {selectedTeams.length === 0 ? <Text style={styles.muted}>Seleziona prima una lega ufficiale</Text> : null}
                    {selectedTeams.map((t) => (
                      <TouchableOpacity
                        key={`a-${t.id}`}
                        style={[styles.chip, awayTeamId === t.id && styles.chipActive, homeTeamId === t.id && styles.chipDisabled]}
                        disabled={homeTeamId === t.id}
                        onPress={() => setAwayTeamId(t.id)}
                      >
                        <Text style={[styles.chipText, awayTeamId === t.id && styles.chipTextActive]}>{t.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                </>
              ) : null}

              {createMatchStep === 3 ? (
                <>
                <Text style={styles.label}>Luogo</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.rowWrap}>
                    {(matchDetailsOptions.venues || []).map((v) => (
                      <TouchableOpacity
                        key={`venue-create-${v.id}`}
                        style={[styles.chip, venue === v.name && styles.chipActive]}
                        onPress={() => setVenue(v.name)}
                      >
                        <Text style={[styles.chipText, venue === v.name && styles.chipTextActive]}>{v.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                <Text style={styles.label}>Arbitro</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.rowWrap}>
                    <TouchableOpacity style={[styles.chip, !referee && styles.chipActive]} onPress={() => setReferee('')}>
                      <Text style={[styles.chipText, !referee && styles.chipTextActive]}>-</Text>
                    </TouchableOpacity>
                    {(matchDetailsOptions.referees || []).map((r) => (
                      <TouchableOpacity
                        key={`ref-create-${r.id}`}
                        style={[styles.chip, referee === r.name && styles.chipActive]}
                        onPress={() => setReferee(r.name)}
                      >
                        <Text style={[styles.chipText, referee === r.name && styles.chipTextActive]}>{r.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                <Text style={styles.label}>Tipologia giornata</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.rowWrap}>
                    <TouchableOpacity style={[styles.chip, !matchStageId && styles.chipActive]} onPress={() => selectMatchStageId(null)}>
                      <Text style={[styles.chipText, !matchStageId && styles.chipTextActive]}>-</Text>
                    </TouchableOpacity>
                    {(matchDetailsOptions.stages || []).map((s) => (
                      <TouchableOpacity
                        key={`stage-create-${s.id}`}
                        style={[styles.chip, Number(matchStageId) === Number(s.id) && styles.chipActive]}
                        onPress={() => selectMatchStageId(s.id)}
                      >
                        <Text style={[styles.chipText, Number(matchStageId) === Number(s.id) && styles.chipTextActive]}>{s.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                {gironiStageMatchBlocked ? (
                  <Text style={{ color: '#b91c1c', fontSize: 13, marginTop: 10, fontWeight: '600' }}>
                    {gironiStageMatchBlocked}
                  </Text>
                ) : null}
                  <TouchableOpacity style={styles.inlineLinkBtn} onPress={() => setShowCreateTimingDetails((v) => !v)}>
                    <Text style={styles.inlineLinkBtnText}>
                      {showCreateTimingDetails ? 'Nascondi dettagli durata' : 'Modifica durata / supplementari / rigori'}
                    </Text>
                  </TouchableOpacity>
                  {showCreateTimingDetails ? matchTimingEditor : null}
                </>
              ) : null}

              {createMatchStep === 4 ? (
                <View style={styles.summaryBox}>
                  <Text style={styles.label}>Data e ora</Text>
                  <Text style={styles.summaryValue}>{formatDisplayDateTime(kickoffAt)}</Text>
                  <Text style={styles.label}>Competizione / Edizione</Text>
                  <Text style={styles.summaryValue}>{selectedCompetitionName} - {selectedLeagueName}</Text>
                  <Text style={styles.label}>Partita</Text>
                  <Text style={styles.summaryValue}>{selectedHomeTeamName} vs {selectedAwayTeamName}</Text>
                  <Text style={styles.label}>Luogo / Arbitro</Text>
                  <Text style={styles.summaryValue}>{venue || '-'} / {referee || '-'}</Text>
                  <Text style={styles.label}>Tipologia giornata</Text>
                  <Text style={styles.summaryValue}>{selectedStageName}</Text>
                  <TouchableOpacity
                    style={[styles.primaryBtn, !canSubmitMatch && styles.primaryBtnDisabled]}
                    disabled={!canSubmitMatch}
                    onPress={createMatch}
                  >
                    <Text style={styles.primaryBtnText}>Crea partita</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

                  <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.secondaryBtn, createMatchStep <= 1 && styles.primaryBtnDisabled]}
                  disabled={createMatchStep <= 1}
                  onPress={() => setCreateMatchStep((s) => Math.max(1, s - 1))}
                >
                  <Text style={styles.secondaryBtnText}>Indietro</Text>
                    </TouchableOpacity>
                {createMatchStep < 4 ? (
                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      {
                        flex: 1,
                        marginTop: 0,
                      },
                      ((createMatchStep === 1 && !canCreateStep1) || (createMatchStep === 2 && !canCreateStep2) || (createMatchStep === 3 && !canCreateStep3))
                        && styles.primaryBtnDisabled,
                    ]}
                    disabled={(createMatchStep === 1 && !canCreateStep1) || (createMatchStep === 2 && !canCreateStep2) || (createMatchStep === 3 && !canCreateStep3)}
                    onPress={() => setCreateMatchStep((s) => Math.min(4, s + 1))}
                  >
                    <Text style={styles.primaryBtnText}>Avanti</Text>
                    </TouchableOpacity>
                ) : null}
                  </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      <Modal
        visible={showEditMatchForm}
        transparent
        animationType="fade"
        onRequestClose={cancelEdit}
      >
        <TouchableOpacity style={styles.confirmOverlay} activeOpacity={1} onPress={cancelEdit}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.createMatchModalBox}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionTitle}>Modifica partita</Text>
              <Text style={styles.muted}>Step {editMatchStep} di 4</Text>

              {editMatchStep === 1 ? (
                <>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Nascondi partita</Text>
                    <Switch
                      value={isAdminOnly}
                      onValueChange={setIsAdminOnly}
                      trackColor={{ false: '#ccc', true: '#a5b4fc' }}
                      thumbColor={isAdminOnly ? '#667eea' : '#f4f3f4'}
                    />
                </View>
                  <Text style={styles.label}>Kickoff</Text>
                  <View style={styles.datetimeRow}>
                    <TouchableOpacity style={styles.datetimeBtn} onPress={() => openKickoffPicker('date')}>
                      <Text style={styles.datetimeBtnText}>Data: {kickoffAt.slice(0, 10)}</Text>
                        </TouchableOpacity>
                    <TouchableOpacity style={styles.datetimeBtn} onPress={() => openKickoffPicker('time')}>
                      <Text style={styles.datetimeBtnText}>Ora: {kickoffAt.slice(11, 16)}</Text>
                        </TouchableOpacity>
                      </View>
                    <Text style={styles.label}>Competizione</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.rowWrap}>
                        {competitions.map((c) => (
                          <TouchableOpacity
                            key={`edit-comp-${c.id}`}
                            style={[styles.chip, competitionId === c.id && styles.chipActive]}
                            onPress={() => {
                              setCompetitionId(c.id);
                              setHomeTeamId(null);
                              setAwayTeamId(null);
                              setSelectedLeagueIdByComp((prev) => ({ ...prev, [c.id]: 0 }));
                              setTeamsByComp((prev) => ({ ...prev, [c.id]: [] }));
                              loadLeaguesForCompetition(c.id).catch(() => {});
                            }}
                          >
                            <Text style={[styles.chipText, competitionId === c.id && styles.chipTextActive]}>{c.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                    {!!competitionId && (leaguesByComp[competitionId] || []).length > 0 ? (
                      <>
                      <Text style={styles.label}>Edizione</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          <View style={styles.rowWrap}>
                            {(leaguesByComp[competitionId] || []).map((l) => {
                              const enabled = Number(selectedLeagueIdByComp[competitionId] || 0) === Number(l.id);
                              return (
                                <TouchableOpacity
                                  key={`edit-filter-league-${l.id}`}
                                  style={[styles.chip, enabled && styles.chipActive]}
                                  onPress={() => selectLeagueForTeams(competitionId, Number(l.id))}
                                >
                                  <Text style={[styles.chipText, enabled && styles.chipTextActive]}>{leagueEditionDisplay(l)}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        </ScrollView>
                      </>
                    ) : null}
                </>
              ) : null}

              {editMatchStep === 2 ? (
                <>
                    <Text style={styles.label}>Squadra casa</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.rowWrap}>
                        {selectedTeams.map((t) => (
                          <TouchableOpacity
                            key={`edit-h-${t.id}`}
                            style={[styles.chip, homeTeamId === t.id && styles.chipActive, awayTeamId === t.id && styles.chipDisabled]}
                            disabled={awayTeamId === t.id}
                            onPress={() => setHomeTeamId(t.id)}
                          >
                            <Text style={[styles.chipText, homeTeamId === t.id && styles.chipTextActive]}>{t.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                    <Text style={styles.label}>Squadra trasferta</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.rowWrap}>
                        {selectedTeams.map((t) => (
                          <TouchableOpacity
                            key={`edit-a-${t.id}`}
                            style={[styles.chip, awayTeamId === t.id && styles.chipActive, homeTeamId === t.id && styles.chipDisabled]}
                            disabled={homeTeamId === t.id}
                            onPress={() => setAwayTeamId(t.id)}
                          >
                            <Text style={[styles.chipText, awayTeamId === t.id && styles.chipTextActive]}>{t.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                </>
              ) : null}

              {editMatchStep === 3 ? (
                <>
                    <Text style={styles.label}>Luogo</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.rowWrap}>
                        {(matchDetailsOptions.venues || []).map((v) => (
                          <TouchableOpacity
                            key={`venue-edit-${v.id}`}
                            style={[styles.chip, venue === v.name && styles.chipActive]}
                            onPress={() => setVenue(v.name)}
                          >
                            <Text style={[styles.chipText, venue === v.name && styles.chipTextActive]}>{v.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                    <Text style={styles.label}>Arbitro</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.rowWrap}>
                        <TouchableOpacity style={[styles.chip, !referee && styles.chipActive]} onPress={() => setReferee('')}>
                          <Text style={[styles.chipText, !referee && styles.chipTextActive]}>-</Text>
                        </TouchableOpacity>
                        {(matchDetailsOptions.referees || []).map((r) => (
                          <TouchableOpacity
                            key={`ref-edit-${r.id}`}
                            style={[styles.chip, referee === r.name && styles.chipActive]}
                            onPress={() => setReferee(r.name)}
                          >
                            <Text style={[styles.chipText, referee === r.name && styles.chipTextActive]}>{r.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                    <Text style={styles.label}>Tipologia giornata</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.rowWrap}>
                        <TouchableOpacity style={[styles.chip, !matchStageId && styles.chipActive]} onPress={() => selectMatchStageId(null)}>
                          <Text style={[styles.chipText, !matchStageId && styles.chipTextActive]}>-</Text>
                        </TouchableOpacity>
                        {(matchDetailsOptions.stages || []).map((s) => (
                          <TouchableOpacity
                            key={`stage-edit-${s.id}`}
                            style={[styles.chip, Number(matchStageId) === Number(s.id) && styles.chipActive]}
                            onPress={() => selectMatchStageId(s.id)}
                          >
                            <Text style={[styles.chipText, Number(matchStageId) === Number(s.id) && styles.chipTextActive]}>{s.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                    {gironiStageMatchBlocked ? (
                      <Text style={{ color: '#b91c1c', fontSize: 13, marginTop: 10, fontWeight: '600' }}>
                        {gironiStageMatchBlocked}
                      </Text>
                    ) : null}
                  <TouchableOpacity style={styles.inlineLinkBtn} onPress={() => setShowEditTimingDetails((v) => !v)}>
                    <Text style={styles.inlineLinkBtnText}>
                      {showEditTimingDetails ? 'Nascondi dettagli durata' : 'Modifica durata / supplementari / rigori'}
                    </Text>
                    </TouchableOpacity>
                  {showEditTimingDetails ? matchTimingEditor : null}
                </>
              ) : null}

              {editMatchStep === 4 ? (
                <>
                  <Text style={styles.label}>Riepilogo modifiche</Text>
                  {editChangeRows.length === 0 ? (
                    <Text style={styles.muted}>Nessuna modifica rispetto ai valori originali.</Text>
                  ) : (
                    <View style={styles.summaryBox}>
                      {editChangeRows.map((r, idx) => (
                        <View key={`edit-diff-${idx}`} style={styles.editDiffRow}>
                          <Text style={styles.editDiffLabel}>{r.label}</Text>
                          <View style={styles.editDiffValuesRow}>
                            <Text style={styles.editDiffBefore}>{r.before}</Text>
                            <Ionicons name="arrow-forward" size={14} color="#64748b" />
                            <Text style={styles.editDiffAfter}>{r.after}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
                  <TouchableOpacity style={[styles.primaryBtn, { marginTop: 10 }]} onPress={saveEditedMatch}>
                    <Text style={styles.primaryBtnText}>Salva modifica partita</Text>
              </TouchableOpacity>
                </>
              ) : null}

            <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.secondaryBtn, editMatchStep <= 1 && styles.primaryBtnDisabled]}
                  disabled={editMatchStep <= 1}
                  onPress={() => setEditMatchStep((s) => Math.max(1, s - 1))}
                >
                  <Text style={styles.secondaryBtnText}>Indietro</Text>
                </TouchableOpacity>
                {editMatchStep < 4 ? (
                <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      { flex: 1, marginTop: 0 },
                      ((editMatchStep === 1 && !canCreateStep1) ||
                        (editMatchStep === 2 && !canCreateStep2) ||
                        (editMatchStep === 3 && !canCreateStep3)) &&
                        styles.primaryBtnDisabled,
                    ]}
                    disabled={
                      (editMatchStep === 1 && !canCreateStep1) ||
                      (editMatchStep === 2 && !canCreateStep2) ||
                      (editMatchStep === 3 && !canCreateStep3)
                    }
                    onPress={() => setEditMatchStep((s) => Math.min(4, s + 1))}
                >
                    <Text style={styles.primaryBtnText}>Avanti</Text>
                </TouchableOpacity>
            ) : null}
              </View>
            </ScrollView>
                          </TouchableOpacity>
                          </TouchableOpacity>
      </Modal>
      {showKickoffPicker ? (
        <DateTimePicker
          value={kickoffDateObj}
          mode={kickoffPickerMode}
          is24Hour
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onKickoffChange}
        />
      ) : null}
      {showFilterDatePicker ? (
        <DateTimePicker
          value={String(date || '').trim() ? parseSqlDateTime(`${date} 00:00:00`) : new Date()}
          mode="date"
          is24Hour
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onFilterDateChange}
        />
      ) : null}
      {toastMsg ? (
        <View
          style={[
            styles.toast,
            { bottom: Math.max(insets.bottom + 12, 84) },
            toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError,
          ]}
        >
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      ) : null}
      <Modal
        visible={!!stagePresetModal && !!stagePresetDraft}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setStagePresetModal(null);
          setStagePresetDraft(null);
        }}
      >
        <TouchableOpacity
          style={styles.confirmOverlay}
          activeOpacity={1}
          onPress={() => {
            setStagePresetModal(null);
            setStagePresetDraft(null);
          }}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>Preset: {stagePresetModal?.name}</Text>
            <Text style={styles.muted}>Valori suggeriti quando si sceglie questa tipologia in una partita.</Text>
            <Text style={styles.label}>Minuti per tempo (regolamentari)</Text>
            <View style={styles.rowWrap}>
              {[30, 45].map((m) => (
                <TouchableOpacity
                  key={`pd-half-${m}`}
                  style={[styles.chip, stagePresetDraft?.half === String(m) && styles.chipActive]}
                  onPress={() => setStagePresetDraft((d) => (d ? { ...d, half: String(m) } : d))}
                >
                  <Text style={[styles.chipText, stagePresetDraft?.half === String(m) && styles.chipTextActive]}>{m}′</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={stagePresetDraft?.half ?? ''}
              onChangeText={(t) => setStagePresetDraft((d) => (d ? { ...d, half: t } : d))}
              keyboardType="number-pad"
              placeholder="15–60"
            />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Supplementari</Text>
              <Switch
                value={!!stagePresetDraft?.extraTime}
                onValueChange={(v) =>
                  setStagePresetDraft((d) => (d ? { ...d, extraTime: v, extraSecondHalfEnabled: v ? true : d.extraSecondHalfEnabled } : d))
                }
                trackColor={{ false: '#ccc', true: '#a5b4fc' }}
                thumbColor={stagePresetDraft?.extraTime ? '#667eea' : '#f4f3f4'}
              />
            </View>
            {stagePresetDraft?.extraTime ? (
              <>
                <Text style={styles.label}>1° supplementare (min)</Text>
                <TextInput
                  style={styles.input}
                  value={stagePresetDraft?.ex1 ?? ''}
                  onChangeText={(t) => setStagePresetDraft((d) => (d ? { ...d, ex1: t } : d))}
                  keyboardType="number-pad"
                />
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>2° tempo supplementare</Text>
                  <Switch
                    value={!!stagePresetDraft?.extraSecondHalfEnabled}
                    onValueChange={(v) => setStagePresetDraft((d) => (d ? { ...d, extraSecondHalfEnabled: v } : d))}
                    trackColor={{ false: '#ccc', true: '#a5b4fc' }}
                    thumbColor={stagePresetDraft?.extraSecondHalfEnabled ? '#667eea' : '#f4f3f4'}
                  />
                </View>
                {stagePresetDraft?.extraSecondHalfEnabled ? (
                  <>
                <Text style={styles.label}>2° supplementare (min)</Text>
                <TextInput
                  style={styles.input}
                  value={stagePresetDraft?.ex2 ?? ''}
                  onChangeText={(t) => setStagePresetDraft((d) => (d ? { ...d, ex2: t } : d))}
                  keyboardType="number-pad"
                />
                  </>
                ) : null}
              </>
            ) : null}
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Rigori</Text>
              <Switch
                value={!!stagePresetDraft?.penalties}
                onValueChange={(v) => setStagePresetDraft((d) => (d ? { ...d, penalties: v } : d))}
                trackColor={{ false: '#ccc', true: '#a5b4fc' }}
                thumbColor={stagePresetDraft?.penalties ? '#667eea' : '#f4f3f4'}
              />
            </View>
            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={styles.confirmButtonCancel}
                onPress={() => {
                  setStagePresetModal(null);
                  setStagePresetDraft(null);
                }}
              >
                <Text style={styles.confirmButtonCancelText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmButtonConfirm} onPress={saveStagePresetFromModal}>
                <Text style={styles.confirmButtonConfirmText}>Salva preset</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      <Modal
        visible={!!confirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmModal(null)}
      >
        <TouchableOpacity style={styles.confirmOverlay} activeOpacity={1} onPress={() => setConfirmModal(null)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>{confirmModal?.title}</Text>
            <Text style={styles.confirmMessage}>{confirmModal?.message}</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={styles.confirmButtonCancel} onPress={() => setConfirmModal(null)}>
                <Text style={styles.confirmButtonCancelText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButtonConfirm, confirmModal?.destructive && styles.confirmButtonDestructive]}
                onPress={confirmModal?.onConfirm}
              >
                <Text style={[styles.confirmButtonConfirmText, confirmModal?.destructive && styles.confirmButtonDestructiveText]}>
                  {confirmModal?.confirmText || 'Conferma'}
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ececec',
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#222' },
  subtabsScroll: {
    flexGrow: 0,
  },
  subtabsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    paddingRight: 22,
  },
  subtabBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  subtabBtnActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  subtabText: { color: '#333', fontWeight: '700' },
  subtabTextActive: { color: '#fff' },
  subtabsRowInner: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  matchesTopBar: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  matchesTopBarTitle: { fontSize: 14, fontWeight: '800', color: '#334155' },
  matchesPlusBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filtersIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  iconFilterBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconFilterBtnActive: {
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
  },
  inlineLinkBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  inlineLinkBtnText: {
    color: '#475569',
    fontWeight: '700',
    fontSize: 12,
  },
  summaryBox: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#f8fafc',
  },
  summaryValue: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '700',
  },
  editDiffRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  editDiffLabel: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  editDiffValuesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editDiffBefore: {
    flex: 1,
    minWidth: 0,
    color: '#64748b',
    fontSize: 12,
    textDecorationLine: 'line-through',
  },
  editDiffAfter: {
    flex: 1,
    minWidth: 0,
    color: '#0f766e',
    fontSize: 12,
    fontWeight: '700',
  },
  content: { flex: 1, paddingHorizontal: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  denied: { color: '#d9534f', fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#ececec' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 8 },
  label: { fontSize: 12, color: '#666', marginTop: 8, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fafafa' },
  datetimeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  datetimeBtn: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 10, backgroundColor: '#fafafa' },
  datetimeBtnText: { color: '#222', fontWeight: '600', textAlign: 'center' },
  rowWrap: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  chip: { borderWidth: 1, borderColor: '#ddd', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff' },
  chipActive: { backgroundColor: '#667eea', borderColor: '#667eea' },
  chipDisabled: { opacity: 0.45 },
  chipText: { color: '#333', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  deleteChip: { borderWidth: 1, borderColor: '#f0b7bb', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff5f6' },
  deleteChipText: { color: '#b42318', fontSize: 12, fontWeight: '700' },
  detailDropdownHeader: {
    marginTop: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailDropdownHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  detailDropdownHeaderText: { color: '#334155', fontSize: 13, fontWeight: '800' },
  refereeList: { gap: 8, paddingVertical: 4 },
  refereeDeleteRow: {
    borderWidth: 1,
    borderColor: '#f0b7bb',
    borderRadius: 12,
    backgroundColor: '#fff5f6',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  refereeDeleteName: { flex: 1, color: '#7f1d1d', fontSize: 13, fontWeight: '700' },
  refereeDeleteIcon: { color: '#b42318', fontSize: 14, fontWeight: '900' },
  primaryBtn: { backgroundColor: '#667eea', borderRadius: 8, alignItems: 'center', paddingVertical: 11, marginTop: 12 },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  matchRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f1f1f1', paddingTop: 10, marginTop: 10 },
  compText: { fontWeight: '700', color: '#333' },
  matchText: { color: '#222' },
  muted: { color: '#777', fontSize: 12 },
  deleteBtn: { backgroundColor: '#dc3545', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  deleteBtnText: { color: '#fff', fontWeight: '700' },
  editBtn: { backgroundColor: '#0d6efd', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  editBtnText: { color: '#fff', fontWeight: '700' },
  matchActionsCol: { gap: 8 },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  secondaryBtn: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
  },
  secondaryBtnText: { color: '#333', fontWeight: '700' },
  groupRow: { borderTopWidth: 1, borderTopColor: '#f1f1f1', paddingTop: 10, marginTop: 10 },
  groupName: { color: '#222', fontWeight: '700', marginBottom: 6 },
  groupMeta: { color: '#777', fontSize: 12, marginTop: 2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, paddingVertical: 2 },
  switchLabel: { color: '#333', fontWeight: '600', fontSize: 13, flex: 1 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkboxBase: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#98a2b3',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#667eea', borderColor: '#667eea' },
  checkboxTick: { color: '#fff', fontWeight: '800', fontSize: 13, lineHeight: 14 },
  checkboxLabel: { color: '#333', fontWeight: '700' },
  tieCard: { borderTopWidth: 1, borderTopColor: '#f1f1f1', marginTop: 12, paddingTop: 10 },
  tieRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  tiePos: { width: 22, textAlign: 'center', fontWeight: '800', color: '#333' },
  tieTeam: { flex: 1, color: '#222', fontWeight: '600' },
  tieArrows: { flexDirection: 'row', gap: 6 },
  iconBtnSmall: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff' },
  toast: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 16,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    elevation: 6,
  },
  toastError: { backgroundColor: '#dc3545' },
  toastSuccess: { backgroundColor: '#28a745' },
  toastText: { color: '#fff', fontWeight: '600', flex: 1 },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  confirmBox: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
  },
  createMatchModalBox: {
    width: '100%',
    maxHeight: '90%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  confirmTitle: { fontSize: 18, fontWeight: '700', color: '#222', marginBottom: 8 },
  confirmMessage: { fontSize: 14, color: '#555' },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  confirmButtonCancel: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  confirmButtonCancelText: { color: '#444', fontWeight: '700' },
  confirmButtonConfirm: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#667eea',
  },
  confirmButtonDestructive: { backgroundColor: '#dc3545' },
  confirmButtonConfirmText: { color: '#fff', fontWeight: '700' },
  confirmButtonDestructiveText: { color: '#fff' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingVertical: 4,
  },
  switchLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: '#333', paddingRight: 12 },
  stageManageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#f1f1f1',
    paddingTop: 10,
    marginTop: 10,
    gap: 8,
  },
  stageManageName: { flex: 1, fontWeight: '700', color: '#222' },
  stageManageActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  presetBtn: {
    backgroundColor: '#eef2ff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  presetBtnText: { color: '#4338ca', fontWeight: '700', fontSize: 12 },
});


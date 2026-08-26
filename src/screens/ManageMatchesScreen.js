import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
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
import {
  canOpenMatchManagement as roleCanOpenMatchManagement,
  canOpenSuperUserPanel as roleCanManageMatchDetails,
} from '../utils/userRoles';
import { adminCompetitionsService, adminMatchDetailsService, adminMatchesService, superuserService } from '../services/api';
import { parseAppDate } from '../utils/dateTime';

/** Deve coincidere con `official_match_stages.id` per la tipologia «Gironi» (di solito 1). */
const OFFICIAL_MATCH_STAGE_GIRONI_ID = 1;

const MATCH_WIZARD_STEPS = [
  { id: 1, label: 'Quando' },
  { id: 2, label: 'Squadre' },
  { id: 3, label: 'Dettagli' },
  { id: 4, label: 'Conferma' },
];

const TOAST_DURATION_MS = 2400;
const CREATE_MATCH_MODAL_MAX_HEIGHT_RATIO = 0.98;
const CREATE_MATCH_MODAL_SCROLL_MAX_HEIGHT = Math.round(Dimensions.get('window').height * CREATE_MATCH_MODAL_MAX_HEIGHT_RATIO) - 28;

function clampShootoutRoundsInput(raw) {
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, n));
}

function MatchWizardProgress({ step, styles: s }) {
  return (
    <View style={s.wizardProgress}>
      {MATCH_WIZARD_STEPS.map((item) => {
        const active = Number(step) === item.id;
        const done = Number(step) > item.id;
        return (
          <View key={item.id} style={s.wizardProgressItem}>
            <View
              style={[
                s.wizardProgressDot,
                active ? s.wizardProgressDotActive : null,
                done ? s.wizardProgressDotDone : null,
              ]}
            >
              {done ? (
                <Ionicons name="checkmark" size={12} color="#fff" />
              ) : (
                <Text style={[s.wizardProgressDotText, active ? s.wizardProgressDotTextActive : null]}>
                  {item.id}
                </Text>
              )}
            </View>
            <Text
              style={[s.wizardProgressLabel, active ? s.wizardProgressLabelActive : null]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function MatchWizardHeader({ title, step, onClose, styles: s }) {
  const stepMeta = MATCH_WIZARD_STEPS.find((x) => x.id === Number(step)) || MATCH_WIZARD_STEPS[0];
  return (
    <View style={s.wizardHeader}>
      <View style={s.wizardHeaderText}>
        <Text style={s.wizardTitle}>{title}</Text>
        <Text style={s.wizardSubtitle}>
          Passo {stepMeta.id} · {stepMeta.label}
        </Text>
      </View>
      <TouchableOpacity style={s.wizardCloseBtn} onPress={onClose} accessibilityLabel="Chiudi">
        <Ionicons name="close" size={20} color="#64748b" />
      </TouchableOpacity>
    </View>
  );
}

function MatchWizardFooter({
  step,
  canGoNext,
  onBack,
  onNext,
  styles: s,
}) {
  const isLast = Number(step) >= 4;
  return (
    <View style={s.wizardFooter}>
      <TouchableOpacity
        style={[s.wizardBackBtn, Number(step) <= 1 && s.primaryBtnDisabled]}
        disabled={Number(step) <= 1}
        onPress={onBack}
      >
        <Text style={s.wizardBackBtnText}>Indietro</Text>
      </TouchableOpacity>
      {!isLast ? (
        <TouchableOpacity
          style={[s.wizardNextBtn, !canGoNext && s.primaryBtnDisabled]}
          disabled={!canGoNext}
          onPress={onNext}
        >
          <Text style={s.wizardNextBtnText}>Avanti</Text>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </TouchableOpacity>
      ) : (
        <View style={s.wizardFooterSpacer} />
      )}
    </View>
  );
}

function ShootoutConfigFields({ enabled, onEnabledChange, rounds, onRoundsChange, chipKeyPrefix, styles }) {
  return (
    <>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Shootout</Text>
        <Switch
          value={enabled}
          onValueChange={onEnabledChange}
          trackColor={{ false: '#ccc', true: '#a5b4fc' }}
          thumbColor={enabled ? '#667eea' : '#f4f3f4'}
        />
      </View>
      {enabled ? (
        <>
          <Text style={styles.label}>Tiri a squadra (1–10)</Text>
          <View style={styles.rowWrap}>
            {[3, 5, 7, 10].map((n) => (
              <TouchableOpacity
                key={`${chipKeyPrefix}-shootout-${n}`}
                style={[styles.chip, rounds === String(n) && styles.chipActive]}
                onPress={() => onRoundsChange(String(n))}
              >
                <Text style={[styles.chipText, rounds === String(n) && styles.chipTextActive]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={rounds}
            onChangeText={onRoundsChange}
            keyboardType="number-pad"
            placeholder="1–10"
            placeholderTextColor="#999"
          />
        </>
      ) : null}
    </>
  );
}

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

function stagePresetSummary(s) {
  if (!s) return '';
  const parts = [`${Number(s.default_regulation_half_minutes ?? 30) || 30}′`];
  if (Number(s.default_extra_time_enabled)) parts.push('suppl.');
  if (Number(s.default_penalties_enabled)) parts.push('rigori');
  if (Number(s.default_shootout_enabled)) {
    parts.push(`SO ${Number(s.default_shootout_rounds_per_team ?? 5) || 5}`);
  }
  return parts.join(' · ');
}

function sortByNameIt(list) {
  return [...(list || [])].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'it'));
}

function enrichMatchRow(m) {
  const homeName = String(m.home_team_name || '').trim() || 'Da definire';
  const awayName = String(m.away_team_name || '').trim() || 'Da definire';
  const homeMissing = !(Number.isFinite(Number(m.home_team_id)) && Number(m.home_team_id) > 0);
  const awayMissing = !(Number.isFinite(Number(m.away_team_id)) && Number(m.away_team_id) > 0);
  const isHidden = Number(m?.is_admin_only || 0) === 1;
  const stageName = String(m.match_stage || '').trim();
  const metaParts = [
    String(m.competition_name || '').trim(),
    stageName,
    formatDisplayDateTime(m.kickoff_at),
  ].filter(Boolean);
  return {
    ...m,
    _homeName: homeName,
    _awayName: awayName,
    _homeMissing: homeMissing,
    _awayMissing: awayMissing,
    _isHidden: isHidden,
    _metaLine: metaParts.join(' · '),
  };
}

const ManageMatchRow = React.memo(function ManageMatchRow({
  match,
  isFirst,
  styles: s,
  onEdit,
  onDelete,
}) {
  return (
    <View style={[s.matchCard, isFirst && s.matchCardFirst]}>
      <View style={s.matchCardBody}>
        <View style={s.matchCardTitleRow}>
          <Text style={s.matchCardTitle} numberOfLines={2}>
            <Text style={match._homeMissing ? s.matchTeamMissing : null}>{match._homeName}</Text>
            <Text style={s.matchVs}> · </Text>
            <Text style={match._awayMissing ? s.matchTeamMissing : null}>{match._awayName}</Text>
          </Text>
          {match._isHidden ? (
            <View style={s.hiddenBadge}>
              <Ionicons name="eye-off-outline" size={11} color="#7a6100" />
              <Text style={s.hiddenBadgeText}>Nascosta</Text>
            </View>
          ) : null}
        </View>
        <Text style={s.matchCardMeta} numberOfLines={2}>
          {match._metaLine}
        </Text>
      </View>
      <View style={s.matchCardActions}>
        <TouchableOpacity
          style={s.matchIconBtn}
          onPress={() => onEdit(match)}
          accessibilityLabel="Modifica partita"
        >
          <Ionicons name="create-outline" size={18} color="#667eea" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.matchIconBtn, s.matchIconBtnDanger]}
          onPress={() => onDelete(match.id)}
          accessibilityLabel="Elimina partita"
        >
          <Ionicons name="trash-outline" size={17} color="#b42318" />
        </TouchableOpacity>
      </View>
    </View>
  );
});

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
  const canManageMatches = roleCanOpenMatchManagement(su);
  const canManageCompetitions = roleCanManageMatchDetails(su);
  const canManageMatchDetails = roleCanManageMatchDetails(su);

  const [activeTab, setActiveTab] = useState('matches');
  const [showCreateMatchForm, setShowCreateMatchForm] = useState(false);
  const [createMatchStep, setCreateMatchStep] = useState(1);
  const [showCreateTimingDetails, setShowCreateTimingDetails] = useState(false);
  const [showEditMatchForm, setShowEditMatchForm] = useState(false);
  const [editMatchStep, setEditMatchStep] = useState(1);
  const [showEditTimingDetails, setShowEditTimingDetails] = useState(false);
  const [editOriginal, setEditOriginal] = useState(null);
  const [editHydrating, setEditHydrating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [filterBusy, setFilterBusy] = useState(false);
  const [filterYear, setFilterYear] = useState(() => new Date().getFullYear());
  const [date, setDate] = useState('');
  const [showPeriodFilters, setShowPeriodFilters] = useState(false);
  const [competitions, setCompetitions] = useState([]); // gruppi ufficiali usati come competizioni
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
  const [shootoutEnabled, setShootoutEnabled] = useState(false);
  const [shootoutRoundsPerTeam, setShootoutRoundsPerTeam] = useState('5');
  const [newStageHalfMin, setNewStageHalfMin] = useState('30');
  const [newStageExtraTime, setNewStageExtraTime] = useState(false);
  const [newStageExtra1, setNewStageExtra1] = useState('15');
  const [newStageExtra2, setNewStageExtra2] = useState('15');
  const [newStageExtraSecondEnabled, setNewStageExtraSecondEnabled] = useState(true);
  const [newStagePenalties, setNewStagePenalties] = useState(false);
  const [newStageShootout, setNewStageShootout] = useState(false);
  const [newStageShootoutRounds, setNewStageShootoutRounds] = useState('5');
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
  const [detailsSectionOpen, setDetailsSectionOpen] = useState(null); // venues | referees | stages
  const [newStageFormOpen, setNewStageFormOpen] = useState(false);
  const [editingRefereeId, setEditingRefereeId] = useState(null);
  const [refereeEditDraft, setRefereeEditDraft] = useState('');
  const [refereeEditOriginal, setRefereeEditOriginal] = useState('');
  const [savingRefereeId, setSavingRefereeId] = useState(null);
  const mainScrollRef = useRef(null);
  const createMatchScrollRef = useRef(null);
  const editMatchScrollRef = useRef(null);
  const scrollContentRef = useRef(null);
  const refereeRowRefs = useRef({});
  const scrollYRef = useRef(0);
  const keyboardHeightRef = useRef(Platform.OS === 'ios' ? 320 : 280);
  const leaguesByCompRef = useRef({});
  const teamsByCompRef = useRef({});
  const teamsLoadedForLeagueRef = useRef({});
  const leaguesInflightRef = useRef({});
  const teamsInflightRef = useRef({});
  const editHydrateGenRef = useRef(0);
  const [standingsTies, setStandingsTies] = useState([]);
  const [tieOrders, setTieOrders] = useState({});
  const [standingsCompetitionId, setStandingsCompetitionId] = useState(null);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [savingTieKey, setSavingTieKey] = useState(null);
  const standingsCacheRef = useRef({});
  const standingsInflightRef = useRef({});

  useEffect(() => {
    leaguesByCompRef.current = leaguesByComp;
  }, [leaguesByComp]);

  useEffect(() => {
    teamsByCompRef.current = teamsByComp;
  }, [teamsByComp]);

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
    return teamsByComp[competitionId] || [];
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

  useEffect(() => {
    if (!showCreateTimingDetails) return;
    const timer = setTimeout(() => {
      createMatchScrollRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(timer);
  }, [showCreateTimingDetails, createMatchStep]);

  useEffect(() => {
    if (!showEditTimingDetails) return;
    const timer = setTimeout(() => {
      editMatchScrollRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(timer);
  }, [showEditTimingDetails, editMatchStep]);

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

  const matchesFilterSummary = useMemo(() => {
    const chips = [];
    const currentYear = new Date().getFullYear();
    if (String(date || '').trim()) {
      chips.push({ key: 'date', label: String(date).trim(), clear: () => setDate('') });
    } else if (Number(filterYear) !== currentYear) {
      chips.push({
        key: 'year',
        label: `Anno ${filterYear}`,
        clear: () => setFilterYear(currentYear),
      });
    }
    if (filterCompetitionId) {
      const name = competitions.find((c) => Number(c.id) === Number(filterCompetitionId))?.name || 'Competizione';
      chips.push({
        key: 'comp',
        label: name,
        clear: () => {
          setFilterCompetitionId(null);
          setFilterLeagueId(null);
          setFilterTeamId(null);
          setFilterTeams([]);
          setFilterMissingTeamsOnly(false);
        },
      });
    }
    if (filterLeagueId) {
      const league = (leaguesByComp[filterCompetitionId] || []).find((l) => Number(l.id) === Number(filterLeagueId));
      chips.push({
        key: 'league',
        label: leagueEditionDisplay(league) || 'Edizione',
        clear: () => {
          setFilterLeagueId(null);
          setFilterTeamId(null);
          setFilterTeams([]);
        },
      });
    }
    if (filterTeamId) {
      const team = filterTeams.find((t) => Number(t.id) === Number(filterTeamId));
      chips.push({
        key: 'team',
        label: team?.name || 'Squadra',
        clear: () => setFilterTeamId(null),
      });
    }
    if (filterMissingTeamsOnly) {
      chips.push({ key: 'missing', label: 'Squadre da definire', clear: () => setFilterMissingTeamsOnly(false) });
    }
    if (filterVisibility === 'hidden') {
      chips.push({ key: 'vis', label: 'Solo nascoste', clear: () => setFilterVisibility('visible') });
    } else if (filterVisibility === 'all') {
      chips.push({ key: 'vis', label: 'Visibilità: tutte', clear: () => setFilterVisibility('visible') });
    }
    return chips;
  }, [
    date,
    filterYear,
    filterCompetitionId,
    filterLeagueId,
    filterTeamId,
    filterMissingTeamsOnly,
    filterVisibility,
    competitions,
    leaguesByComp,
    filterTeams,
  ]);

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
    pushRow('Shootout', editOriginal.shootoutEnabled ? 'Si' : 'No', shootoutEnabled ? 'Si' : 'No');
    if (editOriginal.shootoutEnabled || shootoutEnabled) {
      pushRow('Tiri shootout', String(editOriginal.shootoutRoundsPerTeam || 5), String(shootoutRoundsPerTeam || 5));
    }
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
    shootoutEnabled,
    shootoutRoundsPerTeam,
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
    return list;
  };

  const loadMatches = async () => {
    setMatchesLoading(true);
    try {
      const cleanDate = String(date || '').trim();
      const res = await adminMatchesService.getList({
        date: cleanDate || undefined,
        year: cleanDate ? undefined : filterYear,
      });
      const list = Array.isArray(res?.data?.matches) ? res.data.matches : [];
      setMatches(list.map(enrichMatchRow));
    } finally {
      setMatchesLoading(false);
    }
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

  const applyStandingsTiesPayload = useCallback((ties) => {
    const list = Array.isArray(ties) ? ties : [];
    setStandingsTies(list);
    const nextOrders = {};
    list.forEach((t) => {
      const key = `${Number(t.league_id)}-${Number(t.points)}`;
      nextOrders[key] = (Array.isArray(t.teams) ? t.teams : []).map((x) => Number(x.team_id));
    });
    setTieOrders(nextOrders);
  }, []);

  const standingsCompetitionIdRef = useRef(standingsCompetitionId);
  useEffect(() => {
    standingsCompetitionIdRef.current = standingsCompetitionId;
  }, [standingsCompetitionId]);

  const loadStandingsTies = useCallback(async (competitionIdParam, { force = false } = {}) => {
    if (!canManageCompetitions || !competitionIdParam) return;
    const cid = Number(competitionIdParam);
    if (!Number.isFinite(cid) || cid <= 0) return;

    const applyIfCurrent = (ties) => {
      if (Number(standingsCompetitionIdRef.current) !== cid) return;
      applyStandingsTiesPayload(ties);
    };

    if (!force) {
      const cached = standingsCacheRef.current[cid];
      if (cached) {
        applyIfCurrent(cached.ties);
        if (Number(standingsCompetitionIdRef.current) === cid) setStandingsLoading(false);
        return;
      }
      if (standingsInflightRef.current[cid]) {
        setStandingsLoading(true);
        try {
          const ties = await standingsInflightRef.current[cid];
          applyIfCurrent(ties);
        } finally {
          if (Number(standingsCompetitionIdRef.current) === cid) setStandingsLoading(false);
        }
        return;
      }
    }

    const promise = (async () => {
      const res = await adminMatchesService.getStandingsTies(cid);
      const ties = Array.isArray(res?.data?.ties) ? res.data.ties : [];
      standingsCacheRef.current[cid] = { ties };
      return ties;
    })();
    standingsInflightRef.current[cid] = promise;
    setStandingsLoading(true);
    try {
      const ties = await promise;
      applyIfCurrent(ties);
    } catch (e) {
      if (Number(standingsCompetitionIdRef.current) === cid) {
        applyStandingsTiesPayload([]);
      }
      throw e;
    } finally {
      delete standingsInflightRef.current[cid];
      if (Number(standingsCompetitionIdRef.current) === cid) setStandingsLoading(false);
    }
  }, [applyStandingsTiesPayload, canManageCompetitions]);

  const loadLeaguesForCompetition = async (compId, { force = false } = {}) => {
    if (!compId) return [];
    const cached = leaguesByCompRef.current[compId];
    if (!force && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }
    if (!force && leaguesInflightRef.current[compId]) {
      return leaguesInflightRef.current[compId];
    }
    const promise = (async () => {
      try {
        const res = await adminMatchesService.getCompetitionTeams(compId, [], true);
        const leagues = Array.isArray(res?.data?.official_leagues) ? res.data.official_leagues : [];
        leaguesByCompRef.current = { ...leaguesByCompRef.current, [compId]: leagues };
        setLeaguesByComp((prev) => ({ ...prev, [compId]: leagues }));
        return leagues;
      } finally {
        delete leaguesInflightRef.current[compId];
      }
    })();
    leaguesInflightRef.current[compId] = promise;
    return promise;
  };

  /**
   * Squadre della sola lega scelta. Passa overrideLeagueId subito dopo aver scelto la lega (setState è asincrono).
   * Senza lega valida: nessuna chiamata con tutte le leghe — lista vuota.
   */
  const loadTeamsForCompetition = async (compId, overrideLeagueId = undefined, { force = false } = {}) => {
    if (!compId) return [];
    const fromState = Number(selectedLeagueIdByComp[compId] || 0);
    const selectedLeagueId =
      overrideLeagueId !== undefined && overrideLeagueId !== null
        ? Number(overrideLeagueId)
        : fromState;

    if (selectedLeagueId <= 0) {
      teamsLoadedForLeagueRef.current[compId] = 0;
      setTeamsByComp((prev) => ({ ...prev, [compId]: [] }));
      return [];
    }

    if (
      !force
      && Number(teamsLoadedForLeagueRef.current[compId] || 0) === selectedLeagueId
    ) {
      return teamsByCompRef.current[compId] || [];
    }

    const inflightKey = `${compId}:${selectedLeagueId}`;
    if (!force && teamsInflightRef.current[inflightKey]) {
      return teamsInflightRef.current[inflightKey];
    }

    const promise = (async () => {
      try {
        const res = await adminMatchesService.getCompetitionTeams(compId, [selectedLeagueId]);
        const teamsRaw = Array.isArray(res?.data?.teams) ? res.data.teams : [];
        const teams = [...teamsRaw].sort((a, b) => String(a.name).localeCompare(String(b.name), 'it'));
        const leagues = Array.isArray(res?.data?.official_leagues) ? res.data.official_leagues : [];
        if (leagues.length > 0 && !(leaguesByCompRef.current[compId]?.length > 0)) {
          leaguesByCompRef.current = { ...leaguesByCompRef.current, [compId]: leagues };
          setLeaguesByComp((prev) => ({ ...prev, [compId]: leagues }));
        }
        teamsLoadedForLeagueRef.current[compId] = selectedLeagueId;
        setTeamsByComp((prev) => ({ ...prev, [compId]: teams }));
        return teams;
      } finally {
        delete teamsInflightRef.current[inflightKey];
      }
    })();
    teamsInflightRef.current[inflightKey] = promise;
    return promise;
  };

  const loadFilterTeamsForLeague = async (compId, leagueId) => {
    if (!compId || !leagueId) {
      setFilterTeams([]);
      return;
    }
    setFilterBusy(true);
    try {
      const res = await adminMatchesService.getCompetitionTeams(compId, [leagueId]);
      const teamsRaw = Array.isArray(res?.data?.teams) ? res.data.teams : [];
      const teams = [...teamsRaw].sort((a, b) => String(a.name).localeCompare(String(b.name), 'it'));
      setFilterTeams(teams);
    } catch (_) {
      setFilterTeams([]);
    } finally {
      setFilterBusy(false);
    }
  };

  const loadAll = async () => {
    try {
      setLoading(true);
      await Promise.all([
        loadCompetitions(),
        loadMatches(),
        loadMatchDetailsOptions(),
      ]);
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Errore caricamento');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canManageMatches) loadAll();
  }, []);

  const skipNextPeriodReloadRef = useRef(true);
  useEffect(() => {
    if (!competitionId) return;
    const cached = leaguesByCompRef.current[competitionId];
    if (Array.isArray(cached) && cached.length > 0) return;
    loadLeaguesForCompetition(competitionId).catch(() => {});
  }, [competitionId]);

  useEffect(() => {
    if (!canManageCompetitions || !competitions.length) return;
    setStandingsCompetitionId((prev) => {
      if (prev && competitions.some((c) => Number(c.id) === Number(prev))) return prev;
      if (competitionId && competitions.some((c) => Number(c.id) === Number(competitionId))) {
        return Number(competitionId);
      }
      return Number(competitions[0].id);
    });
  }, [canManageCompetitions, competitions, competitionId]);

  useEffect(() => {
    if (activeTab === 'standings' && standingsCompetitionId) {
      loadStandingsTies(standingsCompetitionId).catch(() => {});
    }
  }, [activeTab, standingsCompetitionId, loadStandingsTies]);

  useEffect(() => {
    if (!canManageMatches) return;
    if (skipNextPeriodReloadRef.current) {
      skipNextPeriodReloadRef.current = false;
      return;
    }
    loadMatches().catch(() => {});
  }, [date, filterYear]);

  const pulseFilterBusy = useCallback(() => {
    setFilterBusy(true);
    setTimeout(() => setFilterBusy(false), 280);
  }, []);

  const resetMatchTimingFields = () => {
    setRegulationHalfMinutes('30');
    setExtraTimeEnabled(false);
    setExtraFirstMinutes('15');
    setExtraSecondMinutes('15');
    setExtraSecondHalfEnabled(true);
    setPenaltiesEnabled(false);
    setShootoutEnabled(false);
    setShootoutRoundsPerTeam('5');
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
    setShootoutEnabled(!!Number(stage.default_shootout_enabled));
    setShootoutRoundsPerTeam(String(stage.default_shootout_rounds_per_team ?? 5));
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

  const patchMatchDetailsList = useCallback((key, updater) => {
    setMatchDetailsOptions((prev) => ({
      ...prev,
      [key]: updater(Array.isArray(prev?.[key]) ? prev[key] : []),
    }));
  }, []);

  const buildMatchTimingPayload = () => {
    let half = parseInt(regulationHalfMinutes, 10);
    if (!Number.isFinite(half) || half < 15 || half > 60) half = 30;
    const et = extraTimeEnabled ? 1 : 0;
    let ex1 = parseInt(extraFirstMinutes, 10);
    let ex2 = parseInt(extraSecondMinutes, 10);
    if (!Number.isFinite(ex1) || ex1 < 1 || ex1 > 45) ex1 = 15;
    if (!Number.isFinite(ex2) || ex2 < 1 || ex2 > 45) ex2 = 15;
    const useSecondExtraHalf = extraSecondHalfEnabled ? 1 : 0;
    const shootoutOn = shootoutEnabled ? 1 : 0;
    const shootoutRounds = clampShootoutRoundsInput(shootoutRoundsPerTeam);
    return {
      regulation_half_minutes: half,
      extra_time_enabled: et,
      extra_first_half_minutes: et ? ex1 : 0,
      extra_second_half_minutes: et ? (useSecondExtraHalf ? ex2 : 0) : 0,
      penalties_enabled: penaltiesEnabled ? 1 : 0,
      shootout_enabled: shootoutOn,
      shootout_rounds_per_team: shootoutOn ? shootoutRounds : 5,
    };
  };

  const buildStageDefaultsPayload = (halfStr, etOn, ex1Str, ex2Str, secondExtraHalfOn, penOn, shootoutOn, shootoutRoundsStr) => {
    let h = parseInt(String(halfStr), 10);
    if (!Number.isFinite(h) || h < 15 || h > 60) h = 30;
    const et = etOn ? 1 : 0;
    let x1 = parseInt(String(ex1Str), 10);
    let x2 = parseInt(String(ex2Str), 10);
    if (!Number.isFinite(x1) || x1 < 1 || x1 > 45) x1 = 15;
    if (!Number.isFinite(x2) || x2 < 1 || x2 > 45) x2 = 15;
    const useSecondExtraHalf = !!secondExtraHalfOn;
    const shootoutEnabledFlag = shootoutOn ? 1 : 0;
    const shootoutRounds = clampShootoutRoundsInput(shootoutRoundsStr);
    return {
      default_regulation_half_minutes: h,
      default_extra_time_enabled: et,
      default_extra_first_half_minutes: et ? x1 : 0,
      default_extra_second_half_minutes: et ? (useSecondExtraHalf ? x2 : 0) : 0,
      default_penalties_enabled: penOn ? 1 : 0,
      default_shootout_enabled: shootoutEnabledFlag,
      default_shootout_rounds_per_team: shootoutEnabledFlag ? shootoutRounds : 5,
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
      shootout: !!Number(s.default_shootout_enabled),
      shootoutRounds: String(s.default_shootout_rounds_per_team ?? 5),
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
        stagePresetDraft.penalties,
        stagePresetDraft.shootout,
        stagePresetDraft.shootoutRounds
      );
      const res = await adminMatchDetailsService.updateStageTimingDefaults(stagePresetModal.id, defs);
      const n = res?.data?.matches_with_stage;
      const stageId = Number(stagePresetModal.id);
      patchMatchDetailsList('stages', (list) =>
        list.map((s) => (Number(s.id) === stageId ? { ...s, ...defs } : s))
      );
      setStagePresetModal(null);
      setStagePresetDraft(null);
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

  const renderMatchTimingEditor = () => (
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
        placeholderTextColor="#999"
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
          <TextInput style={styles.input} value={extraFirstMinutes} onChangeText={setExtraFirstMinutes} keyboardType="number-pad" placeholder="1–45" placeholderTextColor="#999" />
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
          <TextInput style={styles.input} value={extraSecondMinutes} onChangeText={setExtraSecondMinutes} keyboardType="number-pad" placeholder="1–45" placeholderTextColor="#999" />
            </>
          ) : null}
        </>
      ) : null}
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Rigori</Text>
        <Switch value={penaltiesEnabled} onValueChange={setPenaltiesEnabled} trackColor={{ false: '#ccc', true: '#a5b4fc' }} thumbColor={penaltiesEnabled ? '#667eea' : '#f4f3f4'} />
      </View>
      <ShootoutConfigFields
        enabled={shootoutEnabled}
        onEnabledChange={setShootoutEnabled}
        rounds={shootoutRoundsPerTeam}
        onRoundsChange={setShootoutRoundsPerTeam}
        chipKeyPrefix="match"
        styles={styles}
      />
    </>
  );

  const invalidateStandingsCache = useCallback(() => {
    standingsCacheRef.current = {};
  }, []);

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
      invalidateStandingsCache();
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

  const startEditMatch = useCallback((match) => {
    const compId = Number(match.competition_id);
    const storedLeagueIdRaw = match?.league_id;
    const storedLeagueId =
      storedLeagueIdRaw == null || String(storedLeagueIdRaw).trim() === ''
        ? 0
        : Number(storedLeagueIdRaw);
    const storedLeagueName = String(match?.league_name || '').trim();
    const homeLeagueId = Number(match.home_league_id || 0);
    const awayLeagueId = Number(match.away_league_id || 0);
    let preselectedLeagueId =
      storedLeagueId > 0 ? storedLeagueId : (homeLeagueId > 0 ? homeLeagueId : (awayLeagueId > 0 ? awayLeagueId : 0));

    const matchAdminOnly =
      toAdminOnlyFlag(match?.is_admin_only) ||
      toAdminOnlyFlag(match?.isAdminOnly) ||
      toAdminOnlyFlag(match?.admin_only);
    const parsedKickoff = parseSqlDateTime(String(match.kickoff_at || ''));
    const existingVenue = String(match?.venue || '').trim();
    const leagueLabelFromMatch = (() => {
      const refYear = match?.league_reference_year ?? match?.reference_year;
      if (refYear != null && refYear !== '' && Number.isFinite(Number(refYear))) {
        return String(Math.trunc(Number(refYear)));
      }
      return storedLeagueName || '-';
    })();

    setShowCreateMatchForm(false);
    setCompetitionId(compId);
    setSelectedLeagueIdByComp((prev) => ({
      ...prev,
      [compId]: preselectedLeagueId > 0 ? preselectedLeagueId : 0,
    }));
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
    setIsAdminOnly(matchAdminOnly);
    setKickoffDateObj(parsedKickoff);
    setKickoffAt(formatSqlDateTime(parsedKickoff));
    setEditingMatchId(Number(match.id));
    setVenue(existingVenue || defaultVenueName);
    setReferee(match?.referee || '');
    setMatchStageId(match?.match_stage_id != null ? Number(match.match_stage_id) : null);
    setRegulationHalfMinutes(String(match?.regulation_half_minutes ?? 30));
    setExtraTimeEnabled(!!Number(match?.extra_time_enabled));
    setExtraFirstMinutes(String(match?.extra_first_half_minutes ?? 15));
    setExtraSecondMinutes(String(match?.extra_second_half_minutes ?? 15));
    setExtraSecondHalfEnabled(Number(match?.extra_second_half_minutes ?? 0) > 0);
    setPenaltiesEnabled(!!Number(match?.penalties_enabled));
    setShootoutEnabled(!!Number(match?.shootout_enabled));
    setShootoutRoundsPerTeam(String(match?.shootout_rounds_per_team ?? 5));
    setHomeScore(match?.home_score === null || typeof match?.home_score === 'undefined' ? '' : String(match.home_score));
    setAwayScore(match?.away_score === null || typeof match?.away_score === 'undefined' ? '' : String(match.away_score));
    setEditOriginal({
      kickoffLabel: formatDisplayDateTime(String(match.kickoff_at || '')),
      competitionName: String(match?.competition_name || '-'),
      leagueName: leagueLabelFromMatch,
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
      shootoutEnabled: !!Number(match?.shootout_enabled),
      shootoutRoundsPerTeam: Number(match?.shootout_rounds_per_team || 5),
    });
    setEditMatchStep(1);
    setShowEditTimingDetails(false);
    setEditHydrating(true);
    setShowEditMatchForm(true);

    const hydrateGen = ++editHydrateGenRef.current;
    void (async () => {
      try {
        let loadedLeagues = await loadLeaguesForCompetition(compId);
        if ((!preselectedLeagueId || preselectedLeagueId <= 0) && storedLeagueName) {
          const byName = (loadedLeagues || []).find(
            (l) => String(l?.name || '').trim().toLowerCase() === storedLeagueName.toLowerCase()
          );
          if (byName?.id) preselectedLeagueId = Number(byName.id);
        }
        if (!preselectedLeagueId || preselectedLeagueId <= 0) {
          const kickoffYear = parsedKickoff.getFullYear();
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

        setSelectedLeagueIdByComp((prev) => ({
          ...prev,
          [compId]: preselectedLeagueId > 0 ? preselectedLeagueId : 0,
        }));

        if (preselectedLeagueId > 0) {
          await loadTeamsForCompetition(compId, preselectedLeagueId);
          const league = (loadedLeagues || []).find((l) => Number(l.id) === Number(preselectedLeagueId));
          if (league) {
            setEditOriginal((prev) => (prev ? { ...prev, leagueName: leagueEditionDisplay(league) } : prev));
          }
        } else {
          teamsLoadedForLeagueRef.current[compId] = 0;
          setTeamsByComp((prev) => ({ ...prev, [compId]: [] }));
        }
      } catch (e) {
        if (editHydrateGenRef.current === hydrateGen) {
          showToast(e?.response?.data?.message || e?.message || 'Impossibile preparare modifica');
        }
      } finally {
        if (editHydrateGenRef.current === hydrateGen) {
          setEditHydrating(false);
        }
      }
    })();
  }, [defaultVenueName]);

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
      invalidateStandingsCache();
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
    setEditHydrating(false);
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
    const ymd = toYmd(selectedDate);
    setFilterYear(selectedDate.getFullYear());
    setDate(ymd);
  };

  const deleteMatch = useCallback((id) => {
    setConfirmModal({
      title: 'Elimina partita',
      message: 'Vuoi eliminare questa partita?',
      confirmText: 'Elimina',
      destructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await adminMatchesService.remove(id);
          invalidateStandingsCache();
          await loadMatches();
          showToast('Partita eliminata', 'success');
        } catch (e) {
          showToast(e?.response?.data?.message || e?.message || 'Eliminazione non riuscita');
        }
      },
    });
  }, []);

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

  const createMatchDetailOption = async (type, name) => {
    const clean = String(name || '').trim();
    if (!clean) {
      showToast('Inserisci un valore valido');
      return;
    }
    try {
      if (type === 'venues') {
        const res = await adminMatchDetailsService.createVenue(clean);
        const id = Number(res?.data?.id);
        if (Number.isFinite(id) && id > 0) {
          patchMatchDetailsList('venues', (list) => sortByNameIt([...list, { id, name: clean }]));
        } else {
          await loadMatchDetailsOptions();
        }
        setNewVenueName('');
      } else if (type === 'referees') {
        const res = await adminMatchDetailsService.createReferee(clean);
        const id = Number(res?.data?.id);
        if (Number.isFinite(id) && id > 0) {
          patchMatchDetailsList('referees', (list) => sortByNameIt([...list, { id, name: clean }]));
        } else {
          await loadMatchDetailsOptions();
        }
        setNewRefereeName('');
      } else if (type === 'stages') {
        const defs = buildStageDefaultsPayload(
          newStageHalfMin,
          newStageExtraTime,
          newStageExtra1,
          newStageExtra2,
          newStageExtraSecondEnabled,
          newStagePenalties,
          newStageShootout,
          newStageShootoutRounds
        );
        const res = await adminMatchDetailsService.createStage(clean, defs);
        const id = Number(res?.data?.id);
        if (Number.isFinite(id) && id > 0) {
          patchMatchDetailsList('stages', (list) =>
            sortByNameIt([
              ...list,
              {
                id,
                name: clean,
                ...defs,
              },
            ])
          );
        } else {
          await loadMatchDetailsOptions();
        }
        setNewStageName('');
        setNewStageHalfMin('30');
        setNewStageExtraTime(false);
        setNewStageExtra1('15');
        setNewStageExtra2('15');
        setNewStageExtraSecondEnabled(true);
        setNewStagePenalties(false);
        setNewStageShootout(false);
        setNewStageShootoutRounds('5');
        setNewStageFormOpen(false);
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
      if (type === 'referees' && Number(editingRefereeId) === Number(id)) {
        setEditingRefereeId(null);
        setRefereeEditDraft('');
        setRefereeEditOriginal('');
      }
      const key = type === 'venues' ? 'venues' : type === 'referees' ? 'referees' : 'stages';
      patchMatchDetailsList(key, (list) => list.filter((x) => Number(x.id) !== Number(id)));
      showToast('Valore eliminato', 'success');
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Eliminazione non riuscita');
    }
  };

  const scrollToRefereeEdit = useCallback((refereeId) => {
    const rid = String(refereeId);
    const rowRef = refereeRowRefs.current[rid];
    if (!rowRef || !mainScrollRef.current) return;

    const run = () => {
      rowRef.measureInWindow((_x, winY, _w, h) => {
        const kb = keyboardHeightRef.current || 300;
        const visibleBottom = Dimensions.get('window').height - kb - insets.bottom - 16;
        const headerTop = insets.top + 96;
        let nextY = scrollYRef.current;
        if (winY + h > visibleBottom) {
          nextY += winY + h - visibleBottom + 36;
        } else if (winY < headerTop) {
          nextY -= headerTop - winY + 20;
        }
        if (nextY !== scrollYRef.current) {
          mainScrollRef.current?.scrollTo({ y: Math.max(0, nextY), animated: true });
        }
      });
    };

    requestAnimationFrame(() => {
      run();
      setTimeout(run, 100);
      setTimeout(run, 320);
    });
  }, [insets.top, insets.bottom]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      keyboardHeightRef.current = Number(e?.endCoordinates?.height || 280);
      if (editingRefereeId != null) scrollToRefereeEdit(editingRefereeId);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardHeightRef.current = 0;
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [editingRefereeId, scrollToRefereeEdit]);

  useEffect(() => {
    if (editingRefereeId == null) return;
    if (!refereeListOpen) setRefereeListOpen(true);
    scrollToRefereeEdit(editingRefereeId);
  }, [editingRefereeId, refereeListOpen, scrollToRefereeEdit]);

  const startEditReferee = (ref) => {
    const id = Number(ref?.id);
    if (!Number.isFinite(id) || id <= 0) return;
    if (
      editingRefereeId != null
      && editingRefereeId !== id
      && String(refereeEditDraft || '').trim() !== String(refereeEditOriginal || '').trim()
    ) {
      showToast('Salva o annulla la modifica in corso');
      return;
    }
    if (detailsSectionOpen !== 'referees') setDetailsSectionOpen('referees');
    if (!refereeListOpen) setRefereeListOpen(true);
    setEditingRefereeId(id);
    setRefereeEditDraft(String(ref?.name || ''));
    setRefereeEditOriginal(String(ref?.name || ''));
  };

  const cancelEditReferee = () => {
    setEditingRefereeId(null);
    setRefereeEditDraft('');
    setRefereeEditOriginal('');
  };

  const saveRefereeEdit = async (id) => {
    const rid = Number(id);
    const clean = String(refereeEditDraft || '').trim();
    if (!Number.isFinite(rid) || rid <= 0) return;
    if (!clean) {
      showToast('Inserisci un nome valido');
      return;
    }
    if (clean === String(refereeEditOriginal || '').trim()) {
      cancelEditReferee();
      return;
    }
    setSavingRefereeId(rid);
    try {
      await adminMatchDetailsService.updateReferee(rid, clean);
      if (String(referee || '').trim() === String(refereeEditOriginal || '').trim()) {
        setReferee(clean);
      }
      patchMatchDetailsList('referees', (list) =>
        sortByNameIt(list.map((r) => (Number(r.id) === rid ? { ...r, name: clean } : r)))
      );
      cancelEditReferee();
      showToast('Arbitro aggiornato', 'success');
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Salvataggio non riuscito');
    } finally {
      setSavingRefereeId(null);
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
      invalidateStandingsCache();
      showToast('Dettagli partita salvati', 'success');
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Salvataggio dettagli non riuscito');
    }
  };

  const onRefresh = async () => {
    try {
      setRefreshing(true);
      await loadAll();
      if (activeTab === 'standings' && standingsCompetitionId) {
        await loadStandingsTies(standingsCompetitionId, { force: true });
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
    setSavingTieKey(key);
    try {
      await adminMatchesService.resolveStandingsTie({
        competition_id: Number(standingsCompetitionId),
        league_id: Number(tie.league_id),
        points: Number(tie.points),
        ordered_team_ids: orderedIds,
      });
      // Aggiorna cache locale senza ricaricare tutte le classifica.
      const cid = Number(standingsCompetitionId);
      if (standingsCacheRef.current[cid]) {
        const cachedTies = standingsCacheRef.current[cid].ties || [];
        standingsCacheRef.current[cid] = {
          ties: cachedTies.map((t) => {
            if (Number(t.league_id) !== Number(tie.league_id) || Number(t.points) !== Number(tie.points)) {
              return t;
            }
            const teamMap = new Map((t.teams || []).map((x) => [Number(x.team_id), x]));
            return {
              ...t,
              teams: orderedIds.map((id) => teamMap.get(Number(id))).filter(Boolean),
            };
          }),
        };
      }
      showToast('Ordine salvato', 'success');
    } catch (e) {
      showToast(e?.response?.data?.message || e?.message || 'Salvataggio ordine non riuscito');
    } finally {
      setSavingTieKey(null);
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
      <View style={[styles.headerShell, { paddingTop: Math.max(insets.top + 4, 10) }]}>
        <Text style={styles.headerEyebrow}>Admin</Text>
        <Text style={styles.headerTitle}>Gestione partite</Text>

        <View style={styles.subtabsTrack}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.subtabsScroll}
            contentContainerStyle={styles.subtabsTrackInner}
          >
            <TouchableOpacity
              style={[styles.subtabBtn, activeTab === 'matches' && styles.subtabBtnActive]}
              onPress={() => setActiveTab('matches')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'matches' }}
            >
              <Ionicons
                name="football-outline"
                size={15}
                color={activeTab === 'matches' ? '#4338ca' : '#64748b'}
              />
              <Text style={[styles.subtabText, activeTab === 'matches' && styles.subtabTextActive]}>Partite</Text>
            </TouchableOpacity>
          {canManageMatchDetails ? (
            <TouchableOpacity
              style={[styles.subtabBtn, activeTab === 'details' && styles.subtabBtnActive]}
              onPress={() => setActiveTab('details')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'details' }}
            >
              <Ionicons
                name="options-outline"
                size={15}
                color={activeTab === 'details' ? '#4338ca' : '#64748b'}
              />
              <Text style={[styles.subtabText, activeTab === 'details' && styles.subtabTextActive]}>Dettagli</Text>
            </TouchableOpacity>
          ) : null}
          {canManageCompetitions ? (
            <TouchableOpacity
              style={[styles.subtabBtn, activeTab === 'standings' && styles.subtabBtnActive]}
              onPress={() => setActiveTab('standings')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'standings' }}
            >
              <Ionicons
                name="podium-outline"
                size={15}
                color={activeTab === 'standings' ? '#4338ca' : '#64748b'}
              />
              <Text style={[styles.subtabText, activeTab === 'standings' && styles.subtabTextActive]}>Classifiche</Text>
            </TouchableOpacity>
          ) : null}
          </ScrollView>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.contentAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 52 : 0}
      >
      <ScrollView
        ref={mainScrollRef}
        style={styles.content}
        contentContainerStyle={{ paddingBottom: 28 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={(e) => {
          scrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View ref={scrollContentRef} collapsable={false}>
        {activeTab === 'matches' && (
          <>
            <View style={styles.matchesToolbarShell}>
              <TouchableOpacity
                style={[
                  styles.toolbarSeg,
                  styles.toolbarSegDate,
                  (showPeriodFilters || String(date || '').trim() || Number(filterYear) !== new Date().getFullYear()) && styles.toolbarSegActive,
                ]}
                onPress={() => {
                  setShowPeriodFilters((v) => !v);
                  if (!showPeriodFilters) {
                    setShowAdvancedFilters(false);
                    setShowVisibilityFilters(false);
                  }
                }}
                accessibilityLabel="Filtra per anno o data"
              >
                <Ionicons
                  name="calendar-outline"
                  size={16}
                  color={showPeriodFilters || String(date || '').trim() ? '#4f46e5' : '#64748b'}
                />
                <Text
                  style={[
                    styles.toolbarSegTitle,
                    (showPeriodFilters || String(date || '').trim()) && styles.toolbarSegTitleActive,
                  ]}
                  numberOfLines={1}
                >
                  {String(date || '').trim() || String(filterYear)}
                </Text>
                <Ionicons
                  name={showPeriodFilters ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={showPeriodFilters ? '#4f46e5' : '#94a3b8'}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.toolbarSeg,
                  styles.toolbarSegAmbito,
                  (showAdvancedFilters || filterCompetitionId || filterLeagueId || filterTeamId) && styles.toolbarSegActive,
                ]}
                onPress={() => {
                  setShowAdvancedFilters((v) => !v);
                  if (!showAdvancedFilters) {
                    setShowVisibilityFilters(false);
                    setShowPeriodFilters(false);
                  }
                }}
                accessibilityLabel="Filtri competizione edizione squadra"
              >
                <Ionicons
                  name="layers-outline"
                  size={16}
                  color={(showAdvancedFilters || filterCompetitionId) ? '#4f46e5' : '#64748b'}
                />
                <Text
                  style={[
                    styles.toolbarSegTitle,
                    (showAdvancedFilters || filterCompetitionId) && styles.toolbarSegTitleActive,
                  ]}
                  numberOfLines={1}
                >
                  Ambito
                </Text>
                {(filterCompetitionId || filterLeagueId || filterTeamId) ? (
                  <View style={styles.toolbarSegDot} />
                ) : (
                  <Ionicons
                    name={showAdvancedFilters ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={showAdvancedFilters ? '#4f46e5' : '#94a3b8'}
                  />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.toolbarSeg,
                  styles.toolbarSegStato,
                  (showVisibilityFilters || filterMissingTeamsOnly || filterVisibility !== 'visible') && styles.toolbarSegActive,
                ]}
                onPress={() => {
                  setShowVisibilityFilters((v) => !v);
                  if (!showVisibilityFilters) {
                    setShowAdvancedFilters(false);
                    setShowPeriodFilters(false);
                  }
                }}
                accessibilityLabel="Filtri visibilità e stato squadre"
              >
                <Ionicons
                  name="eye-outline"
                  size={16}
                  color={(showVisibilityFilters || filterMissingTeamsOnly || filterVisibility !== 'visible') ? '#4f46e5' : '#64748b'}
                />
                <Text
                  style={[
                    styles.toolbarSegTitle,
                    (showVisibilityFilters || filterMissingTeamsOnly || filterVisibility !== 'visible') && styles.toolbarSegTitleActive,
                  ]}
                  numberOfLines={1}
                >
                  Stato
                </Text>
                {(filterMissingTeamsOnly || filterVisibility !== 'visible') ? (
                  <View style={styles.toolbarSegDot} />
                ) : (
                  <Ionicons
                    name={showVisibilityFilters ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={showVisibilityFilters ? '#4f46e5' : '#94a3b8'}
                  />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.matchesPlusBtn, showCreateMatchForm && styles.matchesPlusBtnOpen]}
                onPress={() => {
                  if (showCreateMatchForm) {
                    setShowCreateMatchForm(false);
                    return;
                  }
                  setShowEditMatchForm(false);
                  setCreateMatchStep(1);
                  setShowCreateTimingDetails(false);
                  setIsAdminOnly(false);
                  setVenue(defaultVenueName);
                  setShowCreateMatchForm(true);
                }}
                accessibilityLabel={showCreateMatchForm ? 'Chiudi creazione partita' : 'Nuova partita'}
              >
                <Ionicons name={showCreateMatchForm ? 'close' : 'add'} size={20} color="#667eea" />
              </TouchableOpacity>
            </View>

            {showPeriodFilters ? (
              <View style={styles.filterPanel}>
                <View style={styles.filterPanelHeader}>
                  <View style={styles.filterPanelIconWrap}>
                    <Ionicons name="calendar-outline" size={16} color="#4f46e5" />
                  </View>
                  <View style={styles.filterPanelHeaderText}>
                    <Text style={styles.filterPanelTitle}>Periodo</Text>
                    <Text style={styles.filterPanelHint}>Di default: anno corrente · opzionale giorno specifico</Text>
                  </View>
                </View>

                <View style={styles.filterStepBlock}>
                  <Text style={styles.filterFieldLabel}>Anno</Text>
                  <View style={styles.yearStepperRow}>
                    <TouchableOpacity
                      style={styles.yearStepBtn}
                      onPress={() => {
                        setDate('');
                        setFilterYear((y) => Math.max(2000, Number(y) - 1));
                      }}
                      accessibilityLabel="Anno precedente"
                    >
                      <Ionicons name="remove" size={18} color="#4338ca" />
                    </TouchableOpacity>
                    <Text style={styles.yearStepValue}>{filterYear}</Text>
                    <TouchableOpacity
                      style={styles.yearStepBtn}
                      onPress={() => {
                        setDate('');
                        setFilterYear((y) => Math.min(2100, Number(y) + 1));
                      }}
                      accessibilityLabel="Anno successivo"
                    >
                      <Ionicons name="add" size={18} color="#4338ca" />
                    </TouchableOpacity>
                    {Number(filterYear) !== new Date().getFullYear() ? (
                      <TouchableOpacity
                        style={styles.yearResetBtn}
                        onPress={() => {
                          setDate('');
                          setFilterYear(new Date().getFullYear());
                        }}
                      >
                        <Text style={styles.yearResetBtnText}>Corrente</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>

                <View style={[styles.filterStepBlock, styles.filterStepBlockLast]}>
                  <Text style={styles.filterFieldLabel}>Giorno (opzionale)</Text>
                  <View style={styles.periodDayRow}>
                    <TouchableOpacity
                      style={[styles.filterOption, String(date || '').trim() && styles.filterOptionActive]}
                      onPress={() => setShowFilterDatePicker(true)}
                    >
                      <Text style={[styles.filterOptionText, String(date || '').trim() && styles.filterOptionTextActive]}>
                        {String(date || '').trim() || 'Scegli data'}
                      </Text>
                    </TouchableOpacity>
                    {String(date || '').trim() ? (
                      <TouchableOpacity
                        style={styles.yearResetBtn}
                        onPress={() => setDate('')}
                      >
                        <Text style={styles.yearResetBtnText}>Solo anno</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              </View>
            ) : null}
            <View style={styles.activeFiltersRow}>
              <View style={styles.activeFiltersChips}>
                {matchesFilterSummary.map((chip) => (
                  <TouchableOpacity
                    key={chip.key}
                    style={styles.activeFilterChip}
                    onPress={chip.clear}
                    accessibilityLabel={`Rimuovi filtro ${chip.label}`}
                  >
                    <Text style={styles.activeFilterChipText} numberOfLines={1}>{chip.label}</Text>
                    <View style={styles.activeFilterChipX}>
                      <Ionicons name="close" size={11} color="#4f46e5" />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.matchesCountPill}>
                <Text style={styles.matchesCountPillText}>
                  {filteredMatchesWithVisibility.length}
                  {filteredMatchesWithVisibility.length === 1 ? ' partita' : ' partite'}
                </Text>
              </View>
            </View>

            {showAdvancedFilters ? (
              <View style={styles.filterPanel}>
                <View style={styles.filterPanelHeader}>
                  <View style={styles.filterPanelIconWrap}>
                    <Ionicons name="layers-outline" size={16} color="#4f46e5" />
                  </View>
                  <View style={styles.filterPanelHeaderText}>
                    <Text style={styles.filterPanelTitle}>Ambito</Text>
                    <Text style={styles.filterPanelHint}>Competizione → edizione → squadra</Text>
                  </View>
                </View>

                <View style={styles.filterStepBlock}>
                  <View style={styles.filterStepLabelRow}>
                    <View style={styles.filterStepBadge}><Text style={styles.filterStepBadgeText}>1</Text></View>
                    <Text style={styles.filterStepLabel}>Competizione</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.filterOptionsRow}>
                      <TouchableOpacity
                        style={[styles.filterOption, !filterCompetitionId && styles.filterOptionActive]}
                        onPress={() => {
                          pulseFilterBusy();
                          setFilterCompetitionId(null);
                          setFilterLeagueId(null);
                          setFilterTeamId(null);
                          setFilterTeams([]);
                          setFilterMissingTeamsOnly(false);
                        }}
                      >
                        <Text style={[styles.filterOptionText, !filterCompetitionId && styles.filterOptionTextActive]}>Tutte</Text>
                      </TouchableOpacity>
                      {competitions.map((c) => (
                        <TouchableOpacity
                          key={`filter-comp-existing-${c.id}`}
                          style={[styles.filterOption, Number(filterCompetitionId) === Number(c.id) && styles.filterOptionActive]}
                          onPress={() => {
                            pulseFilterBusy();
                            setFilterCompetitionId(Number(c.id));
                            setFilterLeagueId(null);
                            setFilterTeamId(null);
                            setFilterTeams([]);
                            loadLeaguesForCompetition(Number(c.id)).catch(() => {});
                          }}
                        >
                          <Text style={[styles.filterOptionText, Number(filterCompetitionId) === Number(c.id) && styles.filterOptionTextActive]}>
                            {c.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>

                <View style={[styles.filterStepBlock, !filterCompetitionId && styles.filterStepBlockMuted]}>
                  <View style={styles.filterStepLabelRow}>
                    <View style={[styles.filterStepBadge, !filterCompetitionId && styles.filterStepBadgeMuted]}>
                      <Text style={[styles.filterStepBadgeText, !filterCompetitionId && styles.filterStepBadgeTextMuted]}>2</Text>
                    </View>
                    <Text style={styles.filterStepLabel}>Edizione</Text>
                  </View>
                  {!filterCompetitionId ? (
                    <Text style={styles.filterStepEmpty}>Seleziona prima una competizione</Text>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.filterOptionsRow}>
                        <TouchableOpacity
                          style={[styles.filterOption, !filterLeagueId && styles.filterOptionActive]}
                          onPress={() => {
                            pulseFilterBusy();
                            setFilterLeagueId(null);
                            setFilterTeamId(null);
                            setFilterTeams([]);
                          }}
                        >
                          <Text style={[styles.filterOptionText, !filterLeagueId && styles.filterOptionTextActive]}>Tutte</Text>
                        </TouchableOpacity>
                        {(leaguesByComp[filterCompetitionId] || []).map((l) => (
                          <TouchableOpacity
                            key={`filter-league-existing-${l.id}`}
                            style={[styles.filterOption, Number(filterLeagueId) === Number(l.id) && styles.filterOptionActive]}
                            onPress={() => {
                              setFilterLeagueId(Number(l.id));
                              setFilterTeamId(null);
                              loadFilterTeamsForLeague(Number(filterCompetitionId), Number(l.id));
                            }}
                          >
                            <Text style={[styles.filterOptionText, Number(filterLeagueId) === Number(l.id) && styles.filterOptionTextActive]}>
                              {leagueEditionDisplay(l)}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  )}
                </View>

                <View style={[styles.filterStepBlock, styles.filterStepBlockLast, (!filterCompetitionId || !filterLeagueId) && styles.filterStepBlockMuted]}>
                  <View style={styles.filterStepLabelRow}>
                    <View style={[styles.filterStepBadge, (!filterCompetitionId || !filterLeagueId) && styles.filterStepBadgeMuted]}>
                      <Text style={[styles.filterStepBadgeText, (!filterCompetitionId || !filterLeagueId) && styles.filterStepBadgeTextMuted]}>3</Text>
                    </View>
                    <Text style={styles.filterStepLabel}>Squadra</Text>
                  </View>
                  {!filterCompetitionId || !filterLeagueId ? (
                    <Text style={styles.filterStepEmpty}>Seleziona prima competizione ed edizione</Text>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.filterOptionsRow}>
                        <TouchableOpacity
                          style={[styles.filterOption, !filterTeamId && styles.filterOptionActive]}
                          onPress={() => {
                            pulseFilterBusy();
                            setFilterTeamId(null);
                          }}
                        >
                          <Text style={[styles.filterOptionText, !filterTeamId && styles.filterOptionTextActive]}>Tutte</Text>
                        </TouchableOpacity>
                        {filterTeams.map((t) => (
                          <TouchableOpacity
                            key={`filter-team-existing-${t.id}`}
                            style={[styles.filterOption, Number(filterTeamId) === Number(t.id) && styles.filterOptionActive]}
                            onPress={() => {
                              pulseFilterBusy();
                              setFilterTeamId(Number(t.id));
                            }}
                          >
                            <Text style={[styles.filterOptionText, Number(filterTeamId) === Number(t.id) && styles.filterOptionTextActive]}>
                              {t.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  )}
                </View>
              </View>
            ) : null}

            {showVisibilityFilters ? (
              <View style={styles.filterPanel}>
                <View style={styles.filterPanelHeader}>
                  <View style={styles.filterPanelIconWrap}>
                    <Ionicons name="eye-outline" size={16} color="#4f46e5" />
                  </View>
                  <View style={styles.filterPanelHeaderText}>
                    <Text style={styles.filterPanelTitle}>Stato</Text>
                    <Text style={styles.filterPanelHint}>Visibilità e completezza squadre</Text>
                  </View>
                </View>

                <View style={styles.filterStepBlock}>
                  <Text style={styles.filterFieldLabel}>Squadre</Text>
                  <View style={styles.filterSegment}>
                    <TouchableOpacity
                      style={[styles.filterSegmentItem, !filterMissingTeamsOnly && styles.filterSegmentItemActive]}
                      onPress={() => {
                        pulseFilterBusy();
                        setFilterMissingTeamsOnly(false);
                      }}
                    >
                      <Text style={[styles.filterSegmentText, !filterMissingTeamsOnly && styles.filterSegmentTextActive]}>
                        Tutte
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterSegmentItem, filterMissingTeamsOnly && styles.filterSegmentItemActive]}
                      onPress={() => {
                        pulseFilterBusy();
                        setFilterMissingTeamsOnly(true);
                      }}
                    >
                      <Text style={[styles.filterSegmentText, filterMissingTeamsOnly && styles.filterSegmentTextActive]}>
                        Da definire
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={[styles.filterStepBlock, styles.filterStepBlockLast]}>
                  <Text style={styles.filterFieldLabel}>Visibilità</Text>
                  <View style={styles.filterSegment}>
                    <TouchableOpacity
                      style={[styles.filterSegmentItem, filterVisibility === 'visible' && styles.filterSegmentItemActive]}
                      onPress={() => {
                        pulseFilterBusy();
                        setFilterVisibility('visible');
                      }}
                    >
                      <Text style={[styles.filterSegmentText, filterVisibility === 'visible' && styles.filterSegmentTextActive]}>
                        Visibili
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterSegmentItem, filterVisibility === 'hidden' && styles.filterSegmentItemActive]}
                      onPress={() => {
                        pulseFilterBusy();
                        setFilterVisibility('hidden');
                      }}
                    >
                      <Text style={[styles.filterSegmentText, filterVisibility === 'hidden' && styles.filterSegmentTextActive]}>
                        Nascoste
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.filterSegmentItem, filterVisibility === 'all' && styles.filterSegmentItemActive]}
                      onPress={() => {
                        pulseFilterBusy();
                        setFilterVisibility('all');
                      }}
                    >
                      <Text style={[styles.filterSegmentText, filterVisibility === 'all' && styles.filterSegmentTextActive]}>
                        Tutte
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity style={styles.publishAllBtn} onPress={publishAllHiddenMatches}>
                  <Ionicons name="eye-outline" size={16} color="#fff" />
                  <Text style={styles.publishAllBtnText}>Pubblica tutte le nascoste</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.matchesListCard}>
              <View style={styles.matchesListHeadingRow}>
                <Text style={styles.matchesListHeading}>
                  {String(date || '').trim()
                    ? `Giorno ${String(date).trim()}`
                    : `Anno ${filterYear}`}
                </Text>
                {(matchesLoading || filterBusy) ? (
                  <View style={styles.matchesListLoadingInline}>
                    <ActivityIndicator size="small" color="#667eea" />
                    <Text style={styles.matchesListLoadingText}>
                      {matchesLoading ? 'Caricamento…' : 'Aggiornamento…'}
                    </Text>
                  </View>
                ) : null}
              </View>
              {matchesLoading && filteredMatchesWithVisibility.length === 0 ? (
                <View style={styles.matchesListLoadingBlock}>
                  <ActivityIndicator size="large" color="#667eea" />
                  <Text style={styles.matchesEmpty}>Caricamento partite…</Text>
                </View>
              ) : filteredMatchesWithVisibility.length === 0 ? (
                <Text style={styles.matchesEmpty}>Nessuna partita con questi filtri</Text>
              ) : (
                <View style={matchesLoading || filterBusy ? styles.matchesListDimmed : null}>
                  {filteredMatchesWithVisibility.map((m, index) => (
                    <ManageMatchRow
                      key={m.id}
                      match={m}
                      isFirst={index === 0}
                      styles={styles}
                      onEdit={startEditMatch}
                      onDelete={deleteMatch}
                    />
                  ))}
                </View>
              )}
            </View>
          </>
        )}

        {activeTab === 'details' && canManageMatchDetails && (
          <View style={styles.detailsTabWrap}>
            {[
              {
                key: 'venues',
                title: 'Luoghi',
                icon: 'location-outline',
                count: (matchDetailsOptions.venues || []).length,
              },
              {
                key: 'referees',
                title: 'Arbitri',
                icon: 'people-outline',
                count: (matchDetailsOptions.referees || []).length,
              },
              {
                key: 'stages',
                title: 'Tipologie',
                icon: 'flag-outline',
                count: (matchDetailsOptions.stages || []).length,
              },
            ].map((section) => {
              const open = detailsSectionOpen === section.key;
              return (
                <View key={section.key} style={styles.detailsSectionCard}>
                  <TouchableOpacity
                    style={styles.detailsSectionHeader}
                    onPress={() => setDetailsSectionOpen((cur) => (cur === section.key ? null : section.key))}
                    activeOpacity={0.75}
                  >
                    <View style={styles.detailsSectionIconWrap}>
                      <Ionicons name={section.icon} size={16} color="#4f46e5" />
                    </View>
                    <Text style={styles.detailsSectionTitle}>{section.title}</Text>
                    <View style={styles.detailsSectionCount}>
                      <Text style={styles.detailsSectionCountText}>{section.count}</Text>
                    </View>
                    <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color="#94a3b8" />
                  </TouchableOpacity>

                  {open && section.key === 'venues' ? (
                    <View style={styles.detailsSectionBody}>
                      <View style={styles.detailsAddRow}>
                        <TextInput
                          style={[styles.input, styles.detailsAddInput]}
                          value={newVenueName}
                          onChangeText={setNewVenueName}
                          placeholder="Nuovo luogo"
                          placeholderTextColor="#999"
                        />
                        <TouchableOpacity
                          style={styles.detailsAddBtn}
                          onPress={() => createMatchDetailOption('venues', newVenueName)}
                          accessibilityLabel="Aggiungi luogo"
                        >
                          <Ionicons name="add" size={20} color="#fff" />
                        </TouchableOpacity>
                      </View>
                      {(matchDetailsOptions.venues || []).length === 0 ? (
                        <Text style={styles.detailsEmpty}>Nessun luogo</Text>
                      ) : (
                        <View style={styles.detailsChipWrap}>
                          {(matchDetailsOptions.venues || []).map((v) => (
                            <TouchableOpacity
                              key={`manage-venue-${v.id}`}
                              style={styles.detailsChip}
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
                              <Text style={styles.detailsChipText} numberOfLines={1}>{v.name}</Text>
                              <Ionicons name="close" size={12} color="#b42318" />
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  ) : null}

                  {open && section.key === 'referees' ? (
                    <View style={styles.detailsSectionBody}>
                      <View style={styles.detailsAddRow}>
                        <TextInput
                          style={[styles.input, styles.detailsAddInput]}
                          value={newRefereeName}
                          onChangeText={setNewRefereeName}
                          placeholder="Nuovo arbitro"
                          placeholderTextColor="#999"
                        />
                        <TouchableOpacity
                          style={styles.detailsAddBtn}
                          onPress={() => createMatchDetailOption('referees', newRefereeName)}
                          accessibilityLabel="Aggiungi arbitro"
                        >
                          <Ionicons name="add" size={20} color="#fff" />
                        </TouchableOpacity>
                      </View>
                      {(matchDetailsOptions.referees || []).length === 0 ? (
                        <Text style={styles.detailsEmpty}>Nessun arbitro</Text>
                      ) : (
                        <View style={styles.detailsEntityList}>
                          {(matchDetailsOptions.referees || []).map((r) => {
                            const rid = Number(r.id);
                            const isEditing = editingRefereeId === rid;
                            const isDirty =
                              isEditing &&
                              String(refereeEditDraft || '').trim() !== String(refereeEditOriginal || '').trim();
                            const isSaving = savingRefereeId === rid;
                            return (
                              <View
                                key={`manage-ref-${r.id}`}
                                ref={(node) => {
                                  if (node) refereeRowRefs.current[String(rid)] = node;
                                  else delete refereeRowRefs.current[String(rid)];
                                }}
                                style={styles.detailsEntityRow}
                                collapsable={false}
                              >
                                {isEditing ? (
                                  <TextInput
                                    style={[styles.detailsEntityName, styles.refereeEditInput]}
                                    value={refereeEditDraft}
                                    onChangeText={setRefereeEditDraft}
                                    placeholder="Nome arbitro"
                                    placeholderTextColor="#999"
                                    autoFocus
                                    editable={!isSaving}
                                    onFocus={() => scrollToRefereeEdit(rid)}
                                  />
                                ) : (
                                  <Text style={styles.detailsEntityName} numberOfLines={2}>{r.name}</Text>
                                )}
                                <View style={styles.refereeRowActions}>
                                  <TouchableOpacity
                                    style={[styles.refereeIconBtn, isDirty && styles.refereeIconBtnSave]}
                                    disabled={isSaving}
                                    onPress={() => {
                                      if (isEditing && isDirty) {
                                        saveRefereeEdit(rid);
                                      } else if (isEditing) {
                                        cancelEditReferee();
                                      } else {
                                        startEditReferee(r);
                                      }
                                    }}
                                  >
                                    {isSaving ? (
                                      <ActivityIndicator size="small" color={isDirty ? '#fff' : '#667eea'} />
                                    ) : (
                                      <Ionicons
                                        name={isDirty ? 'checkmark' : 'pencil'}
                                        size={18}
                                        color={isDirty ? '#fff' : '#667eea'}
                                      />
                                    )}
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.refereeIconBtnDanger}
                                    disabled={isSaving}
                                    onPress={() =>
                                      setConfirmModal({
                                        title: 'Elimina arbitro',
                                        message: `Eliminare "${r.name}"?`,
                                        confirmText: 'Elimina',
                                        destructive: true,
                                        onConfirm: async () => {
                                          setConfirmModal(null);
                                          await removeMatchDetailOption('referees', rid);
                                        },
                                      })
                                    }
                                  >
                                    <Ionicons name="trash-outline" size={16} color="#b42318" />
                                  </TouchableOpacity>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  ) : null}

                  {open && section.key === 'stages' ? (
                    <View style={styles.detailsSectionBody}>
                      <TouchableOpacity
                        style={styles.detailsNewStageToggle}
                        onPress={() => setNewStageFormOpen((v) => !v)}
                      >
                        <Ionicons name={newStageFormOpen ? 'remove' : 'add'} size={16} color="#4338ca" />
                        <Text style={styles.detailsNewStageToggleText}>
                          {newStageFormOpen ? 'Chiudi form' : 'Nuova tipologia'}
                        </Text>
                      </TouchableOpacity>

                      {newStageFormOpen ? (
                        <View style={styles.detailsNewStageForm}>
                          <View style={styles.detailsAddRow}>
                            <TextInput
                              style={[styles.input, styles.detailsAddInput]}
                              value={newStageName}
                              onChangeText={setNewStageName}
                              placeholder="Nome (es. Finale)"
                              placeholderTextColor="#999"
                            />
                            <TouchableOpacity
                              style={styles.detailsAddBtn}
                              onPress={() => createMatchDetailOption('stages', newStageName)}
                              accessibilityLabel="Aggiungi tipologia"
                            >
                              <Ionicons name="checkmark" size={20} color="#fff" />
                            </TouchableOpacity>
                          </View>
                          <Text style={styles.detailsFieldLabel}>Tempi</Text>
                          <View style={styles.rowWrap}>
                            {[30, 45].map((m) => (
                              <TouchableOpacity
                                key={`newst-half-${m}`}
                                style={[styles.chip, newStageHalfMin === String(m) && styles.chipActive]}
                                onPress={() => setNewStageHalfMin(String(m))}
                              >
                                <Text style={[styles.chipText, newStageHalfMin === String(m) && styles.chipTextActive]}>
                                  {m}′
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          <TextInput
                            style={styles.input}
                            value={newStageHalfMin}
                            onChangeText={setNewStageHalfMin}
                            keyboardType="number-pad"
                            placeholder="15–60"
                            placeholderTextColor="#999"
                          />
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
                              <Text style={styles.detailsFieldLabel}>1° suppl.</Text>
                              <TextInput
                                style={styles.input}
                                value={newStageExtra1}
                                onChangeText={setNewStageExtra1}
                                keyboardType="number-pad"
                              />
                              <View style={styles.switchRow}>
                                <Text style={styles.switchLabel}>2° suppl.</Text>
                                <Switch
                                  value={newStageExtraSecondEnabled}
                                  onValueChange={setNewStageExtraSecondEnabled}
                                  trackColor={{ false: '#ccc', true: '#a5b4fc' }}
                                  thumbColor={newStageExtraSecondEnabled ? '#667eea' : '#f4f3f4'}
                                />
                              </View>
                              {newStageExtraSecondEnabled ? (
                                <TextInput
                                  style={styles.input}
                                  value={newStageExtra2}
                                  onChangeText={setNewStageExtra2}
                                  keyboardType="number-pad"
                                />
                              ) : null}
                            </>
                          ) : null}
                          <View style={styles.switchRow}>
                            <Text style={styles.switchLabel}>Rigori</Text>
                            <Switch
                              value={newStagePenalties}
                              onValueChange={setNewStagePenalties}
                              trackColor={{ false: '#ccc', true: '#a5b4fc' }}
                              thumbColor={newStagePenalties ? '#667eea' : '#f4f3f4'}
                            />
                          </View>
                          <ShootoutConfigFields
                            enabled={newStageShootout}
                            onEnabledChange={setNewStageShootout}
                            rounds={newStageShootoutRounds}
                            onRoundsChange={setNewStageShootoutRounds}
                            chipKeyPrefix="newst"
                            styles={styles}
                          />
                        </View>
                      ) : null}

                      {(matchDetailsOptions.stages || []).length === 0 ? (
                        <Text style={styles.detailsEmpty}>Nessuna tipologia</Text>
                      ) : (
                        <View style={styles.detailsEntityList}>
                          {(matchDetailsOptions.stages || []).map((s) => (
                            <View key={`manage-stage-${s.id}`} style={styles.detailsEntityRow}>
                              <View style={styles.detailsEntityCopy}>
                                <Text style={styles.detailsEntityName} numberOfLines={1}>{s.name}</Text>
                                <Text style={styles.detailsEntityMeta} numberOfLines={1}>
                                  {stagePresetSummary(s)}
                                </Text>
                              </View>
                              <View style={styles.refereeRowActions}>
                                <TouchableOpacity
                                  style={styles.refereeIconBtn}
                                  onPress={() => openStagePresetEditor(s)}
                                  accessibilityLabel={`Preset ${s.name}`}
                                >
                                  <Ionicons name="timer-outline" size={18} color="#667eea" />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.refereeIconBtnDanger}
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
                                  <Ionicons name="trash-outline" size={16} color="#b42318" />
                                </TouchableOpacity>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
        {activeTab === 'standings' && canManageCompetitions && (
          <View style={styles.standingsTabWrap}>
            <View style={styles.standingsHeroCard}>
              <View style={styles.standingsHeroTop}>
                <View style={styles.detailsSectionIconWrap}>
                  <Ionicons name="podium-outline" size={16} color="#4f46e5" />
                </View>
                <Text style={styles.detailsSectionTitle}>Parimerito</Text>
                <View style={styles.detailsSectionCount}>
                  <Text style={styles.detailsSectionCountText}>{standingsTies.length}</Text>
                </View>
                <TouchableOpacity
                  style={styles.standingsRefreshBtn}
                  onPress={() => standingsCompetitionId && loadStandingsTies(standingsCompetitionId, { force: true }).catch(() => {})}
                  accessibilityLabel="Aggiorna parimerito"
                  disabled={standingsLoading || !standingsCompetitionId}
                >
                  {standingsLoading ? (
                    <ActivityIndicator size="small" color="#667eea" />
                  ) : (
                    <Ionicons name="refresh" size={16} color="#667eea" />
                  )}
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.standingsCompRow}>
                {competitions.map((c) => {
                  const active = Number(standingsCompetitionId) === Number(c.id);
                  return (
                    <TouchableOpacity
                      key={`std-comp-${c.id}`}
                      style={[styles.standingsCompChip, active && styles.standingsCompChipActive]}
                      onPress={() => setStandingsCompetitionId(Number(c.id))}
                    >
                      <Text style={[styles.standingsCompChipText, active && styles.standingsCompChipTextActive]} numberOfLines={1}>
                        {c.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {standingsLoading && standingsTies.length === 0 ? (
              <View style={styles.standingsLoadingBox}>
                <ActivityIndicator size="small" color="#667eea" />
                <Text style={styles.detailsEmpty}>Caricamento…</Text>
              </View>
            ) : null}

            {!standingsLoading && standingsTies.length === 0 ? (
              <View style={styles.standingsEmptyCard}>
                <Ionicons name="checkmark-circle-outline" size={22} color="#94a3b8" />
                <Text style={styles.standingsEmptyTitle}>Nessun parimerito</Text>
                <Text style={styles.detailsEmpty}>Tutte le posizioni sono già determinate</Text>
              </View>
            ) : null}

            {standingsTies.map((tie) => {
              const key = `${Number(tie.league_id)}-${Number(tie.points)}`;
              const order = tieOrders[key] || [];
              const teamMap = new Map((tie.teams || []).map((t) => [Number(t.team_id), t]));
              const isSaving = savingTieKey === key;
              return (
                <View key={`tie-${key}`} style={styles.standingsTieCard}>
                  <View style={styles.standingsTieHeader}>
                    <Text style={styles.standingsTieLeague} numberOfLines={1}>{tie.league_name}</Text>
                    <View style={styles.standingsPtsPill}>
                      <Text style={styles.standingsPtsPillText}>{tie.points} pt</Text>
                    </View>
                  </View>
                  {order.map((teamId, idx) => {
                    const t = teamMap.get(Number(teamId));
                    if (!t) return null;
                    const gd = Number(t.goal_diff);
                    const gdLabel = Number.isFinite(gd) ? (gd > 0 ? `+${gd}` : `${gd}`) : '0';
                    return (
                      <View key={`tie-team-${key}-${teamId}`} style={styles.standingsTieRow}>
                        <Text style={styles.standingsTiePos}>{idx + 1}</Text>
                        <View style={styles.standingsTieTeamCol}>
                          <Text style={styles.standingsTieTeam} numberOfLines={1}>{t.team_name}</Text>
                          <Text style={styles.standingsTieMeta}>DR {gdLabel}</Text>
                        </View>
                        <View style={styles.tieArrows}>
                          <TouchableOpacity
                            style={[styles.iconBtnSmall, idx === 0 && styles.iconBtnSmallDisabled]}
                            onPress={() => moveTieTeam(key, idx, -1)}
                            disabled={idx === 0 || isSaving}
                          >
                            <Ionicons name="chevron-up" size={16} color={idx === 0 ? '#cbd5e1' : '#334155'} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.iconBtnSmall, idx === order.length - 1 && styles.iconBtnSmallDisabled]}
                            onPress={() => moveTieTeam(key, idx, 1)}
                            disabled={idx === order.length - 1 || isSaving}
                          >
                            <Ionicons name="chevron-down" size={16} color={idx === order.length - 1 ? '#cbd5e1' : '#334155'} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                  <TouchableOpacity
                    style={[styles.standingsSaveBtn, isSaving && styles.standingsSaveBtnBusy]}
                    onPress={() => saveTieOrder(tie)}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="checkmark" size={16} color="#fff" />
                        <Text style={styles.standingsSaveBtnText}>Salva ordine</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
      {showCreateMatchForm ? (
      <Modal
        visible
        transparent
        animationType="none"
        onRequestClose={() => setShowCreateMatchForm(false)}
      >
        <TouchableOpacity
          style={styles.confirmOverlay}
          activeOpacity={1}
          onPress={() => setShowCreateMatchForm(false)}
        >
          <View style={styles.createMatchModalBox} onStartShouldSetResponder={() => true}>
            <MatchWizardHeader
              title="Nuova partita"
              step={createMatchStep}
              onClose={() => setShowCreateMatchForm(false)}
              styles={styles}
            />
            <MatchWizardProgress step={createMatchStep} styles={styles} />
            <ScrollView
              ref={createMatchScrollRef}
              style={styles.createMatchModalScroll}
              contentContainerStyle={styles.createMatchModalScrollContent}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {createMatchStep === 1 ? (
                <View style={styles.wizardSection}>
                  <View style={styles.wizardToggleCard}>
                    <View style={styles.wizardToggleText}>
                      <Text style={styles.wizardToggleTitle}>Nascondi partita</Text>
                      <Text style={styles.wizardToggleHint}>Visibile solo agli admin</Text>
                    </View>
                    <Switch
                      value={isAdminOnly}
                      onValueChange={setIsAdminOnly}
                      trackColor={{ false: '#ccc', true: '#a5b4fc' }}
                      thumbColor={isAdminOnly ? '#667eea' : '#f4f3f4'}
                    />
                  </View>
                  <Text style={styles.label}>Data e ora</Text>
                  <View style={styles.datetimeRow}>
                    <TouchableOpacity style={styles.datetimeBtn} onPress={() => openKickoffPicker('date')}>
                      <Ionicons name="calendar-outline" size={16} color="#667eea" />
                      <Text style={styles.datetimeBtnText}>{kickoffAt.slice(0, 10)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.datetimeBtn} onPress={() => openKickoffPicker('time')}>
                      <Ionicons name="time-outline" size={16} color="#667eea" />
                      <Text style={styles.datetimeBtnText}>{kickoffAt.slice(11, 16)}</Text>
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
                            teamsLoadedForLeagueRef.current[c.id] = 0;
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
                </View>
              ) : null}

              {createMatchStep === 2 ? (
                <View style={styles.wizardSection}>
                  <Text style={styles.wizardSectionHint}>Puoi lasciare una o entrambe le squadre non definite.</Text>
                  <Text style={styles.label}>Casa</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.rowWrap}>
                      {selectedTeams.length === 0 ? <Text style={styles.muted}>Seleziona prima un’edizione</Text> : null}
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
                  <Text style={styles.label}>Ospite</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.rowWrap}>
                      {selectedTeams.length === 0 ? <Text style={styles.muted}>Seleziona prima un’edizione</Text> : null}
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
                </View>
              ) : null}

              {createMatchStep === 3 ? (
                <View style={styles.wizardSection}>
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
                    <Text style={styles.wizardError}>{gironiStageMatchBlocked}</Text>
                  ) : null}
                  <TouchableOpacity style={styles.inlineLinkBtn} onPress={() => setShowCreateTimingDetails((v) => !v)}>
                    <Text style={styles.inlineLinkBtnText}>
                      {showCreateTimingDetails ? 'Nascondi durata / rigori' : 'Durata, supplementari, rigori, shootout'}
                    </Text>
                  </TouchableOpacity>
                  {showCreateTimingDetails ? renderMatchTimingEditor() : null}
                </View>
              ) : null}

              {createMatchStep === 4 ? (
                <View style={styles.wizardSection}>
                  <View style={styles.summaryBox}>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Data e ora</Text>
                      <Text style={styles.summaryValue}>{formatDisplayDateTime(kickoffAt)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Competizione</Text>
                      <Text style={styles.summaryValue}>{selectedCompetitionName} · {selectedLeagueName}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Partita</Text>
                      <Text style={styles.summaryValue}>{selectedHomeTeamName} · {selectedAwayTeamName}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Luogo / Arbitro</Text>
                      <Text style={styles.summaryValue}>{venue || '-'} · {referee || '-'}</Text>
                    </View>
                    <View style={[styles.summaryRow, styles.summaryRowLast]}>
                      <Text style={styles.summaryLabel}>Tipologia</Text>
                      <Text style={styles.summaryValue}>{selectedStageName}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={[styles.wizardConfirmBtn, !canSubmitMatch && styles.primaryBtnDisabled]}
                    disabled={!canSubmitMatch}
                    onPress={createMatch}
                  >
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                    <Text style={styles.wizardConfirmBtnText}>Crea partita</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </ScrollView>
            <MatchWizardFooter
              step={createMatchStep}
              canGoNext={
                !((createMatchStep === 1 && !canCreateStep1)
                  || (createMatchStep === 2 && !canCreateStep2)
                  || (createMatchStep === 3 && !canCreateStep3))
              }
              onBack={() => setCreateMatchStep((s) => Math.max(1, s - 1))}
              onNext={() => setCreateMatchStep((s) => Math.min(4, s + 1))}
              styles={styles}
            />
          </View>
        </TouchableOpacity>
      </Modal>
      ) : null}
      {showEditMatchForm ? (
      <Modal
        visible
        transparent
        animationType="none"
        onRequestClose={cancelEdit}
      >
        <TouchableOpacity style={styles.confirmOverlay} activeOpacity={1} onPress={cancelEdit}>
          <View style={styles.createMatchModalBox} onStartShouldSetResponder={() => true}>
            <MatchWizardHeader
              title="Modifica partita"
              step={editMatchStep}
              onClose={cancelEdit}
              styles={styles}
            />
            <MatchWizardProgress step={editMatchStep} styles={styles} />
            <ScrollView
              ref={editMatchScrollRef}
              style={styles.createMatchModalScroll}
              contentContainerStyle={styles.createMatchModalScrollContent}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {editMatchStep === 1 ? (
                <View style={styles.wizardSection}>
                  <View style={styles.wizardToggleCard}>
                    <View style={styles.wizardToggleText}>
                      <Text style={styles.wizardToggleTitle}>Nascondi partita</Text>
                      <Text style={styles.wizardToggleHint}>Visibile solo agli admin</Text>
                    </View>
                    <Switch
                      value={isAdminOnly}
                      onValueChange={setIsAdminOnly}
                      trackColor={{ false: '#ccc', true: '#a5b4fc' }}
                      thumbColor={isAdminOnly ? '#667eea' : '#f4f3f4'}
                    />
                  </View>
                  <Text style={styles.label}>Data e ora</Text>
                  <View style={styles.datetimeRow}>
                    <TouchableOpacity style={styles.datetimeBtn} onPress={() => openKickoffPicker('date')}>
                      <Ionicons name="calendar-outline" size={16} color="#667eea" />
                      <Text style={styles.datetimeBtnText}>{kickoffAt.slice(0, 10)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.datetimeBtn} onPress={() => openKickoffPicker('time')}>
                      <Ionicons name="time-outline" size={16} color="#667eea" />
                      <Text style={styles.datetimeBtnText}>{kickoffAt.slice(11, 16)}</Text>
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
                            teamsLoadedForLeagueRef.current[c.id] = 0;
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
                  {editHydrating && !(leaguesByComp[competitionId] || []).length ? (
                    <View style={styles.filterHydratingRow}>
                      <ActivityIndicator size="small" color="#667eea" />
                      <Text style={styles.muted}>Caricamento edizioni…</Text>
                    </View>
                  ) : !!competitionId && (leaguesByComp[competitionId] || []).length > 0 ? (
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
                  ) : (
                    <Text style={styles.muted}>Seleziona prima una competizione</Text>
                  )}
                </View>
              ) : null}

              {editMatchStep === 2 ? (
                <View style={styles.wizardSection}>
                  <Text style={styles.wizardSectionHint}>Puoi lasciare una o entrambe le squadre non definite.</Text>
                  {editHydrating ? (
                    <View style={styles.filterHydratingRow}>
                      <ActivityIndicator size="small" color="#667eea" />
                      <Text style={styles.muted}>Caricamento squadre…</Text>
                    </View>
                  ) : null}
                  <Text style={styles.label}>Casa</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.rowWrap}>
                      {selectedTeams.length === 0 ? <Text style={styles.muted}>Seleziona prima un’edizione</Text> : null}
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
                  <Text style={styles.label}>Ospite</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.rowWrap}>
                      {selectedTeams.length === 0 ? <Text style={styles.muted}>Seleziona prima un’edizione</Text> : null}
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
                </View>
              ) : null}

              {editMatchStep === 3 ? (
                <View style={styles.wizardSection}>
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
                    <Text style={styles.wizardError}>{gironiStageMatchBlocked}</Text>
                  ) : null}
                  <TouchableOpacity style={styles.inlineLinkBtn} onPress={() => setShowEditTimingDetails((v) => !v)}>
                    <Text style={styles.inlineLinkBtnText}>
                      {showEditTimingDetails ? 'Nascondi durata / rigori' : 'Durata, supplementari, rigori, shootout'}
                    </Text>
                  </TouchableOpacity>
                  {showEditTimingDetails ? renderMatchTimingEditor() : null}
                </View>
              ) : null}

              {editMatchStep === 4 ? (
                <View style={styles.wizardSection}>
                  <Text style={styles.wizardSectionHint}>Riepilogo delle modifiche rispetto all’originale.</Text>
                  {editChangeRows.length === 0 ? (
                    <View style={styles.summaryEmptyBox}>
                      <Ionicons name="checkmark-circle-outline" size={22} color="#64748b" />
                      <Text style={styles.summaryEmptyText}>Nessuna modifica rispetto ai valori originali.</Text>
                    </View>
                  ) : (
                    <View style={styles.summaryBox}>
                      {editChangeRows.map((r, idx) => (
                        <View
                          key={`edit-diff-${idx}`}
                          style={[styles.editDiffRow, idx === editChangeRows.length - 1 && styles.editDiffRowLast]}
                        >
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
                  <TouchableOpacity
                    style={[styles.wizardConfirmBtn, !canSubmitMatch && styles.primaryBtnDisabled]}
                    disabled={!canSubmitMatch}
                    onPress={saveEditedMatch}
                  >
                    <Ionicons name="save-outline" size={18} color="#fff" />
                    <Text style={styles.wizardConfirmBtnText}>Salva modifiche</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </ScrollView>
            <MatchWizardFooter
              step={editMatchStep}
              canGoNext={
                !editHydrating
                && !((editMatchStep === 1 && !canCreateStep1)
                  || (editMatchStep === 2 && !canCreateStep2)
                  || (editMatchStep === 3 && !canCreateStep3))
              }
              onBack={() => setEditMatchStep((s) => Math.max(1, s - 1))}
              onNext={() => setEditMatchStep((s) => Math.min(4, s + 1))}
              styles={styles}
            />
          </View>
        </TouchableOpacity>
      </Modal>
      ) : null}
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
              placeholderTextColor="#999"
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
            <ShootoutConfigFields
              enabled={!!stagePresetDraft?.shootout}
              onEnabledChange={(v) => setStagePresetDraft((d) => (d ? { ...d, shootout: v } : d))}
              rounds={stagePresetDraft?.shootoutRounds ?? '5'}
              onRoundsChange={(t) => setStagePresetDraft((d) => (d ? { ...d, shootoutRounds: t } : d))}
              chipKeyPrefix="pd"
              styles={styles}
            />
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
  container: { flex: 1, backgroundColor: '#f4f6fb' },
  contentAvoid: { flex: 1 },
  headerShell: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8eaf1',
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  headerEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  subtabsScroll: {
    flexGrow: 0,
  },
  subtabsTrack: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eaf1',
    backgroundColor: '#f4f6fb',
    padding: 4,
  },
  subtabsTrackInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 2,
  },
  subtabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  subtabBtnActive: {
    backgroundColor: '#fff',
    borderColor: '#c7d2fe',
  },
  subtabText: { color: '#64748b', fontWeight: '700', fontSize: 13 },
  subtabTextActive: { color: '#4338ca' },
  subtabsRowInner: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  tabIntroTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  detailsTabWrap: {
    marginTop: 4,
    gap: 10,
  },
  standingsTabWrap: {
    marginTop: 4,
    gap: 10,
  },
  standingsHeroCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eaf1',
    paddingBottom: 12,
    overflow: 'hidden',
  },
  standingsHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  standingsRefreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2ff',
  },
  standingsCompRow: {
    paddingHorizontal: 12,
    gap: 8,
  },
  standingsCompChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  standingsCompChipActive: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  standingsCompChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  standingsCompChipTextActive: {
    color: '#4338ca',
  },
  standingsLoadingBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eaf1',
    paddingVertical: 28,
    alignItems: 'center',
    gap: 8,
  },
  standingsEmptyCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eaf1',
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 6,
  },
  standingsEmptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#64748b',
  },
  standingsTieCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eaf1',
    padding: 12,
    gap: 8,
  },
  standingsTieHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  standingsTieLeague: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  standingsPtsPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
  },
  standingsPtsPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
  },
  standingsTieRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  standingsTiePos: {
    width: 22,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
    color: '#4338ca',
  },
  standingsTieTeamCol: {
    flex: 1,
    gap: 1,
  },
  standingsTieTeam: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  standingsTieMeta: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },
  standingsSaveBtn: {
    marginTop: 4,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#667eea',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  standingsSaveBtnBusy: {
    opacity: 0.75,
  },
  standingsSaveBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
  },
  iconBtnSmallDisabled: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  detailsSectionCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eaf1',
    overflow: 'hidden',
  },
  detailsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  detailsSectionIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsSectionTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailsSectionCount: {
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  detailsSectionCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
  },
  detailsSectionBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
    paddingTop: 10,
    gap: 10,
  },
  detailsAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailsAddInput: {
    flex: 1,
    marginTop: 0,
  },
  detailsAddBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsEmpty: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    paddingVertical: 4,
  },
  detailsChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  detailsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingVertical: 7,
    paddingLeft: 10,
    paddingRight: 8,
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  detailsChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    maxWidth: 180,
  },
  detailsEntityList: {
    gap: 8,
  },
  detailsEntityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#eef2f7',
  },
  detailsEntityCopy: {
    flex: 1,
    minWidth: 0,
  },
  detailsEntityName: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  detailsEntityMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  detailsNewStageToggle: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  detailsNewStageToggleText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#4338ca',
  },
  detailsNewStageForm: {
    gap: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e8eaf1',
  },
  detailsFieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 2,
  },
  matchesCountPill: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  matchesCountPillText: { fontSize: 12, fontWeight: '800', color: '#4338ca' },
  matchesPlusBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  matchesPlusBtnOpen: {
    backgroundColor: '#eef2ff',
    borderColor: '#a5b4fc',
  },
  matchesToolbarShell: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eaf1',
    backgroundColor: '#f4f6fb',
  },
  toolbarSeg: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  toolbarSegDate: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    minWidth: 0,
    paddingHorizontal: 6,
  },
  toolbarSegAmbito: {
    flex: 1.1,
  },
  toolbarSegStato: {
    flex: 1.35,
  },
  toolbarSegActive: {
    backgroundColor: '#fff',
    borderColor: '#c7d2fe',
  },
  toolbarSegMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolbarSegTitle: { fontSize: 12, fontWeight: '800', color: '#64748b' },
  toolbarSegTitleActive: { color: '#4338ca' },
  toolbarSegClear: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarSegDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#667eea',
  },
  activeFiltersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  activeFiltersChips: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    minWidth: 0,
  },
  activeFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 6,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  activeFilterChipText: { fontSize: 11, fontWeight: '700', color: '#4f46e5', maxWidth: 150 },
  activeFilterChipX: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPanel: {
    marginTop: 10,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e8eaf1',
  },
  filterPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
  },
  filterPanelIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPanelHeaderText: { flex: 1, minWidth: 0 },
  filterPanelTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  filterPanelHint: { fontSize: 12, color: '#8b90a0', marginTop: 1, fontWeight: '600' },
  filterStepBlock: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  filterStepBlockLast: {
    marginBottom: 0,
    paddingBottom: 0,
    borderBottomWidth: 0,
  },
  filterStepBlockMuted: { opacity: 0.72 },
  filterStepLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  filterStepBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterStepBadgeMuted: { backgroundColor: '#e2e8f0' },
  filterStepBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  filterStepBadgeTextMuted: { color: '#64748b' },
  filterStepLabel: { fontSize: 12, fontWeight: '800', color: '#334155' },
  filterStepEmpty: { fontSize: 12, color: '#94a3b8', fontWeight: '600', paddingVertical: 2 },
  filterFieldLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 8,
  },
  filterOptionsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  filterOption: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#f8fafc',
  },
  filterOptionActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  filterOptionText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  filterOptionTextActive: { color: '#fff' },
  filterSegment: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
  },
  filterSegmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterSegmentItemActive: {
    backgroundColor: '#fff',
    borderColor: '#c7d2fe',
  },
  filterSegmentText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  filterSegmentTextActive: { color: '#4338ca' },
  filterHydratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  publishAllBtn: {
    marginTop: 14,
    backgroundColor: '#667eea',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  publishAllBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  matchesListCard: {
    marginTop: 10,
    marginBottom: 4,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eaf1',
    overflow: 'hidden',
  },
  matchesListHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8b90a0',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  matchesListHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
  },
  matchesListLoadingInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  matchesListLoadingText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#667eea',
  },
  matchesListLoadingBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 28,
    paddingHorizontal: 14,
  },
  matchesListDimmed: {
    opacity: 0.55,
  },
  yearStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  yearStepBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  yearStepValue: {
    minWidth: 56,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  yearResetBtn: {
    marginLeft: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  yearResetBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  periodDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  matchesEmpty: {
    color: '#94a3b8',
    fontSize: 13,
    paddingHorizontal: 14,
    paddingBottom: 16,
    paddingTop: 4,
  },
  matchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eef0f5',
  },
  matchCardFirst: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  matchCardBody: { flex: 1, minWidth: 0 },
  matchCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  matchCardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#1c1f2a',
    lineHeight: 19,
  },
  matchVs: { color: '#94a3b8', fontWeight: '600' },
  matchTeamMissing: { color: '#c27803', fontStyle: 'italic', fontWeight: '600' },
  matchCardMeta: {
    marginTop: 3,
    fontSize: 12,
    color: '#8b90a0',
    lineHeight: 16,
  },
  hiddenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fff8e1',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  hiddenBadgeText: { fontSize: 10, fontWeight: '700', color: '#7a6100' },
  matchCardActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  matchIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e5ff',
    backgroundColor: '#f5f7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchIconBtnDanger: {
    borderColor: '#f0b7bb',
    backgroundColor: '#fff5f6',
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
  wizardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 10,
  },
  wizardHeaderText: { flex: 1, minWidth: 0 },
  wizardTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  wizardSubtitle: { marginTop: 2, fontSize: 12, fontWeight: '600', color: '#64748b' },
  wizardCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wizardProgress: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 4,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
    marginBottom: 4,
  },
  wizardProgressItem: { flex: 1, alignItems: 'center', gap: 4 },
  wizardProgressDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wizardProgressDotActive: {
    borderColor: '#667eea',
    backgroundColor: '#667eea',
  },
  wizardProgressDotDone: {
    borderColor: '#4f46e5',
    backgroundColor: '#4f46e5',
  },
  wizardProgressDotText: { fontSize: 11, fontWeight: '800', color: '#64748b' },
  wizardProgressDotTextActive: { color: '#fff' },
  wizardProgressLabel: { fontSize: 10, fontWeight: '600', color: '#94a3b8', textAlign: 'center' },
  wizardProgressLabelActive: { color: '#4338ca' },
  wizardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
  },
  wizardBackBtn: {
    minWidth: 96,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    backgroundColor: '#fff',
  },
  wizardBackBtnText: { color: '#334155', fontWeight: '700', fontSize: 13 },
  wizardNextBtn: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: '#667eea',
    paddingVertical: 11,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  wizardNextBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  wizardFooterSpacer: { flex: 1 },
  wizardSection: { paddingTop: 6 },
  wizardSectionHint: { color: '#64748b', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  wizardToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
  },
  wizardToggleText: { flex: 1, minWidth: 0 },
  wizardToggleTitle: { color: '#0f172a', fontSize: 13, fontWeight: '800' },
  wizardToggleHint: { marginTop: 2, color: '#64748b', fontSize: 11, fontWeight: '600' },
  wizardError: { color: '#b91c1c', fontSize: 13, marginTop: 10, fontWeight: '600' },
  wizardConfirmBtn: {
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: '#667eea',
    paddingVertical: 13,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  wizardConfirmBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  summaryBox: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#f8fafc',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
  },
  summaryRowLast: { borderBottomWidth: 0 },
  summaryLabel: { width: 108, color: '#64748b', fontSize: 12, fontWeight: '700' },
  summaryValue: {
    flex: 1,
    minWidth: 0,
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  summaryEmptyBox: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: 'center',
    gap: 8,
  },
  summaryEmptyText: { color: '#64748b', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  editDiffRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  editDiffRowLast: { borderBottomWidth: 0 },
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
  datetimeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
  },
  datetimeBtnText: { color: '#0f172a', fontWeight: '700', fontSize: 13 },
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
    borderColor: '#e2e8f0',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  refereeDeleteName: { flex: 1, color: '#334155', fontSize: 13, fontWeight: '700' },
  refereeEditInput: {
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    borderRadius: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 8 : 6,
    marginRight: 4,
  },
  refereeRowActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  refereeIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refereeIconBtnSave: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  refereeIconBtnDanger: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f0b7bb',
    backgroundColor: '#fff5f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    maxHeight: '98%',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
  },
  createMatchModalScroll: {
    maxHeight: Math.max(220, CREATE_MATCH_MODAL_SCROLL_MAX_HEIGHT - 140),
  },
  createMatchModalScrollContent: {
    paddingBottom: 8,
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


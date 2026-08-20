import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Pressable,
  InteractionManager,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { playerStatsService } from '../services/api';
import { PlayerPhotoImage, TeamLogoImage } from '../components/StableCachedImage';
import { formatCompetitionRank } from '../utils/standingsRanking';
import BonusIcon from '../components/BonusIcon';
import PlayerHeroTrophyBadges, { CareerEditionTrophyIcons } from '../components/PlayerHeroTrophyBadges';
import PlayerFormChart from '../components/PlayerFormChart';
import VoteDistributionChart from '../components/VoteDistributionChart';
import EfficiencyBars from '../components/EfficiencyBars';
import PlayerSeasonTotals from '../components/PlayerSeasonTotals';
import IconUnderlineTabBar, { FantaCoppaTabIcon } from '../components/IconUnderlineTabBar';
import CompareVsIcon from '../components/CompareVsIcon';

const ROLE_COLORS = {
  P: '#0d6efd',
  D: '#198754',
  C: '#e6a817',
  A: '#dc3545',
};

const ROLE_NAMES = {
  P: 'Portiere',
  D: 'Difensore',
  C: 'Centrocampista',
  A: 'Attaccante',
};

const MAIN_TABS = [
  {
    key: 'overview',
    label: 'Panoramica',
    pack: 'ion',
    icon: 'person-outline',
    iconActive: 'person',
  },
  {
    key: 'stats',
    label: 'Statistiche',
    pack: 'ion',
    icon: 'stats-chart-outline',
    iconActive: 'stats-chart',
  },
  {
    key: 'career',
    label: 'Carriera',
    pack: 'mci',
    icon: 'timeline-clock-outline',
    iconActive: 'timeline-clock',
  },
  {
    key: 'fantacoppa',
    label: 'FantaCoppa',
    renderIcon: (active) => <FantaCoppaTabIcon active={active} />,
  },
];

const SEASON_YEAR_PICKER_MAX_HEIGHT = 180;

const HERO_PHOTO_SIZE = 184;
const HERO_PHOTO_RADIUS = 16;

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${n.toFixed(1)}%`;
}

function formatRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

function formatOpponentMatchDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function resolveInitialTabs(entrySource) {
  if (entrySource === 'official') {
    return { mainTab: 'overview', scopeSubTab: 'total' };
  }
  return { mainTab: 'fantacoppa', scopeSubTab: 'total' };
}

function resolvePlayerDisplayName(playerInfo, playerName) {
  const apiFirst = String(playerInfo?.first_name || '').trim();
  const apiLast = String(playerInfo?.last_name || '').trim();
  if (apiFirst || apiLast) {
    return { firstName: apiFirst, lastName: apiLast };
  }

  const full = String(playerName || '').trim();
  if (!full) return { firstName: 'Giocatore', lastName: '' };

  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function editionKey(edition) {
  return `${Number(edition?.player_id || 0)}-${Number(edition?.league_id || 0)}`;
}

function resolveDefaultEdition(editions, routePlayerId, routeLeagueId) {
  const fallback = {
    player_id: Number(routePlayerId),
    league_id: Number(routeLeagueId),
    reference_year: null,
  };
  if (!Array.isArray(editions) || !editions.length) return fallback;

  const exact = editions.find(
    (edition) => Number(edition.player_id) === Number(routePlayerId)
      && Number(edition.league_id) === Number(routeLeagueId),
  );
  if (exact) return exact;

  const byLeague = editions.find((edition) => Number(edition.league_id) === Number(routeLeagueId));
  if (byLeague) return byLeague;

  const byPlayer = editions.find((edition) => Number(edition.player_id) === Number(routePlayerId));
  if (byPlayer) return byPlayer;

  return editions[0];
}

function formatEditionYearLabel(edition) {
  const year = Number(edition?.reference_year);
  if (Number.isFinite(year) && year > 0) return String(Math.trunc(year));
  const leagueName = String(edition?.league_name || '').trim();
  return leagueName || '–';
}

function formatCareerLeagueYear(entry) {
  const year = Number(entry?.reference_year);
  if (Number.isFinite(year) && year > 0) return String(Math.trunc(year));
  return '–';
}

function formatOverviewAbsoluteRank(rank) {
  return formatCompetitionRank(rank);
}

function SeasonYearPickerMenu({ open, onClose, anchorRef, options, onSelectOption }) {
  const [layout, setLayout] = useState(null);

  useEffect(() => {
    if (!open) {
      setLayout(null);
      return undefined;
    }
    let cancelled = false;
    const measureAnchor = () => {
      if (!anchorRef?.current) return;
      anchorRef.current.measureInWindow((x, y, width, height) => {
        if (cancelled) return;
        setLayout({ left: x, top: y + height + 4, width });
      });
    };
    measureAnchor();
    const retryTimer = setTimeout(measureAnchor, 64);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [open, anchorRef, options.length]);

  if (!open || !layout) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.seasonPickerModalRoot}>
        <Pressable
          style={styles.seasonPickerModalBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Chiudi selezione anno"
        />
        <View style={[styles.seasonPickerDropdownModal, { top: layout.top, left: layout.left, width: layout.width }]}>
          <ScrollView
            style={styles.seasonPickerDropdownScroll}
            contentContainerStyle={styles.seasonPickerDropdownScrollContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            bounces={false}
            nestedScrollEnabled
          >
            {options.map((item, idx) => (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.seasonPickerItem,
                  idx === options.length - 1 && styles.seasonPickerItemLast,
                  item.active && styles.seasonPickerItemActive,
                ]}
                onPress={() => onSelectOption(item)}
                activeOpacity={0.8}
              >
                <Text style={[styles.seasonPickerItemText, item.active && styles.seasonPickerItemTextActive]}>
                  {item.label}
                </Text>
                {item.active ? <Ionicons name="checkmark" size={16} color="#4f46e5" /> : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function EmptyTabPlaceholder({ icon, title, subtitle }) {
  return (
    <View style={styles.emptyBox}>
      <View style={styles.emptyIconCircle}>
        <Ionicons name={icon} size={32} color="#667eea" />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySubtext}>{subtitle}</Text>
    </View>
  );
}

function TileSplitRow({ left, right }) {
  return (
    <View style={styles.tileRow}>
      <View style={styles.tile}>{left}</View>
      <View style={styles.tileDivider} />
      <View style={styles.tile}>{right}</View>
    </View>
  );
}

function ProductionStatCell({ type, value, label }) {
  return (
    <View style={styles.productionCell}>
      <View style={styles.productionIconWrap}>
        <BonusIcon type={type} size={18} />
      </View>
      <Text style={styles.productionCellValue}>{value}</Text>
      <Text style={styles.productionCellLabel}>{label}</Text>
    </View>
  );
}

export default function PlayerStatsScreen({ route, navigation }) {
  const {
    playerId,
    leagueId,
    playerName,
    playerRole,
    playerPhotoPath: initialPlayerPhotoPath = '',
    entrySource = 'league',
  } = route.params || {};

  const initialTabs = resolveInitialTabs(entrySource);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const chartWidth = Math.max(240, windowWidth - 64);
  const [activeMainTab, setActiveMainTab] = useState(initialTabs.mainTab);
  const [activeScopeSubTab, setActiveScopeSubTab] = useState(initialTabs.scopeSubTab);
  const [fantaEditionData, setFantaEditionData] = useState(null);
  const [aggregatedFantaStats, setAggregatedFantaStats] = useState(null);
  const [editionAnalytics, setEditionAnalytics] = useState(null);
  const [aggregatedAnalytics, setAggregatedAnalytics] = useState(null);
  const [loadingFantaEdition, setLoadingFantaEdition] = useState(false);
  const [loadingAggregatedFanta, setLoadingAggregatedFanta] = useState(false);
  const [loadingEditionAnalytics, setLoadingEditionAnalytics] = useState(false);
  const [loadingAggregatedAnalytics, setLoadingAggregatedAnalytics] = useState(false);
  const [hasOfficialGroup, setHasOfficialGroup] = useState(false);
  const [officialGroupReady, setOfficialGroupReady] = useState(false);
  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [absoluteRanks, setAbsoluteRanks] = useState(null);
  const [loadingAbsoluteRanks, setLoadingAbsoluteRanks] = useState(false);
  const [careerHistory, setCareerHistory] = useState(null);
  const [loadingCareer, setLoadingCareer] = useState(false);
  const [expandedOpponentKeys, setExpandedOpponentKeys] = useState({});
  const [selectedEditionKey, setSelectedEditionKey] = useState(null);
  const [editionPickerOpen, setEditionPickerOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [photoPath, setPhotoPath] = useState(() => String(initialPlayerPhotoPath || '').trim());
  const editionPickerAnchorRef = useRef(null);
  const mainScrollRef = useRef(null);
  const officialGroupCheckDoneRef = useRef(false);
  const statsLoadGenRef = useRef(0);
  const analyticsLoadGenRef = useRef(0);
  const careerPrefetchStartedRef = useRef(false);
  const fantaCacheRef = useRef(new Map());
  const analyticsCacheRef = useRef(new Map());
  const aggregatedFantaInFlightRef = useRef(false);
  const aggregatedAnalyticsInFlightRef = useRef(false);

  const clusterEditions = useMemo(() => {
    const editions = overview?.editions;
    return Array.isArray(editions) ? editions : [];
  }, [overview]);

  const selectedEdition = useMemo(() => {
    if (!clusterEditions.length) {
      return resolveDefaultEdition([], playerId, leagueId);
    }
    const match = clusterEditions.find((edition) => editionKey(edition) === selectedEditionKey);
    return match || clusterEditions[0];
  }, [clusterEditions, selectedEditionKey, playerId, leagueId]);

  const editionYearOptions = useMemo(
    () => clusterEditions.map((edition) => ({
      key: editionKey(edition),
      label: formatEditionYearLabel(edition),
      edition,
      active: editionKey(edition) === editionKey(selectedEdition),
    })),
    [clusterEditions, selectedEdition],
  );

  const selectedEditionYearLabel = formatEditionYearLabel(selectedEdition);
  const canPickEditionYear = editionYearOptions.length > 1;

  const playerInfo = fantaEditionData?.player;
  const selectedEditionRole = useMemo(
    () => String(selectedEdition?.role || '').trim().toUpperCase(),
    [selectedEdition?.role],
  );
  const recentClusterRole = useMemo(
    () => String(overview?.role || '').trim().toUpperCase(),
    [overview?.role],
  );
  const displayPlayerRole = selectedEditionRole
    || recentClusterRole
    || String(playerRole || '').trim().toUpperCase();
  const scopeGoalkeeperRole = useMemo(() => {
    if (activeScopeSubTab === 'total') return recentClusterRole;
    return selectedEditionRole
      || String(playerRole || '').trim().toUpperCase()
      || recentClusterRole;
  }, [activeScopeSubTab, recentClusterRole, selectedEditionRole, playerRole]);
  const isRecentClusterGoalkeeper = recentClusterRole === 'P';
  const showGoalkeeperFantaSection = scopeGoalkeeperRole === 'P';
  const { firstName, lastName } = useMemo(
    () => resolvePlayerDisplayName(playerInfo, playerName),
    [playerInfo, playerName],
  );

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useEffect(() => {
    setCareerHistory(null);
    setAbsoluteRanks(null);
    setLoadingAbsoluteRanks(entrySource === 'official');
    officialGroupCheckDoneRef.current = false;
    careerPrefetchStartedRef.current = false;
    statsLoadGenRef.current = 0;
    analyticsLoadGenRef.current = 0;
    aggregatedFantaInFlightRef.current = false;
    aggregatedAnalyticsInFlightRef.current = false;
    fantaCacheRef.current = new Map();
    analyticsCacheRef.current = new Map();
    setFantaEditionData(null);
    setAggregatedFantaStats(null);
    setEditionAnalytics(null);
    setAggregatedAnalytics(null);
    setHasOfficialGroup(false);
    setOfficialGroupReady(false);
    setActiveScopeSubTab(initialTabs.scopeSubTab);

    void bootstrapPlayerScreen();
    if (initialTabs.mainTab === 'fantacoppa' || initialTabs.mainTab === 'stats' || entrySource === 'official') {
      void checkOfficialGroup();
    }
  }, [playerId, leagueId]);

  useEffect(() => {
    if (!officialGroupReady) return;
    if (!hasOfficialGroup && activeScopeSubTab === 'total') {
      setActiveScopeSubTab('league');
      if (activeMainTab === 'fantacoppa') {
        void loadEditionFantaStats(selectedEdition.player_id, selectedEdition.league_id);
      } else if (activeMainTab === 'stats') {
        void loadEditionAnalytics(selectedEdition.player_id, selectedEdition.league_id);
      }
    }
  }, [officialGroupReady, hasOfficialGroup, activeScopeSubTab, activeMainTab, selectedEdition.player_id, selectedEdition.league_id]);

  // Garantisce il caricamento dei dati Totali quando il tab è attivo (evita race sul primo mount)
  useEffect(() => {
    if (!hasOfficialGroup) return;
    if (activeScopeSubTab !== 'total') return;

    if (activeMainTab === 'fantacoppa' && !aggregatedFantaStats && !loadingAggregatedFanta) {
      void loadAggregatedFantaStats();
    }
    if (activeMainTab === 'stats' && !aggregatedAnalytics && !loadingAggregatedAnalytics) {
      void loadAggregatedAnalytics();
    }
  }, [
    hasOfficialGroup,
    activeScopeSubTab,
    activeMainTab,
    aggregatedFantaStats,
    aggregatedAnalytics,
    loadingAggregatedFanta,
    loadingAggregatedAnalytics,
  ]);

  // Quando overview/edizioni sono pronte, ricarica i dati edizione se il tab Anno è attivo
  // (evita zeri se l’utente apre Statistiche/FantaCoppa prima del bootstrap)
  useEffect(() => {
    if (loadingOverview) return;
    if (!selectedEdition?.player_id || !selectedEdition?.league_id) return;
    if (activeScopeSubTab !== 'league') return;

    if (activeMainTab === 'fantacoppa' && !fantaEditionData && !loadingFantaEdition) {
      void loadEditionFantaStats(selectedEdition.player_id, selectedEdition.league_id);
    }
    if (activeMainTab === 'stats' && !editionAnalytics && !loadingEditionAnalytics) {
      void loadEditionAnalytics(selectedEdition.player_id, selectedEdition.league_id);
    }
  }, [
    loadingOverview,
    selectedEdition?.player_id,
    selectedEdition?.league_id,
    activeScopeSubTab,
    activeMainTab,
    fantaEditionData,
    editionAnalytics,
    loadingFantaEdition,
    loadingEditionAnalytics,
  ]);

  useEffect(() => {
    if (entrySource === 'official' || !hasOfficialGroup || absoluteRanks || loadingAbsoluteRanks) return;
    void loadAbsoluteRanks();
  }, [hasOfficialGroup, entrySource, absoluteRanks, loadingAbsoluteRanks, playerId, leagueId]);

  useEffect(() => {
    setExpandedOpponentKeys({});
  }, [activeMainTab, activeScopeSubTab, selectedEditionKey]);

  const applyEditionFantaData = (response, loadGen, cacheKey) => {
    if (loadGen !== statsLoadGenRef.current) return false;

    setFantaEditionData(response.data);
    if (cacheKey) {
      fantaCacheRef.current.set(cacheKey, response.data);
    }
    if (response.data?.player?.photo_path) {
      setPhotoPath((prev) => prev || String(response.data.player.photo_path || '').trim());
    }
    return true;
  };

  const loadEditionFantaStats = async (editionPlayerId, editionLeagueId, options = {}) => {
    const targetPlayerId = Number(editionPlayerId);
    const targetLeagueId = Number(editionLeagueId);
    if (!targetPlayerId || !targetLeagueId) return;

    const cacheKey = `${targetPlayerId}-${targetLeagueId}`;
    const cached = fantaCacheRef.current.get(cacheKey);
    if (cached && !options.force) {
      setFantaEditionData(cached);
      return;
    }

    const loadGen = ++statsLoadGenRef.current;
    const { reusePromise = null } = options;

    try {
      setLoadingFantaEdition(true);

      const response = reusePromise
        ? await reusePromise
        : await playerStatsService.getPlayerFantaStats(targetPlayerId, targetLeagueId);

      applyEditionFantaData(response, loadGen, cacheKey);
    } catch (error) {
      if (loadGen === statsLoadGenRef.current) {
        showToast('Impossibile caricare le statistiche fanta del giocatore');
        setFantaEditionData({ stats: {} });
      }
      console.error(error);
    } finally {
      if (loadGen === statsLoadGenRef.current) {
        setLoadingFantaEdition(false);
      }
    }
  };

  const loadEditionAnalytics = async (editionPlayerId, editionLeagueId, options = {}) => {
    const targetPlayerId = Number(editionPlayerId);
    const targetLeagueId = Number(editionLeagueId);
    if (!targetPlayerId || !targetLeagueId) return;

    const cacheKey = `${targetPlayerId}-${targetLeagueId}`;
    const cached = analyticsCacheRef.current.get(cacheKey);
    if (cached && !options.force) {
      setEditionAnalytics(cached);
      return;
    }

    const loadGen = ++analyticsLoadGenRef.current;

    try {
      setLoadingEditionAnalytics(true);
      const response = await playerStatsService.getPlayerAnalytics(targetPlayerId, targetLeagueId);
      if (loadGen !== analyticsLoadGenRef.current) return;
      const analytics = response.data?.analytics || null;
      if (analytics) {
        analyticsCacheRef.current.set(cacheKey, analytics);
        setEditionAnalytics(analytics);
      } else {
        setEditionAnalytics({
          totals: {},
          efficiency: {},
          distribution: [],
          form_series: [],
          favourite_opponent: null,
          favourite_opponent_reason: 'no_data',
          opponent_rankings: [],
        });
      }
    } catch (error) {
      if (loadGen === analyticsLoadGenRef.current) {
        showToast('Impossibile caricare le statistiche del giocatore');
        setEditionAnalytics({
          totals: {},
          efficiency: {},
          distribution: [],
          form_series: [],
          favourite_opponent: null,
          favourite_opponent_reason: 'no_data',
          opponent_rankings: [],
        });
      }
      console.error(error);
    } finally {
      if (loadGen === analyticsLoadGenRef.current) {
        setLoadingEditionAnalytics(false);
      }
    }
  };

  const loadAbsoluteRanks = async () => {
    try {
      setLoadingAbsoluteRanks(true);
      const response = await playerStatsService.getPlayerAbsoluteRanks(playerId, leagueId);
      setAbsoluteRanks(response.data?.absolute_ranks || null);
    } catch (error) {
      setAbsoluteRanks(null);
      console.error(error);
    } finally {
      setLoadingAbsoluteRanks(false);
    }
  };

  const bootstrapPlayerScreen = async () => {
    try {
      setLoadingOverview(true);

      const overviewPromise = playerStatsService.getPlayerOverview(playerId, leagueId);

      if (entrySource === 'official') {
        void loadAbsoluteRanks();
      }

      // Se partiamo su FantaCoppa/Totali, precarica subito i totali aggregati
      if (initialTabs.mainTab === 'fantacoppa' && initialTabs.scopeSubTab === 'total') {
        setLoadingAggregatedFanta(true);
      }

      const response = await overviewPromise;
      const nextOverview = response.data?.overview || null;
      setOverview(nextOverview);

      const editions = Array.isArray(nextOverview?.editions) ? nextOverview.editions : [];
      const defaultEdition = resolveDefaultEdition(editions, playerId, leagueId);
      const defaultKey = editionKey(defaultEdition);
      setSelectedEditionKey(defaultKey);

      InteractionManager.runAfterInteractions(() => {
        if (careerPrefetchStartedRef.current || careerHistory) return;
        careerPrefetchStartedRef.current = true;
        void loadCareer({ prefetch: true });
      });
    } catch (error) {
      setOverview(null);
      setSelectedEditionKey(editionKey({ player_id: playerId, league_id: leagueId }));
      console.error(error);
    } finally {
      setLoadingOverview(false);
    }
  };

  const checkOfficialGroup = async () => {
    if (officialGroupCheckDoneRef.current) return;
    officialGroupCheckDoneRef.current = true;
    aggregatedFantaInFlightRef.current = true;
    try {
      setLoadingAggregatedFanta(true);
      const response = await playerStatsService.getPlayerFantaStatsAggregated(playerId, leagueId);
      setAggregatedFantaStats(response.data?.stats || {});
      setHasOfficialGroup(true);
      if (response.data?.player?.photo_path) {
        setPhotoPath((prev) => prev || String(response.data.player.photo_path || '').trim());
      }
    } catch (error) {
      // Non forzare false se un altro endpoint aggregato ha già confermato il gruppo
      setHasOfficialGroup((prev) => prev);
    } finally {
      aggregatedFantaInFlightRef.current = false;
      setLoadingAggregatedFanta(false);
      setOfficialGroupReady(true);
    }
  };

  const handleEditionYearSelect = (item) => {
    setEditionPickerOpen(false);
    setActiveScopeSubTab('league');
    const edition = item?.edition;
    if (!edition) return;

    const nextKey = editionKey(edition);
    if (nextKey === selectedEditionKey) {
      // Stesso anno già selezionato (es. da Totali → Anno): assicurati comunque di caricare
      if (activeMainTab === 'fantacoppa') {
        void loadEditionFantaStats(edition.player_id, edition.league_id);
      } else if (activeMainTab === 'stats') {
        void loadEditionAnalytics(edition.player_id, edition.league_id);
      }
      return;
    }

    setSelectedEditionKey(nextKey);
    if (activeMainTab === 'fantacoppa') {
      loadEditionFantaStats(edition.player_id, edition.league_id);
    } else if (activeMainTab === 'stats') {
      loadEditionAnalytics(edition.player_id, edition.league_id);
    }
  };

  const handleYearSegmentPress = () => {
    if (editionYearOptions.length === 0) return;
    if (editionYearOptions.length === 1) {
      handleEditionYearSelect(editionYearOptions[0]);
      return;
    }
    setEditionPickerOpen((open) => !open);
  };

  const loadAggregatedFantaStats = async () => {
    if (aggregatedFantaStats || aggregatedFantaInFlightRef.current) return;
    aggregatedFantaInFlightRef.current = true;
    try {
      setLoadingAggregatedFanta(true);
      const response = await playerStatsService.getPlayerFantaStatsAggregated(playerId, leagueId);
      setAggregatedFantaStats(response.data.stats || {});
      setHasOfficialGroup(true);
    } catch (error) {
      showToast('Impossibile caricare le statistiche fanta aggregate');
      console.error(error);
    } finally {
      aggregatedFantaInFlightRef.current = false;
      setLoadingAggregatedFanta(false);
    }
  };

  const loadAggregatedAnalytics = async () => {
    if (aggregatedAnalytics || aggregatedAnalyticsInFlightRef.current) return;
    const cached = analyticsCacheRef.current.get('total');
    if (cached) {
      setAggregatedAnalytics(cached);
      return;
    }
    aggregatedAnalyticsInFlightRef.current = true;
    try {
      setLoadingAggregatedAnalytics(true);
      const response = await playerStatsService.getPlayerAnalyticsAggregated(playerId, leagueId);
      const analytics = response.data?.analytics || null;
      if (analytics) {
        analyticsCacheRef.current.set('total', analytics);
        setAggregatedAnalytics(analytics);
      } else {
        setAggregatedAnalytics({
          totals: {},
          efficiency: {},
          distribution: [],
          form_series: [],
          favourite_opponent: null,
          favourite_opponent_reason: 'no_data',
          opponent_rankings: [],
        });
      }
      setHasOfficialGroup(true);
    } catch (error) {
      showToast('Impossibile caricare le statistiche aggregate');
      console.error(error);
    } finally {
      aggregatedAnalyticsInFlightRef.current = false;
      setLoadingAggregatedAnalytics(false);
    }
  };

  const loadCareer = async (options = {}) => {
    const { prefetch = false } = options;
    if (careerHistory) return;
    try {
      if (!prefetch) setLoadingCareer(true);
      const response = await playerStatsService.getPlayerCareer(playerId, leagueId);
      const entries = Array.isArray(response.data?.career) ? response.data.career : [];
      setCareerHistory(entries);
    } catch (error) {
      if (!prefetch) {
        showToast('Impossibile caricare la carriera del giocatore');
      }
      console.error(error);
      setCareerHistory([]);
    } finally {
      if (!prefetch) setLoadingCareer(false);
    }
  };

  const handleMainTabPress = (tabKey) => {
    if (tabKey !== 'fantacoppa' && tabKey !== 'stats') {
      setEditionPickerOpen(false);
    }
    setActiveMainTab(tabKey);
    mainScrollRef.current?.scrollTo({ y: 0, animated: false });

    if (tabKey === 'fantacoppa' || tabKey === 'stats') {
      void checkOfficialGroup();
    }

    if (tabKey === 'fantacoppa') {
      if (activeScopeSubTab === 'total') {
        void loadAggregatedFantaStats();
      } else {
        void loadEditionFantaStats(selectedEdition.player_id, selectedEdition.league_id);
      }
    }

    if (tabKey === 'stats') {
      if (activeScopeSubTab === 'total') {
        void loadAggregatedAnalytics();
      } else {
        void loadEditionAnalytics(selectedEdition.player_id, selectedEdition.league_id);
      }
    }

    if (tabKey === 'career') {
      loadCareer();
    }
  };

  const handleScopeSubTabPress = (subTabKey) => {
    setEditionPickerOpen(false);
    setActiveScopeSubTab(subTabKey);
    if (subTabKey === 'total') {
      if (activeMainTab === 'fantacoppa') {
        void loadAggregatedFantaStats();
      } else if (activeMainTab === 'stats') {
        void loadAggregatedAnalytics();
      }
      return;
    }

    if (activeMainTab === 'fantacoppa') {
      void loadEditionFantaStats(selectedEdition.player_id, selectedEdition.league_id);
    } else if (activeMainTab === 'stats') {
      void loadEditionAnalytics(selectedEdition.player_id, selectedEdition.league_id);
    }
  };

  const openCareerTeam = useCallback((entry) => {
    const teamIdTarget = Number(entry?.team_id);
    const competitionIdTarget = Number(entry?.competition_id);
    const referenceYear = Number(entry?.reference_year);
    if (!teamIdTarget || !competitionIdTarget) return;

    navigation.navigate('OfficialTeamDetail', {
      teamId: teamIdTarget,
      competitionId: competitionIdTarget,
      teamName: String(entry?.team_name || '').trim() || undefined,
      initialTab: 'team',
      initialSeasonYear: Number.isFinite(referenceYear) && referenceYear > 0
        ? Math.trunc(referenceYear)
        : undefined,
    });
  }, [navigation]);

  const openOfficialMatchFromOpponent = useCallback((matchId) => {
    const target = Number(matchId);
    if (!target || target <= 0) return;
    navigation.navigate('MatchDetail', { matchId: target, from: 'player-stats' });
  }, [navigation]);

  const toggleOpponentDetails = useCallback((key) => {
    setExpandedOpponentKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const formatOverviewValue = (value) => {
    if (value == null || value === '') return '–';
    return String(value);
  };

  const formatOverviewRole = (role) => {
    const key = String(role || '').trim().toUpperCase();
    if (!key) return '–';
    return ROLE_NAMES[key] || key;
  };

  const renderOverview = () => {
    if (loadingOverview) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      );
    }

    if (!overview || Number(overview.editions_played || 0) <= 0) {
      return (
        <View style={styles.card}>
          <Text style={styles.emptyOverviewText}>Nessuna informazione disponibile per le edizioni visibili.</Text>
        </View>
      );
    }

    const teamName = String(overview.team?.name || '').trim() || '–';
    const teamLogoPath = String(overview.team?.logo_path || '').trim();
    const roleLabel = formatOverviewRole(overview.role);
    const roleFontSize = roleLabel.length > 14 ? 17 : roleLabel.length > 11 ? 19 : 22;
    const showAbsoluteRanksCard = entrySource === 'official' || hasOfficialGroup;

    return (
      <>
      <View style={styles.card}>
        <TileSplitRow
          left={(
            <>
              <Text style={styles.tileValue}>{formatOverviewValue(overview.birth_year)}</Text>
              <Text style={styles.tileLabel}>Anno</Text>
            </>
          )}
          right={(
            <>
              <Text
                style={[styles.tileValueRole, { fontSize: roleFontSize }]}
                numberOfLines={1}
              >
                {roleLabel}
              </Text>
              <Text style={styles.tileLabel}>Ruolo</Text>
            </>
          )}
        />
        <View style={styles.divider} />
        <TileSplitRow
          left={(
            <>
              <Text style={styles.tileValue}>{formatOverviewValue(overview.shirt_number)}</Text>
              <Text style={styles.tileLabel}>Numero</Text>
            </>
          )}
          right={(
            <>
              <Text style={styles.tileValue}>{formatOverviewValue(overview.editions_played)}</Text>
              <Text style={styles.tileLabel}>Edizioni giocate</Text>
            </>
          )}
        />
        <View style={styles.divider} />
        <View style={styles.tileRow}>
          <View style={[styles.tile, styles.tileFull]}>
            <View style={styles.overviewTeamRow}>
              <TeamLogoImage
                logoPath={teamLogoPath || undefined}
                style={styles.overviewTeamLogo}
                fallbackStyle={styles.overviewTeamLogoFallback}
                fallbackIconSize={22}
              />
              <Text style={styles.overviewTeamName} numberOfLines={2}>
                {teamName}
              </Text>
            </View>
            <Text style={styles.tileLabel}>Squadra</Text>
          </View>
        </View>
      </View>

      {showAbsoluteRanksCard ? (
        <View style={[styles.card, styles.overviewAllTimeCard]}>
          <Text style={[styles.cardSectionTitle, styles.overviewAllTimeTitle]}>All time</Text>
          {loadingAbsoluteRanks ? (
            <View style={styles.overviewRanksLoading}>
              <ActivityIndicator size="small" color="#667eea" />
            </View>
          ) : (
            <TileSplitRow
              left={(
                <>
                  <Text style={styles.tileValue}>
                    {formatOverviewAbsoluteRank(absoluteRanks?.appearances_rank)}
                  </Text>
                  <Text style={styles.tileLabel}>Presenze</Text>
                </>
              )}
              right={(
                <>
                  <Text style={styles.tileValue}>
                    {formatOverviewAbsoluteRank(absoluteRanks?.goals_rank)}
                  </Text>
                  <Text style={styles.tileLabel}>Gol</Text>
                </>
              )}
            />
          )}
        </View>
      ) : null}
      </>
    );
  };

  const renderScopeSubTabs = () => {
    const isTotal = activeScopeSubTab === 'total';
    const totalEnabled = !officialGroupReady || hasOfficialGroup;
    return (
      <View ref={editionPickerAnchorRef} style={styles.scopePeriodWrap} collapsable={false}>
        <View style={styles.scopePeriodControl}>
          <TouchableOpacity
            style={[
              styles.scopePeriodSeg,
              isTotal && totalEnabled && styles.scopePeriodSegActive,
              !totalEnabled && styles.scopePeriodSegDisabled,
            ]}
            onPress={() => {
              if (!totalEnabled) return;
              setEditionPickerOpen(false);
              handleScopeSubTabPress('total');
            }}
            disabled={!totalEnabled}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.scopePeriodSegText,
                isTotal && totalEnabled && styles.scopePeriodSegTextActive,
                !totalEnabled && styles.scopePeriodSegTextDisabled,
              ]}
            >
              Totali
            </Text>
          </TouchableOpacity>
          <View style={styles.scopePeriodDivider} />
          <TouchableOpacity
            style={[styles.scopePeriodSeg, styles.scopePeriodSegYear, !isTotal && styles.scopePeriodSegActive]}
            onPress={handleYearSegmentPress}
            activeOpacity={0.8}
            disabled={editionYearOptions.length === 0}
          >
            <Text style={[styles.scopePeriodSegText, !isTotal && styles.scopePeriodSegTextActive]}>
              {selectedEditionYearLabel}
            </Text>
            {canPickEditionYear ? (
              <Ionicons
                name={editionPickerOpen ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={!isTotal ? '#4f46e5' : '#64748b'}
              />
            ) : null}
          </TouchableOpacity>
        </View>
        <SeasonYearPickerMenu
          open={editionPickerOpen}
          onClose={() => setEditionPickerOpen(false)}
          anchorRef={editionPickerAnchorRef}
          options={editionYearOptions}
          onSelectOption={handleEditionYearSelect}
        />
      </View>
    );
  };

  const renderAggregatedBanner = () => (
    !hasOfficialGroup ? (
      <View style={styles.infoBanner}>
        <Ionicons name="information-circle" size={18} color="#667eea" />
        <Text style={styles.infoBannerText}>
          Statistiche totali disponibili solo per leghe ufficiali con gruppo.
        </Text>
      </View>
    ) : null
  );

  const renderFantaStats = (stats, isLoading) => {
    // Evita di mostrare zeri “finti” se i dati non sono ancora arrivati
    if (isLoading || !stats) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      );
    }

    const s = stats;
    const v = (val) => (typeof val === 'number' ? val : (parseFloat(val) || 0));
    const customExtras = [
      { key: 'briso', value: v(s.total_briso), label: 'MVB' },
      { key: 'pallone_fuori', value: v(s.total_pallone_fuori), label: 'Pallone fuori' },
      { key: 'no_divisa', value: v(s.total_no_divisa), label: 'No divisa' },
    ].filter((item) => item.value > 0);

    const productionCard = (
      <View style={styles.card} key="production">
        <View style={styles.productionHeader}>
          <Text style={[styles.cardSectionTitle, styles.productionHeaderTitle]}>Produzione</Text>
          <Text style={styles.productionScope}>per partita</Text>
        </View>
        <TileSplitRow
          left={(
            <ProductionStatCell
              type="goal"
              value={formatRate(s.goals_per_game)}
              label="Gol"
            />
          )}
          right={(
            <ProductionStatCell
              type="assist"
              value={formatRate(s.assists_per_game)}
              label="Assist"
            />
          )}
        />
        <View style={styles.divider} />
        <TileSplitRow
          left={(
            <ProductionStatCell
              type="yellow_card"
              value={formatRate(s.yellow_cards_per_game)}
              label="Gialli"
            />
          )}
          right={(
            <ProductionStatCell
              type="red_card"
              value={formatRate(s.red_cards_per_game)}
              label="Rossi"
            />
          )}
        />
      </View>
    );

    const goalkeeperCard = showGoalkeeperFantaSection ? (
      <View style={styles.card} key="goalkeeper">
        <View style={styles.productionHeader}>
          <Text style={[styles.cardSectionTitle, styles.productionHeaderTitle]}>Portiere</Text>
          <Text style={styles.productionScope}>per partita</Text>
        </View>
        <TileSplitRow
          left={(
            <ProductionStatCell
              type="clean_sheet"
              value={formatRate(s.clean_sheets_per_game)}
              label="Clean sheet"
            />
          )}
          right={(
            <ProductionStatCell
              type="penalty_saved"
              value={formatRate(s.penalty_saved_per_game)}
              label="Rig. parati"
            />
          )}
        />
        <View style={styles.divider} />
        <View style={styles.tileRow}>
          <View style={[styles.tile, styles.tileFull]}>
            <ProductionStatCell
              type="goals_conceded"
              value={formatRate(s.goals_conceded_per_game)}
              label="Gol subiti"
            />
          </View>
        </View>
      </View>
    ) : null;

    const orderedStatCards = isRecentClusterGoalkeeper && goalkeeperCard
      ? [goalkeeperCard, productionCard]
      : [productionCard, goalkeeperCard].filter(Boolean);

    return (
      <View>
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Rendimento ai gironi</Text>
          <TileSplitRow
            left={(
              <>
                <Text style={styles.tileValue}>{v(s.avg_rating).toFixed(2)}</Text>
                <Text style={styles.tileLabel}>Media voto</Text>
              </>
            )}
            right={(
              <>
                <Text style={[styles.tileValue, { color: '#667eea' }]}>{v(s.avg_rating_with_bonus).toFixed(2)}</Text>
                <Text style={styles.tileLabel}>Media con bonus</Text>
              </>
            )}
          />
          <View style={styles.divider} />
          <TileSplitRow
            left={(
              <>
                <Text style={styles.tileValue}>
                  {v(s.games_with_rating)}
                  <Text style={styles.tileValueMuted}> / {v(s.team_matchdays)}</Text>
                </Text>
                <Text style={styles.tileLabel}>Giornate con voto</Text>
              </>
            )}
            right={(
              <>
                <Text style={styles.tileValue}>{formatPct(s.presence_pct)}</Text>
                <Text style={styles.tileLabel}>% Presenza</Text>
              </>
            )}
          />
        </View>

        {orderedStatCards}

        {customExtras.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardSectionTitle}>Extra lega</Text>
            <View style={styles.bmGrid}>
              {customExtras.map((item) => (
                <View key={item.key} style={styles.bmItem}>
                  <View style={styles.bmIconCircle}>
                    <BonusIcon type={item.key} size={20} />
                  </View>
                  <Text style={styles.bmValue}>{item.value}</Text>
                  <Text style={styles.bmLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    );
  };

  const buildEfficiencyItems = (efficiency, role) => {
    const e = efficiency || {};
    const isGoalkeeper = String(role || '').trim().toUpperCase() === 'P';
    const items = [
      {
        key: 'goals',
        label: 'Gol / presenza',
        value: e.goals_per_presence,
        displayValue: formatRate(e.goals_per_presence),
        max: 1,
      },
      {
        key: 'assists',
        label: 'Assist / presenza',
        value: e.assists_per_presence,
        displayValue: formatRate(e.assists_per_presence),
        max: 1,
      },
      {
        key: 'involvement',
        label: 'G+A / presenza',
        value: e.goal_involvement_per_presence,
        displayValue: formatRate(e.goal_involvement_per_presence),
        max: 1.5,
      },
      {
        key: 'scored',
        label: '% con voto',
        value: e.scored_vote_pct,
        displayValue: formatPct(e.scored_vote_pct),
        max: 100,
      },
      {
        key: 'cards',
        label: 'Cartellini / pres.',
        value: e.cards_per_presence,
        displayValue: formatRate(e.cards_per_presence),
        max: 1,
      },
    ];

    if (isGoalkeeper) {
      items.push(
        {
          key: 'clean_sheet_pct',
          label: '% clean sheet',
          value: e.clean_sheet_pct,
          displayValue: formatPct(e.clean_sheet_pct),
          max: 100,
        },
        {
          key: 'goals_conceded',
          label: 'Gol subiti / pres.',
          value: e.goals_conceded_per_presence,
          displayValue: formatRate(e.goals_conceded_per_presence),
          max: 3,
        },
      );
    }

    return items;
  };

  const renderFavouriteOpponent = (opponentRankings, favouriteOpponent, reason, isGoalkeeper) => {
    const rankings = Array.isArray(opponentRankings) && opponentRankings.length
      ? opponentRankings
      : (favouriteOpponent && Number(favouriteOpponent.value || 0) > 0 ? [favouriteOpponent] : []);

    const sectionTitle = isGoalkeeper ? 'Clean sheet per avversario' : 'Gol per avversario';

    if (!rankings.length) {
      let emptyText = 'Dati disponibili solo con partite ufficiali collegate.';
      if (reason === 'no_events') {
        emptyText = isGoalkeeper
          ? 'Nessuna clean sheet contro avversari con partite ufficiali collegate.'
          : 'Nessun gol contro avversari con partite ufficiali collegate.';
      } else if (reason === 'no_data') {
        emptyText = isGoalkeeper
          ? 'Nessun dato disponibile sulle clean sheet per avversario.'
          : 'Nessun dato disponibile sui gol per avversario.';
      }

      return (
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>{sectionTitle}</Text>
          <Text style={styles.emptyOverviewText}>{emptyText}</Text>
        </View>
      );
    }

    const valueLabel = isGoalkeeper ? 'CS' : 'Gol';

    return (
      <View style={styles.card}>
        <Text style={styles.cardSectionTitle}>{sectionTitle}</Text>
        {rankings.map((item, index) => {
          const teamName = String(item.team_name || '').trim() || '–';
          const key = `opp-${item.team_id || teamName}-${index}`;
          const details = Array.isArray(item.match_details) ? item.match_details : [];
          const expanded = !!expandedOpponentKeys[key];
          const canExpand = details.length > 0;
          return (
            <View key={key} style={[index < rankings.length - 1 && styles.favouriteRowBorder]}>
              <TouchableOpacity
                style={styles.favouriteRow}
                activeOpacity={0.78}
                onPress={() => {
                  if (canExpand) toggleOpponentDetails(key);
                }}
                disabled={!canExpand}
              >
                <Text style={styles.favouriteRank}>{index + 1}</Text>
                <TeamLogoImage
                  logoPath={item.team_logo_path || undefined}
                  style={styles.favouriteLogo}
                  fallbackStyle={styles.favouriteLogoFallback}
                  fallbackIconSize={20}
                />
                <View style={styles.favouriteTextBlock}>
                  <Text style={styles.favouriteTeamName} numberOfLines={1}>
                    {teamName}
                  </Text>
                </View>
                <Text style={styles.favouriteValueCompact}>
                  {item.value}
                  <Text style={styles.favouriteValueLabelCompact}> {valueLabel}</Text>
                </Text>
                {canExpand ? (
                  <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color="#64748b"
                    style={styles.favouriteExpandIcon}
                  />
                ) : null}
              </TouchableOpacity>

              {canExpand && expanded ? (
                <View style={styles.favouriteDetailsWrap}>
                  {details.map((match, matchIdx) => {
                    const mKey = `${key}-m-${match.match_id || matchIdx}`;
                    const matchValue = Number(match?.value || 0);
                    return (
                      <TouchableOpacity
                        key={mKey}
                        style={[
                          styles.favouriteMatchRow,
                          matchIdx < details.length - 1 && styles.favouriteMatchRowBorder,
                        ]}
                        activeOpacity={0.78}
                        onPress={() => openOfficialMatchFromOpponent(match?.match_id)}
                        disabled={!Number(match?.match_id)}
                      >
                        <Text style={styles.favouriteMatchDate}>{formatOpponentMatchDate(match?.kickoff_at)}</Text>
                        <View style={styles.favouriteMatchCenter}>
                          <View style={styles.favouriteMatchTeams}>
                            <TeamLogoImage
                              logoPath={match?.home_team_logo_path || undefined}
                              style={styles.favouriteMatchLogo}
                              fallbackStyle={styles.favouriteMatchLogoFallback}
                              fallbackIconSize={14}
                            />
                            <Text style={styles.favouriteMatchScore}>
                              {Number.isFinite(match?.home_score) ? match.home_score : '-'}
                              {' - '}
                              {Number.isFinite(match?.away_score) ? match.away_score : '-'}
                            </Text>
                            <TeamLogoImage
                              logoPath={match?.away_team_logo_path || undefined}
                              style={styles.favouriteMatchLogo}
                              fallbackStyle={styles.favouriteMatchLogoFallback}
                              fallbackIconSize={14}
                            />
                          </View>
                          <Text style={styles.favouriteMatchTeamsText} numberOfLines={1}>
                            {String(match?.home_team_name || 'Casa')} - {String(match?.away_team_name || 'Trasferta')}
                          </Text>
                        </View>
                        <Text style={styles.favouriteMatchValue}>
                          +{matchValue} {valueLabel}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    );
  };

  const renderAnalytics = (analytics, isLoading, chartMode = 'league') => {
    // Evita di mostrare zeri “finti” se i dati non sono ancora arrivati
    if (isLoading || !analytics) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      );
    }

    const data = analytics;
    const totals = data.totals || {};
    const v = (val) => (typeof val === 'number' ? val : (parseFloat(val) || 0));

    const baseTotals = [
      { key: 'goal', value: v(totals.total_goals), label: 'Gol' },
      { key: 'assist', value: v(totals.total_assists), label: 'Assist' },
      { key: 'briso', value: v(totals.total_briso), label: 'MVP' },
      { key: 'yellow_card', value: v(totals.total_yellow_cards), label: 'Gialli' },
      { key: 'red_card', value: v(totals.total_red_cards), label: 'Rossi' },
      { key: 'own_goal', value: v(totals.total_own_goals), label: 'Autogol' },
      { key: 'penalty_missed', value: v(totals.total_penalty_missed), label: 'Rig. sb.' },
    ];
    const goalkeeperTotals = isRecentClusterGoalkeeper ? [
      { key: 'clean_sheet', value: v(totals.total_clean_sheets), label: 'Clean sheet' },
      { key: 'penalty_saved', value: v(totals.total_penalty_saved), label: 'Rig. parati' },
      { key: 'goals_conceded', value: v(totals.total_goals_conceded), label: 'Gol subiti' },
    ] : [];
    const totalsItems = [...baseTotals, ...goalkeeperTotals];

    return (
      <View>
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Totali</Text>
          <PlayerSeasonTotals
            appearances={v(totals.games_played)}
            items={totalsItems}
            isGoalkeeper={isRecentClusterGoalkeeper}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Forma nel tempo</Text>
          <PlayerFormChart
            key={`form-${chartMode}-${Array.isArray(data.form_series) ? data.form_series.length : 0}`}
            series={data.form_series}
            width={chartWidth}
            mode={chartMode}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Indici di efficienza</Text>
          <EfficiencyBars items={buildEfficiencyItems(data.efficiency, scopeGoalkeeperRole)} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Distribuzione voti</Text>
          <VoteDistributionChart distribution={data.distribution} width={chartWidth} />
        </View>

        {renderFavouriteOpponent(
          data.opponent_rankings,
          data.favourite_opponent,
          data.favourite_opponent_reason,
          scopeGoalkeeperRole === 'P',
        )}
      </View>
    );
  };

  const renderCareer = () => {
    if (loadingCareer || careerHistory === null) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      );
    }

    const entries = Array.isArray(careerHistory) ? careerHistory : [];

    if (!entries.length) {
      return (
        <View style={styles.card}>
          <Text style={styles.emptyOverviewText}>
            Nessuna cronologia carriera disponibile per le edizioni visibili.
          </Text>
        </View>
      );
    }

    const careerTotals = entries.reduce(
      (acc, entry) => ({
        appearances: acc.appearances + Number(entry?.appearances || 0),
        goals: acc.goals + Number(entry?.goals || 0),
        assists: acc.assists + Number(entry?.assists || 0),
      }),
      { appearances: 0, goals: 0, assists: 0 },
    );

    return (
      <View style={styles.careerCard}>
        <View style={styles.careerHeader}>
          <Text style={styles.careerHeaderTitle} numberOfLines={1}>
            Cronologia carriera
          </Text>
          <View style={styles.careerHeaderStats}>
            <View style={styles.careerHeaderStatCol}>
              <MaterialCommunityIcons name="soccer-field" size={18} color="#94a3b8" />
            </View>
            <View style={styles.careerHeaderStatCol}>
              <MaterialCommunityIcons name="soccer" size={18} color="#94a3b8" />
            </View>
            <View style={styles.careerHeaderStatCol}>
              <MaterialCommunityIcons name="shoe-cleat" size={18} color="#94a3b8" />
            </View>
          </View>
        </View>

        <View style={styles.careerDivider} />

        {entries.map((entry, index) => {
          const teamName = String(entry?.team_name || '').trim() || '–';
          const teamLogoPath = String(entry?.team_logo_path || '').trim();
          const leagueYearLabel = formatCareerLeagueYear(entry);
          const appearances = Number(entry?.appearances || 0);
          const goals = Number(entry?.goals || 0);
          const assists = Number(entry?.assists || 0);
          const canOpenTeam = Number(entry?.team_id) > 0 && Number(entry?.competition_id) > 0;
          const rowKey = `${entry?.player_id || 0}-${entry?.league_id || 0}-${entry?.reference_year || index}`;

          return (
            <View key={rowKey}>
              <View style={styles.careerRow}>
                <TouchableOpacity
                  style={styles.careerTeamPressable}
                  activeOpacity={canOpenTeam ? 0.72 : 1}
                  disabled={!canOpenTeam}
                  onPress={() => openCareerTeam(entry)}
                >
                  <TeamLogoImage
                    logoPath={teamLogoPath || undefined}
                    style={styles.careerTeamLogo}
                    fallbackStyle={styles.careerTeamLogoFallback}
                    fallbackIconSize={18}
                  />

                  <View style={styles.careerTeamTextBlock}>
                    <View style={styles.careerTeamInfo}>
                      <Text style={styles.careerTeamName} numberOfLines={1}>
                        {teamName}
                      </Text>
                      <Text style={styles.careerLeagueYear} numberOfLines={1}>
                        {leagueYearLabel}
                      </Text>
                    </View>
                    <CareerEditionTrophyIcons
                      championship={!!entry?.won_championship}
                      wine={!!entry?.won_wine_trophy}
                    />
                  </View>
                </TouchableOpacity>

                <View style={styles.careerStats}>
                  <Text style={styles.careerStatValue}>{appearances}</Text>
                  <Text style={styles.careerStatValue}>{goals}</Text>
                  <Text style={styles.careerStatValue}>{assists}</Text>
                </View>
              </View>
              {index < entries.length - 1 ? <View style={styles.careerRowDivider} /> : null}
            </View>
          );
        })}

        <View style={styles.careerTotalsDivider} />
        <View style={styles.careerTotalsRow}>
          <View style={styles.careerTotalsLabelWrap}>
            <Text style={styles.careerTotalsLabel}>Totali</Text>
          </View>
          <View style={styles.careerStats}>
            <Text style={styles.careerStatTotal}>{careerTotals.appearances}</Text>
            <Text style={styles.careerStatTotal}>{careerTotals.goals}</Text>
            <Text style={styles.careerStatTotal}>{careerTotals.assists}</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderMainTabContent = () => {
    switch (activeMainTab) {
      case 'overview':
        return renderOverview();
      case 'stats':
        return (
          <>
            {renderScopeSubTabs()}
            {activeScopeSubTab === 'league' && renderAnalytics(
              editionAnalytics,
              loadingEditionAnalytics || loadingOverview,
              'league',
            )}
            {activeScopeSubTab === 'total' && (
              officialGroupReady && !hasOfficialGroup ? (
                renderAggregatedBanner()
              ) : (
                renderAnalytics(
                  aggregatedAnalytics,
                  !officialGroupReady
                    || loadingAggregatedAnalytics
                    || !aggregatedAnalytics,
                  'total',
                )
              )
            )}
          </>
        );
      case 'career':
        return renderCareer();
      case 'fantacoppa':
        return (
          <>
            {renderScopeSubTabs()}
            {activeScopeSubTab === 'league' && renderFantaStats(
              fantaEditionData?.stats,
              loadingFantaEdition || loadingOverview || !fantaEditionData,
            )}
            {activeScopeSubTab === 'total' && (
              officialGroupReady && !hasOfficialGroup ? (
                renderAggregatedBanner()
              ) : (
                renderFantaStats(
                  aggregatedFantaStats,
                  !officialGroupReady
                    || loadingAggregatedFanta
                    || !aggregatedFantaStats,
                )
              )
            )}
          </>
        );
      default:
        return null;
    }
  };

  const heroTrophies = overview?.trophies;
  const heroTrophyCount = Number(heroTrophies?.championships || 0) + Number(heroTrophies?.wine_trophies || 0);
  const showHeroTrophies = Boolean(
    !loadingOverview
      && heroTrophies
      && heroTrophyCount > 0
      && (entrySource === 'official' || hasOfficialGroup),
  );

  return (
    <View style={styles.container}>
      <View style={[styles.heroCard, { paddingTop: Math.max(insets.top + 6, 12) }]}>
        <View style={styles.heroTopBlock}>
          <View style={styles.heroTopRow}>
            <TouchableOpacity style={styles.heroBackBtn} onPress={() => navigation.goBack()} activeOpacity={0.75}>
              <Ionicons name="arrow-back" size={20} color="#333" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.heroVsBtn}
              onPress={() => navigation.navigate('PlayerCompare', {
                playerAId: playerId,
                leagueAId: leagueId,
                playerAName: playerName,
                playerARole: playerRole,
                playerAPhotoPath: photoPath || initialPlayerPhotoPath,
              })}
              activeOpacity={0.75}
              accessibilityLabel="Confronta giocatori"
            >
              <CompareVsIcon size={22} color="#667eea" />
            </TouchableOpacity>
          </View>

          <View style={styles.heroNameBlock}>
            {firstName ? (
              <Text style={styles.heroFirstName} numberOfLines={1}>
                {firstName}
              </Text>
            ) : null}
            <Text style={[styles.heroLastName, firstName ? styles.heroLastNameSpaced : null]} numberOfLines={2}>
              {lastName || firstName || 'Giocatore'}
            </Text>
          </View>
        </View>

        <View style={styles.heroPhotoSection}>
          <View style={styles.heroPhotoWrap}>
            {photoPath ? (
              <View style={styles.heroPhotoClip}>
                <PlayerPhotoImage
                  photoPath={photoPath}
                  style={styles.heroPhoto}
                  fallbackStyle={styles.heroPhotoFallback}
                  fallbackIconSize={64}
                />
              </View>
            ) : (
              <View style={styles.heroPhotoFallback}>
                <Ionicons name="person-outline" size={64} color="#667eea" />
              </View>
            )}
            {showHeroTrophies ? (
              <View style={styles.heroTrophyOverlay}>
                <PlayerHeroTrophyBadges
                  championships={heroTrophies.championships}
                  wineTrophies={heroTrophies.wine_trophies}
                />
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.tabsWrap}>
        <IconUnderlineTabBar
          tabs={MAIN_TABS}
          activeKey={activeMainTab}
          onSelect={handleMainTabPress}
        />
      </View>

      <ScrollView
        ref={mainScrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + insets.bottom }]}
      >
        {renderMainTabContent()}
      </ScrollView>

      {toastMsg && (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },

  heroCard: {
    marginTop: 0,
    backgroundColor: '#fff',
    borderBottomWidth: 0,
    paddingBottom: 10,
    paddingHorizontal: 14,
    overflow: 'visible',
  },
  heroTopBlock: {
    zIndex: 2,
    elevation: 2,
    alignSelf: 'stretch',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  heroBackBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  heroVsBtn: {
    minWidth: 48,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#d8d8d8',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  heroNameBlock: {
    marginTop: 10,
    alignSelf: 'stretch',
    paddingRight: 8,
    maxWidth: '52%',
  },
  heroFirstName: {
    fontSize: 20,
    fontWeight: '400',
    color: '#475569',
    textAlign: 'left',
    lineHeight: 24,
  },
  heroLastName: {
    fontSize: 30,
    fontWeight: '800',
    color: '#222',
    textAlign: 'left',
    lineHeight: 34,
  },
  heroLastNameSpaced: {
    marginTop: 2,
  },
  heroPhotoSection: {
    marginTop: -10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
    elevation: 1,
  },
  heroPhotoWrap: {
    width: HERO_PHOTO_SIZE,
    height: HERO_PHOTO_SIZE,
    position: 'relative',
  },
  heroTrophyOverlay: {
    position: 'absolute',
    right: -80,
    bottom: -2,
    zIndex: 3,
    elevation: 3,
  },
  heroPhotoClip: {
    width: HERO_PHOTO_SIZE,
    height: HERO_PHOTO_SIZE,
    borderRadius: HERO_PHOTO_RADIUS,
    overflow: 'hidden',
  },
  heroPhoto: {
    width: HERO_PHOTO_SIZE,
    height: HERO_PHOTO_SIZE,
  },
  heroPhotoFallback: {
    width: HERO_PHOTO_SIZE,
    height: HERO_PHOTO_SIZE,
    borderRadius: HERO_PHOTO_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },

  tabsWrap: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d1d5db',
  },

  scopePeriodWrap: {
    marginBottom: 14,
    position: 'relative',
  },
  scopePeriodControl: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 10,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  scopePeriodSeg: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  scopePeriodSegYear: {
    justifyContent: 'center',
  },
  scopePeriodSegActive: {
    backgroundColor: '#eef2ff',
  },
  scopePeriodSegDisabled: {
    opacity: 0.45,
  },
  scopePeriodSegText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
  },
  scopePeriodSegTextActive: {
    color: '#4f46e5',
  },
  scopePeriodSegTextDisabled: {
    color: '#94a3b8',
  },
  scopePeriodDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: '#dbe3ef',
  },

  seasonPickerModalRoot: { flex: 1 },
  seasonPickerModalBackdrop: { ...StyleSheet.absoluteFillObject },
  seasonPickerDropdownModal: {
    position: 'absolute',
    maxHeight: SEASON_YEAR_PICKER_MAX_HEIGHT,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 10,
    backgroundColor: '#fff',
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  seasonPickerDropdownScroll: { maxHeight: SEASON_YEAR_PICKER_MAX_HEIGHT },
  seasonPickerDropdownScrollContent: { paddingVertical: 4 },
  seasonPickerItem: {
    minHeight: 40,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  seasonPickerItemLast: { borderBottomWidth: 0 },
  seasonPickerItemActive: { backgroundColor: '#eef2ff' },
  seasonPickerItemText: { fontSize: 14, fontWeight: '600', color: '#334155' },
  seasonPickerItemTextActive: { color: '#4f46e5', fontWeight: '700' },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },

  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 14,
  },
  overviewAllTimeCard: {
    paddingTop: 10,
    paddingBottom: 10,
  },
  overviewAllTimeTitle: {
    textAlign: 'center',
    marginBottom: 8,
  },
  tileRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  tile: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingVertical: 4,
  },
  tileDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: '#eee',
  },
  tileValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2c3e50',
    marginBottom: 2,
  },
  tileValueMuted: {
    fontSize: 18,
    fontWeight: '600',
    color: '#94a3b8',
  },
  tileValueRole: {
    width: '100%',
    fontSize: 22,
    fontWeight: '700',
    color: '#2c3e50',
    marginBottom: 2,
    textAlign: 'center',
  },
  tileLabel: {
    fontSize: 11,
    color: '#999',
  },
  tileValueSmallMeta: {
    fontSize: 15,
    fontWeight: '700',
    color: '#475569',
    textAlign: 'center',
    lineHeight: 20,
  },
  tileFull: {
    flex: 1,
    width: '100%',
  },
  overviewTeamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 2,
    paddingHorizontal: 8,
  },
  overviewTeamLogo: {
    width: 40,
    height: 40,
  },
  overviewTeamLogoFallback: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overviewTeamName: {
    flexShrink: 1,
    fontSize: 22,
    fontWeight: '700',
    color: '#2c3e50',
    textAlign: 'left',
  },
  emptyOverviewText: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginVertical: 12,
  },

  bmGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: 14,
  },
  productionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  productionHeaderTitle: {
    marginBottom: 0,
  },
  productionScope: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94a3b8',
    letterSpacing: 0.2,
  },
  productionCell: {
    alignItems: 'center',
    gap: 5,
    paddingVertical: 2,
  },
  productionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  productionCellValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2c3e50',
  },
  productionCellLabel: {
    fontSize: 11,
    color: '#999',
    textAlign: 'center',
  },
  bmItem: {
    alignItems: 'center',
    gap: 4,
    width: '25%',
  },
  bmItemWide: {
    alignItems: 'center',
    gap: 4,
    width: '25%',
    marginBottom: 4,
  },
  bmIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  bmValue: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2c3e50',
  },
  bmLabel: {
    fontSize: 10,
    color: '#999',
    textAlign: 'center',
  },

  favouriteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  favouriteRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  favouriteRank: {
    width: 22,
    fontSize: 13,
    fontWeight: '800',
    color: '#94a3b8',
    textAlign: 'center',
  },
  favouriteLogo: {
    width: 36,
    height: 36,
  },
  favouriteLogoFallback: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  favouriteTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  favouriteValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1e293b',
  },
  favouriteValueLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#667eea',
  },
  favouriteValueCompact: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1e293b',
  },
  favouriteValueLabelCompact: {
    fontSize: 12,
    fontWeight: '700',
    color: '#667eea',
  },
  favouriteExpandIcon: {
    marginLeft: 4,
  },
  favouriteTeamName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
  },
  favouriteDetailsWrap: {
    marginTop: 2,
    marginBottom: 8,
    marginLeft: 0,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  },
  favouriteMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  favouriteMatchRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#dbe3ef',
  },
  favouriteMatchCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favouriteMatchTeams: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  favouriteMatchLogo: {
    width: 24,
    height: 24,
  },
  favouriteMatchLogoFallback: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  favouriteMatchScore: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    minWidth: 62,
    textAlign: 'center',
  },
  favouriteMatchTeamsText: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
  },
  favouriteMatchDate: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    minWidth: 66,
  },
  favouriteMatchValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1e40af',
    minWidth: 54,
    textAlign: 'right',
  },

  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef0fb',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
    gap: 10,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#4a5568',
    lineHeight: 18,
  },

  loadingBox: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  overviewRanksLoading: {
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ececec',
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
  },

  careerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  careerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  careerHeaderTitle: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    marginRight: 8,
    fontSize: 13,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  careerHeaderStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
    paddingRight: 2,
  },
  careerHeaderStatCol: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  careerDivider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginBottom: 0,
  },
  careerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    gap: 8,
  },
  careerTeamPressable: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginRight: 4,
  },
  careerTeamLogo: {
    width: 36,
    height: 36,
  },
  careerTeamLogoFallback: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  careerTeamTextBlock: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  careerTeamInfo: {
    flexShrink: 1,
    minWidth: 0,
    gap: 3,
  },
  careerTeamName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
  },
  careerLeagueYear: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '500',
  },
  careerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  careerStatValue: {
    width: 22,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: '#64748b',
  },
  careerRowDivider: {
    height: 1,
    backgroundColor: '#f5f5f5',
    marginLeft: 48,
  },
  careerTotalsDivider: {
    height: 1,
    backgroundColor: '#e8ecf0',
    marginTop: 2,
  },
  careerTotalsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
    gap: 8,
  },
  careerTotalsLabelWrap: {
    flex: 1,
    minWidth: 0,
    marginRight: 4,
  },
  careerTotalsLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1e293b',
    letterSpacing: 0.2,
  },
  careerStatTotal: {
    width: 22,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '800',
    color: '#1e293b',
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
});

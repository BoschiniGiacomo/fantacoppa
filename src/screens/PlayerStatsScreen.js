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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { playerStatsService } from '../services/api';
import { PlayerPhotoImage, TeamLogoImage } from '../components/StableCachedImage';
import { formatCompetitionRank } from '../utils/standingsRanking';
import BonusIcon from '../components/BonusIcon';
import PlayerHeroTrophyBadges, { CareerEditionTrophyIcons } from '../components/PlayerHeroTrophyBadges';

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
  { key: 'overview', label: 'Panoramica' },
  { key: 'stats', label: 'Statistiche' },
  { key: 'career', label: 'Carriera' },
  { key: 'fantacoppa', label: 'FantaCoppa' },
];

const SEASON_YEAR_PICKER_MAX_HEIGHT = 180;

const HERO_PHOTO_SIZE = 184;
const HERO_PHOTO_RADIUS = 16;

function resolveInitialTabs(entrySource) {
  if (entrySource === 'official') {
    return { mainTab: 'overview', fantaSubTab: 'league' };
  }
  return { mainTab: 'fantacoppa', fantaSubTab: 'league' };
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
        setLayout({ left: x, top: y + height + 2, width: Math.max(width, 120) });
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
            {options.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.seasonPickerItem, item.active && styles.seasonPickerItemActive]}
                onPress={() => onSelectOption(item)}
                activeOpacity={0.8}
              >
                <Text style={[styles.seasonPickerItemText, item.active && styles.seasonPickerItemTextActive]}>
                  {item.label}
                </Text>
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
  const [activeMainTab, setActiveMainTab] = useState(initialTabs.mainTab);
  const [activeFantaSubTab, setActiveFantaSubTab] = useState(initialTabs.fantaSubTab);
  const [leagueStats, setLeagueStats] = useState(null);
  const [aggregatedStats, setAggregatedStats] = useState(null);
  const [loadingLeague, setLoadingLeague] = useState(true);
  const [loadingAggregated, setLoadingAggregated] = useState(false);
  const [hasOfficialGroup, setHasOfficialGroup] = useState(false);
  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [absoluteRanks, setAbsoluteRanks] = useState(null);
  const [loadingAbsoluteRanks, setLoadingAbsoluteRanks] = useState(false);
  const [careerHistory, setCareerHistory] = useState(null);
  const [loadingCareer, setLoadingCareer] = useState(false);
  const [selectedEditionKey, setSelectedEditionKey] = useState(null);
  const [editionPickerOpen, setEditionPickerOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [photoPath, setPhotoPath] = useState(() => String(initialPlayerPhotoPath || '').trim());
  const editionPickerAnchorRef = useRef(null);
  const mainScrollRef = useRef(null);
  const officialGroupCheckDoneRef = useRef(false);
  const statsLoadGenRef = useRef(0);
  const careerPrefetchStartedRef = useRef(false);

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

  const playerInfo = leagueStats?.player;
  const displayPlayerRole = String(playerInfo?.role || playerRole || '').trim().toUpperCase();
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

    void bootstrapPlayerScreen();
    if (initialTabs.mainTab === 'fantacoppa' || entrySource === 'official') {
      void checkOfficialGroup();
    }
  }, [playerId, leagueId]);

  useEffect(() => {
    if (entrySource === 'official' || !hasOfficialGroup || absoluteRanks || loadingAbsoluteRanks) return;
    void loadAbsoluteRanks();
  }, [hasOfficialGroup, entrySource, absoluteRanks, loadingAbsoluteRanks, playerId, leagueId]);

  const applyEditionStats = (response, loadGen) => {
    if (loadGen !== statsLoadGenRef.current) return false;

    setLeagueStats(response.data);
    if (response.data?.player?.photo_path) {
      setPhotoPath((prev) => prev || String(response.data.player.photo_path || '').trim());
    }
    return true;
  };

  const loadEditionStats = async (editionPlayerId, editionLeagueId, options = {}) => {
    const targetPlayerId = Number(editionPlayerId);
    const targetLeagueId = Number(editionLeagueId);
    if (!targetPlayerId || !targetLeagueId) return;

    const loadGen = ++statsLoadGenRef.current;
    const { reusePromise = null } = options;

    try {
      setLoadingLeague(true);

      const response = reusePromise
        ? await reusePromise
        : await playerStatsService.getPlayerStats(targetPlayerId, targetLeagueId);

      applyEditionStats(response, loadGen);
    } catch (error) {
      if (loadGen === statsLoadGenRef.current) {
        showToast('Impossibile caricare le statistiche del giocatore');
      }
      console.error(error);
    } finally {
      if (loadGen === statsLoadGenRef.current) {
        setLoadingLeague(false);
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
    let routeEditionPromise = null;

    try {
      setLoadingOverview(true);
      setLoadingLeague(true);

      const overviewPromise = playerStatsService.getPlayerOverview(playerId, leagueId);
      routeEditionPromise = playerStatsService.getPlayerStats(playerId, leagueId);

      if (entrySource === 'official') {
        void loadAbsoluteRanks();
      }

      const response = await overviewPromise;
      const nextOverview = response.data?.overview || null;
      setOverview(nextOverview);

      const editions = Array.isArray(nextOverview?.editions) ? nextOverview.editions : [];
      const defaultEdition = resolveDefaultEdition(editions, playerId, leagueId);
      const defaultKey = editionKey(defaultEdition);
      setSelectedEditionKey(defaultKey);

      const routeMatchesDefault = Number(defaultEdition.player_id) === Number(playerId)
        && Number(defaultEdition.league_id) === Number(leagueId);

      if (routeMatchesDefault) {
        await loadEditionStats(playerId, leagueId, { reusePromise: routeEditionPromise });
      } else {
        void loadEditionStats(defaultEdition.player_id, defaultEdition.league_id);
      }

      InteractionManager.runAfterInteractions(() => {
        if (careerPrefetchStartedRef.current || careerHistory) return;
        careerPrefetchStartedRef.current = true;
        void loadCareer({ prefetch: true });
      });
    } catch (error) {
      setOverview(null);
      setSelectedEditionKey(editionKey({ player_id: playerId, league_id: leagueId }));

      try {
        await loadEditionStats(playerId, leagueId, {
          reusePromise: routeEditionPromise,
        });
      } catch (_) {
        void loadEditionStats(playerId, leagueId);
      }

      console.error(error);
    } finally {
      setLoadingOverview(false);
    }
  };

  const checkOfficialGroup = async () => {
    if (officialGroupCheckDoneRef.current) return;
    officialGroupCheckDoneRef.current = true;
    try {
      setLoadingAggregated(true);
      const response = await playerStatsService.getPlayerAggregatedStats(playerId, leagueId);
      setAggregatedStats(response.data.stats);
      setHasOfficialGroup(true);
      if (response.data?.player?.photo_path) {
        setPhotoPath((prev) => prev || String(response.data.player.photo_path || '').trim());
      }
    } catch (error) {
      setHasOfficialGroup(false);
    } finally {
      setLoadingAggregated(false);
    }
  };

  const handleEditionYearSelect = (item) => {
    setEditionPickerOpen(false);
    setActiveFantaSubTab('league');
    const edition = item?.edition;
    if (!edition) return;

    const nextKey = editionKey(edition);
    if (nextKey === selectedEditionKey) return;

    setSelectedEditionKey(nextKey);
    loadEditionStats(edition.player_id, edition.league_id);
  };

  const handleEditionSubTabPress = () => {
    setActiveFantaSubTab('league');
    if (canPickEditionYear) {
      setEditionPickerOpen((open) => !open);
    }
  };
  const loadAggregatedStats = async () => {
    if (aggregatedStats) return;
    try {
      setLoadingAggregated(true);
      const response = await playerStatsService.getPlayerAggregatedStats(playerId, leagueId);
      setAggregatedStats(response.data.stats);
      setHasOfficialGroup(true);
    } catch (error) {
      showToast('Impossibile caricare le statistiche aggregate');
      console.error(error);
    } finally {
      setLoadingAggregated(false);
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
    if (tabKey !== 'fantacoppa') {
      setEditionPickerOpen(false);
    }
    setActiveMainTab(tabKey);
    mainScrollRef.current?.scrollTo({ y: 0, animated: false });
    if (tabKey === 'fantacoppa') {
      void checkOfficialGroup();
      if (activeFantaSubTab === 'total') {
        loadAggregatedStats();
      }
    }
    if (tabKey === 'career') {
      loadCareer();
    }
  };

  const handleFantaSubTabPress = (subTabKey) => {
    setEditionPickerOpen(false);
    setActiveFantaSubTab(subTabKey);
    if (subTabKey === 'total') {
      loadAggregatedStats();
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
                  <Text style={styles.tileLabel}>Goal</Text>
                </>
              )}
            />
          )}
        </View>
      ) : null}
      </>
    );
  };

  const renderStats = (stats, isLoading) => {
    if (isLoading) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      );
    }

    const s = stats || {};
    const v = (val) => (typeof val === 'number' ? val : (parseFloat(val) || 0));

    return (
      <View>
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Rendimento</Text>
          <TileSplitRow
            left={(
              <>
                <Text style={styles.tileValue}>{v(s.avg_rating).toFixed(2)}</Text>
                <Text style={styles.tileLabel}>Media Voto</Text>
              </>
            )}
            right={(
              <>
                <Text style={[styles.tileValue, { color: '#667eea' }]}>{v(s.avg_rating_with_bonus).toFixed(2)}</Text>
                <Text style={styles.tileLabel}>Media con Bonus</Text>
              </>
            )}
          />
          <View style={styles.divider} />
          <TileSplitRow
            left={(
              <>
                <Text style={styles.tileValue}>{v(s.games_played)}</Text>
                <Text style={styles.tileLabel}>Presenze</Text>
              </>
            )}
            right={(
              <>
                <Text style={styles.tileValue}>{v(s.games_with_rating)}</Text>
                <Text style={styles.tileLabel}>Con Voto</Text>
              </>
            )}
          />
        </View>

        {displayPlayerRole === 'P' && (
          <View style={styles.card}>
            <Text style={styles.cardSectionTitle}>Statistiche Portiere</Text>
            <View style={styles.bmGrid}>
              {[
                { key: 'clean_sheet', value: v(s.total_clean_sheets), label: 'Clean sheet' },
                { key: 'penalty_saved', value: v(s.total_penalty_saved), label: 'Rig. parati' },
                { key: 'goals_conceded', value: v(s.total_goals_conceded), label: 'Goal subiti' },
              ].map((item) => (
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

        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Bonus</Text>
          <View style={styles.bmGrid}>
            {[
              { key: 'goal', value: v(s.total_goals), label: 'Goal' },
              { key: 'assist', value: v(s.total_assists), label: 'Assist' },
              ...(displayPlayerRole !== 'P' && v(s.total_penalty_saved) > 0
                ? [{ key: 'penalty_saved', value: v(s.total_penalty_saved), label: 'Rig. parati' }] : []),
              ...(displayPlayerRole !== 'P' && v(s.total_clean_sheets) > 0
                ? [{ key: 'clean_sheet', value: v(s.total_clean_sheets), label: 'Clean sheet' }] : []),
            ].map((item) => (
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

        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Malus</Text>
          <View style={styles.bmGrid}>
            {[
              { key: 'yellow_card', value: v(s.total_yellow_cards), label: 'Gialli' },
              { key: 'red_card', value: v(s.total_red_cards), label: 'Rossi' },
              { key: 'own_goal', value: v(s.total_own_goals), label: 'Autogoal' },
              { key: 'penalty_missed', value: v(s.total_penalty_missed), label: 'Rig. sbagliati' },
              ...(displayPlayerRole !== 'P' && v(s.total_goals_conceded) > 0
                ? [{ key: 'goals_conceded', value: v(s.total_goals_conceded), label: 'Goal subiti' }] : []),
            ].map((item) => (
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
      </View>
    );
  };

  const renderCareer = () => {
    if (loadingCareer) {
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
          <EmptyTabPlaceholder
            icon="bar-chart-outline"
            title="Statistiche"
            subtitle="Dati di rendimento e metriche dettagliate della stagione."
          />
        );
      case 'career':
        return renderCareer();
      case 'fantacoppa':
        return (
          <>
            <View style={styles.subTabBar}>
              <View
                ref={editionPickerAnchorRef}
                style={styles.subTabPickerWrap}
                collapsable={false}
              >
                <TouchableOpacity
                  style={[
                    styles.subTabBtn,
                    styles.subTabPickerBtn,
                    activeFantaSubTab === 'league' && styles.subTabBtnActive,
                  ]}
                  onPress={handleEditionSubTabPress}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.subTabText,
                      activeFantaSubTab === 'league' && styles.subTabTextActive,
                    ]}
                  >
                    {selectedEditionYearLabel}
                  </Text>
                  {canPickEditionYear && (
                    <Ionicons
                      name={editionPickerOpen ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color={activeFantaSubTab === 'league' ? '#667eea' : '#475569'}
                      style={styles.subTabPickerIcon}
                    />
                  )}
                </TouchableOpacity>
                <SeasonYearPickerMenu
                  open={editionPickerOpen}
                  onClose={() => setEditionPickerOpen(false)}
                  anchorRef={editionPickerAnchorRef}
                  options={editionYearOptions}
                  onSelectOption={handleEditionYearSelect}
                />
              </View>

              <TouchableOpacity
                style={[
                  styles.subTabBtn,
                  activeFantaSubTab === 'total' && styles.subTabBtnActive,
                  !hasOfficialGroup && styles.subTabBtnDisabled,
                ]}
                onPress={() => {
                  if (hasOfficialGroup) handleFantaSubTabPress('total');
                }}
                disabled={!hasOfficialGroup}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.subTabText,
                    activeFantaSubTab === 'total' && hasOfficialGroup && styles.subTabTextActive,
                    !hasOfficialGroup && styles.subTabTextDisabled,
                  ]}
                >
                  Totali
                </Text>
              </TouchableOpacity>
            </View>

            {activeFantaSubTab === 'league' && renderStats(leagueStats?.stats, loadingLeague)}

            {activeFantaSubTab === 'total' && (
              <>
                {!hasOfficialGroup && (
                  <View style={styles.infoBanner}>
                    <Ionicons name="information-circle" size={18} color="#667eea" />
                    <Text style={styles.infoBannerText}>
                      Statistiche totali disponibili solo per leghe ufficiali con gruppo.
                    </Text>
                  </View>
                )}
                {hasOfficialGroup && renderStats(aggregatedStats, loadingAggregated)}
              </>
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
          <TouchableOpacity style={styles.heroBackBtn} onPress={() => navigation.goBack()} activeOpacity={0.75}>
            <Ionicons name="arrow-back" size={20} color="#333" />
          </TouchableOpacity>

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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsScrollContent}
      >
        {MAIN_TABS.map((tab) => {
          const isActive = activeMainTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tabBtn, isActive && styles.tabBtnActive]}
              onPress={() => handleMainTabPress(tab.key)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

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
    borderBottomWidth: 1,
    borderColor: '#ececec',
    paddingBottom: 10,
    paddingHorizontal: 14,
    overflow: 'visible',
  },
  heroTopBlock: {
    zIndex: 2,
    elevation: 2,
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

  tabsScroll: {
    marginTop: 8,
    maxHeight: 46,
  },
  tabsScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  tabBtn: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexShrink: 0,
  },
  tabBtnActive: {
    borderColor: '#667eea',
    backgroundColor: '#eef2ff',
  },
  tabText: {
    color: '#475569',
    fontWeight: '700',
    fontSize: 13,
  },
  tabTextActive: {
    color: '#667eea',
  },

  subTabBar: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  subTabPickerWrap: {
    flex: 1,
    position: 'relative',
  },
  subTabPickerBtn: {
    flexDirection: 'row',
    gap: 4,
  },
  subTabPickerIcon: {
    marginTop: 1,
  },
  subTabBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subTabBtnActive: {
    borderColor: '#667eea',
    backgroundColor: '#eef2ff',
  },
  subTabBtnDisabled: {
    opacity: 0.45,
  },
  subTabText: {
    color: '#475569',
    fontWeight: '700',
    fontSize: 13,
  },
  subTabTextActive: {
    color: '#667eea',
  },
  subTabTextDisabled: {
    color: '#94a3b8',
  },

  seasonPickerModalRoot: { flex: 1 },
  seasonPickerModalBackdrop: { ...StyleSheet.absoluteFillObject },
  seasonPickerDropdownModal: {
    position: 'absolute',
    height: SEASON_YEAR_PICKER_MAX_HEIGHT,
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
  seasonPickerDropdownScroll: { height: SEASON_YEAR_PICKER_MAX_HEIGHT },
  seasonPickerDropdownScrollContent: { paddingBottom: 4 },
  seasonPickerItem: {
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
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
  bmItem: {
    alignItems: 'center',
    gap: 4,
    width: '25%',
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

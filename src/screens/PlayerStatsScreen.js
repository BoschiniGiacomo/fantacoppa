import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { playerStatsService } from '../services/api';
import { PlayerPhotoImage, TeamLogoImage } from '../components/StableCachedImage';
import BonusIcon from '../components/BonusIcon';
import PlayerHeroTrophyBadges from '../components/PlayerHeroTrophyBadges';

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

const FANTA_SUB_TABS = [
  { key: 'league', label: 'Lega' },
  { key: 'total', label: 'Totali' },
];

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
  const [toastMsg, setToastMsg] = useState(null);
  const [photoPath, setPhotoPath] = useState(() => String(initialPlayerPhotoPath || '').trim());

  const playerInfo = leagueStats?.player;
  const { firstName, lastName } = useMemo(
    () => resolvePlayerDisplayName(playerInfo, playerName),
    [playerInfo, playerName],
  );

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useEffect(() => {
    loadLeagueStats();
    checkOfficialGroup();
    loadOverview();
  }, [playerId, leagueId]);

  const loadOverview = async () => {
    try {
      setLoadingOverview(true);
      const response = await playerStatsService.getPlayerOverview(playerId, leagueId);
      setOverview(response.data?.overview || null);
    } catch (error) {
      setOverview(null);
      console.error(error);
    } finally {
      setLoadingOverview(false);
    }
  };

  const checkOfficialGroup = async () => {
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

  const loadLeagueStats = async () => {
    try {
      setLoadingLeague(true);
      const response = await playerStatsService.getPlayerStats(playerId, leagueId);
      setLeagueStats(response.data);
      if (response.data?.player?.photo_path) {
        setPhotoPath((prev) => prev || String(response.data.player.photo_path || '').trim());
      }
    } catch (error) {
      showToast('Impossibile caricare le statistiche del giocatore');
      console.error(error);
    } finally {
      setLoadingLeague(false);
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

  const handleMainTabPress = (tabKey) => {
    setActiveMainTab(tabKey);
    if (tabKey === 'fantacoppa' && activeFantaSubTab === 'total') {
      loadAggregatedStats();
    }
  };

  const handleFantaSubTabPress = (subTabKey) => {
    setActiveFantaSubTab(subTabKey);
    if (subTabKey === 'total') {
      loadAggregatedStats();
    }
  };

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

    return (
      <View style={styles.card}>
        <View style={styles.tileRow}>
          <View style={styles.tile}>
            <Text style={styles.tileValue}>{formatOverviewValue(overview.birth_year)}</Text>
            <Text style={styles.tileLabel}>Anno</Text>
          </View>
          <View style={[styles.tile, styles.tileRight]}>
            <Text
              style={styles.tileValueRole}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {formatOverviewRole(overview.role)}
            </Text>
            <Text style={styles.tileLabel}>Ruolo</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.tileRow}>
          <View style={styles.tile}>
            <Text style={styles.tileValue}>{formatOverviewValue(overview.shirt_number)}</Text>
            <Text style={styles.tileLabel}>Numero</Text>
          </View>
          <View style={[styles.tile, styles.tileRight]}>
            <Text style={styles.tileValue}>{formatOverviewValue(overview.editions_played)}</Text>
            <Text style={styles.tileLabel}>Edizioni giocate</Text>
          </View>
        </View>
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
          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <Text style={styles.tileValue}>{v(s.avg_rating).toFixed(2)}</Text>
              <Text style={styles.tileLabel}>Media Voto</Text>
            </View>
            <View style={[styles.tile, styles.tileRight]}>
              <Text style={[styles.tileValue, { color: '#667eea' }]}>{v(s.avg_rating_with_bonus).toFixed(2)}</Text>
              <Text style={styles.tileLabel}>Media con Bonus</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <Text style={styles.tileValue}>{v(s.games_played)}</Text>
              <Text style={styles.tileLabel}>Presenze</Text>
            </View>
            <View style={[styles.tile, styles.tileRight]}>
              <Text style={styles.tileValue}>{v(s.games_with_rating)}</Text>
              <Text style={styles.tileLabel}>Con Voto</Text>
            </View>
          </View>
        </View>

        {playerRole === 'P' && (
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
              ...(playerRole !== 'P' && v(s.total_penalty_saved) > 0
                ? [{ key: 'penalty_saved', value: v(s.total_penalty_saved), label: 'Rig. parati' }] : []),
              ...(playerRole !== 'P' && v(s.total_clean_sheets) > 0
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
              ...(playerRole !== 'P' && v(s.total_goals_conceded) > 0
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
        return (
          <EmptyTabPlaceholder
            icon="time-outline"
            title="Carriera"
            subtitle="Storico club, trasferimenti e percorsi nelle stagioni passate."
          />
        );
      case 'fantacoppa':
        return (
          <>
            <View style={styles.subTabBar}>
              {FANTA_SUB_TABS.map((tab) => {
                const isActive = activeFantaSubTab === tab.key;
                const isDisabled = tab.key === 'total' && !hasOfficialGroup;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={[
                      styles.subTabBtn,
                      isActive && styles.subTabBtnActive,
                      isDisabled && styles.subTabBtnDisabled,
                    ]}
                    onPress={() => {
                      if (!isDisabled) handleFantaSubTabPress(tab.key);
                    }}
                    disabled={isDisabled}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.subTabText,
                        isActive && !isDisabled && styles.subTabTextActive,
                        isDisabled && styles.subTabTextDisabled,
                      ]}
                    >
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
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
  tileRight: {
    borderLeftWidth: 1,
    borderLeftColor: '#eee',
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

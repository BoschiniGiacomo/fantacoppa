import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { leagueService } from '../services/api';
import { FantasyTeamLogoImage, PlayerPhotoImage } from '../components/StableCachedImage';
import MatchdayFormationPanel from '../components/MatchdayFormationPanel';
import RankingFiltersBar from '../components/RankingFiltersBar';
import { formatVoteRating } from '../utils/voteRating';

const ROLE_COLORS = { P: '#0d6efd', D: '#198754', C: '#e6a817', A: '#dc3545' };
const LIMIT_OPTIONS = [
  { id: '5', label: 'Top 5' },
  { id: '10', label: 'Top 10' },
  { id: 'all', label: 'All' },
];

const RANKING_SECTION_DEFAULTS = {
  most_purchased: '5',
  least_purchased: '5',
  top_fantavoti: '5',
  bottom_fantavoti: '5',
  best_purchases: '5',
};

function playerLabel(player) {
  const first = String(player?.first_name || '').trim();
  const last = String(player?.last_name || '').trim();
  return [first, last].filter(Boolean).join(' ') || 'Giocatore';
}

function matchesRankingSearch(player, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    player?.first_name,
    player?.last_name,
    player?.team_name,
    player?.role,
    player?.giornata != null ? `g.${player.giornata}` : '',
    player?.giornata,
    player?.purchase_count,
    player?.fantavoto,
    player?.value_ratio,
    player?.cost,
    player?.total_fantavoto_sum,
  ]
    .map((v) => String(v ?? '').toLowerCase())
    .join(' ');
  return haystack.includes(q);
}

function matchesRankingFilters(player, selectedRoles, selectedTeamIds) {
  const roles = Array.isArray(selectedRoles) ? selectedRoles : [];
  const teamIds = Array.isArray(selectedTeamIds) ? selectedTeamIds : [];
  if (roles.length > 0) {
    const role = String(player?.role || '').trim().toUpperCase();
    if (!roles.includes(role)) return false;
  }
  if (teamIds.length > 0) {
    const tid = Number(player?.team_id);
    if (!teamIds.includes(tid)) return false;
  }
  return true;
}

function StatSection({ title, subtitle, icon, accentColor, children, emptyText, hasListContent }) {
  const hasContent = hasListContent != null ? hasListContent : React.Children.count(children) > 0;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconWrap, { backgroundColor: `${accentColor}18` }]}>
          <Ionicons name={icon} size={20} color={accentColor} />
        </View>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      <View style={styles.sectionBody}>
        {hasContent ? children : (
          <Text style={styles.emptyText}>{emptyText}</Text>
        )}
      </View>
    </View>
  );
}

function RankedListSection({
  title,
  subtitle,
  icon,
  accentColor,
  emptyText,
  items,
  limit,
  onLimitChange,
  loadingAll,
  searchQuery,
  onSearchChange,
  officialTeams,
  selectedRoles,
  selectedTeamIds,
  onToggleRole,
  onToggleTeam,
  onClearFilters,
  renderRow,
}) {
  const showSearch = limit === 'all';
  const hasItems = Array.isArray(items) && items.length > 0;
  const hasActiveFilters = (selectedRoles?.length || 0) > 0 || (selectedTeamIds?.length || 0) > 0;
  const hasSearch = showSearch && String(searchQuery || '').trim().length > 0;

  return (
    <StatSection
      title={title}
      subtitle={subtitle}
      icon={icon}
      accentColor={accentColor}
      emptyText={emptyText}
      hasListContent
    >
      <View style={styles.limitBar}>
        {LIMIT_OPTIONS.map((opt) => {
          const active = limit === opt.id;
          return (
            <TouchableOpacity
              key={opt.id}
              style={[styles.limitChip, active && { backgroundColor: `${accentColor}18`, borderColor: accentColor }]}
              onPress={() => onLimitChange(opt.id)}
              activeOpacity={0.75}
            >
              <Text style={[styles.limitChipText, active && { color: accentColor, fontWeight: '700' }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <RankingFiltersBar
        accentColor={accentColor}
        officialTeams={officialTeams}
        selectedRoles={selectedRoles}
        selectedTeamIds={selectedTeamIds}
        onToggleRole={onToggleRole}
        onToggleTeam={onToggleTeam}
        onClearFilters={onClearFilters}
      />

      {showSearch ? (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color="#999" />
          <TextInput
            style={styles.searchInput}
            placeholder="Filtra risultati..."
            placeholderTextColor="#aaa"
            value={searchQuery}
            onChangeText={onSearchChange}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => onSearchChange('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color="#bbb" />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {loadingAll ? (
        <View style={styles.sectionLoading}>
          <ActivityIndicator size="small" color={accentColor} />
          <Text style={styles.sectionLoadingText}>Caricamento elenco completo...</Text>
        </View>
      ) : null}

      {!loadingAll && hasItems
        ? items.map((player, index) => renderRow(player, index))
        : null}

      {!loadingAll && !hasItems && hasSearch ? (
        <Text style={styles.emptyFilterText}>Nessun risultato per la ricerca.</Text>
      ) : null}

      {!loadingAll && !hasItems && !hasSearch && hasActiveFilters ? (
        <Text style={styles.emptyFilterText}>Nessun risultato con i filtri selezionati.</Text>
      ) : null}

      {!loadingAll && !hasItems && !hasSearch && !hasActiveFilters ? (
        <Text style={styles.emptyText}>{emptyText}</Text>
      ) : null}
    </StatSection>
  );
}

function PlayerRow({ rank, player, valueLabel, valueColor = '#667eea', valueHint }) {
  const role = String(player?.role || '').trim().toUpperCase();
  const roleColor = ROLE_COLORS[role] || '#6c757d';
  return (
    <View style={styles.playerRow}>
      <Text style={styles.rankBadge}>{rank}</Text>
      {player?.photo_path ? (
        <View style={styles.playerPhotoCol}>
          <PlayerPhotoImage photoPath={player.photo_path} style={styles.playerPhotoBadge} />
          <View style={[styles.playerPhotoRoleOverlay, { backgroundColor: roleColor }]}>
            <Text style={styles.playerPhotoRoleText}>{role}</Text>
          </View>
        </View>
      ) : (
        <View style={styles.roleBadgeCol}>
          <View style={[styles.roleBadgeMini, { backgroundColor: roleColor }]}>
            <Text style={styles.roleBadgeMiniText}>{role}</Text>
          </View>
        </View>
      )}
      <View style={styles.playerInfo}>
        <Text style={styles.playerName} numberOfLines={1}>{playerLabel(player)}</Text>
        {player?.team_name ? (
          <Text style={styles.playerTeam} numberOfLines={1}>{player.team_name}</Text>
        ) : null}
      </View>
      <View style={styles.valueWrap}>
        <Text style={[styles.valueText, { color: valueColor }]}>{valueLabel}</Text>
        {valueHint ? (
          <Text style={styles.giornataHint}>{valueHint}</Text>
        ) : player?.giornata ? (
          <Text style={styles.giornataHint}>G.{player.giornata}</Text>
        ) : null}
      </View>
    </View>
  );
}

function TeamHighlightCard({
  item,
  variant,
  expanded,
  onPress,
  formationData,
  loadingFormation,
  viewMode,
  onViewModeChange,
}) {
  if (!item) return null;
  const isBest = variant === 'best';
  const accent = isBest ? '#2e7d32' : '#c62828';
  return (
    <View>
      <TouchableOpacity
        style={[styles.teamHighlight, { borderColor: `${accent}55` }]}
        onPress={onPress}
        activeOpacity={0.75}
      >
        <View style={[styles.teamHighlightAccent, { backgroundColor: accent }]} />
        <FantasyTeamLogoImage teamLogo={item.team_logo} style={styles.teamLogo} />
        <View style={styles.teamHighlightBody}>
          <Text style={styles.teamHighlightName} numberOfLines={1}>{item.team_name}</Text>
          <Text style={styles.teamHighlightMeta}>
            {item.giornata}ª giornata · somma titolari
          </Text>
        </View>
        <View style={styles.teamHighlightRight}>
          <Text style={[styles.teamHighlightScore, { color: accent }]}>
            {formatVoteRating(item.total_fantavoto)}
          </Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#bbb" />
        </View>
      </TouchableOpacity>
      {expanded ? (
        <View style={styles.formationBox}>
          <MatchdayFormationPanel
            formationData={formationData}
            loading={loadingFormation}
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
          />
        </View>
      ) : null}
    </View>
  );
}

export default function LeagueStatisticsScreen({ route }) {
  const { leagueId } = route.params || {};
  const insets = useSafeAreaInsets();
  const [league, setLeague] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [expandedTeamCards, setExpandedTeamCards] = useState({});
  const [teamFormations, setTeamFormations] = useState({});
  const [loadingTeamFormations, setLoadingTeamFormations] = useState({});
  const [teamFormationViewMode, setTeamFormationViewMode] = useState({});
  const [sectionLimits, setSectionLimits] = useState({ ...RANKING_SECTION_DEFAULTS });
  const [allRankings, setAllRankings] = useState({});
  const [loadingAllRankings, setLoadingAllRankings] = useState({});
  const [sectionSearch, setSectionSearch] = useState({});
  const [sectionRoleFilters, setSectionRoleFilters] = useState({});
  const [sectionTeamFilters, setSectionTeamFilters] = useState({});

  const officialTeams = useMemo(() => {
    const fromStats = stats?.official_teams;
    return Array.isArray(fromStats) ? fromStats : [];
  }, [stats?.official_teams]);

  const ensureFullRanking = useCallback(async (sectionKey, rankingType) => {
    if (allRankings[sectionKey]) return;
    if (loadingAllRankings[sectionKey]) return;

    setLoadingAllRankings((prev) => ({ ...prev, [sectionKey]: true }));
    try {
      const res = await leagueService.getStatisticsRanking(leagueId, rankingType);
      setAllRankings((prev) => ({ ...prev, [sectionKey]: res.data?.items || [] }));
    } catch (_) {
      setAllRankings((prev) => ({ ...prev, [sectionKey]: [] }));
    } finally {
      setLoadingAllRankings((prev) => ({ ...prev, [sectionKey]: false }));
    }
  }, [allRankings, loadingAllRankings, leagueId]);

  const sectionNeedsFullPool = useCallback((sectionKey) => {
    const limit = sectionLimits[sectionKey] || '5';
    const roles = sectionRoleFilters[sectionKey] || [];
    const teams = sectionTeamFilters[sectionKey] || [];
    return limit === 'all' || roles.length > 0 || teams.length > 0;
  }, [sectionLimits, sectionRoleFilters, sectionTeamFilters]);

  const isSectionPoolLoading = useCallback((sectionKey) => {
    if (!sectionNeedsFullPool(sectionKey)) return false;
    if (allRankings[sectionKey]) return false;
    return !!loadingAllRankings[sectionKey];
  }, [sectionNeedsFullPool, allRankings, loadingAllRankings]);

  const handleLimitChange = useCallback(async (sectionKey, rankingType, newLimit) => {
    setSectionLimits((prev) => ({ ...prev, [sectionKey]: newLimit }));
    if (newLimit !== 'all') {
      setSectionSearch((prev) => ({ ...prev, [sectionKey]: '' }));
    }
    if (newLimit === 'all' || (sectionRoleFilters[sectionKey] || []).length > 0 || (sectionTeamFilters[sectionKey] || []).length > 0) {
      await ensureFullRanking(sectionKey, rankingType);
    }
  }, [ensureFullRanking, sectionRoleFilters, sectionTeamFilters]);

  const toggleSectionRole = useCallback((sectionKey, rankingType, role) => {
    setSectionRoleFilters((prev) => {
      const cur = prev[sectionKey] || [];
      const next = cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role];
      return { ...prev, [sectionKey]: next };
    });
    ensureFullRanking(sectionKey, rankingType);
  }, [ensureFullRanking]);

  const toggleSectionTeam = useCallback((sectionKey, rankingType, teamId) => {
    const tid = Number(teamId);
    setSectionTeamFilters((prev) => {
      const cur = prev[sectionKey] || [];
      const next = cur.includes(tid) ? cur.filter((id) => id !== tid) : [...cur, tid];
      return { ...prev, [sectionKey]: next };
    });
    ensureFullRanking(sectionKey, rankingType);
  }, [ensureFullRanking]);

  const clearSectionFilters = useCallback((sectionKey) => {
    setSectionRoleFilters((prev) => ({ ...prev, [sectionKey]: [] }));
    setSectionTeamFilters((prev) => ({ ...prev, [sectionKey]: [] }));
  }, []);

  const getSectionFilterProps = useCallback((sectionKey, rankingType) => ({
    officialTeams,
    selectedRoles: sectionRoleFilters[sectionKey] || [],
    selectedTeamIds: sectionTeamFilters[sectionKey] || [],
    onToggleRole: (role) => toggleSectionRole(sectionKey, rankingType, role),
    onToggleTeam: (teamId) => toggleSectionTeam(sectionKey, rankingType, teamId),
    onClearFilters: () => clearSectionFilters(sectionKey),
    loadingAll: isSectionPoolLoading(sectionKey),
  }), [
    officialTeams,
    sectionRoleFilters,
    sectionTeamFilters,
    toggleSectionRole,
    toggleSectionTeam,
    clearSectionFilters,
    isSectionPoolLoading,
  ]);

  const getSectionItems = useCallback((sectionKey, statKey) => {
    const limit = sectionLimits[sectionKey] || '5';
    const roles = sectionRoleFilters[sectionKey] || [];
    const teams = sectionTeamFilters[sectionKey] || [];
    const needsFull = limit === 'all' || roles.length > 0 || teams.length > 0;

    if (!needsFull) {
      const preview = stats?.[statKey] || [];
      return limit === '5' ? preview.slice(0, 5) : preview.slice(0, 10);
    }

    const pool = allRankings[sectionKey];
    if (!pool) return [];

    let filtered = pool.filter((p) => matchesRankingFilters(p, roles, teams));
    if (limit === 'all') {
      const q = sectionSearch[sectionKey] || '';
      filtered = filtered.filter((p) => matchesRankingSearch(p, q));
      return filtered;
    }
    const n = limit === '5' ? 5 : 10;
    return filtered.slice(0, n);
  }, [sectionLimits, sectionRoleFilters, sectionTeamFilters, stats, allRankings, sectionSearch]);

  const mostPurchasedItems = useMemo(
    () => getSectionItems('most_purchased', 'most_purchased'),
    [getSectionItems]
  );
  const leastPurchasedItems = useMemo(
    () => getSectionItems('least_purchased', 'least_purchased'),
    [getSectionItems]
  );
  const topFantavotiItems = useMemo(
    () => getSectionItems('top_fantavoti', 'top_fantavoti'),
    [getSectionItems]
  );
  const bottomFantavotiItems = useMemo(
    () => getSectionItems('bottom_fantavoti', 'bottom_fantavoti'),
    [getSectionItems]
  );
  const bestPurchasesItems = useMemo(
    () => getSectionItems('best_purchases', 'best_purchases'),
    [getSectionItems]
  );

  const toggleTeamFormation = useCallback(async (cardKey, item) => {
    if (!item?.user_id || !item?.giornata) return;
    const isExpanded = !!expandedTeamCards[cardKey];
    if (isExpanded) {
      setExpandedTeamCards((prev) => ({ ...prev, [cardKey]: false }));
      return;
    }
    setExpandedTeamCards((prev) => ({ ...prev, [cardKey]: true }));
    if (teamFormations[cardKey]) return;

    setLoadingTeamFormations((prev) => ({ ...prev, [cardKey]: true }));
    try {
      const res = await leagueService.getMatchdayFormation(leagueId, item.giornata, item.user_id);
      setTeamFormations((prev) => ({ ...prev, [cardKey]: res.data }));
    } catch (_) {
      setTeamFormations((prev) => ({ ...prev, [cardKey]: null }));
    } finally {
      setLoadingTeamFormations((prev) => ({ ...prev, [cardKey]: false }));
    }
  }, [expandedTeamCards, leagueId, teamFormations]);

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      setError(null);
      const [leagueRes, statsRes] = await Promise.all([
        leagueService.getById(leagueId),
        leagueService.getStatistics(leagueId),
      ]);
      const leagueData = Array.isArray(leagueRes.data) ? leagueRes.data[0] : leagueRes.data;
      setLeague(leagueData);
      setStats(statsRes.data || null);
      if (!isRefresh) {
        setExpandedTeamCards({});
        setTeamFormations({});
        setLoadingTeamFormations({});
        setSectionLimits({ ...RANKING_SECTION_DEFAULTS });
        setAllRankings({});
        setLoadingAllRankings({});
        setSectionSearch({});
        setSectionRoleFilters({});
        setSectionTeamFilters({});
      } else {
        setAllRankings({});
      }
    } catch (err) {
      const msg = err?.response?.data?.message || 'Impossibile caricare le statistiche';
      setError(msg);
      setStats(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [leagueId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading && !stats) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1 }} />
          <View style={{ flex: 2, alignItems: 'center' }}>
            <Text style={styles.headerTitle}>Statistiche</Text>
            {league?.name ? <Text style={styles.leagueName}>{league.name}</Text> : null}
          </View>
          <View style={{ flex: 1 }} />
        </View>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 80 }]}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadData(true);
            }}
            tintColor="#667eea"
          />
        )}
      >
        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={18} color="#c62828" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <RankedListSection
          title="Più acquistati"
          subtitle="Giocatori con più proprietari in lega"
          icon="bag-outline"
          accentColor="#667eea"
          emptyText="Nessun dato sul mercato."
          items={mostPurchasedItems}
          limit={sectionLimits.most_purchased}
          onLimitChange={(lim) => handleLimitChange('most_purchased', 'most_purchased', lim)}
          searchQuery={sectionSearch.most_purchased || ''}
          onSearchChange={(text) => setSectionSearch((prev) => ({ ...prev, most_purchased: text }))}
          {...getSectionFilterProps('most_purchased', 'most_purchased')}
          renderRow={(player, index) => (
            <PlayerRow
              key={`most-${player.player_id}-${index}`}
              rank={index + 1}
              player={player}
              valueLabel={`${player.purchase_count}`}
              valueColor="#667eea"
            />
          )}
        />

        {(stats?.least_purchased || []).length > 0
          || sectionLimits.least_purchased !== '5'
          || !!allRankings.least_purchased
          || (sectionRoleFilters.least_purchased || []).length > 0
          || (sectionTeamFilters.least_purchased || []).length > 0 ? (
          <RankedListSection
            title="Meno acquistati"
            subtitle="Giocatori con meno proprietari in lega"
            icon="trending-down-outline"
            accentColor="#6c757d"
            emptyText="Nessun dato."
            items={leastPurchasedItems}
            limit={sectionLimits.least_purchased}
            onLimitChange={(lim) => handleLimitChange('least_purchased', 'least_purchased', lim)}
            searchQuery={sectionSearch.least_purchased || ''}
            onSearchChange={(text) => setSectionSearch((prev) => ({ ...prev, least_purchased: text }))}
            {...getSectionFilterProps('least_purchased', 'least_purchased')}
            renderRow={(player, index) => (
              <PlayerRow
                key={`least-${player.player_id}-${index}`}
                rank={index + 1}
                player={player}
                valueLabel={`${player.purchase_count}`}
                valueColor="#6c757d"
              />
            )}
          />
        ) : null}

        <StatSection
          title="Miglior giornata di squadra"
          subtitle="Somma fantavoto titolari · tocca per la formazione"
          icon="trophy-outline"
          accentColor="#2e7d32"
          emptyText="Calcola almeno una giornata per vedere questo dato."
        >
          {stats?.best_team_matchday ? (
            <TeamHighlightCard
              item={stats.best_team_matchday}
              variant="best"
              expanded={!!expandedTeamCards.best}
              onPress={() => toggleTeamFormation('best', stats.best_team_matchday)}
              formationData={teamFormations.best}
              loadingFormation={!!loadingTeamFormations.best}
              viewMode={teamFormationViewMode.best || 'field'}
              onViewModeChange={(mode) => setTeamFormationViewMode((prev) => ({ ...prev, best: mode }))}
            />
          ) : null}
        </StatSection>

        <StatSection
          title="Peggior giornata di squadra"
          subtitle="Somma fantavoto titolari · tocca per la formazione"
          icon="sad-outline"
          accentColor="#c62828"
          emptyText="Nessuna giornata con punteggio valido (escluse le formazioni a 0)."
        >
          {stats?.worst_team_matchday ? (
            <TeamHighlightCard
              item={stats.worst_team_matchday}
              variant="worst"
              expanded={!!expandedTeamCards.worst}
              onPress={() => toggleTeamFormation('worst', stats.worst_team_matchday)}
              formationData={teamFormations.worst}
              loadingFormation={!!loadingTeamFormations.worst}
              viewMode={teamFormationViewMode.worst || 'field'}
              onViewModeChange={(mode) => setTeamFormationViewMode((prev) => ({ ...prev, worst: mode }))}
            />
          ) : null}
        </StatSection>

        <RankedListSection
          title="Fantavoti più alti"
          subtitle="Migliori prestazioni singole per giornata"
          icon="arrow-up-circle-outline"
          accentColor="#2e7d32"
          emptyText="Inserisci voti e calcola le giornate per vedere questo dato."
          items={topFantavotiItems}
          limit={sectionLimits.top_fantavoti}
          onLimitChange={(lim) => handleLimitChange('top_fantavoti', 'top_fantavoti', lim)}
          searchQuery={sectionSearch.top_fantavoti || ''}
          onSearchChange={(text) => setSectionSearch((prev) => ({ ...prev, top_fantavoti: text }))}
          {...getSectionFilterProps('top_fantavoti', 'top_fantavoti')}
          renderRow={(player, index) => (
            <PlayerRow
              key={`top-${player.player_id}-${player.giornata}-${index}`}
              rank={index + 1}
              player={player}
              valueLabel={formatVoteRating(player.fantavoto)}
              valueColor="#2e7d32"
            />
          )}
        />

        <RankedListSection
          title="Fantavoti più bassi"
          subtitle="Peggiori prestazioni singole per giornata"
          icon="arrow-down-circle-outline"
          accentColor="#c62828"
          emptyText="Inserisci voti e calcola le giornate per vedere questo dato."
          items={bottomFantavotiItems}
          limit={sectionLimits.bottom_fantavoti}
          onLimitChange={(lim) => handleLimitChange('bottom_fantavoti', 'bottom_fantavoti', lim)}
          searchQuery={sectionSearch.bottom_fantavoti || ''}
          onSearchChange={(text) => setSectionSearch((prev) => ({ ...prev, bottom_fantavoti: text }))}
          {...getSectionFilterProps('bottom_fantavoti', 'bottom_fantavoti')}
          renderRow={(player, index) => (
            <PlayerRow
              key={`bottom-${player.player_id}-${player.giornata}-${index}`}
              rank={index + 1}
              player={player}
              valueLabel={formatVoteRating(player.fantavoto)}
              valueColor="#c62828"
            />
          )}
        />

        <RankedListSection
          title="Migliori acquisti"
          subtitle="Somma fantavoti in lega ÷ costo d'acquisto"
          icon="trending-up-outline"
          accentColor="#667eea"
          emptyText="Servono acquisti in lega e voti inseriti per calcolare il rapporto."
          items={bestPurchasesItems}
          limit={sectionLimits.best_purchases}
          onLimitChange={(lim) => handleLimitChange('best_purchases', 'best_purchases', lim)}
          searchQuery={sectionSearch.best_purchases || ''}
          onSearchChange={(text) => setSectionSearch((prev) => ({ ...prev, best_purchases: text }))}
          {...getSectionFilterProps('best_purchases', 'best_purchases')}
          renderRow={(player, index) => (
            <PlayerRow
              key={`buy-${player.player_id}-${index}`}
              rank={index + 1}
              player={player}
              valueLabel={Number(player.value_ratio || 0).toFixed(2)}
              valueHint={`${formatVoteRating(player.total_fantavoto_sum)} / ${formatVoteRating(player.cost)}`}
              valueColor="#667eea"
            />
          )}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f6fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
  },
  leagueName: {
    fontSize: 13,
    color: '#888',
    marginTop: 1,
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 14,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fce4ec',
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    flex: 1,
    color: '#c62828',
    fontSize: 14,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 10,
  },
  sectionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeaderText: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a2e',
  },
  sectionSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#888',
  },
  sectionBody: {
    padding: 10,
    gap: 8,
  },
  limitBar: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 2,
  },
  limitChip: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    backgroundColor: '#fafafa',
    alignItems: 'center',
  },
  limitChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f5f6fa',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ececec',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    paddingVertical: 0,
  },
  sectionLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  sectionLoadingText: {
    fontSize: 13,
    color: '#888',
  },
  emptyFilterText: {
    color: '#999',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
    fontStyle: 'italic',
  },
  emptyText: {
    color: '#999',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fafbfc',
    borderRadius: 12,
    padding: 10,
    gap: 10,
  },
  rankBadge: {
    width: 22,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    color: '#999',
  },
  playerPhotoCol: {
    width: 56,
    height: 56,
    position: 'relative',
  },
  playerPhotoBadge: {
    width: 56,
    height: 56,
  },
  playerPhotoRoleOverlay: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  playerPhotoRoleText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  roleBadgeCol: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBadgeMini: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBadgeMiniText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  playerInfo: {
    flex: 1,
    minWidth: 0,
  },
  playerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a2e',
  },
  playerTeam: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  valueWrap: {
    alignItems: 'flex-end',
    minWidth: 48,
  },
  valueText: {
    fontSize: 16,
    fontWeight: '700',
  },
  giornataHint: {
    marginTop: 2,
    fontSize: 11,
    color: '#999',
  },
  teamHighlight: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fafbfc',
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 12,
    gap: 12,
  },
  teamHighlightAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  teamLogo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginLeft: 4,
  },
  teamHighlightBody: {
    flex: 1,
    minWidth: 0,
  },
  teamHighlightRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  teamHighlightName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a2e',
  },
  teamHighlightMeta: {
    marginTop: 3,
    fontSize: 12,
    color: '#888',
  },
  teamHighlightScore: {
    fontSize: 22,
    fontWeight: '800',
  },
  formationBox: {
    backgroundColor: '#fafafa',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
});

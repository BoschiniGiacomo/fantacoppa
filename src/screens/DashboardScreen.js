import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { leagueService } from '../services/api';
import {
  invalidateAllLeagueWarmCache,
  invalidateLeagueWarmCache,
  peekHomeLeaguesBootstrapSnapshot,
} from '../services/leagueWarmCache';
import { registerPushTokenIfPermitted, syncLeagueNotifications } from '../services/notificationService';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { hiddenLeagues, consumePendingToast } from '../utils/dashboardEvents';
import { leagueHasAccessCode } from '../utils/leagueJoin';

const FILTERS = [
  { key: 'all', label: 'Tutte', icon: 'apps-outline' },
  { key: 'official', label: 'Ufficiali', icon: 'ribbon-outline' },
  { key: 'favorite', label: 'Preferite', icon: 'star-outline' },
  { key: 'admin', label: 'Admin', icon: 'shield-checkmark-outline' },
  { key: 'public', label: 'Pubbliche', icon: 'globe-outline' },
  { key: 'private', label: 'Private', icon: 'lock-closed-outline' },
];

function leagueMatchesFilter(league, filterKey) {
  if (filterKey === 'all') return true;
  const isOfficial = Number(league?.is_official) === 1 || league?.is_official === true;
  const isPrivate = leagueHasAccessCode(league);
  if (filterKey === 'official') return isOfficial;
  if (filterKey === 'favorite') return !!league.favorite && !league.archived;
  if (filterKey === 'admin') return league?.role === 'admin';
  if (filterKey === 'public') return !isPrivate;
  if (filterKey === 'private') return isPrivate;
  return true;
}

export default function DashboardScreen({ navigation }) {
  const { width: windowWidth } = useWindowDimensions();
  const [leagues, setLeagues] = useState(() => {
    const snap = peekHomeLeaguesBootstrapSnapshot();
    return snap != null ? snap : [];
  });
  const [pendingRequests, setPendingRequests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterKey, setFilterKey] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [filterMenuLayout, setFilterMenuLayout] = useState(null);
  const [loading, setLoading] = useState(() => peekHomeLeaguesBootstrapSnapshot() == null);
  const [refreshing, setRefreshing] = useState(false);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const filterBtnRef = useRef(null);

  const hasActiveFilters = filterKey !== 'all';

  const showToast = useCallback((text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  }, []);

  useEffect(() => {
    if (!showFilters) {
      setFilterMenuLayout(null);
      return undefined;
    }
    let cancelled = false;
    const measureAnchor = () => {
      const node = filterBtnRef?.current;
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
          const panelWidth = Math.min(280, Math.max(220, windowWidth - 24));
          const left = Math.max(12, Math.min(x + width - panelWidth, windowWidth - panelWidth - 12));
          setFilterMenuLayout({
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
  }, [showFilters, windowWidth]);

  const closeFilters = useCallback(() => setShowFilters(false), []);
  const clearFilters = useCallback(() => {
    setFilterKey('all');
    setShowFilters(false);
  }, []);
  const selectFilter = useCallback((key) => {
    setFilterKey(key);
    setShowFilters(false);
  }, []);

  const loadLeagues = useCallback(async () => {
    registerPushTokenIfPermitted().catch(() => {});
    const toast = consumePendingToast();
    if (toast) showToast(toast.text, toast.type);
    try {
      const [response, pendingRes] = await Promise.all([
        leagueService.getAll(),
        leagueService.getMyJoinRequests().catch(() => ({ data: { requests: [] } })),
      ]);
      const raw = response?.data;
      const data = Array.isArray(raw) ? raw : [];
      const normalized = data.map((league) => ({
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
      }));
      const filtered =
        hiddenLeagues.size > 0
          ? normalized.filter((l) => !hiddenLeagues.has(l.id))
          : normalized;
      setLeagues(filtered);
      const pendingRaw = pendingRes?.data?.requests;
      setPendingRequests(Array.isArray(pendingRaw) ? pendingRaw : []);
      syncLeagueNotifications(filtered).catch(() => {});
    } catch (error) {
      showToast('Impossibile caricare le leghe');
      console.error(error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useFocusEffect(
    useCallback(() => {
      loadLeagues();
    }, [loadLeagues])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    invalidateAllLeagueWarmCache();
    loadLeagues();
  }, [loadLeagues]);

  const filteredLeagues = useMemo(() => {
    const list = Array.isArray(leagues) ? leagues : [];
    let next = list.filter((league) => leagueMatchesFilter(league, filterKey));
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      next = next.filter(
        (league) => league?.name && String(league.name).toLowerCase().includes(query)
      );
    }
    return next;
  }, [leagues, searchQuery, filterKey]);

  const filteredCount = filteredLeagues.length;

  const favoriteLeagues = useMemo(
    () => filteredLeagues.filter((league) => league.favorite && !league.archived),
    [filteredLeagues]
  );

  const archivedLeagues = useMemo(
    () => filteredLeagues.filter((league) => league.archived),
    [filteredLeagues]
  );

  const normalLeagues = useMemo(
    () => filteredLeagues.filter((league) => !league.favorite && !league.archived),
    [filteredLeagues]
  );

  const filteredPendingRequests = useMemo(() => {
    // Le richieste in attesa restano visibili solo senza filtro attivo.
    if (hasActiveFilters) return [];
    const list = Array.isArray(pendingRequests) ? pendingRequests : [];
    if (!searchQuery.trim()) return list;
    const query = searchQuery.toLowerCase().trim();
    return list.filter(
      (req) => req?.league_name && String(req.league_name).toLowerCase().includes(query)
    );
  }, [pendingRequests, searchQuery, hasActiveFilters]);

  const patchLeaguePrefs = useCallback((leagueId, patch) => {
    setLeagues((prev) =>
      prev.map((l) => (l.id === leagueId ? { ...l, ...patch } : l))
    );
  }, []);

  const toggleFavorite = useCallback(
    async (leagueId, currentFavorite) => {
      const league = leagues.find((l) => l.id === leagueId);
      if (!league) return;
      const nextFavorite = !currentFavorite;
      patchLeaguePrefs(leagueId, {
        favorite: nextFavorite,
        archived: nextFavorite ? false : league.archived,
      });
      try {
        await leagueService.updatePrefs(leagueId, {
          favorite: nextFavorite ? 1 : 0,
          archived: nextFavorite ? 0 : league.archived ? 1 : 0,
          notifications_enabled: league.notifications_enabled === false ? 0 : 1,
        });
        invalidateLeagueWarmCache(leagueId);
      } catch (error) {
        patchLeaguePrefs(leagueId, {
          favorite: currentFavorite,
          archived: league.archived,
        });
        const errorMessage =
          error.response?.data?.message || error.message || 'Impossibile aggiornare le preferenze';
        showToast(errorMessage);
        console.error('Toggle favorite error:', error);
      }
    },
    [leagues, patchLeaguePrefs, showToast]
  );

  const toggleArchived = useCallback(
    async (leagueId, currentArchived) => {
      const league = leagues.find((l) => l.id === leagueId);
      if (!league) return;
      const nextArchived = !currentArchived;
      patchLeaguePrefs(leagueId, {
        archived: nextArchived,
        favorite: nextArchived ? false : league.favorite,
      });
      try {
        await leagueService.updatePrefs(leagueId, {
          favorite: nextArchived ? 0 : league.favorite ? 1 : 0,
          archived: nextArchived ? 1 : 0,
          notifications_enabled: league.notifications_enabled === false ? 0 : 1,
        });
        invalidateLeagueWarmCache(leagueId);
        if (nextArchived) setArchivedExpanded(true);
      } catch (error) {
        patchLeaguePrefs(leagueId, {
          archived: currentArchived,
          favorite: league.favorite,
        });
        const errorMessage =
          error.response?.data?.message || error.message || 'Impossibile aggiornare le preferenze';
        showToast(errorMessage);
        console.error('Toggle archived error:', error);
      }
    },
    [leagues, patchLeaguePrefs, showToast]
  );

  const toggleNotifications = useCallback(
    async (leagueId, currentEnabled) => {
      const league = leagues.find((l) => l.id === leagueId);
      if (!league) return;
      const nextEnabled = !currentEnabled;
      patchLeaguePrefs(leagueId, { notifications_enabled: nextEnabled });
      try {
        await leagueService.updatePrefs(leagueId, {
          favorite: league.favorite ? 1 : 0,
          archived: league.archived ? 1 : 0,
          notifications_enabled: nextEnabled ? 1 : 0,
        });
        invalidateLeagueWarmCache(leagueId);
      } catch (error) {
        patchLeaguePrefs(leagueId, { notifications_enabled: currentEnabled });
        const errorMessage =
          error.response?.data?.message || error.message || 'Impossibile aggiornare notifiche lega';
        showToast(errorMessage);
        console.error('Toggle notifications error:', error);
      }
    },
    [leagues, patchLeaguePrefs, showToast]
  );

  const handleLeaguePress = useCallback(
    (league) => {
      navigation.navigate('League', { leagueId: league.id });
    },
    [navigation]
  );

  const renderLeagueItem = useCallback(
    (item) => {
      const isOfficial = Number(item?.is_official) === 1 || item?.is_official === true;
      const autoLineup = item.auto_lineup_mode === 1 || item.auto_lineup_mode === true;
      const marketLocked = Number(item.market_locked) === 1;
      const matchdayLabel = item.current_matchday
        ? `${item.current_matchday}ª giornata`
        : 'Non iniziata';
      const memberCount = Number(item?.user_count ?? item?.member_count ?? 0) || 0;

      return (
        <TouchableOpacity
          key={item.id}
          style={styles.leagueCard}
          onPress={() => handleLeaguePress(item)}
          activeOpacity={0.85}
        >
          <View style={styles.leagueHeader}>
            <View style={styles.trophyIconWrap}>
              <Ionicons name="trophy" size={24} color="#f0a500" />
              {isOfficial ? (
                <View style={styles.officialMark}>
                  <Ionicons name="ribbon" size={9} color="#667eea" />
                </View>
              ) : null}
            </View>
            <Text style={styles.leagueName} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={styles.leagueActions}>
              <TouchableOpacity
                onPress={() => toggleFavorite(item.id, item.favorite)}
                style={styles.actionButton}
                hitSlop={6}
                accessibilityLabel={item.favorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
              >
                <Ionicons
                  name={item.favorite ? 'star' : 'star-outline'}
                  size={20}
                  color={item.favorite ? '#f0a500' : '#94a3b8'}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => toggleArchived(item.id, item.archived)}
                style={styles.actionButton}
                hitSlop={6}
                accessibilityLabel={item.archived ? 'Ripristina dagli archiviati' : 'Archivia'}
              >
                <Ionicons
                  name={item.archived ? 'archive' : 'archive-outline'}
                  size={20}
                  color={item.archived ? '#64748b' : '#94a3b8'}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => toggleNotifications(item.id, !!item.notifications_enabled)}
                style={styles.actionButton}
                hitSlop={6}
                accessibilityLabel={
                  item.notifications_enabled ? 'Disattiva notifiche' : 'Attiva notifiche'
                }
              >
                <Ionicons
                  name={
                    item.notifications_enabled
                      ? 'notifications-outline'
                      : 'notifications-off-outline'
                  }
                  size={20}
                  color={item.notifications_enabled ? '#667eea' : '#94a3b8'}
                />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.leagueInfo}>
            <View style={styles.leagueBadgeContainer}>
              {item.role === 'admin' ? (
                <View style={[styles.leagueBadge, styles.adminBadge]}>
                  <Text style={styles.adminBadgeText}>Admin</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.usersContainer}>
              <Ionicons name="people-outline" size={16} color="#999" />
              <Text style={styles.usersValue}>{memberCount}</Text>
            </View>
          </View>

          <View style={styles.leagueFooter}>
            <View style={styles.matchdayLeft}>
              <Ionicons name="calendar-outline" size={16} color="#999" />
              <Text style={styles.leagueMatchday}>{matchdayLabel}</Text>
            </View>
            <View style={styles.verticalDivider} />
            <View style={styles.formationContainer}>
              <Text style={styles.formationLabel}>Auto-formazione</Text>
              <Text style={[styles.formationValue, autoLineup ? styles.metaYes : styles.metaNo]}>
                {autoLineup ? 'Sì' : 'No'}
              </Text>
            </View>
            <View style={styles.verticalDivider} />
            <View style={styles.marketContainer}>
              <Text style={styles.marketLabel}>Mercato</Text>
              <Text style={[styles.marketValue, marketLocked ? styles.metaNo : styles.metaYes]}>
                {marketLocked ? 'Chiuso' : 'Aperto'}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [handleLeaguePress, toggleFavorite, toggleArchived, toggleNotifications]
  );

  const renderPendingItem = useCallback((item) => (
    <View
      key={`pending-${item.request_id || item.league_id}`}
      style={[styles.leagueCard, styles.pendingCard]}
    >
      <View style={styles.leagueHeader}>
        <Ionicons name="hourglass-outline" size={24} color="#b8860b" />
        <Text style={[styles.leagueName, styles.pendingLeagueName]} numberOfLines={1}>
          {item.league_name}
        </Text>
      </View>
      <View style={styles.leagueInfo}>
        <View style={[styles.leagueBadge, styles.pendingBadge]}>
          <Text style={styles.pendingBadgeText}>In attesa di revisione</Text>
        </View>
      </View>
    </View>
  ), []);

  const renderSection = useCallback(
    (title, data, icon, iconColor = '#667eea', isCollapsible = false, expanded = true, onToggle = null) => {
      if (data.length === 0) return null;
      const isFavoriteSection = iconColor === '#f0a500';

      return (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={isCollapsible ? onToggle : undefined}
            disabled={!isCollapsible}
            activeOpacity={isCollapsible ? 0.7 : 1}
          >
            <Ionicons name={icon} size={18} color={iconColor} />
            <Text style={styles.sectionTitle}>{title}</Text>
            <View
              style={[
                styles.sectionCountPill,
                isFavoriteSection && styles.sectionCountPillFav,
              ]}
            >
              <Text
                style={[
                  styles.sectionCount,
                  isFavoriteSection && styles.sectionCountFav,
                ]}
              >
                {data.length}
              </Text>
            </View>
            {isCollapsible ? (
              <Ionicons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color="#94a3b8"
                style={styles.chevron}
              />
            ) : null}
          </TouchableOpacity>
          {(!isCollapsible || expanded) && data.map((league) => renderLeagueItem(league))}
        </View>
      );
    },
    [renderLeagueItem]
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      </SafeAreaView>
    );
  }

  const isEmpty = filteredLeagues.length === 0 && filteredPendingRequests.length === 0;
  const showNormalTitle = favoriteLeagues.length > 0 || archivedLeagues.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Le mie leghe</Text>
        <View style={styles.searchRow}>
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={18} color="#94a3b8" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Cerca per nome…"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              placeholderTextColor="#94a3b8"
            />
            {searchQuery.length > 0 ? (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#94a3b8" />
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity
            ref={filterBtnRef}
            style={[styles.filterBtn, (hasActiveFilters || showFilters) && styles.filterBtnActive]}
            onPress={() => setShowFilters((open) => !open)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Filtri leghe"
          >
            <Ionicons
              name="options-outline"
              size={20}
              color={hasActiveFilters ? '#667eea' : '#94a3b8'}
            />
            <View
              style={[
                styles.filterCountBadge,
                hasActiveFilters && styles.filterCountBadgeActive,
              ]}
            >
              <Text
                style={[
                  styles.filterCountBadgeText,
                  hasActiveFilters && styles.filterCountBadgeTextActive,
                ]}
                numberOfLines={1}
              >
                {filteredCount}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#667eea" />
        }
      >
        {renderSection('Preferite', favoriteLeagues, 'star', '#f0a500')}
        {renderSection(
          showNormalTitle ? 'Altre leghe' : 'Le tue leghe',
          normalLeagues,
          'trophy-outline'
        )}
        {filteredPendingRequests.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="time-outline" size={18} color="#b8860b" />
              <Text style={styles.sectionTitle}>In attesa</Text>
              <View style={[styles.sectionCountPill, styles.sectionCountPillWarn]}>
                <Text style={[styles.sectionCount, styles.sectionCountWarn]}>
                  {filteredPendingRequests.length}
                </Text>
              </View>
            </View>
            {filteredPendingRequests.map((req) => renderPendingItem(req))}
          </View>
        ) : null}
        {renderSection(
          'Archiviate',
          archivedLeagues,
          'archive-outline',
          '#64748b',
          true,
          archivedExpanded,
          () => setArchivedExpanded((v) => !v)
        )}

        {isEmpty ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="trophy-outline" size={36} color="#94a3b8" />
            </View>
            <Text style={styles.emptyText}>
              {searchQuery.trim() || hasActiveFilters ? 'Nessuna lega trovata' : 'Nessuna lega'}
            </Text>
            <Text style={styles.emptySubtext}>
              {searchQuery.trim()
                ? 'Prova un altro nome'
                : hasActiveFilters
                  ? 'Prova un altro filtro'
                  : 'Crea o unisciti a una lega per iniziare'}
            </Text>
            {hasActiveFilters || searchQuery.trim() ? (
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => {
                  clearFilters();
                  setSearchQuery('');
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.emptyButtonText}>Azzera filtri</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => navigation.navigate('Leghe')}
                activeOpacity={0.85}
              >
                <Text style={styles.emptyButtonText}>Scopri leghe</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={showFilters}
        transparent
        animationType="fade"
        onRequestClose={closeFilters}
        statusBarTranslucent
      >
        <TouchableWithoutFeedback onPress={closeFilters} accessible={false}>
          <View style={styles.filterMenuRoot}>
            {filterMenuLayout ? (
              <TouchableWithoutFeedback accessible={false}>
                <View
                  style={[
                    styles.filterDropdown,
                    {
                      top: filterMenuLayout.top,
                      left: filterMenuLayout.left,
                      width: filterMenuLayout.width,
                    },
                  ]}
                >
                  <View style={styles.filterDropdownHeader}>
                    <Text style={styles.filterDropdownTitle}>Filtri</Text>
                    <TouchableOpacity
                      style={[
                        styles.filterPresetChip,
                        !hasActiveFilters && styles.filterPresetChipActive,
                      ]}
                      onPress={clearFilters}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={[
                          styles.filterPresetChipText,
                          !hasActiveFilters && styles.filterPresetChipTextActive,
                        ]}
                      >
                        Azzera
                      </Text>
                      {!hasActiveFilters ? (
                        <Ionicons name="checkmark" size={12} color="#4f46e5" />
                      ) : null}
                    </TouchableOpacity>
                  </View>
                  {FILTERS.map((filter, idx) => {
                    const on = filterKey === filter.key;
                    return (
                      <TouchableOpacity
                        key={filter.key}
                        style={[
                          styles.filterDropdownItem,
                          on && styles.filterDropdownItemOn,
                          idx === FILTERS.length - 1 && styles.filterDropdownItemLast,
                        ]}
                        onPress={() => selectFilter(filter.key)}
                        activeOpacity={0.8}
                      >
                        <View style={styles.filterDropdownItemLeft}>
                          <Ionicons
                            name={filter.icon}
                            size={15}
                            color={on ? '#4f46e5' : '#94a3b8'}
                          />
                          <Text
                            style={[
                              styles.filterDropdownItemText,
                              on && styles.filterDropdownItemTextOn,
                            ]}
                          >
                            {filter.label}
                          </Text>
                        </View>
                        <View style={[styles.filterCheck, on && styles.filterCheckOn]}>
                          {on ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </TouchableWithoutFeedback>
            ) : null}
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {toastMsg ? (
        <View
          style={[
            styles.toast,
            toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError,
          ]}
        >
          <Ionicons
            name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'}
            size={18}
            color="#fff"
          />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.4,
    marginBottom: 14,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#dbe3ef',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 11,
    color: '#0f172a',
  },
  clearButton: {
    padding: 2,
  },
  filterBtn: {
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
  filterBtnActive: {
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
  },
  filterCountBadge: {
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
  filterCountBadgeActive: {
    backgroundColor: '#667eea',
  },
  filterCountBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  filterCountBadgeTextActive: {
    color: '#fff',
  },
  filterMenuRoot: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  filterDropdown: {
    position: 'absolute',
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
  filterDropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8edf5',
    backgroundColor: '#f8fafc',
  },
  filterDropdownTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  filterPresetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  filterPresetChipActive: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  filterPresetChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  filterPresetChipTextActive: {
    color: '#4f46e5',
  },
  filterDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eef2f7',
  },
  filterDropdownItemOn: {
    backgroundColor: '#f5f7ff',
  },
  filterDropdownItemLast: {
    borderBottomWidth: 0,
  },
  filterDropdownItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  filterDropdownItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  filterDropdownItemTextOn: {
    color: '#4f46e5',
  },
  filterCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  filterCheckOn: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 18,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 2,
    gap: 6,
  },
  chevron: {
    marginLeft: 'auto',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  sectionCountPill: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCountPillFav: {
    backgroundColor: '#fff8e6',
  },
  sectionCountPillWarn: {
    backgroundColor: '#fff3cd',
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#667eea',
  },
  sectionCountFav: {
    color: '#f0a500',
  },
  sectionCountWarn: {
    color: '#856404',
  },
  leagueCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  leagueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  trophyIconWrap: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officialMark: {
    position: 'absolute',
    right: -5,
    bottom: -3,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leagueName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginLeft: 8,
    flex: 1,
  },
  leagueActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  actionButton: {
    padding: 6,
  },
  leagueInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  leagueBadgeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  leagueBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  adminBadge: {
    backgroundColor: '#667eea',
  },
  adminBadgeText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  pendingBadge: {
    backgroundColor: '#fff3cd',
  },
  pendingBadgeText: {
    fontSize: 12,
    color: '#856404',
    fontWeight: '600',
  },
  pendingCard: {
    borderColor: '#ffe08a',
  },
  pendingLeagueName: {
    color: '#555',
  },
  leagueFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  matchdayLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  verticalDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#ddd',
  },
  formationContainer: {
    alignItems: 'center',
  },
  leagueMatchday: {
    fontSize: 14,
    color: '#999',
    fontWeight: '500',
  },
  formationLabel: {
    fontSize: 11,
    color: '#999',
    fontWeight: '400',
  },
  formationValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  marketContainer: {
    alignItems: 'center',
  },
  marketLabel: {
    fontSize: 11,
    color: '#999',
    fontWeight: '400',
  },
  marketValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  metaYes: {
    color: '#198754',
  },
  metaNo: {
    color: '#dc3545',
  },
  usersContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  usersValue: {
    fontSize: 14,
    color: '#999',
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 56,
    paddingHorizontal: 24,
  },
  emptyIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 17,
    color: '#64748b',
    fontWeight: '700',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 6,
    marginBottom: 18,
    textAlign: 'center',
  },
  emptyButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
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
  toastError: {
    backgroundColor: '#e53935',
  },
  toastSuccess: {
    backgroundColor: '#2e7d32',
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
});

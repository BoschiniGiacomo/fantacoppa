import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TouchableWithoutFeedback,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { leagueService } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  isJoinPendingResponse,
  leagueHasAccessCode,
  leagueRequiresApproval,
} from '../utils/leagueJoin';

const FILTERS = [
  { key: 'all', label: 'Tutte', icon: 'apps-outline' },
  { key: 'official', label: 'Ufficiali', icon: 'ribbon-outline' },
  { key: 'public', label: 'Pubbliche', icon: 'globe-outline' },
  { key: 'private', label: 'Private', icon: 'lock-closed-outline' },
  { key: 'approval', label: 'Approvazione', icon: 'hourglass-outline' },
];

function leagueMatchesFilter(league, filterKey) {
  if (filterKey === 'all') return true;
  const isPrivate = leagueHasAccessCode(league);
  const needsApproval = leagueRequiresApproval(league);
  const isOfficial = Number(league?.is_official) === 1 || league?.is_official === true;
  if (filterKey === 'official') return isOfficial;
  if (filterKey === 'public') return !isPrivate;
  if (filterKey === 'private') return isPrivate;
  if (filterKey === 'approval') return needsApproval;
  return true;
}

export default function LeaguesScreen({ navigation }) {
  const { width: windowWidth } = useWindowDimensions();
  const [allLeagues, setAllLeagues] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterKey, setFilterKey] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [filterMenuLayout, setFilterMenuLayout] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [accessCode, setAccessCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [badgeLegendOpen, setBadgeLegendOpen] = useState(false);
  const legendHideTimerRef = useRef(null);
  const filterBtnRef = useRef(null);

  const hasActiveFilters = filterKey !== 'all';

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  const clearLegendHideTimer = useCallback(() => {
    if (legendHideTimerRef.current) {
      clearTimeout(legendHideTimerRef.current);
      legendHideTimerRef.current = null;
    }
  }, []);

  const toggleBadgeLegend = useCallback(() => {
    clearLegendHideTimer();
    setBadgeLegendOpen((open) => !open);
  }, [clearLegendHideTimer]);

  const revealBadgeLegendBriefly = useCallback(() => {
    clearLegendHideTimer();
    setBadgeLegendOpen(true);
    legendHideTimerRef.current = setTimeout(() => {
      setBadgeLegendOpen(false);
      legendHideTimerRef.current = null;
    }, 3200);
  }, [clearLegendHideTimer]);

  useEffect(() => () => clearLegendHideTimer(), [clearLegendHideTimer]);

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

  const selectFilter = useCallback((key) => {
    setFilterKey(key);
    setShowFilters(false);
  }, []);

  const clearFilters = useCallback(() => {
    setFilterKey('all');
  }, []);

  const loadLeagues = useCallback(async () => {
    try {
      const response = await leagueService.getAllLeagues();
      const raw = response?.data;
      setAllLeagues(Array.isArray(raw) ? raw : []);
    } catch (error) {
      showToast('Impossibile caricare le leghe');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLeagues();
    }, [loadLeagues])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadLeagues();
  };

  const discoverableLeagues = useMemo(
    () => (Array.isArray(allLeagues) ? allLeagues : []).filter(
      (league) => Number(league?.is_joined || 0) !== 1
    ),
    [allLeagues],
  );

  const filteredLeagues = useMemo(() => {
    let list = discoverableLeagues.filter((league) => leagueMatchesFilter(league, filterKey));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (league) => league?.name && String(league.name).toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => Number(b?.is_official || 0) - Number(a?.is_official || 0));
    return list;
  }, [discoverableLeagues, searchQuery, filterKey]);

  const handleLeaguePress = (league) => {
    setSelectedLeague(league);
    setAccessCode('');
    setJoinModalVisible(true);
  };

  const handleJoin = async () => {
    if (!selectedLeague) return;

    if (leagueHasAccessCode(selectedLeague) && !String(accessCode || '').trim()) {
      showToast('Inserisci il codice di accesso per unirti a questa lega');
      return;
    }

    setJoining(true);
    try {
      const leagueId = selectedLeague.id;
      const response = await leagueService.join(
        leagueId,
        leagueHasAccessCode(selectedLeague) ? accessCode.trim() : undefined
      );

      if (isJoinPendingResponse(response, selectedLeague)) {
        setJoinModalVisible(false);
        setSelectedLeague(null);
        setAccessCode('');
        showToast('Richiesta inviata: in attesa di approvazione', 'success');
        await loadLeagues();
        return;
      }

      const joinedLeagueId = response?.data?.leagueId || leagueId;
      setJoinModalVisible(false);
      setSelectedLeague(null);
      setAccessCode('');
      await loadLeagues();
      navigation.navigate('League', { leagueId: joinedLeagueId });
    } catch (error) {
      const status = error.response?.status;
      let errorMessage = 'Errore durante l\'unione alla lega';

      if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (status === 400 && leagueHasAccessCode(selectedLeague)) {
        errorMessage = 'Codice di accesso errato';
      } else if (error.message && !error.message.includes('AxiosError')) {
        errorMessage = error.message;
      }

      showToast(errorMessage);
    } finally {
      setJoining(false);
    }
  };

  const renderLeagueItem = useCallback(({ item }) => {
    const isPrivate = leagueHasAccessCode(item);
    const needsApproval = leagueRequiresApproval(item);
    const isOfficial = Number(item?.is_official) === 1 || item?.is_official === true;
    const autoLineup = item.auto_lineup_mode === 1 || item.auto_lineup_mode === true;
    const marketLocked = Number(item.market_locked) === 1;
    const matchdayLabel = item.current_matchday
      ? `${item.current_matchday}ª giornata`
      : 'Non iniziata';

    return (
      <TouchableOpacity
        style={[styles.leagueCard, isOfficial && styles.leagueCardOfficial]}
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
          <Text style={styles.leagueName} numberOfLines={1}>{item.name}</Text>
          <View style={styles.usersContainer}>
            <Ionicons name="people-outline" size={16} color="#999" />
            <Text style={styles.usersValue}>{item.user_count || 0}</Text>
          </View>
        </View>

        <View style={styles.leagueInfo}>
          <View style={styles.leagueBadgeContainer}>
            <TouchableOpacity
              style={[styles.leagueBadgeIcon, isPrivate ? styles.privateBadge : styles.publicBadge]}
              onPress={revealBadgeLegendBriefly}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={isPrivate ? 'Lega privata' : 'Lega pubblica'}
              accessibilityHint="Mostra legenda dei simboli"
            >
              <Ionicons
                name={isPrivate ? 'lock-closed' : 'globe-outline'}
                size={14}
                color={isPrivate ? '#fff' : '#15803d'}
              />
            </TouchableOpacity>
            {needsApproval ? (
              <TouchableOpacity
                style={[styles.leagueBadgeIcon, styles.approvalBadge]}
                onPress={revealBadgeLegendBriefly}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Richiede approvazione"
                accessibilityHint="Mostra legenda dei simboli"
              >
                <Ionicons name="hourglass-outline" size={14} color="#a16207" />
              </TouchableOpacity>
            ) : null}
            {isOfficial ? (
              <View style={styles.officialPill}>
                <Text style={styles.officialPillText}>Ufficiale</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.joinContainer}>
            <Ionicons name="add-circle" size={20} color="#667eea" />
            <Text style={styles.joinText}>
              {needsApproval ? 'Richiedi' : 'Unisciti'}
            </Text>
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
  }, [revealBadgeLegendBriefly]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Scopri leghe</Text>
          <TouchableOpacity
            style={[styles.legendToggle, badgeLegendOpen && styles.legendToggleActive]}
            onPress={toggleBadgeLegend}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={badgeLegendOpen ? 'Nascondi legenda simboli' : 'Mostra legenda simboli'}
          >
            <Ionicons
              name={badgeLegendOpen ? 'close' : 'information-circle-outline'}
              size={20}
              color={badgeLegendOpen ? '#667eea' : '#94a3b8'}
            />
          </TouchableOpacity>
        </View>

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
                {filteredLeagues.length}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {badgeLegendOpen ? (
          <View style={styles.badgeLegend}>
            <View style={styles.badgeLegendItem}>
              <View style={[styles.leagueBadgeIcon, styles.publicBadge, styles.badgeLegendIcon]}>
                <Ionicons name="globe-outline" size={13} color="#15803d" />
              </View>
              <Text style={styles.badgeLegendText}>Pubblica</Text>
            </View>
            <View style={styles.badgeLegendItem}>
              <View style={[styles.leagueBadgeIcon, styles.privateBadge, styles.badgeLegendIcon]}>
                <Ionicons name="lock-closed" size={13} color="#fff" />
              </View>
              <Text style={styles.badgeLegendText}>Privata</Text>
            </View>
            <View style={styles.badgeLegendItem}>
              <View style={[styles.leagueBadgeIcon, styles.approvalBadge, styles.badgeLegendIcon]}>
                <Ionicons name="hourglass-outline" size={13} color="#a16207" />
              </View>
              <Text style={styles.badgeLegendText}>Approvazione</Text>
            </View>
          </View>
        ) : null}
      </View>

      <FlatList
        data={filteredLeagues}
        renderItem={renderLeagueItem}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#667eea" />
        }
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="trophy-outline" size={36} color="#94a3b8" />
            </View>
            <Text style={styles.emptyText}>
              {searchQuery.trim() || filterKey !== 'all'
                ? 'Nessuna lega trovata'
                : 'Nessuna lega disponibile'}
            </Text>
            <Text style={styles.emptySubtext}>
              {searchQuery.trim()
                ? 'Prova un altro nome o togli i filtri'
                : filterKey !== 'all'
                  ? 'Prova un altro filtro'
                  : 'Crea una nuova lega per iniziare'}
            </Text>
            {filterKey !== 'all' || searchQuery.trim() ? (
              <TouchableOpacity
                style={styles.emptyResetBtn}
                onPress={() => {
                  clearFilters();
                  setSearchQuery('');
                }}
              >
                <Text style={styles.emptyResetText}>Azzera filtri</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CreateLeague')}
        activeOpacity={0.9}
        accessibilityLabel="Crea una nuova lega"
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

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

      <Modal
        visible={joinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setJoinModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="enter-outline" size={28} color="#667eea" />
            </View>

            <Text style={styles.modalTitle}>
              {leagueRequiresApproval(selectedLeague) ? 'Richiedi accesso' : 'Unisciti alla lega'}
            </Text>
            <Text style={styles.modalLeagueName}>{selectedLeague?.name}</Text>

            {leagueHasAccessCode(selectedLeague) ? (
              <View style={styles.inputGroup}>
                <View style={styles.inputWrapper}>
                  <Ionicons name="lock-closed-outline" size={18} color="#94a3b8" style={{ marginRight: 10 }} />
                  <TextInput
                    style={styles.inputInline}
                    placeholder="Codice di accesso"
                    placeholderTextColor="#94a3b8"
                    value={accessCode}
                    onChangeText={setAccessCode}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>
            ) : null}

            {leagueRequiresApproval(selectedLeague) ? (
              <View style={[styles.infoBox, styles.infoBoxWarn]}>
                <Ionicons name="hourglass-outline" size={16} color="#a16207" />
                <Text style={[styles.infoBoxText, styles.infoBoxTextWarn]}>
                  Serve approvazione di un admin: resti in attesa.
                </Text>
              </View>
            ) : !leagueHasAccessCode(selectedLeague) ? (
              <View style={styles.infoBox}>
                <Ionicons name="globe-outline" size={16} color="#667eea" />
                <Text style={styles.infoBoxText}>Lega pubblica, accesso libero</Text>
              </View>
            ) : null}

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setJoinModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.joinBtn, joining && styles.buttonDisabled]}
                onPress={handleJoin}
                disabled={joining}
              >
                {joining ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : leagueRequiresApproval(selectedLeague) ? (
                  <Text style={styles.joinBtnText}>Invia</Text>
                ) : (
                  <>
                    <Ionicons name="enter-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={styles.joinBtnText}>Unisciti</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
        {toastMsg ? (
          <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
            <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
            <Text style={styles.toastText}>{toastMsg.text}</Text>
          </View>
        ) : null}
      </Modal>

      {!joinModalVisible && toastMsg ? (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 10,
  },
  title: {
    flex: 1,
    fontSize: 26,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.4,
  },
  legendToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  legendToggleActive: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
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
  badgeLegend: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#eef2f7',
  },
  badgeLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeLegendIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  badgeLegendText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 96,
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
  leagueCardOfficial: {
    borderColor: '#c7d2fe',
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
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginLeft: 8,
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
  leagueBadgeIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateBadge: {
    backgroundColor: '#667eea',
  },
  approvalBadge: {
    backgroundColor: '#fef3c7',
  },
  publicBadge: {
    backgroundColor: '#dcfce7',
  },
  officialPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
  },
  officialPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#667eea',
  },
  joinContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  joinText: {
    fontSize: 16,
    color: '#667eea',
    fontWeight: '600',
    marginLeft: 6,
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
  leagueMatchday: {
    fontSize: 14,
    color: '#999',
    fontWeight: '500',
  },
  verticalDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#ddd',
  },
  formationContainer: {
    alignItems: 'center',
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
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#4338ca',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '88%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  modalIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  modalLeagueName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#667eea',
    marginBottom: 18,
    textAlign: 'center',
  },
  inputGroup: {
    width: '100%',
    marginBottom: 16,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  inputInline: {
    flex: 1,
    fontSize: 16,
    color: '#0f172a',
    paddingVertical: 12,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 18,
    width: '100%',
  },
  infoBoxWarn: {
    backgroundColor: '#fffbeb',
  },
  infoBoxText: {
    flex: 1,
    fontSize: 13,
    color: '#667eea',
    fontWeight: '500',
    lineHeight: 18,
  },
  infoBoxTextWarn: {
    color: '#a16207',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
  },
  cancelBtnText: {
    color: '#475569',
    fontSize: 15,
    fontWeight: '700',
  },
  joinBtn: {
    flex: 1,
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#667eea',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  joinBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 56,
    paddingHorizontal: 24,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emptyText: {
    fontSize: 17,
    color: '#334155',
    marginTop: 16,
    fontWeight: '700',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 6,
    textAlign: 'center',
  },
  emptyResetBtn: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
  },
  emptyResetText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#667eea',
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    elevation: 6,
  },
  toastSuccess: {
    backgroundColor: '#15803d',
  },
  toastError: {
    backgroundColor: '#b91c1c',
  },
  toastText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

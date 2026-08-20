import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Pressable,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Rect, Circle, Line } from 'react-native-svg';
import { matchesService, playerStatsService } from '../services/api';
import { PlayerPhotoImage, TeamLogoImage } from '../components/StableCachedImage';

const SEARCH_DEBOUNCE_MS = 300;
const PHOTO_SIZE = 72;
const ROLE_COLORS = {
  P: '#0d6efd',
  D: '#198754',
  C: '#e6a817',
  A: '#dc3545',
};

const ROLE_PITCH_POS = {
  P: { x: 0.5, y: 0.86 },
  D: { x: 0.5, y: 0.64 },
  C: { x: 0.5, y: 0.42 },
  A: { x: 0.5, y: 0.18 },
};

const COMPARE_ROWS = [
  { key: 'editions_played', label: 'Edizioni', higherIsBetter: true, decimals: 0 },
  { key: 'appearances', label: 'Presenze', higherIsBetter: true, decimals: 0 },
  { key: 'wins', label: 'Vittorie', higherIsBetter: true, decimals: 0 },
  { key: 'trophies', label: 'Trofei', higherIsBetter: true, decimals: 0 },
  { key: 'goals', label: 'Gol', higherIsBetter: true, decimals: 0 },
  { key: 'assists', label: 'Assist', higherIsBetter: true, decimals: 0 },
  { key: 'yellow_cards', label: 'Gialli', higherIsBetter: false, decimals: 0 },
  { key: 'red_cards', label: 'Rossi', higherIsBetter: false, decimals: 0 },
  { key: 'penalty_goals', label: 'Rigori segnati', higherIsBetter: true, decimals: 0 },
  { key: 'penalty_missed', label: 'Rigori sbagliati', higherIsBetter: false, decimals: 0 },
  {
    key: 'penalty_saved',
    label: 'Rigori parati',
    higherIsBetter: true,
    decimals: 0,
    showIfAnyPositive: true,
  },
  {
    key: 'clean_sheets',
    label: 'Clean sheet',
    higherIsBetter: true,
    decimals: 0,
    showIfAnyPositive: true,
  },
  { key: 'mvp', label: 'MVP', higherIsBetter: true, decimals: 0 },
  { key: 'avg_rating', label: 'Voto medio', higherIsBetter: true, decimals: 2 },
];

function stripBirthYearNameSuffix(name) {
  return String(name || '').replace(/\s*\('\d{2}\)\s*$/u, '').trim();
}

function playerInitials(name) {
  const parts = stripBirthYearNameSuffix(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

function resolveDisplayName(profile, fallbackName) {
  const first = String(profile?.player?.first_name || '').trim();
  const last = String(profile?.player?.last_name || '').trim();
  if (first || last) return { firstName: first, lastName: last };

  const full = stripBirthYearNameSuffix(fallbackName || profile?.player?.name || '');
  if (!full) return { firstName: '', lastName: 'Giocatore' };
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function formatStatValue(value, decimals = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return decimals > 0 ? (0).toFixed(decimals) : '0';
  if (decimals > 0) return n.toFixed(decimals);
  return String(Math.trunc(n));
}

function compareTone(left, right, higherIsBetter) {
  const a = Number(left);
  const b = Number(right);
  const leftN = Number.isFinite(a) ? a : 0;
  const rightN = Number.isFinite(b) ? b : 0;
  if (leftN === rightN) return { left: 'tie', right: 'tie' };
  const leftWins = higherIsBetter ? leftN > rightN : leftN < rightN;
  return leftWins
    ? { left: 'better', right: 'worse' }
    : { left: 'worse', right: 'better' };
}

function toneColor(tone) {
  if (tone === 'better') return '#198754';
  if (tone === 'worse') return '#dc3545';
  return '#64748b';
}

function toneBg(tone) {
  if (tone === 'better') return '#e8f6ee';
  if (tone === 'worse') return '#fdecee';
  return '#f1f5f9';
}

function CompareAvatar({ photoPath, name, size = PHOTO_SIZE }) {
  const radius = Math.round(size * 0.22);
  const fallbackStyle = {
    width: size,
    height: size,
    borderRadius: radius,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  };

  if (photoPath) {
    return (
      <PlayerPhotoImage
        photoPath={photoPath}
        style={{ width: size, height: size, borderRadius: radius }}
        resizeMode="cover"
        fallbackStyle={fallbackStyle}
        fallbackIcon="person-outline"
        fallbackIconSize={Math.round(size * 0.38)}
        fallbackColor="#667eea"
      />
    );
  }

  return (
    <View style={fallbackStyle}>
      <Text style={{ fontSize: Math.round(size * 0.28), fontWeight: '800', color: '#667eea' }}>
        {playerInitials(name)}
      </Text>
    </View>
  );
}

function CareerLogos({ teams, max = 5 }) {
  const list = Array.isArray(teams) ? teams.filter((t) => String(t?.name || '').trim()) : [];
  if (!list.length) {
    return <Text style={styles.metaMuted}>—</Text>;
  }
  const shown = list.slice(0, max);
  return (
    <View style={styles.careerLogos}>
      {shown.map((team, index) => (
        <View
          key={`${team.team_id || team.name}-${index}`}
          style={[
            styles.careerLogoWrap,
            index > 0 ? styles.careerLogoOverlap : null,
            { zIndex: shown.length - index },
          ]}
        >
          <TeamLogoImage
            logoPath={team.logo_path}
            style={styles.careerLogo}
            fallbackStyle={styles.careerLogoFallback}
            fallbackIconSize={10}
          />
        </View>
      ))}
      {list.length > max ? (
        <Text style={styles.careerLogoMore}>+{list.length - max}</Text>
      ) : null}
    </View>
  );
}

function RolesPitch({ roles }) {
  const list = Array.isArray(roles) ? roles : [];
  const width = 78;
  const height = 104;

  return (
    <View style={styles.pitchWrap}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Rect x={1} y={1} width={width - 2} height={height - 2} rx={8} fill="#1e3a5f" />
        <Rect x={1} y={1} width={width - 2} height={height - 2} rx={8} stroke="#94a3b8" strokeWidth={1.2} fill="none" />
        <Line x1={4} y1={height / 2} x2={width - 4} y2={height / 2} stroke="#64748b" strokeWidth={1} strokeDasharray="3 3" />
        <Rect x={(width - 36) / 2} y={1} width={36} height={14} stroke="#64748b" strokeWidth={1} fill="none" />
        <Rect x={(width - 36) / 2} y={height - 15} width={36} height={14} stroke="#64748b" strokeWidth={1} fill="none" />
        {list.map((role) => {
          const pos = ROLE_PITCH_POS[role] || ROLE_PITCH_POS.C;
          return (
            <Circle
              key={role}
              cx={pos.x * width}
              cy={pos.y * height}
              r={7}
              fill={ROLE_COLORS[role] || '#fff'}
              stroke="#fff"
              strokeWidth={1.5}
            />
          );
        })}
      </Svg>
      {!list.length ? <Text style={styles.pitchEmpty}>—</Text> : null}
    </View>
  );
}

function SearchSlot({
  label,
  value,
  onChangeText,
  onFocus,
  onClear,
  selected,
  active,
  inputRef,
}) {
  const displayName = selected
    ? stripBirthYearNameSuffix(selected.name || selected.profile?.player?.name || '')
    : '';
  const showSelectedChip = Boolean(selected && !active);

  return (
    <View style={styles.searchSlot}>
      <Text style={styles.searchSlotLabel}>{label}</Text>
      {showSelectedChip ? (
        <TouchableOpacity
          style={[styles.searchInputWrap, styles.searchInputWrapFilled]}
          onPress={onFocus}
          activeOpacity={0.8}
        >
          <Ionicons name="person" size={14} color="#667eea" />
          <Text style={styles.searchSelectedText} numberOfLines={1}>{displayName}</Text>
          <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={16} color="#94a3b8" />
          </TouchableOpacity>
        </TouchableOpacity>
      ) : (
        <View style={[styles.searchInputWrap, active ? styles.searchInputWrapActive : null]}>
          <Ionicons name="search" size={14} color="#94a3b8" />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={value}
            onChangeText={onChangeText}
            onFocus={onFocus}
            placeholder="Cerca giocatore…"
            placeholderTextColor="#94a3b8"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {value ? (
            <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color="#94a3b8" />
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </View>
  );
}

function SearchResultsPanel({
  loading,
  players,
  onSelect,
  excludeKey,
}) {
  const filtered = (players || []).filter((p) => {
    const key = `${Number(p.player_id)}-${Number(p.league_id)}`;
    return key !== excludeKey;
  });

  return (
    <View style={styles.searchResultsPanel}>
      {loading ? (
        <View style={styles.searchResultsLoading}>
          <ActivityIndicator size="small" color="#667eea" />
        </View>
      ) : filtered.length === 0 ? (
        <Text style={styles.searchResultsEmpty}>Nessun risultato</Text>
      ) : (
        <ScrollView
          style={styles.searchResultsScroll}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {filtered.map((player) => (
            <TouchableOpacity
              key={`player-${player.player_id}-${player.league_id}`}
              style={styles.searchResultRow}
              activeOpacity={0.75}
              onPress={() => onSelect(player)}
            >
              <PlayerPhotoImage
                photoPath={player.photo_path || undefined}
                style={styles.searchPlayerPhoto}
                fallbackStyle={styles.searchPlayerPhotoFallback}
                fallbackIconSize={16}
              />
              <View style={styles.searchResultMeta}>
                <Text style={styles.searchResultTitle} numberOfLines={1}>
                  {player.name}
                </Text>
                <Text style={styles.searchResultSubtitle} numberOfLines={1}>
                  {[player.team_name, player.competition_name].filter(Boolean).join(' · ') || 'Giocatore ufficiale'}
                </Text>
              </View>
              <CareerLogos teams={player.career_teams} max={4} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function PlayerHeaderCard({ profile, fallbackName, fallbackPhoto, side }) {
  const name = resolveDisplayName(profile, fallbackName);
  const fullName = `${name.firstName} ${name.lastName}`.trim();
  const photo = profile?.player?.photo_path || fallbackPhoto;
  const year = profile?.player?.birth_year;
  const align = side === 'left' ? 'flex-start' : 'flex-end';
  const textAlign = side === 'left' ? 'left' : 'right';

  return (
    <View style={[styles.headerCard, { alignItems: align }]}>
      <CompareAvatar photoPath={photo} name={fullName} />
      <View style={[styles.headerNames, { alignItems: align }]}>
        {name.firstName ? (
          <Text style={[styles.headerFirst, { textAlign }]} numberOfLines={1}>
            {name.firstName}
          </Text>
        ) : null}
        <Text style={[styles.headerLast, { textAlign }]} numberOfLines={2}>
          {name.lastName || 'Giocatore'}
        </Text>
      </View>
      <CareerLogos teams={profile?.career_teams} />
      <RolesPitch roles={profile?.roles_played} />
      <Text style={styles.headerYear}>{year ? String(year) : '—'}</Text>
    </View>
  );
}

function StatCompareRow({ row, leftValue, rightValue, zebra }) {
  const tones = compareTone(leftValue, rightValue, row.higherIsBetter);
  return (
    <View style={[styles.statRow, zebra ? styles.statRowZebra : null]}>
      <View style={[styles.statValueCell, { backgroundColor: toneBg(tones.left) }]}>
        <Text style={[styles.statValue, { color: toneColor(tones.left) }]}>
          {formatStatValue(leftValue, row.decimals)}
        </Text>
      </View>
      <View style={styles.statLabelCell}>
        <Text style={styles.statLabel}>{row.label}</Text>
      </View>
      <View style={[styles.statValueCell, { backgroundColor: toneBg(tones.right) }]}>
        <Text style={[styles.statValue, { color: toneColor(tones.right) }]}>
          {formatStatValue(rightValue, row.decimals)}
        </Text>
      </View>
    </View>
  );
}

function emptySelectionFromRoute(params, side) {
  if (side !== 'a') return null;
  const playerId = Number(params?.playerAId || params?.playerId);
  const leagueId = Number(params?.leagueAId || params?.leagueId);
  if (!playerId || !leagueId) return null;
  return {
    player_id: playerId,
    league_id: leagueId,
    name: String(params?.playerAName || params?.playerName || '').trim(),
    photo_path: params?.playerAPhotoPath || params?.playerPhotoPath || null,
    role: params?.playerARole || params?.playerRole || null,
    profile: null,
    loading: true,
    error: null,
  };
}

export default function PlayerCompareScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const [slotA, setSlotA] = useState(() => emptySelectionFromRoute(route?.params, 'a'));
  const [slotB, setSlotB] = useState(null);

  const [activeSlot, setActiveSlot] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchPlayers, setSearchPlayers] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const searchSeqRef = useRef(0);
  const inputARef = useRef(null);
  const inputBRef = useRef(null);
  const cacheRef = useRef(new Map());
  const [headerHeight, setHeaderHeight] = useState(0);

  const loadProfile = useCallback(async (playerId, leagueId) => {
    const key = `${playerId}-${leagueId}`;
    if (cacheRef.current.has(key)) return cacheRef.current.get(key);

    const res = await playerStatsService.getPlayerCompare(playerId, leagueId);
    const profile = res?.data || null;
    if (profile) cacheRef.current.set(key, profile);
    return profile;
  }, []);

  const hydrateSlot = useCallback(async (side, selection) => {
    const playerId = Number(selection?.player_id);
    const leagueId = Number(selection?.league_id);
    if (!playerId || !leagueId) return;

    const setter = side === 'a' ? setSlotA : setSlotB;
    setter((prev) => ({
      ...(prev || selection),
      ...selection,
      loading: true,
      error: null,
    }));

    try {
      const profile = await loadProfile(playerId, leagueId);
      setter((prev) => {
        if (!prev || Number(prev.player_id) !== playerId || Number(prev.league_id) !== leagueId) {
          return prev;
        }
        return {
          ...prev,
          profile,
          name: profile?.player?.name || prev.name,
          photo_path: profile?.player?.photo_path || prev.photo_path,
          loading: false,
          error: null,
        };
      });
    } catch (_) {
      setter((prev) => {
        if (!prev || Number(prev.player_id) !== playerId || Number(prev.league_id) !== leagueId) {
          return prev;
        }
        return {
          ...prev,
          loading: false,
          error: 'Impossibile caricare il profilo',
        };
      });
    }
  }, [loadProfile]);

  useEffect(() => {
    if (slotA?.player_id && slotA?.league_id && !slotA.profile && slotA.loading) {
      void hydrateSlot('a', slotA);
    }
    // Se arriviamo da PlayerStats con A già scelto, apri subito la ricerca per B
    if (slotA?.player_id && !slotB) {
      const timer = setTimeout(() => {
        setActiveSlot('b');
        inputBRef.current?.focus();
      }, 350);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const trimmed = String(searchText || '').trim();
    const timer = setTimeout(() => setSearchQuery(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (!activeSlot) return undefined;

    const q = String(searchQuery || '').trim();
    if (q.length < 2) {
      setSearchPlayers([]);
      setSearchLoading(false);
      return undefined;
    }

    searchSeqRef.current += 1;
    const seq = searchSeqRef.current;
    let cancelled = false;

    const run = async () => {
      try {
        setSearchLoading(true);
        const res = await matchesService.searchOfficial(q);
        if (cancelled || seq !== searchSeqRef.current) return;
        setSearchPlayers(Array.isArray(res?.data?.players) ? res.data.players : []);
      } catch (_) {
        if (cancelled || seq !== searchSeqRef.current) return;
        setSearchPlayers([]);
      } finally {
        if (!cancelled && seq === searchSeqRef.current) {
          setSearchLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [activeSlot, searchQuery]);

  const closeSearch = useCallback(() => {
    setActiveSlot(null);
    setSearchText('');
    setSearchQuery('');
    setSearchPlayers([]);
    setSearchLoading(false);
    Keyboard.dismiss();
  }, []);

  const openSearch = useCallback((side) => {
    if (side === 'a') setSlotA(null);
    else setSlotB(null);
    setActiveSlot(side);
    setSearchText('');
    setSearchQuery('');
    setSearchPlayers([]);
    setTimeout(() => {
      (side === 'a' ? inputARef : inputBRef).current?.focus();
    }, 40);
  }, []);

  const clearSlot = useCallback((side) => {
    if (side === 'a') setSlotA(null);
    else setSlotB(null);
    if (activeSlot === side) closeSearch();
  }, [activeSlot, closeSearch]);

  const selectPlayer = useCallback((side, player) => {
    const selection = {
      player_id: Number(player.player_id),
      league_id: Number(player.league_id),
      name: String(player.name || '').trim(),
      photo_path: player.photo_path || null,
      role: player.role || null,
      profile: null,
      loading: true,
      error: null,
    };
    closeSearch();
    void hydrateSlot(side, selection);
  }, [closeSearch, hydrateSlot]);

  const excludeKey = useMemo(() => {
    const other = activeSlot === 'a' ? slotB : slotA;
    if (!other?.player_id || !other?.league_id) return null;
    return `${Number(other.player_id)}-${Number(other.league_id)}`;
  }, [activeSlot, slotA, slotB]);

  const bothReady = Boolean(slotA?.profile && slotB?.profile);
  const anyLoading = Boolean(slotA?.loading || slotB?.loading);
  const showSearchResults = Boolean(activeSlot) && (searchLoading || searchQuery.trim().length >= 2);

  const visibleRows = useMemo(() => {
    if (!bothReady) return [];
    const a = slotA.profile.stats || {};
    const b = slotB.profile.stats || {};
    return COMPARE_ROWS.filter((row) => {
      if (!row.showIfAnyPositive) return true;
      return Number(a[row.key] || 0) > 0 || Number(b[row.key] || 0) > 0;
    });
  }, [bothReady, slotA, slotB]);

  return (
    <View style={styles.container}>
      <View
        style={[styles.header, { paddingTop: Math.max(insets.top + 6, 12) }]}
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
      >
        <View style={styles.headerTopRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.75}>
            <Ionicons name="arrow-back" size={20} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Confronto</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.searchRow}>
          <SearchSlot
            label="Giocatore 1"
            value={activeSlot === 'a' ? searchText : ''}
            selected={slotA}
            active={activeSlot === 'a'}
            inputRef={inputARef}
            onFocus={() => openSearch('a')}
            onChangeText={(text) => {
              setActiveSlot('a');
              setSearchText(text);
            }}
            onClear={() => {
              clearSlot('a');
              setSearchText('');
            }}
          />
          <View style={styles.vsBadge}>
            <Text style={styles.vsBadgeText}>VS</Text>
          </View>
          <SearchSlot
            label="Giocatore 2"
            value={activeSlot === 'b' ? searchText : ''}
            selected={slotB}
            active={activeSlot === 'b'}
            inputRef={inputBRef}
            onFocus={() => openSearch('b')}
            onChangeText={(text) => {
              setActiveSlot('b');
              setSearchText(text);
            }}
            onClear={() => {
              clearSlot('b');
              setSearchText('');
            }}
          />
        </View>
      </View>

      {showSearchResults && headerHeight > 0 ? (
        <View style={styles.searchOverlay} pointerEvents="box-none">
          <Pressable style={StyleSheet.absoluteFill} onPress={closeSearch} />
          <View style={[styles.searchResultsAnchor, { top: headerHeight }]}>
            <SearchResultsPanel
              loading={searchLoading}
              players={searchPlayers}
              excludeKey={excludeKey}
              onSelect={(player) => selectPlayer(activeSlot, player)}
            />
          </View>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 36 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
      >
        {!slotA && !slotB ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Text style={styles.emptyIconText}>VS</Text>
            </View>
            <Text style={styles.emptyTitle}>Scegli due giocatori</Text>
            <Text style={styles.emptySubtitle}>
              Cerca e seleziona i profili da confrontare. I dati migliori si colorano di verde, i peggiori di rosso.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.profilesRow}>
              <View style={styles.profileCol}>
                {slotA ? (
                  slotA.loading && !slotA.profile ? (
                    <ActivityIndicator color="#667eea" style={{ marginTop: 24 }} />
                  ) : (
                    <PlayerHeaderCard
                      profile={slotA.profile}
                      fallbackName={slotA.name}
                      fallbackPhoto={slotA.photo_path}
                      side="left"
                    />
                  )
                ) : (
                  <View style={styles.profilePlaceholder}>
                    <Text style={styles.profilePlaceholderText}>Seleziona</Text>
                  </View>
                )}
              </View>

              <View style={styles.profilesDivider}>
                <View style={styles.profilesDividerLine} />
                <View style={styles.profilesDividerBadge}>
                  <Text style={styles.profilesDividerText}>VS</Text>
                </View>
                <View style={styles.profilesDividerLine} />
              </View>

              <View style={styles.profileCol}>
                {slotB ? (
                  slotB.loading && !slotB.profile ? (
                    <ActivityIndicator color="#667eea" style={{ marginTop: 24 }} />
                  ) : (
                    <PlayerHeaderCard
                      profile={slotB.profile}
                      fallbackName={slotB.name}
                      fallbackPhoto={slotB.photo_path}
                      side="right"
                    />
                  )
                ) : (
                  <View style={styles.profilePlaceholder}>
                    <Text style={styles.profilePlaceholderText}>Seleziona</Text>
                  </View>
                )}
              </View>
            </View>

            {slotA?.error || slotB?.error ? (
              <Text style={styles.errorText}>{slotA?.error || slotB?.error}</Text>
            ) : null}

            {bothReady ? (
              <View style={styles.statsCard}>
                {visibleRows.map((row, index) => (
                  <StatCompareRow
                    key={row.key}
                    row={row}
                    leftValue={slotA.profile.stats?.[row.key]}
                    rightValue={slotB.profile.stats?.[row.key]}
                    zebra={index % 2 === 1}
                  />
                ))}
              </View>
            ) : anyLoading ? (
              <View style={styles.loadingBlock}>
                <ActivityIndicator color="#667eea" />
                <Text style={styles.loadingText}>Carico il confronto…</Text>
              </View>
            ) : (
              <Text style={styles.hintText}>
                {!slotA || !slotB
                  ? 'Seleziona il secondo giocatore per vedere il confronto.'
                  : 'Completa la selezione per confrontare.'}
              </Text>
            )}
          </>
        )}
      </ScrollView>
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
    borderBottomWidth: 1,
    borderBottomColor: '#ececec',
    paddingHorizontal: 14,
    paddingBottom: 12,
    zIndex: 20,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#222',
  },
  headerSpacer: {
    width: 34,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  searchSlot: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  searchSlotLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  searchInputWrap: {
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchInputWrapActive: {
    borderColor: '#667eea',
    backgroundColor: '#fff',
  },
  searchInputWrapFilled: {
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
  },
  searchSelectedText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    color: '#3730a3',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: '#1e293b',
    paddingVertical: 0,
  },
  vsBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  vsBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  searchOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    backgroundColor: 'rgba(15, 23, 42, 0.14)',
  },
  searchResultsAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  searchResultsPanel: {
    marginHorizontal: 10,
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ececec',
    maxHeight: 300,
    paddingHorizontal: 6,
    paddingBottom: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 8,
  },
  searchResultsScroll: {
    maxHeight: 280,
  },
  searchResultsLoading: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  searchResultsEmpty: {
    paddingVertical: 16,
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 13,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  searchResultMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  searchResultTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
  },
  searchResultSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
  },
  searchPlayerPhoto: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  searchPlayerPhotoFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 14,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyIconText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 18,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
    textAlign: 'center',
  },
  profilesRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#e8edf5',
  },
  profileCol: {
    flex: 1,
    minWidth: 0,
  },
  profilesDivider: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  profilesDividerLine: {
    width: 1,
    flex: 1,
    backgroundColor: '#e2e8f0',
  },
  profilesDividerBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilesDividerText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#667eea',
  },
  headerCard: {
    gap: 8,
    paddingHorizontal: 4,
  },
  headerNames: {
    width: '100%',
    gap: 1,
  },
  headerFirst: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  headerLast: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1e293b',
    lineHeight: 20,
  },
  headerYear: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  metaMuted: {
    fontSize: 12,
    color: '#cbd5e1',
  },
  careerLogos: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
  },
  careerLogoWrap: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  careerLogoOverlap: {
    marginLeft: -8,
  },
  careerLogo: {
    width: 26,
    height: 26,
  },
  careerLogoFallback: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  careerLogoMore: {
    marginLeft: 4,
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
  },
  pitchWrap: {
    width: 78,
    height: 104,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pitchEmpty: {
    position: 'absolute',
    color: '#94a3b8',
    fontSize: 12,
  },
  profilePlaceholder: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    backgroundColor: '#f8fafc',
    marginHorizontal: 4,
  },
  profilePlaceholderText: {
    color: '#94a3b8',
    fontWeight: '600',
    fontSize: 13,
  },
  statsCard: {
    marginTop: 14,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e8edf5',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 44,
  },
  statRowZebra: {
    backgroundColor: '#fafbfc',
  },
  statValueCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  statLabelCell: {
    width: 108,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    backgroundColor: '#f1f5f9',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#e2e8f0',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  loadingBlock: {
    marginTop: 28,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#64748b',
    fontSize: 13,
  },
  hintText: {
    marginTop: 22,
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 13,
    paddingHorizontal: 20,
  },
  errorText: {
    marginTop: 12,
    textAlign: 'center',
    color: '#dc3545',
    fontSize: 13,
  },
});

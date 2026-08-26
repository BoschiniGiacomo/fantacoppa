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
  Modal,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Rect, Circle, Line, Text as SvgText } from 'react-native-svg';
import { matchesService, playerStatsService } from '../services/api';
import { PlayerPhotoImage, TeamLogoImage } from '../components/StableCachedImage';
import BonusIcon from '../components/BonusIcon';
import CompareVsIcon from '../components/CompareVsIcon';
import {
  MiniChampionshipTrophy,
  MiniWineTrophy,
} from '../components/PlayerHeroTrophyBadges';

const SEARCH_DEBOUNCE_MS = 300;
const PHOTO_WIDTH = 80;
// Grandezza disegno fissa; lo slot più alto dà aria senza scalare/tagliare la foto.
const PHOTO_HEIGHT = 104;
const PHOTO_SLOT_HEIGHT = 120;
const PHOTO_ZOOM = 1.15;
const PHOTO_SIDE_BLEED = 1.55;
const PHOTO_VERT_BLEED = 1.22;
const PROFILES_PAD_TOP = 34;
const FILTER_DROPDOWN_MAX_HEIGHT = 400;
const FILTER_DROPDOWN_WIDTH = 300;

const DEFAULT_TROPHY_KINDS = { championship: true, wine: false };
const DEFAULT_TROPHY_MODE = 'sum'; // 'sum' | 'split'
const DEFAULT_MARKET_VALUE_MODE = 'current'; // 'current' | 'peak'
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
  {
    key: 'market_value',
    label: 'Valore di mercato',
    higherIsBetter: true,
    decimals: 2,
    pack: 'ion',
    icon: 'pricetag-outline',
    accent: '#b8860b',
  },
  { key: 'editions_played', label: 'Edizioni', higherIsBetter: true, decimals: 0, pack: 'ion', icon: 'calendar', accent: '#667eea' },
  { key: 'appearances', label: 'Presenze', higherIsBetter: true, decimals: 0, pack: 'ion', icon: 'people', accent: '#667eea' },
  { key: 'wins', label: 'Partite vinte', higherIsBetter: true, decimals: 0, pack: 'ion', icon: 'checkmark-circle', accent: '#16a34a' },
  { key: 'trophies', label: 'Trofei', higherIsBetter: true, decimals: 0, pack: 'ion', icon: 'trophy', accent: '#d97706' },
  { key: 'goals', label: 'Gol', higherIsBetter: true, decimals: 0, pack: 'mci', icon: 'soccer', accent: '#15803d', bonusType: 'goal' },
  { key: 'assists', label: 'Assist', higherIsBetter: true, decimals: 0, pack: 'mci', icon: 'shoe-cleat', accent: '#1d4ed8', bonusType: 'assist' },
  { key: 'yellow_cards', label: 'Gialli', higherIsBetter: false, decimals: 0, bonusType: 'yellow_card', accent: '#ca8a04' },
  { key: 'red_cards', label: 'Rossi', higherIsBetter: false, decimals: 0, bonusType: 'red_card', accent: '#dc2626' },
  { key: 'penalty_goals', label: 'Rigori segnati', higherIsBetter: true, decimals: 0, bonusType: 'penalty_goal', accent: '#2563eb' },
  { key: 'penalty_missed', label: 'Rigori sbagliati', higherIsBetter: false, decimals: 0, bonusType: 'penalty_missed', accent: '#dc2626' },
  {
    key: 'penalty_saved',
    label: 'Rigori parati',
    higherIsBetter: true,
    decimals: 0,
    showIfAnyPositive: true,
    bonusType: 'penalty_saved',
    accent: '#0f766e',
  },
  {
    key: 'clean_sheets',
    label: 'Clean sheet',
    higherIsBetter: true,
    decimals: 0,
    showIfAnyPositive: true,
    bonusType: 'clean_sheet',
    accent: '#0f766e',
  },
  { key: 'mvp', label: 'MVP', higherIsBetter: true, decimals: 0, bonusType: 'briso', accent: '#f9a825' },
  { key: 'avg_rating', label: 'Voto medio', higherIsBetter: true, decimals: 2, pack: 'ion', icon: 'speedometer-outline', accent: '#667eea' },
];

/** Parametri spenti di default nel filtro confronto. */
const COMPARE_FILTER_DEFAULT_OFF = new Set(['market_value', 'penalty_goals', 'penalty_missed', 'penalty_saved', 'mvp']);

function buildDefaultEnabledKeys() {
  const enabled = {};
  for (const row of COMPARE_ROWS) {
    enabled[row.key] = !COMPARE_FILTER_DEFAULT_OFF.has(row.key);
  }
  return enabled;
}

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

function formatStatValue(value, decimals = 0, options = {}) {
  if (options.emptyDash) return '–';
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

function CompareRowGlyph({ row, size = 15 }) {
  if (row?.trophyGlyph === 'championship' || row?.trophyGlyph === 'wine' || row?.trophyGlyph === 'both') {
    return (
      <View style={styles.trophyGlyphRow}>
        {row.trophyGlyph === 'championship' || row.trophyGlyph === 'both' ? (
          <View style={styles.trophyGlyphScale}>
            <MiniChampionshipTrophy />
          </View>
        ) : null}
        {row.trophyGlyph === 'wine' || row.trophyGlyph === 'both' ? (
          <View style={styles.trophyGlyphScale}>
            <MiniWineTrophy />
          </View>
        ) : null}
      </View>
    );
  }
  if (row?.bonusType) {
    return <BonusIcon type={row.bonusType} size={size} />;
  }
  const color = row?.accent || '#667eea';
  if (row?.pack === 'mci') {
    return <MaterialCommunityIcons name={row.icon} size={size} color={color} />;
  }
  return <Ionicons name={row?.icon || 'ellipse'} size={size} color={color} />;
}

function TrophyModeSwitch({ mode, onChange }) {
  return (
    <View style={styles.trophyModeSwitch}>
      <TouchableOpacity
        style={[styles.trophyModeSide, mode === 'sum' ? styles.trophyModeSideActive : null]}
        onPress={() => onChange('sum')}
        activeOpacity={0.8}
        accessibilityLabel="Somma trofei in una riga"
      >
        <Text style={[styles.trophyModeSigma, mode === 'sum' ? styles.trophyModeSigmaActive : null]}>Σ</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.trophyModeSide, mode === 'split' ? styles.trophyModeSideActive : null]}
        onPress={() => onChange('split')}
        activeOpacity={0.8}
        accessibilityLabel="Separa trofei in due righe"
      >
        <Ionicons
          name="list"
          size={14}
          color={mode === 'split' ? '#4f46e5' : '#94a3b8'}
        />
      </TouchableOpacity>
    </View>
  );
}

function MarketValueModeSwitch({ mode, onChange }) {
  return (
    <View style={styles.marketModeSwitch}>
      <TouchableOpacity
        style={[styles.marketModeSide, mode === 'current' ? styles.marketModeSideActive : null]}
        onPress={() => onChange('current')}
        activeOpacity={0.8}
        accessibilityLabel="Valore di mercato attuale"
      >
        <Ionicons
          name="pricetag-outline"
          size={13}
          color={mode === 'current' ? '#4f46e5' : '#94a3b8'}
        />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.marketModeSide, mode === 'peak' ? styles.marketModeSideActive : null]}
        onPress={() => onChange('peak')}
        activeOpacity={0.8}
        accessibilityLabel="Valore di mercato più alto"
      >
        <Text style={[styles.marketModeText, mode === 'peak' ? styles.marketModeTextActive : null]}>
          Max
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function FilterCheck({ on }) {
  return (
    <View style={[styles.filterInlineCheck, on ? styles.filterInlineCheckOn : null]}>
      {on ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
    </View>
  );
}

function CompareFilterMenu({
  open,
  onClose,
  anchorRef,
  enabledKeys,
  onToggle,
  onSelectAll,
  onResetDefault,
  allSelected,
  defaultsSelected,
  trophyKinds,
  trophyMode,
  onToggleTrophyKind,
  onTrophyModeChange,
  marketValueMode,
  onMarketValueModeChange,
  championshipLabel,
}) {
  const { width: windowWidth } = useWindowDimensions();
  const [layout, setLayout] = useState(null);
  const [scrollMetrics, setScrollMetrics] = useState({ y: 0, contentH: 1, viewH: 1 });
  const [trophyOpen, setTrophyOpen] = useState(true);

  useEffect(() => {
    if (!open) {
      setLayout(null);
      setScrollMetrics({ y: 0, contentH: 1, viewH: 1 });
      return undefined;
    }
    let cancelled = false;
    const measureAnchor = () => {
      const node = anchorRef?.current;
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
          const panelWidth = Math.min(FILTER_DROPDOWN_WIDTH, Math.max(240, windowWidth - 24));
          const left = Math.max(12, Math.min(x + width - panelWidth, windowWidth - panelWidth - 12));
          setLayout({
            left,
            top: y + height + 6,
            width: panelWidth,
          });
        });
      } catch {
        // Native node non ancora pronto (es. Fabric): ritenta al timeout.
      }
    };
    measureAnchor();
    const retryTimer = setTimeout(measureAnchor, 64);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [open, anchorRef, windowWidth]);

  useEffect(() => {
    if (enabledKeys?.trophies) setTrophyOpen(true);
  }, [enabledKeys?.trophies]);

  const scrollTrackH = FILTER_DROPDOWN_MAX_HEIGHT - 48;
  const canScroll = scrollMetrics.contentH > scrollMetrics.viewH + 2;
  const thumbH = canScroll
    ? Math.max(28, (scrollMetrics.viewH / scrollMetrics.contentH) * scrollTrackH)
    : scrollTrackH;
  const maxThumbTravel = Math.max(0, scrollTrackH - thumbH);
  const maxScroll = Math.max(1, scrollMetrics.contentH - scrollMetrics.viewH);
  const thumbTop = canScroll
    ? (scrollMetrics.y / maxScroll) * maxThumbTravel
    : 0;

  const bothTrophyKinds = Boolean(trophyKinds?.championship && trophyKinds?.wine);
  const champLabel = String(championshipLabel || '').trim() || 'Campionato';

  if (!open || !layout) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.filterMenuRoot}>
        <Pressable
          style={styles.filterMenuBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Chiudi filtro parametri"
        />
        <View style={[styles.filterDropdown, { top: layout.top, left: layout.left, width: layout.width }]}>
          <View style={styles.filterDropdownHeader}>
            <Text style={styles.filterDropdownTitle}>Parametri</Text>
            <View style={styles.filterDropdownActions}>
              <TouchableOpacity
                style={[styles.filterPresetChip, allSelected ? styles.filterPresetChipActive : null]}
                onPress={onSelectAll}
                activeOpacity={0.75}
              >
                <Text style={[styles.filterPresetChipText, allSelected ? styles.filterPresetChipTextActive : null]}>
                  Tutti
                </Text>
                {allSelected ? <Ionicons name="checkmark" size={12} color="#4f46e5" /> : null}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterPresetChip, defaultsSelected ? styles.filterPresetChipActive : null]}
                onPress={onResetDefault}
                activeOpacity={0.75}
              >
                <Text style={[styles.filterPresetChipText, defaultsSelected ? styles.filterPresetChipTextActive : null]}>
                  Predefiniti
                </Text>
                {defaultsSelected ? <Ionicons name="checkmark" size={12} color="#4f46e5" /> : null}
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.filterDropdownBody}>
            <ScrollView
              style={styles.filterDropdownScroll}
              contentContainerStyle={styles.filterDropdownScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              bounces={false}
              nestedScrollEnabled
              scrollEventThrottle={16}
              onScroll={(e) => {
                const ne = e?.nativeEvent;
                if (!ne) return;
                const { contentOffset, contentSize, layoutMeasurement } = ne;
                setScrollMetrics({
                  y: contentOffset?.y || 0,
                  contentH: contentSize?.height || 1,
                  viewH: layoutMeasurement?.height || 1,
                });
              }}
              onContentSizeChange={(_, h) => {
                setScrollMetrics((prev) => ({ ...prev, contentH: h || 1 }));
              }}
              onLayout={(e) => {
                const h = e?.nativeEvent?.layout?.height;
                if (typeof h !== 'number') return;
                setScrollMetrics((prev) => ({ ...prev, viewH: h }));
              }}
            >
              {COMPARE_ROWS.map((row, idx) => {
                const on = Boolean(enabledKeys[row.key]);
                const isLast = idx === COMPARE_ROWS.length - 1;
                const isTrophies = row.key === 'trophies';
                const isMarketValue = row.key === 'market_value';

                if (isMarketValue) {
                  return (
                    <View
                      key={row.key}
                      style={[
                        styles.filterDropdownItem,
                        isLast ? styles.filterDropdownItemLast : null,
                        on ? styles.filterDropdownItemOn : null,
                      ]}
                    >
                      <TouchableOpacity
                        style={styles.filterDropdownItemLeft}
                        onPress={() => onToggle(row.key)}
                        activeOpacity={0.8}
                      >
                        <CompareRowGlyph row={row} size={15} />
                        <Text style={[styles.filterDropdownItemText, on ? styles.filterDropdownItemTextOn : null]}>
                          {row.label}
                        </Text>
                      </TouchableOpacity>
                      <View style={styles.filterTrophyItemRight}>
                        {on ? (
                          <MarketValueModeSwitch
                            mode={marketValueMode}
                            onChange={onMarketValueModeChange}
                          />
                        ) : null}
                        <TouchableOpacity
                          onPress={() => onToggle(row.key)}
                          activeOpacity={0.8}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <FilterCheck on={on} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }

                if (isTrophies) {
                  return (
                    <View key={row.key} style={[styles.filterTrophyBlock, isLast ? null : styles.filterTrophyBlockBorder]}>
                      <View style={[styles.filterDropdownItem, on ? styles.filterDropdownItemOn : null, styles.filterDropdownItemNoBorder]}>
                        <TouchableOpacity
                          style={styles.filterDropdownItemLeft}
                          onPress={() => onToggle(row.key)}
                          activeOpacity={0.8}
                        >
                          <CompareRowGlyph row={row} size={15} />
                          <Text style={[styles.filterDropdownItemText, on ? styles.filterDropdownItemTextOn : null]}>
                            {row.label}
                          </Text>
                        </TouchableOpacity>
                        <View style={styles.filterTrophyItemRight}>
                          {on && bothTrophyKinds ? (
                            <TrophyModeSwitch mode={trophyMode} onChange={onTrophyModeChange} />
                          ) : null}
                          <TouchableOpacity onPress={() => onToggle(row.key)} activeOpacity={0.8} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                            <FilterCheck on={on} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => setTrophyOpen((v) => !v)}
                            activeOpacity={0.75}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Ionicons
                              name={trophyOpen ? 'chevron-up' : 'chevron-down'}
                              size={16}
                              color="#94a3b8"
                            />
                          </TouchableOpacity>
                        </View>
                      </View>

                      {trophyOpen ? (
                        <View style={styles.filterTrophyPanel}>
                          <TouchableOpacity
                            style={styles.filterTrophyKindRow}
                            onPress={() => onToggleTrophyKind('championship')}
                            activeOpacity={0.8}
                          >
                            <View style={styles.filterTrophyKindLeft}>
                              <View style={styles.filterTrophyMini}>
                                <MiniChampionshipTrophy />
                              </View>
                              <Text
                                style={[
                                  styles.filterTrophyKindLabel,
                                  trophyKinds?.championship ? styles.filterTrophyKindLabelOn : null,
                                ]}
                                numberOfLines={2}
                              >
                                {champLabel}
                              </Text>
                            </View>
                            <FilterCheck on={Boolean(trophyKinds?.championship)} />
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.filterTrophyKindRow}
                            onPress={() => onToggleTrophyKind('wine')}
                            activeOpacity={0.8}
                          >
                            <View style={styles.filterTrophyKindLeft}>
                              <View style={styles.filterTrophyMini}>
                                <MiniWineTrophy />
                              </View>
                              <Text
                                style={[
                                  styles.filterTrophyKindLabel,
                                  trophyKinds?.wine ? styles.filterTrophyKindLabelOn : null,
                                ]}
                                numberOfLines={2}
                              >
                                Trofeo del vino
                              </Text>
                            </View>
                            <FilterCheck on={Boolean(trophyKinds?.wine)} />
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  );
                }

                return (
                  <TouchableOpacity
                    key={row.key}
                    style={[
                      styles.filterDropdownItem,
                      isLast ? styles.filterDropdownItemLast : null,
                      on ? styles.filterDropdownItemOn : null,
                    ]}
                    onPress={() => onToggle(row.key)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.filterDropdownItemLeft}>
                      <CompareRowGlyph row={row} size={15} />
                      <Text style={[styles.filterDropdownItemText, on ? styles.filterDropdownItemTextOn : null]}>
                        {row.label}
                      </Text>
                    </View>
                    <FilterCheck on={on} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={[styles.filterScrollTrack, { height: scrollTrackH }]} pointerEvents="none">
              <View
                style={[
                  styles.filterScrollThumb,
                  {
                    height: thumbH,
                    transform: [{ translateY: thumbTop }],
                    opacity: canScroll ? 1 : 0.35,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CompareAvatar({ photoPath, name, width = PHOTO_WIDTH, height = PHOTO_HEIGHT }) {
  const radius = 14;
  const slotH = PHOTO_SLOT_HEIGHT;
  const fallbackStyle = {
    width,
    height,
    borderRadius: radius,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  };

  if (photoPath) {
    // Canvas più largo/alto + overflow visible: niente crop. Allineata in basso così
    // l’eventuale eccesso sfora dall’alto (anche sotto la X), come ai lati.
    const drawH = Math.round(height * PHOTO_ZOOM * PHOTO_VERT_BLEED);
    const drawW = Math.round(width * PHOTO_ZOOM * PHOTO_SIDE_BLEED);
    const top = slotH - drawH;
    return (
      <View style={{ width, height: slotH, alignItems: 'center', justifyContent: 'flex-end', overflow: 'visible' }}>
        <PlayerPhotoImage
          photoPath={photoPath}
          style={{
            width: drawW,
            height: drawH,
            position: 'absolute',
            left: (width - drawW) / 2,
            top,
          }}
          resizeMode="cover"
          fallbackStyle={fallbackStyle}
          fallbackIcon="person-outline"
          fallbackIconSize={Math.round(Math.min(width, height) * 0.34)}
          fallbackColor="#94a3b8"
        />
      </View>
    );
  }

  return (
    <View style={{ width, height: slotH, alignItems: 'center', justifyContent: 'center' }}>
      <View style={fallbackStyle}>
        <Text style={{ fontSize: Math.round(width * 0.28), fontWeight: '800', color: '#64748b' }}>
          {playerInitials(name)}
        </Text>
      </View>
    </View>
  );
}

function uniqueCareerTeams(teams) {
  const list = Array.isArray(teams) ? teams : [];
  const seen = new Set();
  const out = [];
  for (const team of list) {
    const name = String(team?.name || '').trim();
    const logoPath = String(team?.logo_path || '').trim().toLowerCase();
    const key = logoPath
      ? `logo:${logoPath}`
      : `name:${name.toLowerCase()}`;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(team);
  }
  return out;
}

function CareerLogos({ teams, max = 8 }) {
  const list = uniqueCareerTeams(teams);
  if (!list.length) {
    return <Text style={styles.metaMuted}>—</Text>;
  }
  const shown = list.slice(0, max);
  const count = shown.length;
  // Più loghi = più piccoli e più overlap, così restano su una riga
  const size = count <= 2 ? 26 : count <= 4 ? 22 : count <= 6 ? 18 : 16;
  const overlap = count <= 2 ? -6 : count <= 4 ? -7 : count <= 6 ? -8 : -9;

  return (
    <View style={styles.careerLogos}>
      {shown.map((team, index) => (
        <View
          key={`${team.team_id || team.name}-${index}`}
          style={[
            styles.careerLogoWrap,
            {
              width: size,
              height: size,
              zIndex: shown.length - index,
              marginLeft: index > 0 ? overlap : 0,
            },
          ]}
        >
          <TeamLogoImage
            logoPath={team.logo_path}
            style={{ width: size, height: size }}
            fallbackStyle={{
              width: size,
              height: size,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            fallbackIconSize={Math.max(8, Math.round(size * 0.4))}
          />
        </View>
      ))}
      {list.length > max ? (
        <Text style={[styles.careerLogoMore, { marginLeft: 2 }]}>+{list.length - max}</Text>
      ) : null}
    </View>
  );
}

function RolesPitch({ roles }) {
  const list = Array.isArray(roles) ? roles : [];
  const width = 64;
  const height = 88;
  const radius = 8;

  return (
    <View style={[styles.pitchWrap, { width, height }]}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Rect x={1} y={1} width={width - 2} height={height - 2} rx={8} fill="#1e3a5f" />
        <Rect x={1} y={1} width={width - 2} height={height - 2} rx={8} stroke="#94a3b8" strokeWidth={1.2} fill="none" />
        <Line x1={4} y1={height / 2} x2={width - 4} y2={height / 2} stroke="#64748b" strokeWidth={1} strokeDasharray="3 3" />
        <Rect x={(width - 30) / 2} y={1} width={30} height={12} stroke="#64748b" strokeWidth={1} fill="none" />
        <Rect x={(width - 30) / 2} y={height - 13} width={30} height={12} stroke="#64748b" strokeWidth={1} fill="none" />
        {list.map((role) => {
          const pos = ROLE_PITCH_POS[role] || ROLE_PITCH_POS.C;
          const cx = pos.x * width;
          const cy = pos.y * height;
          return (
            <React.Fragment key={role}>
              <Circle
                cx={cx}
                cy={cy}
                r={radius}
                fill={ROLE_COLORS[role] || '#fff'}
                stroke="#fff"
                strokeWidth={1.5}
              />
              <SvgText
                x={cx}
                y={cy + 3.5}
                fill="#fff"
                fontSize="9"
                fontWeight="800"
                textAnchor="middle"
              >
                {role}
              </SvgText>
            </React.Fragment>
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
            multiline={false}
            numberOfLines={1}
            scrollEnabled={false}
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

/** Stesso giocatore (id o cluster), non omonimi con stesso nome/anno. */
function isSameComparePlayer(selection, candidate) {
  if (!selection || !candidate) return false;

  const selectedPid = Number(selection.player_id);
  const candidatePid = Number(candidate.player_id);
  if (selectedPid > 0 && candidatePid > 0 && selectedPid === candidatePid) return true;

  const selectedCid = Number(
    selection.cluster_id
    || selection.profile?.player?.cluster_id
    || 0,
  );
  const candidateCid = Number(candidate.cluster_id || 0);
  if (selectedCid > 0 && candidateCid > 0 && selectedCid === candidateCid) return true;

  const members = Array.isArray(candidate.cluster_member_ids)
    ? candidate.cluster_member_ids
    : null;
  if (selectedPid > 0 && members?.some((id) => Number(id) === selectedPid)) return true;

  return false;
}

function SearchResultsPanel({
  loading,
  players,
  onSelect,
  excludeSelection,
}) {
  const filtered = (players || []).filter((p) => !isSameComparePlayer(excludeSelection, p));

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
              key={`player-${player.player_id}-${player.league_id}-${player.cluster_id || 0}`}
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

function PlayerHeaderCard({ profile, fallbackName, fallbackPhoto, side, onClear, showClear }) {
  const name = resolveDisplayName(profile, fallbackName);
  const fullName = `${name.firstName} ${name.lastName}`.trim();
  const photo = profile?.player?.photo_path || fallbackPhoto;
  const year = profile?.player?.birth_year;
  const textAlign = side === 'left' ? 'left' : 'right';
  const isLeft = side === 'left';

  const metaColumn = (
    <View style={styles.pitchMeta}>
      <CareerLogos teams={profile?.career_teams} />
      <Text style={styles.headerYear}>{year ? String(year) : '—'}</Text>
    </View>
  );

  return (
    <View style={styles.headerCard}>
      <View style={styles.headerPhotoRow}>
        <CompareAvatar photoPath={photo} name={fullName} />
        {showClear ? (
          <TouchableOpacity
            style={[styles.headerClearBtn, isLeft ? styles.headerClearBtnLeft : styles.headerClearBtnRight]}
            onPress={onClear}
            activeOpacity={0.75}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Cambia giocatore"
          >
            <Ionicons name="close" size={11} color="#64748b" />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={[styles.headerNames, { alignItems: isLeft ? 'flex-start' : 'flex-end' }]}>
        {name.firstName ? (
          <Text style={[styles.headerFirst, { textAlign }]} numberOfLines={1}>
            {name.firstName}
          </Text>
        ) : null}
        <Text style={[styles.headerLast, { textAlign }]} numberOfLines={2}>
          {name.lastName || 'Giocatore'}
        </Text>
      </View>
      <View style={[styles.pitchRow, isLeft ? null : styles.pitchRowRight]}>
        {isLeft ? (
          <>
            <RolesPitch roles={profile?.roles_played} />
            {metaColumn}
          </>
        ) : (
          <>
            {metaColumn}
            <RolesPitch roles={profile?.roles_played} />
          </>
        )}
      </View>
    </View>
  );
}

function StatCompareRow({
  row,
  leftValue,
  rightValue,
  leftSub,
  rightSub,
  leftEmpty,
  rightEmpty,
  zebra,
}) {
  const tones = compareTone(
    leftEmpty ? 0 : leftValue,
    rightEmpty ? 0 : rightValue,
    row.higherIsBetter,
  );
  const leftYear = leftSub != null && String(leftSub).trim() !== '' ? String(leftSub) : null;
  const rightYear = rightSub != null && String(rightSub).trim() !== '' ? String(rightSub) : null;
  return (
    <View style={[styles.statRow, zebra ? styles.statRowZebra : null]}>
      <View style={styles.statValueCell}>
        <Text style={[styles.statValue, { color: toneColor(leftEmpty ? 'tie' : tones.left) }]}>
          {formatStatValue(leftValue, row.decimals, { emptyDash: Boolean(leftEmpty) })}
        </Text>
        {leftYear && !leftEmpty ? <Text style={styles.statValueSub}>{leftYear}</Text> : null}
      </View>
      <View style={styles.statLabelCell}>
        <CompareRowGlyph row={row} size={15} />
        <Text style={styles.statLabel}>{row.label}</Text>
      </View>
      <View style={styles.statValueCell}>
        <Text style={[styles.statValue, { color: toneColor(rightEmpty ? 'tie' : tones.right) }]}>
          {formatStatValue(rightValue, row.decimals, { emptyDash: Boolean(rightEmpty) })}
        </Text>
        {rightYear && !rightEmpty ? <Text style={styles.statValueSub}>{rightYear}</Text> : null}
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [enabledKeys, setEnabledKeys] = useState(buildDefaultEnabledKeys);
  const [trophyKinds, setTrophyKinds] = useState(() => ({ ...DEFAULT_TROPHY_KINDS }));
  const [trophyMode, setTrophyMode] = useState(DEFAULT_TROPHY_MODE);
  const [marketValueMode, setMarketValueMode] = useState(DEFAULT_MARKET_VALUE_MODE);

  const searchSeqRef = useRef(0);
  const inputARef = useRef(null);
  const inputBRef = useRef(null);
  const filterBtnRef = useRef(null);
  const cacheRef = useRef(new Map());
  const [headerHeight, setHeaderHeight] = useState(0);

  const loadProfile = useCallback(async (playerId, leagueId) => {
    const key = `${playerId}-${leagueId}`;
    const cached = cacheRef.current.get(key);
    if (cached && cached?.stats && Object.prototype.hasOwnProperty.call(cached.stats, 'market_value_missing')) {
      return cached;
    }

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
          cluster_id: Number(profile?.player?.cluster_id) || prev.cluster_id || null,
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
    setFilterOpen(false);
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
    const other = side === 'a' ? slotB : slotA;
    if (isSameComparePlayer(other, player)) return;

    const selection = {
      player_id: Number(player.player_id),
      league_id: Number(player.league_id),
      cluster_id: Number(player.cluster_id) > 0 ? Number(player.cluster_id) : null,
      name: String(player.name || '').trim(),
      photo_path: player.photo_path || null,
      role: player.role || null,
      profile: null,
      loading: true,
      error: null,
    };
    closeSearch();
    void hydrateSlot(side, selection);
  }, [closeSearch, hydrateSlot, slotA, slotB]);

  const resetAndSearch = useCallback((side) => {
    openSearch(side);
  }, [openSearch]);

  const excludeSelection = useMemo(() => {
    const other = activeSlot === 'a' ? slotB : slotA;
    if (!other?.player_id) return null;
    return other;
  }, [activeSlot, slotA, slotB]);

  const bothReady = Boolean(slotA?.profile && slotB?.profile);
  const anyLoading = Boolean(slotA?.loading || slotB?.loading);
  const bothPicked = Boolean(slotA && slotB);
  const showSearchBar = !bothPicked || Boolean(activeSlot);
  const showSearchResults = Boolean(activeSlot) && showSearchBar && (searchLoading || searchQuery.trim().length >= 2);
  const showProfileClear = bothPicked && !activeSlot;

  const toggleFilterKey = useCallback((key) => {
    setEnabledKeys((prev) => {
      const nextOn = !prev[key];
      if (key === 'trophies' && nextOn) {
        setTrophyKinds((kinds) => (
          kinds.championship || kinds.wine
            ? kinds
            : { ...DEFAULT_TROPHY_KINDS }
        ));
      }
      return {
        ...prev,
        [key]: nextOn,
      };
    });
  }, []);

  const toggleTrophyKind = useCallback((kind) => {
    setTrophyKinds((prev) => {
      const next = { ...prev, [kind]: !prev[kind] };
      if (!next.championship && !next.wine) {
        setEnabledKeys((keys) => ({ ...keys, trophies: false }));
      } else {
        setEnabledKeys((keys) => ({ ...keys, trophies: true }));
      }
      return next;
    });
  }, []);

  const selectAllFilterKeys = useCallback(() => {
    const next = {};
    for (const row of COMPARE_ROWS) next[row.key] = true;
    setEnabledKeys(next);
    setTrophyKinds({ championship: true, wine: true });
  }, []);

  const resetDefaultFilterKeys = useCallback(() => {
    setEnabledKeys(buildDefaultEnabledKeys());
    setTrophyKinds({ ...DEFAULT_TROPHY_KINDS });
    setTrophyMode(DEFAULT_TROPHY_MODE);
    setMarketValueMode(DEFAULT_MARKET_VALUE_MODE);
  }, []);

  const filterIsDefault = useMemo(() => {
    const defaults = buildDefaultEnabledKeys();
    const keysMatch = COMPARE_ROWS.every((row) => Boolean(enabledKeys[row.key]) === Boolean(defaults[row.key]));
    const kindsMatch = Boolean(trophyKinds.championship) === true && Boolean(trophyKinds.wine) === false;
    const modeMatch = trophyMode === DEFAULT_TROPHY_MODE;
    const marketModeMatch = marketValueMode === DEFAULT_MARKET_VALUE_MODE;
    return keysMatch && kindsMatch && modeMatch && marketModeMatch;
  }, [enabledKeys, trophyKinds, trophyMode, marketValueMode]);

  const filterIsAll = useMemo(
    () => COMPARE_ROWS.every((row) => Boolean(enabledKeys[row.key]))
      && Boolean(trophyKinds.championship)
      && Boolean(trophyKinds.wine),
    [enabledKeys, trophyKinds],
  );

  const competitionName = useMemo(() => {
    const fromA = String(slotA?.profile?.competition_name || '').trim();
    const fromB = String(slotB?.profile?.competition_name || '').trim();
    return fromA || fromB || 'Campionato';
  }, [slotA, slotB]);

  const visibleRows = useMemo(() => {
    if (!bothReady) return [];
    const a = slotA.profile.stats || {};
    const b = slotB.profile.stats || {};
    const out = [];

    for (const row of COMPARE_ROWS) {
      if (!enabledKeys[row.key]) continue;

      if (row.key === 'market_value') {
        if (marketValueMode === 'peak') {
          out.push({
            ...row,
            key: 'peak_market_value',
            label: 'Valore più alto',
            yearKey: 'peak_market_value_year',
          });
        } else {
          out.push({
            ...row,
            key: 'market_value',
            label: 'Valore di mercato',
          });
        }
        continue;
      }

      if (row.key === 'trophies') {
        const wantChamp = Boolean(trophyKinds.championship);
        const wantWine = Boolean(trophyKinds.wine);
        if (!wantChamp && !wantWine) continue;

        if (wantChamp && wantWine && trophyMode === 'split') {
          out.push({
            key: 'championships',
            label: competitionName,
            higherIsBetter: true,
            decimals: 0,
            trophyGlyph: 'championship',
            accent: '#d97706',
          });
          out.push({
            key: 'wine_trophies',
            label: 'Trofeo del vino',
            higherIsBetter: true,
            decimals: 0,
            trophyGlyph: 'wine',
            accent: '#7c3aed',
          });
          continue;
        }

        if (wantChamp && wantWine) {
          out.push({
            ...row,
            key: 'trophies',
            label: 'Trofei',
            trophyGlyph: 'both',
          });
          continue;
        }

        if (wantChamp) {
          out.push({
            key: 'championships',
            label: competitionName,
            higherIsBetter: true,
            decimals: 0,
            trophyGlyph: 'championship',
            accent: '#d97706',
          });
          continue;
        }

        out.push({
          key: 'wine_trophies',
          label: 'Trofeo del vino',
          higherIsBetter: true,
          decimals: 0,
          trophyGlyph: 'wine',
          accent: '#7c3aed',
        });
        continue;
      }

      if (row.showIfAnyPositive) {
        if (!(Number(a[row.key] || 0) > 0 || Number(b[row.key] || 0) > 0)) continue;
      }
      out.push(row);
    }

    return out;
  }, [bothReady, slotA, slotB, enabledKeys, trophyKinds, trophyMode, marketValueMode, competitionName]);

  return (
    <View style={styles.container}>
      <View
        style={[styles.header, { paddingTop: Math.max(insets.top + 6, 12) }]}
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
      >
        <View style={[styles.headerTopRow, showSearchBar ? null : styles.headerTopRowCompact]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.75}>
            <Ionicons name="arrow-back" size={20} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Confronto</Text>
          <View ref={filterBtnRef} collapsable={false}>
            <TouchableOpacity
              style={[styles.filterBtn, filterOpen || !filterIsDefault ? styles.filterBtnActive : null]}
              onPress={() => {
                Keyboard.dismiss();
                setFilterOpen((open) => !open);
              }}
              activeOpacity={0.75}
              accessibilityLabel="Filtra parametri confronto"
            >
              <Ionicons
                name="options-outline"
                size={18}
                color={filterOpen || !filterIsDefault ? '#667eea' : '#333'}
              />
            </TouchableOpacity>
          </View>
        </View>

        {showSearchBar ? (
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
              <CompareVsIcon size={16} color="#667eea" />
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
        ) : null}
      </View>

      {showSearchResults && headerHeight > 0 ? (
        <View style={styles.searchOverlay} pointerEvents="box-none">
          <Pressable style={StyleSheet.absoluteFill} onPress={closeSearch} />
          <View style={[styles.searchResultsAnchor, { top: headerHeight }]}>
            <SearchResultsPanel
              loading={searchLoading}
              players={searchPlayers}
              excludeSelection={excludeSelection}
              onSelect={(player) => selectPlayer(activeSlot, player)}
            />
          </View>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 36 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => {
          Keyboard.dismiss();
          if (filterOpen) setFilterOpen(false);
        }}
      >
        {!slotA && !slotB ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <CompareVsIcon size={30} color="#fff" />
            </View>
            <Text style={styles.emptyTitle}>Scegli due giocatori</Text>
            <Text style={styles.emptySubtitle}>
              Cerca e seleziona i profili da confrontare.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.profilesRow}>
              <View style={styles.profilesRowBg} pointerEvents="none" />
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
                      showClear={showProfileClear}
                      onClear={() => resetAndSearch('a')}
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
                  <CompareVsIcon size={14} color="#667eea" />
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
                      showClear={showProfileClear}
                      onClear={() => resetAndSearch('b')}
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
              visibleRows.length > 0 ? (
                <View style={styles.statsCard}>
                  {visibleRows.map((row, index) => (
                    <StatCompareRow
                      key={row.key}
                      row={row}
                      leftValue={slotA.profile.stats?.[row.key]}
                      rightValue={slotB.profile.stats?.[row.key]}
                      leftSub={row.yearKey ? slotA.profile.stats?.[row.yearKey] : null}
                      rightSub={row.yearKey ? slotB.profile.stats?.[row.yearKey] : null}
                      leftEmpty={row.key === 'market_value' && Boolean(slotA.profile.stats?.market_value_missing)}
                      rightEmpty={row.key === 'market_value' && Boolean(slotB.profile.stats?.market_value_missing)}
                      zebra={index % 2 === 1}
                    />
                  ))}
                </View>
              ) : (
                <Text style={styles.hintText}>
                  Nessun parametro selezionato. Usa il filtro in alto a destra.
                </Text>
              )
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

      <CompareFilterMenu
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        anchorRef={filterBtnRef}
        enabledKeys={enabledKeys}
        onToggle={toggleFilterKey}
        onSelectAll={selectAllFilterKeys}
        onResetDefault={resetDefaultFilterKeys}
        allSelected={filterIsAll}
        defaultsSelected={filterIsDefault}
        trophyKinds={trophyKinds}
        trophyMode={trophyMode}
        onToggleTrophyKind={toggleTrophyKind}
        onTrophyModeChange={setTrophyMode}
        marketValueMode={marketValueMode}
        onMarketValueModeChange={setMarketValueMode}
        championshipLabel={competitionName}
      />
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
  headerTopRowCompact: {
    marginBottom: 0,
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
  filterBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBtnActive: {
    borderColor: '#667eea',
    backgroundColor: '#eef2ff',
  },
  filterMenuRoot: {
    flex: 1,
  },
  filterMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  filterDropdown: {
    position: 'absolute',
    maxHeight: FILTER_DROPDOWN_MAX_HEIGHT,
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
  filterDropdownActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterPresetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  filterPresetChipActive: {
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
  },
  filterPresetChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
  },
  filterPresetChipTextActive: {
    color: '#4f46e5',
  },
  filterDropdownScroll: {
    maxHeight: FILTER_DROPDOWN_MAX_HEIGHT - 48,
    flexGrow: 1,
  },
  filterDropdownBody: {
    position: 'relative',
    flexDirection: 'row',
  },
  filterDropdownScrollContent: {
    paddingVertical: 4,
    paddingRight: 10,
  },
  filterScrollTrack: {
    position: 'absolute',
    top: 4,
    right: 3,
    width: 3,
    borderRadius: 999,
    backgroundColor: '#e8edf5',
    overflow: 'hidden',
  },
  filterScrollThumb: {
    width: 3,
    borderRadius: 999,
    backgroundColor: '#94a3b8',
  },
  filterDropdownItem: {
    minHeight: 42,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  filterDropdownItemLast: {
    borderBottomWidth: 0,
  },
  filterDropdownItemNoBorder: {
    borderBottomWidth: 0,
  },
  filterDropdownItemOn: {
    backgroundColor: '#eef2ff',
  },
  filterDropdownItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  filterDropdownItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    flexShrink: 1,
  },
  filterDropdownItemTextOn: {
    color: '#4f46e5',
    fontWeight: '700',
  },
  filterInlineCheck: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  filterInlineCheckOn: {
    borderColor: '#667eea',
    backgroundColor: '#667eea',
  },
  filterTrophyBlock: {
    paddingBottom: 4,
  },
  filterTrophyBlockBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  filterTrophyItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterTrophyPanel: {
    marginHorizontal: 8,
    marginBottom: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e8edf5',
    gap: 2,
  },
  filterTrophyKindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 40,
    paddingVertical: 4,
    gap: 8,
  },
  filterTrophyKindLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  filterTrophyMini: {
    width: 22,
    height: 26,
    alignItems: 'center',
    justifyContent: 'flex-end',
    transform: [{ scale: 0.62 }],
  },
  filterTrophyKindLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
  },
  filterTrophyKindLabelOn: {
    color: '#334155',
    fontWeight: '700',
  },
  trophyModeSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  trophyModeSide: {
    width: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  trophyModeSideActive: {
    backgroundColor: '#eef2ff',
  },
  trophyModeSigma: {
    fontSize: 13,
    fontWeight: '800',
    color: '#94a3b8',
    lineHeight: 16,
  },
  trophyModeSigmaActive: {
    color: '#4f46e5',
  },
  marketModeSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  marketModeSide: {
    minWidth: 36,
    height: 24,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  marketModeSideActive: {
    backgroundColor: '#eef2ff',
  },
  marketModeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
  },
  marketModeTextActive: {
    color: '#4f46e5',
  },
  trophyGlyphRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
    minWidth: 18,
    height: 18,
    overflow: 'visible',
  },
  trophyGlyphScale: {
    transform: [{ scale: 0.48 }],
    marginBottom: -6,
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
    height: 32,
    fontSize: 12,
    color: '#1e293b',
    paddingVertical: 0,
    paddingHorizontal: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  vsBadge: {
    width: 38,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
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
    // Aria sopra così le foto possono sforare dall’alto senza clip dello ScrollView.
    paddingTop: 22,
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
    paddingTop: PROFILES_PAD_TOP,
    paddingBottom: 14,
    paddingHorizontal: 8,
    // Sfondo su layer separato: su Android borderRadius+bg taglia i figli.
    overflow: 'visible',
  },
  profilesRowBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e8edf5',
  },
  profileCol: {
    flex: 1,
    minWidth: 0,
    overflow: 'visible',
    zIndex: 1,
  },
  profilesDivider: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    zIndex: 2,
  },
  profilesDividerLine: {
    width: 1,
    flex: 1,
    backgroundColor: '#e2e8f0',
  },
  profilesDividerBadge: {
    width: 36,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCard: {
    gap: 6,
    paddingHorizontal: 4,
    overflow: 'visible',
  },
  headerPhotoRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    minHeight: PHOTO_SLOT_HEIGHT,
    overflow: 'visible',
  },
  headerClearBtn: {
    position: 'absolute',
    // Angolo alto della card (il paddingTop spinge solo foto/contenuto).
    top: -PROFILES_PAD_TOP + 7,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
    elevation: 3,
  },
  headerClearBtnLeft: {
    left: -5,
    right: undefined,
  },
  headerClearBtnRight: {
    right: -7,
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
  pitchRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    width: '100%',
  },
  pitchRowRight: {
    flexDirection: 'row',
  },
  pitchMeta: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  headerYear: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    textAlign: 'center',
  },
  metaMuted: {
    fontSize: 12,
    color: '#cbd5e1',
    textAlign: 'center',
  },
  careerLogos: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'nowrap',
  },
  careerLogoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  careerLogoMore: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
  },
  pitchWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pitchEmpty: {
    position: 'absolute',
    color: '#94a3b8',
    fontSize: 12,
  },
  profilePlaceholder: {
    minHeight: 180,
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
    backgroundColor: '#fff',
  },
  statValueCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    backgroundColor: '#fff',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  statValueSub: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
  },
  statLabelCell: {
    width: 112,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
    backgroundColor: '#fff',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#eef2f7',
  },
  statLabel: {
    fontSize: 10,
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

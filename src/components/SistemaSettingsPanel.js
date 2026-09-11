import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { publicAssetUrl } from '../services/api';
import {
  PROMO_SLIDE_DEFS,
  MINIGAME_DEFS,
  DEFAULT_SISTEMA_SETTINGS,
  getSistemaSettings,
  saveSistemaSettings,
  toggleSlideVisible,
  toggleMinigameVisible,
  moveSlide,
  normalizeSistemaSettings,
} from '../utils/sistemaSettings';

function StatusPill({ on, label }) {
  return (
    <View style={[styles.statusPill, on && styles.statusPillOn]}>
      <Text style={[styles.statusPillText, on && styles.statusPillTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function SectionCard({
  open,
  onToggle,
  icon,
  title,
  statusOn,
  statusLabel,
  children,
}) {
  return (
    <View style={[styles.card, open && styles.cardOpen]}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.75}>
        <View style={styles.sectionHeaderLeft}>
          <View style={[styles.sectionIcon, statusOn && styles.sectionIconOn]}>
            <Ionicons name={icon} size={18} color={statusOn ? '#667eea' : '#94a3b8'} />
          </View>
          <View style={styles.sectionCopy}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <StatusPill on={statusOn} label={statusLabel} />
          </View>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color="#94a3b8" />
      </TouchableOpacity>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

function CheckRow({
  label,
  hint,
  checked,
  disabled,
  onToggle,
  rightExtra,
  last,
}) {
  return (
    <TouchableOpacity
      style={[styles.checkRow, last && styles.checkRowLast, disabled && styles.checkRowDisabled]}
      onPress={disabled ? undefined : onToggle}
      activeOpacity={disabled ? 1 : 0.75}
      disabled={disabled}
    >
      <View style={[styles.checkBox, checked && styles.checkBoxOn, disabled && styles.checkBoxDisabled]}>
        {checked ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
      </View>
      <View style={styles.checkCopy}>
        <Text style={[styles.checkLabel, disabled && styles.checkLabelDisabled]} numberOfLines={1}>
          {label}
        </Text>
        {hint ? (
          <Text style={styles.checkHint} numberOfLines={2}>{hint}</Text>
        ) : null}
      </View>
      {rightExtra}
    </TouchableOpacity>
  );
}

export default function SistemaSettingsPanel({
  officialGroups = [],
  loadingOfficialGroups = false,
  togglingMenuGroupId = null,
  onToggleMainMenuGroup,
  onEnsureOfficialGroups,
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SISTEMA_SETTINGS);
  const [error, setError] = useState(null);
  const [slidesOpen, setSlidesOpen] = useState(true);
  const [minigamesOpen, setMinigamesOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(true);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      onEnsureOfficialGroups?.();
      const next = await getSistemaSettings();
      setSettings(next);
    } catch (e) {
      setError(e?.message || 'Impossibile caricare le impostazioni');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onEnsureOfficialGroups]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(async (next) => {
    const normalized = normalizeSistemaSettings(next);
    setSettings(normalized);
    setSaving(true);
    setError(null);
    try {
      const saved = await saveSistemaSettings(normalized);
      setSettings(saved);
    } catch (e) {
      setError(e?.message || 'Salvataggio non riuscito');
      await load({ silent: true });
    } finally {
      setSaving(false);
    }
  }, [load]);

  const anyMinigameVisible = useMemo(
    () => settings.minigames.some((m) => m.visible),
    [settings.minigames],
  );

  const enabledSlides = useMemo(
    () => settings.slides.filter((s) => {
      if (!s.visible) return false;
      if (s.id === 'minigames' && !anyMinigameVisible) return false;
      return true;
    }),
    [settings.slides, anyMinigameVisible],
  );

  const enabledMinigames = useMemo(
    () => settings.minigames.filter((m) => m.visible),
    [settings.minigames],
  );

  const showOrderControls = enabledSlides.length >= 2;

  const menuGroup = useMemo(
    () => officialGroups.find((g) => Number(g.show_in_main_menu) === 1) || null,
    [officialGroups],
  );

  const slidesStatus = useMemo(() => {
    const n = enabledSlides.length;
    if (n === 0) return { on: false, label: 'Nascosto' };
    if (n === 1) return { on: true, label: '1 slide' };
    return { on: true, label: `${n} slide` };
  }, [enabledSlides]);

  const minigamesStatus = useMemo(() => {
    const n = enabledMinigames.length;
    if (n === 0) return { on: false, label: 'Nessuno' };
    if (n === 1) return { on: true, label: '1 gioco' };
    return { on: true, label: `${n} giochi` };
  }, [enabledMinigames]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor="#667eea"
          colors={['#667eea']}
          onRefresh={() => {
            setRefreshing(true);
            void load({ silent: true });
          }}
        />
      }
    >
      <View style={styles.topRow}>
        <Text style={styles.subtitle}>
          Slide Partite, minigiochi e pulsante centrale del menu
        </Text>
        {saving ? (
          <View style={styles.savingChip}>
            <ActivityIndicator size="small" color="#667eea" />
            <Text style={styles.savingText}>Salvo</Text>
          </View>
        ) : null}
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={18} color="#b91c1c" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <SectionCard
        open={slidesOpen}
        onToggle={() => setSlidesOpen((v) => !v)}
        icon="albums-outline"
        title="Pulsante slide"
        statusOn={slidesStatus.on}
        statusLabel={slidesStatus.label}
      >
        <Text style={styles.hint}>
          Cosa mostrare in Partite. Una sola slide non ruota; nessuna nasconde il pulsante.
          {showOrderControls ? ' Usa le frecce per l’ordine.' : ''}
        </Text>
        <View style={styles.listCard}>
          {settings.slides.map((slide, index) => {
            const def = PROMO_SLIDE_DEFS.find((d) => d.id === slide.id);
            const needsMini = !!def?.requiresMinigame;
            const disabled = needsMini && !anyMinigameVisible;
            const visibleIndex = enabledSlides.findIndex((s) => s.id === slide.id);
            const canOrder = showOrderControls && slide.visible && !disabled;
            const last = index === settings.slides.length - 1;
            return (
              <CheckRow
                key={slide.id}
                last={last}
                label={def?.label || slide.id}
                hint={
                  disabled
                    ? 'Serve almeno un minigioco attivo'
                    : def?.hint
                }
                checked={!!slide.visible && !disabled}
                disabled={disabled}
                onToggle={() => {
                  void persist(toggleSlideVisible(settings, slide.id, !slide.visible));
                }}
                rightExtra={
                  canOrder ? (
                    <View style={styles.orderBtns}>
                      <TouchableOpacity
                        style={[styles.orderBtn, visibleIndex <= 0 && styles.orderBtnDisabled]}
                        disabled={visibleIndex <= 0}
                        onPress={() => void persist(moveSlide(settings, slide.id, 'up'))}
                        hitSlop={6}
                      >
                        <Ionicons
                          name="chevron-up"
                          size={16}
                          color={visibleIndex <= 0 ? '#cbd5e1' : '#667eea'}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.orderBtn,
                          visibleIndex >= enabledSlides.length - 1 && styles.orderBtnDisabled,
                        ]}
                        disabled={visibleIndex >= enabledSlides.length - 1}
                        onPress={() => void persist(moveSlide(settings, slide.id, 'down'))}
                        hitSlop={6}
                      >
                        <Ionicons
                          name="chevron-down"
                          size={16}
                          color={
                            visibleIndex >= enabledSlides.length - 1 ? '#cbd5e1' : '#667eea'
                          }
                        />
                      </TouchableOpacity>
                    </View>
                  ) : null
                }
              />
            );
          })}
        </View>
      </SectionCard>

      <SectionCard
        open={minigamesOpen}
        onToggle={() => setMinigamesOpen((v) => !v)}
        icon="game-controller-outline"
        title="Minigiochi"
        statusOn={minigamesStatus.on}
        statusLabel={minigamesStatus.label}
      >
        <Text style={styles.hint}>
          Solo i giochi attivi compaiono nell’hub. Con un solo gioco, la slide apre direttamente quello.
        </Text>
        <View style={styles.listCard}>
          {settings.minigames.map((game, index) => {
            const def = MINIGAME_DEFS.find((d) => d.id === game.id);
            return (
              <CheckRow
                key={game.id}
                last={index === settings.minigames.length - 1}
                label={def?.label || game.id}
                checked={!!game.visible}
                onToggle={() => {
                  void persist(toggleMinigameVisible(settings, game.id, !game.visible));
                }}
              />
            );
          })}
        </View>
      </SectionCard>

      <SectionCard
        open={menuOpen}
        onToggle={() => setMenuOpen((v) => !v)}
        icon="apps-outline"
        title="Pulsante centrale"
        statusOn={!!menuGroup}
        statusLabel={menuGroup ? menuGroup.name : 'Non impostato'}
      >
        <Text style={styles.hint}>
          Gruppo ufficiale del pulsante centrale. Modificabile anche dal tab Ufficiali.
        </Text>
        {loadingOfficialGroups && officialGroups.length === 0 ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color="#667eea" />
          </View>
        ) : officialGroups.length === 0 ? (
          <Text style={styles.emptyText}>Nessun gruppo ufficiale disponibile.</Text>
        ) : (
          <View style={styles.listCard}>
            {officialGroups.map((group, index) => {
              const selected = Number(group.show_in_main_menu) === 1;
              const busy = togglingMenuGroupId === group.id;
              const logoUri = group.logo_path ? publicAssetUrl(group.logo_path) : null;
              const last = index === officialGroups.length - 1;
              return (
                <TouchableOpacity
                  key={group.id}
                  style={[styles.groupRow, last && styles.checkRowLast, selected && styles.groupRowOn]}
                  activeOpacity={0.75}
                  disabled={!!togglingMenuGroupId}
                  onPress={() => onToggleMainMenuGroup?.(group)}
                >
                  {logoUri ? (
                    <Image source={{ uri: logoUri }} style={styles.groupLogo} />
                  ) : (
                    <View style={[styles.groupAvatar, selected && styles.groupAvatarOn]}>
                      <Text style={[styles.groupAvatarText, selected && styles.groupAvatarTextOn]}>
                        {String(group.name || '?').trim().charAt(0).toUpperCase() || '?'}
                      </Text>
                    </View>
                  )}
                  <View style={styles.groupCopy}>
                    <Text style={styles.groupName} numberOfLines={1}>{group.name}</Text>
                    <Text style={[styles.groupMeta, selected && styles.groupMetaOn]}>
                      {selected ? 'Attivo nel menu' : 'Tocca per associare'}
                    </Text>
                  </View>
                  {busy ? (
                    <ActivityIndicator size="small" color="#667eea" />
                  ) : (
                    <View style={[styles.radio, selected && styles.radioOn]}>
                      {selected ? <View style={styles.radioDot} /> : null}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  scroll: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  subtitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#64748b',
    lineHeight: 18,
  },
  savingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
  },
  savingText: { fontSize: 11, color: '#667eea', fontWeight: '700' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
    marginBottom: 10,
  },
  errorText: { flex: 1, color: '#b91c1c', fontSize: 13, lineHeight: 18 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#ececec',
    marginBottom: 10,
  },
  cardOpen: {
    borderColor: '#c7d2fe',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  sectionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionIconOn: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  sectionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    maxWidth: '100%',
  },
  statusPillOn: {
    backgroundColor: '#eef2ff',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  statusPillTextOn: {
    color: '#667eea',
  },
  sectionBody: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    gap: 10,
  },
  hint: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 17,
  },
  listCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eef2ff',
    overflow: 'hidden',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  checkRowLast: {
    borderBottomWidth: 0,
  },
  checkRowDisabled: {
    opacity: 0.55,
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkBoxOn: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  checkBoxDisabled: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  checkCopy: { flex: 1, minWidth: 0 },
  checkLabel: { fontSize: 14, fontWeight: '700', color: '#111827' },
  checkLabelDisabled: { color: '#94a3b8' },
  checkHint: { marginTop: 2, fontSize: 11, color: '#94a3b8', lineHeight: 15 },
  orderBtns: { flexDirection: 'row', gap: 4 },
  orderBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBtnDisabled: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  emptyText: { fontSize: 13, color: '#94a3b8', lineHeight: 18 },
  inlineLoading: { paddingVertical: 16, alignItems: 'center' },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  groupRowOn: {
    backgroundColor: '#eef2ff',
  },
  groupLogo: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  groupAvatar: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupAvatarOn: {
    backgroundColor: '#fff',
    borderColor: '#c7d2fe',
  },
  groupAvatarText: { fontSize: 14, fontWeight: '800', color: '#64748b' },
  groupAvatarTextOn: { color: '#667eea' },
  groupCopy: { flex: 1, minWidth: 0 },
  groupName: { fontSize: 14, fontWeight: '700', color: '#111827' },
  groupMeta: { marginTop: 2, fontSize: 11, color: '#94a3b8', fontWeight: '500' },
  groupMetaOn: { color: '#667eea', fontWeight: '700' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  radioOn: { borderColor: '#667eea' },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#667eea',
  },
});

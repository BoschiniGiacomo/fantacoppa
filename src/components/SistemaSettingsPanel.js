import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
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

function CheckRow({
  label,
  hint,
  checked,
  disabled,
  onToggle,
  rightExtra,
}) {
  return (
    <TouchableOpacity
      style={[styles.checkRow, disabled && styles.checkRowDisabled]}
      onPress={disabled ? undefined : onToggle}
      activeOpacity={disabled ? 1 : 0.75}
      disabled={disabled}
    >
      <View style={styles.checkCopy}>
        <Text style={[styles.checkLabel, disabled && styles.checkLabelDisabled]} numberOfLines={2}>
          {label}
        </Text>
        {hint ? (
          <Text style={styles.checkHint} numberOfLines={2}>{hint}</Text>
        ) : null}
      </View>
      {rightExtra}
      <View style={[styles.checkBox, checked && styles.checkBoxOn, disabled && styles.checkBoxDisabled]}>
        {checked ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
      </View>
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

  const enabledSlideCount = useMemo(
    () => settings.slides.filter((s) => s.visible).length,
    [settings.slides],
  );

  const showOrderControls = enabledSlideCount >= 2;

  const menuGroup = useMemo(
    () => officialGroups.find((g) => Number(g.show_in_main_menu) === 1) || null,
    [officialGroups],
  );

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
      <Text style={styles.subtitle}>
        Controlla slide Partite, minigiochi e pulsante centrale del menu
      </Text>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {saving ? (
        <View style={styles.savingRow}>
          <ActivityIndicator size="small" color="#667eea" />
          <Text style={styles.savingText}>Salvataggio…</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pulsante slide (Partite)</Text>
        <Text style={styles.cardHint}>
          Seleziona cosa mostrare. Con una sola slide non ruota. Con nessuna, il pulsante è nascosto.
          {showOrderControls ? ' Usa le frecce per l’ordine.' : ''}
        </Text>
        {settings.slides.map((slide) => {
          const def = PROMO_SLIDE_DEFS.find((d) => d.id === slide.id);
          const needsMini = !!def?.requiresMinigame;
          const disabled = needsMini && !anyMinigameVisible;
          const visibleSlides = settings.slides.filter((s) => s.visible);
          const visibleIndex = visibleSlides.findIndex((s) => s.id === slide.id);
          const canOrder = showOrderControls && slide.visible && !disabled;
          return (
            <View key={slide.id} style={styles.slideBlock}>
              <CheckRow
                label={def?.label || slide.id}
                hint={
                  disabled
                    ? 'Attiva almeno un minigioco per abilitare questa slide'
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
                          visibleIndex >= visibleSlides.length - 1 && styles.orderBtnDisabled,
                        ]}
                        disabled={visibleIndex >= visibleSlides.length - 1}
                        onPress={() => void persist(moveSlide(settings, slide.id, 'down'))}
                        hitSlop={6}
                      >
                        <Ionicons
                          name="chevron-down"
                          size={16}
                          color={
                            visibleIndex >= visibleSlides.length - 1 ? '#cbd5e1' : '#667eea'
                          }
                        />
                      </TouchableOpacity>
                    </View>
                  ) : null
                }
              />
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Minigiochi visibili</Text>
        <Text style={styles.cardHint}>
          Solo i minigiochi attivi compaiono nell’hub e possono alimentare la slide Minigiochi.
          Con un solo gioco attivo, la slide apre direttamente il gioco.
        </Text>
        {settings.minigames.map((game) => {
          const def = MINIGAME_DEFS.find((d) => d.id === game.id);
          return (
            <CheckRow
              key={game.id}
              label={def?.label || game.id}
              checked={!!game.visible}
              onToggle={() => {
                void persist(toggleMinigameVisible(settings, game.id, !game.visible));
              }}
            />
          );
        })}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pulsante centrale menu</Text>
        <Text style={styles.cardHint}>
          Gruppo ufficiale associato al pulsante centrale. Puoi cambiarlo anche dal tab Ufficiali.
        </Text>
        {loadingOfficialGroups && officialGroups.length === 0 ? (
          <ActivityIndicator color="#667eea" style={{ marginVertical: 12 }} />
        ) : officialGroups.length === 0 ? (
          <Text style={styles.emptyText}>Nessun gruppo ufficiale disponibile.</Text>
        ) : (
          officialGroups.map((group) => {
            const selected = Number(group.show_in_main_menu) === 1;
            const busy = togglingMenuGroupId === group.id;
            const logoUri = group.logo_path ? publicAssetUrl(group.logo_path) : null;
            return (
              <TouchableOpacity
                key={group.id}
                style={[styles.groupRow, selected && styles.groupRowOn]}
                activeOpacity={0.75}
                disabled={!!togglingMenuGroupId}
                onPress={() => onToggleMainMenuGroup?.(group)}
              >
                <View style={[styles.groupAvatar, selected && styles.groupAvatarOn]}>
                  {logoUri ? (
                    <Ionicons name="image-outline" size={16} color={selected ? '#667eea' : '#94a3b8'} />
                  ) : (
                    <Text style={styles.groupAvatarText}>
                      {String(group.name || '?').trim().charAt(0).toUpperCase() || '?'}
                    </Text>
                  )}
                </View>
                <View style={styles.groupCopy}>
                  <Text style={styles.groupName} numberOfLines={1}>{group.name}</Text>
                  {selected ? (
                    <Text style={styles.groupBadge}>Attivo nel menu</Text>
                  ) : (
                    <Text style={styles.groupHint}>Tocca per associare</Text>
                  )}
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
          })
        )}
        {menuGroup ? (
          <Text style={styles.footerNote}>
            Attuale: {menuGroup.name}
          </Text>
        ) : (
          <Text style={styles.footerNote}>Nessun gruppo associato al pulsante centrale.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 2,
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  savingText: { fontSize: 12, color: '#667eea', fontWeight: '600' },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: { color: '#b91c1c', fontSize: 13 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    gap: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  cardHint: { fontSize: 12, color: '#94a3b8', lineHeight: 17, marginBottom: 4 },
  slideBlock: { gap: 0 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eef2ff',
  },
  checkRowDisabled: { opacity: 0.55 },
  checkCopy: { flex: 1, minWidth: 0 },
  checkLabel: { fontSize: 14, fontWeight: '700', color: '#111827' },
  checkLabelDisabled: { color: '#94a3b8' },
  checkHint: { marginTop: 2, fontSize: 11, color: '#94a3b8', lineHeight: 15 },
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
  orderBtns: { flexDirection: 'row', gap: 2 },
  orderBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBtnDisabled: { backgroundColor: '#f8fafc' },
  emptyText: { fontSize: 13, color: '#94a3b8', paddingVertical: 8 },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eef2ff',
  },
  groupRowOn: {},
  groupAvatar: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupAvatarOn: { backgroundColor: '#eef2ff' },
  groupAvatarText: { fontSize: 14, fontWeight: '800', color: '#64748b' },
  groupCopy: { flex: 1, minWidth: 0 },
  groupName: { fontSize: 14, fontWeight: '700', color: '#111827' },
  groupBadge: { marginTop: 2, fontSize: 11, fontWeight: '700', color: '#667eea' },
  groupHint: { marginTop: 2, fontSize: 11, color: '#94a3b8' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: '#667eea' },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#667eea',
  },
  footerNote: {
    marginTop: 6,
    fontSize: 12,
    color: '#64748b',
  },
});

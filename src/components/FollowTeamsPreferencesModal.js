import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { matchesService } from '../services/api';
import { refreshStripTeams } from '../services/matchesStripPrefetch';
import { TeamLogoImage } from './StableCachedImage';

function TeamRowLogo({ logoUrl, logoPath }) {
  return (
    <TeamLogoImage
      logoUrl={logoUrl}
      logoPath={logoPath}
      style={styles.teamLogo}
      fallbackStyle={styles.teamLogoFallback}
    />
  );
}

/**
 * Modal condiviso: preferiti (stella) + notifiche squadre ufficiali.
 * Usato da Partite (onboarding FAB) e Profilo → Preferenze.
 */
export default function FollowTeamsPreferencesModal({
  visible,
  onClose,
  token,
  onSaved,
}) {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await matchesService.getFollowSetup();
      const comps = Array.isArray(res?.data?.competitions) ? res.data.competitions : [];
      setDraft(
        comps.map((c) => ({
          ...c,
          heart_team_names: [...(c.heart_team_names || [])],
          notify_team_names: [...(c.notify_team_names || [])],
        }))
      );
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Impossibile caricare le preferenze');
      setDraft([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible, load]);

  const toggleDraftHeart = (compId, teamName) => {
    setDraft((prev) =>
      prev.map((c) => {
        if (c.id !== compId) return c;
        const has = (c.heart_team_names || []).includes(teamName);
        const next = has
          ? c.heart_team_names.filter((t) => t !== teamName)
          : [...(c.heart_team_names || []), teamName];
        return { ...c, heart_team_names: next };
      })
    );
  };

  const toggleDraftNotify = (compId, teamName) => {
    setDraft((prev) =>
      prev.map((c) => {
        if (c.id !== compId) return c;
        const has = (c.notify_team_names || []).includes(teamName);
        const next = has
          ? c.notify_team_names.filter((t) => t !== teamName)
          : [...(c.notify_team_names || []), teamName];
        return { ...c, notify_team_names: next };
      })
    );
  };

  const goToOfficialTeam = (teamId, competitionId, teamName) => {
    const tid = Number(teamId);
    const cid = Number(competitionId);
    if (!tid || !cid) return;
    onClose?.();
    navigation.navigate('OfficialTeamDetail', {
      teamId: tid,
      competitionId: cid,
      teamName: String(teamName || '').trim() || undefined,
    });
  };

  const save = async () => {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      await matchesService.saveFollowPreferences({
        competitions: draft.map((c) => ({
          official_group_id: c.id,
          heart_team_names: c.heart_team_names || [],
          notify_team_names: c.notify_team_names || [],
        })),
      });
      await refreshStripTeams(token).catch(() => {});
      onClose?.();
      onSaved?.();
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Salvataggio non riuscito');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.box, { maxHeight: '85%' }]}>
          <Text style={styles.title}>Squadre preferite</Text>
          <Text style={styles.hint}>
            Stella per la strip Partite · campanella per le notifiche di quella squadra
          </Text>
          {loading ? (
            <ActivityIndicator style={{ marginVertical: 24 }} color="#667eea" />
          ) : (
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {draft.map((c) => (
                <View key={`follow-comp-${c.id}`} style={styles.compBlock}>
                  <Text style={styles.compTitle}>{c.name}</Text>
                  {(c.teams || []).length === 0 ? (
                    <Text style={styles.muted}>Nessuna squadra in elenco</Text>
                  ) : (
                    (c.teams || []).map((t) => {
                      const team = typeof t === 'string' ? { name: t } : t || {};
                      const tname = String(team.name || '').trim();
                      if (!tname) return null;
                      const isHeart = (c.heart_team_names || []).includes(tname);
                      const isNotify = (c.notify_team_names || []).includes(tname);
                      return (
                        <View key={`${c.id}-${tname}`} style={styles.teamRow}>
                          <TouchableOpacity
                            style={styles.teamMain}
                            activeOpacity={0.75}
                            onPress={() => goToOfficialTeam(team.id, c.id, tname)}
                          >
                            <TeamRowLogo logoUrl={team.logo_url} logoPath={team.logo_path} />
                            <Text style={styles.teamName} numberOfLines={1}>
                              {tname}
                            </Text>
                          </TouchableOpacity>
                          <View style={styles.icons}>
                            <TouchableOpacity
                              style={[styles.iconBtn, isHeart && styles.iconBtnActive]}
                              onPress={() => toggleDraftHeart(c.id, tname)}
                            >
                              <Ionicons
                                name={isHeart ? 'star' : 'star-outline'}
                                size={22}
                                color={isHeart ? '#ffc107' : '#888'}
                              />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.iconBtn, isNotify && styles.iconBtnActive]}
                              onPress={() => toggleDraftNotify(c.id, tname)}
                            >
                              <Ionicons
                                name={isNotify ? 'notifications' : 'notifications-outline'}
                                size={22}
                                color={isNotify ? '#667eea' : '#888'}
                              />
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>
              ))}
            </ScrollView>
          )}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btnSecondary} onPress={onClose} disabled={saving}>
              <Text style={styles.btnSecondaryText}>Chiudi</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPrimary, saving && styles.btnDisabled]}
              onPress={save}
              disabled={loading || saving}
            >
              <Text style={styles.btnPrimaryText}>{saving ? 'Salvo…' : 'Salva'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  box: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
  },
  title: { fontSize: 18, fontWeight: '800', color: '#222', marginBottom: 4 },
  hint: { fontSize: 12, color: '#666', marginBottom: 12, lineHeight: 18 },
  scroll: { flexGrow: 0 },
  errorText: { color: '#c62828', marginBottom: 8, fontSize: 13 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  btnSecondary: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  btnSecondaryText: { fontWeight: '700', color: '#444' },
  btnPrimary: {
    backgroundColor: '#667eea',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  btnPrimaryText: { fontWeight: '700', color: '#fff' },
  btnDisabled: { opacity: 0.55 },
  compBlock: { borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 12, marginTop: 8 },
  compTitle: { fontSize: 14, fontWeight: '800', color: '#333', marginBottom: 8 },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  teamMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 8,
  },
  teamName: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600', color: '#222' },
  teamLogo: { width: 28, height: 28, borderRadius: 14 },
  teamLogoFallback: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#eef2ff' },
  icons: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnActive: { backgroundColor: '#f0f4ff' },
  muted: { fontSize: 12, color: '#999' },
});

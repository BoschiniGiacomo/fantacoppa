import React, { useCallback, useEffect, useRef, useState } from 'react';
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
 * Ogni tap su stella/campanella salva subito (come in scheda squadra).
 */
export default function FollowTeamsPreferencesModal({
  visible,
  onClose,
  token,
  onSaved,
}) {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(false);
  const [comps, setComps] = useState([]);
  const [error, setError] = useState(null);
  const [busyKeys, setBusyKeys] = useState(() => new Set());
  const dirtyRef = useRef(false);
  const stripRefreshTimer = useRef(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await matchesService.getFollowSetup();
      const list = Array.isArray(res?.data?.competitions) ? res.data.competitions : [];
      setComps(
        list.map((c) => ({
          ...c,
          heart_team_names: [...(c.heart_team_names || [])],
          notify_team_names: [...(c.notify_team_names || [])],
        }))
      );
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Impossibile caricare le preferenze');
      setComps([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!visible) return;
    dirtyRef.current = false;
    void load();
  }, [visible, load]);

  useEffect(() => () => {
    if (stripRefreshTimer.current) clearTimeout(stripRefreshTimer.current);
  }, []);

  const setBusy = (key, on) => {
    setBusyKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const scheduleParentRefresh = useCallback(() => {
    dirtyRef.current = true;
    if (stripRefreshTimer.current) clearTimeout(stripRefreshTimer.current);
    stripRefreshTimer.current = setTimeout(() => {
      refreshStripTeams(token).catch(() => {});
      onSaved?.();
    }, 280);
  }, [token, onSaved]);

  const patchTeamLists = (compId, teamName, patcher) => {
    setComps((prev) =>
      prev.map((c) => {
        if (c.id !== compId) return c;
        return patcher(c, teamName);
      })
    );
  };

  const toggleHeart = async (compId, teamName) => {
    const key = `h:${compId}:${teamName}`;
    if (busyKeys.has(key) || !token) return;

    const comp = comps.find((c) => c.id === compId);
    const wasHeart = (comp?.heart_team_names || []).includes(teamName);
    const nextHeart = !wasHeart;

    // Allinea UI al backend: preferito ON attiva anche le notifiche.
    patchTeamLists(compId, teamName, (c) => {
      const hearts = new Set(c.heart_team_names || []);
      const notifies = new Set(c.notify_team_names || []);
      if (nextHeart) {
        hearts.add(teamName);
        notifies.add(teamName);
      } else {
        hearts.delete(teamName);
      }
      return {
        ...c,
        heart_team_names: Array.from(hearts),
        notify_team_names: Array.from(notifies),
      };
    });

    setBusy(key, true);
    setError(null);
    try {
      await matchesService.setFavoriteTeam(compId, teamName, nextHeart);
      scheduleParentRefresh();
    } catch (e) {
      patchTeamLists(compId, teamName, (c) => {
        const hearts = new Set(c.heart_team_names || []);
        const notifies = new Set(c.notify_team_names || []);
        if (wasHeart) {
          hearts.add(teamName);
        } else {
          hearts.delete(teamName);
          notifies.delete(teamName);
        }
        return {
          ...c,
          heart_team_names: Array.from(hearts),
          notify_team_names: Array.from(notifies),
        };
      });
      setError(e?.response?.data?.message || e?.message || 'Aggiornamento preferito non riuscito');
    } finally {
      setBusy(key, false);
    }
  };

  const toggleNotify = async (compId, teamName) => {
    const key = `n:${compId}:${teamName}`;
    if (busyKeys.has(key) || !token) return;

    const comp = comps.find((c) => c.id === compId);
    const wasNotify = (comp?.notify_team_names || []).includes(teamName);
    const nextNotify = !wasNotify;

    patchTeamLists(compId, teamName, (c) => {
      const notifies = new Set(c.notify_team_names || []);
      if (nextNotify) notifies.add(teamName);
      else notifies.delete(teamName);
      return { ...c, notify_team_names: Array.from(notifies) };
    });

    setBusy(key, true);
    setError(null);
    try {
      await matchesService.setTeamNotifications(compId, teamName, nextNotify);
      scheduleParentRefresh();
    } catch (e) {
      patchTeamLists(compId, teamName, (c) => {
        const notifies = new Set(c.notify_team_names || []);
        if (wasNotify) notifies.add(teamName);
        else notifies.delete(teamName);
        return { ...c, notify_team_names: Array.from(notifies) };
      });
      setError(e?.response?.data?.message || e?.message || 'Aggiornamento notifiche non riuscito');
    } finally {
      setBusy(key, false);
    }
  };

  const handleClose = () => {
    if (dirtyRef.current) {
      refreshStripTeams(token).catch(() => {});
      onSaved?.();
    }
    onClose?.();
  };

  const goToOfficialTeam = (teamId, competitionId, teamName) => {
    const tid = Number(teamId);
    const cid = Number(competitionId);
    if (!tid || !cid) return;
    handleClose();
    navigation.navigate('OfficialTeamDetail', {
      teamId: tid,
      competitionId: cid,
      teamName: String(teamName || '').trim() || undefined,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.box, { maxHeight: '85%' }]}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Squadre preferite</Text>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Chiudi"
            >
              <Ionicons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>
          {loading ? (
            <ActivityIndicator style={{ marginVertical: 24 }} color="#667eea" />
          ) : (
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {comps.map((c) => (
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
                      const heartBusy = busyKeys.has(`h:${c.id}:${tname}`);
                      const notifyBusy = busyKeys.has(`n:${c.id}:${tname}`);
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
                              style={[
                                styles.iconBtn,
                                isHeart && styles.iconBtnActive,
                                heartBusy && styles.iconBtnBusy,
                              ]}
                              onPress={() => toggleHeart(c.id, tname)}
                              disabled={heartBusy}
                            >
                              <Ionicons
                                name={isHeart ? 'star' : 'star-outline'}
                                size={22}
                                color={isHeart ? '#ffc107' : '#888'}
                              />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.iconBtn,
                                isNotify && styles.iconBtnActive,
                                notifyBusy && styles.iconBtnBusy,
                              ]}
                              onPress={() => toggleNotify(c.id, tname)}
                              disabled={notifyBusy}
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
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 18,
    fontWeight: '800',
    color: '#222',
    paddingRight: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  hint: { fontSize: 12, color: '#666', marginBottom: 12, lineHeight: 18 },
  scroll: { flexGrow: 0 },
  errorText: { color: '#c62828', marginBottom: 8, fontSize: 13 },
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
  iconBtnBusy: { opacity: 0.55 },
  muted: { fontSize: 12, color: '#999' },
});

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getMenuOfficialGroup } from '../utils/menuOfficialGroupSettings';
import { matchesService, minigamesService } from '../services/api';
import { HIGHER_LOWER_GAME_KEY } from '../minigames/higherLower/metrics';
import { getLocalBest, mergeBest } from '../minigames/higherLower/storage';

export default function MinigamesHubScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState(null);
  const [best, setBest] = useState(0);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const menuGroup = await getMenuOfficialGroup();
      if (!menuGroup?.id) {
        setGroup(null);
        setError('Gruppo ufficiale non configurato nel menu.');
        return;
      }
      setGroup(menuGroup);
      const local = await getLocalBest(menuGroup.id);
      let serverBest = 0;
      try {
        const res = await minigamesService.getBest(HIGHER_LOWER_GAME_KEY, menuGroup.id);
        serverBest = Number(res?.data?.best_score) || 0;
      } catch (_) {}
      const merged = await mergeBest(menuGroup.id, Math.max(local, serverBest));
      setBest(merged);
      // Prefetch pack in background for smoother game start
      matchesService.getHigherLowerPack(menuGroup.id).catch(() => {});
    } catch (e) {
      setError(e?.message || 'Impossibile caricare i minigiochi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  const openHigherLower = () => {
    if (!group?.id) return;
    navigation.navigate('HigherLowerGame', {
      groupId: group.id,
      groupName: group.name,
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Minigiochi</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={load}>
                <Text style={styles.retryText}>Riprova</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text style={styles.intro}>
            Sfide rapide sulla storia ufficiale
            {group?.name ? ` di ${group.name}` : ''}.
          </Text>

          <TouchableOpacity
            style={styles.gameCard}
            activeOpacity={0.88}
            onPress={openHigherLower}
            disabled={!group?.id}
          >
            <View style={styles.gameIconWrap}>
              <Ionicons name="swap-vertical" size={28} color="#667eea" />
            </View>
            <View style={styles.gameBody}>
              <Text style={styles.gameTitle}>Higher or Lower</Text>
              <Text style={styles.gameSubtitle}>
                Confronta le statistiche dei giocatori. Indovina se il secondo vale di più o di meno.
              </Text>
              <View style={styles.recordRow}>
                <Ionicons name="trophy-outline" size={16} color="#94a3b8" />
                <Text style={styles.recordText}>Record: {best}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#94a3b8" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.playBtn, !group?.id && styles.playBtnDisabled]}
            onPress={openHigherLower}
            disabled={!group?.id}
            activeOpacity={0.9}
          >
            <Text style={styles.playBtnText}>Gioca</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// Prefetch pack when hub mounts (warm cache for game)
MinigamesHubScreen.prefetchPack = async (groupId) => {
  if (!groupId) return null;
  try {
    return await matchesService.getHigherLowerPack(groupId);
  } catch (_) {
    return null;
  }
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ececec',
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, paddingBottom: 40 },
  intro: { fontSize: 14, color: '#64748b', marginBottom: 16, lineHeight: 20 },
  gameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#ececec',
    gap: 12,
  },
  gameIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameBody: { flex: 1 },
  gameTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  gameSubtitle: { marginTop: 4, fontSize: 13, color: '#64748b', lineHeight: 18 },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  recordText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  playBtn: {
    marginTop: 18,
    backgroundColor: '#667eea',
    borderRadius: 12,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#667eea',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  playBtnDisabled: { opacity: 0.5 },
  playBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: { color: '#b91c1c', fontSize: 14 },
  retryBtn: { marginTop: 10, alignSelf: 'flex-start' },
  retryText: { color: '#667eea', fontWeight: '700' },
});

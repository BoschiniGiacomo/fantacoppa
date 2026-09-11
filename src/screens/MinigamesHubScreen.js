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
import HigherLowerLogo from '../minigames/higherLower/HigherLowerLogo';
import HigherLowerInfoModal from '../minigames/higherLower/HigherLowerInfoModal';

export default function MinigamesHubScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState(null);
  const [best, setBest] = useState(0);
  const [error, setError] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);

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
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={load}>
                <Text style={styles.retryText}>Riprova</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {group?.name ? (
            <Text style={styles.sectionLabel}>
              Storia ufficiale · {group.name}
            </Text>
          ) : (
            <Text style={styles.sectionLabel}>Disponibili</Text>
          )}

          <TouchableOpacity
            style={[styles.gameCard, !group?.id && styles.gameCardDisabled]}
            activeOpacity={0.88}
            onPress={openHigherLower}
            disabled={!group?.id}
            accessibilityRole="button"
            accessibilityLabel={`Higher or Lower, personal best ${best}`}
          >
            <TouchableOpacity
              style={styles.infoBtn}
              onPress={() => setInfoOpen(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Come si gioca a Higher or Lower"
              accessibilityRole="button"
            >
              <Ionicons name="information-circle-outline" size={20} color="#94a3b8" />
            </TouchableOpacity>

            <View style={styles.gameTop}>
              <View style={styles.gameIconWrap}>
                <HigherLowerLogo size={48} />
              </View>
              <View style={styles.gameTitleBlock}>
                <Text style={styles.gameTitle} numberOfLines={1}>Higher or Lower</Text>
              </View>
            </View>

            <View style={styles.pbRow}>
              <Text style={styles.pbLabel}>PB</Text>
              <Text style={styles.pbValue} accessibilityLabel={`Personal best ${best}`}>
                {best}
              </Text>
            </View>
          </TouchableOpacity>
        </ScrollView>
      )}

      <HigherLowerInfoModal visible={infoOpen} onClose={() => setInfoOpen(false)} />
    </SafeAreaView>
  );
}

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
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 2,
  },
  gameCard: {
    position: 'relative',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    gap: 14,
  },
  gameCardDisabled: { opacity: 0.55 },
  infoBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 2,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingRight: 28,
  },
  gameIconWrap: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameTitleBlock: { flex: 1, minWidth: 0 },
  gameTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  gameHint: { marginTop: 3, fontSize: 13, color: '#667eea', fontWeight: '600' },
  pbRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    paddingTop: 12,
  },
  pbLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1.1,
  },
  pbValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
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

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getMenuOfficialGroup } from '../utils/menuOfficialGroupSettings';
import { matchesService, minigamesService } from '../services/api';
import { HIGHER_LOWER_GAME_KEY } from '../minigames/higherLower/metrics';
import { getLocalBest, mergeBest } from '../minigames/higherLower/storage';
import HigherLowerLogo from '../minigames/higherLower/HigherLowerLogo';

const INFO_STEPS = [
  {
    icon: 'person-outline',
    title: 'Vedi un giocatore',
    body: 'Mostriamo un valore (presenze, gol…)',
  },
  {
    icon: 'swap-vertical',
    title: 'Confronta il secondo',
    body: 'Higher = più alto · Lower = più basso',
  },
  {
    icon: 'flame-outline',
    title: 'Allunga lo streak',
    body: 'Corretta = +1. Sbagli e la partita termina',
  },
];

const INFO_METRICS = [
  { icon: 'football-outline', label: 'Gol' },
  { icon: 'calendar-outline', label: 'Presenze' },
  { icon: 'trophy-outline', label: 'Trofei' },
  { icon: 'shirt-outline', label: 'Squadre' },
  { icon: 'layers-outline', label: 'Edizioni' },
];

function HigherLowerInfoModal({ visible, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.infoOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Chiudi" />
        <View style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <View style={styles.infoHeaderIcon}>
              <HigherLowerLogo size={36} />
            </View>
            <View style={styles.infoHeaderText}>
              <Text style={styles.infoTitle}>Higher or Lower</Text>
              <Text style={styles.infoSubtitle}>Come si gioca</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Chiudi info">
              <Ionicons name="close" size={22} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          <View style={styles.infoSteps}>
            {INFO_STEPS.map((step, index) => (
              <View key={step.title} style={styles.infoStep}>
                <View style={styles.infoStepLeft}>
                  <View style={styles.infoStepIcon}>
                    <Ionicons name={step.icon} size={18} color="#667eea" />
                  </View>
                  {index < INFO_STEPS.length - 1 ? <View style={styles.infoStepLine} /> : null}
                </View>
                <View style={styles.infoStepBody}>
                  <Text style={styles.infoStepTitle}>{step.title}</Text>
                  <Text style={styles.infoStepText}>{step.body}</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.infoMetricsLabel}>Parametri possibili</Text>
          <View style={styles.infoMetrics}>
            {INFO_METRICS.map((m) => (
              <View key={m.label} style={styles.infoMetricItem}>
                <View style={styles.infoMetricIcon}>
                  <Ionicons name={m.icon} size={14} color="#667eea" />
                </View>
                <Text style={styles.infoMetricText} numberOfLines={1}>{m.label}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.infoOkBtn} onPress={onClose} activeOpacity={0.9}>
            <Text style={styles.infoOkText}>Ho capito</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

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

  infoOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  infoHeaderIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoHeaderText: { flex: 1, minWidth: 0 },
  infoTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  infoSubtitle: { marginTop: 1, fontSize: 12, fontWeight: '600', color: '#94a3b8' },
  infoSteps: { gap: 0 },
  infoStep: {
    flexDirection: 'row',
    gap: 12,
    minHeight: 64,
  },
  infoStepLeft: { width: 36, alignItems: 'center' },
  infoStepIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoStepLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#e0e7ff',
    marginVertical: 4,
    borderRadius: 1,
  },
  infoStepBody: { flex: 1, paddingBottom: 14, paddingTop: 2 },
  infoStepTitle: { fontSize: 13, fontWeight: '800', color: '#111827' },
  infoStepText: { marginTop: 2, fontSize: 11, color: '#64748b', lineHeight: 16 },
  infoMetricsLabel: {
    marginTop: 4,
    marginBottom: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  infoMetrics: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eef2ff',
    paddingVertical: 9,
    paddingHorizontal: 6,
  },
  infoMetricItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 2,
    minWidth: 0,
  },
  infoMetricIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoMetricText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: -0.2,
  },
  infoOkBtn: {
    marginTop: 18,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#667eea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoOkText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

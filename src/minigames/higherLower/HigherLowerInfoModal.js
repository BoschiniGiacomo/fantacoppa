import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HigherLowerLogo from './HigherLowerLogo';

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

export default function HigherLowerInfoModal({ visible, onClose }) {
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
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
});

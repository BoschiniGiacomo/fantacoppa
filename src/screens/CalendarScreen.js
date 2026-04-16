import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { formationService, leagueService } from '../services/api';
import { useOnboarding } from '../context/OnboardingContext';
import { hasSubmittedFormationPayload } from '../utils/formationSubmission';

export default function CalendarScreen({ route, navigation }) {
  const { leagueId } = route.params || {};
  const [league, setLeague] = useState(null);
  const [matchdays, setMatchdays] = useState([]);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();
  const [toastMsg, setToastMsg] = useState(null);
  const { markDone } = useOnboarding();
  
  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useEffect(() => {
    loadData();
  }, [leagueId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [leagueRes, matchdaysRes] = await Promise.all([
        leagueService.getById(leagueId),
        formationService.getMatchdays(leagueId),
      ]);

      const leagueData = Array.isArray(leagueRes.data) ? leagueRes.data[0] : leagueRes.data;
      setLeague(leagueData);

      // Per ogni giornata, verifica se l'utente ha inviato la formazione
      const matchdaysWithStatus = await Promise.all(
        (matchdaysRes.data || []).map(async (matchday) => {
          let hasFormation = false;
          if (leagueData.auto_lineup_mode === 1) {
            hasFormation = true;
          } else {
            try {
              const formationRes = await formationService.getFormation(leagueId, matchday.giornata);
              hasFormation = hasSubmittedFormationPayload(formationRes?.data);
            } catch (error) {
              hasFormation = false;
            }
          }

          // Controlla se la scadenza è nel passato
          const now = new Date();
          const deadline = new Date(matchday.deadline);
          const isExpired = deadline < now;

          return {
            ...matchday,
            hasFormation,
            isExpired,
          };
        })
      );

      setMatchdays(matchdaysWithStatus);

      // Se almeno una giornata ha una formazione inviata, rimuovi il badge
      if (matchdaysWithStatus.some(m => m.hasFormation)) {
        markDone('submitted_formation');
      }
    } catch (error) {
      console.error('Error loading calendar:', error);
      showToast('Impossibile caricare il calendario');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('it-IT', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleMatchdayPress = (matchday) => {
    if (league?.auto_lineup_mode !== 1) {
      navigation.navigate('Formation', { leagueId, giornata: matchday.giornata });
    } else {
      showToast(
        `In questa lega la formazione viene schierata automaticamente.`,
        'success'
      );
    }
  };

  const isAutoMode = league?.auto_lineup_mode === 1;

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.headerTitle}>Calendario</Text>
        {league && (
          <Text style={styles.leagueName}>{league.name}</Text>
        )}
      </View>

      <ScrollView 
        style={styles.content}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 80 }]}
      >
        {/* Info banner per autoformazione */}
        {isAutoMode && (
          <View style={styles.infoBanner}>
            <Ionicons name="flash" size={18} color="#667eea" />
            <Text style={styles.infoBannerText}>
              Formazione automatica attiva
            </Text>
          </View>
        )}

        {/* Contatore */}
        {matchdays.length > 0 && (
          <View style={styles.statsRow}>
            <View style={styles.statChip}>
              <Ionicons name="calendar-outline" size={14} color="#667eea" />
              <Text style={styles.statChipText}>{matchdays.length} giornate</Text>
            </View>
            {!isAutoMode && (
              <>
                <View style={[styles.statChip, { backgroundColor: '#e8f5e9' }]}>
                  <View style={[styles.statusDot, { backgroundColor: '#2e7d32' }]} />
                  <Text style={[styles.statChipText, { color: '#2e7d32' }]}>
                    {matchdays.filter(m => m.hasFormation).length} inviate
                  </Text>
                </View>
                <View style={[styles.statChip, { backgroundColor: '#fce4ec' }]}>
                  <View style={[styles.statusDot, { backgroundColor: '#c62828' }]} />
                  <Text style={[styles.statChipText, { color: '#c62828' }]}>
                    {matchdays.filter(m => !m.hasFormation).length} da inviare
                  </Text>
                </View>
              </>
            )}
          </View>
        )}

        {/* Lista giornate */}
        {matchdays.map((matchday, index) => {
          const statusColor = matchday.hasFormation ? '#2e7d32' : '#c62828';
          const matchdayKey = String(
            matchday?.id ??
            matchday?.giornata ??
            `${matchday?.deadline || 'no-deadline'}-${index}`
          );

          return (
            <TouchableOpacity
              key={matchdayKey}
              style={styles.card}
              onPress={() => handleMatchdayPress(matchday)}
              activeOpacity={0.7}
            >
              <View style={[styles.cardBorder, { backgroundColor: statusColor }]} />
              <View style={styles.cardBody}>
                {/* Riga superiore: numero giornata + stato */}
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle}>{matchday.giornata}ª Giornata</Text>
                  {!isAutoMode && (
                    <View style={[styles.statusBadge, { backgroundColor: matchday.hasFormation ? '#e8f5e9' : '#fce4ec' }]}>
                      <Ionicons
                        name={matchday.hasFormation ? 'checkmark-circle' : 'close-circle'}
                        size={14}
                        color={statusColor}
                      />
                      <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                        {matchday.hasFormation ? 'Inviata' : 'Da inviare'}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Riga inferiore: data + ora */}
                <View style={styles.cardBottom}>
                  <View style={styles.cardDetail}>
                    <Ionicons name="calendar-outline" size={15} color="#888" />
                    <Text style={styles.cardDetailText}>{formatDate(matchday.deadline)}</Text>
                  </View>
                  <View style={styles.cardDetail}>
                    <Ionicons name="time-outline" size={15} color="#888" />
                    <Text style={styles.cardDetailText}>{formatTime(matchday.deadline)}</Text>
                  </View>
                  {matchday.isExpired && (
                    <View style={styles.expiredChip}>
                      <Text style={styles.expiredChipText}>Scaduta</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Freccia navigazione */}
              {!isAutoMode && (
                <View style={styles.cardArrow}>
                  <Ionicons name="chevron-forward" size={20} color="#ccc" />
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {matchdays.length === 0 && (
          <View style={styles.emptyContainer}>
            <Ionicons name="calendar-outline" size={56} color="#d0d0d0" />
            <Text style={styles.emptyTitle}>Nessuna giornata</Text>
            <Text style={styles.emptySubtext}>Non ci sono ancora giornate disponibili per questa lega.</Text>
          </View>
        )}
      </ScrollView>

      {toastMsg && (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    lineHeight: 28,
  },
  leagueName: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: 12,
    paddingHorizontal: 16,
  },

  /* Info banner autoformazione */
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef0fb',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
    gap: 10,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#4a5568',
    lineHeight: 18,
  },

  /* Contatori / stats */
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef0fb',
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 12,
    gap: 6,
  },
  statChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#667eea',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  /* Card giornata */
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  cardBorder: {
    width: 4,
  },
  cardBody: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2c3e50',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: 8,
    gap: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cardDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cardDetailText: {
    fontSize: 13,
    color: '#6c757d',
  },
  expiredChip: {
    backgroundColor: '#fff3e0',
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  expiredChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#e65100',
  },
  cardArrow: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingRight: 10,
  },

  /* Empty state */
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#999',
    marginTop: 14,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#bbb',
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 40,
  },

  /* Toast */
  toast: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 999,
  },
  toastError: { backgroundColor: '#e53935' },
  toastSuccess: { backgroundColor: '#2e7d32' },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
});

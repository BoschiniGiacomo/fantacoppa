import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Calendar } from 'react-native-calendars';
import { leagueService } from '../services/api';
import DateTimePicker from '@react-native-community/datetimepicker';

export default function CalendarManagementScreen({ route, navigation }) {
  const { leagueId } = route.params || {};
  const insets = useSafeAreaInsets();
  const [matchdays, setMatchdays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markedDates, setMarkedDates] = useState({});
  const [selectedDate, setSelectedDate] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [selectedDeadline, setSelectedDeadline] = useState(new Date());
  const [editingMatchday, setEditingMatchday] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [defaultTime, setDefaultTime] = useState('20:00');
  const [toastMsg, setToastMsg] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useEffect(() => {
    loadMatchdays();
    loadDefaultTime();
  }, [leagueId]);

  const loadDefaultTime = async () => {
    try {
      const res = await leagueService.getSettings(leagueId);
      const time = res.data?.default_deadline_time || '20:00';
      // Rimuovi i secondi se presenti
      const timeWithoutSeconds = time.split(':').slice(0, 2).join(':');
      setDefaultTime(timeWithoutSeconds);
    } catch (error) {
      console.error('Error loading default time:', error);
      // Usa 20:00 come fallback
      setDefaultTime('20:00');
    }
  };

  useEffect(() => {
    updateMarkedDates();
  }, [matchdays]);

  const loadMatchdays = async () => {
    try {
      setLoading(true);
      const res = await leagueService.getMatchdays(leagueId);
      setMatchdays(res.data || []);
    } catch (error) {
      console.error('Error loading matchdays:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Impossibile caricare le giornate';
      showToast(errorMessage);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const updateMarkedDates = () => {
    const marked = {};
    matchdays.forEach((matchday) => {
      const date = matchday.deadline_date;
      marked[date] = {
        marked: true,
        dotColor: '#667eea',
        selected: false,
        selectedColor: '#667eea',
        customStyles: {
          container: {
            backgroundColor: '#f0f0ff',
            borderRadius: 8,
          },
          text: {
            color: '#667eea',
            fontWeight: 'bold',
          },
        },
      };
    });
    setMarkedDates(marked);
  };

  const handleDayPress = (day) => {
    const matchday = matchdays.find((m) => m.deadline_date === day.dateString);
    if (matchday) {
      // Modifica giornata esistente
      const deadline = new Date(matchday.deadline);
      setSelectedDeadline(deadline);
      setEditingMatchday(matchday);
      setShowModal(true);
    } else {
      // Nuova giornata - usa l'orario di default dalle impostazioni
      const date = new Date(day.dateString);
      const [hours, minutes] = defaultTime.split(':').map(Number);
      date.setHours(hours || 20, minutes || 0, 0, 0);
      setSelectedDeadline(date);
      setEditingMatchday(null);
      setShowModal(true);
    }
  };

  const handleSaveMatchday = async () => {
    try {
      setSaving(true);
      const deadlineDate = selectedDeadline.toISOString().split('T')[0];
      const deadlineTime = selectedDeadline.toTimeString().split(' ')[0].substring(0, 5);

      const matchdayData = {
        deadline_date: deadlineDate,
        deadline_time: deadlineTime,
      };

      if (editingMatchday) {
        matchdayData.matchday_id = editingMatchday.id;
      }

      await leagueService.saveMatchday(leagueId, matchdayData);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        setShowModal(false);
      }, 2000);
      await loadMatchdays();
    } catch (error) {
      console.error('Error saving matchday:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Impossibile salvare la giornata';
      showToast(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMatchday = (matchday) => {
    setConfirmModal({
      title: 'Conferma eliminazione',
      message: `Sei sicuro di voler eliminare la Giornata ${matchday.giornata}?`,
      confirmText: 'Elimina',
      destructive: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          setDeletingId(matchday.id);
          await leagueService.deleteMatchday(leagueId, matchday.id);
          showToast('Giornata eliminata con successo', 'success');
          await loadMatchdays();
        } catch (error) {
          console.error('Error deleting matchday:', error);
          const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Impossibile eliminare la giornata';
          showToast(errorMessage);
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('it-IT', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (loading && matchdays.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color="#667eea" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Gestione Calendario</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#667eea" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#667eea" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Gestione Calendario</Text>
        <TouchableOpacity
          onPress={() => {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            // Usa l'orario di default dalle impostazioni
            const [hours, minutes] = defaultTime.split(':').map(Number);
            tomorrow.setHours(hours || 20, minutes || 0, 0, 0);
            setSelectedDeadline(tomorrow);
            setEditingMatchday(null);
            setShowModal(true);
          }}
          style={styles.addButton}
        >
          <Ionicons name="add" size={24} color="#667eea" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={loadMatchdays} />
        }
      >
        {/* Calendario */}
        <View style={styles.calendarContainer}>
          <Calendar
            onDayPress={handleDayPress}
            markedDates={markedDates}
            theme={{
              todayTextColor: '#667eea',
              selectedDayBackgroundColor: '#667eea',
              selectedDayTextColor: '#fff',
              arrowColor: '#667eea',
              monthTextColor: '#333',
              textDayFontWeight: '600',
              textMonthFontWeight: 'bold',
              textDayHeaderFontWeight: '600',
            }}
            enableSwipeMonths={true}
          />
        </View>

        {/* Lista giornate */}
        <View style={styles.matchdaysList}>
          <Text style={styles.sectionTitle}>Giornate ({matchdays.length})</Text>
          {matchdays.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="calendar-outline" size={48} color="#ccc" />
              <Text style={styles.emptyText}>Nessuna giornata presente</Text>
              <Text style={styles.emptySubtext}>Tocca una data sul calendario o il pulsante + per aggiungere una giornata</Text>
            </View>
          ) : (
            matchdays.map((matchday) => {
              const deadline = new Date(matchday.deadline);
              const deadlineTimeText = Number.isNaN(deadline.getTime())
                ? (matchday.deadline_time || '--:--')
                : deadline.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
              return (
                <TouchableOpacity
                  key={matchday.id}
                  style={styles.matchdayItem}
                  onPress={() => handleDayPress({ dateString: matchday.deadline_date })}
                >
                  <View style={styles.matchdayInfo}>
                    <View style={styles.matchdayNumber}>
                      <Text style={styles.matchdayNumberText}>{matchday.giornata}</Text>
                    </View>
                    <View style={styles.matchdayDetails}>
                      <Text style={styles.matchdayDate}>{formatDate(matchday.deadline_date)}</Text>
                      <Text style={styles.matchdayTime}>
                        <Ionicons name="time-outline" size={14} color="#666" /> {deadlineTimeText}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDeleteMatchday(matchday)}
                    disabled={deletingId === matchday.id}
                    style={styles.deleteButton}
                  >
                    {deletingId === matchday.id ? (
                      <ActivityIndicator size="small" color="#dc3545" />
                    ) : (
                      <Ionicons name="trash-outline" size={20} color="#dc3545" />
                    )}
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Modal per aggiungere/modificare giornata */}
      <Modal
        visible={showModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingMatchday ? `Modifica Giornata ${editingMatchday.giornata}` : 'Nuova Giornata'}
              </Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <TouchableOpacity
                style={styles.dateTimeButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Ionicons name="calendar-outline" size={20} color="#667eea" />
                <Text style={styles.dateTimeText}>
                  Data: {selectedDeadline.toLocaleDateString('it-IT')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.dateTimeButton}
                onPress={() => setShowTimePicker(true)}
              >
                <Ionicons name="time-outline" size={20} color="#667eea" />
                <Text style={styles.dateTimeText}>
                  Orario: {selectedDeadline.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </TouchableOpacity>

              {showDatePicker && (
                <DateTimePicker
                  value={selectedDeadline}
                  mode="date"
                  display="default"
                  onChange={(event, date) => {
                    setShowDatePicker(false);
                    if (date) {
                      const newDate = new Date(date);
                      newDate.setHours(selectedDeadline.getHours(), selectedDeadline.getMinutes(), 0, 0);
                      setSelectedDeadline(newDate);
                    }
                  }}
                />
              )}

              {showTimePicker && (
                <DateTimePicker
                  value={selectedDeadline}
                  mode="time"
                  display="default"
                  onChange={(event, date) => {
                    setShowTimePicker(false);
                    if (date) {
                      const newDate = new Date(selectedDeadline);
                      newDate.setHours(date.getHours(), date.getMinutes(), 0, 0);
                      setSelectedDeadline(newDate);
                    }
                  }}
                />
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => setShowModal(false)}
                >
                  <Text style={styles.cancelButtonText}>Annulla</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalButton, 
                    styles.saveButton, 
                    saving && styles.saveButtonDisabled,
                    saved && styles.saveButtonSuccess
                  ]}
                  onPress={handleSaveMatchday}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : saved ? (
                    <>
                      <Ionicons name="checkmark-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
                      <Text style={styles.saveButtonText}>Salvato</Text>
                    </>
                  ) : (
                    <Text style={styles.saveButtonText}>Salva</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {toastMsg && (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      )}

      <Modal visible={!!confirmModal} transparent={true} animationType="fade" onRequestClose={() => setConfirmModal(null)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmContent}>
            <View style={styles.confirmIconWrap}>
              <Ionicons name={confirmModal?.destructive ? 'warning' : 'information-circle'} size={40} color={confirmModal?.destructive ? '#e53935' : '#667eea'} />
            </View>
            <Text style={styles.confirmTitle}>{confirmModal?.title}</Text>
            <Text style={styles.confirmMessage}>{confirmModal?.message}</Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity style={styles.confirmBtnCancel} onPress={() => setConfirmModal(null)}>
                <Text style={styles.confirmBtnCancelText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtnAction, confirmModal?.destructive && { backgroundColor: '#e53935' }]} onPress={() => confirmModal?.onConfirm?.()}>
                <Text style={styles.confirmBtnActionText}>{confirmModal?.confirmText || 'Conferma'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  addButton: {
    padding: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  calendarContainer: {
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 12,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  matchdaysList: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  matchdayItem: {
    backgroundColor: '#fff',
    padding: 16,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  matchdayInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  matchdayNumber: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#667eea',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  matchdayNumberText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  matchdayDetails: {
    flex: 1,
  },
  matchdayDate: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  matchdayTime: {
    fontSize: 14,
    color: '#666',
  },
  deleteButton: {
    padding: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  modalBody: {
    gap: 16,
  },
  dateTimeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    gap: 12,
  },
  dateTimeText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalButton: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#f5f5f5',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#667eea',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  saveButtonSuccess: {
    backgroundColor: '#198754',
  },
  toast: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  toastError: {
    backgroundColor: '#e53935',
  },
  toastSuccess: {
    backgroundColor: '#198754',
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  confirmContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  confirmIconWrap: {
    marginBottom: 16,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmMessage: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  confirmBtnCancel: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  confirmBtnCancelText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmBtnAction: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#667eea',
    alignItems: 'center',
  },
  confirmBtnActionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});


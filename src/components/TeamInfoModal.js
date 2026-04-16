import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { leagueService } from '../services/api';

export default function TeamInfoModal({ visible, leagueId, defaultTeamName, defaultCoachName, onSave, onClose }) {
  const [teamName, setTeamName] = useState('');
  const [coachName, setCoachName] = useState('');
  const [saving, setSaving] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  
  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  useEffect(() => {
    if (visible) {
      // Imposta i valori di default quando il modal viene mostrato
      setTeamName(defaultTeamName || '');
      setCoachName(defaultCoachName || '');
    }
  }, [visible, defaultTeamName, defaultCoachName]);

  const handleSave = async () => {
    const trimmedTeamName = teamName.trim();
    const trimmedCoachName = coachName.trim();

    if (!trimmedTeamName || !trimmedCoachName) {
      showToast('Nome squadra e nome allenatore sono obbligatori');
      return;
    }

    try {
      setSaving(true);
      console.log('=== SALVATAGGIO TEAM INFO ===');
      console.log('League ID:', leagueId);
      console.log('Team Name:', trimmedTeamName);
      console.log('Coach Name:', trimmedCoachName);
      
      const response = await leagueService.updateTeamInfo(leagueId, trimmedTeamName, trimmedCoachName);
      console.log('Update team info response:', JSON.stringify(response?.data, null, 2));
      console.log('Team info salvato con successo');
      console.log('===========================');
      
      onSave(trimmedTeamName, trimmedCoachName);
    } catch (error) {
      console.error('Error saving team info:', error);
      console.error('Error response:', error.response?.data);
      const errorMessage = error.response?.data?.message || error.message || 'Impossibile salvare le informazioni';
      showToast(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={() => {}} // Disabilita la chiusura con il back button
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.title}>Inserisci Nome Squadra e Allenatore</Text>
          <Text style={styles.subtitle}>
            Per partecipare a questa lega, devi inserire il nome della tua squadra e del tuo allenatore.
          </Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Nome Squadra *</Text>
            <TextInput
              style={styles.input}
              value={teamName}
              onChangeText={setTeamName}
              placeholder="Es. Squadra 3"
              autoCapitalize="words"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Nome Allenatore *</Text>
            <TextInput
              style={styles.input}
              value={coachName}
              onChangeText={setCoachName}
              placeholder="Es. Allenatore 3"
              autoCapitalize="words"
            />
          </View>

          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Salva</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
      {toastMsg && (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'} size={18} color="#fff" />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: '#667eea',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  toast: {
    position: 'absolute',
    top: 80,
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
  toastSuccess: { backgroundColor: '#2e7d32' },
  toastError: { backgroundColor: '#e53935' },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
});


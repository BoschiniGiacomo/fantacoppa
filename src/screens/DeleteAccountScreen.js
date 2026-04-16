import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Keyboard,
  ScrollView,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/api';

export default function DeleteAccountScreen({ navigation }) {
  const { logout } = useAuth();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const showToast = (text, type = 'error') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  };

  const startDelete = () => {
    Keyboard.dismiss();
    if (!password.trim()) {
      showToast('Inserisci la password per confermare');
      return;
    }
    setConfirmOpen(true);
  };

  const confirmDelete = async () => {
    setConfirmOpen(false);
    setLoading(true);
    try {
      const res = await authService.deleteAccount(password);
      showToast(res.data?.message || 'Account eliminato con successo', 'success');
      // Logout locale immediato: l'AppNavigator mostrerà automaticamente lo stack di login
      setTimeout(async () => {
        await logout();
      }, 700);
    } catch (error) {
      const msg =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        'Errore durante eliminazione account';
      showToast(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.title}>Elimina account</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.card}>
        <View style={styles.warnRow}>
          <Ionicons name="warning-outline" size={22} color="#dc3545" />
          <Text style={styles.warnTitle}>Azione definitiva</Text>
        </View>
        <Text style={styles.warnText}>
          Eliminando l’account verranno rimossi definitivamente i tuoi dati e la tua partecipazione alle leghe.
          Questa azione non può essere annullata.
        </Text>

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Inserisci la tua password"
          placeholderTextColor="#999"
          secureTextEntry
          autoCapitalize="none"
        />

        <TouchableOpacity
          style={[styles.deleteBtn, loading && styles.btnDisabled]}
          onPress={startDelete}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="trash-outline" size={20} color="#fff" />
              <Text style={styles.deleteBtnText}>Elimina definitivamente</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {toast && (
        <View style={[styles.toast, toast.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons
            name={toast.type === 'success' ? 'checkmark-circle' : 'alert-circle'}
            size={18}
            color="#fff"
          />
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      )}

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setConfirmOpen(false)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.modalBox}>
            <Text style={styles.modalTitle}>Conferma eliminazione</Text>
            <Text style={styles.modalMsg}>
              Sei sicuro di voler eliminare definitivamente il tuo account? Questa azione è irreversibile.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setConfirmOpen(false)}>
                <Text style={styles.modalCancelText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalDelete} onPress={confirmDelete}>
                <Text style={styles.modalDeleteText}>Elimina</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { paddingBottom: 30 },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: { padding: 6 },
  title: { fontSize: 18, fontWeight: '700', color: '#333' },
  card: {
    margin: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  warnTitle: { fontSize: 16, fontWeight: '700', color: '#dc3545' },
  warnText: { fontSize: 13, color: '#666', lineHeight: 18, marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: '#333',
    marginBottom: 16,
  },
  deleteBtn: {
    backgroundColor: '#dc3545',
    borderRadius: 10,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  deleteBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.6 },
  toast: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toastSuccess: { backgroundColor: '#28a745' },
  toastError: { backgroundColor: '#dc3545' },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalBox: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#333', marginBottom: 10 },
  modalMsg: { fontSize: 14, color: '#666', lineHeight: 20, marginBottom: 16 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  modalCancel: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#f0f0f0' },
  modalCancelText: { fontWeight: '700', color: '#333' },
  modalDelete: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#dc3545' },
  modalDeleteText: { fontWeight: '800', color: '#fff' },
});


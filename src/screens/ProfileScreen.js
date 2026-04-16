import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Keyboard,
  Platform,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { authService } from '../services/api';
import {
  openSystemNotificationSettings,
  scheduleDebugTestNotification,
  retryRegisterPushTokenForDebug,
} from '../services/notificationService';
import {
  getNotificationDebugLog,
  clearNotificationDebugLog,
  shareNotificationDebugLogFile,
} from '../services/notificationDebugLog';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const navigation = useNavigation();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  const [notifDebugOpen, setNotifDebugOpen] = useState(false);
  const [notifDebugLog, setNotifDebugLog] = useState('');

  const refreshNotifLog = useCallback(async () => {
    const t = await getNotificationDebugLog();
    setNotifDebugLog(t.trim() ? t : '(nessuna voce — usa i pulsanti sotto)');
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshNotifLog();
    }, [refreshNotifLog])
  );

  const handleDebugTestNotification = async () => {
    try {
      await scheduleDebugTestNotification();
      showToast('Notifica di test tra ~3 secondi. Metti l’app in background.', 'success');
      await refreshNotifLog();
    } catch (e) {
      showToast(e?.message || 'Errore notifica test');
    }
  };

  const handleRetryPushRegister = async () => {
    try {
      await retryRegisterPushTokenForDebug();
      showToast('Tentativo inviato — leggi il log qui sotto', 'success');
      await refreshNotifLog();
    } catch (e) {
      showToast(e?.message || 'Errore');
    }
  };

  const handleClearNotifLog = async () => {
    await clearNotificationDebugLog();
    await refreshNotifLog();
    showToast('Log svuotato', 'success');
  };

  const handleShareNotifLog = async () => {
    try {
      await shareNotificationDebugLogFile();
    } catch (e) {
      showToast(e?.message || 'Condivisione non riuscita');
    }
  };
  
  // Livelli superuser: 1 = admin completo, 2 = gestione partite.
  const superuserLevel = Number(user?.is_superuser || 0);
  const canOpenSuperUserPanel = superuserLevel === 1;
  const canOpenMatchManagement = superuserLevel === 1 || superuserLevel === 2;

  const handleLogout = () => {
    setConfirmModal({
      title: 'Conferma Logout',
      message: 'Sei sicuro di voler uscire?',
      confirmText: 'Esci',
      destructive: true,
      onConfirm: () => {
        setConfirmModal(null);
        logout();
      },
    });
  };

  const handleChangePassword = async () => {
    Keyboard.dismiss();
    
    if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      showToast('Compila tutti i campi');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      showToast('Le nuove password non coincidono');
      return;
    }
    
    if (newPassword.length < 6) {
      showToast('La nuova password deve essere di almeno 6 caratteri');
      return;
    }
    
    try {
      setLoading(true);
      const res = await authService.changePassword(currentPassword, newPassword, confirmPassword);
      showToast(res.data.message || 'Password aggiornata con successo', 'success');
      
      // Reset form
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowChangePassword(false);
    } catch (error) {
      console.error('Error changing password:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Errore durante il cambio password';
      showToast(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDeleteAccount = () => {
    navigation.navigate('DeleteAccount');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <Ionicons name="person" size={64} color="#667eea" />
        </View>
        <Text style={styles.username}>{user?.username}</Text>
        <Text style={styles.email}>{user?.email}</Text>
      </View>

      <View style={styles.menu}>
        <TouchableOpacity 
          style={styles.menuItem}
          onPress={() => setShowChangePassword(!showChangePassword)}
        >
          <Ionicons name="key-outline" size={24} color="#666" />
          <Text style={styles.menuText}>Cambia Password</Text>
          <Ionicons 
            name={showChangePassword ? "chevron-down" : "chevron-forward"} 
            size={20} 
            color="#ccc" 
          />
        </TouchableOpacity>

        {showChangePassword && (
          <View style={styles.passwordSection}>
            <View style={styles.passwordInputContainer}>
              <Text style={styles.passwordLabel}>Password attuale</Text>
              <View style={styles.passwordInputWrapper}>
                <TextInput
                  style={styles.passwordInput}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Inserisci password attuale"
                  secureTextEntry={!showCurrentPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowCurrentPassword(!showCurrentPassword)}
                  style={styles.eyeButton}
                >
                  <Ionicons
                    name={showCurrentPassword ? "eye-outline" : "eye-off-outline"}
                    size={24}
                    color="#666"
                  />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.passwordInputContainer}>
              <Text style={styles.passwordLabel}>Nuova password</Text>
              <View style={styles.passwordInputWrapper}>
                <TextInput
                  style={styles.passwordInput}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Inserisci nuova password"
                  secureTextEntry={!showNewPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowNewPassword(!showNewPassword)}
                  style={styles.eyeButton}
                >
                  <Ionicons
                    name={showNewPassword ? "eye-outline" : "eye-off-outline"}
                    size={24}
                    color="#666"
                  />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.passwordInputContainer}>
              <Text style={styles.passwordLabel}>Conferma nuova password</Text>
              <View style={styles.passwordInputWrapper}>
                <TextInput
                  style={styles.passwordInput}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Conferma nuova password"
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={styles.eyeButton}
                >
                  <Ionicons
                    name={showConfirmPassword ? "eye-outline" : "eye-off-outline"}
                    size={24}
                    color="#666"
                  />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.changePasswordButton, loading && styles.changePasswordButtonDisabled]}
              onPress={handleChangePassword}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.changePasswordButtonText}>Aggiorna Password</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Sezione Super User */}
        {canOpenSuperUserPanel && (
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => navigation.navigate('SuperUser')}
          >
            <Ionicons name="shield-checkmark" size={24} color="#ffc107" />
            <Text style={[styles.menuText, styles.superuserText]}>Super User</Text>
            <Ionicons 
              name="chevron-forward" 
              size={20} 
              color="#ccc" 
            />
          </TouchableOpacity>
        )}

        {canOpenMatchManagement && (
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('ManageMatches')}
          >
            <Ionicons name="football-outline" size={24} color="#666" />
            <Text style={styles.menuText}>Gestione Partite</Text>
            <Ionicons name="chevron-forward" size={20} color="#ccc" />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.menuItem}
          onPress={openSystemNotificationSettings}
        >
          <Ionicons name="notifications-outline" size={24} color="#666" />
          <Text style={styles.menuText}>Gestione Notifiche</Text>
          <Ionicons
            name="open-outline"
            size={20}
            color="#ccc"
          />
        </TouchableOpacity>

        {canOpenSuperUserPanel && (
          <>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => setNotifDebugOpen(!notifDebugOpen)}
            >
              <Ionicons name="bug-outline" size={24} color="#666" />
              <Text style={styles.menuText}>Debug notifiche e log</Text>
              <Ionicons
                name={notifDebugOpen ? 'chevron-down' : 'chevron-forward'}
                size={20}
                color="#ccc"
              />
            </TouchableOpacity>

            {notifDebugOpen && (
              <View style={styles.notifDebugPanel}>
                <Text style={styles.notifDebugHint}>
                  Il log è salvato in app (AsyncStorage). Condividi il file .txt per analizzarlo sul PC.
                </Text>
                <View style={styles.notifDebugButtons}>
                  <TouchableOpacity style={styles.notifDebugBtn} onPress={handleDebugTestNotification}>
                    <Text style={styles.notifDebugBtnText}>Notifica test (3s)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.notifDebugBtn} onPress={handleRetryPushRegister}>
                    <Text style={styles.notifDebugBtnText}>Riprova registrazione push</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.notifDebugButtons}>
                  <TouchableOpacity style={styles.notifDebugBtnSecondary} onPress={refreshNotifLog}>
                    <Text style={styles.notifDebugBtnSecondaryText}>Aggiorna log</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.notifDebugBtnSecondary} onPress={handleClearNotifLog}>
                    <Text style={styles.notifDebugBtnSecondaryText}>Svuota log</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.notifDebugShareBtn} onPress={handleShareNotifLog}>
                  <Text style={styles.notifDebugShareBtnText}>Condividi log (.txt)</Text>
                </TouchableOpacity>
                <ScrollView
                  style={styles.notifDebugScroll}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                >
                  <Text selectable style={styles.notifDebugLogText}>
                    {notifDebugLog}
                  </Text>
                </ScrollView>
              </View>
            )}
          </>
        )}

        <TouchableOpacity
          style={[styles.menuItem, styles.deleteAccountItem]}
          onPress={handleOpenDeleteAccount}
        >
          <Ionicons name="trash-outline" size={24} color="#dc3545" />
          <Text style={[styles.menuText, styles.deleteAccountText]}>Elimina Account</Text>
          <Ionicons
            name="open-outline"
            size={20}
            color="#dc3545"
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.menuItem, styles.logoutItem]}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={24} color="#dc3545" />
          <Text style={[styles.menuText, styles.logoutText]}>Esci</Text>
        </TouchableOpacity>
      </View>

      {/* Toast */}
      {toastMsg && (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Ionicons
            name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'}
            size={22}
            color="#fff"
            style={styles.toastIcon}
          />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      )}

      {/* Confirm Modal */}
      <Modal
        visible={!!confirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => confirmModal && setConfirmModal(null)}
      >
        <TouchableOpacity
          style={styles.confirmOverlay}
          activeOpacity={1}
          onPress={() => setConfirmModal(null)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>{confirmModal?.title}</Text>
            <Text style={styles.confirmMessage}>{confirmModal?.message}</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={styles.confirmButtonCancel}
                onPress={() => setConfirmModal(null)}
              >
                <Text style={styles.confirmButtonCancelText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButtonConfirm, confirmModal?.destructive && styles.confirmButtonDestructive]}
                onPress={confirmModal?.onConfirm}
              >
                <Text style={[styles.confirmButtonConfirmText, confirmModal?.destructive && styles.confirmButtonDestructiveText]}>
                  {confirmModal?.confirmText}
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    alignItems: 'center',
    padding: 30,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  avatarContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#e3f2fd',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
  },
  username: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: '#666',
  },
  menu: {
    marginTop: 15,
    backgroundColor: '#fff',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    marginLeft: 15,
  },
  logoutItem: {
    borderBottomWidth: 0,
  },
  deleteAccountItem: {
    borderBottomColor: '#f8d7da',
  },
  deleteAccountText: {
    color: '#dc3545',
    fontWeight: '600',
  },
  logoutText: {
    color: '#dc3545',
  },
  passwordSection: {
    backgroundColor: '#f9f9f9',
    padding: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#f0f0f0',
  },
  passwordInputContainer: {
    marginBottom: 16,
  },
  passwordLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  passwordInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: '#333',
  },
  eyeButton: {
    padding: 8,
  },
  changePasswordButton: {
    backgroundColor: '#667eea',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  changePasswordButtonDisabled: {
    opacity: 0.6,
  },
  changePasswordButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  superuserText: {
    color: '#ffc107',
    fontWeight: '600',
  },
  superuserSection: {
    backgroundColor: '#f9f9f9',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#f0f0f0',
  },
  superuserTabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  superuserTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 6,
  },
  superuserTabActive: {
    backgroundColor: '#667eea',
  },
  superuserTabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  superuserTabTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  superuserContent: {
    minHeight: 300,
    maxHeight: 500,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  userInfo: {
    flex: 1,
    marginRight: 12,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  superuserBadge: {
    backgroundColor: '#ffc107',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  superuserBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#333',
  },
  userEmail: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  userStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ccc',
  },
  statusIndicatorOnline: {
    backgroundColor: '#28a745',
  },
  userStatus: {
    fontSize: 12,
    color: '#666',
  },
  userLastActivity: {
    fontSize: 12,
    color: '#999',
  },
  toggleSuperuserButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#667eea',
    gap: 4,
  },
  toggleSuperuserButtonActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  toggleSuperuserText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#667eea',
  },
  toggleSuperuserTextActive: {
    color: '#fff',
  },
  leagueItem: {
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  leagueInfo: {
    marginBottom: 12,
  },
  leagueName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  leagueDetails: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  leagueCreated: {
    fontSize: 12,
    color: '#999',
  },
  leagueActions: {
    flexDirection: 'row',
    gap: 8,
  },
  leagueActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#667eea',
    gap: 4,
    flex: 1,
    justifyContent: 'center',
  },
  leagueActionButtonAdmin: {
    borderColor: '#28a745',
  },
  leagueActionButtonDanger: {
    borderColor: '#dc3545',
  },
  leagueActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#667eea',
  },
  leagueActionTextAdmin: {
    color: '#28a745',
  },
  leagueActionTextDanger: {
    color: '#dc3545',
  },
  errorsPlaceholder: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorsPlaceholderText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
    marginBottom: 8,
  },
  errorsPlaceholderSubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 16,
  },
  // Toast
  toast: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  toastError: {
    backgroundColor: '#dc3545',
  },
  toastSuccess: {
    backgroundColor: '#28a745',
  },
  toastIcon: {
    marginRight: 10,
  },
  toastText: {
    flex: 1,
    fontSize: 15,
    color: '#fff',
    fontWeight: '500',
  },
  // Confirm Modal
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  confirmBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  confirmMessage: {
    fontSize: 15,
    color: '#666',
    lineHeight: 22,
    marginBottom: 22,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
  },
  confirmButtonCancel: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  confirmButtonCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  confirmButtonConfirm: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#667eea',
  },
  confirmButtonDestructive: {
    backgroundColor: '#dc3545',
  },
  confirmButtonConfirmText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  confirmButtonDestructiveText: {
    color: '#fff',
  },
  notifDebugPanel: {
    backgroundColor: '#f8f9fa',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  notifDebugHint: {
    fontSize: 12,
    color: '#666',
    lineHeight: 18,
    marginBottom: 12,
  },
  notifDebugButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  notifDebugBtn: {
    flexGrow: 1,
    minWidth: '45%',
    backgroundColor: '#667eea',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  notifDebugBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  notifDebugBtnSecondary: {
    flexGrow: 1,
    minWidth: '45%',
    backgroundColor: '#e9ecef',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  notifDebugBtnSecondaryText: {
    color: '#333',
    fontSize: 13,
    fontWeight: '600',
  },
  notifDebugShareBtn: {
    backgroundColor: '#495057',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  notifDebugShareBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  notifDebugScroll: {
    maxHeight: 220,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dee2e6',
    borderRadius: 8,
    padding: 8,
  },
  notifDebugLogText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#212529',
    lineHeight: 14,
  },
});


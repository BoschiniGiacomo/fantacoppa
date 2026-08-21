import React, { useState, useCallback } from 'react';
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
  Share,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { authService, getAppVersionInfo } from '../services/api';
import {
  openSystemNotificationSettings,
  getNotificationPermissionStatus,
} from '../services/notificationService';
import FollowTeamsPreferencesModal from '../components/FollowTeamsPreferencesModal';
import {
  peekStripTeamsMemory,
  readStripTeamsDisk,
} from '../services/matchesStripTeamsCache';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

const APP_VERSION = getAppVersionInfo();

function notificationStatusLabel(status) {
  switch (status) {
    case 'granted':
      return 'Attive';
    case 'provisional':
      return 'Provvisorie';
    case 'blocked':
      return 'Bloccate';
    case 'denied':
      return 'Disattive';
    default:
      return 'Sconosciuto';
  }
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout, refreshSession, token } = useAuth();
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
  const [notificationStatus, setNotificationStatus] = useState('unknown');
  const [followModalVisible, setFollowModalVisible] = useState(false);
  const [favoriteTeamsCount, setFavoriteTeamsCount] = useState(() => {
    const mem = peekStripTeamsMemory();
    return Array.isArray(mem) ? mem.filter((t) => Number(t?.is_heart) === 1).length : 0;
  });

  const refreshFavoriteTeamsCount = useCallback(async () => {
    const mem = peekStripTeamsMemory();
    if (Array.isArray(mem) && mem.length) {
      setFavoriteTeamsCount(mem.filter((t) => Number(t?.is_heart) === 1).length);
      return;
    }
    const disk = await readStripTeamsDisk();
    const list = Array.isArray(disk) ? disk : [];
    setFavoriteTeamsCount(list.filter((t) => Number(t?.is_heart) === 1).length);
  }, []);

  const refreshNotificationStatus = useCallback(async () => {
    const res = await getNotificationPermissionStatus();
    setNotificationStatus(res?.status || 'unknown');
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshSession?.().catch(() => {});
      refreshNotificationStatus().catch(() => {});
      refreshFavoriteTeamsCount().catch(() => {});
    }, [refreshSession, refreshNotificationStatus, refreshFavoriteTeamsCount])
  );

  const showToast = (text, type = 'error') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 2500);
  };

  // Livelli superuser: 1 = admin completo, 2 = gestione partite.
  const superuserLevel = Number(user?.is_superuser || 0);
  const canOpenSuperUserPanel = superuserLevel === 1;
  const canOpenMatchManagement = superuserLevel === 1 || superuserLevel === 2;
  const roleLabel =
    superuserLevel === 1 ? 'Super user' : superuserLevel === 2 ? 'Gestore partite' : null;
  const initial = String(user?.username || '?').trim().charAt(0).toUpperCase() || '?';
  const notifGranted = notificationStatus === 'granted' || notificationStatus === 'provisional';

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

  const handleInviteFriends = async () => {
    const storeUrl =
      Platform.OS === 'ios'
        ? 'https://apps.apple.com/us/app/fantacoppa/id6761119410'
        : 'https://play.google.com/store/apps/details?id=com.fantacoppa.app';
    const message =
      `Sto giocando a FantaCoppa — il fantacalcio della Coppa Montecavolo.\n\n` +
      `Scaricala e unisciti a me:\n${storeUrl}`;
    try {
      await Share.share({
        message,
        title: 'Invita a FantaCoppa',
      });
    } catch (error) {
      if (String(error?.message || '').toLowerCase().includes('cancel')) return;
      showToast('Impossibile aprire la condivisione');
    }
  };

  const handleOpenNotificationSettings = async () => {
    await openSystemNotificationSettings();
    // Al rientro dallo switch focus aggiorna; piccolo refresh dopo un attimo
    setTimeout(() => {
      refreshNotificationStatus().catch(() => {});
    }, 800);
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

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowChangePassword(false);
    } catch (error) {
      console.error('Error changing password:', error);
      const errorMessage =
        error.response?.data?.message || error.message || 'Errore durante il cambio password';
      showToast(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDeleteAccount = () => {
    navigation.navigate('DeleteAccount');
  };

  const renderPasswordField = ({
    label,
    value,
    onChangeText,
    placeholder,
    visible,
    onToggleVisible,
  }) => (
    <View style={styles.passwordField}>
      <Text style={styles.passwordLabel}>{label}</Text>
      <View style={styles.passwordInputWrap}>
        <TextInput
          style={styles.passwordInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#94a3b8"
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity onPress={onToggleVisible} style={styles.eyeButton} hitSlop={8}>
          <Ionicons
            name={visible ? 'eye-outline' : 'eye-off-outline'}
            size={20}
            color="#64748b"
          />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderMenuRow = ({
    icon,
    iconColor = '#667eea',
    iconBg = '#eef2ff',
    label,
    subtitle = null,
    statusLabel = null,
    statusOn = false,
    onPress,
    chevron = 'chevron-forward',
    danger = false,
    last = false,
  }) => (
    <TouchableOpacity
      style={[styles.menuRow, last && styles.menuRowLast]}
      onPress={onPress}
      activeOpacity={0.72}
    >
      <View style={[styles.menuIconTile, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={danger ? '#dc2626' : iconColor} />
      </View>
      <View style={styles.menuRowCopy}>
        <Text style={[styles.menuRowText, danger && styles.menuRowTextDanger]} numberOfLines={1}>
          {label}
        </Text>
        {subtitle ? (
          <Text
            style={[
              styles.menuRowSubtitle,
              statusLabel ? (statusOn ? styles.statusChipTextOn : styles.statusChipTextOff) : null,
            ]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name={chevron}
        size={18}
        color={danger ? '#fca5a5' : '#cbd5e1'}
      />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top, 12) + 12,
            paddingBottom: Math.max(insets.bottom, 16) + 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.heroCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.username} numberOfLines={1}>
            {user?.username || '—'}
          </Text>
          <Text style={styles.email} numberOfLines={2}>
            {user?.email || '—'}
          </Text>
          {roleLabel ? (
            <View style={styles.roleChip}>
              <Ionicons
                name={superuserLevel === 1 ? 'star' : 'football'}
                size={12}
                color="#4f46e5"
              />
              <Text style={styles.roleChipText}>{roleLabel}</Text>
            </View>
          ) : null}
        </View>

        {/* Account */}
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={[styles.card, showChangePassword && styles.cardOpen]}>
          <TouchableOpacity
            style={styles.accordionHeader}
            onPress={() => setShowChangePassword((v) => !v)}
            activeOpacity={0.75}
          >
            <View style={styles.menuIconTile}>
              <Ionicons name="key-outline" size={18} color="#667eea" />
            </View>
            <Text style={styles.menuRowText}>Cambia password</Text>
            <Ionicons
              name={showChangePassword ? 'chevron-up' : 'chevron-down'}
              size={18}
              color="#94a3b8"
            />
          </TouchableOpacity>

          {showChangePassword ? (
            <View style={styles.passwordBody}>
              {renderPasswordField({
                label: 'Password attuale',
                value: currentPassword,
                onChangeText: setCurrentPassword,
                placeholder: 'Inserisci password attuale',
                visible: showCurrentPassword,
                onToggleVisible: () => setShowCurrentPassword((v) => !v),
              })}
              {renderPasswordField({
                label: 'Nuova password',
                value: newPassword,
                onChangeText: setNewPassword,
                placeholder: 'Almeno 6 caratteri',
                visible: showNewPassword,
                onToggleVisible: () => setShowNewPassword((v) => !v),
              })}
              {renderPasswordField({
                label: 'Conferma nuova password',
                value: confirmPassword,
                onChangeText: setConfirmPassword,
                placeholder: 'Ripeti la nuova password',
                visible: showConfirmPassword,
                onToggleVisible: () => setShowConfirmPassword((v) => !v),
              })}
              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
                onPress={handleChangePassword}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Aggiorna password</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {/* Admin */}
        {(canOpenSuperUserPanel || canOpenMatchManagement) && (
          <>
            <Text style={styles.sectionLabel}>Amministrazione</Text>
            <View style={styles.card}>
              {canOpenSuperUserPanel
                ? renderMenuRow({
                    icon: 'shield-checkmark',
                    iconColor: '#a16207',
                    iconBg: '#fef9c3',
                    label: 'Super User',
                    onPress: () => navigation.navigate('SuperUser'),
                    last: !canOpenMatchManagement,
                  })
                : null}
              {canOpenMatchManagement
                ? renderMenuRow({
                    icon: 'football',
                    label: 'Gestione partite',
                    onPress: () => navigation.navigate('ManageMatches'),
                    last: true,
                  })
                : null}
            </View>
          </>
        )}

        {/* Preferenze */}
        <Text style={styles.sectionLabel}>Preferenze</Text>
        <View style={styles.card}>
          {renderMenuRow({
            icon: 'star',
            iconColor: '#ca8a04',
            iconBg: '#fefce8',
            label: 'Squadre preferite',
            subtitle:
              favoriteTeamsCount > 0
                ? `${favoriteTeamsCount} preferit${favoriteTeamsCount === 1 ? 'a' : 'e'} · notifiche`
                : 'Scegli squadre e notifiche',
            onPress: () => setFollowModalVisible(true),
          })}
          {renderMenuRow({
            icon: notifGranted ? 'notifications' : 'notifications-outline',
            iconColor: notifGranted ? '#15803d' : '#667eea',
            iconBg: notifGranted ? '#f0fdf4' : '#eef2ff',
            label: 'Notifiche',
            subtitle: notificationStatusLabel(notificationStatus),
            statusLabel: true,
            statusOn: notifGranted,
            chevron: 'open-outline',
            onPress: handleOpenNotificationSettings,
            last: true,
          })}
        </View>

        {/* Community / info */}
        <Text style={styles.sectionLabel}>Altro</Text>
        <View style={styles.card}>
          {renderMenuRow({
            icon: 'share-social-outline',
            label: 'Invita amici',
            subtitle: 'Condividi FantaCoppa',
            onPress: handleInviteFriends,
          })}
          <View style={[styles.menuRow, styles.menuRowLast]}>
            <View style={styles.menuIconTile}>
              <Ionicons name="information-circle-outline" size={18} color="#667eea" />
            </View>
            <View style={styles.menuRowCopy}>
              <Text style={styles.menuRowText}>Versione app</Text>
              <Text style={styles.menuRowSubtitle}>
                {APP_VERSION.name}
                {APP_VERSION.code ? ` · build ${APP_VERSION.code}` : ''}
              </Text>
            </View>
          </View>
        </View>

        {/* Zona rischio */}
        <Text style={styles.sectionLabel}>Account e sessione</Text>
        <View style={styles.card}>
          {renderMenuRow({
            icon: 'trash-outline',
            iconBg: '#fef2f2',
            label: 'Elimina account',
            chevron: 'open-outline',
            danger: true,
            onPress: handleOpenDeleteAccount,
          })}
          {renderMenuRow({
            icon: 'log-out-outline',
            iconBg: '#fef2f2',
            label: 'Esci',
            chevron: 'log-out-outline',
            danger: true,
            onPress: handleLogout,
            last: true,
          })}
        </View>
      </ScrollView>

      {toastMsg ? (
        <View
          style={[
            styles.toast,
            toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError,
            { bottom: Math.max(insets.bottom, 12) + 16 },
          ]}
        >
          <Ionicons
            name={toastMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'}
            size={20}
            color="#fff"
          />
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      ) : null}

      <Modal
        visible={!!confirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmModal(null)}
      >
        <TouchableOpacity
          style={styles.confirmOverlay}
          activeOpacity={1}
          onPress={() => setConfirmModal(null)}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
            style={styles.confirmBox}
          >
            <View style={styles.confirmIconWrap}>
              <Ionicons name="log-out-outline" size={26} color="#dc2626" />
            </View>
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
                style={[
                  styles.confirmButtonConfirm,
                  confirmModal?.destructive && styles.confirmButtonDestructive,
                ]}
                onPress={confirmModal?.onConfirm}
              >
                <Text
                  style={[
                    styles.confirmButtonConfirmText,
                    confirmModal?.destructive && styles.confirmButtonDestructiveText,
                  ]}
                >
                  {confirmModal?.confirmText}
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <FollowTeamsPreferencesModal
        visible={followModalVisible}
        onClose={() => setFollowModalVisible(false)}
        token={token}
        onSaved={() => {
          refreshFavoriteTeamsCount().catch(() => {});
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  heroCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ececec',
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 18,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 28,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  avatarText: {
    fontSize: 34,
    fontWeight: '800',
    color: '#667eea',
  },
  username: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  email: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '500',
    color: '#64748b',
    textAlign: 'center',
  },
  roleChip: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  roleChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4f46e5',
  },
  sectionLabel: {
    marginBottom: 8,
    marginLeft: 2,
    fontSize: 12,
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ececec',
    marginBottom: 16,
    overflow: 'hidden',
  },
  cardOpen: {
    borderColor: '#c7d2fe',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  menuRowLast: {
    borderBottomWidth: 0,
  },
  menuIconTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuRowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  menuRowText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  menuRowSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94a3b8',
  },
  menuRowTextDanger: {
    color: '#dc2626',
  },
  statusChipTextOn: {
    color: '#15803d',
    fontWeight: '700',
  },
  statusChipTextOff: {
    color: '#64748b',
    fontWeight: '700',
  },
  passwordBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8edf5',
    paddingTop: 12,
    gap: 12,
  },
  passwordField: {
    gap: 6,
  },
  passwordLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  passwordInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 11,
    fontSize: 15,
    color: '#0f172a',
  },
  eyeButton: {
    padding: 4,
  },
  primaryBtn: {
    marginTop: 4,
    backgroundColor: '#667eea',
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: {
    opacity: 0.7,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  toastSuccess: {
    backgroundColor: '#16a34a',
  },
  toastError: {
    backgroundColor: '#dc2626',
  },
  toastText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  confirmBox: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#ececec',
  },
  confirmIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 6,
  },
  confirmMessage: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
    marginBottom: 18,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmButtonCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  confirmButtonCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  confirmButtonConfirm: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#667eea',
    alignItems: 'center',
  },
  confirmButtonConfirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  confirmButtonDestructive: {
    backgroundColor: '#dc2626',
  },
  confirmButtonDestructiveText: {
    color: '#fff',
  },
});

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  Modal,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  DeviceEventEmitter,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOnboarding } from '../context/OnboardingContext';
import { leagueService } from '../services/api';
import { hideLeague, showDashboardError, JOIN_REQUESTS_CHANGED } from '../utils/dashboardEvents';

export default function LeagueHamburgerMenu({
  leagueId,
  navigation,
  isAdmin,
  userRole,
  isLinkedLeague,
  linkedLeagueName,
  isOfficial = false,
  leagueName = '',
}) {
  const [menuVisible, setMenuVisible] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const [deleteStep, setDeleteStep] = useState(0); // 0 = chiuso, 1 = prima conferma, 2 = seconda
  const [deletingLeague, setDeletingLeague] = useState(false);
  const insets = useSafeAreaInsets();
  const { badges, hasHamburgerBadge, updateAutoDetect } = useOnboarding();
  const isSuperuserViewer = userRole === 'superuser_viewer';
  const canViewFullMenu = isAdmin || isSuperuserViewer;
  const displayLeagueName = String(leagueName || '').trim() || 'questa lega';

  const refreshJoinRequestsBadge = useCallback(async () => {
    if (!isAdmin || !leagueId) {
      updateAutoDetect({ pendingJoinRequests: 0 });
      return;
    }
    try {
      const res = await leagueService.getJoinRequests(leagueId);
      const n = Array.isArray(res?.data?.requests) ? res.data.requests.length : 0;
      updateAutoDetect({ pendingJoinRequests: n });
    } catch (_) {
      /* ignore */
    }
  }, [isAdmin, leagueId, updateAutoDetect]);

  useEffect(() => {
    refreshJoinRequestsBadge();
    const sub = DeviceEventEmitter.addListener(JOIN_REQUESTS_CHANGED, (payload) => {
      if (Number(payload?.leagueId) !== Number(leagueId)) return;
      const n = Math.max(0, Number(payload?.count) || 0);
      updateAutoDetect({ pendingJoinRequests: n });
    });
    return () => sub.remove();
  }, [leagueId, refreshJoinRequestsBadge, updateAutoDetect]);

  // Mappa id menu item -> chiave badge
  const menuBadgeMap = {
    market: badges.market,
    squad: badges.squad,
    'settings-squad': badges.settings_team,
    'settings-users': badges.settings_users,
  };
  const hasSettingsBadge = !!(badges.settings_team || badges.settings_users);
  const showHamburgerBang = !!(hasHamburgerBadge || badges.settings_users);

  // Costruisci il submenu in base al ruolo
  const settingsSubMenu = [];

  // Admin e superuser observer vedono menu completo impostazioni.
  if (canViewFullMenu) {
    settingsSubMenu.push({
      id: 'settings-general',
      label: 'Generali',
      icon: 'options-outline',
      screen: 'Settings',
      params: { leagueId, section: 'general' },
    });
    // Nascondi Gestione Squadre e Calendario per leghe collegate
    if (!isLinkedLeague) {
      settingsSubMenu.push({
        id: 'settings-teams',
        label: 'Gestione Squadre',
        icon: 'shirt-outline',
        screen: 'TeamManagement',
        params: { leagueId },
      });
      if (isAdmin) {
        settingsSubMenu.push({
          id: 'settings-injuries',
          label: 'Gestione Infortuni',
          icon: 'medkit-outline',
          screen: 'InjuryManagement',
          params: { leagueId },
        });
      }
      settingsSubMenu.push({
        id: 'settings-calendar',
        label: 'Gestione Calendario',
        icon: 'calendar-outline',
        screen: 'CalendarManagement',
        params: { leagueId },
      });
    }
    settingsSubMenu.push({
      id: 'settings-market',
      label: 'Gestione Mercato',
      icon: 'cart-outline',
      screen: 'Settings',
      params: { leagueId, section: 'market' },
    });
    settingsSubMenu.push({
      id: 'settings-calculate',
      label: 'Calcola Giornata',
      icon: 'calculator-outline',
      screen: 'Settings',
      params: { leagueId, section: 'calculate' },
    });
    settingsSubMenu.push({
      id: 'settings-users',
      label: 'Gestione utenti',
      icon: 'people-outline',
      screen: 'UserManagement',
      params: { leagueId, userRole: userRole || 'admin' },
    });
  } else {
    settingsSubMenu.push({
      id: 'settings-leave',
      label: 'Abbandona lega',
      icon: 'exit-outline',
      screen: 'UserManagement',
      params: { leagueId, userRole: 'user' },
    });
  }

  // In modalità osservatore superuser non ha senso mostrare profilo squadra.
  if (!isSuperuserViewer) {
    settingsSubMenu.push({
      id: 'settings-squad',
      label: 'Profilo squadra',
      icon: 'person-outline',
      screen: 'Settings',
      params: { leagueId, section: 'team' },
    });
  }

  // Elimina lega: solo admin, non ufficiali (quelle solo da superutente).
  if (isAdmin && !isSuperuserViewer && !isOfficial) {
    settingsSubMenu.push({
      id: 'settings-delete-league',
      label: 'Elimina lega',
      icon: 'trash-outline',
      action: 'delete-league',
      destructive: true,
    });
  }

  const menuItems = [
    {
      id: 'calendar',
      label: 'Calendario',
      icon: 'calendar-outline',
      screen: 'Calendar',
      params: { leagueId },
    },
    {
      id: 'market',
      label: 'Mercato',
      icon: 'bag-outline',
      screen: 'Market',
      params: { leagueId },
    },
    {
      id: 'squad',
      label: 'Mia Rosa',
      icon: 'people-circle-outline',
      screen: 'Squad',
      params: { leagueId },
    },
    ...((canViewFullMenu || userRole === 'pagellatore') && !isLinkedLeague
      ? [{
          id: 'insert-votes',
          label: 'Inserisci Voti',
          icon: 'pencil-outline',
          screen: 'InsertVotes',
          params: { leagueId },
        }]
      : []),
    ...((isAdmin || userRole === 'pagellatore')
      ? [{
          id: 'statistics',
          label: 'Statistiche',
          icon: 'stats-chart-outline',
          screen: 'LeagueStatistics',
          params: { leagueId },
        }]
      : []),
    {
      id: 'dashboard',
      label: 'Home',
      icon: 'home-outline',
      screen: 'MainTabs',
      params: { screen: 'Dashboard' },
    },
  ];

  const handleMenuItemPress = (item) => {
    setMenuVisible(false);
    if (item.screen === 'MainTabs') {
      navigation.navigate('MainTabs', item.params);
    } else {
      navigation.navigate(item.screen, item.params);
    }
  };

  const handleSettingsPress = () => {
    setSettingsExpanded(!settingsExpanded);
  };

  const handleSubMenuItemPress = (item) => {
    if (item.action === 'delete-league') {
      setMenuVisible(false);
      setDeleteStep(1);
      return;
    }
    setMenuVisible(false);
    if (item.screen === 'MainTabs') {
      navigation.navigate('MainTabs', item.params);
    } else {
      navigation.navigate(item.screen, item.params);
    }
  };

  const closeDeleteFlow = () => {
    if (deletingLeague) return;
    setDeleteStep(0);
  };

  const confirmDeleteLeague = async () => {
    if (deletingLeague) return;
    setDeletingLeague(true);
    try {
      await leagueService.deleteLeague(leagueId);
      setDeleteStep(0);
      hideLeague(leagueId, `Lega "${displayLeagueName}" eliminata.`);
      navigation.navigate('MainTabs', { screen: 'Dashboard' });
    } catch (error) {
      console.error('Error deleting league:', error);
      setDeleteStep(0);
      showDashboardError(
        error?.response?.data?.message
          || error?.response?.data?.error
          || 'Errore durante l\'eliminazione della lega'
      );
      navigation.navigate('MainTabs', { screen: 'Dashboard' });
    } finally {
      setDeletingLeague(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.hamburgerButton}
        onPress={() => {
          setMenuVisible(true);
          refreshJoinRequestsBadge();
        }}
      >
        <Ionicons name="menu" size={28} color="#667eea" />
        {showHamburgerBang && (
          <View style={styles.hamburgerBadge}>
            <Text style={styles.hamburgerBadgeText}>!</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal
        visible={menuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View
            style={[
              styles.menuContainer,
              {
                paddingTop: insets.top + 0,
                paddingBottom: insets.bottom + 0,
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.menuHeader}>
              <Text style={styles.menuTitle}>Menu</Text>
              <TouchableOpacity
                onPress={() => setMenuVisible(false)}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollViewContent}
              showsVerticalScrollIndicator={true}
            >
              {isLinkedLeague && (
                <View style={{
                  backgroundColor: '#eef0ff',
                  borderRadius: 8,
                  padding: 12,
                  marginTop: 12,
                  marginBottom: 4,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
                >
                  <Ionicons name="ribbon" size={18} color="#667eea" style={{ marginRight: 8 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, color: '#667eea', fontWeight: '600' }}>
                      Lega collegata{linkedLeagueName ? ` a ${linkedLeagueName}` : ''}
                    </Text>
                    <Text style={{ fontSize: 11, color: '#8890b5', marginTop: 2 }}>
                      Giocatori, quotazioni e voti dalla lega ufficiale
                    </Text>
                  </View>
                </View>
              )}
              <View style={styles.menuItems}>
                <View>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={handleSettingsPress}
                  >
                    <View style={{ position: 'relative' }}>
                      <Ionicons name="settings-outline" size={24} color="#667eea" />
                      {hasSettingsBadge && (
                        <View style={styles.menuItemBadge}>
                          <Text style={styles.menuItemBadgeText}>!</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.menuItemText}>Impostazioni</Text>
                    <Ionicons
                      name={settingsExpanded ? 'chevron-down' : 'chevron-forward'}
                      size={20}
                      color="#ccc"
                    />
                  </TouchableOpacity>

                  {settingsExpanded && (
                    <View style={styles.subMenuContainer}>
                      {settingsSubMenu.map((item) => (
                        <TouchableOpacity
                          key={item.id}
                          style={styles.subMenuItem}
                          onPress={() => handleSubMenuItemPress(item)}
                        >
                          <View style={{ position: 'relative' }}>
                            <Ionicons
                              name={item.icon}
                              size={20}
                              color={item.destructive ? '#e53935' : '#667eea'}
                            />
                            {menuBadgeMap[item.id] && (
                              <View style={styles.subMenuItemBadge}>
                                <Text style={styles.menuItemBadgeText}>!</Text>
                              </View>
                            )}
                          </View>
                          <Text
                            style={[
                              styles.subMenuItemText,
                              item.destructive && styles.subMenuItemTextDanger,
                            ]}
                          >
                            {item.label}
                          </Text>
                          <Ionicons name="chevron-forward" size={18} color="#ccc" />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                {menuItems.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.menuItem}
                    onPress={() => handleMenuItemPress(item)}
                  >
                    <View style={{ position: 'relative' }}>
                      <Ionicons name={item.icon} size={24} color="#667eea" />
                      {menuBadgeMap[item.id] && (
                        <View style={styles.menuItemBadge}>
                          <Text style={styles.menuItemBadgeText}>!</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.menuItemText}>{item.label}</Text>
                    <Ionicons name="chevron-forward" size={20} color="#ccc" />
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Doppia conferma eliminazione lega */}
      <Modal
        visible={deleteStep > 0}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteFlow}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmIconWrap}>
              <Ionicons name="warning" size={40} color="#e53935" />
            </View>
            <Text style={styles.confirmTitle}>
              {deleteStep === 1 ? 'Eliminare la lega?' : 'Conferma definitiva'}
            </Text>
            <Text style={styles.confirmMessage}>
              {deleteStep === 1
                ? `Stai per eliminare definitivamente "${displayLeagueName}". Verranno cancellati membri, rose, formazioni, risultati e impostazioni.`
                : `Ultima conferma: l'eliminazione di "${displayLeagueName}" è irreversibile. Vuoi procedere?`}
            </Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={[styles.confirmBtn, styles.confirmBtnCancel]}
                onPress={closeDeleteFlow}
                disabled={deletingLeague}
              >
                <Text style={styles.confirmBtnCancelText}>Annulla</Text>
              </TouchableOpacity>
              {deleteStep === 1 ? (
                <TouchableOpacity
                  style={[styles.confirmBtn, styles.confirmBtnDanger]}
                  onPress={() => setDeleteStep(2)}
                >
                  <Text style={styles.confirmBtnDangerText}>Continua</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.confirmBtn, styles.confirmBtnDanger]}
                  onPress={confirmDeleteLeague}
                  disabled={deletingLeague}
                >
                  {deletingLeague ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.confirmBtnDangerText} numberOfLines={1}>
                      Elimina
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  hamburgerButton: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 1000,
    padding: 8,
    backgroundColor: '#fff',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  hamburgerBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#e53935',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  hamburgerBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
    lineHeight: 11,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flexDirection: 'row',
  },
  menuContainer: {
    width: '80%',
    maxWidth: 320,
    backgroundColor: '#fff',
    height: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  menuTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    paddingBottom: 20,
  },
  menuItems: {
    paddingTop: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  menuItemText: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    marginLeft: 16,
  },
  menuItemBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#e53935',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  subMenuContainer: {
    backgroundColor: '#f8f9fa',
    paddingLeft: 20,
  },
  subMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  subMenuItemText: {
    flex: 1,
    fontSize: 15,
    color: '#555',
    marginLeft: 16,
  },
  subMenuItemTextDanger: {
    color: '#e53935',
  },
  subMenuItemBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#e53935',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 22,
  },
  confirmIconWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  confirmTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1f2937',
    textAlign: 'center',
    marginBottom: 10,
  },
  confirmMessage: {
    fontSize: 15,
    color: '#4b5563',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  confirmBtnCancel: {
    backgroundColor: '#f3f4f6',
  },
  confirmBtnCancelText: {
    color: '#374151',
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  confirmBtnDanger: {
    backgroundColor: '#e53935',
  },
  confirmBtnDangerText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
    textAlign: 'center',
  },
});

import React, { useState } from 'react';
import { View, TouchableOpacity, Text, Modal, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOnboarding } from '../context/OnboardingContext';

export default function LeagueHamburgerMenu({ leagueId, navigation, isAdmin, userRole, isLinkedLeague, linkedLeagueName }) {
  const [menuVisible, setMenuVisible] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const insets = useSafeAreaInsets();
  const { badges, hasHamburgerBadge } = useOnboarding();

  // Mappa id menu item -> chiave badge
  const menuBadgeMap = {
    'market': badges.market,
    'squad': badges.squad,
    'settings-squad': badges.settings_team,
  };

  // Costruisci il submenu in base al ruolo
  const settingsSubMenu = [];
  
  // Solo gli admin vedono "Generali"
  if (isAdmin) {
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
      params: { leagueId, userRole: 'admin' },
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
  
  settingsSubMenu.push({
    id: 'settings-squad',
    label: 'Profilo squadra',
    icon: 'person-outline',
    screen: 'Settings',
    params: { leagueId, section: 'team' },
  });

  const menuItems = [
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
    // Mostra "Inserisci Voti" solo per admin e pagellatore, e nascondi per leghe collegate
    ...((isAdmin || userRole === 'pagellatore') && !isLinkedLeague ? [{
      id: 'insert-votes',
      label: 'Inserisci Voti',
      icon: 'pencil-outline',
      screen: 'InsertVotes',
      params: { leagueId },
    }] : []),
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
    setMenuVisible(false);
    // Non chiudere la sezione Impostazioni, rimane aperta
    if (item.screen === 'MainTabs') {
      navigation.navigate('MainTabs', item.params);
    } else {
      navigation.navigate(item.screen, item.params);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.hamburgerButton}
        onPress={() => setMenuVisible(true)}
      >
        <Ionicons name="menu" size={28} color="#667eea" />
        {hasHamburgerBadge && (
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
                paddingBottom: insets.bottom + 0
              }
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
                }}>
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
              {/* Impostazioni con sotto-menu */}
              <View>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={handleSettingsPress}
                >
                  <Ionicons name="settings-outline" size={24} color="#667eea" />
                  <Text style={styles.menuItemText}>Impostazioni</Text>
                  <Ionicons 
                    name={settingsExpanded ? "chevron-down" : "chevron-forward"} 
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
                          <Ionicons name={item.icon} size={20} color="#667eea" />
                          {menuBadgeMap[item.id] && (
                            <View style={styles.subMenuItemBadge}>
                              <Text style={styles.menuItemBadgeText}>!</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.subMenuItemText}>{item.label}</Text>
                        <Ionicons name="chevron-forward" size={18} color="#ccc" />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* Altri menu items */}
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  menuContainer: {
    backgroundColor: '#fff',
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    paddingHorizontal: 20,
    width: '85%',
    maxWidth: 350,
    height: '100%',
    marginRight: 'auto',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
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
    flexGrow: 1,
  },
  menuItems: {
    marginTop: 10,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  menuItemText: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    marginLeft: 16,
  },
  subMenuContainer: {
    backgroundColor: '#f8f9fa',
    paddingLeft: 20,
    paddingVertical: 8,
  },
  subMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  subMenuItemText: {
    flex: 1,
    fontSize: 15,
    color: '#555',
    marginLeft: 16,
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
    zIndex: 10,
  },
  menuItemBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
  },
  subMenuItemBadge: {
    position: 'absolute',
    top: -3,
    right: -5,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#e53935',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});


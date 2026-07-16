import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useNavigationState } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useOnboarding } from '../context/OnboardingContext';

export default function LeagueBottomMenu({ leagueId, league, navigation, insets = { bottom: 0 }, activeTab }) {
  const navigationState = useNavigationState((state) => state);

  const getActiveRouteName = () => {
    if (!navigationState) return null;

    const findActiveRoute = (state) => {
      if (!state || !state.routes) return null;
      const route = state.routes[state.index];
      if (route.state) {
        return findActiveRoute(route.state);
      }
      return route.name;
    };

    return findActiveRoute(navigationState);
  };

  const activeRoute = getActiveRouteName();
  const { badges } = useOnboarding();

  const BadgeDot = () => (
    <View style={styles.badgeDot}>
      <Text style={styles.badgeDotText}>!</Text>
    </View>
  );

  const isActive = (screenName) => {
    if (activeTab) {
      const tabMap = {
        home: 'Dashboard',
        squad: 'Squadre',
        calendar: 'Calendario',
        standings: 'Classifica',
        formation: 'Formazione',
      };
      return tabMap[activeTab] === screenName;
    }

    const routeMap = {
      Dashboard: 'League',
      Squadre: 'Teams',
      Calendario: 'Calendar',
      Classifica: 'Standings',
      Formazione: 'Formation',
      League: 'League',
    };

    const targetRoute = routeMap[screenName];
    if (screenName === 'Squadre') {
      return activeRoute === 'Teams' || activeRoute === 'TeamDetail';
    }
    return activeRoute === targetRoute
      || (screenName === 'League' && activeRoute === 'League');
  };

  const isAutoLineupLeague =
    league != null && (Number(league.auto_lineup_mode) === 1 || league.auto_lineup_mode === true);
  const isManualLineupLeague = league != null && !isAutoLineupLeague;

  const handleTabPress = (screenName) => {
    if (screenName === 'Squadre') {
      if (activeRoute !== 'Teams') {
        navigation.navigate('Teams', { leagueId });
      }
    } else if (screenName === 'Classifica') {
      navigation.navigate('Standings', { leagueId });
    } else if (screenName === 'Formazione') {
      navigation.navigate('Formation', { leagueId });
    } else if (screenName === 'Dashboard') {
      navigation.navigate('League', { leagueId });
    }
  };

  const handleExitLeague = () => {
    navigation.navigate('MainTabs', { screen: 'Dashboard' });
  };

  const renderTab = ({ key, label, onPress, icon, iconActive, active, badge, muted }) => {
    const color = muted ? '#9e9e9e' : (active ? '#667eea' : '#8b95a8');
    return (
      <TouchableOpacity
        key={key}
        style={styles.tabBtn}
        onPress={onPress}
        activeOpacity={muted ? 1 : 0.7}
        disabled={!!muted && !onPress}
      >
        <View style={styles.iconWrap}>
          <Ionicons name={active && iconActive ? iconActive : icon} size={23} color={color} />
          {badge ? <BadgeDot /> : null}
        </View>
        <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      <View style={styles.tabsCluster}>
        {renderTab({
          key: 'dashboard',
          label: 'Dashboard',
          onPress: () => handleTabPress('Dashboard'),
          icon: 'home-outline',
          iconActive: 'home',
          active: isActive('Dashboard'),
          badge: badges.dashboard,
        })}
        {renderTab({
          key: 'squadre',
          label: 'Squadre',
          onPress: () => handleTabPress('Squadre'),
          icon: 'people-outline',
          iconActive: 'people',
          active: isActive('Squadre'),
        })}
        {renderTab({
          key: 'classifica',
          label: 'Classifica',
          onPress: () => handleTabPress('Classifica'),
          icon: 'trophy-outline',
          iconActive: 'trophy',
          active: isActive('Classifica'),
        })}
        {isManualLineupLeague ? (
          renderTab({
            key: 'formazione',
            label: 'Formazione',
            onPress: () => handleTabPress('Formazione'),
            icon: 'football-outline',
            iconActive: 'football',
            active: isActive('Formazione'),
            badge: badges.formation,
          })
        ) : isAutoLineupLeague ? (
          <View style={styles.tabBtn} accessibilityRole="text" accessibilityLabel="Formazione gestita in automatico dalla lega">
            <View style={styles.iconWrap}>
              <Ionicons name="flash-outline" size={23} color="#9e9e9e" />
            </View>
            <Text style={[styles.tabLabel, { color: '#9e9e9e' }]}>Auto</Text>
          </View>
        ) : (
          <View style={[styles.tabBtn, { opacity: 0.42 }]} accessibilityRole="text" accessibilityLabel="Caricamento informazioni lega">
            <View style={styles.iconWrap}>
              <Ionicons name="football-outline" size={23} color="#8b95a8" />
            </View>
            <Text style={[styles.tabLabel, { color: '#8b95a8' }]}>Formazione</Text>
          </View>
        )}
      </View>

      <View style={styles.exitDivider} />

      <TouchableOpacity
        style={styles.exitBtn}
        onPress={handleExitLeague}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Esci dalla lega"
      >
        <View style={styles.exitIconWrap}>
          <Ionicons name="log-out-outline" size={22} color="#dc3545" />
        </View>
        <Text style={styles.exitLabel}>Esci</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    paddingTop: 8,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 6,
    minHeight: 60,
  },
  tabsCluster: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingLeft: 2,
    paddingRight: 2,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
    minWidth: 0,
  },
  iconWrap: {
    position: 'relative',
    width: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 3,
  },
  badgeDot: {
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
  badgeDotText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  exitDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: 6,
    marginHorizontal: 2,
    backgroundColor: '#e2e8f0',
  },
  exitBtn: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
    marginRight: 2,
  },
  exitIconWrap: {
    width: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#dc3545',
    marginTop: 3,
  },
});

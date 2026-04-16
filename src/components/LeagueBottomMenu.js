import React from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import { useNavigationState } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useOnboarding } from '../context/OnboardingContext';

export default function LeagueBottomMenu({ leagueId, league, navigation, insets = { bottom: 0 }, activeTab }) {
  // Ottieni lo stato della navigazione per capire quale schermata è attiva
  const navigationState = useNavigationState(state => state);
  
  // Determina quale schermata è attualmente attiva
  const getActiveRouteName = () => {
    if (!navigationState) return null;
    
    // Naviga nello stato per trovare la route attiva
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

  // Badge dot component
  const BadgeDot = () => (
    <View style={{
      position: 'absolute', top: -4, right: -6, width: 16, height: 16,
      borderRadius: 8, backgroundColor: '#e53935',
      alignItems: 'center', justifyContent: 'center', zIndex: 10,
    }}>
      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>!</Text>
    </View>
  );

  // Funzione per determinare se un tab è attivo
  const isActive = (screenName) => {
    // Se activeTab è passato come prop, usalo
    if (activeTab) {
      const tabMap = {
        'home': 'Dashboard',
        'squad': 'Squadre',
        'calendar': 'Calendario',
        'standings': 'Classifica',
        'formation': 'Formazione',
      };
      return tabMap[activeTab] === screenName;
    }
    
    const routeMap = {
      'Dashboard': 'League', // Dashboard punta alla schermata League (dettagli lega)
      'Squadre': 'Teams',
      'Calendario': 'Calendar',
      'Classifica': 'Standings',
      'Formazione': 'Formation',
      'League': 'League', // La schermata League stessa
    };
    
    const targetRoute = routeMap[screenName];
    // Squadre è attivo anche quando siamo in TeamDetail
    if (screenName === 'Squadre') {
      return activeRoute === 'Teams' || activeRoute === 'TeamDetail';
    }
    return activeRoute === targetRoute || 
           (screenName === 'League' && activeRoute === 'League');
  };
  
  const handleTabPress = (screenName) => {
    if (screenName === 'Squadre') {
      // Se non siamo già in Teams, vai a Teams (incluso se siamo in TeamDetail)
      if (activeRoute !== 'Teams') {
        navigation.navigate('Teams', { leagueId });
      }
    } else if (screenName === 'Calendario') {
      navigation.navigate('Calendar', { leagueId });
    } else if (screenName === 'Classifica') {
      navigation.navigate('Standings', { leagueId });
    } else if (screenName === 'Formazione') {
      navigation.navigate('Formation', { leagueId });
    } else if (screenName === 'Dashboard') {
      // Dashboard porta alla schermata di dettagli della lega
      navigation.navigate('League', { leagueId });
    }
  };

  return (
    <View style={{ 
      position: 'absolute', 
      bottom: 0, 
      left: 0, 
      right: 0,
      backgroundColor: '#fff',
      borderTopWidth: 1,
      borderTopColor: '#e0e0e0',
      paddingBottom: insets.bottom,
      paddingTop: 8,
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 5,
      minHeight: 60,
    }}>
      <TouchableOpacity 
        style={{ alignItems: 'center', flex: 1 }}
        onPress={() => handleTabPress('Dashboard')}
      >
        <View style={{ position: 'relative' }}>
          <Ionicons 
            name={isActive('Dashboard') ? "home" : "home-outline"} 
            size={24} 
            color={isActive('Dashboard') ? "#667eea" : "gray"} 
          />
          {badges.dashboard && <BadgeDot />}
        </View>
        <Text style={{ fontSize: 10, color: isActive('Dashboard') ? '#667eea' : 'gray', marginTop: 4 }}>Dashboard</Text>
      </TouchableOpacity>
      <TouchableOpacity 
        style={{ alignItems: 'center', flex: 1 }}
        onPress={() => handleTabPress('Squadre')}
      >
        <Ionicons 
          name={isActive('Squadre') ? "people" : "people-outline"} 
          size={24} 
          color={isActive('Squadre') ? "#667eea" : "gray"} 
        />
        <Text style={{ fontSize: 10, color: isActive('Squadre') ? '#667eea' : 'gray', marginTop: 4 }}>Squadre</Text>
      </TouchableOpacity>
      <TouchableOpacity 
        style={{ alignItems: 'center', flex: 1 }}
        onPress={() => handleTabPress('Calendario')}
      >
        <Ionicons 
          name={isActive('Calendario') ? "calendar" : "calendar-outline"} 
          size={24} 
          color={isActive('Calendario') ? "#667eea" : "gray"} 
        />
        <Text style={{ fontSize: 10, color: isActive('Calendario') ? '#667eea' : 'gray', marginTop: 4 }}>Calendario</Text>
      </TouchableOpacity>
      <TouchableOpacity 
        style={{ alignItems: 'center', flex: 1 }}
        onPress={() => handleTabPress('Classifica')}
      >
        <Ionicons 
          name={isActive('Classifica') ? "trophy" : "trophy-outline"} 
          size={24} 
          color={isActive('Classifica') ? "#667eea" : "gray"} 
        />
        <Text style={{ fontSize: 10, color: isActive('Classifica') ? '#667eea' : 'gray', marginTop: 4 }}>Classifica</Text>
      </TouchableOpacity>
      {league && league.auto_lineup_mode === 0 && (
        <TouchableOpacity 
          style={{ alignItems: 'center', flex: 1 }}
          onPress={() => handleTabPress('Formazione')}
        >
          <View style={{ position: 'relative' }}>
            <Ionicons 
              name={isActive('Formazione') ? "football" : "football-outline"} 
              size={24} 
              color={isActive('Formazione') ? "#667eea" : "gray"} 
            />
            {badges.formation && <BadgeDot />}
          </View>
          <Text style={{ fontSize: 10, color: isActive('Formazione') ? '#667eea' : 'gray', marginTop: 4 }}>Formazione</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}


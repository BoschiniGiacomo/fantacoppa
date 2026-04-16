import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// Context
import { AuthProvider, useAuth } from './src/context/AuthContext';

// Screens
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import LeaguesScreen from './src/screens/LeaguesScreen';
import LeagueScreen from './src/screens/LeagueScreen';
import CreateLeagueScreen from './src/screens/CreateLeagueScreen';
import SearchLeaguesScreen from './src/screens/SearchLeaguesScreen';
import FormationScreen from './src/screens/FormationScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import MatchesScreen from './src/screens/MatchesScreen';
import MatchDetailScreen from './src/screens/MatchDetailScreen';
import ManageMatchesScreen from './src/screens/ManageMatchesScreen';
import DeleteAccountScreen from './src/screens/DeleteAccountScreen';
import TeamsScreen from './src/screens/TeamsScreen';
import TeamDetailScreen from './src/screens/TeamDetailScreen';
import PlayerStatsScreen from './src/screens/PlayerStatsScreen';
import MarketScreen from './src/screens/MarketScreen';
import SquadScreen from './src/screens/SquadScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import StandingsScreen from './src/screens/StandingsScreen';
import UserManagementScreen from './src/screens/UserManagementScreen';
import SuperUserScreen from './src/screens/SuperUserScreen';
import TeamManagementScreen from './src/screens/TeamManagementScreen';
import TeamPlayersScreen from './src/screens/TeamPlayersScreen';
import CalendarManagementScreen from './src/screens/CalendarManagementScreen';
import InsertVotesScreen from './src/screens/InsertVotesScreen';
import LiveScoresScreen from './src/screens/LiveScoresScreen';
import UpdateRequiredScreen from './src/screens/UpdateRequiredScreen';

// Components
import LeagueHamburgerMenu from './src/components/LeagueHamburgerMenu';
import LeagueBottomMenu from './src/components/LeagueBottomMenu';
import { OnboardingProvider } from './src/context/OnboardingContext';
import { leagueService } from './src/services/api';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Wrapper generico per tutte le schermate dentro una lega
function withLeagueWrapper(ScreenComponent) {
  return function LeagueWrapper({ route, navigation }) {
    const { leagueId } = route.params || {};
    const insets = useSafeAreaInsets();
    const [league, setLeague] = useState(null);

    useEffect(() => {
      if (leagueId) {
        leagueService.getById(leagueId)
          .then(res => {
            const leagueData = Array.isArray(res.data) ? res.data[0] : res.data;
            setLeague(leagueData);
          })
          .catch(() => {});
      }
    }, [leagueId]);

    return (
      <OnboardingProvider leagueId={leagueId}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={{ flex: 1 }}>
            <LeagueHamburgerMenu leagueId={leagueId} navigation={navigation} isAdmin={league?.role === 'admin'} userRole={league?.role} isLinkedLeague={!!league?.linked_to_league_id} linkedLeagueName={league?.linked_league_name} />
            <ScreenComponent route={route} navigation={navigation} />
            <LeagueBottomMenu leagueId={leagueId} league={league} navigation={navigation} insets={insets} />
          </View>
        </SafeAreaView>
      </OnboardingProvider>
    );
  };
}

// Wrapper pre-costruiti per ogni screen
const LeagueScreenWrapped = withLeagueWrapper(LeagueScreen);
const TeamsScreenWrapped = withLeagueWrapper(TeamsScreen);
const MarketScreenWrapped = withLeagueWrapper(MarketScreen);
const SquadScreenWrapped = withLeagueWrapper(SquadScreen);
const CalendarScreenWrapped = withLeagueWrapper(CalendarScreen);
const StandingsScreenWrapped = withLeagueWrapper(StandingsScreen);
const TeamDetailScreenWrapped = withLeagueWrapper(TeamDetailScreen);
const InsertVotesScreenWrapped = withLeagueWrapper(InsertVotesScreen);
const FormationScreenWrapped = withLeagueWrapper(FormationScreen);

// Tab Navigator per le schermate principali
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === 'Partite') {
            return <MaterialCommunityIcons name="soccer-field" size={size} color={color} />;
          }

          if (route.name === 'Dashboard') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Leghe') {
            iconName = focused ? 'trophy' : 'trophy-outline';
          } else if (route.name === 'Profilo') {
            iconName = focused ? 'person' : 'person-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#667eea',
        tabBarInactiveTintColor: 'gray',
        headerShown: false,
      })}
    >
      <Tab.Screen 
        name="Dashboard" 
        component={DashboardScreen}
        options={{ title: 'Home' }}
      />
      <Tab.Screen name="Leghe" component={LeaguesScreen} />
      <Tab.Screen name="Partite" component={MatchesScreen} />
      <Tab.Screen name="Profilo" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// Stack Navigator principale
function AppNavigator() {
  const { user, loading, updateRequiredInfo } = useAuth();
  const [bootstrapTimedOut, setBootstrapTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setBootstrapTimedOut(true), 10000);
    return () => clearTimeout(timer);
  }, []);

  if (updateRequiredInfo) {
    return <UpdateRequiredScreen updateInfo={updateRequiredInfo} />;
  }

  if (loading && !bootstrapTimedOut) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#667eea" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <>
            <Stack.Screen name="MainTabs" component={MainTabs} />
            <Stack.Screen 
              name="League" 
              component={LeagueScreenWrapped}
              options={{ headerShown: false }}
            />
            <Stack.Screen 
              name="CreateLeague" 
              component={CreateLeagueScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen 
              name="SearchLeagues" 
              component={SearchLeaguesScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen 
              name="Teams" 
              component={TeamsScreenWrapped}
              options={{ headerShown: false }}
            />
                <Stack.Screen 
                  name="TeamDetail" 
                  component={TeamDetailScreenWrapped}
                  options={{ headerShown: false }}
                />
            <Stack.Screen 
              name="Formation" 
              component={FormationScreenWrapped}
              options={{ headerShown: false }}
            />
            <Stack.Screen 
              name="Market"
              component={MarketScreenWrapped}
              options={{ headerShown: false }}
            />
            <Stack.Screen 
              name="Squad"
              component={SquadScreenWrapped}
              options={{ headerShown: false }}
            />
            <Stack.Screen 
              name="Settings"
              component={SettingsScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="DeleteAccount"
              component={DeleteAccountScreen}
              options={{ headerShown: false }}
            />
                <Stack.Screen 
                  name="Calendar"
                  component={CalendarScreenWrapped}
                  options={{ headerShown: false }}
                />
                <Stack.Screen 
                  name="Standings"
                  component={StandingsScreenWrapped}
                  options={{ headerShown: false }}
                />
                <Stack.Screen 
                  name="UserManagement"
                  component={UserManagementScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen 
                  name="TeamManagement"
                  component={TeamManagementScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen 
                  name="TeamPlayers"
                  component={TeamPlayersScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen 
                  name="CalendarManagement"
                  component={CalendarManagementScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen 
                  name="InsertVotes"
                  component={InsertVotesScreenWrapped}
                  options={{ headerShown: false }}
                />
                <Stack.Screen 
                  name="SuperUser"
                  component={SuperUserScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen 
                  name="PlayerStats"
                  component={PlayerStatsScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen 
                  name="LiveScores"
                  component={LiveScoresScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="ManageMatches"
                  component={ManageMatchesScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="MatchDetail"
                  component={MatchDetailScreen}
                  options={{ headerShown: false }}
                />
              </>
            ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <AppNavigator />
    </AuthProvider>
  );
}

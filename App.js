import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync().catch(() => {});
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// Context
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { AppLoadingMediaProvider, useAppLoadingMedia } from './src/context/AppLoadingMediaContext';
import { AuthBrandingProvider, useAuthBranding } from './src/context/AuthBrandingContext';

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
import OfficialTeamDetailScreen from './src/screens/OfficialTeamDetailScreen';
import OfficialGroupDetailScreen from './src/screens/OfficialGroupDetailScreen';
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
import InjuryManagementScreen from './src/screens/InjuryManagementScreen';
import TeamPlayersScreen from './src/screens/TeamPlayersScreen';
import CalendarManagementScreen from './src/screens/CalendarManagementScreen';
import InsertVotesScreen from './src/screens/InsertVotesScreen';
import LeagueStatisticsScreen from './src/screens/LeagueStatisticsScreen';
import LiveScoresScreen from './src/screens/LiveScoresScreen';
import UpdateRequiredScreen from './src/screens/UpdateRequiredScreen';

// Components
import MainTabBar from './src/components/MainTabBar';
import LeagueHamburgerMenu from './src/components/LeagueHamburgerMenu';
import LeagueBottomMenu from './src/components/LeagueBottomMenu';
import { OnboardingProvider } from './src/context/OnboardingContext';
import { leagueService } from './src/services/api';
import { peekLeagueDetail, peekHomeLeaguesBootstrapSnapshot, getLeagueDetailWarmMeta, setLeagueDetail } from './src/services/leagueWarmCache';

function readLeagueBootstrapFromCache(leagueId) {
  const n = Number(leagueId);
  if (!Number.isFinite(n) || n <= 0) return null;
  const detail = peekLeagueDetail(n);
  if (detail && typeof detail === 'object') return detail;
  const snap = peekHomeLeaguesBootstrapSnapshot();
  if (!Array.isArray(snap)) return null;
  const row = snap.find((l) => Number(l?.id) === n);
  return row && typeof row === 'object' ? row : null;
}
import AppLoadingFullScreenModal from './src/components/AppLoadingFullScreenModal';
import { fetchAndCacheStripTeams } from './src/services/matchesStripPrefetch';
import { readStripTeamsDisk } from './src/services/matchesStripTeamsCache';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Wrapper generico per tutte le schermate dentro una lega
function withLeagueWrapper(ScreenComponent) {
  return function LeagueWrapper({ route, navigation }) {
    const { leagueId } = route.params || {};
    const insets = useSafeAreaInsets();
    const [league, setLeague] = useState(() => {
      const boot = route.params?.leagueBootstrap;
      if (boot && typeof boot === 'object' && leagueId) {
        return { id: Number(leagueId), ...boot };
      }
      return readLeagueBootstrapFromCache(leagueId);
    });

    useEffect(() => {
      if (!leagueId) return undefined;
      // Se warm fresco (post-login), evita getById ridondante: menu/bottom bar usano già la cache.
      if (getLeagueDetailWarmMeta(leagueId)?.skipNetwork) {
        const warm = peekLeagueDetail(leagueId) || readLeagueBootstrapFromCache(leagueId);
        if (warm) setLeague((prev) => ({ ...(prev || {}), ...warm, id: Number(leagueId) }));
        return undefined;
      }
      let cancelled = false;
      leagueService.getById(leagueId)
        .then((res) => {
          if (cancelled) return;
          const leagueData = Array.isArray(res.data) ? res.data[0] : res.data;
          setLeague(leagueData);
          if (leagueData && typeof leagueData === 'object') setLeagueDetail(leagueId, leagueData);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
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
const LeagueStatisticsScreenWrapped = withLeagueWrapper(LeagueStatisticsScreen);
const FormationScreenWrapped = withLeagueWrapper(FormationScreen);

// Tab Navigator per le schermate principali
function MainTabs() {
  const { token } = useAuth();

  useEffect(() => {
    // Prefetch strip a login tab: usa cache/TTL (force solo se vuota/scaduta).
    readStripTeamsDisk().catch(() => {});
    if (token) {
      fetchAndCacheStripTeams(token).catch(() => {});
    }
  }, [token]);

  return (
    <Tab.Navigator
      tabBar={(props) => <MainTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#667eea',
        tabBarInactiveTintColor: 'gray',
      }}
    >
      <Tab.Screen 
        name="Dashboard" 
        component={DashboardScreen}
        options={{ title: 'Home' }}
      />
      <Tab.Screen name="Leghe" component={LeaguesScreen} />
      <Tab.Screen
        name="Partite"
        component={MatchesScreen}
        options={{ lazy: false }}
      />
      <Tab.Screen name="Profilo" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// Stack Navigator principale
function AppNavigator() {
  const { user, loading, updateRequiredInfo, bootstrapProgress } = useAuth();
  const { uri: loadingMediaUri, type: loadingMediaType } = useAppLoadingMedia();
  const { ready: authBrandingReady } = useAuthBranding();
  const [bootstrapTimedOut, setBootstrapTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setBootstrapTimedOut(true), 16000);
    return () => clearTimeout(timer);
  }, []);

  if (updateRequiredInfo) {
    return <UpdateRequiredScreen updateInfo={updateRequiredInfo} />;
  }

  const waitingForAuthBranding = !user && !authBrandingReady;
  const showBootstrapLoader = (loading && !bootstrapTimedOut) || waitingForAuthBranding;

  // Nascondi subito lo splash nativo (su Android può mostrare l'icona app) → video AppLoadingShell
  useEffect(() => {
    if (showBootstrapLoader) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [showBootstrapLoader]);

  useEffect(() => {
    if (!showBootstrapLoader) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [showBootstrapLoader]);

  if (showBootstrapLoader) {
    return (
      <AppLoadingFullScreenModal
        visible
        uri={loadingMediaUri}
        mediaType={loadingMediaType}
        progress={waitingForAuthBranding && !loading ? 1 : bootstrapProgress}
      />
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
                  name="InjuryManagement"
                  component={InjuryManagementScreen}
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
                  name="LeagueStatistics"
                  component={LeagueStatisticsScreenWrapped}
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
                <Stack.Screen
                  name="OfficialTeamDetail"
                  component={OfficialTeamDetailScreen}
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="OfficialGroupDetail"
                  component={OfficialGroupDetailScreen}
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
    <SafeAreaProvider>
      <AppLoadingMediaProvider>
        <AuthBrandingProvider>
          <AuthProvider>
            <StatusBar style="auto" />
            <AppNavigator />
          </AuthProvider>
        </AuthBrandingProvider>
      </AppLoadingMediaProvider>
    </SafeAreaProvider>
  );
}

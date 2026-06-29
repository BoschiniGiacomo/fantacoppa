import React, { createContext, useState, useEffect, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import {
  authService,
  setUnauthorizedHandler,
  setUpdateRequiredHandler,
} from '../services/api';
import { prefetchLeagueWarmData, invalidateAllLeagueWarmCache } from '../services/leagueWarmCache';
import { clearStripTeamsCache } from '../services/matchesStripTeamsCache';
import { fetchAndCacheStripTeams } from '../services/matchesStripPrefetch';
import { registerPushTokenIfPermitted } from '../services/notificationService';

const AuthContext = createContext({});

/** Evita setItem(undefined) se il server non restituisce token/user (HTML, JSON incompleto, ecc.) */
function parseAuthResponsePayload(data) {
  if (data == null) {
    return {
      ok: false,
      error:
        'Risposta vuota dal server. Verifica l\'URL dell\'API in api.js.',
    };
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    return {
      ok: false,
      error:
        'Il server non ha restituito JSON valido (es. pagina HTML o errore PHP). Controlla URL.',
    };
  }

  const token = data.token ?? data.access_token ?? data.accessToken;
  const user = data.user ?? data.profile ?? null;

  if (!token || typeof token !== 'string') {
    return {
      ok: false,
      error:
        data.message ||
        'Nessun token nella risposta del server. Verifica URL API.',
    };
  }
  if (!user || typeof user !== 'object') {
    return {
      ok: false,
      error: data.message || 'Nessun oggetto user nella risposta del server.',
    };
  }

  return { ok: true, token, user };
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapProgress, setBootstrapProgress] = useState(0);
  const [token, setToken] = useState(null);
  const [updateRequiredInfo, setUpdateRequiredInfo] = useState(null);

  useEffect(() => {
    if (!token || !user) return undefined;

    const HEARTBEAT_MS = 60 * 1000;
    let intervalId = null;
    let isForeground = AppState.currentState === 'active';

    const sendPresencePing = async () => {
      try {
        await authService.presencePing();
      } catch (_) {
        // Silent fail: presenza non deve disturbare UX.
      }
    };

    const startHeartbeat = () => {
      if (intervalId != null) return;
      // Ping immediato quando torni in foreground
      sendPresencePing();
      intervalId = setInterval(sendPresencePing, HEARTBEAT_MS);
    };

    const stopHeartbeat = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    if (isForeground) startHeartbeat();

    const subscription = AppState.addEventListener('change', (nextState) => {
      const nextForeground = nextState === 'active';
      if (nextForeground === isForeground) return;
      isForeground = nextForeground;
      if (isForeground) startHeartbeat();
      else stopHeartbeat();
    });

    return () => {
      stopHeartbeat();
      subscription?.remove?.();
    };
  }, [token, user]);

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      invalidateAllLeagueWarmCache();
      setToken(null);
      setUser(null);
      authService.setAuthToken(null);
    });
    setUpdateRequiredHandler(async (payload) => {
      setUpdateRequiredInfo({
        message: payload?.message || 'Per continuare devi aggiornare l\'app.',
        updateUrl: payload?.update_url || null,
        minVersionCode: payload?.min_supported_version_code || null,
      });
    });

    loadStoredAuth();

    // Failsafe: evita spinner infinito in caso di bootstrap bloccato.
    const guard = setTimeout(() => {
      setBootstrapProgress(1);
      setLoading(false);
    }, 12000);

    return () => {
      setUnauthorizedHandler(null);
      setUpdateRequiredHandler(null);
      clearTimeout(guard);
    };
  }, []);

  const loadStoredAuth = async () => {
    setBootstrapProgress(0);
    try {
      setBootstrapProgress(0.04);
      const storedToken = await AsyncStorage.getItem('authToken');
      const storedUser = await AsyncStorage.getItem('user');
      setBootstrapProgress(0.1);

      if (storedToken && storedUser) {
        authService.setAuthToken(storedToken);
        setBootstrapProgress(0.16);
        await Promise.race([
          authService.validateSession(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Session validation timeout')), 8000)),
        ]);
        setBootstrapProgress(0.24);
        setToken(storedToken);
        let parsedUser = null;
        try {
          parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
        } catch (_) {
          setUser(null);
        }
        if (parsedUser) {
          fetchAndCacheStripTeams(storedToken).catch(() => {});
          await prefetchLeagueWarmData({
            onProgress: (f) => setBootstrapProgress(0.24 + Math.min(1, f) * 0.7),
            userId: parsedUser?.id,
          });
        }
        setBootstrapProgress(0.98);
        registerPushTokenIfPermitted().catch(() => {});
      } else {
        authService.setAuthToken(null);
        setBootstrapProgress(0.45);
      }
    } catch (error) {
      await AsyncStorage.removeItem('authToken');
      await AsyncStorage.removeItem('user');
      setToken(null);
      setUser(null);
      authService.setAuthToken(null);
      setBootstrapProgress(0.75);
    } finally {
      setBootstrapProgress(1);
      setLoading(false);
    }
  };

  const login = async (username, password) => {
    try {
      const response = await authService.login(username, password);
      const parsed = parseAuthResponsePayload(response.data);
      if (!parsed.ok) {
        return { success: false, error: parsed.error };
      }
      const { token: newToken, user: newUser } = parsed;

      await AsyncStorage.setItem('authToken', newToken);
      await AsyncStorage.setItem('user', JSON.stringify(newUser));

      setToken(newToken);
      setUser(newUser);
      authService.setAuthToken(newToken);
      registerPushTokenIfPermitted().catch(() => {});
      fetchAndCacheStripTeams(newToken).catch(() => {});
      await prefetchLeagueWarmData({ onProgress: () => {}, userId: newUser?.id });

      return { success: true };
    } catch (error) {
      const apiMessage = error.response?.data?.message;
      const reason =
        apiMessage ||
        (error.code === 'ERR_NETWORK' || error.message === 'Network Error'
          ? 'Rete non disponibile o server irraggiungibile'
          : error.message) ||
        'Errore durante il login';

      return {
        success: false,
        error: reason,
      };
    }
  };

  const register = async (username, email, password) => {
    try {
      const response = await authService.register(username, email, password);
      const parsed = parseAuthResponsePayload(response.data);
      if (!parsed.ok) {
        return { success: false, error: parsed.error };
      }
      const { token: newToken, user: newUser } = parsed;

      await AsyncStorage.setItem('authToken', newToken);
      await AsyncStorage.setItem('user', JSON.stringify(newUser));

      setToken(newToken);
      setUser(newUser);
      authService.setAuthToken(newToken);
      registerPushTokenIfPermitted().catch(() => {});
      fetchAndCacheStripTeams(newToken).catch(() => {});
      await prefetchLeagueWarmData({ onProgress: () => {}, userId: newUser?.id });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || 'Errore durante la registrazione',
      };
    }
  };

  const logout = async () => {
    try {
      invalidateAllLeagueWarmCache();
      clearStripTeamsCache();
      await AsyncStorage.removeItem('authToken');
      await AsyncStorage.removeItem('user');
      setToken(null);
      setUser(null);
      authService.setAuthToken(null);
    } catch (error) {
      // ignore
    }
  };

  const value = {
    user,
    token,
    loading,
    bootstrapProgress,
    updateRequiredInfo,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

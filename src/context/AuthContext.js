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

const AUTH_TOKEN_KEY = 'authToken';
const AUTH_USER_KEY = 'user';
/** Solo username/email dell’ultimo login (mai la password). */
export const LAST_LOGIN_ID_KEY = 'lastLoginId';

const SESSION_VALIDATE_TIMEOUT_MS = 15000;

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

async function clearPersistedAuth() {
  await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_USER_KEY]);
}

/**
 * Solo errori che dimostrano sessione non più valida.
 * Timeout/rete/5xx NON devono far uscire l’utente (tipico dopo OTA / cold start Render).
 */
function isDefinitiveSessionInvalid(error) {
  if (error?.code === 'SESSION_VALIDATE_TIMEOUT') return false;
  if (error?.code === 'ECONNABORTED') return false;
  if (error?.message === 'Network Error' || error?.code === 'ERR_NETWORK') return false;

  const status = Number(error?.response?.status);
  if (status === 401 || status === 403) return true;
  if (status === 404) return true;
  return false;
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
    }, 20000);

    return () => {
      setUnauthorizedHandler(null);
      setUpdateRequiredHandler(null);
      clearTimeout(guard);
    };
  }, []);

  const persistSession = async (newToken, newUser) => {
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, newToken);
    await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    authService.setAuthToken(newToken);
  };

  const loadStoredAuth = async () => {
    setBootstrapProgress(0);
    try {
      setBootstrapProgress(0.04);
      const storedToken = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
      const storedUser = await AsyncStorage.getItem(AUTH_USER_KEY);
      setBootstrapProgress(0.1);

      if (!storedToken || !storedUser) {
        authService.setAuthToken(null);
        setBootstrapProgress(0.45);
        return;
      }

      let parsedUser = null;
      try {
        parsedUser = JSON.parse(storedUser);
      } catch (_) {
        await clearPersistedAuth();
        authService.setAuthToken(null);
        setBootstrapProgress(0.45);
        return;
      }

      // Restore ottimistico: resta loggato anche se verify è lento/offline (OTA, cold start).
      authService.setAuthToken(storedToken);
      setToken(storedToken);
      setUser(parsedUser);
      setBootstrapProgress(0.16);

      let sessionOk = false;
      try {
        const verifyRes = await Promise.race([
          authService.validateSession(),
          new Promise((_, reject) => {
            const err = new Error('Session validation timeout');
            err.code = 'SESSION_VALIDATE_TIMEOUT';
            setTimeout(() => reject(err), SESSION_VALIDATE_TIMEOUT_MS);
          }),
        ]);

        const remoteUser = verifyRes?.data?.user;
        let nextUser = parsedUser;
        if (remoteUser && typeof remoteUser === 'object') {
          nextUser = { ...parsedUser, ...remoteUser };
          setUser(nextUser);
          await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(nextUser));
        }

        const refreshedToken = verifyRes?.data?.token;
        if (refreshedToken && typeof refreshedToken === 'string' && refreshedToken !== storedToken) {
          await AsyncStorage.setItem(AUTH_TOKEN_KEY, refreshedToken);
          setToken(refreshedToken);
          authService.setAuthToken(refreshedToken);
        }

        parsedUser = nextUser;
        sessionOk = true;
        setBootstrapProgress(0.24);
      } catch (verifyError) {
        if (isDefinitiveSessionInvalid(verifyError)) {
          console.warn('[auth] Sessione non valida, logout locale:', verifyError?.response?.status || verifyError?.message);
          await clearPersistedAuth();
          setToken(null);
          setUser(null);
          authService.setAuthToken(null);
          setBootstrapProgress(0.75);
          return;
        }
        // Rete/timeout/5xx: mantieni sessione salvata; l’utente resta dentro.
        console.warn('[auth] Verify non riuscito, sessione conservata:', verifyError?.code || verifyError?.message);
        setBootstrapProgress(0.22);
      }

      if (parsedUser) {
        const activeToken = (await AsyncStorage.getItem(AUTH_TOKEN_KEY)) || storedToken;
        fetchAndCacheStripTeams(activeToken).catch(() => {});
        try {
          await prefetchLeagueWarmData({
            onProgress: (f) => setBootstrapProgress(0.24 + Math.min(1, f) * 0.7),
            userId: parsedUser?.id,
          });
        } catch (_) {
          // Prefetch non deve far uscire dalla sessione.
        }
        if (sessionOk) {
          registerPushTokenIfPermitted().catch(() => {});
        }
      }
      setBootstrapProgress(0.98);
    } catch (error) {
      // Errori di lettura storage: non cancellare se possibile.
      console.warn('[auth] loadStoredAuth error:', error?.message || error);
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

      await persistSession(newToken, newUser);
      const loginId = String(username || '').trim();
      if (loginId) {
        await AsyncStorage.setItem(LAST_LOGIN_ID_KEY, loginId).catch(() => {});
      }
      registerPushTokenIfPermitted().catch(() => {});
      fetchAndCacheStripTeams(newToken, { force: true }).catch(() => {});
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

      await persistSession(newToken, newUser);
      const loginId = String(username || '').trim();
      if (loginId) {
        await AsyncStorage.setItem(LAST_LOGIN_ID_KEY, loginId).catch(() => {});
      }
      registerPushTokenIfPermitted().catch(() => {});
      fetchAndCacheStripTeams(newToken, { force: true }).catch(() => {});
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
      await clearPersistedAuth();
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

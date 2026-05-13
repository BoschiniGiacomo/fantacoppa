import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  getAppLoadingMediaSettings,
  getCachedAppLoadingMedia,
  subscribeAppLoadingMedia,
} from '../utils/appLoadingMediaSettings';

const AppLoadingMediaContext = createContext({
  uri: null,
  type: null,
  refresh: () => {},
});

export function AppLoadingMediaProvider({ children }) {
  const [state, setState] = useState({ uri: null, type: null });

  const refresh = useCallback(() => {
    getAppLoadingMediaSettings().then(setState);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Instant: read cached URI from AsyncStorage (~5ms vs ~1s API)
    getCachedAppLoadingMedia().then((cached) => {
      if (!cancelled && cached?.uri) {
        console.log(`[PERF][LoadingMedia] cache HIT — video URI available instantly`);
        setState(cached);
      }
    });

    // Background: fetch fresh from API and update if changed
    const load = () => {
      getAppLoadingMediaSettings().then((r) => {
        if (!cancelled) setState(r);
      });
    };
    load();
    const unsub = subscribeAppLoadingMedia(load);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return (
    <AppLoadingMediaContext.Provider value={{ uri: state.uri, type: state.type, refresh }}>
      {children}
    </AppLoadingMediaContext.Provider>
  );
}

export function useAppLoadingMedia() {
  return useContext(AppLoadingMediaContext);
}

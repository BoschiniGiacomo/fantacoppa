import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  getAppLoadingMediaSettings,
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

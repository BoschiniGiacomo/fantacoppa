import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  getAppLoadingMediaSettings,
  getCachedAppLoadingMedia,
  subscribeAppLoadingMedia,
} from '../utils/appLoadingMediaSettings';
import { getBundledAppLoading } from '../utils/bundledUploads';
import { logMediaCache } from '../utils/mediaCacheDebug';

const AppLoadingMediaContext = createContext({
  uri: null,
  type: null,
  refresh: () => {},
});

/** Evita di cambiare uri se il path Supabase è lo stesso (previene crash expo-video). */
function mergeLoadingMediaState(prev, next) {
  if (!next?.uri) return prev;
  const nextPath = next.path ? String(next.path).trim() : null;
  const prevPath = prev?.path ? String(prev.path).trim() : null;
  if (nextPath && prevPath && nextPath === prevPath && prev.uri && prev.type === next.type) {
    return prev;
  }
  if (prev.uri === next.uri && prev.type === next.type && prevPath === nextPath) {
    return prev;
  }
  return {
    uri: next.uri,
    type: next.type,
    path: nextPath,
  };
}

export function AppLoadingMediaProvider({ children }) {
  const [state, setState] = useState({ uri: null, type: null, path: null });

  const applyMedia = useCallback((next) => {
    setState((prev) => mergeLoadingMediaState(prev, next));
  }, []);

  const refresh = useCallback(() => {
    getAppLoadingMediaSettings().then(applyMedia);
  }, [applyMedia]);

  useEffect(() => {
    let cancelled = false;

    const bundled = getBundledAppLoading();
    if (bundled?.uri) {
      applyMedia(bundled);
    }

    getCachedAppLoadingMedia().then((cached) => {
      if (cancelled || !cached?.uri) return;
      logMediaCache('loading_ui_cache', {
        type: cached.type,
        path: cached.path,
        uri: cached.uri,
        layer: 'ui_context',
      });
      applyMedia(cached);
    });

    const load = () => {
      getAppLoadingMediaSettings().then((r) => {
        if (cancelled) return;
        logMediaCache('loading_ui_api', {
          type: r?.type,
          path: r?.path,
          uri: r?.uri,
          layer: 'ui_context',
        });
        applyMedia(r);
      });
    };
    load();
    const unsub = subscribeAppLoadingMedia(load);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [applyMedia]);

  return (
    <AppLoadingMediaContext.Provider value={{ uri: state.uri, type: state.type, refresh }}>
      {children}
    </AppLoadingMediaContext.Provider>
  );
}

export function useAppLoadingMedia() {
  return useContext(AppLoadingMediaContext);
}

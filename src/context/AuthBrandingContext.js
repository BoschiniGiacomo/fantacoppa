import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getCachedAuthBranding, loadAuthBranding } from '../utils/authBrandingSettings';
import { logMediaCache } from '../utils/mediaCacheDebug';

const AuthBrandingContext = createContext({
  logo: null,
  background: null,
  ready: false,
  refresh: () => Promise.resolve(),
});

export function AuthBrandingProvider({ children }) {
  const [logo, setLogo] = useState(null);
  const [background, setBackground] = useState(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    setReady(false);
    try {
      const branding = await loadAuthBranding();
      if (branding.logo) {
        logMediaCache('logo_ui_api', {
          path: branding.logo.path,
          uri: branding.logo.uri,
          layer: 'ui_context',
        });
      }
      setLogo(branding.logo);
      setBackground(branding.background);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getCachedAuthBranding().then((cached) => {
      if (cancelled) return;
      if (cached.logo) {
        logMediaCache('logo_ui_cache', {
          path: cached.logo.path,
          uri: cached.logo.uri,
          layer: 'ui_context',
        });
        setLogo(cached.logo);
      }
      if (cached.background) setBackground(cached.background);
    });
    refresh();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  return (
    <AuthBrandingContext.Provider value={{ logo, background, ready, refresh }}>
      {children}
    </AuthBrandingContext.Provider>
  );
}

export function useAuthBranding() {
  return useContext(AuthBrandingContext);
}

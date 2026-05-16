import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { loadAuthBranding } from '../utils/authBrandingSettings';

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
      setLogo(branding.logo);
      setBackground(branding.background);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refresh();
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

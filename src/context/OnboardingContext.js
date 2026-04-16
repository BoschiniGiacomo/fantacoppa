import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const OnboardingContext = createContext(null);

const AUTO_DETECT_DEFAULTS = {
  hasDefaultNames: false,
  squadEmpty: true,
  squadFull: false,
  marketAvailable: false,
  autoLineupMode: false,
};

export function OnboardingProvider({ leagueId, children }) {
  // Stato locale (AsyncStorage-backed)
  const [localState, setLocalState] = useState({
    visited_rosa: false,
    submitted_formation: false,
  });
  // Dati auto-detect (persistiti in AsyncStorage)
  const [autoDetect, setAutoDetect] = useState(AUTO_DETECT_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const autoDetectLoaded = useRef(false);

  const storageKey = `onboarding_${leagueId}`;
  const autoDetectKey = `onboarding_auto_${leagueId}`;

  // Carica stato da AsyncStorage (sia localState che autoDetect)
  useEffect(() => {
    if (!leagueId) return;
    Promise.all([
      AsyncStorage.getItem(storageKey).catch(() => null),
      AsyncStorage.getItem(autoDetectKey).catch(() => null),
    ]).then(([rawLocal, rawAuto]) => {
      if (rawLocal) {
        try {
          const parsed = JSON.parse(rawLocal);
          setLocalState(prev => ({ ...prev, ...parsed }));
        } catch {}
      }
      if (rawAuto) {
        try {
          const parsed = JSON.parse(rawAuto);
          setAutoDetect(prev => ({ ...prev, ...parsed }));
        } catch {}
      }
      autoDetectLoaded.current = true;
      setLoaded(true);
    });
  }, [leagueId]);

  // Segna un task come completato
  const markDone = useCallback(async (taskId) => {
    setLocalState(prev => {
      const updated = { ...prev, [taskId]: true };
      AsyncStorage.setItem(storageKey, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, [storageKey]);

  // Aggiorna i dati auto-detect e persisti
  const updateAutoDetect = useCallback((data) => {
    setAutoDetect(prev => {
      const updated = { ...prev, ...data };
      AsyncStorage.setItem(autoDetectKey, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, [autoDetectKey]);

  // Calcola i task pendenti
  const pendingTasks = {
    customize_team: autoDetect.hasDefaultNames,
    buy_players: autoDetect.squadEmpty && autoDetect.marketAvailable,
    fill_squad: !autoDetect.squadFull,
    // In modalità formazione automatica non serve inviare la formazione
    submit_formation: !autoDetect.autoLineupMode && !localState.submitted_formation,
  };

  // Conta badge per posizione (nessun badge finché i dati non sono caricati)
  const badges = loaded ? {
    dashboard: false,
    market: pendingTasks.buy_players,
    squad: pendingTasks.fill_squad,
    formation: pendingTasks.submit_formation,
    settings_team: pendingTasks.customize_team,
  } : {
    dashboard: false,
    market: false,
    squad: false,
    formation: false,
    settings_team: false,
  };

  // Badge visibili nell'hamburger menu (solo market, squad, settings_team)
  const hasHamburgerBadge = badges.market || badges.squad || badges.settings_team;

  // Qualche badge attivo? (tutti, inclusi quelli nei tab in basso)
  const hasAnyBadge = Object.values(badges).some(Boolean);

  return (
    <OnboardingContext.Provider value={{
      pendingTasks,
      badges,
      hasAnyBadge,
      hasHamburgerBadge,
      markDone,
      updateAutoDetect,
      loaded,
    }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  // Se usato fuori dal provider, ritorna valori safe
  if (!ctx) {
    return {
      pendingTasks: {},
      badges: {},
      hasAnyBadge: false,
      hasHamburgerBadge: false,
      markDone: () => {},
      updateAutoDetect: () => {},
      loaded: false,
    };
  }
  return ctx;
}

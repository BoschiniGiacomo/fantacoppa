/**
 * Livelli `users.is_superuser`:
 * 0 = utente
 * 1 = super user (admin completo)
 * 2 = gestore partite
 * 3 = gestore diretta (solo tab Diretta)
 * 4 = pagellatore (solo tab Voti, senza collegamento giornate)
 */

export const USER_ROLE = {
  USER: 0,
  SUPER: 1,
  MATCH_MANAGER: 2,
  LIVE_MANAGER: 3,
  GRADER: 4,
};

export function normalizeUserRole(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return USER_ROLE.USER;
  return n;
}

export function roleLabelForLevel(level) {
  switch (normalizeUserRole(level)) {
    case USER_ROLE.SUPER:
      return 'Super user';
    case USER_ROLE.MATCH_MANAGER:
      return 'Gestore partite';
    case USER_ROLE.LIVE_MANAGER:
      return 'Gestore diretta';
    case USER_ROLE.GRADER:
      return 'Pagellatore';
    default:
      return 'Utente';
  }
}

/** Pannello Super User (leghe, utenti, aspetto, cluster, …) */
export function canOpenSuperUserPanel(level) {
  return normalizeUserRole(level) === USER_ROLE.SUPER;
}

/** Zona Gestione partite (CRUD partite/competizioni) */
export function canOpenMatchManagement(level) {
  const n = normalizeUserRole(level);
  return n === USER_ROLE.SUPER || n === USER_ROLE.MATCH_MANAGER;
}

/** Modifica diretta (eventi live / fasi / cronometro) */
export function canManageMatchLive(level) {
  const n = normalizeUserRole(level);
  return (
    n === USER_ROLE.SUPER
    || n === USER_ROLE.MATCH_MANAGER
    || n === USER_ROLE.LIVE_MANAGER
  );
}

/** Modifica panoramica / formazione (non disponibili) — non gestore diretta */
export function canManageMatchOverview(level) {
  const n = normalizeUserRole(level);
  return n === USER_ROLE.SUPER || n === USER_ROLE.MATCH_MANAGER;
}

/** Tab voti + inserimento voti (senza collegamento giornate se non super) */
export function canAccessMatchVotes(level) {
  const n = normalizeUserRole(level);
  return (
    n === USER_ROLE.SUPER
    || n === USER_ROLE.MATCH_MANAGER
    || n === USER_ROLE.GRADER
  );
}

/** Collegamento partita ↔ giornata calendario */
export function canManageMatchVoteLinks(level) {
  return normalizeUserRole(level) === USER_ROLE.SUPER;
}

/** Vede partite admin-only nella lista */
export function canSeeAdminOnlyMatches(level) {
  const n = normalizeUserRole(level);
  return (
    n === USER_ROLE.SUPER
    || n === USER_ROLE.MATCH_MANAGER
    || n === USER_ROLE.LIVE_MANAGER
    || n === USER_ROLE.GRADER
  );
}

export const VALID_USER_ROLE_LEVELS = [
  USER_ROLE.USER,
  USER_ROLE.SUPER,
  USER_ROLE.MATCH_MANAGER,
  USER_ROLE.LIVE_MANAGER,
  USER_ROLE.GRADER,
];

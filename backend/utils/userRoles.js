/**
 * Livelli `users.is_superuser` (allineato al client src/utils/userRoles.js):
 * 0 utente · 1 super · 2 gestore partite · 3 gestore diretta · 4 pagellatore
 */

const USER_ROLE = {
  USER: 0,
  SUPER: 1,
  MATCH_MANAGER: 2,
  LIVE_MANAGER: 3,
  GRADER: 4,
};

function normalizeUserRole(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return USER_ROLE.USER;
  return n;
}

function canSeeAdminOnlyMatches(level) {
  const n = normalizeUserRole(level);
  return (
    n === USER_ROLE.SUPER
    || n === USER_ROLE.MATCH_MANAGER
    || n === USER_ROLE.LIVE_MANAGER
    || n === USER_ROLE.GRADER
  );
}

function canManageMatchLive(level) {
  const n = normalizeUserRole(level);
  return (
    n === USER_ROLE.SUPER
    || n === USER_ROLE.MATCH_MANAGER
    || n === USER_ROLE.LIVE_MANAGER
  );
}

function canManageMatchOverview(level) {
  const n = normalizeUserRole(level);
  return n === USER_ROLE.SUPER || n === USER_ROLE.MATCH_MANAGER;
}

function canOpenMatchManagement(level) {
  const n = normalizeUserRole(level);
  return n === USER_ROLE.SUPER || n === USER_ROLE.MATCH_MANAGER;
}

function canAccessMatchVotes(level) {
  const n = normalizeUserRole(level);
  return (
    n === USER_ROLE.SUPER
    || n === USER_ROLE.MATCH_MANAGER
    || n === USER_ROLE.GRADER
  );
}

function canManageMatchVoteLinks(level) {
  return normalizeUserRole(level) === USER_ROLE.SUPER;
}

/** Accesso API pannello SuperUser (solo livello 1; il 2 resta escluso da UI ma storicamente era in requireSuperuser — teniamo solo 1 per zone esclusive). */
function canAccessSuperuserPanel(level) {
  const n = normalizeUserRole(level);
  // Storico: requireSuperuser accettava 1 e 2. Manteniamo 1|2 per non rompere gestore partite su endpoint condivisi.
  return n === USER_ROLE.SUPER || n === USER_ROLE.MATCH_MANAGER;
}

const VALID_USER_ROLE_LEVELS = [
  USER_ROLE.USER,
  USER_ROLE.SUPER,
  USER_ROLE.MATCH_MANAGER,
  USER_ROLE.LIVE_MANAGER,
  USER_ROLE.GRADER,
];

module.exports = {
  USER_ROLE,
  normalizeUserRole,
  canSeeAdminOnlyMatches,
  canManageMatchLive,
  canManageMatchOverview,
  canOpenMatchManagement,
  canAccessMatchVotes,
  canManageMatchVoteLinks,
  canAccessSuperuserRoutes,
  VALID_USER_ROLE_LEVELS,
};

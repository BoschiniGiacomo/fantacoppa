<?php
if (!function_exists('startSession')) {
    require_once 'functions.php';
}
startSession();

if (!isLoggedIn()) {
    header('Location: index.php');
    exit();
}

$leagueId = isset($_GET['league_id']) ? (int)$_GET['league_id'] : (isset($_GET['id']) ? (int)$_GET['id'] : null);
$league = null;
if ($leagueId) {
    setUserLeagueRole($conn, $_SESSION['user_id'], $leagueId);
    $league = getLeagueById($leagueId);
}
$isAdminLega = isAdminLega();
$isPagellatoreLega = isPagellatoreLega();

// Check if user is superuser
$isSuperuser = false;
if (isset($_SESSION['user_id'])) {
    $stmt = $conn->prepare("SELECT is_superuser FROM users WHERE id = ?");
    $stmt->bind_param("i", $_SESSION['user_id']);
    $stmt->execute();
    $result = $stmt->get_result()->fetch_assoc();
    $isSuperuser = $result && $result['is_superuser'];
}

$currentPage = basename($_SERVER['PHP_SELF']);
$mobileBottomPages = ['league.php', 'squadre.php', 'team_detail.php', 'calendario.php', 'risultati_giornata.php', 'formazione.php', 'mercato.php', 'rosa.php', 'impostazioni.php', 'inserisci_voti.php'];
$showLeagueBottomNav = $leagueId && in_array($currentPage, $mobileBottomPages, true);
$isBottomHomeActive = ($currentPage === 'league.php');
$isBottomTeamsActive = in_array($currentPage, ['squadre.php', 'team_detail.php'], true);
$isBottomCalendarActive = ($currentPage === 'calendario.php');
$isBottomStandingsActive = ($currentPage === 'risultati_giornata.php');
$isBottomFormationActive = ($currentPage === 'formazione.php');
?>
<style>
@media (max-width: 991.98px) {
    body.fc-has-mobile-league-nav {
        padding-bottom: 78px;
    }
    .fc-mobile-bottom-nav {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1040;
        background: #fff;
        border-top: 1px solid #e5e7eb;
        box-shadow: 0 -4px 16px rgba(15, 23, 42, 0.08);
        display: flex;
        justify-content: space-around;
        align-items: center;
        min-height: 64px;
        padding: 6px 8px 8px;
    }
    .fc-mobile-bottom-nav .fc-bottom-link {
        text-decoration: none;
        color: #6b7280;
        display: flex;
        flex: 1;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        font-size: 10px;
        font-weight: 600;
    }
    .fc-mobile-bottom-nav .fc-bottom-link i {
        font-size: 1.2rem;
        line-height: 1;
    }
    .fc-mobile-bottom-nav .fc-bottom-link.active {
        color: #667eea;
    }
}
</style>
<nav class="navbar navbar-expand-lg navbar-dark bg-primary">
    <div class="container">
        <a class="navbar-brand" href="dashboard.php">FantaCoppa</a>
        <button class="navbar-toggler" type="button" data-bs-toggle="offcanvas" data-bs-target="#mainNavbarOffcanvas" aria-controls="mainNavbarOffcanvas" aria-label="Toggle navigation">
            <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse d-none d-lg-flex" id="mainNavbar">
            <ul class="navbar-nav me-auto mb-2 mb-lg-0">
                <?php if ($leagueId): ?>
                <li class="nav-item">
                    <a class="nav-link<?php if ($currentPage === 'league.php') echo ' active'; ?>" href="league.php?id=<?php echo $leagueId; ?>"><i class="bi bi-house"></i> Dashboard</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link<?php if ($currentPage === 'squadre.php') echo ' active'; ?>" href="squadre.php?league_id=<?php echo $leagueId; ?>"><i class="bi bi-shield-check"></i> Squadre</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link<?php if ($currentPage === 'mercato.php') echo ' active'; ?>" href="mercato.php?league_id=<?php echo $leagueId; ?>"><i class="bi bi-bag"></i> Mercato</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link<?php if ($currentPage === 'rosa.php') echo ' active'; ?>" href="rosa.php?league_id=<?php echo $leagueId; ?>"><i class="bi bi-people"></i> La mia rosa</a>
                </li>
                <?php if (!$league || !$league['auto_lineup_mode']): ?>
                <li class="nav-item">
                    <a class="nav-link<?php if ($currentPage === 'formazione.php') echo ' active'; ?>" href="formazione.php?league_id=<?php echo $leagueId; ?>"><i class="bi bi-clipboard-data"></i> Formazione</a>
                </li>
                <?php endif; ?>
                <li class="nav-item">
                    <a class="nav-link<?php if ($currentPage === 'calendario.php') echo ' active'; ?>" href="calendario.php?league_id=<?php echo $leagueId; ?>"><i class="bi bi-calendar"></i> Calendario</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link<?php if ($currentPage === 'risultati_giornata.php') echo ' active'; ?>" href="risultati_giornata.php?league_id=<?php echo $leagueId; ?>"><i class="bi bi-trophy"></i> Classifica</a>
                </li>
                <?php if ($isAdminLega || $isPagellatoreLega): ?>
                <li class="nav-item">
                    <a class="nav-link<?php if ($currentPage === 'inserisci_voti.php') echo ' active'; ?>" href="inserisci_voti.php?league_id=<?php echo $leagueId; ?>"><i class="bi bi-pencil-square"></i> Inserisci voti</a>
                </li>
                <?php endif; ?>
                <li class="nav-item">
                    <a class="nav-link<?php if ($currentPage === 'impostazioni.php') echo ' active'; ?>" href="impostazioni.php?league_id=<?php echo $leagueId; ?>&section=<?php echo $isAdminLega ? 'general' : 'team'; ?>"><i class="bi bi-gear"></i> Impostazioni</a>
                </li>
                <?php endif; ?>
            </ul>
            <div class="d-flex align-items-center ms-auto">
                <div class="navbar-text text-white">
                    <div class="dropdown">
                        <button class="btn btn-link text-white dropdown-toggle" type="button" id="userMenu" data-bs-toggle="dropdown" aria-expanded="false">
                            <i class="bi bi-person-circle"></i> <?php echo htmlspecialchars($_SESSION['username']); ?>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="userMenu">
                            <li><a class="dropdown-item text-dark fw-bold" href="dashboard.php">
                                <i class="bi bi-speedometer2"></i> Home
                            </a></li>
                            <li><a class="dropdown-item text-dark fw-bold" href="profile.php">
                                <i class="bi bi-person-gear"></i> Modifica profilo
                            </a></li>
                            <?php if ($isSuperuser): ?>
                            <li><hr class="dropdown-divider"></li>
                            <li><a class="dropdown-item text-warning fw-bold" href="superuser.php">
                                <i class="bi bi-shield-check"></i> Super Admin
                            </a></li>
                            <?php endif; ?>
                            <li><hr class="dropdown-divider"></li>
                            <li><a class="dropdown-item text-danger fw-bold" href="index.php?logout=1">
                                <i class="bi bi-box-arrow-right"></i> Logout
                            </a></li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        <!-- Offcanvas per mobile/tablet -->
        <div class="offcanvas offcanvas-start d-lg-none" tabindex="-1" id="mainNavbarOffcanvas" aria-labelledby="mainNavbarOffcanvasLabel" style="background-color: #f8f9fa;">
            <div class="offcanvas-header bg-primary text-white">
                <h5 class="offcanvas-title" id="mainNavbarOffcanvasLabel"><i class="bi bi-list"></i> Menu</h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas" aria-label="Chiudi"></button>
            </div>
            <div class="offcanvas-body" style="background-color: #f8f9fa;">
                <ul class="navbar-nav">
                    <?php if ($leagueId): ?>
                    <?php if ($currentPage !== 'league.php'): ?>
                    <li class="nav-item">
                        <a class="nav-link text-dark" href="league.php?id=<?php echo $leagueId; ?>"><i class="bi bi-house text-dark"></i> Dashboard</a>
                    </li>
                    <?php endif; ?>
                    <li class="nav-item">
                        <a class="nav-link text-dark<?php if ($currentPage === 'squadre.php') echo ' active'; ?>" href="squadre.php?league_id=<?php echo $leagueId; ?>"><i class="bi bi-shield-check text-dark"></i> Squadre</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link text-dark<?php if ($currentPage === 'mercato.php') echo ' active'; ?>" href="mercato.php?league_id=<?php echo $leagueId; ?>"><i class="bi bi-bag text-dark"></i> Mercato</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link text-dark<?php if ($currentPage === 'rosa.php') echo ' active'; ?>" href="rosa.php?league_id=<?php echo $leagueId; ?>"><i class="bi bi-people text-dark"></i> La mia rosa</a>
                    </li>
                    <?php if (!$league || !$league['auto_lineup_mode']): ?>
                    <li class="nav-item">
                        <a class="nav-link text-dark<?php if ($currentPage === 'formazione.php') echo ' active'; ?>" href="formazione.php?league_id=<?php echo $leagueId; ?>"><i class="bi bi-clipboard-data text-dark"></i> Formazione</a>
                    </li>
                    <?php endif; ?>
                    <li class="nav-item">
                        <a class="nav-link text-dark<?php if ($currentPage === 'calendario.php') echo ' active'; ?>" href="calendario.php?league_id=<?php echo $leagueId; ?>"><i class="bi bi-calendar text-dark"></i> Calendario</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link text-dark<?php if ($currentPage === 'risultati_giornata.php') echo ' active'; ?>" href="risultati_giornata.php?league_id=<?php echo $leagueId; ?>"><i class="bi bi-trophy text-dark"></i> Classifica</a>
                    </li>
                    <?php if ($isAdminLega || $isPagellatoreLega): ?>
                    <li class="nav-item">
                        <a class="nav-link text-dark<?php if ($currentPage === 'inserisci_voti.php') echo ' active'; ?>" href="inserisci_voti.php?league_id=<?php echo $leagueId; ?>"><i class="bi bi-pencil-square text-dark"></i> Inserisci voti</a>
                    </li>
                    <?php endif; ?>
                    <li class="nav-item">
                        <a class="nav-link text-dark<?php if ($currentPage === 'impostazioni.php') echo ' active'; ?>" href="impostazioni.php?league_id=<?php echo $leagueId; ?>&section=<?php echo $isAdminLega ? 'general' : 'team'; ?>"><i class="bi bi-gear text-dark"></i> Impostazioni</a>
                    </li>
                    <?php endif; ?>
                </ul>
                <hr>
                <div class="dropdown">
                    <button class="btn btn-link text-primary dropdown-toggle w-100 text-start" type="button" id="userMenuOff" data-bs-toggle="dropdown" aria-expanded="false">
                        <i class="bi bi-person-circle"></i> <?php echo htmlspecialchars($_SESSION['username']); ?>
                    </button>
                    <ul class="dropdown-menu w-100" aria-labelledby="userMenuOff">
                        <li><a class="dropdown-item text-dark fw-bold" href="dashboard.php">
                            <i class="bi bi-speedometer2"></i> Home
                        </a></li>
                        <li><a class="dropdown-item text-dark fw-bold" href="profile.php">
                            <i class="bi bi-person-gear"></i> Modifica profilo
                        </a></li>
                        <?php if ($isSuperuser): ?>
                        <li><hr class="dropdown-divider"></li>
                        <li><a class="dropdown-item text-warning fw-bold" href="superuser.php">
                            <i class="bi bi-shield-check"></i> Super Admin
                        </a></li>
                        <?php endif; ?>
                        <li><hr class="dropdown-divider"></li>
                        <li><a class="dropdown-item text-danger fw-bold" href="index.php?logout=1">
                            <i class="bi bi-box-arrow-right"></i> Logout
                        </a></li>
                    </ul>
                </div>
            </div>
        </div>
    </div>
</nav> 
<?php if ($showLeagueBottomNav): ?>
<div class="fc-mobile-bottom-nav d-lg-none" role="navigation" aria-label="Navigazione lega">
    <a class="fc-bottom-link<?php if ($isBottomHomeActive) echo ' active'; ?>" href="league.php?id=<?php echo $leagueId; ?>">
        <i class="bi <?php echo $isBottomHomeActive ? 'bi-house-fill' : 'bi-house'; ?>"></i>
        <span>Home</span>
    </a>
    <a class="fc-bottom-link<?php if ($isBottomTeamsActive) echo ' active'; ?>" href="squadre.php?league_id=<?php echo $leagueId; ?>">
        <i class="bi <?php echo $isBottomTeamsActive ? 'bi-people-fill' : 'bi-people'; ?>"></i>
        <span>Squadre</span>
    </a>
    <a class="fc-bottom-link<?php if ($isBottomCalendarActive) echo ' active'; ?>" href="calendario.php?league_id=<?php echo $leagueId; ?>">
        <i class="bi <?php echo $isBottomCalendarActive ? 'bi-calendar2-fill' : 'bi-calendar2'; ?>"></i>
        <span>Calendario</span>
    </a>
    <a class="fc-bottom-link<?php if ($isBottomStandingsActive) echo ' active'; ?>" href="risultati_giornata.php?league_id=<?php echo $leagueId; ?>">
        <i class="bi <?php echo $isBottomStandingsActive ? 'bi-trophy-fill' : 'bi-trophy'; ?>"></i>
        <span>Classifica</span>
    </a>
    <?php if (!$league || !$league['auto_lineup_mode']): ?>
    <a class="fc-bottom-link<?php if ($isBottomFormationActive) echo ' active'; ?>" href="formazione.php?league_id=<?php echo $leagueId; ?>">
        <i class="bi <?php echo $isBottomFormationActive ? 'bi-clipboard-data-fill' : 'bi-clipboard-data'; ?>"></i>
        <span>Formazione</span>
    </a>
    <?php endif; ?>
</div>
<script>
document.body.classList.add('fc-has-mobile-league-nav');
</script>
<?php endif; ?>
<?php
require_once 'functions.php';
startSession();

if (!isLoggedIn()) {
    header('Location: index.php');
    exit();
}

$leagueId = $_GET['id'] ?? null;
if (!$leagueId) {
    header('Location: dashboard.php');
    exit();
}

$userId = getCurrentUserId();
$userRole = getUserRoleInLeague($userId, $leagueId);
$isAdminInLeague = isUserAdminInLeague($userId, $leagueId);

if (!$userRole) {
    header('Location: dashboard.php');
    exit();
}

// Handle logout
if (isset($_GET['logout'])) {
    session_destroy();
    header('Location: index.php');
    exit();
}

$conn = getDbConnection();
$leagueId = $_GET['id'] ?? null;

if (!$leagueId) {
    header('Location: dashboard.php');
    exit();
}

$league = getLeagueById($leagueId);
if (!$league) {
    header('Location: dashboard.php');
    exit();
}
// Check if user is in the league
$stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
$stmt->bind_param("ii", $leagueId, $userId);
$stmt->execute();
if (!$stmt->get_result()->num_rows) {
    header('Location: dashboard.php');
    exit();
}

// Check if user has set team name and coach name
$stmt = $conn->prepare("SELECT team_name, coach_name FROM user_budget WHERE user_id = ? AND league_id = ?");
$stmt->bind_param("ii", $userId, $leagueId);
$stmt->execute();
$userTeamInfo = $stmt->get_result()->fetch_assoc();

// If team info is missing or empty, redirect to team selection
if (!$userTeamInfo || empty($userTeamInfo['team_name']) || empty($userTeamInfo['coach_name'])) {
    header('Location: select_team.php?league_id=' . $leagueId);
    exit();
}

// Helper: costruisce la miglior formazione automatica (1 P + D/C/A che sommano a numero_titolari-1)
function build_auto_lineup($uid, $league, $rose, $voti, $conn) {
    $numero_titolari = isset($league['numero_titolari']) ? (int)$league['numero_titolari'] : 11;
    $slots_di_movimento = max(0, $numero_titolari - 1); // escluso il portiere

    // Recupera ruoli dei giocatori in rosa dell'utente
    $ruoliByPlayer = [];
    if (isset($rose[$uid]) && count($rose[$uid]) > 0) {
        $in = implode(',', array_fill(0, count($rose[$uid]), '?'));
        $types = str_repeat('i', count($rose[$uid]));
        $stmt = $conn->prepare("SELECT id, role FROM players WHERE id IN ($in)");
        $stmt->bind_param($types, ...$rose[$uid]);
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $ruoliByPlayer[$row['id']] = $row['role'];
        }
    }

    // Separa voti per ruolo
    $votiByRole = ['P'=>[], 'D'=>[], 'C'=>[], 'A'=>[]];
    foreach ($ruoliByPlayer as $pid => $role) {
        if (isset($voti[$pid])) {
            $votiByRole[$role][$pid] = $voti[$pid];
        }
    }

    // Scegli 1 portiere con voto più alto
    arsort($votiByRole['P']);
    $titolari = [];
    $portieri = array_keys($votiByRole['P']);
    if (!empty($portieri)) {
        $titolari[] = $portieri[0];
    } else {
        // Nessun portiere con voto: metti slot vuoto
        $titolari[] = null;
    }

    // Genera combinazioni D/C/A che sommano a $slots_di_movimento (limiti ragionevoli)
    $bestCombo = null;
    $bestScore = -INF;
    $bestPick = ['D'=>[], 'C'=>[], 'A'=>[]];

    $maxD = min(6, $slots_di_movimento);
    $maxC = min(6, $slots_di_movimento);
    $maxA = min(4, $slots_di_movimento);

    for ($d = 2; $d <= $maxD; $d++) {
        for ($c = 2; $c <= $maxC; $c++) {
            $a = $slots_di_movimento - $d - $c;
            if ($a < 1 || $a > $maxA) continue;
            // Punteggio della combinazione: somma dei migliori N voti per ruolo
            $pick = ['D'=>[], 'C'=>[], 'A'=>[]];
            $score = 0;
            // Difensori
            arsort($votiByRole['D']);
            $pick['D'] = array_slice(array_keys($votiByRole['D']), 0, $d);
            foreach ($pick['D'] as $pid) $score += $voti[$pid] ?? 0;
            // Centrocampisti
            arsort($votiByRole['C']);
            $pick['C'] = array_slice(array_keys($votiByRole['C']), 0, $c);
            foreach ($pick['C'] as $pid) $score += $voti[$pid] ?? 0;
            // Attaccanti
            arsort($votiByRole['A']);
            $pick['A'] = array_slice(array_keys($votiByRole['A']), 0, $a);
            foreach ($pick['A'] as $pid) $score += $voti[$pid] ?? 0;

            if ($score > $bestScore) {
                $bestScore = $score;
                $bestCombo = [$d, $c, $a];
                $bestPick = $pick;
            }
        }
    }

    // Assembla titolari finali: già abbiamo 1 P, poi D, C, A della miglior combo.
    $titolari = array_merge($titolari, $bestPick['D'], $bestPick['C'], $bestPick['A']);

    // Riempie con null se mancano slot (giocatori senza voto o ruoli insufficienti)
    while (count($titolari) < $numero_titolari) $titolari[] = null;

    return $titolari;
}

$error = '';
$success = '';

// Get league details
$stmt = $conn->prepare("SELECT * FROM leagues WHERE id = ?");
$stmt->bind_param("i", $leagueId);
$stmt->execute();
$league = $stmt->get_result()->fetch_assoc();

if (!$league) {
    header('Location: dashboard.php');
    exit();
}

// Handle role changes
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $isAdminInLeague) {
    if (isset($_POST['action']) && $_POST['action'] === 'change_role') {
        $memberId = $_POST['member_id'] ?? '';
        $newRole = $_POST['new_role'] ?? '';

        // Recupera l'user_id e ruolo attuale del membro
        $stmt = $conn->prepare("SELECT user_id, role FROM league_members WHERE id = ? AND league_id = ?");
        $stmt->bind_param("ii", $memberId, $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        $member = $res->fetch_assoc();

        if ($member) {
            $isChangingAdmin = ($member['role'] === 'admin' && $newRole !== 'admin');
            if ($isChangingAdmin) {
                // Conta quanti admin ci sono nella lega
                $stmt = $conn->prepare("SELECT COUNT(*) as admin_count FROM league_members WHERE league_id = ? AND role = 'admin'");
                $stmt->bind_param("i", $leagueId);
                $stmt->execute();
                $res = $stmt->get_result();
                $row = $res->fetch_assoc();
                if ($row && $row['admin_count'] <= 1) {
                    $error = 'Devi nominare almeno un altro admin prima di poter cambiare ruolo all\'ultimo admin della lega.';
                }
            }
            if (empty($error) && in_array($newRole, ['admin', 'pagellatore', 'user'])) {
                $stmt = $conn->prepare("UPDATE league_members SET role = ? WHERE id = ? AND league_id = ?");
                $stmt->bind_param("sii", $newRole, $memberId, $leagueId);

                if ($stmt->execute()) {
                    $success = 'Ruolo aggiornato con successo!';
                } else {
                    $error = 'Errore nell\'aggiornamento del ruolo.';
                }
            }
        }
    }
}

// Handle user removal from league (admin only)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $isAdminInLeague) {
    if (isset($_POST['action']) && $_POST['action'] === 'remove_user') {
        $removeUserId = (int)$_POST['remove_user_id'];
        if ($removeUserId !== $userId) { // Non può rimuovere se stesso
            // Rimuovi dalla league_members
            $stmt = $conn->prepare("DELETE FROM league_members WHERE user_id = ? AND league_id = ?");
            $stmt->bind_param("ii", $removeUserId, $leagueId);
            $stmt->execute();
            // Rimuovi i giocatori acquistati nella lega (user_players)
            $teamIds = $conn->query("SELECT id FROM teams WHERE league_id = $leagueId");
            $ids = [];
            while ($row = $teamIds->fetch_assoc()) { $ids[] = $row['id']; }
            if ($ids) {
                $teamList = implode(',', $ids);
                $playerIds = $conn->query("SELECT id FROM players WHERE team_id IN ($teamList)");
                $pids = [];
                while ($row = $playerIds->fetch_assoc()) { $pids[] = $row['id']; }
                if ($pids) {
                    $playerList = implode(',', $pids);
                    $conn->query("DELETE FROM user_players WHERE user_id = $removeUserId AND player_id IN ($playerList)");
                }
            }
            // Rimuovi il budget associato (opzionale, se vuoi tenerlo commenta la riga sotto)
            $conn->query("DELETE FROM user_budget WHERE user_id = $removeUserId");
            $success = 'Utente rimosso dalla lega.';
            // Aggiorna la pagina per riflettere la modifica
            header("Location: league.php?id=$leagueId");
            exit();
        }
    }
}

// Get league members
$stmt = $conn->prepare("
    SELECT lm.*, u.username 
    FROM league_members lm 
    JOIN users u ON lm.user_id = u.id 
    WHERE lm.league_id = ?
    ORDER BY lm.role DESC, u.username ASC
");
$stmt->bind_param("i", $leagueId);
$stmt->execute();
$members = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// Calcolo partecipanti attivi (almeno un giocatore nella rosa per questa lega)
$activeCount = 0;
$activeRes = $conn->query("
    SELECT COUNT(DISTINCT up.user_id) as attivi
    FROM user_players up
    JOIN players p ON up.player_id = p.id
    JOIN teams t ON p.team_id = t.id
    WHERE t.league_id = $leagueId
");
if ($row = $activeRes->fetch_assoc()) {
    $activeCount = $row['attivi'];
}

$pref = [];
if (isLoggedIn()) {
    $pref = getUserLeaguePrefs(getCurrentUserId())[$leagueId] ?? ['favorite'=>false,'archived'=>false];
}

// Recupera le rose degli utenti per la modalità automatica
$rose = [];
$stmt = $conn->prepare("SELECT up.user_id, up.player_id FROM user_players up JOIN players p ON up.player_id = p.id JOIN teams t ON p.team_id = t.id WHERE t.league_id = ?");
$stmt->bind_param("i", $leagueId);
$stmt->execute();
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
    if (!isset($rose[$row['user_id']])) $rose[$row['user_id']] = [];
    $rose[$row['user_id']][] = $row['player_id'];
}

// --- MINI-CLASSIFICA ---
$classifica = [];
$utenti = [];
$stmt = $conn->prepare("SELECT u.id, u.username, ub.team_name FROM users u JOIN user_budget ub ON u.id = ub.user_id WHERE ub.league_id = ?");
$stmt->bind_param("i", $leagueId);
$stmt->execute();
$utenti = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// Recupera le giornate
$giornate = [];
$stmt = $conn->prepare("SELECT giornata, deadline FROM matchdays WHERE league_id = ? ORDER BY giornata");
$stmt->bind_param("i", $leagueId);
$stmt->execute();
$giornate = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// Calcola classifica generale
$classifica_generale = [];
foreach ($utenti as $utente) {
    $uid = $utente['id'];
    $somma_totale = 0;
    foreach ($giornate as $g) {
        $giornata_calc = $g['giornata'];
        $voti_giornata = [];
        $stmt2 = $conn->prepare("SELECT player_id, rating FROM player_ratings WHERE league_id = ? AND giornata = ?");
        $stmt2->bind_param("ii", $leagueId, $giornata_calc);
        $stmt2->execute();
        $res2 = $stmt2->get_result();
        while ($row2 = $res2->fetch_assoc()) $voti_giornata[$row2['player_id']] = $row2['rating'];
        $titolari = [];
        if ($league['auto_lineup_mode']) {
            // Usa formazione automatica
            $titolari = build_auto_lineup($uid, $league, $rose, $voti_giornata, $conn);
        } else {
            // Recupera formazione manuale salvata
            $stmt3 = $conn->prepare("SELECT titolari FROM user_lineups WHERE user_id = ? AND league_id = ? AND giornata = ?");
            $stmt3->bind_param("iii", $uid, $leagueId, $giornata_calc);
            $stmt3->execute();
            $res3 = $stmt3->get_result();
            if ($row3 = $res3->fetch_assoc()) {
                $titolari_str = $row3['titolari'];
                if ($titolari_str && $titolari_str[0] === '[') $titolari = json_decode($titolari_str, true);
                else if ($titolari_str) $titolari = explode(',', $titolari_str);
            }
        }
        
        if (!empty($titolari)) {
            foreach ($titolari as $pid) if ($pid && isset($voti_giornata[$pid])) $somma_totale += $voti_giornata[$pid];
        }
    }
    $classifica_generale[] = [
        'id' => $utente['id'],
        'username' => $utente['username'],
        'team_name' => $utente['team_name'],
        'punteggio' => $somma_totale
    ];
}
usort($classifica_generale, function($a, $b) { return $b['punteggio'] <=> $a['punteggio']; });

// --- PROSSIMA SCADENZA ---
$prossima = null;
$now = date('Y-m-d H:i:s');
foreach ($giornate as $g) {
    if ($g['deadline'] > $now) { $prossima = $g; break; }
}

// --- STATISTICHE/CURIOSITÀ ---
// Miglior punteggio giornata
$miglior_punteggio = 0; $miglior_utente = '';
foreach ($giornate as $g) {
    foreach ($utenti as $utente) {
        $uid = $utente['id'];
        $punti = 0;
        $voti_giornata = [];
        $stmt2 = $conn->prepare("SELECT player_id, rating FROM player_ratings WHERE league_id = ? AND giornata = ?");
        $stmt2->bind_param("ii", $leagueId, $g['giornata']);
        $stmt2->execute();
        $res2 = $stmt2->get_result();
        while ($row2 = $res2->fetch_assoc()) $voti_giornata[$row2['player_id']] = $row2['rating'];
        $titolari = [];
        $stmt3 = $conn->prepare("SELECT titolari FROM user_lineups WHERE user_id = ? AND league_id = ? AND giornata = ?");
        $stmt3->bind_param("iii", $uid, $leagueId, $g['giornata']);
        $stmt3->execute();
        $res3 = $stmt3->get_result();
        if ($row3 = $res3->fetch_assoc()) {
            $titolari_str = $row3['titolari'];
            if ($titolari_str && $titolari_str[0] === '[') $titolari = json_decode($titolari_str, true);
            else if ($titolari_str) $titolari = explode(',', $titolari_str);
        }
        if (!empty($titolari)) {
            foreach ($titolari as $pid) if (isset($voti_giornata[$pid])) $punti += $voti_giornata[$pid];
        }
        if ($punti > $miglior_punteggio) { $miglior_punteggio = $punti; $miglior_utente = $utente['username']; }
    }
}

// Recupera le squadre della lega
$teams = [];
$stmt = $conn->prepare("SELECT id, name FROM teams WHERE league_id = ? ORDER BY name");
$stmt->bind_param("i", $leagueId);
$stmt->execute();
$teams = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// Recupera i giocatori della lega
$players = [];
$stmt = $conn->prepare("SELECT p.id FROM players p JOIN teams t ON p.team_id = t.id WHERE t.league_id = ?");
$stmt->bind_param("i", $leagueId);
$stmt->execute();
$players = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo htmlspecialchars($league['name']); ?> - FantaCoppa</title>
    <meta http-equiv="refresh" content="300">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
    <link href="assets/css/app-ui.css" rel="stylesheet">
</head>
<body class="bg-light fc-league-page">
    <?php include 'navbar.php'; ?>
    <div class="container fc-page-container">
        <div class="d-flex align-items-center justify-content-between mb-3">
            <h4 class="mb-0 fw-bold text-dark"><i class="bi bi-house-door me-2 text-primary"></i>Dashboard Lega</h4>
        </div>
        <?php if (!empty($_SESSION['avviso_numero_titolari'])): ?>
        <div class="alert alert-warning alert-dismissible fade show mt-3" role="alert">
            <i class="bi bi-exclamation-triangle"></i> Il numero di titolari in campo è stato ridotto: le formazioni sono state aggiornate automaticamente per rispettare il nuovo limite. Controlla la tua formazione!
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Chiudi"></button>
        </div>
        <?php unset($_SESSION['avviso_numero_titolari']); endif; ?>
        <?php if ($error): ?>
            <div class="alert alert-danger"><?php echo htmlspecialchars($error); ?></div>
        <?php endif; ?>
        <?php if ($success): ?>
            <div class="alert alert-success"><?php echo htmlspecialchars($success); ?></div>
        <?php endif; ?>
        <div class="row mb-4">
            <div class="col-lg-8 mb-3">
                <div class="card card-league fc-league-card h-100">
                    <div class="card-header bg-primary text-white d-flex align-items-center">
                        <i class="bi bi-info-circle icon-league me-2"></i>
                        <h5 class="mb-0">Dettagli Lega</h5>
                    </div>
                    <div class="card-body py-3">
                        <h4 class="fc-league-title">
                            <i class="bi bi-trophy"></i> <?php echo htmlspecialchars($league['name']); ?>
                            <button class="btn btn-link p-0 ms-2 toggle-fav" id="favBtn" title="Preferita" tabindex="-1">
                                <i class="bi <?php echo $pref['favorite'] ? 'bi-star-fill text-warning' : 'bi-star'; ?>"></i>
                            </button>
                            <button class="btn btn-link p-0 ms-1 toggle-arch" id="archBtn" title="Archivia" tabindex="-1">
                                <i class="bi <?php echo $pref['archived'] ? 'bi-archive-fill text-secondary' : 'bi-archive'; ?>"></i>
                            </button>
                        </h4>
                        <div class="fc-league-quick-badges">
                            <span class="badge bg-secondary">ID: <?php echo $league['id']; ?></span>
                            <?php if ($league['access_code']): ?>
                                <span class="badge bg-info text-dark">Codice: <?php echo htmlspecialchars($league['access_code']); ?></span>
                            <?php endif; ?>
                            <span class="badge bg-info"><i class="bi bi-people"></i> Partecipanti: <?php echo count($members); ?></span>
                        </div>
                        <ul class="fc-league-stats-list">
                            <li><i class="bi bi-people"></i> Squadre: <b><?php echo count($teams); ?></b></li>
                            <li><i class="bi bi-person-lines-fill"></i> Giocatori: <b><?php echo count($players); ?></b></li>
                            <li><i class="bi bi-calendar-event"></i> Giornate: <b><?php echo count($giornate); ?></b></li>
                            <li><i class="bi bi-person-check"></i> Titolari in campo: <b><?php echo (int)$league['numero_titolari']; ?></b></li>
                            <li><i class="bi bi-shield-lock"></i> Max Portieri: <b><?php echo (int)$league['max_portieri']; ?></b> | <i class="bi bi-shield"></i> Max Difensori: <b><?php echo (int)$league['max_difensori']; ?></b> | <i class="bi bi-lightning-charge"></i> Max Centrocampisti: <b><?php echo (int)$league['max_centrocampisti']; ?></b> | <i class="bi bi-fire"></i> Max Attaccanti: <b><?php echo (int)$league['max_attaccanti']; ?></b></li>
                        </ul>
                    </div>
                </div>
            </div>
            <div class="col-lg-4 mb-3">
                <div class="card card-league fc-league-card h-100">
                    <div class="card-header bg-secondary text-dark d-flex align-items-center">
                        <i class="bi bi-people icon-league me-2"></i>
                        <h5 class="mb-0">Utenti della Lega</h5>
                    </div>
                    <div class="card-body p-2">
                        <ul class="list-group list-group-flush">
                        <?php
                        $stmt = $conn->prepare("SELECT lm.role, u.username FROM league_members lm JOIN users u ON lm.user_id = u.id WHERE lm.league_id = ? ORDER BY lm.role DESC, u.username ASC");
                        $stmt->bind_param("i", $leagueId);
                        $stmt->execute();
                        $members = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
                        foreach ($members as $member): ?>
                            <li class="list-group-item d-flex align-items-center py-2">
                                <span class="fw-bold me-2"><?php echo htmlspecialchars($member['username']); ?></span>
                                <span class="badge ms-auto <?php
                                    if ($member['role'] === 'admin') echo 'bg-primary';
                                    elseif ($member['role'] === 'pagellatore') echo 'bg-warning text-dark';
                                    else echo 'bg-success';
                                ?>">
                                    <?php if ($member['role'] === 'admin'): ?>Admin<?php elseif ($member['role'] === 'pagellatore'): ?>Pagellatore<?php else: ?>Utente<?php endif; ?>
                                </span>
                                <?php if ($member['username'] === $_SESSION['username'] && $member['role'] !== 'admin'): ?>
                                    <button id="leaveLeagueBtn" type="button" class="btn btn-link btn-sm text-danger leave-league-btn ms-2 p-0" style="font-size:0.95em;" title="Abbandona lega">
                                        <i class="bi bi-box-arrow-left"></i>
                                    </button>
                                <?php endif; ?>
                            </li>
                        <?php endforeach; ?>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        <div class="row mb-4">
            <div class="col-lg-4 mb-3">
                <div class="card h-100">
                    <div class="card-header bg-warning text-dark d-flex justify-content-between align-items-center">
                        <span><i class="bi bi-trophy"></i> Mini-classifica</span>
                        <button class="btn btn-sm btn-outline-warning" onclick="location.reload()" title="Aggiorna">
                            <i class="bi bi-arrow-clockwise"></i>
                        </button>
                    </div>
                    <div class="card-body p-2">
                        <ol class="mb-0 ps-3">
                        <?php for($i=0; $i<min(5,count($classifica_generale)); $i++): $row=$classifica_generale[$i]; ?>
                            <li class="mb-1 d-flex align-items-center">
                                <span class="fw-bold me-2"><?php echo ($i+1) . '. ' . $row['team_name']; ?></span>
                                <span class="badge bg-light text-dark ms-auto"><?php echo number_format($row['punteggio'],1); ?></span>
                            </li>
                        <?php endfor; ?>
                        </ol>
                    </div>
                </div>
            </div>
            <div class="col-lg-4 mb-3">
                <div class="card h-100">
                    <div class="card-header bg-info text-white d-flex justify-content-between align-items-center">
                        <span><i class="bi bi-calendar-event"></i> Prossima scadenza</span>
                        <button class="btn btn-sm btn-outline-info" onclick="location.reload()" title="Aggiorna">
                            <i class="bi bi-arrow-clockwise"></i>
                        </button>
                    </div>
                    <div class="card-body p-2">
                        <?php if($prossima): ?>
                            <div><b>Giornata <?php echo $prossima['giornata']; ?></b></div>
                            <div><i class="bi bi-clock"></i> <?php echo date('d/m/Y H:i', strtotime($prossima['deadline'])); ?></div>
                        <?php else: ?>
                            <div class="text-muted">Nessuna scadenza imminente</div>
                        <?php endif; ?>
                    </div>
                </div>
            </div>
            <div class="col-lg-4 mb-3">
                <div class="card h-100">
                    <div class="card-header bg-success text-white d-flex justify-content-between align-items-center">
                        <span><i class="bi bi-bar-chart"></i> Statistiche & Curiosità</span>
                        <button class="btn btn-sm btn-outline-success" onclick="location.reload()" title="Aggiorna">
                            <i class="bi bi-arrow-clockwise"></i>
                        </button>
                    </div>
                    <div class="card-body p-2">
                        <div><b>Miglior punteggio giornata:</b><br><?php echo $miglior_utente ? $miglior_utente.' ('.number_format($miglior_punteggio,1).')' : '—'; ?></div>
                        <!-- Altre curiosità/record qui -->
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <!-- Modal conferma abbandono lega -->
    <div class="modal fade" id="leaveLeagueModal" tabindex="-1" aria-labelledby="leaveLeagueModalLabel" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-danger text-white">
            <h5 class="modal-title" id="leaveLeagueModalLabel"><i class="bi bi-exclamation-triangle-fill me-2"></i>Conferma abbandono lega</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Chiudi"></button>
          </div>
          <div class="modal-body" id="leaveLeagueModalBody">
            <!-- Contenuto dinamico -->
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><i class="bi bi-x-circle"></i> Annulla</button>
            <button type="button" class="btn btn-danger" id="confirmLeaveLeagueBtn"><i class="bi bi-box-arrow-left"></i> Abbandona lega</button>
          </div>
        </div>
      </div>
    </div>
    <script>
    document.addEventListener('DOMContentLoaded', function() {
        const leaveBtn = document.getElementById('leaveLeagueBtn');
        const leaveModal = new bootstrap.Modal(document.getElementById('leaveLeagueModal'));
        const leaveBody = document.getElementById('leaveLeagueModalBody');
        const confirmBtn = document.getElementById('confirmLeaveLeagueBtn');
        if (leaveBtn) {
            leaveBtn.addEventListener('click', function() {
                fetch('leave_league.php?action=info&league_id=<?php echo $leagueId; ?>')
                    .then(res => res.json())
                    .then(data => {
                        if (data.only_user) {
                            leaveBody.innerHTML = '<p>Sei l\'unico utente di questa lega. <span class="text-danger fw-bold">Se confermi, la lega verrà eliminata definitivamente dal sistema.</span> Vuoi continuare?</p>';
                        } else {
                            leaveBody.innerHTML = 'Sei sicuro di voler abbandonare la lega?<br><span class="text-danger fw-bold">Tutti i tuoi dati relativi a questa lega verranno eliminati.</span>';
                        }
                        leaveModal.show();
                    });
            });
        }
        if (confirmBtn) {
            confirmBtn.addEventListener('click', function() {
                confirmBtn.disabled = true;
                confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Abbandono...';
                fetch('leave_league.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ league_id: <?php echo $leagueId; ?> })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        window.location.href = 'dashboard.php';
                    } else {
                        alert(data.error || 'Errore durante l\'uscita dalla lega.');
                        confirmBtn.disabled = false;
                        confirmBtn.innerHTML = '<i class="bi bi-box-arrow-left"></i> Abbandona lega';
                    }
                });
            });
        }
        // Preferito/archivia su singola lega
        const favBtn = document.getElementById('favBtn');
        const archBtn = document.getElementById('archBtn');
        let isFav = <?php echo $pref['favorite'] ? 'true' : 'false'; ?>;
        let isArch = <?php echo $pref['archived'] ? 'true' : 'false'; ?>;
        function updateIcons() {
            favBtn.querySelector('i').className = 'bi ' + (isFav ? 'bi-star-fill text-warning' : 'bi-star');
            archBtn.querySelector('i').className = 'bi ' + (isArch ? 'bi-archive-fill text-secondary' : 'bi-archive');
        }
        favBtn && favBtn.addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            isFav = !isFav;
            fetch('update_league_pref.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ league_id: <?php echo $leagueId; ?>, favorite: isFav ? 1 : 0, archived: isArch ? 1 : 0 })
            });
            updateIcons();
        });
        archBtn && archBtn.addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            isArch = !isArch;
            fetch('update_league_pref.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ league_id: <?php echo $leagueId; ?>, favorite: isFav ? 1 : 0, archived: isArch ? 1 : 0 })
            });
            updateIcons();
        });
    });
    </script>
</body>
</html>

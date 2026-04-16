<?php
require_once 'functions.php';
startSession();

if (!isLoggedIn()) {
    header('Location: index.php');
    exit();
}

$conn = getDbConnection();
$userId = getCurrentUserId();
$leagueId = isset($_GET['league_id']) ? (int)$_GET['league_id'] : null;
if (!$leagueId) {
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
// Check if market is blocked for this user
$marketBlockStatus = isMarketBlocked($userId, $leagueId);
// Recupera le squadre della lega
$teams = $conn->query("SELECT id FROM teams WHERE league_id = $leagueId");
$teamIds = [];
while ($row = $teams->fetch_assoc()) {
    $teamIds[] = $row['id'];
}
$rosa = [];
if ($teamIds) {
    $ids = implode(',', $teamIds);
    $res = $conn->query("SELECT p.*, t.name as team_name FROM players p JOIN teams t ON p.team_id = t.id WHERE p.team_id IN ($ids) AND p.id IN (SELECT player_id FROM user_players WHERE user_id = $userId) ORDER BY t.name, p.last_name");
    while ($gioc = $res->fetch_assoc()) {
        $rosa[] = $gioc;
    }
}
$roleMap = [
    'P' => 'Portiere',
    'D' => 'Difensore',
    'C' => 'Centrocampista',
    'A' => 'Attaccante'
];

$budget = 0;
$budgetRes = $conn->query("SELECT budget FROM user_budget WHERE user_id = $userId AND league_id = $leagueId");
if ($row = $budgetRes->fetch_assoc()) {
    $budget = $row['budget'];
}

// Calcola la valutazione totale della rosa
$valutazioneTotale = 0;
foreach ($rosa as $gioc) {
    $valutazioneTotale += $gioc['rating'];
}

// Calcola il conteggio attuale per ruolo
$conteggioRuolo = ['P' => 0, 'D' => 0, 'C' => 0, 'A' => 0];
foreach ($rosa as $gioc) {
    if (isset($conteggioRuolo[$gioc['role']])) {
        $conteggioRuolo[$gioc['role']]++;
    }
}

// Ordina la rosa per ruolo e cognome
$ruoloOrder = ['P' => 1, 'D' => 2, 'C' => 3, 'A' => 4];
if (!empty($rosa)) {
    usort($rosa, function($a, $b) use ($ruoloOrder) {
        if ($ruoloOrder[$a['role']] === $ruoloOrder[$b['role']]) {
            return strcmp($a['last_name'], $b['last_name']);
        }
        return $ruoloOrder[$a['role']] - $ruoloOrder[$b['role']];
    });
}

// Recupera i limiti per ruolo dalla tabella leagues
$limitiRuolo = [
    'P' => 3,
    'D' => 8,
    'C' => 8,
    'A' => 6
];
$stmt = $conn->prepare("SELECT max_portieri, max_difensori, max_centrocampisti, max_attaccanti FROM leagues WHERE id = ?");
$stmt->bind_param("i", $leagueId);
$stmt->execute();
$stmt->bind_result($maxP, $maxD, $maxC, $maxA);
if ($stmt->fetch()) {
    $limitiRuolo['P'] = $maxP;
    $limitiRuolo['D'] = $maxD;
    $limitiRuolo['C'] = $maxC;
    $limitiRuolo['A'] = $maxA;
}
$stmt->close();

// Gestione rimozione giocatore
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['remove_player_id'])) {
    // Check if market is blocked
    if ($marketBlockStatus['blocked']) {
        $message = '<div class="alert alert-warning">⚠️ Il mercato è attualmente bloccato dall\'amministratore, non puoi acquistare o svincolare giocatori.</div>';
    } else {
        $removePlayerId = (int)$_POST['remove_player_id'];
    // 1. Rimuovi da user_players
    $stmt = $conn->prepare("DELETE FROM user_players WHERE user_id = ? AND league_id = ? AND player_id = ?");
    $stmt->bind_param("iii", $userId, $leagueId, $removePlayerId);
    $stmt->execute();
    // 2. Aggiorna il budget (riaccredita il valore del giocatore)
    $stmt = $conn->prepare("SELECT rating FROM players WHERE id = ?");
    $stmt->bind_param("i", $removePlayerId);
    $stmt->execute();
    $stmt->bind_result($rating);
    if ($stmt->fetch()) {
        $stmt->close();
        $stmt = $conn->prepare("UPDATE user_budget SET budget = budget + ? WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("dii", $rating, $userId, $leagueId);
        $stmt->execute();
    } else {
        $stmt->close();
    }
    // 3. Togli il giocatore da tutte le formazioni dell'utente in quella lega
    $stmt = $conn->prepare("SELECT giornata, titolari, panchina FROM user_lineups WHERE user_id = ? AND league_id = ?");
    $stmt->bind_param("ii", $userId, $leagueId);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($row = $res->fetch_assoc()) {
        $titolari = $row['titolari'];
        $panchina = $row['panchina'];
        $giornata = $row['giornata'];
        $titolariArr = $titolari ? explode(',', $titolari) : [];
        $panchinaArr = $panchina ? explode(',', $panchina) : [];
        $titolariArr = array_filter($titolariArr, function($pid) use ($removePlayerId) { return $pid != $removePlayerId && $pid !== ''; });
        $panchinaArr = array_filter($panchinaArr, function($pid) use ($removePlayerId) { return $pid != $removePlayerId && $pid !== ''; });
        $stmt2 = $conn->prepare("UPDATE user_lineups SET titolari = ?, panchina = ? WHERE user_id = ? AND league_id = ? AND giornata = ?");
        $titolariStr = implode(',', $titolariArr);
        $panchinaStr = implode(',', $panchinaArr);
        $stmt2->bind_param("ssiii", $titolariStr, $panchinaStr, $userId, $leagueId, $giornata);
        $stmt2->execute();
        $stmt2->close();
    }
    $stmt->close();
    // Ricarica la pagina per aggiornare i dati
    header("Location: rosa.php?league_id=$leagueId");
    exit();
    }
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>La mia rosa - FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
    <link href="assets/css/app-ui.css" rel="stylesheet">
    <style>
        .badge-role-P { background: #0d6efd; }
        .badge-role-D { background: #198754; }
        .badge-role-C { background: #ffc107; color: #212529; }
        .badge-role-A { background: #dc3545; }
        .table-rosa tbody tr:hover { background: #f0f8ff; }
        .card-limiti {
            background: linear-gradient(90deg, #e3f2fd 0%, #f8f9fa 100%);
            border: 1px solid #b6d4fe;
        }
        .icon-role { font-size: 1.2em; vertical-align: middle; margin-right: 2px; }
        .btn-danger:disabled { 
            background-color: #6c757d !important; 
            border-color: #6c757d !important; 
            opacity: 0.6; 
        }
        @media (max-width: 575.98px) {
            h1, .card-header, .form-label, .btn, .form-control, .alert, .table th, .table td { font-size: 1em !important; }
            .btn, .btn-primary, .btn-outline-primary, .btn-sm { font-size: 0.95em !important; padding: 0.4em 0.7em; }
            .form-control, .form-control-sm { font-size: 0.95em !important; padding: 0.4em 0.7em; }
            .card, .card-sm { margin-bottom: 1rem !important; }
            .table th, .table td { padding: 0.4em 0.3em !important; }
            .table-rosa, .table-rosa th, .table-rosa td {
                font-size: 0.82em !important;
                padding: 0.08em 0.05em !important;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .table-rosa th, .table-rosa td {
                min-width: 24px;
                max-width: 60px;
            }
            .table-rosa td:first-child, .table-rosa th:first-child {
                padding-left: 0.5em !important;
            }
            /* Limiti ruoli ancora più compatti su mobile */
            .card-limiti .row,
            .card-limiti .d-flex,
            .card-limiti .d-grid {
                flex-direction: row !important;
                flex-wrap: nowrap !important;
                gap: 0.1em !important;
            }
            .card-limiti .col,
            .card-limiti .col-6,
            .card-limiti .col-md-3 {
                flex: 1 1 0 !important;
                max-width: 25% !important;
                min-width: 0 !important;
                margin-bottom: 0 !important;
                padding: 0.05em !important;
            }
            .card-limiti .badge,
            .card-limiti .btn,
            .card-limiti .form-text {
                font-size: 0.75em !important;
                padding: 0.08em 0.18em !important;
            }
            .card-limiti .bi {
                font-size: 0.95em !important;
                margin-right: 0.05em !important;
            }
            .card-limiti small,
            .card-limiti span,
            .card-limiti a {
                font-size: 0.75em !important;
            }
            .card-limiti .d-inline-block.d-sm-none {
                font-size: 0.78em !important;
                padding: 0.05em 0.1em !important;
            }
            .card-limiti .d-inline-block.d-sm-none small {
                font-size: 0.68em !important;
                color: #888 !important;
                padding-left: 0.1em;
            }
        }
    </style>
</head>
<body class="bg-light fc-squad-page">
<?php include 'navbar.php'; ?>
<div class="container fc-page-container">
    <div class="fc-squad-header">
        <h4 class="mb-0 fw-bold text-dark"><i class="bi bi-people me-2 text-primary"></i>La mia rosa</h4>
        <div class="d-flex flex-wrap gap-2">
            <span class="fc-squad-chip fc-squad-chip-budget"><i class="bi bi-cash-coin"></i> Budget: <?php echo number_format($budget, 2); ?></span>
            <span class="fc-squad-chip fc-squad-chip-value"><i class="bi bi-bar-chart"></i> Valore: <?php echo number_format($valutazioneTotale, 2); ?></span>
        </div>
    </div>
    
    <?php if ($marketBlockStatus['blocked']): ?>
        <div class="alert alert-warning alert-dismissible fade show" role="alert">
            ⚠️ <strong>Il mercato è attualmente bloccato dall'amministratore, non puoi acquistare o svincolare giocatori.</strong>
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    <?php endif; ?>
    
    <?php if (isset($message)): ?>
        <div class="alert alert-warning alert-dismissible fade show" role="alert">
            <?php echo $message; ?>
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    <?php endif; ?>
    <div class="card card-limiti fc-squad-limits-card mb-4 shadow-sm">
        <div class="card-body py-2">
            <div class="row text-center">
                <!-- MOBILE: icona+lettera+plus+conteggio sotto -->
                <div class="col-6 col-md-3 mb-2 mb-md-0 d-block d-sm-none">
                    <span class="badge badge-role-P" title="Portieri">
                        <i class="bi bi-shield-lock icon-role"></i> P
                    </span>
                    <a href="mercato.php?league_id=<?php echo $leagueId; ?>&ruolo=P" class="btn btn-sm btn-outline-primary ms-1 align-middle" title="Aggiungi Portiere"><i class="bi bi-plus"></i></a>
                    <div class="mt-1" style="line-height:1;">
                        <span><?php echo $conteggioRuolo['P']; ?>/<?php echo $limitiRuolo['P']; ?></span>
                        <small class="d-block">mancano <?php echo max(0, $limitiRuolo['P'] - $conteggioRuolo['P']); ?></small>
                    </div>
                </div>
                <div class="col-6 col-md-3 mb-2 mb-md-0 d-block d-sm-none">
                    <span class="badge badge-role-D" title="Difensori">
                        <i class="bi bi-shield icon-role"></i> D
                    </span>
                    <a href="mercato.php?league_id=<?php echo $leagueId; ?>&ruolo=D" class="btn btn-sm btn-outline-success ms-1 align-middle" title="Aggiungi Difensore"><i class="bi bi-plus"></i></a>
                    <div class="mt-1" style="line-height:1;">
                        <span><?php echo $conteggioRuolo['D']; ?>/<?php echo $limitiRuolo['D']; ?></span>
                        <small class="d-block">mancano <?php echo max(0, $limitiRuolo['D'] - $conteggioRuolo['D']); ?></small>
                    </div>
                </div>
                <div class="col-6 col-md-3 mb-2 mb-md-0 d-block d-sm-none">
                    <span class="badge badge-role-C" title="Centrocampisti">
                        <i class="bi bi-lightning-charge icon-role"></i> C
                    </span>
                    <a href="mercato.php?league_id=<?php echo $leagueId; ?>&ruolo=C" class="btn btn-sm btn-outline-warning ms-1 align-middle" title="Aggiungi Centrocampista"><i class="bi bi-plus"></i></a>
                    <div class="mt-1" style="line-height:1;">
                        <span><?php echo $conteggioRuolo['C']; ?>/<?php echo $limitiRuolo['C']; ?></span>
                        <small class="d-block">mancano <?php echo max(0, $limitiRuolo['C'] - $conteggioRuolo['C']); ?></small>
                    </div>
                </div>
                <div class="col-6 col-md-3 mb-2 mb-md-0 d-block d-sm-none">
                    <span class="badge badge-role-A" title="Attaccanti">
                        <i class="bi bi-fire icon-role"></i> A
                    </span>
                    <a href="mercato.php?league_id=<?php echo $leagueId; ?>&ruolo=A" class="btn btn-sm btn-outline-danger ms-1 align-middle" title="Aggiungi Attaccante"><i class="bi bi-plus"></i></a>
                    <div class="mt-1" style="line-height:1;">
                        <span><?php echo $conteggioRuolo['A']; ?>/<?php echo $limitiRuolo['A']; ?></span>
                        <small class="d-block">mancano <?php echo max(0, $limitiRuolo['A'] - $conteggioRuolo['A']); ?></small>
                    </div>
                </div>
                <!-- DESKTOP/TABLET: versione classica -->
                <div class="col-6 col-md-3 mb-2 mb-md-0 d-none d-sm-block">
                    <span class="badge badge-role-P"><i class="bi bi-shield-lock icon-role"></i> Portieri</span>
                    <span class="ms-1"> <?php echo $conteggioRuolo['P']; ?>/<?php echo $limitiRuolo['P']; ?> <small>(mancano <?php echo max(0, $limitiRuolo['P'] - $conteggioRuolo['P']); ?>)</small></span>
                    <a href="mercato.php?league_id=<?php echo $leagueId; ?>&ruolo=P" class="btn btn-sm btn-outline-primary ms-1" title="Aggiungi Portiere"><i class="bi bi-plus"></i></a>
                </div>
                <div class="col-6 col-md-3 mb-2 mb-md-0 d-none d-sm-block">
                    <span class="badge badge-role-D"><i class="bi bi-shield icon-role"></i> Difensori</span>
                    <span class="ms-1"> <?php echo $conteggioRuolo['D']; ?>/<?php echo $limitiRuolo['D']; ?> <small>(mancano <?php echo max(0, $limitiRuolo['D'] - $conteggioRuolo['D']); ?>)</small></span>
                    <a href="mercato.php?league_id=<?php echo $leagueId; ?>&ruolo=D" class="btn btn-sm btn-outline-success ms-1" title="Aggiungi Difensore"><i class="bi bi-plus"></i></a>
                </div>
                <div class="col-6 col-md-3 mb-2 mb-md-0 d-none d-sm-block">
                    <span class="badge badge-role-C"><i class="bi bi-lightning-charge icon-role"></i> Centrocampisti</span>
                    <span class="ms-1"> <?php echo $conteggioRuolo['C']; ?>/<?php echo $limitiRuolo['C']; ?> <small>(mancano <?php echo max(0, $limitiRuolo['C'] - $conteggioRuolo['C']); ?>)</small></span>
                    <a href="mercato.php?league_id=<?php echo $leagueId; ?>&ruolo=C" class="btn btn-sm btn-outline-warning ms-1" title="Aggiungi Centrocampista"><i class="bi bi-plus"></i></a>
                </div>
                <div class="col-6 col-md-3 mb-2 mb-md-0 d-none d-sm-block">
                    <span class="badge badge-role-A"><i class="bi bi-fire icon-role"></i> Attaccanti</span>
                    <span class="ms-1"> <?php echo $conteggioRuolo['A']; ?>/<?php echo $limitiRuolo['A']; ?> <small>(mancano <?php echo max(0, $limitiRuolo['A'] - $conteggioRuolo['A']); ?>)</small></span>
                    <a href="mercato.php?league_id=<?php echo $leagueId; ?>&ruolo=A" class="btn btn-sm btn-outline-danger ms-1" title="Aggiungi Attaccante"><i class="bi bi-plus"></i></a>
                </div>
            </div>
        </div>
    </div>
    <div class="card fc-squad-table-card mb-4 shadow">
        <div class="card-header bg-primary text-white d-flex align-items-center">
            <i class="bi bi-person-lines-fill me-2"></i>
            <h5 class="mb-0">Rosa personale</h5>
        </div>
        <div class="card-body p-0">
            <div class="table-responsive">
                <table class="table table-sm table-rosa mb-0 align-middle">
                    <thead class="table-light">
                        <tr>
                            <th>Nome</th>
                            <th>Cognome</th>
                            <th>Squadra</th>
                            <th>Ruolo</th>
                            <th>Valutazione</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php if (empty($rosa)) {
                            echo '<tr><td colspan="6" class="text-center text-muted">Nessun giocatore acquistato.<br><a href="mercato.php?league_id=' . $leagueId . '" class="btn btn-success mt-2"><i class="bi bi-bag"></i> Vai al Mercato</a></td></tr>';
                        } else {
                            $lastRole = null;
                            foreach ($rosa as $gioc):
                                if ($gioc['role'] !== $lastRole):
                                    if ($lastRole !== null):
                                        // Riga di separazione
                                        echo '<tr><td colspan="6" style="height:18px;"></td></tr>';
                                    endif;
                                    // Intestazione del ruolo
                                    echo '<tr class="table-secondary"><td colspan="6"><b>' . $roleMap[$gioc['role']] . '</b></td></tr>';
                                    $lastRole = $gioc['role'];
                                endif;
                        ?>
                                <tr>
                                    <td><?php echo htmlspecialchars($gioc['first_name']); ?></td>
                                    <td><?php echo htmlspecialchars($gioc['last_name']); ?></td>
                                    <td><?php echo htmlspecialchars($gioc['team_name']); ?></td>
                                    <td>
                                        <span class="badge badge-role-<?php echo $gioc['role']; ?>" title="<?php echo $roleMap[$gioc['role']]; ?>">
                                            <?php
                                            if ($gioc['role'] === 'P') echo '<i class="bi bi-shield-lock"></i>';
                                            elseif ($gioc['role'] === 'D') echo '<i class="bi bi-shield"></i>';
                                            elseif ($gioc['role'] === 'C') echo '<i class="bi bi-lightning-charge"></i>';
                                            elseif ($gioc['role'] === 'A') echo '<i class="bi bi-fire"></i>';
                                            ?>
                                            <?php echo $gioc['role']; ?>
                                        </span>
                                    </td>
                                    <td><?php echo number_format($gioc['rating'], 2); ?></td>
                                    <td>
                                        <button type="button" class="btn btn-sm btn-danger" title="Rimuovi giocatore" data-bs-toggle="modal" data-bs-target="#removePlayerModal" data-player-id="<?php echo $gioc['id']; ?>" data-player-name="<?php echo htmlspecialchars($gioc['first_name'] . ' ' . $gioc['last_name']); ?>" <?php if ($marketBlockStatus['blocked']) echo 'disabled'; ?>>
                                            <i class="bi bi-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                        <?php endforeach;
                        } ?>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</div>
<!-- Modal conferma rimozione giocatore -->
<div class="modal fade" id="removePlayerModal" tabindex="-1" aria-labelledby="removePlayerModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-header bg-danger text-white">
        <h5 class="modal-title" id="removePlayerModalLabel"><i class="bi bi-exclamation-triangle-fill me-2"></i>Conferma rimozione giocatore</h5>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Chiudi"></button>
      </div>
      <div class="modal-body">
        <div class="mb-2">
          <span id="removePlayerModalText">Sei sicuro di voler rimuovere questo giocatore dalla tua rosa? Verrà tolto anche da tutte le tue formazioni!</span>
        </div>
        <div class="alert alert-warning mb-0 py-2 px-3"><i class="bi bi-info-circle"></i> Questa azione è irreversibile.</div>
      </div>
      <div class="modal-footer">
        <form method="POST" id="removePlayerForm">
          <input type="hidden" name="remove_player_id" id="removePlayerIdInput">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><i class="bi bi-x-circle"></i> Annulla</button>
          <button type="submit" class="btn btn-danger"><i class="bi bi-trash"></i> Rimuovi</button>
        </form>
      </div>
    </div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function() {
    var removePlayerModal = document.getElementById('removePlayerModal');
    removePlayerModal.addEventListener('show.bs.modal', function (event) {
        var button = event.relatedTarget;
        var playerId = button.getAttribute('data-player-id');
        var playerName = button.getAttribute('data-player-name');
        document.getElementById('removePlayerIdInput').value = playerId;
        document.getElementById('removePlayerModalText').innerHTML = 'Sei sicuro di voler rimuovere <b>' + playerName + '</b> dalla tua rosa? Verrà tolto anche da tutte le tue formazioni!';
    });
});
</script>
</body>
</html> 
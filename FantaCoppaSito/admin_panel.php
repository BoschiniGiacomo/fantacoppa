<?php

require_once 'functions.php';

startSession();



// Check if user is logged in and is an admin

if (!isset($_SESSION['user_id']) || !isUserAdmin($_SESSION['user_id'])) {

    header('Location: index.php');

    exit();

}



// Get league ID

$leagueId = $_GET['league_id'] ?? null;

if (!$leagueId) {

    header('Location: dashboard.php');

    exit();

}



// Verify user has admin role in this league

$userRole = getUserRoleInLeague($_SESSION['user_id'], $leagueId);

if ($userRole !== 'admin') {

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

$message = '';



// Handle team addition

if (isset($_POST['add_team'])) {

    $name = $conn->real_escape_string($_POST['team_name']);

    $leagueId = (int)$_GET['league_id'];

    try {

        $conn->query("INSERT INTO teams (name, league_id) VALUES ('$name', $leagueId)");

        $message = "Squadra aggiunta con successo!";

    } catch (Exception $e) {

        $message = "Errore: Nome squadra già esistente.";

    }

}



// Handle team update

if (isset($_POST['update_team'])) {

    $id = (int)$_POST['team_id'];

    $name = $conn->real_escape_string($_POST['team_name']);

    try {

        $conn->query("UPDATE teams SET name = '$name' WHERE id = $id");

        $message = "Squadra aggiornata con successo!";

    } catch (Exception $e) {

        $message = "Errore durante l'aggiornamento della squadra.";

    }

}



// Handle team deletion

if (isset($_POST['delete_team'])) {

    $id = (int)$_POST['team_id'];

    try {

        $conn->query("DELETE FROM teams WHERE id = $id");

        $message = "Squadra eliminata con successo!";

    } catch (Exception $e) {

        $message = "Errore durante l'eliminazione della squadra.";

    }

}



// Handle player addition

if (isset($_POST['add_player'])) {

    $first = $conn->real_escape_string($_POST['first_name']);

    $last = $conn->real_escape_string($_POST['last_name']);

    $team = (int) $_POST['team_id'];

    $rating = (float) $_POST['rating'];

    $role = $conn->real_escape_string($_POST['role']);



    try {

        $sql = "INSERT INTO players (first_name, last_name, team_id, rating, role)

                VALUES ('$first', '$last', $team, $rating, '$role')";

        $conn->query($sql);

        $message = "Calciatore aggiunto con successo!";

    } catch (Exception $e) {

        $message = "Errore durante l'inserimento del calciatore.";

    }

}



// Handle player update

if (isset($_POST['update_player'])) {

    $id = (int)$_POST['player_id'];

    $first = $conn->real_escape_string($_POST['first_name']);

    $last = $conn->real_escape_string($_POST['last_name']);

    $team = (int) $_POST['team_id'];

    $rating = (float) $_POST['rating'];

    $role = $conn->real_escape_string($_POST['role']);



    // Controlla se il giocatore è già stato acquistato da qualche utente

    $checkPurchased = $conn->query("SELECT COUNT(*) as count FROM user_players up 

                                   JOIN players p ON up.player_id = p.id 

                                   JOIN teams t ON p.team_id = t.id 

                                   WHERE up.player_id = $id AND t.league_id = $leagueId");

    $purchasedCount = $checkPurchased->fetch_assoc()['count'];



    if ($purchasedCount > 0) {

        // Se è stato acquistato, permette solo la modifica di nome, cognome e squadra

        try {

            $sql = "UPDATE players SET 

                    first_name = '$first',

                    last_name = '$last',

                    team_id = $team

                    WHERE id = $id";

            $conn->query($sql);

            $message = "Calciatore aggiornato con successo! (Rating e ruolo non modificabili - giocatore già acquistato)";

        } catch (Exception $e) {

            $message = "Errore durante l'aggiornamento del calciatore.";

        }

    } else {

        // Se non è stato acquistato, permette la modifica di tutti i campi

        try {

            $sql = "UPDATE players SET 

                    first_name = '$first',

                    last_name = '$last',

                    team_id = $team,

                    rating = $rating,

                    role = '$role'

                    WHERE id = $id";

            $conn->query($sql);

            $message = "Calciatore aggiornato con successo!";

        } catch (Exception $e) {

            $message = "Errore durante l'aggiornamento del calciatore.";

        }

    }

}



// Handle player deletion

if (isset($_POST['delete_player'])) {

    $id = (int)$_POST['player_id'];

    
    
    try {

        // Prima di eliminare, trova tutti gli utenti che hanno acquistato questo giocatore

        $affectedUsers = $conn->query("SELECT up.user_id, up.league_id, p.rating 

                                      FROM user_players up 

                                      JOIN players p ON up.player_id = p.id 

                                      WHERE up.player_id = $id");
        
        

        $refundedUsers = [];

        
        
        // Riaccredita il budget per ogni utente che aveva acquistato il giocatore

        while ($user = $affectedUsers->fetch_assoc()) {

            $userId = $user['user_id'];

            $leagueId = $user['league_id'];

            $rating = $user['rating'];

            
            
            // Aggiorna il budget dell'utente

            $conn->query("UPDATE user_budget SET budget = budget + $rating 

                         WHERE user_id = $userId AND league_id = $leagueId");
            
            

            $refundedUsers[] = $userId;

        }

        
        
        // Rimuovi il giocatore dalle rose di tutti gli utenti

        $conn->query("DELETE FROM user_players WHERE player_id = $id");

        
        
        // Rimuovi il giocatore da tutte le formazioni degli utenti che lo avevano

        if (!empty($refundedUsers)) {

            $userIds = implode(',', $refundedUsers);

            $conn->query("UPDATE user_lineups SET 

                         titolari = REPLACE(titolari, ',$id,', ',') 

                         WHERE user_id IN ($userIds)");

            $conn->query("UPDATE user_lineups SET 

                         panchina = REPLACE(panchina, ',$id,', ',') 

                         WHERE user_id IN ($userIds)");

        }

        
        
        // Ora elimina il giocatore

        $conn->query("DELETE FROM players WHERE id = $id");

        
        
        // Prepara il messaggio di conferma

        if (count($refundedUsers) > 0) {

            $message = "Calciatore eliminato con successo! Budget riaccreditato a " . count($refundedUsers) . " utente/i.";

        } else {

            $message = "Calciatore eliminato con successo!";

        }
        
        

    } catch (Exception $e) {

        $message = "Errore durante l'eliminazione del calciatore: " . $e->getMessage();

    }

}



// Get all teams for the dropdown

$leagueId = (int)$_GET['league_id'];

$teams = $conn->query("SELECT id, name FROM teams WHERE league_id = $leagueId ORDER BY name");



// Check if user is logged in e admin nella lega corrente

if (!isset($_SESSION['user_id']) || !isUserAdminInLeague($_SESSION['user_id'], $leagueId)) {

    header('Location: index.php');

    exit();

}



// --- IMPORT CSV LOGIC ---

$csvPreview = null;
$csvType = '';
$csvError = '';

if (isset($_POST['import_csv']) && isset($_FILES['csv_file']) && $_FILES['csv_file']['error'] === UPLOAD_ERR_OK) {
    // ... codice import CSV ...
}

if (isset($_POST['confirm_import_csv']) && isset($_POST['csv_type']) && isset($_POST['csv_data'])) {
    // ... codice conferma import CSV ...
}

?>



<!DOCTYPE html>

<html lang="it">

<head>

    <meta charset="UTF-8">

    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>Pannello Amministratore - FantaCoppa</title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">

    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.2/font/bootstrap-icons.css" rel="stylesheet">

    <!-- Choices.js CSS -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/choices.js/public/assets/styles/choices.min.css" />
    <style>
    @media (max-width: 767.98px) {
      .row { flex-direction: column !important; }
      .col-md-6 { width: 100% !important; max-width: 100% !important; }
      .card-admin { margin-bottom: 0.7rem !important; }
      .card-header, h1, h5, .form-label, .btn, .form-control, .form-select, .alert, .table th, .table td {
        font-size: 0.92em !important;
      }
      .btn, .btn-primary, .btn-outline-primary, .btn-sm {
        font-size: 0.91em !important;
        padding: 0.32em 0.6em !important;
      }
      .form-control, .form-control-sm, .form-select, .form-select-sm {
        font-size: 0.91em !important;
        padding: 0.32em 0.6em !important;
        min-height: 1.8em !important;
        height: 2em !important;
      }
      .form-select, .form-select-sm {
        min-width: 80px !important;
        max-width: 100% !important;
      }
      .choices__inner {
        min-height: 1.7em !important;
        font-size: 0.92em !important;
        padding: 0.2em 0.5em !important;
      }
      .choices__list--dropdown, .choices__list[aria-expanded] {
        font-size: 0.95em !important;
      }
      .table th, .table td {
        padding: 0.28em 0.18em !important;
      }
      .mb-3, .my-3, .mb-4, .my-4 { margin-bottom: 0.5rem !important; margin-top: 0 !important; }
      .container { padding-left: 0.2rem !important; padding-right: 0.2rem !important; }
    }
    @media (max-width: 575.98px) {
      h1, .card-header, .form-label, .btn, .form-control, .form-select, .alert, .table th, .table td { font-size: 0.89em !important; }
      .btn, .btn-primary, .btn-outline-primary, .btn-sm { font-size: 0.88em !important; padding: 0.22em 0.5em !important; }
      .form-control, .form-control-sm, .form-select, .form-select-sm { font-size: 0.88em !important; padding: 0.15em 0.5em !important; min-height: 1.5em !important; height: 1.7em !important; }
      .form-select, .form-select-sm { min-width: 60px !important; max-width: 100% !important; width: 100% !important; line-height: 1.1 !important; border-radius: 0.3em !important; }
      .form-select:focus, .form-select-sm:focus { box-shadow: none !important; border-color: #b6d4fe !important; }
      .choices__inner {
        min-height: 1.5em !important;
        font-size: 0.88em !important;
        padding: 0.15em 0.5em !important;
      }
      .choices__list--dropdown, .choices__list[aria-expanded] {
        font-size: 0.92em !important;
      }
      .card, .card-sm { margin-bottom: 0.5rem !important; }
      .table th, .table td { padding: 0.22em 0.12em !important; }
      .container { padding-left: 0.1rem !important; padding-right: 0.1rem !important; }
    }
    </style>

</head>

<body>

    <?php include 'navbar.php'; ?>



    <div class="container mt-4">

        <div class="d-flex justify-content-between align-items-center mb-4">

            <h1>Pannello Amministratore</h1>

        </div>

        
        
        <?php if ($message): ?>

            <div class="alert alert-info"><?php echo $message; ?></div>

        <?php endif; ?>



        <!-- List of Teams and Players -->

        <div class="row mt-4">

            <div class="col-md-6">

                <div class="card">

                    <div class="card-header">

                        <h3>Squadre</h3>

                    </div>

                    <div class="card-body">

                        <div class="table-responsive">

                            <table class="table">

                                <thead>

                                    <tr>

                                        <th>Nome</th>

                                        <th>Calciatori</th>

                                        <th>Azioni</th>

                                    </tr>

                                </thead>

                                <tbody>

                                    <?php

                                    $teams = $conn->query("SELECT t.*, COUNT(p.id) as player_count 

                                                         FROM teams t 

                                                         LEFT JOIN players p ON t.id = p.team_id 

                                                         GROUP BY t.id 

                                                         ORDER BY t.name");

                                    while ($team = $teams->fetch_assoc()):

                                    ?>

                                    <tr>

                                        <td>

                                            <form method="POST" action="admin_panel.php?league_id=<?php echo $leagueId; ?>" class="d-inline">

                                                <input type="hidden" name="team_id" value="<?php echo $team['id']; ?>">

                                                <input type="text" name="team_name" value="<?php echo htmlspecialchars($team['name']); ?>" 

                                                       class="form-control form-control-sm d-inline-block" style="width: auto;">

                                                <button type="submit" name="update_team" class="btn btn-sm btn-primary">

                                                    <i class="bi bi-pencil"></i>

                                                </button>

                                            </form>

                                        </td>

                                        <td><?php echo $team['player_count']; ?></td>

                                        <td>

                                            <button type="button" class="btn btn-sm btn-danger delete-team-btn"

                                                    data-team-id="<?php echo $team['id']; ?>"

                                                    data-team-name="<?php echo htmlspecialchars($team['name']); ?>">

                                                <i class="bi bi-trash"></i>

                                            </button>

                                        </td>

                                    </tr>

                                    <?php endwhile; ?>

                                </tbody>

                            </table>

                        </div>

                    </div>

                </div>

            </div>



            <div class="col-md-6">

                <div class="card">

                    <div class="card-header">

                        <h3>Calciatori</h3>

                    </div>

                    <div class="card-body">

                        <div class="table-responsive">

                            <table class="table">

                                <thead>

                                    <tr>

                                        <th>Nome</th>

                                        <th>Squadra</th>

                                        <th class="text-center" style="width: 80px;">Ruolo</th>

                                        <th class="text-center" style="width: 100px;">Valutazione</th>

                                        <th class="text-center" style="width: 100px;">Azioni</th>

                                    </tr>

                                </thead>

                                <tbody>

                                    <?php

                                    $players = $conn->query("SELECT p.*, t.name as team_name FROM players p JOIN teams t ON p.team_id = t.id WHERE t.league_id = $leagueId ORDER BY t.name, p.last_name");

                                    while ($player = $players->fetch_assoc()):

                                        // Mappa dei ruoli per le iniziali

                                        $roleMap = [

                                            'P' => 'Portiere',

                                            'D' => 'Difensore',

                                            'C' => 'Centrocampista',

                                            'A' => 'Attaccante'

                                        ];

                                        

                                        // Controlla se il giocatore è già stato acquistato

                                        $checkPurchased = $conn->query("SELECT COUNT(*) as count FROM user_players up 

                                                                       JOIN players p2 ON up.player_id = p2.id 

                                                                       JOIN teams t2 ON p2.team_id = t2.id 

                                                                       WHERE up.player_id = {$player['id']} AND t2.league_id = $leagueId");

                                        $purchasedCount = $checkPurchased->fetch_assoc()['count'];

                                        $isPurchased = $purchasedCount > 0;

                                    ?>

                                    <form method="POST" action="admin_panel.php?league_id=<?php echo $leagueId; ?>" class="d-inline">

                                    <tr <?php if ($isPurchased): ?>class="table-warning"<?php endif; ?>>

                                        <td>

                                            <input type="hidden" name="player_id" value="<?php echo $player['id']; ?>">

                                            <div class="input-group input-group-sm">

                                                <input type="text" name="first_name" value="<?php echo htmlspecialchars($player['first_name']); ?>" 

                                                       class="form-control form-control-sm" placeholder="Nome" style="width: 100px;">

                                                <input type="text" name="last_name" value="<?php echo htmlspecialchars($player['last_name']); ?>" 

                                                       class="form-control form-control-sm" placeholder="Cognome" style="width: 120px;">

                                            </div>

                                        </td>

                                        <td>

                                            <select name="team_id" class="form-select form-select-sm" style="min-width: 200px;">

                                                <?php

                                                $teams2 = $conn->query("SELECT id, name FROM teams ORDER BY name");

                                                while ($team = $teams2->fetch_assoc()):

                                                ?>

                                                <option value="<?php echo $team['id']; ?>" 

                                                        <?php echo $team['id'] == $player['team_id'] ? 'selected' : ''; ?>>

                                                    <?php echo htmlspecialchars($team['name']); ?>

                                                </option>

                                                <?php endwhile; ?>

                                            </select>

                                        </td>

                                        <td class="text-center">

                                            <select name="role" class="form-select form-select-sm" title="<?php echo $roleMap[$player['role']]; ?>" <?php if ($isPurchased): ?>disabled<?php endif; ?>>

                                                <option value="P" <?php echo $player['role'] === 'P' ? 'selected' : ''; ?>>P</option>

                                                <option value="D" <?php echo $player['role'] === 'D' ? 'selected' : ''; ?>>D</option>

                                                <option value="C" <?php echo $player['role'] === 'C' ? 'selected' : ''; ?>>C</option>

                                                <option value="A" <?php echo $player['role'] === 'A' ? 'selected' : ''; ?>>A</option>

                                            </select>

                                            <?php if ($isPurchased): ?>

                                                <small class="text-warning d-block"><i class="bi bi-exclamation-triangle"></i> Già acquistato</small>

                                            <?php endif; ?>

                                        </td>

                                        <td class="text-center">

                                            <input type="number" name="rating" value="<?php echo $player['rating']; ?>" 

                                                   class="form-control form-control-sm" min="1" max="10" step="0.5" style="width: 60px;" <?php if ($isPurchased): ?>disabled<?php endif; ?>>

                                        </td>

                                        <td class="text-center">

                                            <button type="submit" name="update_player" class="btn btn-sm btn-primary">

                                                <i class="bi bi-pencil"></i>

                                            </button>

                                            <button type="button" class="btn btn-sm btn-danger delete-player-btn"

                                                    data-player-id="<?php echo $player['id']; ?>"

                                                    data-player-name="<?php echo htmlspecialchars($player['first_name'] . ' ' . $player['last_name']); ?>"

                                                    data-purchased="<?php echo $isPurchased ? '1' : '0'; ?>"

                                                    data-purchased-count="<?php echo $purchasedCount; ?>">

                                                <i class="bi bi-trash"></i>

                                            </button>

                                        </td>

                                    </tr>

                                    </form>

                                    <?php endwhile; ?>

                                </tbody>

                            </table>

                        </div>

                    </div>

                </div>

            </div>

        </div>

    </div>



    <!-- Modal conferma eliminazione calciatore -->

    <div class="modal fade" id="deletePlayerModal" tabindex="-1" aria-labelledby="deletePlayerModalLabel" aria-hidden="true">

      <div class="modal-dialog modal-dialog-centered">

        <div class="modal-content">

          <div class="modal-header bg-danger text-white">

            <h5 class="modal-title" id="deletePlayerModalLabel"><i class="bi bi-exclamation-triangle-fill me-2"></i>Conferma eliminazione calciatore</h5>

            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Chiudi"></button>

          </div>

          <div class="modal-body">

            <div id="deletePlayerModalText"></div>

            <div id="deletePlayerModalWarning" class="alert alert-warning mb-0 py-2 px-3 d-none"><i class="bi bi-info-circle"></i> Il budget verrà riaccreditato automaticamente agli utenti che lo hanno acquistato.</div>

          </div>

          <div class="modal-footer">

            <form method="POST" id="deletePlayerForm">

              <input type="hidden" name="player_id" id="deletePlayerIdInput">

              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><i class="bi bi-x-circle"></i> Annulla</button>

              <button type="submit" name="delete_player" class="btn btn-danger"><i class="bi bi-trash"></i> Elimina</button>

            </form>

          </div>

        </div>

      </div>

    </div>



    <!-- Modal conferma eliminazione squadra -->

    <div class="modal fade" id="deleteTeamModal" tabindex="-1" aria-labelledby="deleteTeamModalLabel" aria-hidden="true">

      <div class="modal-dialog modal-dialog-centered">

        <div class="modal-content">

          <div class="modal-header bg-danger text-white">

            <h5 class="modal-title" id="deleteTeamModalLabel"><i class="bi bi-exclamation-triangle-fill me-2"></i>Conferma eliminazione squadra</h5>

            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Chiudi"></button>

          </div>

          <div class="modal-body">

            <span id="deleteTeamModalText">Sei sicuro di voler eliminare questa squadra? Verranno eliminati anche tutti i suoi calciatori.</span>

            <div class="alert alert-warning mb-0 py-2 px-3 mt-3"><i class="bi bi-info-circle"></i> Questa azione è irreversibile.</div>

          </div>

          <div class="modal-footer">

            <form method="POST" id="deleteTeamForm">

              <input type="hidden" name="team_id" id="deleteTeamIdInput">

              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><i class="bi bi-x-circle"></i> Annulla</button>

              <button type="submit" name="delete_team" class="btn btn-danger"><i class="bi bi-trash"></i> Elimina</button>

            </form>

          </div>

        </div>

      </div>

    </div>



    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>

    <script src="https://cdn.jsdelivr.net/npm/choices.js/public/assets/scripts/choices.min.js"></script>

    <script>

        document.addEventListener('DOMContentLoaded', function() {

            // Gestione rotazione icone

            const collapseElements = document.querySelectorAll('.collapse');

            collapseElements.forEach(element => {

                element.addEventListener('show.bs.collapse', function() {

                    this.previousElementSibling.querySelector('.bi-chevron-down').style.transform = 'rotate(180deg)';

                });

                element.addEventListener('hide.bs.collapse', function() {

                    this.previousElementSibling.querySelector('.bi-chevron-down').style.transform = 'rotate(0deg)';

                });

            });



            // Aggiungi transizione fluida alle icone

            const icons = document.querySelectorAll('.bi-chevron-down');

            icons.forEach(icon => {

                icon.style.transition = 'transform 0.3s ease';

            });



            // Gestione modale eliminazione calciatore

            document.querySelectorAll('.delete-player-btn').forEach(function(btn) {

                btn.addEventListener('click', function() {

                    var playerId = btn.getAttribute('data-player-id');

                    var playerName = btn.getAttribute('data-player-name');

                    var isPurchased = btn.getAttribute('data-purchased') === '1';

                    var purchasedCount = btn.getAttribute('data-purchased-count');

                    document.getElementById('deletePlayerIdInput').value = playerId;

                    var text = 'Sei sicuro di voler eliminare <b>' + playerName + '</b>?';

                    if (isPurchased) {

                        text = '<span class="text-danger fw-bold">ATTENZIONE:</span> Questo giocatore è già stato acquistato da ' + purchasedCount + ' utente/i.<br>' + text;

                        document.getElementById('deletePlayerModalWarning').classList.remove('d-none');

                    } else {

                        document.getElementById('deletePlayerModalWarning').classList.add('d-none');

                    }

                    document.getElementById('deletePlayerModalText').innerHTML = text;

                    var modal = new bootstrap.Modal(document.getElementById('deletePlayerModal'));

                    modal.show();

                });

            });



            // Gestione modale eliminazione squadra

            document.querySelectorAll('.delete-team-btn').forEach(function(btn) {

                btn.addEventListener('click', function() {

                    var teamId = btn.getAttribute('data-team-id');

                    var teamName = btn.getAttribute('data-team-name');

                    document.getElementById('deleteTeamIdInput').value = teamId;

                    document.getElementById('deleteTeamModalText').innerHTML = 'Sei sicuro di voler eliminare la squadra <b>' + teamName + '</b>? Verranno eliminati anche tutti i suoi calciatori.';

                    var modal = new bootstrap.Modal(document.getElementById('deleteTeamModal'));

                    modal.show();

                });

            });



            // Gestione popover

            var popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));

            popoverTriggerList.map(function (popoverTriggerEl) {

                return new bootstrap.Popover(popoverTriggerEl, {

                    html: true,

                    container: 'body'

                });

            });



            // Applica Choices.js solo alle select delle card admin
            document.querySelectorAll('.card-admin select.form-select, .card-admin select.form-select-sm').forEach(function(sel) {
                new Choices(sel, {
                    searchEnabled: false,
                    itemSelectText: '',
                    shouldSort: false,
                    position: 'bottom',
                    classNames: {
                        containerOuter: 'choices choices--mobile'
                    }
                });
            });

        });

    </script>

</body>

</html> 

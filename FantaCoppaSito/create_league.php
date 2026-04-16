<?php
require_once 'functions.php';
require_once 'db.php';
startSession();

if (!isLoggedIn()) {
    header('Location: index.php');
    exit();
}

$error = '';
$success = '';

// --- Funzione robusta per decimali ---
function parse_decimal($val, $default) {
    if (!isset($val) || $val === '') return $default;
    $val = str_replace(',', '.', trim($val));
    if (!is_numeric($val)) return $default;
    return round(floatval($val), 1);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $name = trim($_POST['league_name'] ?? '');
    $accessCode = !empty($_POST['access_code']) ? trim($_POST['access_code']) : null;
    $initialBudget = isset($_POST['initial_budget']) ? (int)$_POST['initial_budget'] : 100;
    $defaultTime = $_POST['default_time'] ?? '20:00';
    $maxPortieri = isset($_POST['max_portieri']) ? (int)$_POST['max_portieri'] : 3;
    $maxDifensori = isset($_POST['max_difensori']) ? (int)$_POST['max_difensori'] : 8;
    $maxCentrocampisti = isset($_POST['max_centrocampisti']) ? (int)$_POST['max_centrocampisti'] : 8;
    $maxAttaccanti = isset($_POST['max_attaccanti']) ? (int)$_POST['max_attaccanti'] : 6;
    $numeroTitolari = isset($_POST['numero_titolari']) ? (int)$_POST['numero_titolari'] : 11;
    $auto_lineup_mode = isset($_POST['auto_lineup_mode']) ? (int)$_POST['auto_lineup_mode'] : 0;
    // Team name and coach name will be set in team selection page
    // Bonus/malus
    $bonus_settings = [
        'enable_bonus_malus' => isset($_POST['enable_bonus_malus']) ? 1 : 0,
        'enable_goal' => isset($_POST['enable_goal']) ? 1 : 0,
        'bonus_goal' => parse_decimal($_POST['bonus_goal'] ?? null, 3.0),
        'enable_assist' => isset($_POST['enable_assist']) ? 1 : 0,
        'bonus_assist' => parse_decimal($_POST['bonus_assist'] ?? null, 1.0),
        'enable_yellow_card' => isset($_POST['enable_yellow_card']) ? 1 : 0,
        'malus_yellow_card' => parse_decimal($_POST['malus_yellow_card'] ?? null, -0.5),
        'enable_red_card' => isset($_POST['enable_red_card']) ? 1 : 0,
        'malus_red_card' => parse_decimal($_POST['malus_red_card'] ?? null, -1.0),
        'enable_goals_conceded' => isset($_POST['enable_goals_conceded']) ? 1 : 0,
        'malus_goals_conceded' => parse_decimal($_POST['malus_goals_conceded'] ?? null, -1.0),
        'enable_own_goal' => isset($_POST['enable_own_goal']) ? 1 : 0,
        'malus_own_goal' => parse_decimal($_POST['malus_own_goal'] ?? null, -2.0),
        'enable_penalty_missed' => isset($_POST['enable_penalty_missed']) ? 1 : 0,
        'malus_penalty_missed' => parse_decimal($_POST['malus_penalty_missed'] ?? null, -3.0),
        'enable_penalty_saved' => isset($_POST['enable_penalty_saved']) ? 1 : 0,
        'bonus_penalty_saved' => parse_decimal($_POST['bonus_penalty_saved'] ?? null, 3.0),
        'enable_clean_sheet' => isset($_POST['enable_clean_sheet']) ? 1 : 0,
        'bonus_clean_sheet' => parse_decimal($_POST['bonus_clean_sheet'] ?? null, 1.0)
    ];
    if ($name === '' || $initialBudget < 1) {
        $error = 'Compila tutti i campi obbligatori.';
    } else {
        // Check if league name already exists
        $stmt = $conn->prepare("SELECT 1 FROM leagues WHERE name = ?");
        $stmt->bind_param("s", $name);
        $stmt->execute();
     
        if ($stmt->get_result()->num_rows > 0) {
            $error = 'Esiste già una lega con questo nome. Scegli un nome diverso.';
        } else{
            $stmt->close();
               // Check if league codice already exists
        $stmt = $conn->prepare("SELECT 1 FROM leagues WHERE access_code = ?");
        $stmt->bind_param("s", $accessCode);
        $stmt->execute();
         if($stmt->get_result()->num_rows > 0) {
            $error = 'Esiste già una lega con questo codice. Scegli un codice diverso.';
        } else {
            $result = createLeague($name, $accessCode, $initialBudget, $defaultTime, $maxPortieri, $maxDifensori, $maxCentrocampisti, $maxAttaccanti, $numeroTitolari, $bonus_settings, $auto_lineup_mode);
            if ($result) {
                // Get the created league ID and redirect to team selection
                $stmt = $conn->prepare("SELECT id FROM leagues WHERE name = ? ORDER BY id DESC LIMIT 1");
                $stmt->bind_param("s", $name);
                $stmt->execute();
                $leagueId = $stmt->get_result()->fetch_assoc()['id'];
                header('Location: select_team.php?league_id=' . $leagueId);
                exit();
            } else {
                $error = 'Errore nella creazione della lega.';
            }
        }
    }
    }
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Crea Nuova Lega - FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.2/font/bootstrap-icons.css" rel="stylesheet">
    <link href="assets/css/app-ui.css" rel="stylesheet">
</head>
<body class="bg-light fc-settings-page">
    <?php include 'navbar.php'; ?>
    <div class="container fc-page-container">
        <div class="fc-settings-header">
            <h4 class="mb-0 fw-bold text-dark"><i class="bi bi-plus-circle me-2 text-primary"></i>Crea Nuova Lega</h4>
        </div>
        <div class="row justify-content-center">
            <div class="col-md-7 col-lg-6">
                <div class="card fc-settings-card">
                    <div class="card-header bg-primary text-white">
                        <i class="bi bi-plus-circle"></i> Crea Nuova Lega
                    </div>
                    <div class="card-body">
                        <?php if ($error): ?>
                            <div class="alert alert-danger"><?php echo htmlspecialchars($error); ?></div>
                        <?php endif; ?>
                        <form method="POST">
                            <div class="mb-3">
                                <label for="league_name" class="form-label">Nome Lega <span class="text-danger">*</span></label>
                                <input type="text" class="form-control" id="league_name" name="league_name" required>
                            </div>
                            <div class="mb-3">
                                <label for="access_code" class="form-label">Codice di Accesso (opzionale)</label>
                                <input type="text" class="form-control" id="access_code" name="access_code">
                            </div>
                            <div class="mb-3">
                                <label for="initial_budget" class="form-label">Budget iniziale <span class="text-danger">*</span></label>
                                <input type="number" class="form-control" id="initial_budget" name="initial_budget" min="1" value="100" required>
                            </div>
                            <div class="mb-3">
                                <label for="default_time" class="form-label">Orario di default scadenza invio formazioni</label>
                                <input type="time" class="form-control" id="default_time" name="default_time" value="20:00" required>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Limite giocatori per ruolo</label>
                                <div class="row g-2">
                                    <div class="col-6">
                                        <label for="max_portieri" class="form-label"><span class="badge bg-primary"><i class="bi bi-shield-lock"></i> Portieri</span></label>
                                        <input type="number" class="form-control" id="max_portieri" name="max_portieri" min="1" max="10" value="3" required>
                                    </div>
                                    <div class="col-6">
                                        <label for="max_difensori" class="form-label"><span class="badge bg-success"><i class="bi bi-shield"></i> Difensori</span></label>
                                        <input type="number" class="form-control" id="max_difensori" name="max_difensori" min="1" max="20" value="8" required>
                                    </div>
                                    <div class="col-6">
                                        <label for="max_centrocampisti" class="form-label"><span class="badge bg-warning text-dark"><i class="bi bi-lightning-charge"></i> Centrocampisti</span></label>
                                        <input type="number" class="form-control" id="max_centrocampisti" name="max_centrocampisti" min="1" max="20" value="8" required>
                                    </div>
                                    <div class="col-6">
                                        <label for="max_attaccanti" class="form-label"><span class="badge bg-danger"><i class="bi bi-soccer"></i> Attaccanti</span></label>
                                        <input type="number" class="form-control" id="max_attaccanti" name="max_attaccanti" min="1" max="10" value="6" required>
                                    </div>
                                </div>
                            </div>
                            <div class="mb-3">
                                <label for="numero_titolari" class="form-label">Numero giocatori titolari in campo <span class="text-danger">*</span></label>
                                <input type="number" class="form-control" id="numero_titolari" name="numero_titolari" min="4" max="11" value="11" required>
                                <div class="form-text">Scegli quanti giocatori schierare in campo (default 11).</div>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Modalità formazione</label>
                                <div>
                                    <div class="form-check form-check-inline">
                                        <input class="form-check-input" type="radio" name="auto_lineup_mode" id="manual_lineup" value="0" <?php if(!isset($_POST['auto_lineup_mode']) || $_POST['auto_lineup_mode'] == '0') echo 'checked'; ?>>
                                        <label class="form-check-label" for="manual_lineup">Formazione manuale (ogni utente invia la formazione)</label>
                                    </div>
                                    <div class="form-check form-check-inline">
                                        <input class="form-check-input" type="radio" name="auto_lineup_mode" id="auto_lineup" value="1" <?php if(isset($_POST['auto_lineup_mode']) && $_POST['auto_lineup_mode'] == '1') echo 'checked'; ?>>
                                        <label class="form-check-label" for="auto_lineup">Formazione automatica (i migliori per ruolo della rosa)</label>
                                    </div>
                                </div>
                                <div class="form-text">In modalità automatica, il sistema schiererà i migliori per ruolo tra i tuoi disponibili ogni giornata.</div>
                            </div>
                            <div class="card card-impostazioni mb-4">
                                <div class="card-header bg-info text-dark d-flex align-items-center justify-content-between">
                                    <div class="d-flex align-items-center">
                                        <i class="bi bi-emoji-smile me-2"></i>
                                        <h5 class="mb-0">Bonus/Malus Lega</h5>
                                    </div>
                                    <div class="form-check form-switch m-0">
                                        <input class="form-check-input" type="checkbox" id="enable_bonus_malus" name="enable_bonus_malus" <?php if(isset($_POST['enable_bonus_malus']) ? $_POST['enable_bonus_malus'] : true) echo 'checked'; ?>>
                                        <label class="form-check-label ms-2" for="enable_bonus_malus"></label>
                                    </div>
                                </div>
                                <div class="card-body">
                                    <input type="hidden" name="action" value="create_league">
                                    <div id="bonusMalusSettings" <?php if(isset($_POST['enable_bonus_malus']) && !$_POST['enable_bonus_malus']) echo 'style=\"display:none;\"'; ?>>
                                        <div class="row g-2 align-items-center mb-2">
                                            <div class="col-6 col-md-3">
                                                <div class="form-check form-switch">
                                                    <input class="form-check-input" type="checkbox" id="enable_goal" name="enable_goal" <?php if(isset($_POST['enable_goal']) ? $_POST['enable_goal'] : true) echo 'checked'; ?>>
                                                    <label class="form-check-label" for="enable_goal">Abilita Goal ⚽</label>
                                                </div>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <input type="number" step="0.5" class="form-control" name="bonus_goal" id="bonus_goal" value="<?php echo number_format((float)(isset($_POST['bonus_goal']) ? parse_decimal($_POST['bonus_goal'], 3.0) : 3.0), 1, '.', ''); ?>">
                                                <label for="bonus_goal" class="form-label">Bonus Goal</label>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <div class="form-check form-switch">
                                                    <input class="form-check-input" type="checkbox" id="enable_assist" name="enable_assist" <?php if(isset($_POST['enable_assist']) ? $_POST['enable_assist'] : true) echo 'checked'; ?>>
                                                    <label class="form-check-label" for="enable_assist">Abilita Assist 🥾</label>
                                                </div>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <input type="number" step="0.5" class="form-control" name="bonus_assist" id="bonus_assist" value="<?php echo number_format((float)(isset($_POST['bonus_assist']) ? parse_decimal($_POST['bonus_assist'], 1.0) : 1.0), 1, '.', ''); ?>">
                                                <label for="bonus_assist" class="form-label">Bonus Assist</label>
                                            </div>
                                        </div>
                                        <div class="row g-2 align-items-center mb-2">
                                            <div class="col-6 col-md-3">
                                                <div class="form-check form-switch">
                                                    <input class="form-check-input" type="checkbox" id="enable_yellow_card" name="enable_yellow_card" <?php if(isset($_POST['enable_yellow_card']) ? $_POST['enable_yellow_card'] : true) echo 'checked'; ?>>
                                                    <label class="form-check-label" for="enable_yellow_card">Abilita Giallo 🟨</label>
                                                </div>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <input type="number" step="0.5" class="form-control" name="malus_yellow_card" id="malus_yellow_card" value="<?php echo number_format((float)(isset($_POST['malus_yellow_card']) ? parse_decimal($_POST['malus_yellow_card'], -0.5) : -0.5), 1, '.', ''); ?>">
                                                <label for="malus_yellow_card" class="form-label">Malus Giallo</label>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <div class="form-check form-switch">
                                                    <input class="form-check-input" type="checkbox" id="enable_red_card" name="enable_red_card" <?php if(isset($_POST['enable_red_card']) ? $_POST['enable_red_card'] : true) echo 'checked'; ?>>
                                                    <label class="form-check-label" for="enable_red_card">Abilita Rosso 🟥</label>
                                                </div>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <input type="number" step="0.5" class="form-control" name="malus_red_card" id="malus_red_card" value="<?php echo number_format((float)(isset($_POST['malus_red_card']) ? parse_decimal($_POST['malus_red_card'], -1.0) : -1.0), 1, '.', ''); ?>">
                                                <label for="malus_red_card" class="form-label">Malus Rosso</label>
                                            </div>
                                        </div>
                                        <div class="row g-2 align-items-center mb-2">
                                            <div class="col-6 col-md-3">
                                                <div class="form-check form-switch">
                                                    <input class="form-check-input" type="checkbox" id="enable_goals_conceded" name="enable_goals_conceded" <?php if(isset($_POST['enable_goals_conceded']) ? $_POST['enable_goals_conceded'] : true) echo 'checked'; ?>>
                                                    <label class="form-check-label" for="enable_goals_conceded">Goal Subito 🥅</label>
                                                </div>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <input type="number" step="0.5" class="form-control" name="malus_goals_conceded" id="malus_goals_conceded" value="<?php echo number_format((float)(isset($_POST['malus_goals_conceded']) ? parse_decimal($_POST['malus_goals_conceded'], -1.0) : -1.0), 1, '.', ''); ?>">
                                                <label for="malus_goals_conceded" class="form-label">Malus Goal Subito</label>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <div class="form-check form-switch">
                                                    <input class="form-check-input" type="checkbox" id="enable_own_goal" name="enable_own_goal" <?php if(isset($_POST['enable_own_goal']) ? $_POST['enable_own_goal'] : true) echo 'checked'; ?>>
                                                    <label class="form-check-label" for="enable_own_goal">Autogoal ⚠️</label>
                                                </div>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <input type="number" step="0.5" class="form-control" name="malus_own_goal" id="malus_own_goal" value="<?php echo number_format((float)(isset($_POST['malus_own_goal']) ? parse_decimal($_POST['malus_own_goal'], -2.0) : -2.0), 1, '.', ''); ?>">
                                                <label for="malus_own_goal" class="form-label">Malus Autogoal</label>
                                            </div>
                                        </div>
                                        <div class="row g-2 align-items-center mb-2">
                                            <div class="col-6 col-md-3">
                                                <div class="form-check form-switch">
                                                    <input class="form-check-input" type="checkbox" id="enable_penalty_missed" name="enable_penalty_missed" <?php if(isset($_POST['enable_penalty_missed']) ? $_POST['enable_penalty_missed'] : true) echo 'checked'; ?>>
                                                    <label class="form-check-label" for="enable_penalty_missed">Rig. Sbagliato ❌</label>
                                                </div>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <input type="number" step="0.5" class="form-control" name="malus_penalty_missed" id="malus_penalty_missed" value="<?php echo number_format((float)(isset($_POST['malus_penalty_missed']) ? parse_decimal($_POST['malus_penalty_missed'], -3.0) : -3.0), 1, '.', ''); ?>">
                                                <label for="malus_penalty_missed" class="form-label">Malus Rig. Sbagliato</label>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <div class="form-check form-switch">
                                                    <input class="form-check-input" type="checkbox" id="enable_penalty_saved" name="enable_penalty_saved" <?php if(isset($_POST['enable_penalty_saved']) ? $_POST['enable_penalty_saved'] : true) echo 'checked'; ?>>
                                                    <label class="form-check-label" for="enable_penalty_saved">Rig. Parato 🧤</label>
                                                </div>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <input type="number" step="0.5" class="form-control" name="bonus_penalty_saved" id="bonus_penalty_saved" value="<?php echo number_format((float)(isset($_POST['bonus_penalty_saved']) ? parse_decimal($_POST['bonus_penalty_saved'], 3.0) : 3.0), 1, '.', ''); ?>">
                                                <label for="bonus_penalty_saved" class="form-label">Bonus Rig. Parato</label>
                                            </div>
                                        </div>
                                        <div class="row g-2 align-items-center mb-2">
                                            <div class="col-6 col-md-3">
                                                <div class="form-check form-switch">
                                                    <input class="form-check-input" type="checkbox" id="enable_clean_sheet" name="enable_clean_sheet" <?php if(isset($_POST['enable_clean_sheet']) ? $_POST['enable_clean_sheet'] : true) echo 'checked'; ?>>
                                                    <label class="form-check-label" for="enable_clean_sheet">Clean Sheet 🔒</label>
                                                </div>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <input type="number" step="0.5" class="form-control" name="bonus_clean_sheet" id="bonus_clean_sheet" value="<?php echo number_format((float)(isset($_POST['bonus_clean_sheet']) ? parse_decimal($_POST['bonus_clean_sheet'], 1.0) : 1.0), 1, '.', ''); ?>">
                                                <label for="bonus_clean_sheet" class="form-label">Bonus Clean Sheet</label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="text-end mt-3">
                                <button type="submit" class="btn btn-primary"><i class="bi bi-plus-circle"></i> Crea Lega</button>
                                <a href="dashboard.php" class="btn btn-outline-secondary ms-2">Annulla</a>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>
    document.getElementById('enable_bonus_malus').addEventListener('change', function() {
        document.getElementById('bonusMalusSettings').style.display = this.checked ? '' : 'none';
    });
    document.querySelectorAll('form').forEach(function(form) {
      form.addEventListener('submit', function(e) {
        this.querySelectorAll('input[type=number][step="0.1"]').forEach(function(input) {
          if (input.value.includes(',')) {
            input.value = input.value.replace(',', '.');
          }
        });
      });
    });
    </script>
</body>
</html> 
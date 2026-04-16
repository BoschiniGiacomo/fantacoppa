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

$league = getLeagueById($leagueId);
// Check if user is in the league
$stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
$stmt->bind_param("ii", $leagueId, $userId);
$stmt->execute();
if (!$stmt->get_result()->num_rows) {
    header('Location: dashboard.php');
    exit();
}
// Recupera il numero di titolari dalla lega
$numeroTitolari = 11;
$stmt = $conn->prepare("SELECT numero_titolari FROM leagues WHERE id = ?");
$stmt->bind_param("i", $leagueId);
$stmt->execute();
$stmt->bind_result($numeroTitolari);
$stmt->fetch();
$stmt->close();

// Moduli disponibili (tutti quelli classici + combinazioni per ogni numero di titolari)
$moduliTutti = [
    // 4 titolari
    '1-1-2' => [1,1,2], '1-2-1' => [1,2,1], '2-1-1' => [2,1,1],
    // 5 titolari
    '1-2-2' => [1,2,2], '2-2-1' => [2,2,1], '2-1-2' => [2,1,2], '3-1-1' => [3,1,1],
    // 6 titolari
    '2-2-2' => [2,2,2], '3-2-1' => [3,2,1], '2-3-1' => [2,3,1], '1-3-2' => [1,3,2], '3-1-2' => [3,1,2],
    // 7 titolari
    '3-2-2' => [3,2,2], '2-3-2' => [2,3,2], '2-2-3' => [2,2,3], '4-2-1' => [4,2,1], '3-3-1' => [3,3,1], '1-3-3' => [1,3,3],
    // 8 titolari
    '3-3-2' => [3,3,2], '3-2-3' => [3,2,3], '2-3-3' => [2,3,3], '4-3-1' => [4,3,1], '4-2-2' => [4,2,2], '2-4-2' => [2,4,2], '2-2-4' => [2,2,4],
    // 9 titolari
    '3-3-3' => [3,3,3], '4-3-2' => [4,3,2], '4-2-3' => [4,2,3], '3-4-2' => [3,4,2], '3-2-4' => [3,2,4], '2-4-3' => [2,4,3], '2-3-4' => [2,3,4], '5-2-2' => [5,2,2],
    // 10 titolari
    '4-3-3' => [4,3,3], '4-4-2' => [4,4,2], '4-2-4' => [4,2,4], '3-4-3' => [3,4,3], '3-3-4' => [3,3,4], '2-4-4' => [2,4,4], '5-3-2' => [5,3,2], '5-2-3' => [5,2,3],
    // 11 titolari (classici)
    '3-4-3' => [3,4,3], '3-5-2' => [3,5,2], '4-4-2' => [4,4,2], '4-3-3' => [4,3,3], '4-5-1' => [4,5,1], '5-3-2' => [5,3,2], '5-4-1' => [5,4,1], '5-2-3' => [5,2,3], '3-6-1' => [3,6,1], '6-3-1' => [6,3,1], '3-3-4' => [3,3,4], '4-2-4' => [4,2,4], '4-6-0' => [4,6,0], '5-1-4' => [5,1,4], '6-2-2' => [6,2,2], '7-2-1' => [7,2,1], '2-5-3' => [2,5,3], '2-4-4' => [2,4,4], '3-2-5' => [3,2,5], '2-3-5' => [2,3,5],
];
// Filtra solo quelli che sommano a ($numeroTitolari - 1) (il portiere è sempre incluso)
$moduli = [];
foreach ($moduliTutti as $nome => $val) {
    if (array_sum($val) == $numeroTitolari - 1) {
        $moduli[$nome] = $val;
    }
}

// Ruoli
$ruoli = [
    'P' => 'Portiere',
    'D' => 'Difensore',
    'C' => 'Centrocampista',
    'A' => 'Attaccante'
];

// Giornata (per ora manuale, puoi automatizzare)
$giornata = isset($_GET['giornata']) ? (int)$_GET['giornata'] : 1;

// Recupera le giornate disponibili
$stmt = $conn->prepare("SELECT giornata FROM matchdays WHERE league_id = ? ORDER BY giornata");
$stmt->bind_param("i", $leagueId);
$stmt->execute();
$giornate = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// Se non ci sono giornate, imposta la giornata a 0 per indicare che non ci sono giornate disponibili
if (empty($giornate)) {
    $giornata = 0;
} else {
    // Se la giornata selezionata non esiste, usa la prima disponibile
    $giornataExists = false;
    foreach ($giornate as $g) {
        if ($g['giornata'] == $giornata) {
            $giornataExists = true;
            break;
        }
    }
    if (!$giornataExists) {
        $giornata = $giornate[0]['giornata'];
    }
}

// Controlla se la giornata è scaduta
$isMatchdayExpired = false;
$deadline = null;
$timeUntilDeadline = null;

if ($giornata > 0) {
    $isMatchdayExpired = isMatchdayExpired($leagueId, $giornata);
    $deadline = getMatchdayDeadline($leagueId, $giornata);
    $timeUntilDeadline = getTimeUntilDeadline($leagueId, $giornata);
}

// Recupera la rosa dell'utente per la lega
$teams = $conn->query("SELECT id FROM teams WHERE league_id = $leagueId");
$teamIds = [];
while ($row = $teams->fetch_assoc()) {
    $teamIds[] = $row['id'];
}
$rosa = [];
if ($teamIds) {
    $ids = implode(',', $teamIds);
    $res = $conn->query("SELECT p.*, t.name as team_name FROM players p JOIN teams t ON p.team_id = t.id WHERE p.team_id IN ($ids) AND p.id IN (SELECT player_id FROM user_players WHERE user_id = $userId AND league_id = $leagueId) ORDER BY p.role, t.name, p.last_name");
    while ($gioc = $res->fetch_assoc()) {
        $rosa[] = $gioc;
    }
}

// Carica formazione salvata (se esiste)
$formazioneSalvata = null;
if ($giornata > 0) {
    $stmt = $conn->prepare("SELECT * FROM user_lineups WHERE user_id = ? AND league_id = ? AND giornata = ?");
    $stmt->bind_param("iii", $userId, $leagueId, $giornata);
    $stmt->execute();
    $res = $stmt->get_result();
    if ($row = $res->fetch_assoc()) {
        $formazioneSalvata = $row;
    }
}

// Gestione salvataggio formazione
$message = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['modulo'])) {
    // Controlla se ci sono giornate disponibili
    if (empty($giornate)) {
        $message = '<div class="alert alert-warning">
            <i class="bi bi-exclamation-triangle"></i>
            <strong>Impossibile salvare la formazione!</strong><br>
            L\'admin della lega deve prima definire le giornate dal calendario. 
            Contatta l\'amministratore della lega per procedere.
        </div>';
    } else if ($giornata > 0 && isMatchdayExpired($leagueId, $giornata)) {
        // Controlla se la giornata è scaduta
        $message = '<div class="alert alert-danger">
            <i class="bi bi-exclamation-triangle"></i>
            <strong>Non puoi più modificare la formazione di questa giornata!</strong><br>
            La scadenza è passata. Controlla il calendario per le prossime giornate disponibili.
        </div>';
    } else {
        $modulo = $_POST['modulo'];
        $titolari = isset($_POST['titolari']) ? $_POST['titolari'] : [];
        $panchina = isset($_POST['panchina']) ? $_POST['panchina'] : [];
        
        // Debug: log dei dati ricevuti
        error_log("Formazione ricevuta - Titolari: " . implode(',', $titolari));
        error_log("Formazione ricevuta - Panchina: " . implode(',', $panchina));
        
        // Filtra i valori vuoti
        $titolari = array_filter($titolari, function($value) { return $value !== ''; });
        $panchina = array_filter($panchina, function($value) { return $value !== ''; });
        
        $titolariStr = implode(',', $titolari);
        $panchinaStr = implode(',', $panchina);
        
        // Debug: log dei dati processati
        error_log("Formazione processata - Titolari: " . $titolariStr);
        error_log("Formazione processata - Panchina: " . $panchinaStr);
        
        // Upsert
        $stmt = $conn->prepare("REPLACE INTO user_lineups (user_id, league_id, giornata, modulo, titolari, panchina) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->bind_param("iiisss", $userId, $leagueId, $giornata, $modulo, $titolariStr, $panchinaStr);
        $stmt->execute();
        $message = '<div class="alert alert-success">Formazione salvata!</div>';
        // Ricarica la formazione salvata
        $formazioneSalvata = [
            'modulo' => $modulo,
            'titolari' => $titolariStr,
            'panchina' => $panchinaStr
        ];
    }
}

// Prepara titolari e panchina da formazione salvata
$titolariSalvati = $formazioneSalvata && $formazioneSalvata['titolari'] ? explode(',', $formazioneSalvata['titolari']) : [];
$panchinaSalvata = $formazioneSalvata && $formazioneSalvata['panchina'] ? explode(',', $formazioneSalvata['panchina']) : [];
$moduloSelezionato = $formazioneSalvata['modulo'] ?? '4-4-2';

// Se il modulo salvato non è tra quelli validi, scegli il più simile
if (!isset($moduli[$moduloSelezionato])) {
    $best_modulo = array_key_first($moduli);
    $best_diff = null;
    if (isset($moduliTutti[$moduloSelezionato])) {
        $prec = $moduliTutti[$moduloSelezionato];
        foreach ($moduli as $nome => $val) {
            $diff = abs($prec[0]-$val[0]) + abs($prec[1]-$val[1]) + abs($prec[2]-$val[2]);
            if ($best_diff === null || $diff < $best_diff) {
                $best_diff = $diff; $best_modulo = $nome;
            }
        }
    }
    $moduloSelezionato = $best_modulo;
}

// Calcola slot per ruoli dal modulo
list($dif, $cen, $att) = $moduli[$moduloSelezionato];
$slot = [
    'P' => 1,
    'D' => $dif,
    'C' => $cen,
    'A' => $att
];

?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Formazione - FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
    <link href="assets/css/app-ui.css" rel="stylesheet">
    <style>
        .campo {
            background: linear-gradient(180deg, #4caf50 60%, #388e3c 100%);
            border-radius: 20px;
            padding: 30px 10px 10px 10px;
            margin-bottom: 30px;
            box-shadow: 0 2px 8px #0002;
        }
        .slot-ruolo {
            min-width: 120px;
            margin: 0 8px 12px 8px;
            display: inline-block;
        }
        .slot-ruolo select {
            min-width: 120px;
        }
        .ruolo-label {
            font-weight: bold;
            color: #fff;
            text-shadow: 1px 1px 2px #0008;
            font-size: 1.1em;
        }
        .badge-role-P { background: #0d6efd; }
        .badge-role-D { background: #198754; }
        .badge-role-C { background: #ffc107; color: #212529; }
        .badge-role-A { background: #dc3545; }
        .icon-role { font-size: 1.2em; vertical-align: middle; margin-right: 2px; }
        .panchina-list { min-height: 40px; }
        .card-formazione { box-shadow: 0 2px 8px #0001; }
        .ruolo-section { border-bottom: 1px solid #dee2e6; }
        .ruolo-section:last-child { border-bottom: none; }
        .player-item { 
            transition: all 0.2s ease; 
            cursor: pointer;
            border-radius: 4px;
        }
        .player-item:hover { 
            background-color: #e9ecef !important; 
            transform: translateX(2px);
        }
        .player-item.selected-titolare { 
            background-color: #d4edda !important; 
            border-left: 4px solid #198754 !important;
        }
        .player-item.selected-panchina { 
            background-color: #fff3cd !important; 
            border-left: 4px solid #ffc107 !important;
        }
        .ruolo-header { 
            font-size: 0.9em; 
            border-radius: 0; 
        }
        .ruolo-players { 
            max-height: 200px; 
            overflow-y: auto; 
        }
        .role-badge {
            display: inline-block;
            width: 20px;
            height: 20px;
            border-radius: 3px;
            text-align: center;
            line-height: 20px;
            font-size: 12px;
            font-weight: bold;
            color: white;
            margin-left: 5px;
        }
        .role-badge-P { background-color: #0d6efd; }
        .role-badge-D { background-color: #198754; }
        .role-badge-C { background-color: #ffc107; color: #212529; }
        .role-badge-A { background-color: #dc3545; }
        .auto-inserted {
            transition: all 0.3s ease;
            animation: pulse 2s ease-in-out;
        }
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.02); }
            100% { transform: scale(1); }
        }
        .formazione-header-row {
            display: flex !important;
            flex-direction: row !important;
            gap: 0.5em !important;
            align-items: center !important;
            margin-bottom: 1em !important;
        }
        .formazione-header-row .form-label {
            margin-bottom: 0 !important;
            font-size: 1em;
        }
        .formazione-header-row .form-control {
            font-size: 1em;
            padding: 0.25em 0.7em;
            min-width: 110px;
            max-width: 160px;
        }
        @media (max-width: 575.98px) {
            .campo { padding: 18px 2px 8px 2px !important; }
            .slot-ruolo { min-width: 60px !important; margin: 0 2px 5px 2px !important; display: inline-block !important; }
            .slot-ruolo select { min-width: 60px !important; font-size: 0.92em !important; padding: 0.12em 0.18em !important; }
            .ruolo-label { font-size: 0.95em !important; }
            /* Nascondi la freccia della select solo nel campo verde */
            .campo .slot-ruolo select {
                appearance: none !important;
                -webkit-appearance: none !important;
                -moz-appearance: none !important;
                background-image: none !important;
                background: #fff !important;
                border: 1px solid #ced4da !important;
            }
        }
    </style>
</head>
<body class="bg-light fc-formation-page">
<?php include 'navbar.php'; ?>
<div class="container fc-page-container">
    <div class="fc-formation-header">
        <h4 class="mb-0 fw-bold text-dark"><i class="bi bi-clipboard-data me-2 text-primary"></i>Formazione</h4>
    </div>
    <div class="row mb-4">
        <div class="col-lg-9">
            <div class="card card-formazione fc-formation-main-card mb-4">
                <div class="card-header bg-primary text-white d-flex align-items-center">
                    <i class="bi bi-clipboard-data me-2"></i>
                    <h5 class="mb-0">Schiera la tua formazione</h5>
                </div>
                <div class="card-body">
                    <?php if ($message) echo $message; ?>
                    
                    <?php if (empty($giornate)): ?>
                        <div class="alert alert-info mb-4">
                            <i class="bi bi-info-circle"></i>
                            <strong>Nessuna giornata disponibile</strong><br>
                            L'admin della lega deve prima definire le giornate dal calendario. 
                            Una volta che le giornate saranno state create, potrai schierare la tua formazione.
                        </div>
                    <?php else: ?>
                        <?php if ($league['auto_lineup_mode']): ?>
                            <div class="alert alert-info mt-4">
                                <i class="bi bi-info-circle"></i> In questa lega la formazione viene schierata automaticamente ogni giornata: il sistema selezionerà i migliori per ruolo tra i tuoi disponibili. Non è necessario inviare la formazione.
                            </div>
                        <?php else: ?>
                            <?php if ($isMatchdayExpired): ?>
                                <div class="alert alert-danger mt-4">
                                    <i class="bi bi-exclamation-triangle"></i>
                                    <strong>⚠️ Non puoi più modificare la formazione di questa giornata perché la scadenza è passata.</strong><br>
                                    <small class="text-muted">
                                        Scadenza: <?php echo $deadline ? date('d/m/Y H:i', strtotime($deadline)) : 'Non definita'; ?>
                                    </small>
                                </div>
                            <?php elseif ($deadline && $timeUntilDeadline): ?>
                                <div class="alert alert-info mt-4">
                                    <i class="bi bi-clock"></i>
                                    <strong>Tempo rimanente per modificare la formazione:</strong><br>
                                    <span id="countdown" class="fw-bold">
                                        <?php 
                                        $days = $timeUntilDeadline->days;
                                        $hours = $timeUntilDeadline->h;
                                        $minutes = $timeUntilDeadline->i;
                                        $seconds = $timeUntilDeadline->s;
                                        
                                        if ($days > 0) {
                                            echo $days . 'g ' . $hours . 'h ' . $minutes . 'm';
                                        } elseif ($hours > 0) {
                                            echo $hours . 'h ' . $minutes . 'm ' . $seconds . 's';
                                        } else {
                                            echo $minutes . 'm ' . $seconds . 's';
                                        }
                                        ?>
                                    </span><br>
                                    <small class="text-muted">
                                        Scadenza: <?php echo date('d/m/Y H:i', strtotime($deadline)); ?>
                                    </small>
                                </div>
                            <?php endif; ?>
                            <form method="POST" id="formazioneForm">
                                <div class="formazione-header-row mb-3">
                                    <div>
                                        <label for="modulo" class="form-label">Modulo</label>
                                        <select name="modulo" id="modulo" class="form-control d-inline-block" style="width:auto;">
                                            <?php foreach ($moduli as $nome => $val): ?>
                                                <option value="<?php echo $nome; ?>" <?php if ($moduloSelezionato === $nome) echo 'selected'; ?>><?php echo $nome; ?></option>
                                            <?php endforeach; ?>
                                        </select>
                                    </div>
                                    <div>
                                        <label for="giornata" class="form-label">Giornata</label>
                                        <select name="giornata" id="giornata" class="form-control d-inline-block" style="width:auto;">
                                            <?php foreach ($giornate as $g): ?>
                                                <option value="<?php echo $g['giornata']; ?>" <?php if ($giornata == $g['giornata']) echo 'selected'; ?>>Giornata <?php echo $g['giornata']; ?></option>
                                            <?php endforeach; ?>
                                        </select>
                                    </div>
                                </div>
                                <div class="campo text-center">
                                    <!-- PORTIERE -->
                                    <div class="mb-3">
                                        <span class="ruolo-label"><span class="badge badge-role-P"><i class="bi bi-shield-lock icon-role"></i> Portiere</span></span><br>
                                        <?php for ($i = 0; $i < $slot['P']; $i++): ?>
                                            <span class="slot-ruolo">
                                                <select name="titolari[]" class="form-select titolari-select" data-role="P">
                                                    <option value="">-</option>
                                                    <?php foreach ($rosa as $g): if ($g['role'] !== 'P') continue; ?>
                                                        <?php
                                                            $fullName = htmlspecialchars($g['first_name'] . ' ' . $g['last_name']);
                                                            $shortName = htmlspecialchars(mb_strtoupper(mb_substr($g['first_name'],0,1), 'UTF-8') . '. ' . $g['last_name']);
                                                        ?>
                                                        <option value="<?php echo $g['id']; ?>" <?php echo (isset($titolariSalvati[$i]) && $titolariSalvati[$i] == $g['id']) ? 'selected' : ''; ?>
                                                            data-fullname="<?php echo $fullName; ?>" data-shortname="<?php echo $shortName; ?>">
                                                            <?php echo $fullName; ?>
                                                        </option>
                                                    <?php endforeach; ?>
                                                </select>
                                            </span>
                                        <?php endfor; ?>
                                    </div>
                                    <!-- DIFENSORI -->
                                    <div class="mb-3">
                                        <span class="ruolo-label"><span class="badge badge-role-D"><i class="bi bi-shield icon-role"></i> Difensori</span></span><br>
                                        <?php for ($i = 0; $i < $slot['D']; $i++): ?>
                                            <span class="slot-ruolo">
                                                <select name="titolari[]" class="form-select titolari-select" data-role="D">
                                                    <option value="">-</option>
                                                    <?php foreach ($rosa as $g): if ($g['role'] !== 'D') continue; ?>
                                                        <?php
                                                            $fullName = htmlspecialchars($g['first_name'] . ' ' . $g['last_name']);
                                                            $shortName = htmlspecialchars(mb_strtoupper(mb_substr($g['first_name'],0,1), 'UTF-8') . '. ' . $g['last_name']);
                                                        ?>
                                                        <option value="<?php echo $g['id']; ?>" <?php echo (isset($titolariSalvati[$slot['P']+$i]) && $titolariSalvati[$slot['P']+$i] == $g['id']) ? 'selected' : ''; ?>
                                                            data-fullname="<?php echo $fullName; ?>" data-shortname="<?php echo $shortName; ?>">
                                                            <?php echo $fullName; ?>
                                                        </option>
                                                    <?php endforeach; ?>
                                                </select>
                                            </span>
                                        <?php endfor; ?>
                                    </div>
                                    <!-- CENTROCAMPISTI -->
                                    <div class="mb-3">
                                        <span class="ruolo-label"><span class="badge badge-role-C"><i class="bi bi-lightning-charge icon-role"></i> Centrocampisti</span></span><br>
                                        <?php for ($i = 0; $i < $slot['C']; $i++): ?>
                                            <span class="slot-ruolo">
                                                <select name="titolari[]" class="form-select titolari-select" data-role="C">
                                                    <option value="">-</option>
                                                    <?php foreach ($rosa as $g): if ($g['role'] !== 'C') continue; ?>
                                                        <?php
                                                            $fullName = htmlspecialchars($g['first_name'] . ' ' . $g['last_name']);
                                                            $shortName = htmlspecialchars(mb_strtoupper(mb_substr($g['first_name'],0,1), 'UTF-8') . '. ' . $g['last_name']);
                                                        ?>
                                                        <option value="<?php echo $g['id']; ?>" <?php echo (isset($titolariSalvati[$slot['P']+$slot['D']+$i]) && $titolariSalvati[$slot['P']+$slot['D']+$i] == $g['id']) ? 'selected' : ''; ?>
                                                            data-fullname="<?php echo $fullName; ?>" data-shortname="<?php echo $shortName; ?>">
                                                            <?php echo $fullName; ?>
                                                        </option>
                                                    <?php endforeach; ?>
                                                </select>
                                            </span>
                                        <?php endfor; ?>
                                    </div>
                                    <!-- ATTACCANTI -->
                                    <div class="mb-3">
                                        <span class="ruolo-label"><span class="badge badge-role-A"><i class="bi bi-fire icon-role"></i> Attaccanti</span></span><br>
                                        <?php for ($i = 0; $i < $slot['A']; $i++): ?>
                                            <span class="slot-ruolo">
                                                <select name="titolari[]" class="form-select titolari-select" data-role="A">
                                                    <option value="">-</option>
                                                    <?php foreach ($rosa as $g): if ($g['role'] !== 'A') continue; ?>
                                                        <?php
                                                            $fullName = htmlspecialchars($g['first_name'] . ' ' . $g['last_name']);
                                                            $shortName = htmlspecialchars(mb_strtoupper(mb_substr($g['first_name'],0,1), 'UTF-8') . '. ' . $g['last_name']);
                                                        ?>
                                                        <option value="<?php echo $g['id']; ?>" <?php echo (isset($titolariSalvati[$slot['P']+$slot['D']+$slot['C']+$i]) && $titolariSalvati[$slot['P']+$slot['D']+$slot['C']+$i] == $g['id']) ? 'selected' : ''; ?>
                                                            data-fullname="<?php echo $fullName; ?>" data-shortname="<?php echo $shortName; ?>">
                                                            <?php echo $fullName; ?>
                                                        </option>
                                                    <?php endforeach; ?>
                                                </select>
                                            </span>
                                        <?php endfor; ?>
                                    </div>
                                </div>
                                
                                <!-- PANCHINA (solo se ci sono titolari selezionati) -->
                                <div id="panchinaSection" class="card mb-3 mt-4" style="display: none;">
                                    <div class="card-header bg-secondary text-white">
                                        <i class="bi bi-arrow-repeat"></i> Panchina (ordine di ingresso)
                                    </div>
                                    <div class="card-body p-2">
                                        <div id="panchinaContainer" class="row panchina-list">
                                            <!-- La panchina verrà generata dinamicamente -->
                                        </div>
                                    </div>
                                </div>
                                
                                <div class="text-end">
                                    <?php if (empty($giornate)): ?>
                                        <button type="button" class="btn btn-secondary btn-lg px-4" disabled 
                                                title="L'admin della lega deve prima definire le giornate dal calendario">
                                            <i class="bi bi-save"></i> Salva Formazione
                                        </button>
                                    <?php elseif ($isMatchdayExpired): ?>
                                        <button type="button" class="btn btn-danger btn-lg px-4" disabled 
                                                title="La scadenza per questa giornata è passata">
                                            <i class="bi bi-exclamation-triangle"></i> Scadenza Passata
                                        </button>
                                    <?php else: ?>
                                        <button type="submit" class="btn btn-primary btn-lg px-4" id="saveButton">
                                            <i class="bi bi-save"></i> Salva Formazione
                                        </button>
                                    <?php endif; ?>
                                </div>
                            </form>
                        <?php endif; ?>
                    <?php endif; ?>
                </div>
            </div>
        </div>
        
        <!-- LISTA COMPLETA GIOCATORI -->
        <div class="col-lg-3">
            <div class="card fc-formation-side-card">
                <div class="card-header bg-info text-white">
                    <i class="bi bi-people"></i> La tua rosa
                </div>
                <div class="card-body p-0">
                    <?php
                    $giocatoriPerRuolo = [];
                    foreach ($rosa as $g) {
                        $giocatoriPerRuolo[$g['role']][] = $g;
                    }
                    ?>
                    
                    <?php foreach ($ruoli as $ruolo => $nomeRuolo): ?>
                        <?php if (isset($giocatoriPerRuolo[$ruolo])): ?>
                            <div class="ruolo-section">
                                <div class="ruolo-header p-2" style="background-color: <?php 
                                    echo $ruolo === 'P' ? '#0d6efd' : 
                                        ($ruolo === 'D' ? '#198754' : 
                                        ($ruolo === 'C' ? '#ffc107' : '#dc3545')); 
                                ?>; color: white; font-weight: bold;">
                                    <i class="bi bi-<?php 
                                        echo $ruolo === 'P' ? 'shield-lock' : 
                                            ($ruolo === 'D' ? 'shield' : 
                                            ($ruolo === 'C' ? 'lightning-charge' : 'fire')); 
                                    ?>"></i>
                                    <?php echo $nomeRuolo; ?> (<?php echo count($giocatoriPerRuolo[$ruolo]); ?>)
                                </div>
                                <div class="ruolo-players p-2">
                                    <?php foreach ($giocatoriPerRuolo[$ruolo] as $g): ?>
                                        <div class="player-item mb-1 p-1 border-bottom" data-player-id="<?php echo $g['id']; ?>" data-role="<?php echo $g['role']; ?>">
                                            <small>
                                                <strong><?php echo htmlspecialchars($g['first_name'] . ' ' . $g['last_name']); ?></strong><br>
                                                <span class="text-muted"><?php echo htmlspecialchars($g['team_name']); ?></span>
                                            </small>
                                        </div>
                                    <?php endforeach; ?>
                                </div>
                            </div>
                            <?php if ($ruolo !== array_key_last($ruoli)): ?>
                                <hr class="my-1">
                            <?php endif; ?>
                        <?php endif; ?>
                    <?php endforeach; ?>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Modal per suggerimento formazione automatica -->
<div class="modal fade" id="formationSuggestionModal" tabindex="-1" aria-labelledby="formationSuggestionModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-lg">
        <div class="modal-content">
            <div class="modal-header bg-warning text-dark">
                <h5 class="modal-title" id="formationSuggestionModalLabel">
                    <i class="bi bi-exclamation-triangle"></i> Formazione Incompleta
                </h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
                <div class="alert alert-info">
                    <i class="bi bi-info-circle"></i> La tua formazione non è completa. Ecco una formazione automatica suggerita:
                </div>
                
                <div class="row">
                    <div class="col-md-6">
                        <h6 class="text-primary"><i class="bi bi-shield-check"></i> Titolari Suggeriti</h6>
                        <div id="suggestedTitolari" class="border rounded p-3 bg-light">
                            <!-- I titolari suggeriti verranno inseriti qui -->
                        </div>
                    </div>
                    <div class="col-md-6">
                        <h6 class="text-secondary"><i class="bi bi-arrow-repeat"></i> Panchina Suggerita</h6>
                        <div id="suggestedPanchina" class="border rounded p-3 bg-light">
                            <!-- La panchina suggerita verrà inserita qui -->
                        </div>
                    </div>
                </div>
                
                <div class="alert alert-warning mt-3">
                    <i class="bi bi-question-circle"></i> Vuoi salvare questa formazione automatica?
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                    <i class="bi bi-x-circle"></i> Modifica Manualmente
                </button>
                <button type="button" class="btn btn-success" id="acceptSuggestion">
                    <i class="bi bi-check-circle"></i> Salva Formazione Automatica
                </button>
            </div>
        </div>
    </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script>
// Pass deadline data to JavaScript
const deadlineData = {
    isExpired: <?php echo $isMatchdayExpired ? 'true' : 'false'; ?>,
    deadline: <?php echo $deadline ? "'" . $deadline . "'" : 'null'; ?>,
    timeUntilDeadline: <?php echo $timeUntilDeadline ? json_encode([
        'days' => $timeUntilDeadline->days,
        'hours' => $timeUntilDeadline->h,
        'minutes' => $timeUntilDeadline->i,
        'seconds' => $timeUntilDeadline->s
    ]) : 'null'; ?>
};

document.addEventListener('DOMContentLoaded', function() {
    // Dati dei giocatori per la panchina
    const allPlayers = <?php echo json_encode($rosa); ?>;
    
    // Funzione per aggiornare le opzioni disponibili e la panchina
    function updateFormation() {
        console.log('updateFormation chiamata');
        
        // Raccogli tutti i giocatori selezionati come titolari
        const titolariSelects = document.querySelectorAll('select[name="titolari[]"]');
        const selectedTitolari = [];
        
        titolariSelects.forEach(select => {
            if (select.value && select.value !== '') {
                selectedTitolari.push(select.value);
            }
        });
        
        console.log('Titolari selezionati:', selectedTitolari);
        
        // Raccogli tutti i giocatori selezionati in panchina
        const panchinaSelects = document.querySelectorAll('select[name="panchina[]"]');
        const selectedPanchina = [];
        
        panchinaSelects.forEach(select => {
            if (select.value && select.value !== '') {
                selectedPanchina.push(select.value);
            }
        });
        
        console.log('Panchina selezionata:', selectedPanchina);
        
        // Aggiorna le opzioni dei titolari
        titolariSelects.forEach(select => {
            const currentValue = select.value;
            const currentRole = select.dataset.role;
            
            Array.from(select.options).forEach(option => {
                if (option.value && option.value !== '') {
                    // Trova tutti i giocatori dello stesso ruolo già selezionati
                    const sameRoleSelected = selectedTitolari.filter(playerId => {
                        const player = allPlayers.find(p => p.id.toString() === playerId);
                        return player && player.role === currentRole;
                    });
                    
                    // Disabilita le opzioni che sono già selezionate per lo stesso ruolo
                    if (sameRoleSelected.includes(option.value) && option.value !== currentValue) {
                        option.disabled = true;
                        option.style.display = 'none';
                    } else {
                        option.disabled = false;
                        option.style.display = '';
                    }
                }
            });
        });
        
        // Aggiorna la panchina
        updatePanchina(selectedTitolari);
        
        // Aggiorna la lista dei giocatori
        updatePlayerList(selectedTitolari);
    }
    
    // Funzione per aggiornare la panchina
    function updatePanchina(selectedTitolari) {
        const panchinaSection = document.getElementById('panchinaSection');
        const panchinaContainer = document.getElementById('panchinaContainer');
        
        // Se non ci sono titolari selezionati, nascondi la panchina
        if (selectedTitolari.length === 0) {
            panchinaSection.style.display = 'none';
            return;
        }
        
        // Mostra la sezione panchina
        panchinaSection.style.display = 'block';
        
        // Trova i giocatori disponibili per la panchina
        const availablePlayers = allPlayers.filter(player => !selectedTitolari.includes(player.id.toString()));
        
        // Genera la panchina
        panchinaContainer.innerHTML = '';
        
        // Crea slot per la panchina (massimo 7, o il numero di giocatori disponibili se sono meno di 7)
        const maxPanchina = Math.min(7, availablePlayers.length);
        
        for (let i = 0; i < maxPanchina; i++) {
            const col = document.createElement('div');
            col.className = 'col-md-4 mb-2';
            
            const select = document.createElement('select');
            select.name = 'panchina[]';
            select.className = 'form-select form-select-sm';
            
            // Opzione vuota
            const emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = '-';
            select.appendChild(emptyOption);
            
            // Opzioni giocatori disponibili
            availablePlayers.forEach(player => {
                const option = document.createElement('option');
                option.value = player.id;
                // Usa un formato compatto: Nome Cognome [P]
                option.textContent = `${player.first_name} ${player.last_name} [${player.role}]`;
                select.appendChild(option);
            });
            
            // Se c'è una formazione salvata, ripristina la selezione
            const savedPanchina = <?php echo json_encode($panchinaSalvata); ?>;
            if (savedPanchina[i]) {
                select.value = savedPanchina[i];
            }
            
            col.appendChild(select);
            panchinaContainer.appendChild(col);
        }
        
        // Aggiungi event listener ai nuovi select della panchina
        const panchinaSelects = panchinaContainer.querySelectorAll('select[name="panchina[]"]');
        console.log('Select panchina trovati:', panchinaSelects.length);
        
        panchinaSelects.forEach((select, index) => {
            console.log('Aggiungendo event listener al select panchina', index);
            select.addEventListener('change', function() {
                console.log('Panchina select', index, 'changed:', this.value);
                updateFormation();
            });
            
            // Test: verifica che il select sia funzionante
            console.log('Select panchina', index, 'options:', select.options.length);
        });
        
        console.log('Panchina aggiornata con', maxPanchina, 'slot e', availablePlayers.length, 'giocatori disponibili');
    }
    
    // Funzione per aggiornare la lista dei giocatori
    function updatePlayerList(selectedTitolari) {
        const playerItems = document.querySelectorAll('.player-item');
        
        playerItems.forEach(item => {
            const playerId = item.dataset.playerId;
            const isSelected = selectedTitolari.includes(playerId);
            const isInPanchina = isPlayerInPanchina(playerId);
            
            // Rimuovi le classi precedenti
            item.classList.remove('selected-titolare', 'selected-panchina', 'available');
            
            if (isSelected) {
                item.classList.add('selected-titolare');
                item.style.backgroundColor = '#d4edda';
                item.style.borderLeft = '4px solid #198754';
            } else if (isInPanchina) {
                item.classList.add('selected-panchina');
                item.style.backgroundColor = '#fff3cd';
                item.style.borderLeft = '4px solid #ffc107';
            } else {
                item.classList.add('available');
                item.style.backgroundColor = '#f8f9fa';
                item.style.borderLeft = '4px solid #dee2e6';
            }
        });
    }
    
    // Funzione per verificare se un giocatore è in panchina
    function isPlayerInPanchina(playerId) {
        const panchinaSelects = document.querySelectorAll('select[name="panchina[]"]');
        return Array.from(panchinaSelects).some(select => select.value === playerId);
    }
    
    // Aggiungi event listener a tutti i select titolari
    function addEventListeners() {
        const titolariSelects = document.querySelectorAll('select[name="titolari[]"]');
        titolariSelects.forEach(select => {
            select.addEventListener('change', updateFormation);
        });
        
        // Gestione del cambio di giornata
        const giornataSelect = document.getElementById('giornata');
        if (giornataSelect) {
            giornataSelect.addEventListener('change', function() {
                const selectedGiornata = this.value;
                const currentUrl = new URL(window.location);
                currentUrl.searchParams.set('giornata', selectedGiornata);
                window.location.href = currentUrl.toString();
            });
        }
        
        // Gestione del pulsante salva
        const saveButton = document.getElementById('saveButton');
        const form = document.getElementById('formazioneForm');
        
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            checkAndSaveFormation();
        });
    }
    
    // Funzione per controllare e salvare la formazione
    function checkAndSaveFormation() {
        console.log('checkAndSaveFormation chiamata');
        
        const titolariSelects = document.querySelectorAll('select[name="titolari[]"]');
        const panchinaSelects = document.querySelectorAll('select[name="panchina[]"]');
        
        console.log('Trovati', titolariSelects.length, 'select titolari e', panchinaSelects.length, 'select panchina');
        
        // Controlla titolari
        const selectedTitolari = [];
        let titolariIncompleti = false;
        
        titolariSelects.forEach((select, index) => {
            console.log('Titolare', index, ':', select.value);
            if (select.value && select.value !== '') {
                selectedTitolari.push(select.value);
            } else {
                titolariIncompleti = true;
            }
        });
        
        // Controlla panchina (non è obbligatorio che sia completa)
        const selectedPanchina = [];
        
        panchinaSelects.forEach((select, index) => {
            console.log('Panchina', index, ':', select.value);
            if (select.value && select.value !== '') {
                selectedPanchina.push(select.value);
            }
        });
        
        console.log('Titolari selezionati per salvataggio:', selectedTitolari);
        console.log('Panchina selezionata per salvataggio:', selectedPanchina);
        
        // Se i titolari sono completi, salva direttamente (anche se la panchina è incompleta)
        if (!titolariIncompleti) {
            console.log('Salvando formazione con titolari completi');
            document.getElementById('formazioneForm').submit();
            return;
        }
        
        // Se i titolari sono incompleti, suggerisci una formazione automatica
        if (titolariIncompleti) {
            console.log('Titolari incompleti, suggerendo formazione automatica');
            const suggestedFormation = suggestAutomaticFormation(selectedTitolari, selectedPanchina);
            showFormationSuggestion(suggestedFormation);
        }
    }
    
    // Funzione per suggerire una formazione automatica
    function suggestAutomaticFormation(selectedTitolari, selectedPanchina) {
        // selectedTitolari: array di playerId (string) già scelti, posizione = slot
        // selectedPanchina: array di playerId (string) già scelti in panchina
        const suggestedTitolari = [...selectedTitolari];
        const suggestedPanchina = [...selectedPanchina];

        // Raccogli tutti i playerId già usati (titolari e panchina)
        const usedIds = new Set([...suggestedTitolari.filter(Boolean), ...suggestedPanchina.filter(Boolean)]);

        // Per ogni slot titolare vuoto, inserisci un giocatore disponibile per quel ruolo che non sia già usato
        const titolariSelects = document.querySelectorAll('select[name="titolari[]"]');
        titolariSelects.forEach((select, index) => {
            if (!select.value || select.value === '') {
                const currentRole = select.dataset.role;
                // Trova il primo giocatore disponibile per quel ruolo non già usato
                const available = allPlayers.filter(player => 
                    player.role === currentRole &&
                    !usedIds.has(player.id.toString())
                );
                if (available.length > 0) {
                    suggestedTitolari[index] = available[0].id.toString();
                    usedIds.add(available[0].id.toString());
                }
            }
        });

        // Completa la panchina (come prima, senza duplicati)
        const availableForPanchina = allPlayers.filter(player => 
            !suggestedTitolari.includes(player.id.toString()) &&
            !suggestedPanchina.includes(player.id.toString())
        );
        const maxPanchina = Math.min(7, availableForPanchina.length);
        for (let i = 0; i < maxPanchina; i++) {
            suggestedPanchina.push(availableForPanchina[i].id.toString());
        }

        return {
            titolari: suggestedTitolari,
            panchina: suggestedPanchina
        };
    }
    
    // Funzione per mostrare il suggerimento
    function showFormationSuggestion(suggestedFormation) {
        const titolariNames = suggestedFormation.titolari.map(id => {
            const player = allPlayers.find(p => p.id.toString() === id);
            return player ? `${player.first_name} ${player.last_name} [${player.role}]` : 'N/A';
        });
        
        const panchinaNames = suggestedFormation.panchina.map(id => {
            const player = allPlayers.find(p => p.id.toString() === id);
            return player ? `${player.first_name} ${player.last_name} [${player.role}]` : 'N/A';
        });
        
        // Popola il modal con i suggerimenti
        const titolariContainer = document.getElementById('suggestedTitolari');
        const panchinaContainer = document.getElementById('suggestedPanchina');
        
        titolariContainer.innerHTML = titolariNames.map(name => 
            `<div class="mb-1"><i class="bi bi-person-check"></i> ${name}</div>`
        ).join('');
        
        panchinaContainer.innerHTML = panchinaNames.map(name => 
            `<div class="mb-1"><i class="bi bi-person"></i> ${name}</div>`
        ).join('');
        
        // Mostra il modal
        const modal = new bootstrap.Modal(document.getElementById('formationSuggestionModal'));
        modal.show();
        
        // Gestisci l'accettazione del suggerimento
        document.getElementById('acceptSuggestion').onclick = function() {
            modal.hide();
            // Applica la formazione suggerita
            applySuggestedFormation(suggestedFormation);
            // Salva la formazione
            document.getElementById('formazioneForm').submit();
        };
    }
    
    // Funzione per applicare la formazione suggerita
    function applySuggestedFormation(suggestedFormation) {
        // Applica i titolari
        const titolariSelects = document.querySelectorAll('select[name="titolari[]"]');
        titolariSelects.forEach((select, index) => {
            if (suggestedFormation.titolari[index]) {
                select.value = suggestedFormation.titolari[index];
            }
        });
        
        // Applica la panchina
        const panchinaSelects = document.querySelectorAll('select[name="panchina[]"]');
        panchinaSelects.forEach((select, index) => {
            if (suggestedFormation.panchina[index]) {
                select.value = suggestedFormation.panchina[index];
            }
        });
        
        // Aggiorna l'interfaccia
        updateFormation();
        
        // Assicurati che la sezione panchina sia visibile
        const panchinaSection = document.getElementById('panchinaSection');
        if (panchinaSection) {
            panchinaSection.style.display = 'block';
        }
        
        // Evidenzia i giocatori inseriti automaticamente
        highlightAutoInsertedPlayers(suggestedFormation);
        
        // Mostra un messaggio di conferma
        showSuccessMessage();
        
        // Aspetta un momento per assicurarsi che tutti i valori siano impostati
        setTimeout(() => {
            // Verifica che tutti i titolari siano popolati (la panchina può essere incompleta)
            const allTitolariFilled = Array.from(titolariSelects).every(select => select.value !== '');
            
            if (allTitolariFilled) {
                console.log('Titolari completi, procedendo con il salvataggio...');
                document.getElementById('formazioneForm').submit();
            } else {
                console.error('Errore: alcuni titolari non sono stati popolati correttamente');
                alert('Errore nell\'applicazione della formazione automatica. Riprova.');
            }
        }, 500);
    }
    
    // Funzione per evidenziare i giocatori inseriti automaticamente
    function highlightAutoInsertedPlayers(suggestedFormation) {
        // Evidenzia i titolari inseriti automaticamente
        const titolariSelects = document.querySelectorAll('select[name="titolari[]"]');
        titolariSelects.forEach((select, index) => {
            if (suggestedFormation.titolari[index] && select.value === suggestedFormation.titolari[index]) {
                // Aggiungi una classe temporanea per l'evidenziazione
                select.classList.add('auto-inserted');
                select.style.backgroundColor = '#d4edda';
                select.style.borderColor = '#198754';
                select.style.boxShadow = '0 0 10px rgba(25, 135, 84, 0.3)';
                
                // Rimuovi l'evidenziazione dopo 3 secondi
                setTimeout(() => {
                    select.classList.remove('auto-inserted');
                    select.style.backgroundColor = '';
                    select.style.borderColor = '';
                    select.style.boxShadow = '';
                }, 3000);
            }
        });
        
        // Evidenzia i panchinari inseriti automaticamente
        const panchinaSelects = document.querySelectorAll('select[name="panchina[]"]');
        panchinaSelects.forEach((select, index) => {
            if (suggestedFormation.panchina[index] && select.value === suggestedFormation.panchina[index]) {
                // Aggiungi una classe temporanea per l'evidenziazione
                select.classList.add('auto-inserted');
                select.style.backgroundColor = '#fff3cd';
                select.style.borderColor = '#ffc107';
                select.style.boxShadow = '0 0 10px rgba(255, 193, 7, 0.3)';
                
                // Rimuovi l'evidenziazione dopo 3 secondi
                setTimeout(() => {
                    select.classList.remove('auto-inserted');
                    select.style.backgroundColor = '';
                    select.style.borderColor = '';
                    select.style.boxShadow = '';
                }, 3000);
            }
        });
    }
    
    // Funzione per mostrare messaggio di successo
    function showSuccessMessage() {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'alert alert-success alert-dismissible fade show position-fixed';
        messageDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
        messageDiv.innerHTML = `
            <i class="bi bi-check-circle"></i> 
            <strong>Formazione applicata!</strong> I giocatori sono stati inseriti automaticamente nel campo.
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        
        document.body.appendChild(messageDiv);
        
        // Rimuovi il messaggio dopo 3 secondi
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.remove();
            }
        }, 3000);
    }
    
    // Gestione cambio modulo dinamico
    const moduli = <?php echo json_encode($moduli); ?>;
    const moduloSelect = document.getElementById('modulo');
    moduloSelect.addEventListener('change', function() {
        const nuovoModulo = this.value;
        const slot = moduli[nuovoModulo];
        // slot = [dif, cen, att] (difensori, centrocampisti, attaccanti)
        // Ricostruisci la sezione titolari
        const campoDiv = document.querySelector('.campo.text-center');
        if (!campoDiv) return;
        // Salva i giocatori già selezionati per ruolo
        const titolariSelects = campoDiv.querySelectorAll('select[name="titolari[]"]');
        const titolariSelezionati = Array.from(titolariSelects).map(s => s.value);
        const ruoliSelezionati = Array.from(titolariSelects).map(s => s.dataset.role);
        // Mappa i giocatori già selezionati per ruolo
        const byRole = {P:[],D:[],C:[],A:[]};
        titolariSelezionati.forEach((id, i) => {
            if (id && ruoliSelezionati[i]) byRole[ruoliSelezionati[i]].push(id);
        });
        // Ricostruisci HTML
        let html = '';
        // Portiere
        html += '<div class="mb-3">'+
            '<span class="ruolo-label"><span class="badge badge-role-P"><i class="bi bi-shield-lock icon-role"></i> Portiere</span></span><br>';
        html += '<span class="slot-ruolo">'+
            '<select name="titolari[]" class="form-select titolari-select" data-role="P">'+
            '<option value="">-</option>';
        allPlayers.filter(g=>g.role==='P').forEach(g=>{
            const selected = byRole.P.includes(g.id.toString()) ? 'selected' : '';
            html += `<option value="${g.id}" ${selected}>${g.first_name} ${g.last_name}</option>`;
        });
        html += '</select></span></div>';
        // Difensori
        html += '<div class="mb-3">'+
            '<span class="ruolo-label"><span class="badge badge-role-D"><i class="bi bi-shield icon-role"></i> Difensori</span></span><br>';
        for(let i=0;i<slot[0];i++){
            html += '<span class="slot-ruolo">'+
                '<select name="titolari[]" class="form-select titolari-select" data-role="D">'+
                '<option value="">-</option>';
            allPlayers.filter(g=>g.role==='D').forEach(g=>{
                const selected = byRole.D[i]===g.id.toString() ? 'selected' : '';
                html += `<option value="${g.id}" ${selected}>${g.first_name} ${g.last_name}</option>`;
            });
            html += '</select></span>';
        }
        html += '</div>';
        // Centrocampisti
        html += '<div class="mb-3">'+
            '<span class="ruolo-label"><span class="badge badge-role-C"><i class="bi bi-lightning-charge icon-role"></i> Centrocampisti</span></span><br>';
        for(let i=0;i<slot[1];i++){
            html += '<span class="slot-ruolo">'+
                '<select name="titolari[]" class="form-select titolari-select" data-role="C">'+
                '<option value="">-</option>';
            allPlayers.filter(g=>g.role==='C').forEach(g=>{
                const selected = byRole.C[i]===g.id.toString() ? 'selected' : '';
                html += `<option value="${g.id}" ${selected}>${g.first_name} ${g.last_name}</option>`;
            });
            html += '</select></span>';
        }
        html += '</div>';
        // Attaccanti
        html += '<div class="mb-3">'+
            '<span class="ruolo-label"><span class="badge badge-role-A"><i class="bi bi-soccer icon-role"></i> Attaccanti</span></span><br>';
        for(let i=0;i<slot[2];i++){
            html += '<span class="slot-ruolo">'+
                '<select name="titolari[]" class="form-select titolari-select" data-role="A">'+
                '<option value="">-</option>';
            allPlayers.filter(g=>g.role==='A').forEach(g=>{
                const selected = byRole.A[i]===g.id.toString() ? 'selected' : '';
                html += `<option value="${g.id}" ${selected}>${g.first_name} ${g.last_name}</option>`;
            });
            html += '</select></span>';
        }
        html += '</div>';
        campoDiv.innerHTML = html;
        // Riaggancia gli event listener
        addEventListeners();
        updateFormation();
    });
    
    // Inizializza
    addEventListeners();
    updateFormation();

    function updateSelectNames() {
        const isMobile = window.matchMedia('(max-width: 575.98px)').matches;
        document.querySelectorAll('.slot-ruolo select option').forEach(opt => {
            if (opt.dataset.fullname && opt.dataset.shortname) {
                opt.textContent = isMobile ? opt.dataset.shortname : opt.dataset.fullname;
            }
        });
    }
    updateSelectNames();
    window.addEventListener('resize', updateSelectNames);
    
    // Live countdown timer
    if (deadlineData.deadline && !deadlineData.isExpired) {
        const countdownElement = document.getElementById('countdown');
        const saveButton = document.getElementById('saveButton');
        const countdownAlert = document.querySelector('.alert-info');
        
        function updateCountdown() {
            const now = new Date();
            const deadline = new Date(deadlineData.deadline);
            const timeLeft = deadline - now;
            
            if (timeLeft <= 0) {
                // Deadline reached
                if (countdownElement) {
                    countdownElement.textContent = 'SCADUTO';
                }
                if (saveButton) {
                    saveButton.disabled = true;
                    saveButton.className = 'btn btn-danger btn-lg px-4';
                    saveButton.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Scadenza Passata';
                }
                if (countdownAlert) {
                    countdownAlert.className = 'alert alert-danger mt-4';
                    countdownAlert.innerHTML = `
                        <i class="bi bi-exclamation-triangle"></i>
                        <strong>⚠️ Non puoi più modificare la formazione di questa giornata perché la scadenza è passata.</strong><br>
                        <small class="text-muted">
                            Scadenza: ${deadline.toLocaleDateString('it-IT')} ${deadline.toLocaleTimeString('it-IT', {hour: '2-digit', minute: '2-digit'})}
                        </small>
                    `;
                }
                return;
            }
            
            // Calculate time components
            const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
            const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
            
            // Format countdown display
            let countdownText = '';
            if (days > 0) {
                countdownText = `${days}g ${hours}h ${minutes}m`;
            } else if (hours > 0) {
                countdownText = `${hours}h ${minutes}m ${seconds}s`;
            } else {
                countdownText = `${minutes}m ${seconds}s`;
            }
            
            if (countdownElement) {
                countdownElement.textContent = countdownText;
            }
        }
        
        // Update countdown immediately and then every second
        updateCountdown();
        setInterval(updateCountdown, 1000);
    }
});
</script>
</body>
</html> 
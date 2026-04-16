<?php
require_once 'db.php';
require_once 'functions.php';
session_start();

// Verifica login
if (!isset($_SESSION['user_id'])) {
    header('Location: index.php');
    exit();
}

// Verifica parametri
$league_id = isset($_GET['league_id']) ? (int)$_GET['league_id'] : 0;
if (!$league_id) {
    header('Location: dashboard.php');
    exit();
}
$userId = $_SESSION['user_id'];

// Check if user is in the league
$stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
$stmt->bind_param("ii", $league_id, $userId);
$stmt->execute();
if (!$stmt->get_result()->num_rows) {
    header('Location: dashboard.php');
    exit();
}

// Verifica permessi admin o pagellatore
$stmt = $conn->prepare("SELECT creator_id FROM leagues WHERE id = ?");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$league = $stmt->get_result()->fetch_assoc();
$is_admin = ($league && $league['creator_id'] == $_SESSION['user_id']);

// Verifica se è pagellatore
$stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
$stmt->bind_param("ii", $league_id, $userId);
$stmt->execute();
$member = $stmt->get_result()->fetch_assoc();
$is_pagellatore = ($member && $member['role'] === 'pagellatore');

if (!$is_admin && !$is_pagellatore) {
    header('Location: dashboard.php');
    exit();
}

// Recupera le giornate disponibili
$stmt = $conn->prepare("SELECT giornata FROM matchdays WHERE league_id = ? ORDER BY giornata");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$giornate = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// Trova l'ultima giornata con almeno un voto
$ultima_giornata_con_voti = null;
if (!empty($giornate)) {
    $stmt = $conn->prepare("
        SELECT MAX(giornata) as ultima_giornata 
        FROM player_ratings 
        WHERE league_id = ? AND rating > 0
    ");
    $stmt->bind_param("i", $league_id);
    $stmt->execute();
    $result = $stmt->get_result()->fetch_assoc();
    if ($result && $result['ultima_giornata']) {
        $ultima_giornata_con_voti = $result['ultima_giornata'];
    }
}

// Recupera le squadre e i giocatori della lega
$stmt = $conn->prepare("SELECT t.id as team_id, t.name as team_name, p.id as player_id, p.first_name, p.last_name, p.role FROM teams t JOIN players p ON t.id = p.team_id WHERE t.league_id = ? ORDER BY t.name, p.role, p.last_name, p.first_name");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// Organizza i giocatori per squadra
$squadre = [];
foreach ($rows as $row) {
    $squadre[$row['team_id']]['name'] = $row['team_name'];
    $squadre[$row['team_id']]['players'][] = [
        'id' => $row['player_id'],
        'first_name' => $row['first_name'],
        'last_name' => $row['last_name'],
        'role' => $row['role']
    ];
}

// Recupera i voti già inseriti per la giornata selezionata
$voti_giornata = [];
$giornata_sel = null;

// Determina la giornata selezionata
if (isset($_GET['giornata']) && $_GET['giornata'] !== '') {
    $giornata_sel = (int)$_GET['giornata'];
} elseif (isset($_POST['giornata']) && $_POST['giornata'] !== '') {
    $giornata_sel = (int)$_POST['giornata'];
} elseif ($ultima_giornata_con_voti) {
    $giornata_sel = $ultima_giornata_con_voti;
} elseif (!empty($giornate)) {
    $giornata_sel = $giornate[0]['giornata'];
}

if ($giornata_sel) {
    $stmt = $conn->prepare("SELECT player_id, rating, goals, assists, yellow_cards, red_cards, goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet FROM player_ratings WHERE league_id = ? AND giornata = ?");
    $stmt->bind_param("ii", $league_id, $giornata_sel);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($row = $res->fetch_assoc()) {
        $voti_giornata[$row['player_id']] = [
            'rating' => $row['rating'],
            'goals' => $row['goals'],
            'assists' => $row['assists'],
            'yellow_cards' => $row['yellow_cards'],
            'red_cards' => $row['red_cards'],
            'goals_conceded' => $row['goals_conceded'],
            'own_goals' => $row['own_goals'],
            'penalty_missed' => $row['penalty_missed'],
            'penalty_saved' => $row['penalty_saved'],
            'clean_sheet' => $row['clean_sheet']
        ];
    }
}

// Recupera impostazioni bonus/malus della lega
$bonus_defaults = [
    'enable_goal' => 1, 'bonus_goal' => 3.0,
    'enable_assist' => 1, 'bonus_assist' => 1.0,
    'enable_yellow_card' => 1, 'malus_yellow_card' => -0.5,
    'enable_red_card' => 1, 'malus_red_card' => -1.0,
    'enable_goals_conceded' => 1, 'malus_goals_conceded' => -1.0,
    'enable_own_goal' => 1, 'malus_own_goal' => -2.0,
    'enable_penalty_missed' => 1, 'malus_penalty_missed' => -3.0,
    'enable_penalty_saved' => 1, 'bonus_penalty_saved' => 3.0,
    'enable_clean_sheet' => 1, 'bonus_clean_sheet' => 1.0
];
$bonus_settings = $bonus_defaults;
$stmt = $conn->prepare("SELECT * FROM league_bonus_settings WHERE league_id = ?");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$res = $stmt->get_result();
if ($row = $res->fetch_assoc()) {
    $bonus_settings = array_merge($bonus_defaults, $row);
}

$bonus_enabled = (bool)$bonus_settings['enable_bonus_malus'];

// Salvataggio voti
$success = false;
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['giornata'])) {
    $giornata = (int)$_POST['giornata'];
    $save_team_only = isset($_POST['save_team_only']) ? (int)$_POST['save_team_only'] : null;
    
    foreach ($_POST['rating'] as $player_id => $rating) {
        if ($rating !== '') {
            // Se stiamo salvando solo una squadra, controlla che il giocatore appartenga a quella squadra
            if ($save_team_only) {
                $stmt = $conn->prepare("SELECT t.id FROM players p JOIN teams t ON p.team_id = t.id WHERE p.id = ? AND t.id = ?");
                $stmt->bind_param("ii", $player_id, $save_team_only);
                $stmt->execute();
                if (!$stmt->get_result()->num_rows) {
                    continue; // Salta questo giocatore se non appartiene alla squadra
                }
            }
            
            // Se S.V. azzera bonus/malus
            if ($rating === '0') {
                $goals = 0;
                $assists = 0;
                $yellow = 0;
                $red = 0;
                $goals_conceded = 0;
                $own_goals = 0;
                $penalty_missed = 0;
                $penalty_saved = 0;
                $clean_sheet = 0;
            } else {
                $goals = isset($_POST['goals'][$player_id]) ? (int)$_POST['goals'][$player_id] : 0;
                $assists = isset($_POST['assists'][$player_id]) ? (int)$_POST['assists'][$player_id] : 0;
                $yellow = isset($_POST['yellow_cards'][$player_id]) ? 1 : 0;
                $red = isset($_POST['red_cards'][$player_id]) ? 1 : 0;
                $goals_conceded = isset($_POST['goals_conceded'][$player_id]) ? (int)$_POST['goals_conceded'][$player_id] : 0;
                $own_goals = isset($_POST['own_goals'][$player_id]) ? (int)$_POST['own_goals'][$player_id] : 0;
                $penalty_missed = isset($_POST['penalty_missed'][$player_id]) ? (int)$_POST['penalty_missed'][$player_id] : 0;
                $penalty_saved = isset($_POST['penalty_saved'][$player_id]) ? (int)$_POST['penalty_saved'][$player_id] : 0;
                $clean_sheet = isset($_POST['clean_sheet'][$player_id]) ? 1 : 0;
            }
            // Elimina eventuale voto precedente (evita duplicati se manca UNIQUE KEY)
            $stmt = $conn->prepare("DELETE FROM player_ratings WHERE player_id = ? AND giornata = ? AND league_id = ?");
            $stmt->bind_param("iii", $player_id, $giornata, $league_id);
            $stmt->execute();
            $stmt->close();
            // Inserisci il nuovo voto
            $stmt = $conn->prepare("INSERT INTO player_ratings (player_id, giornata, league_id, rating, goals, assists, yellow_cards, red_cards, goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->bind_param("iiidiiiiiiiii", $player_id, $giornata, $league_id, $rating, $goals, $assists, $yellow, $red, $goals_conceded, $own_goals, $penalty_missed, $penalty_saved, $clean_sheet);
            $stmt->execute();
        }
    }
    $success = true;
    // Aggiorna i voti mostrati dopo il salvataggio
    $voti_giornata = [];
    $stmt = $conn->prepare("SELECT player_id, rating, goals, assists, yellow_cards, red_cards, goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet FROM player_ratings WHERE league_id = ? AND giornata = ?");
    $stmt->bind_param("ii", $league_id, $giornata);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($row = $res->fetch_assoc()) {
        $voti_giornata[$row['player_id']] = [
            'rating' => $row['rating'],
            'goals' => $row['goals'],
            'assists' => $row['assists'],
            'yellow_cards' => $row['yellow_cards'],
            'red_cards' => $row['red_cards'],
            'goals_conceded' => $row['goals_conceded'],
            'own_goals' => $row['own_goals'],
            'penalty_missed' => $row['penalty_missed'],
            'penalty_saved' => $row['penalty_saved'],
            'clean_sheet' => $row['clean_sheet']
        ];
    }
}

// Funzione per ottenere il nome del ruolo
function getRoleName($role) {
    switch($role) {
        case 'P': return 'Portiere';
        case 'D': return 'Difensore';
        case 'C': return 'Centrocampista';
        case 'A': return 'Attaccante';
        default: return $role;
    }
}

// Funzione per ottenere il badge del ruolo
function getRoleBadge($role) {
    switch($role) {
        case 'P': return 'bg-primary';
        case 'D': return 'bg-success';
        case 'C': return 'bg-warning text-dark';
        case 'A': return 'bg-danger';
        default: return 'bg-secondary';
    }
}

// Recupera informazioni della lega
$league_info = getLeagueById($league_id);
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Inserisci voti giornata - <?php echo htmlspecialchars($league_info['name']); ?></title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
    <style>
        .page-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem 0;
            margin-bottom: 2rem;
        }
        .team-card {
            border: none;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 1.5rem;
            border-radius: 10px;
            overflow: hidden;
        }
        .team-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 1rem 1.5rem;
            font-weight: 600;
            font-size: 1.1rem;
        }
        .player-row {
            border-bottom: 1px solid #eee;
            padding: 0.75rem 1.5rem;
            transition: background-color 0.2s;
        }
        .player-row:hover {
            background-color: #f8f9fa;
        }
        .player-row:last-child {
            border-bottom: none;
        }
        .player-name {
            font-weight: 500;
            color: #2c3e50;
        }
        .role-badge {
            font-size: 0.75rem;
            padding: 0.25rem 0.5rem;
        }
        .rating-controls {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .rating-display {
            min-width: 50px;
            text-align: center;
            font-weight: bold;
            font-size: 1.1rem;
            color: #667eea;
        }
        .btn-rating {
            width: 35px;
            height: 35px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            border: 2px solid;
        }
        .btn-rating:hover {
            transform: scale(1.1);
        }
        .btn-plus {
            background-color: #28a745;
            border-color: #28a745;
            color: white;
        }
        .btn-plus:hover {
            background-color: #218838;
            border-color: #1e7e34;
        }
        .btn-minus {
            background-color: #dc3545;
            border-color: #dc3545;
            color: white;
        }
        .btn-minus:hover {
            background-color: #c82333;
            border-color: #bd2130;
        }
        .sv-checkbox {
            margin-right: 1rem;
        }
        .form-check-input:checked {
            background-color: #dc3545;
            border-color: #dc3545;
        }
        .filters-section {
            background: white;
            border-radius: 10px;
            padding: 1.5rem;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 2rem;
        }
        .success-alert {
            border-radius: 10px;
            border: none;
            box-shadow: 0 2px 10px rgba(40, 167, 69, 0.2);
        }
        .btn-save {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            border: none;
            border-radius: 10px;
            padding: 0.75rem 2rem;
            font-weight: 600;
            box-shadow: 0 4px 15px rgba(40, 167, 69, 0.3);
        }
        .btn-save:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(40, 167, 69, 0.4);
        }
        .team-filter {
            max-height: 200px;
            overflow-y: auto;
        }
        .team-filter .form-check {
            margin-bottom: 0.5rem;
        }
        .rating-disabled {
            opacity: 0.5;
            pointer-events: none;
        }
        @media (max-width: 768px) {
            .rating-controls {
                flex-direction: column;
                gap: 0.25rem;
            }
            .btn-rating {
                width: 30px;
                height: 30px;
                font-size: 0.9rem;
            }
            .rating-display {
                min-width: 40px;
                font-size: 1rem;
            }
        }
    </style>
</head>
<body>
<?php include 'navbar.php'; ?>

<div class="page-header">
    <div class="container">
        <div class="row align-items-center">
            <div class="col">
                <h1 class="mb-0">
                    <i class="bi bi-pencil-square me-2"></i>
                    Inserisci Voti Giornata
                </h1>
                <p class="mb-0 mt-2 opacity-75"><?php echo htmlspecialchars($league_info['name']); ?></p>
            </div>
            <div class="col-auto">
                <a href="dashboard.php" class="btn btn-outline-light">
                    <i class="bi bi-arrow-left me-1"></i>
                    Torna alla Dashboard
                </a>
            </div>
        </div>
    </div>
                </div>

<div class="container py-4">
                    <?php if ($success): ?>
        <div class="alert alert-success success-alert mb-4">
            <i class="bi bi-check-circle me-2"></i>
            Voti salvati con successo!
        </div>
                    <?php endif; ?>

    <!-- Filtri e Selezione Giornata -->
    <div class="filters-section">
        <form method="GET" id="filtersForm">
                        <input type="hidden" name="league_id" value="<?php echo $league_id; ?>">
            <div class="row">
                <div class="col-md-6">
                    <label for="giornata" class="form-label fw-bold">
                        <i class="bi bi-calendar-event me-1"></i>
                        Seleziona Giornata
                    </label>
                    <select name="giornata" id="giornata" class="form-select" onchange="this.form.submit()">
                                <option value="">Scegli giornata...</option>
                                <?php foreach ($giornate as $g): ?>
                            <option value="<?php echo $g['giornata']; ?>" 
                                <?php if ($giornata_sel == $g['giornata']) echo 'selected'; ?>>
                                Giornata <?php echo $g['giornata']; ?>
                            </option>
                                <?php endforeach; ?>
                            </select>
                        </div>
                <div class="col-md-6">
                    <label class="form-label fw-bold">
                        <i class="bi bi-funnel me-1"></i>
                        Filtra Squadre
                    </label>
                    <button class="btn btn-outline-secondary btn-sm mb-2" type="button" data-bs-toggle="collapse" data-bs-target="#teamFilters" aria-expanded="false" aria-controls="teamFilters">
                        <i class="bi bi-chevron-down me-1"></i>
                        Mostra/Nascondi Filtri
                    </button>
                    <div class="collapse" id="teamFilters">
                        <div class="team-filter">
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" id="select-all-teams" checked onchange="toggleAllTeams()">
                                <label class="form-check-label" for="select-all-teams">
                                    <strong>Tutte le squadre</strong>
                                </label>
                            </div>
                            <?php foreach ($squadre as $team_id => $team): ?>
                                <div class="form-check">
                                    <input class="form-check-input team-checkbox" type="checkbox" 
                                        id="team-<?php echo $team_id; ?>" 
                                        checked 
                                        onchange="toggleTeam(<?php echo $team_id; ?>)">
                                    <label class="form-check-label" for="team-<?php echo $team_id; ?>">
                                        <?php echo htmlspecialchars($team['name']); ?>
                                    </label>
                                </div>
                            <?php endforeach; ?>
                        </div>
                    </div>
                </div>
            </div>
        </form>
    </div>

    <!-- Form per inserimento voti -->
    <?php if ($giornata_sel): ?>
        <form method="POST" id="votiForm">
            <input type="hidden" name="league_id" value="<?php echo $league_id; ?>">
            <input type="hidden" name="giornata" value="<?php echo $giornata_sel; ?>">
            
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h3 class="mb-0">
                    <i class="bi bi-trophy me-2"></i>
                    Giornata <?php echo $giornata_sel; ?>
                </h3>
                <button type="submit" class="btn btn-save text-white">
                    <i class="bi bi-save me-2"></i>
                    Salva Tutti i Voti
                </button>
            </div>

            <?php foreach ($squadre as $team_id => $team): ?>
                <div class="team-card" id="team-card-<?php echo $team_id; ?>">
                    <div class="team-header d-flex justify-content-between align-items-center">
                        <div>
                            <i class="bi bi-people me-2"></i>
                            <?php echo htmlspecialchars($team['name']); ?>
                        </div>
                        <button type="button" class="btn btn-outline-light btn-sm" onclick="saveTeam(<?php echo $team_id; ?>, event)">
                            <i class="bi bi-save me-1"></i>
                            Salva Squadra
                        </button>
                                </div>
                                <div class="card-body p-0">
                                        <?php foreach ($team['players'] as $player): ?>
                                            <?php
                                                $pid = $player['id'];
                                $voto = isset($voti_giornata[$pid]['rating']) ? $voti_giornata[$pid]['rating'] : 0;
                                $is_sv = ($voto == 0);
                                $display_voto = $is_sv ? 'S.V.' : number_format($voto, 2);
                            ?>
                            <div class="player-row d-flex align-items-center">
                                <div class="col-md-4">
                                    <div class="d-flex align-items-center">
                                        <span class="badge <?php echo getRoleBadge($player['role']); ?> role-badge me-2">
                                            <?php echo getRoleName($player['role']); ?>
                                        </span>
                                        <span class="player-name">
                                            <?php echo htmlspecialchars($player['first_name'] . ' ' . $player['last_name']); ?>
                                        </span>
                                    </div>
                                </div>
                                <div class="col-md-8">
                                    <div class="rating-controls">
                                                    <!-- Checkbox S.V. -->
                                        <div class="form-check sv-checkbox">
                                                        <input class="form-check-input" type="checkbox" 
                                                            id="sv-<?php echo $pid; ?>" 
                                                            onchange="toggleSV(<?php echo $pid; ?>)" 
                                                <?php echo $is_sv ? 'checked' : ''; ?>>
                                            <label class="form-check-label" for="sv-<?php echo $pid; ?>">
                                                <strong>S.V.</strong>
                                            </label>
                                        </div>

                                        <!-- Controlli voto -->
                                        <div class="d-flex align-items-center gap-2">
                                            <button type="button" class="btn btn-minus btn-rating" 
                                                onclick="changeRating(<?php echo $pid; ?>, -0.25)"
                                                <?php echo $is_sv ? 'disabled' : ''; ?>>
                                                -
                                            </button>
                                            
                                            <input type="number" class="form-control rating-input" 
                                                id="rating-manual-<?php echo $pid; ?>" 
                                                value="<?php echo $is_sv ? '' : number_format($voto, 2); ?>" 
                                                min="1" max="10" step="0.25" 
                                                style="width: 80px; text-align: center;"
                                                onchange="updateRatingFromInput(<?php echo $pid; ?>)"
                                                oninput="updateRatingFromInput(<?php echo $pid; ?>)"
                                                <?php echo $is_sv ? 'disabled' : ''; ?>>
                                            
                                            <button type="button" class="btn btn-plus btn-rating" 
                                                onclick="changeRating(<?php echo $pid; ?>, 0.25)"
                                                <?php echo $is_sv ? 'disabled' : ''; ?>>
                                                +
                                            </button>
                                        </div>

                                        <!-- Input nascosto per il voto -->
                                        <input type="hidden" name="rating[<?php echo $pid; ?>]" 
                                            id="rating-input-<?php echo $pid; ?>" 
                                            value="<?php echo $voto; ?>">

                                        <!-- Bonus/Malus -->
                                        <?php if ($bonus_enabled): ?>
                                            <div class="ms-3">
                                                <button type="button" class="btn btn-outline-secondary btn-sm" 
                                                    id="bonus-btn-<?php echo $pid; ?>"
                                                    data-bs-toggle="collapse" 
                                                    data-bs-target="#bonus-<?php echo $pid; ?>" 
                                                    aria-expanded="false"
                                                    <?php echo $is_sv ? 'disabled' : ''; ?>>
                                                    <i class="bi bi-plus-circle me-1"></i>
                                                    Bonus/Malus
                                                </button>
                                                <div class="collapse mt-2" id="bonus-<?php echo $pid; ?>">
                                                    <div class="card card-body p-2">
                                                        <div class="row g-2">
                                                            <?php if ($bonus_settings['enable_goal']): ?>
                                                                <div class="col-6">
                                                                    <label class="form-label small">Gol</label>
                                                                    <input type="number" class="form-control form-control-sm" 
                                                                        name="goals[<?php echo $pid; ?>]" 
                                                                        value="<?php echo isset($voti_giornata[$pid]['goals']) ? $voti_giornata[$pid]['goals'] : 0; ?>" 
                                                                        min="0" max="10">
                                                                </div>
                                                            <?php endif; ?>
                                                            <?php if ($bonus_settings['enable_assist']): ?>
                                                                <div class="col-6">
                                                                    <label class="form-label small">Assist</label>
                                                                    <input type="number" class="form-control form-control-sm" 
                                                                        name="assists[<?php echo $pid; ?>]" 
                                                                        value="<?php echo isset($voti_giornata[$pid]['assists']) ? $voti_giornata[$pid]['assists'] : 0; ?>" 
                                                                        min="0" max="10">
                                                                </div>
                                                            <?php endif; ?>
                                                            <?php if ($bonus_settings['enable_yellow_card']): ?>
                                                                <div class="col-6">
                                                                    <div class="form-check">
                                                                        <input class="form-check-input" type="checkbox" 
                                                                            name="yellow_cards[<?php echo $pid; ?>]" 
                                                                            <?php echo (isset($voti_giornata[$pid]['yellow_cards']) && $voti_giornata[$pid]['yellow_cards']) ? 'checked' : ''; ?>>
                                                                        <label class="form-check-label small">Cartellino Giallo</label>
                                                                    </div>
                                                                </div>
                                                            <?php endif; ?>
                                                            <?php if ($bonus_settings['enable_red_card']): ?>
                                                                <div class="col-6">
                                                                    <div class="form-check">
                                                                        <input class="form-check-input" type="checkbox" 
                                                                            name="red_cards[<?php echo $pid; ?>]" 
                                                                            <?php echo (isset($voti_giornata[$pid]['red_cards']) && $voti_giornata[$pid]['red_cards']) ? 'checked' : ''; ?>>
                                                                        <label class="form-check-label small">Cartellino Rosso</label>
                                                                    </div>
                                                                </div>
                                                            <?php endif; ?>
                                                            <?php if ($bonus_settings['enable_goals_conceded']): ?>
                                                                <div class="col-6">
                                                                    <label class="form-label small">Goal Subiti</label>
                                                                    <input type="number" class="form-control form-control-sm" 
                                                                        name="goals_conceded[<?php echo $pid; ?>]" 
                                                                        value="<?php echo isset($voti_giornata[$pid]['goals_conceded']) ? $voti_giornata[$pid]['goals_conceded'] : 0; ?>" 
                                                                        min="0" max="20">
                                                                </div>
                                                            <?php endif; ?>
                                                            <?php if ($bonus_settings['enable_own_goal']): ?>
                                                                <div class="col-6">
                                                                    <label class="form-label small">Autogoal</label>
                                                                    <input type="number" class="form-control form-control-sm" 
                                                                        name="own_goals[<?php echo $pid; ?>]" 
                                                                        value="<?php echo isset($voti_giornata[$pid]['own_goals']) ? $voti_giornata[$pid]['own_goals'] : 0; ?>" 
                                                                        min="0" max="10">
                                                                </div>
                                                            <?php endif; ?>
                                                            <?php if ($bonus_settings['enable_penalty_missed']): ?>
                                                                <div class="col-6">
                                                                    <label class="form-label small">Rigori Sbagliati</label>
                                                                    <input type="number" class="form-control form-control-sm" 
                                                                        name="penalty_missed[<?php echo $pid; ?>]" 
                                                                        value="<?php echo isset($voti_giornata[$pid]['penalty_missed']) ? $voti_giornata[$pid]['penalty_missed'] : 0; ?>" 
                                                                        min="0" max="10">
                                                                </div>
                                                            <?php endif; ?>
                                                            <?php if ($bonus_settings['enable_penalty_saved']): ?>
                                                                <div class="col-6">
                                                                    <label class="form-label small">Rigori Parati</label>
                                                                    <input type="number" class="form-control form-control-sm" 
                                                                        name="penalty_saved[<?php echo $pid; ?>]" 
                                                                        value="<?php echo isset($voti_giornata[$pid]['penalty_saved']) ? $voti_giornata[$pid]['penalty_saved'] : 0; ?>" 
                                                                        min="0" max="10">
                                                                </div>
                                                            <?php endif; ?>
                                                            <?php if ($bonus_settings['enable_clean_sheet']): ?>
                                                                <div class="col-6">
                                                                    <div class="form-check">
                                                                        <input class="form-check-input" type="checkbox" 
                                                                            name="clean_sheet[<?php echo $pid; ?>]" 
                                                                            <?php echo (isset($voti_giornata[$pid]['clean_sheet']) && $voti_giornata[$pid]['clean_sheet']) ? 'checked' : ''; ?>>
                                                                        <label class="form-check-label small">Clean Sheet</label>
                                                                    </div>
                                                                </div>
                                                            <?php endif; ?>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        <?php endif; ?>
                                    </div>
                                </div>
                            </div>
                        <?php endforeach; ?>
                        </div>
                </div>
            <?php endforeach; ?>
        </form>
    <?php else: ?>
        <div class="text-center py-5">
            <i class="bi bi-calendar-x display-1 text-muted"></i>
            <h3 class="mt-3 text-muted">Seleziona una giornata</h3>
            <p class="text-muted">Scegli una giornata dal menu sopra per iniziare a inserire i voti.</p>
        </div>
    <?php endif; ?>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script>
// Funzioni per gestire i voti
function toggleSV(playerId) {
    const checkbox = document.getElementById('sv-' + playerId);
    const input = document.getElementById('rating-input-' + playerId);
    const manualInput = document.getElementById('rating-manual-' + playerId);
    const minusBtn = document.querySelector(`button[onclick="changeRating(${playerId}, -0.25)"]`);
    const plusBtn = document.querySelector(`button[onclick="changeRating(${playerId}, 0.25)"]`);
    const bonusBtn = document.getElementById('bonus-btn-' + playerId);
    
    if (checkbox.checked) {
        // Attiva S.V.
        input.value = '0';
        if (manualInput) {
            manualInput.value = '';
            manualInput.disabled = true;
        }
        if (minusBtn) minusBtn.disabled = true;
        if (plusBtn) plusBtn.disabled = true;
        if (bonusBtn) bonusBtn.disabled = true;
    } else {
        // Disattiva S.V. e imposta voto minimo
        const currentValue = parseFloat(input.value) || 1;
        const newValue = Math.max(1, currentValue);
        input.value = newValue;
        if (manualInput) {
            manualInput.value = newValue.toFixed(2);
            manualInput.disabled = false;
        }
        if (minusBtn) minusBtn.disabled = false;
        if (plusBtn) plusBtn.disabled = false;
        if (bonusBtn) bonusBtn.disabled = false;
    }
}

function changeRating(playerId, change) {
    const input = document.getElementById('rating-input-' + playerId);
    const manualInput = document.getElementById('rating-manual-' + playerId);
    const svCheckbox = document.getElementById('sv-' + playerId);
    
    // Se S.V. è attivo, non fare nulla
    if (svCheckbox.checked) return;
    
    const currentValue = parseFloat(input.value) || 1;
    const newValue = Math.max(1, Math.min(10, currentValue + change));
    
    // Arrotonda a 0.25
    const roundedValue = Math.round(newValue * 4) / 4;
    
    input.value = roundedValue;
    if (manualInput) {
        manualInput.value = roundedValue.toFixed(2);
    }
}

function updateRatingFromInput(playerId) {
    const manualInput = document.getElementById('rating-manual-' + playerId);
    const input = document.getElementById('rating-input-' + playerId);
    const svCheckbox = document.getElementById('sv-' + playerId);
    
    // Se S.V. è attivo, non fare nulla
    if (svCheckbox.checked) return;
    
    const value = parseFloat(manualInput.value);
    if (!isNaN(value) && value >= 1 && value <= 10) {
        // Arrotonda a 0.25
        const roundedValue = Math.round(value * 4) / 4;
        input.value = roundedValue;
        manualInput.value = roundedValue.toFixed(2);
    }
}

// Funzioni per gestire i filtri squadre
function toggleAllTeams() {
    const selectAll = document.getElementById('select-all-teams');
    const teamCheckboxes = document.querySelectorAll('.team-checkbox');
    
    teamCheckboxes.forEach(checkbox => {
        checkbox.checked = selectAll.checked;
        const teamId = checkbox.id.replace('team-', '');
        toggleTeam(teamId);
    });
}

function toggleTeam(teamId) {
    const checkbox = document.getElementById('team-' + teamId);
    const teamCard = document.getElementById('team-card-' + teamId);
    
    if (checkbox.checked) {
        teamCard.style.display = 'block';
    } else {
        teamCard.style.display = 'none';
    }
    
    // Aggiorna lo stato del checkbox "Tutte le squadre"
    const allCheckboxes = document.querySelectorAll('.team-checkbox');
    const checkedCheckboxes = document.querySelectorAll('.team-checkbox:checked');
    const selectAll = document.getElementById('select-all-teams');
    
    selectAll.checked = (allCheckboxes.length === checkedCheckboxes.length);
}

// Funzione per salvare una singola squadra
function saveTeam(teamId, event) {
    const form = document.getElementById('votiForm');
    const formData = new FormData(form);
    
    // Aggiungi un campo per indicare che stiamo salvando solo una squadra
    formData.append('save_team_only', teamId);
    
    // Mostra loading
    const btn = event.currentTarget;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Salvando...';
    btn.disabled = true;
    
    fetch('inserisci_voti.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.text())
    .then(data => {
        // Ricarica la pagina per mostrare i voti aggiornati
        window.location.reload();
    })
    .catch(error => {
        console.error('Errore:', error);
        alert('Errore durante il salvataggio');
        btn.innerHTML = originalText;
        btn.disabled = false;
    });
}

// Inizializza i filtri al caricamento della pagina
document.addEventListener('DOMContentLoaded', function() {
    // Mostra tutte le squadre di default
    document.querySelectorAll('.team-checkbox').forEach(checkbox => {
        const teamId = checkbox.id.replace('team-', '');
        toggleTeam(teamId);
    });
});
</script>
</body>
</html> 
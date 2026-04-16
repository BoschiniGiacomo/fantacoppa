<?php
require_once 'db.php';
require_once 'functions.php';
session_start();

if (!isset($_SESSION['user_id'])) {
    header('Location: index.php');
    exit();
}

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
// Recupera le giornate disponibili
$stmt = $conn->prepare("SELECT giornata FROM matchdays WHERE league_id = ? ORDER BY giornata");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$giornate = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// Trova l'ultima giornata con voti
$last_day_with_votes = null;
if (!empty($giornate)) {
    $stmt = $conn->prepare("SELECT MAX(giornata) as last_day FROM player_ratings WHERE league_id = ? AND rating IS NOT NULL");
    $stmt->bind_param("i", $league_id);
    $stmt->execute();
    $result = $stmt->get_result()->fetch_assoc();
    $last_day_with_votes = $result['last_day'];
}

// Se non è specificata una giornata, usa l'ultima con voti o la prima disponibile
$selected_giornata = isset($_GET['giornata']) ? (int)$_GET['giornata'] : ($last_day_with_votes ?: ($giornate[0]['giornata'] ?? null));

// Recupera gli utenti della lega con team names
$stmt = $conn->prepare("SELECT u.id, u.username, ub.team_name FROM users u JOIN user_budget ub ON u.id = ub.user_id WHERE ub.league_id = ?");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$utenti = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// Recupera le rose degli utenti
$rose = [];
$stmt = $conn->prepare("SELECT up.user_id, up.player_id FROM user_players up WHERE up.league_id = ?");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
    $rose[$row['user_id']][] = $row['player_id'];
}

// Recupera i voti dei giocatori per giornata (aggiungo bonus/malus)
$voti = [];
$bonus_giornata = [];
if ($selected_giornata) {
    $stmt = $conn->prepare("SELECT player_id, rating, goals, assists, yellow_cards, red_cards, goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet FROM player_ratings WHERE league_id = ? AND giornata = ?");
    $stmt->bind_param("ii", $league_id, $selected_giornata);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($row = $res->fetch_assoc()) {
        $voti[$row['player_id']] = $row['rating'];
        $bonus_giornata[$row['player_id']] = [
            'goals' => (int)$row['goals'],
            'assists' => (int)$row['assists'],
            'yellow_cards' => (int)$row['yellow_cards'],
            'red_cards' => (int)$row['red_cards'],
            'goals_conceded' => (int)$row['goals_conceded'],
            'own_goals' => (int)$row['own_goals'],
            'penalty_missed' => (int)$row['penalty_missed'],
            'penalty_saved' => (int)$row['penalty_saved'],
            'clean_sheet' => (int)$row['clean_sheet']
        ];
    }
}

// Calcola i punteggi degli utenti
$classifica = [];
$classifica_generale = [];
$league = getLeagueById($league_id);

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

// Classifica giornata specifica: usa matchday_results se calcolata
$is_matchday_calculated = false;
if ($selected_giornata) {
    $stmt = $conn->prepare("SELECT mr.user_id, mr.punteggio, u.username, ub.team_name FROM matchday_results mr JOIN users u ON mr.user_id = u.id JOIN user_budget ub ON mr.user_id = ub.user_id AND ub.league_id = mr.league_id WHERE mr.league_id = ? AND mr.giornata = ? ORDER BY mr.punteggio DESC");
    $stmt->bind_param("ii", $league_id, $selected_giornata);
    $stmt->execute();
    $calcRes = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    if (count($calcRes) > 0) {
        $is_matchday_calculated = true;
        foreach ($calcRes as $cr) {
            $classifica[] = [
                'id' => (int)$cr['user_id'],
                'username' => $cr['username'],
                'team_name' => $cr['team_name'],
                'punteggio' => round(floatval($cr['punteggio']), 1),
            ];
        }
    } else {
        // Non calcolata: calcolo live on-the-fly
// Recupera impostazioni bonus/malus della lega
$bonus_defaults = [
    'enable_goal' => 1, 'bonus_goal' => 3.0,
    'enable_assist' => 1, 'bonus_assist' => 1.0,
    'enable_yellow_card' => 1, 'malus_yellow_card' => -0.5,
    'enable_red_card' => 1, 'malus_red_card' => -1.0
];
$bonus_settings = $bonus_defaults;
$stmt = $conn->prepare("SELECT * FROM league_bonus_settings WHERE league_id = ?");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$res = $stmt->get_result();
if ($row = $res->fetch_assoc()) {
    $bonus_settings = array_merge($bonus_defaults, $row);
}
$bonus_enabled = $bonus_settings['enable_bonus_malus'] && (
    $bonus_settings['enable_goal'] || $bonus_settings['enable_assist'] || $bonus_settings['enable_yellow_card'] || $bonus_settings['enable_red_card']
);

        foreach ($utenti as $utente) {
            $uid = $utente['id'];
            $somma = 0;
            $titolari = [];
            if ($league['auto_lineup_mode']) {
                $voti_giornata_specifica = [];
                $stmt_voti = $conn->prepare("SELECT player_id, rating FROM player_ratings WHERE league_id = ? AND giornata = ?");
                $stmt_voti->bind_param("ii", $league_id, $selected_giornata);
                $stmt_voti->execute();
                $res_voti = $stmt_voti->get_result();
                while ($row_voti = $res_voti->fetch_assoc()) {
                    $voti_giornata_specifica[$row_voti['player_id']] = $row_voti['rating'];
                }
                $titolari = build_auto_lineup($uid, $league, $rose, $voti_giornata_specifica, $conn);
            } else {
                $stmt = $conn->prepare("SELECT titolari FROM user_lineups WHERE user_id = ? AND league_id = ? AND giornata = ?");
                $stmt->bind_param("iii", $uid, $league_id, $selected_giornata);
                $stmt->execute();
                $res = $stmt->get_result();
                if ($row = $res->fetch_assoc()) {
                    $titolari_str = $row['titolari'];
                    if ($titolari_str && $titolari_str[0] === '[') {
                        $titolari = json_decode($titolari_str, true);
                    } else if ($titolari_str) {
                        $titolari = explode(',', $titolari_str);
                    }
                }
            }

            if (!empty($titolari)) {
                foreach ($titolari as $pid) {
                    if ($pid && isset($voti[$pid])) {
                        $base = $voti[$pid];
                        $bonus = 0;
                        if ($bonus_enabled && isset($bonus_giornata[$pid])) {
                            $b = $bonus_giornata[$pid];
                            if ($bonus_settings['enable_goal']) $bonus += $b['goals'] * $bonus_settings['bonus_goal'];
                            if ($bonus_settings['enable_assist']) $bonus += $b['assists'] * $bonus_settings['bonus_assist'];
                            if ($bonus_settings['enable_yellow_card']) $bonus += $b['yellow_cards'] * $bonus_settings['malus_yellow_card'];
                            if ($bonus_settings['enable_red_card']) $bonus += $b['red_cards'] * $bonus_settings['malus_red_card'];
                        }
                        $somma += floatval($base) + $bonus;
                    }
                }
            }
            $classifica[] = [
                'id' => $utente['id'],
                'username' => $utente['username'],
                'team_name' => $utente['team_name'],
                'punteggio' => $somma
            ];
        }
        usort($classifica, function($a, $b) {
            return $b['punteggio'] <=> $a['punteggio'];
        });
    }
}

// Classifica generale: basata SOLO su giornate calcolate (matchday_results)
$stmt = $conn->prepare("SELECT user_id, SUM(punteggio) as totale, COUNT(*) as giornate_calc FROM matchday_results WHERE league_id = ? GROUP BY user_id");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$calcTotals = [];
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
    $calcTotals[$row['user_id']] = [
        'punteggio' => round(floatval($row['totale']), 1),
        'giornate_con_voti' => (int)$row['giornate_calc'],
    ];
}
$stmt->close();

foreach ($utenti as $utente) {
    $uid = $utente['id'];
    $ct = $calcTotals[$uid] ?? ['punteggio' => 0, 'giornate_con_voti' => 0];
    $classifica_generale[] = [
        'id' => $utente['id'],
        'username' => $utente['username'],
        'team_name' => $utente['team_name'],
        'punteggio' => $ct['punteggio'],
        'giornate_con_voti' => $ct['giornate_con_voti'],
    ];
}

usort($classifica_generale, function($a, $b) {
    return $b['punteggio'] <=> $a['punteggio'];
});


?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Risultati Giornata - FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
    <link href="assets/css/app-ui.css" rel="stylesheet">
    <style>
        .page-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem 0;
            margin-bottom: 2rem;
        }
        
        .results-card {
            transition: transform 0.2s, box-shadow 0.2s;
            border: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-radius: 12px;
        }
        
        .results-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        }
        
        .team-card {
            transition: transform 0.2s, box-shadow 0.2s;
            cursor: pointer;
            border: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-radius: 12px;
            margin-bottom: 1rem;
        }
        
        .team-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        }
        
        .team-name {
            font-size: 1.4rem;
            font-weight: bold;
            color: #2c3e50;
        }
        
        .coach-name {
            font-size: 0.9rem;
            color: #6c757d;
            margin-bottom: 0.5rem;
        }
        
        .score-section {
            text-align: right;
        }
        
        .score-amount {
            font-size: 1.8rem;
            font-weight: bold;
            color: #28a745;
        }
        
        .score-label {
            font-size: 0.8rem;
            color: #6c757d;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .nav-tabs .nav-link {
            border: none;
            color: #6c757d;
            font-weight: 500;
        }
        
        .nav-tabs .nav-link.active {
            color: #667eea;
            border-bottom: 2px solid #667eea;
        }
        
        .formation-details {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 1rem;
            margin-top: 1rem;
            border-left: 4px solid #0d6efd;
        }
        
        .formation-details h6 {
            color: #2c3e50;
            font-weight: 600;
            margin-bottom: 0.5rem;
        }
        
        .player-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.5rem 0;
            border-bottom: 1px solid #e9ecef;
        }
        
        .player-row:last-child {
            border-bottom: none;
        }
        
        .player-name {
            font-weight: 500;
            color: #2c3e50;
        }
        
        .player-vote {
            font-weight: bold;
            color: #28a745;
        }
        
        .bonus-malus {
            display: flex;
            gap: 0.25rem;
        }
        
        .bonus-malus span {
            font-size: 1.2em;
        }
        
        .role-badge {
            font-size: 0.8rem;
            font-weight: bold;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            margin-right: 0.5rem;
        }
        
        .role-badge.P { background: #0d6efd; color: white; }
        .role-badge.D { background: #198754; color: white; }
        .role-badge.C { background: #ffc107; color: #212529; }
        .role-badge.A { background: #dc3545; color: white; }
        
        .player-info {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .vote-section {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        
        .vote-display {
            display: flex;
            flex-direction: column;
            align-items: center;
            min-width: 60px;
        }
        
        .vote-number {
            font-size: 1.2rem;
            font-weight: bold;
            color: #28a745;
        }
        
        .vote-label {
            font-size: 0.7rem;
            color: #6c757d;
            text-transform: uppercase;
        }
        
        .position-badge {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 1.1rem;
        }
        
        .position-badge.first {
            background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%);
            color: #333;
        }
        
        .position-badge.second {
            background: linear-gradient(135deg, #c0c0c0 0%, #e8e8e8 100%);
            color: #333;
        }
        
        .position-badge.third {
            background: linear-gradient(135deg, #cd7f32 0%, #daa520 100%);
            color: white;
        }
        
        .day-selector {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .day-selector h5 {
            color: #2c3e50;
            font-weight: 600;
            margin-bottom: 1rem;
        }
        
        .btn-day-nav {
            border-radius: 8px;
            font-weight: 500;
            padding: 0.5rem 1rem;
            transition: all 0.3s ease;
        }
        
        .btn-day-nav:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        
        .my-team {
            border: 2px solid #0d6efd !important;
            background: linear-gradient(135deg, #e3f2fd 0%, #f8f9fa 100%) !important;
        }
        
        .no-results {
            text-align: center;
            padding: 3rem 1rem;
            color: #6c757d;
        }
        
        .no-results i {
            font-size: 4rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }
        
        @media (max-width: 768px) {
            .team-name {
                font-size: 1.2rem;
            }
            
            .score-amount {
                font-size: 1.5rem;
            }
            
            .position-badge {
                width: 35px;
                height: 35px;
                font-size: 1rem;
            }
        }
        
        @media (max-width: 575.98px) {
            .team-name {
                font-size: 1.1rem;
            }
            
            .coach-name {
                font-size: 0.8rem;
            }
            
            .score-amount {
                font-size: 1.3rem;
            }
            
            .position-badge {
                width: 30px;
                height: 30px;
                font-size: 0.9rem;
            }
        }
    </style>
</head>
<body class="bg-light fc-results-page">
<?php include 'navbar.php'; ?>


<div class="container fc-page-container">
    <div class="fc-results-header">
        <h4 class="mb-0 fw-bold text-dark"><i class="bi bi-trophy me-2 text-primary"></i>Classifica e Risultati</h4>
    </div>
    

    <!-- Results Section -->
    <div class="row mb-4">
        <div class="col-12">
            <div class="card results-card fc-results-main-card">
                <div class="card-header bg-primary text-white d-flex align-items-center">
                    <i class="bi bi-trophy me-2"></i>
                    <h5 class="mb-0">Risultati e Classifiche</h5>
                </div>
                <div class="card-body">
                    <!-- Tab Navigation -->
                    <ul class="nav nav-tabs mb-4" id="resultsTabs" role="tablist">
                        <li class="nav-item" role="presentation">
                            <button class="nav-link <?php echo !$selected_giornata ? 'active' : ''; ?>" id="generale-tab" data-bs-toggle="tab" data-bs-target="#generale" type="button" role="tab" aria-controls="generale" aria-selected="<?php echo !$selected_giornata ? 'true' : 'false'; ?>">
                                <i class="bi bi-trophy me-1"></i>
                                Classifica Generale
                            </button>
                        </li>
                        <li class="nav-item" role="presentation">
                            <button class="nav-link <?php echo $selected_giornata ? 'active' : ''; ?>" id="giornata-tab" data-bs-toggle="tab" data-bs-target="#giornata" type="button" role="tab" aria-controls="giornata" aria-selected="<?php echo $selected_giornata ? 'true' : 'false'; ?>">
                                <i class="bi bi-calendar-event me-1"></i>
                                Risultati Giornata
                            </button>
                        </li>
                    </ul>

                    <!-- Tab Content -->
                    <div class="tab-content" id="resultsTabsContent">
                        <!-- Tab Classifica Generale -->
                        <div class="tab-pane fade <?php echo !$selected_giornata ? 'show active' : ''; ?>" id="generale" role="tabpanel" aria-labelledby="generale-tab">
                            <h6 class="mb-3"><i class="bi bi-trophy me-2"></i>Classifica Generale</h6>
                            <div class="row">
                                <?php $pos = 1; $uid_logged = $_SESSION['user_id']; foreach ($classifica_generale as $row): 
                                    $isMe = ($row['id'] == $uid_logged);
                                    $positionClass = '';
                                    if ($pos == 1) $positionClass = 'first';
                                    elseif ($pos == 2) $positionClass = 'second';
                                    elseif ($pos == 3) $positionClass = 'third';
                                ?>
                                    <div class="col-12">
                                        <div class="card team-card <?php echo $isMe ? 'my-team' : ''; ?>">
                                            <div class="card-body">
                                                <div class="d-flex justify-content-between align-items-center">
                                                    <div class="d-flex align-items-center">
                                                        <div class="position-badge <?php echo $positionClass; ?> me-3">
                                                            <?php echo $pos; ?>
                                                        </div>
                                                        <div>
                                                            <h5 class="team-name mb-1"><?php echo htmlspecialchars($row['team_name']); ?></h5>
                                                            <small class="text-muted">
                                                                <i class="bi bi-person me-1"></i>
                                                                <?php echo htmlspecialchars($row['username']); ?>
                                                            </small>
                                                            <?php if ($isMe): ?>
                                                                <span class="badge bg-primary ms-2">La tua squadra</span>
                                                            <?php endif; ?>
                                                        </div>
                                                    </div>
                                                    <div class="d-flex align-items-center gap-4">
                                                        <div class="text-center">
                                                            <div class="score-amount"><?php echo number_format($row['punteggio'], 1); ?></div>
                                                            <div class="score-label">Punti Totali</div>
                                                        </div>
                                                        <div class="text-center">
                                                            <div class="score-amount" style="color: #6c757d;"><?php echo number_format($row['punteggio']/max(1,$row['giornate_con_voti']), 1); ?></div>
                                                            <div class="score-label">Media Punti</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                <?php $pos++; endforeach; ?>
                            </div>
                        </div>

                        <!-- Tab Risultati Giornata -->
                        <div class="tab-pane fade <?php echo $selected_giornata ? 'show active' : ''; ?>" id="giornata" role="tabpanel" aria-labelledby="giornata-tab">
                            <!-- Day Selector -->
                            <div class="day-selector mb-4">
                                <h6><i class="bi bi-calendar-event me-2"></i>Seleziona Giornata</h6>
                                <form method="GET" id="dayForm">
                                    <input type="hidden" name="league_id" value="<?php echo $league_id; ?>">
                                    <div class="row g-3 align-items-center">
                                        <div class="col-md-4">
                                            <label for="giornata" class="form-label">Giornata</label>
                                            <select name="giornata" id="giornata" class="form-select" onchange="this.form.submit()">
                                                <?php foreach ($giornate as $g): ?>
                                                    <option value="<?php echo $g['giornata']; ?>" <?php if ($selected_giornata == $g['giornata']) echo 'selected'; ?>>
                                                        Giornata <?php echo $g['giornata']; ?>
                                                    </option>
                                                <?php endforeach; ?>
                                            </select>
                                        </div>
                                        <div class="col-md-8">
                                            <div class="d-flex gap-2">
                                                <?php if ($selected_giornata && $selected_giornata > 1): ?>
                                                    <a href="?league_id=<?php echo $league_id; ?>&giornata=<?php echo $selected_giornata - 1; ?>" class="btn btn-outline-primary btn-day-nav">
                                                        <i class="bi bi-chevron-left"></i> Giornata Precedente
                                                    </a>
                                                <?php endif; ?>
                                                <?php if ($selected_giornata && $selected_giornata < max(array_column($giornate, 'giornata'))): ?>
                                                    <a href="?league_id=<?php echo $league_id; ?>&giornata=<?php echo $selected_giornata + 1; ?>" class="btn btn-outline-primary btn-day-nav">
                                                        Giornata Successiva <i class="bi bi-chevron-right"></i>
                                                    </a>
                                                <?php endif; ?>
                                            </div>
                                        </div>
                                    </div>
                                </form>
                            </div>
                            
                            <?php if ($selected_giornata): ?>
                                <div class="d-flex align-items-center mb-3">
                                    <h6 class="mb-0"><i class="bi bi-list-ol me-2"></i>Risultati Giornata <?php echo $selected_giornata; ?></h6>
                                    <?php if ($is_matchday_calculated): ?>
                                        <span class="badge bg-success ms-2"><i class="bi bi-check-circle me-1"></i>Calcolata</span>
                                    <?php else: ?>
                                        <span class="badge bg-warning text-dark ms-2"><i class="bi bi-clock me-1"></i>Live (non calcolata)</span>
                                    <?php endif; ?>
                                </div>
                                <?php if (empty($classifica)): ?>
                                    <div class="no-results">
                                        <i class="bi bi-calculator"></i>
                                        <h4>Giornata non ancora calcolata</h4>
                                        <p>I voti sono stati inseriti ma la giornata non è ancora stata calcolata dall'amministratore.</p>
                                    </div>
                                <?php else: ?>
                                    <div class="row">
                                        <?php $pos = 1; $uid_logged = $_SESSION['user_id']; foreach ($classifica as $row): 
                                            $isMe = ($row['id'] == $uid_logged);
                                            $positionClass = '';
                                            if ($pos == 1) $positionClass = 'first';
                                            elseif ($pos == 2) $positionClass = 'second';
                                            elseif ($pos == 3) $positionClass = 'third';
                                        ?>
                                            <div class="col-12">
                                                <div class="card team-card <?php echo $isMe ? 'my-team' : ''; ?>" onclick="toggleFormation(<?php echo $row['id']; ?>)">
                                                    <div class="card-body">
                                                        <div class="d-flex justify-content-between align-items-center">
                                                            <div class="d-flex align-items-center">
                                                                <div class="position-badge <?php echo $positionClass; ?> me-3">
                                                                    <?php echo $pos; ?>
                                                                </div>
                                                                <div>
                                                                    <h5 class="team-name mb-1"><?php echo htmlspecialchars($row['team_name']); ?></h5>
                                                                    <small class="text-muted">
                                                                        <i class="bi bi-person me-1"></i>
                                                                        <?php echo htmlspecialchars($row['username']); ?>
                                                                    </small>
                                                                    <?php if ($isMe): ?>
                                                                        <span class="badge bg-primary ms-2">La tua squadra</span>
                                                                    <?php endif; ?>
                                                                </div>
                                                            </div>
                                                            <div class="score-section">
                                                                <div class="score-amount"><?php echo number_format($row['punteggio'], 1); ?></div>
                                                                <div class="score-label">Punti</div>
                                                            </div>
                                                        </div>
                                                        <div id="formation-<?php echo $row['id']; ?>" class="formation-details d-none">
                                                            <?php
                                                            // Recupera titolari di questo utente per la giornata
                                                            $uid = $row['id'];
                                                            $titolari = [];
                                                            $stmt = $conn->prepare("SELECT titolari FROM user_lineups WHERE user_id = ? AND league_id = ? AND giornata = ?");
                                                            $stmt->bind_param("iii", $uid, $league_id, $selected_giornata);
                                                            $stmt->execute();
                                                            $res = $stmt->get_result();
                                                            if ($r = $res->fetch_assoc()) {
                                                                $titolari_str = $r['titolari'];
                                                                if ($titolari_str && $titolari_str[0] === '[') $titolari = json_decode($titolari_str, true);
                                                                else if ($titolari_str) $titolari = explode(',', $titolari_str);
                                                            }
                                                            // Se non esiste una formazione salvata e la lega è in modalità automatica, calcola la miglior formazione automatica per visualizzazione
                                                            if (empty($titolari) && $league && $league['auto_lineup_mode']) {
                                                                $titolari = build_auto_lineup($uid, $league, $rose, $voti, $conn);
                                                            }
                                                            // Recupera nomi e ruoli
                                                            $giocatori = [];
                                                            if (!empty($titolari)) {
                                                                $in = implode(',', array_fill(0, count($titolari), '?'));
                                                                $types = str_repeat('i', count($titolari));
                                                                $stmt2 = $conn->prepare("SELECT id, first_name, last_name, role FROM players WHERE id IN ($in)");
                                                                $stmt2->bind_param($types, ...$titolari);
                                                                $stmt2->execute();
                                                                $res2 = $stmt2->get_result();
                                                                while ($g = $res2->fetch_assoc()) {
                                                                    $giocatori[$g['id']] = [
                                                                        'name' => $g['first_name'] . ' ' . $g['last_name'],
                                                                        'role' => $g['role']
                                                                    ];
                                                                }
                                                            }
                                                            ?>
                                                            <h6><i class="bi bi-people me-2"></i>Formazione Titolare</h6>
                                                            <?php if (!empty($titolari)): ?>
                                                                <?php foreach ($titolari as $pid): ?>
                                                                    <div class="player-row">
                                                                        <div class="player-info">
                                                                            <?php if (isset($giocatori[$pid])): ?>
                                                                                <span class="role-badge <?php echo $giocatori[$pid]['role']; ?>"><?php echo $giocatori[$pid]['role']; ?></span>
                                                                                <span class="player-name"><?php echo htmlspecialchars($giocatori[$pid]['name']); ?></span>
                                                                            <?php else: ?>
                                                                                <span class="role-badge bg-secondary">-</span>
                                                                                <span class="player-name">Giocatore <?php echo $pid; ?></span>
                                                                            <?php endif; ?>
                                                                        </div>
                                                                        <?php if ($bonus_enabled && isset($bonus_giornata[$pid])): ?>
                                                                                <div class="bonus-malus">
                                                                                    <?php
                                                                                    $b = $bonus_giornata[$pid];
                                                                                    if ($bonus_settings['enable_goal']) for ($i = 0; $i < $b['goals']; $i++) echo '<span title="Goal">⚽</span>';
                                                                                    if ($bonus_settings['enable_assist']) for ($i = 0; $i < $b['assists']; $i++) echo '<span title="Assist">🥾</span>';
                                                                                    if ($bonus_settings['enable_yellow_card']) for ($i = 0; $i < $b['yellow_cards']; $i++) echo '<span title="Giallo">🟨</span>';
                                                                                    if ($bonus_settings['enable_red_card']) for ($i = 0; $i < $b['red_cards']; $i++) echo '<span title="Rosso">🟥</span>';
                                                                                    ?>
                                                                                </div>
                                                                            <?php endif; ?>
                                                                        <div class="vote-section">
                                                                            <div class="vote-display">
                                                                                <div class="vote-number">
                                                                                    <?php
                                                                                    if (isset($voti[$pid])) {
                                                                                        $base = $voti[$pid];
                                                                                        $b = isset($bonus_giornata[$pid]) ? $bonus_giornata[$pid] : ['goals'=>0,'assists'=>0,'yellow_cards'=>0,'red_cards'=>0,'goals_conceded'=>0,'own_goals'=>0,'penalty_missed'=>0,'penalty_saved'=>0,'clean_sheet'=>0];
                                                                                        $bonus = 0;
                                                                                        if ($bonus_settings['enable_goal']) $bonus += $b['goals'] * $bonus_settings['bonus_goal'];
                                                                                        if ($bonus_settings['enable_assist']) $bonus += $b['assists'] * $bonus_settings['bonus_assist'];
                                                                                        if ($bonus_settings['enable_yellow_card']) $bonus += $b['yellow_cards'] * $bonus_settings['malus_yellow_card'];
                                                                                        if ($bonus_settings['enable_red_card']) $bonus += $b['red_cards'] * $bonus_settings['malus_red_card'];
                                                                                        if ($bonus_settings['enable_goals_conceded']) $bonus += ($b['goals_conceded'] ?? 0) * $bonus_settings['malus_goals_conceded'];
                                                                                        if ($bonus_settings['enable_own_goal']) $bonus += ($b['own_goals'] ?? 0) * $bonus_settings['malus_own_goal'];
                                                                                        if ($bonus_settings['enable_penalty_missed']) $bonus += ($b['penalty_missed'] ?? 0) * $bonus_settings['malus_penalty_missed'];
                                                                                        if ($bonus_settings['enable_penalty_saved']) $bonus += ($b['penalty_saved'] ?? 0) * $bonus_settings['bonus_penalty_saved'];
                                                                                        if ($bonus_settings['enable_clean_sheet']) $bonus += ($b['clean_sheet'] ?? 0) * $bonus_settings['bonus_clean_sheet'];
                                                                                        $finale = max(0, floatval($base) + $bonus);
                                                                                        // Preserva i decimali 0.25 e 0.75
                                                                                        if ($finale == floor($finale) + 0.25 || $finale == floor($finale) + 0.75) {
                                                                                            echo number_format($finale, 2);
                                                                                        } else {
                                                                                            echo number_format($finale, 1);
                                                                                        }
                                                                                    } else {
                                                                                        echo '-';
                                                                                    }
                                                                                    ?>
                                                                                </div>
                                                                                <div class="vote-label">Voto</div>
                                                                            </div>
                                                                            
                                                                        </div>
                                                                    </div>
                                                                <?php endforeach; ?>
                                                            <?php else: ?>
                                                                <div class="text-muted">
                                                                    <?php if ($league && $league['auto_lineup_mode']): ?>
                                                                        Formazione schierata automaticamente con i migliori per ruolo.
                                                                    <?php else: ?>
                                                                        Nessuna formazione inviata
                                                                    <?php endif; ?>
                                                                </div>
                                                            <?php endif; ?>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        <?php $pos++; endforeach; ?>
                                    </div>
                                <?php endif; ?>
                            <?php else: ?>
                                <div class="no-results">
                                    <i class="bi bi-calendar-event"></i>
                                    <h4>Seleziona una giornata</h4>
                                    <p>Scegli una giornata dal menu sopra per visualizzare i risultati.</p>
                                </div>
                            <?php endif; ?>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script>
function toggleFormation(userId) {
    const formationElement = document.getElementById('formation-' + userId);
    if (formationElement) {
        formationElement.classList.toggle('d-none');
    }
}
</script>
</body>
</html>

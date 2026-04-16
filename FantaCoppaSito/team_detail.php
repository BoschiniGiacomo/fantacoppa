<?php
require_once 'db.php';
require_once 'functions.php';
session_start();

if (!isset($_SESSION['user_id'])) {
    header('Location: index.php');
    exit();
}

$league_id = isset($_GET['league_id']) ? (int)$_GET['league_id'] : 0;
$user_id = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 0;

if (!$league_id || !$user_id) {
    header('Location: dashboard.php');
    exit();
}

// Recupera i dati della squadra
$stmt = $conn->prepare("
    SELECT u.id, u.username, ub.team_name, ub.coach_name, ub.budget 
    FROM users u 
    JOIN user_budget ub ON u.id = ub.user_id 
    WHERE ub.league_id = ? AND u.id = ?
");
$stmt->bind_param("ii", $league_id, $user_id);
$stmt->execute();
$squadra = $stmt->get_result()->fetch_assoc();

if (!$squadra) {
    header('Location: squadre.php?league_id=' . $league_id);
    exit();
}

$league = getLeagueById($league_id);

// Recupera la rosa del giocatore
$stmt = $conn->prepare("
    SELECT p.id, p.first_name, p.last_name, p.role, p.rating, t.name as team_name
    FROM user_players up
    JOIN players p ON up.player_id = p.id
    JOIN teams t ON p.team_id = t.id
    WHERE up.user_id = ? AND up.league_id = ?
    ORDER BY p.role, p.last_name, p.first_name
");
$stmt->bind_param("ii", $user_id, $league_id);
$stmt->execute();
$rosa = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// Recupera i risultati per giornata
$stmt = $conn->prepare("
    SELECT 
        md.giornata,
        md.deadline,
        COALESCE(SUM(pr.rating), 0) as punteggio_giornata
    FROM matchdays md
    LEFT JOIN user_lineups ul ON md.league_id = ul.league_id AND md.giornata = ul.giornata AND ul.user_id = ?
    LEFT JOIN user_players up ON ul.user_id = up.user_id AND ul.league_id = up.league_id
    LEFT JOIN player_ratings pr ON up.player_id = pr.player_id AND pr.giornata = md.giornata AND pr.league_id = md.league_id
    WHERE md.league_id = ?
    GROUP BY md.giornata, md.deadline
    ORDER BY md.giornata
");
$stmt->bind_param("ii", $user_id, $league_id);
$stmt->execute();
$risultati = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

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

?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo htmlspecialchars($squadra['team_name']); ?> - FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
    <style>
        .page-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem 0;
            margin-bottom: 2rem;
        }
        .team-info {
            background: white;
            border-radius: 10px;
            padding: 1.5rem;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 2rem;
        }
        .team-name {
            font-size: 2rem;
            font-weight: bold;
            color: #2c3e50;
            margin-bottom: 0.5rem;
        }
        .coach-name {
            font-size: 1.1rem;
            color: #6c757d;
            margin-bottom: 1rem;
        }
        .credits-section {
            text-align: right;
        }
        .credits-amount {
            font-size: 2rem;
            font-weight: bold;
            color: #28a745;
        }
        .credits-label {
            font-size: 0.9rem;
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
        .player-card {
            border: none;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            transition: transform 0.2s;
        }
        .player-card:hover {
            transform: translateY(-1px);
        }
        .role-badge {
            font-size: 0.8rem;
            padding: 0.25rem 0.5rem;
        }
        .result-card {
            border-left: 4px solid #667eea;
            background: #f8f9fa;
        }
        .punteggio {
            font-size: 1.5rem;
            font-weight: bold;
            color: #667eea;
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
                    <i class="bi bi-shield-check me-2"></i>
                    <?php echo htmlspecialchars($squadra['team_name']); ?>
                </h1>
                <p class="mb-0 mt-2 opacity-75">Dettagli squadra - <?php echo htmlspecialchars($league['name']); ?></p>
            </div>
            <div class="col-auto">
                <a href="squadre.php?league_id=<?php echo $league_id; ?>" class="btn btn-outline-light">
                    <i class="bi bi-arrow-left me-1"></i>
                    Torna alle Squadre
                </a>
            </div>
        </div>
    </div>
</div>

<div class="container py-4">
    <!-- Informazioni Squadra -->
    <div class="team-info">
        <div class="row align-items-center">
            <div class="col">
                <h2 class="team-name"><?php echo htmlspecialchars($squadra['team_name']); ?></h2>
                <p class="coach-name">
                    <i class="bi bi-person-badge me-2"></i>
                    <?php echo htmlspecialchars($squadra['coach_name']); ?>
                </p>
                <small class="text-muted">
                    <i class="bi bi-person me-1"></i>
                    <?php echo htmlspecialchars($squadra['username']); ?>
                </small>
            </div>
            <div class="col-auto credits-section">
                <div class="credits-amount"><?php echo number_format($squadra['budget'], 2, '.', ''); ?></div>
                <div class="credits-label">Crediti Rimanenti</div>
            </div>
        </div>
    </div>

    <!-- Tab Navigation -->
    <ul class="nav nav-tabs mb-4" id="teamTabs" role="tablist">
        <li class="nav-item" role="presentation">
            <button class="nav-link active" id="rosa-tab" data-bs-toggle="tab" data-bs-target="#rosa" type="button" role="tab">
                <i class="bi bi-people me-1"></i>
                Rosa
            </button>
        </li>
        <li class="nav-item" role="presentation">
            <button class="nav-link" id="risultati-tab" data-bs-toggle="tab" data-bs-target="#risultati" type="button" role="tab">
                <i class="bi bi-graph-up me-1"></i>
                Risultati
            </button>
        </li>
    </ul>

    <!-- Tab Content -->
    <div class="tab-content" id="teamTabsContent">
        <!-- Rosa Tab -->
        <div class="tab-pane fade show active" id="rosa" role="tabpanel">
            <?php if (empty($rosa)): ?>
                <div class="text-center py-5">
                    <i class="bi bi-people display-1 text-muted"></i>
                    <h3 class="mt-3 text-muted">Rosa vuota</h3>
                    <p class="text-muted">Questa squadra non ha ancora acquistato giocatori.</p>
                </div>
            <?php else: ?>
                <div class="row g-3">
                    <?php foreach ($rosa as $giocatore): ?>
                        <div class="col-md-6 col-lg-4">
                            <div class="card player-card h-100">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-start mb-2">
                                        <h6 class="card-title mb-0"><?php echo htmlspecialchars($giocatore['first_name'] . ' ' . $giocatore['last_name']); ?></h6>
                                        <span class="badge <?php echo getRoleBadge($giocatore['role']); ?> role-badge">
                                            <?php echo getRoleName($giocatore['role']); ?>
                                        </span>
                                    </div>
                                    <p class="card-text text-muted mb-1">
                                        <small><?php echo htmlspecialchars($giocatore['team_name']); ?></small>
                                    </p>
                                    <p class="card-text">
                                        <strong>Rating:</strong> <?php echo number_format($giocatore['rating'], 1); ?>
                                    </p>
                                </div>
                            </div>
                        </div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>

        <!-- Risultati Tab -->
        <div class="tab-pane fade" id="risultati" role="tabpanel">
            <?php if (empty($risultati)): ?>
                <div class="text-center py-5">
                    <i class="bi bi-graph-up display-1 text-muted"></i>
                    <h3 class="mt-3 text-muted">Nessun risultato</h3>
                    <p class="text-muted">Non ci sono ancora giornate giocate in questa lega.</p>
                </div>
            <?php else: ?>
                <div class="row g-3">
                    <?php foreach ($risultati as $risultato): ?>
                        <div class="col-md-6 col-lg-4">
                            <div class="card result-card h-100">
                                <div class="card-body">
                                    <h6 class="card-title">
                                        <i class="bi bi-calendar-event me-1"></i>
                                        Giornata <?php echo $risultato['giornata']; ?>
                                    </h6>
                                    <p class="card-text text-muted mb-2">
                                        <small>
                                            <i class="bi bi-clock me-1"></i>
                                            <?php echo date('d/m/Y H:i', strtotime($risultato['deadline'])); ?>
                                        </small>
                                    </p>
                                    <div class="punteggio">
                                        <?php echo number_format($risultato['punteggio_giornata'], 1); ?>
                                    </div>
                                    <small class="text-muted">Punti</small>
                                </div>
                            </div>
                        </div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>
    </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>

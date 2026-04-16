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

$user_id = $_SESSION['user_id'];

// Check if user is in the league
$stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
$stmt->bind_param("ii", $league_id, $user_id);
$stmt->execute();
if (!$stmt->get_result()->num_rows) {
    header('Location: dashboard.php');
    exit();
}

// Get league info
$league = getLeagueById($league_id);
if (!$league) {
    header('Location: dashboard.php');
    exit();
}

$error = '';
$success = '';

// Handle form submission
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $team_name = trim($_POST['team_name'] ?? '');
    $coach_name = trim($_POST['coach_name'] ?? '');
    
    if (empty($team_name) || empty($coach_name)) {
        $error = 'Nome squadra e nome allenatore sono obbligatori.';
    } else {
        // Check for duplicates
        $stmt = $conn->prepare("SELECT 1 FROM user_budget WHERE league_id = ? AND (team_name = ? OR coach_name = ?) AND user_id != ?");
        $stmt->bind_param("issi", $league_id, $team_name, $coach_name, $user_id);
        $stmt->execute();
        $res = $stmt->get_result();
        
        if ($res->num_rows > 0) {
            // Check which one is duplicate
            $stmt = $conn->prepare("SELECT team_name, coach_name FROM user_budget WHERE league_id = ? AND user_id != ?");
            $stmt->bind_param("ii", $league_id, $user_id);
            $stmt->execute();
            $existing = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
            
            $team_exists = false;
            $coach_exists = false;
            
            foreach ($existing as $row) {
                if (strtolower($row['team_name']) === strtolower($team_name)) {
                    $team_exists = true;
                }
                if (strtolower($row['coach_name']) === strtolower($coach_name)) {
                    $coach_exists = true;
                }
            }
            
            if ($team_exists && $coach_exists) {
                $error = 'Nome squadra e nome allenatore sono già utilizzati in questa lega.';
            } elseif ($team_exists) {
                $error = 'Nome squadra già utilizzato in questa lega.';
            } else {
                $error = 'Nome allenatore già utilizzato in questa lega.';
            }
        } else {
            // Update team info
            $stmt = $conn->prepare("UPDATE user_budget SET team_name = ?, coach_name = ? WHERE user_id = ? AND league_id = ?");
            $stmt->bind_param("ssii", $team_name, $coach_name, $user_id, $league_id);
            
            if ($stmt->execute()) {
                $success = 'Informazioni squadra salvate con successo!';
                // Redirect to league after a short delay
                header('refresh:2;url=league.php?id=' . $league_id);
            } else {
                $error = 'Errore nel salvataggio delle informazioni.';
            }
        }
    }
}

// Get current team info if exists
$current_team_name = '';
$current_coach_name = '';
$stmt = $conn->prepare("SELECT team_name, coach_name FROM user_budget WHERE user_id = ? AND league_id = ?");
$stmt->bind_param("ii", $user_id, $league_id);
$stmt->execute();
$res = $stmt->get_result();
if ($row = $res->fetch_assoc()) {
    $current_team_name = $row['team_name'] ?? '';
    $current_coach_name = $row['coach_name'] ?? '';
}

?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Seleziona Squadra - FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
    <style>
        .page-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem 0;
            margin-bottom: 2rem;
        }
        .team-selection-card {
            box-shadow: 0 4px 16px rgba(0,0,0,0.1);
            border: none;
            border-radius: 15px;
        }
        .form-control:focus {
            border-color: #667eea;
            box-shadow: 0 0 0 0.2rem rgba(102, 126, 234, 0.25);
        }
        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border: none;
            border-radius: 8px;
            padding: 12px 30px;
            font-weight: 500;
        }
        .btn-primary:hover {
            background: linear-gradient(135deg, #5a6fd8 0%, #6a4190 100%);
            transform: translateY(-1px);
        }
        .alert {
            border-radius: 10px;
            border: none;
        }
        .form-label {
            font-weight: 600;
            color: #2c3e50;
        }
        .info-card {
            background: linear-gradient(135deg, #f8f9ff 0%, #e8f0ff 100%);
            border: 1px solid #e0e7ff;
            border-radius: 10px;
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
                    Seleziona la tua Squadra
                </h1>
                <p class="mb-0 mt-2 opacity-75"><?php echo htmlspecialchars($league['name']); ?></p>
            </div>
        </div>
    </div>
</div>

<div class="container py-4">
    <div class="row justify-content-center">
        <div class="col-md-8 col-lg-6">
            <div class="card team-selection-card">
                <div class="card-header bg-primary text-white text-center">
                    <h4 class="mb-0">
                        <i class="bi bi-person-plus me-2"></i>
                        Configura la tua Squadra
                    </h4>
                </div>
                <div class="card-body p-4">
                    <?php if ($error): ?>
                        <div class="alert alert-danger">
                            <i class="bi bi-exclamation-triangle me-2"></i>
                            <?php echo htmlspecialchars($error); ?>
                        </div>
                    <?php endif; ?>
                    
                    <?php if ($success): ?>
                        <div class="alert alert-success">
                            <i class="bi bi-check-circle me-2"></i>
                            <?php echo htmlspecialchars($success); ?>
                            <br><small>Reindirizzamento in corso...</small>
                        </div>
                    <?php endif; ?>
                    
                    <div class="info-card p-3 mb-4">
                        <h6 class="text-primary mb-2">
                            <i class="bi bi-info-circle me-2"></i>
                            Informazioni Importanti
                        </h6>
                        <ul class="mb-0 small">
                            <li>I nomi squadra e allenatore devono essere unici nella lega</li>
                            <li>Scegli nomi che ti rappresentino!</li>
                        </ul>
                    </div>
                    
                    <form method="POST">
                        <div class="mb-4">
                            <label for="team_name" class="form-label">
                                <i class="bi bi-shield me-1"></i>
                                Nome Squadra
                            </label>
                            <input type="text" 
                                   class="form-control form-control-lg" 
                                   id="team_name" 
                                   name="team_name" 
                                   placeholder="Inserisci il nome della tua squadra"
                                   value="<?php echo htmlspecialchars($current_team_name); ?>"
                                   required>
                            <div class="form-text">Esempio: "Real Madrid", "Juventus", "Milan"</div>
                        </div>
                        
                        <div class="mb-4">
                            <label for="coach_name" class="form-label">
                                <i class="bi bi-person-badge me-1"></i>
                                Nome Allenatore
                            </label>
                            <input type="text" 
                                   class="form-control form-control-lg" 
                                   id="coach_name" 
                                   name="coach_name" 
                                   placeholder="Inserisci il nome dell'allenatore"
                                   value="<?php echo htmlspecialchars($current_coach_name); ?>"
                                   required>
                            <div class="form-text">Esempio: "Carlo Ancelotti", "Pep Guardiola", "Jurgen Klopp"</div>
                        </div>
                        
                        <div class="d-grid gap-2">
                            <button type="submit" class="btn btn-primary btn-lg">
                                <i class="bi bi-check-circle me-2"></i>
                                Salva e Continua
                            </button>
                            <a href="dashboard.php" class="btn btn-outline-secondary">
                                <i class="bi bi-arrow-left me-2"></i>
                                Torna alla Dashboard
                            </a>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>

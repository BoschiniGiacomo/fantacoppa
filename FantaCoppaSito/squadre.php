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
// Recupera le squadre della lega con i loro dati
$stmt = $conn->prepare("
    SELECT u.id, u.username, ub.team_name, ub.coach_name, ub.budget 
    FROM users u 
    JOIN user_budget ub ON u.id = ub.user_id 
    WHERE ub.league_id = ?
    ORDER BY ub.team_name
");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$squadre = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$league = getLeagueById($league_id);

$isAdminLega = false;
if ($league_id) {
    $stmt = $conn->prepare("SELECT creator_id FROM leagues WHERE id = ?");
    $stmt->bind_param("i", $league_id);
    $stmt->execute();
    $res = $stmt->get_result();
    if ($row = $res->fetch_assoc()) {
        $isAdminLega = ($row['creator_id'] == $_SESSION['user_id']);
    }
}

?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Squadre - FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
    <style>
        .team-card {
            transition: transform 0.2s, box-shadow 0.2s;
            cursor: pointer;
            border: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
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
        .credits-section {
            text-align: right;
        }
        .credits-amount {
            font-size: 1.5rem;
            font-weight: bold;
            color: #28a745;
        }
        .credits-label {
            font-size: 0.8rem;
            color: #6c757d;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .page-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem 0;
            margin-bottom: 2rem;
        }
        .team-item {
            transition: opacity 0.3s ease, transform 0.3s ease;
        }
        .team-item[style*="display: none"] {
            opacity: 0;
            transform: scale(0.95);
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
                    Squadre - <?php echo htmlspecialchars($league['name']); ?>
                </h1>
                <p class="mb-0 mt-2 opacity-75">Visualizza tutte le squadre partecipanti alla lega</p>
            </div>
        </div>
    </div>
</div>

<div class="container py-4">
    <?php if (empty($squadre)): ?>
        <div class="text-center py-5">
            <i class="bi bi-people display-1 text-muted"></i>
            <h3 class="mt-3 text-muted">Nessuna squadra trovata</h3>
            <p class="text-muted">Non ci sono ancora squadre iscritte a questa lega.</p>
        </div>
    <?php else: ?>
        <!-- Search Bar -->
        <div class="row mb-4">
            <div class="col-12">
                <div class="card">
                    <div class="card-body">
                        <div class="row align-items-center">
                            <div class="col-md-8">
                                <div class="input-group">
                                    <span class="input-group-text">
                                        <i class="bi bi-search"></i>
                                    </span>
                                    <input type="text" class="form-control" id="teamSearch" 
                                           placeholder="Cerca per nome squadra, allenatore o utente...">
                                    <button class="btn btn-outline-secondary" type="button" id="clearSearch" style="display: none;">
                                        <i class="bi bi-x"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <small class="text-muted" id="searchResults">
                                    <!-- Search results info will be inserted here -->
                                </small>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="row g-4" id="teamsContainer">
            <?php foreach ($squadre as $squadra): ?>
                <div class="col-md-6 col-lg-4 team-item" 
                     data-team-name="<?php echo strtolower(htmlspecialchars($squadra['team_name'])); ?>"
                     data-coach-name="<?php echo strtolower(htmlspecialchars($squadra['coach_name'])); ?>"
                     data-username="<?php echo strtolower(htmlspecialchars($squadra['username'])); ?>">
                    <div class="card team-card h-100" onclick="window.location.href='team_detail.php?league_id=<?php echo $league_id; ?>&user_id=<?php echo $squadra['id']; ?>'">
                        <div class="card-body d-flex flex-column">
                            <div class="d-flex justify-content-between align-items-start mb-3">
                                <div class="flex-grow-1">
                                    <h5 class="team-name mb-1"><?php echo htmlspecialchars($squadra['team_name']); ?></h5>
                                    <p class="coach-name mb-0">
                                        <i class="bi bi-person-badge me-1"></i>
                                        <?php echo htmlspecialchars($squadra['coach_name']); ?>
                                    </p>
                                </div>
                                <div class="credits-section">
                                    <div class="credits-amount"><?php echo number_format($squadra['budget'], 2, '.', ''); ?></div>
                                    <div class="credits-label">Crediti</div>
                                </div>
                            </div>
                            <div class="mt-auto">
                                <small class="text-muted">
                                    <i class="bi bi-person me-1"></i>
                                    <?php echo htmlspecialchars($squadra['username']); ?>
                                </small>
                            </div>
                        </div>
                    </div>
                </div>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function() {
    const teamSearch = document.getElementById('teamSearch');
    const searchResults = document.getElementById('searchResults');
    const clearSearch = document.getElementById('clearSearch');
    const teamItems = document.querySelectorAll('.team-item');
    
    if (teamSearch) {
        // Initialize search results info
        updateSearchResults();
        
        teamSearch.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase().trim();
            
            // Show/hide clear button
            if (searchTerm.length > 0) {
                clearSearch.style.display = 'block';
            } else {
                clearSearch.style.display = 'none';
            }
            
            let visibleCount = 0;
            
            teamItems.forEach(function(item) {
                const teamName = item.getAttribute('data-team-name') || '';
                const coachName = item.getAttribute('data-coach-name') || '';
                const username = item.getAttribute('data-username') || '';
                
                if (searchTerm === '' || 
                    teamName.includes(searchTerm) || 
                    coachName.includes(searchTerm) || 
                    username.includes(searchTerm)) {
                    item.style.display = 'block';
                    visibleCount++;
                } else {
                    item.style.display = 'none';
                }
            });
            
            updateSearchResults(visibleCount, searchTerm);
        });
        
        // Clear search functionality
        if (clearSearch) {
            clearSearch.addEventListener('click', function() {
                teamSearch.value = '';
                clearSearch.style.display = 'none';
                teamSearch.dispatchEvent(new Event('input'));
            });
        }
    }
    
    function updateSearchResults(visibleCount = null, searchTerm = '') {
        if (searchResults) {
            if (visibleCount === null) {
                // Initial state
                searchResults.textContent = `${teamItems.length} squadre totali`;
            } else if (searchTerm === '') {
                // No search term
                searchResults.textContent = `${visibleCount} squadre totali`;
            } else {
                // Search active
                searchResults.textContent = `${visibleCount} squadre trovate per "${searchTerm}"`;
            }
        }
    }
});
</script>
</body>
</html>
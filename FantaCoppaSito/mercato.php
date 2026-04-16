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

// Recupera il budget residuo
$budget = 0;
$budgetRes = $conn->query("SELECT budget FROM user_budget WHERE user_id = $userId AND league_id = $leagueId");
if ($row = $budgetRes->fetch_assoc()) {
    $budget = $row['budget'];
}

// Gestione acquisto giocatore
$message = '';
if (isset($_POST['buy_player'])) {
    // Check if market is blocked
    if ($marketBlockStatus['blocked']) {
        $message = '<div class="alert alert-warning">⚠️ Il mercato è attualmente bloccato dall\'amministratore, non puoi acquistare o svincolare giocatori.</div>';
    } else {
        $playerId = (int)$_POST['player_id'];
        // Recupera valutazione giocatore e ruolo
        $playerRes = $conn->query("SELECT rating, role FROM players WHERE id = $playerId");
        if ($player = $playerRes->fetch_assoc()) {
        $rating = $player['rating'];
        $ruolo = $player['role'];
        // Controlla se già acquistato
        $check = $conn->query("SELECT * FROM user_players WHERE user_id = $userId AND league_id = $leagueId AND player_id = $playerId");
        if ($check->num_rows > 0) {
            $message = '<div class="alert alert-warning">Hai già acquistato questo giocatore.</div>';
        } elseif ($budget < $rating) {
            $message = '<div class="alert alert-danger">Budget insufficiente!</div>';
        } else {
            // Controllo limiti ruolo
            $limiti = [
                'P' => 3, 'D' => 8, 'C' => 8, 'A' => 6
            ];
            $stmt = $conn->prepare("SELECT max_portieri, max_difensori, max_centrocampisti, max_attaccanti FROM leagues WHERE id = ?");
            $stmt->bind_param("i", $leagueId);
            $stmt->execute();
            $stmt->bind_result($maxP, $maxD, $maxC, $maxA);
            if ($stmt->fetch()) {
                $limiti['P'] = $maxP;
                $limiti['D'] = $maxD;
                $limiti['C'] = $maxC;
                $limiti['A'] = $maxA;
            }
            $stmt->close();
            $stmt = $conn->prepare("SELECT COUNT(*) FROM user_players up JOIN players p ON up.player_id = p.id WHERE up.user_id = ? AND up.league_id = ? AND p.role = ?");
            $stmt->bind_param("iis", $userId, $leagueId, $ruolo);
            $stmt->execute();
            $stmt->bind_result($countRuolo);
            $stmt->fetch();
            $stmt->close();
            if ($countRuolo >= $limiti[$ruolo]) {
                $message = '<div class="alert alert-danger">Hai già raggiunto il limite per il ruolo ' . htmlspecialchars($ruolo) . '.<br>Per acquistare questo giocatore devi prima rimuovere un giocatore di quel ruolo dalla tua rosa.</div>';
            } else {
                // Acquisto
                $conn->query("INSERT INTO user_players (user_id, league_id, player_id) VALUES ($userId, $leagueId, $playerId)");
                $conn->query("UPDATE user_budget SET budget = budget - $rating WHERE user_id = $userId AND league_id = $leagueId");
                $budget -= $rating;
                $message = '<div class="alert alert-success">Giocatore acquistato con successo!</div>';
            }
        }
    }
    }
}

// Filtro per ruolo se presente
$ruoloFiltro = isset($_GET['ruolo']) ? $_GET['ruolo'] : '';

$search = isset($_GET['search']) ? trim($_GET['search']) : '';

// Recupera solo i giocatori della lega selezionata
$query = "SELECT p.*, t.name as team_name FROM players p JOIN teams t ON p.team_id = t.id WHERE t.league_id = $leagueId";
if ($ruoloFiltro && in_array($ruoloFiltro, ['P','D','C','A'])) {
    $query .= " AND p.role = '" . $conn->real_escape_string($ruoloFiltro) . "'";
}
if ($search !== '') {
    $searchSql = $conn->real_escape_string($search);
    $query .= " AND (p.first_name LIKE '%$searchSql%' OR p.last_name LIKE '%$searchSql%' OR t.name LIKE '%$searchSql%')";
}
$query .= " ORDER BY p.rating DESC, t.name, p.last_name";
$players = $conn->query($query);

// Recupera solo i giocatori già acquistati dall'utente nella lega selezionata
$userPlayers = [];
$res = $conn->query("SELECT up.player_id FROM user_players up JOIN players p ON up.player_id = p.id JOIN teams t ON p.team_id = t.id WHERE up.user_id = $userId AND t.league_id = $leagueId");
while ($row = $res->fetch_assoc()) {
    $userPlayers[] = $row['player_id'];
}

// Mappa ruoli
$roleMap = [
    'P' => 'Portiere',
    'D' => 'Difensore',
    'C' => 'Centrocampista',
    'A' => 'Attaccante'
];
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mercato - FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
    <link href="assets/css/app-ui.css" rel="stylesheet">
    <style>
        .badge-role-P { background: #0d6efd; }
        .badge-role-D { background: #198754; }
        .badge-role-C { background: #ffc107; color: #212529; }
        .badge-role-A { background: #dc3545; }
        .table-mercato tbody tr:hover { background: #f0f8ff; }
        .card-budget { background: linear-gradient(90deg, #e3f2fd 0%, #f8f9fa 100%); /* border: 1px solid #b6d4fe; */ }
        .icon-role { font-size: 1.2em; vertical-align: middle; margin-right: 2px; }
        .btn-acquista { min-width: 110px; }
        .btn-acquista:disabled { 
            background-color: #6c757d !important; 
            border-color: #6c757d !important; 
            opacity: 0.6; 
        }
        @media (max-width: 767.98px) {
          .table-mercato, .table-mercato th, .table-mercato td {
            font-size: 0.92em !important;
            padding: 0.25em 0.18em !important;
            white-space: nowrap;
          }
          .table-mercato th, .table-mercato td {
            min-width: 40px;
            max-width: 90px;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .table-mercato th {
            font-size: 0.93em !important;
          }
          .btn-acquista, .btn-acquistato {
            min-width: 32px !important;
            width: 32px !important;
            height: 32px !important;
            padding: 0 !important;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.2em !important;
          }
          .btn-acquista span, .btn-acquistato span {
            display: none !important;
          }
        }
        @media (max-width: 575.98px) {
          .table-mercato, .table-mercato th, .table-mercato td {
            font-size: 0.87em !important;
            padding: 0.13em 0.08em !important;
          }
          .table-mercato th, .table-mercato td {
            min-width: 30px;
            max-width: 70px;
          }
          .table-mercato td:first-child, .table-mercato th:first-child {
            padding-left: 0.5em !important;
          }
          .table-mercato th:nth-child(5) {
            max-width: 110px !important;
            min-width: 70px !important;
            white-space: nowrap !important;
          }
        }
    </style>
</head>
<body class="bg-light fc-market-page">
<?php include 'navbar.php'; ?>
<div class="container fc-page-container">
    <div class="fc-market-header">
        <h4 class="mb-0 fw-bold text-dark"><i class="bi bi-bag me-2 text-primary"></i>Mercato</h4>
        <span class="fc-budget-chip"><i class="bi bi-cash-coin"></i> Budget: <?php echo number_format($budget, 2); ?></span>
    </div>
    <div class="row g-3 mercato-filtri-row fc-market-filters">
        <div class="col-auto flex-grow-1">
            <form class="d-flex align-items-center" method="GET" action="mercato.php">
                <input type="hidden" name="league_id" value="<?php echo $leagueId; ?>">
                <select name="ruolo" class="form-select me-2 fc-market-filter-role" onchange="this.form.submit()">
                    <option value="">Tutti i ruoli</option>
                    <option value="P" <?php if ($ruoloFiltro==='P') echo 'selected'; ?>>Portieri</option>
                    <option value="D" <?php if ($ruoloFiltro==='D') echo 'selected'; ?>>Difensori</option>
                    <option value="C" <?php if ($ruoloFiltro==='C') echo 'selected'; ?>>Centrocampisti</option>
                    <option value="A" <?php if ($ruoloFiltro==='A') echo 'selected'; ?>>Attaccanti</option>
                </select>
                <input type="text" id="searchInput" name="search" class="form-control me-2 fc-market-filter-search" placeholder="Cerca per nome, cognome, squadra..." value="<?php echo htmlspecialchars($search); ?>">
            </form>
        </div>
    </div>
    <?php if ($marketBlockStatus['blocked']): ?>
        <div class="alert alert-warning alert-dismissible fade show" role="alert">
            ⚠️ <strong>Il mercato è attualmente bloccato dall'amministratore, non puoi acquistare o svincolare giocatori.</strong>
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    <?php endif; ?>
    
    <?php if ($message): ?>
        <div class="alert <?php echo strpos($message, 'success')!==false ? 'alert-success' : (strpos($message, 'danger')!==false ? 'alert-danger' : 'alert-warning'); ?> alert-dismissible fade show" role="alert">
            <?php echo $message; ?>
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    <?php endif; ?>
    <div class="card fc-market-table-card mb-4">
        <div class="card-header bg-primary text-white d-flex align-items-center">
            <i class="bi bi-person-plus me-2"></i>
            <h5 class="mb-0">Giocatori disponibili</h5>
        </div>
        <div class="card-body p-0">
            <div class="table-responsive">
                <table class="table table-striped table-mercato align-middle mb-0" id="playersTable">
                    <thead class="table-light">
                        <tr>
                            <th onclick="sortTable(0)">Nome <span class="sort-icon"></span></th>
                            <th onclick="sortTable(1)">Cognome <span class="sort-icon"></span></th>
                            <th onclick="sortTable(2)">Squadra <span class="sort-icon"></span></th>
                            <th onclick="sortTable(3)">Ruolo <span class="sort-icon"></span></th>
                            <th onclick="sortTable(4)">Valutazione <span class="sort-icon"></span></th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php if ($players->num_rows === 0): ?>
                            <tr><td colspan="6" class="text-center text-muted">
                                <?php if ($ruoloFiltro || $search): ?>
                                    Nessun giocatore trovato con i filtri selezionati.
                                <?php else: ?>
                                    Non ci sono ancora giocatori disponibili in questa lega. Riprova più tardi.
                                <?php endif; ?>
                            </td></tr>
                        <?php else: ?>
                            <?php while ($player = $players->fetch_assoc()): ?>
                            <tr>
                                <td><?php echo htmlspecialchars($player['first_name']); ?></td>
                                <td><?php echo htmlspecialchars($player['last_name']); ?></td>
                                <td><?php echo htmlspecialchars($player['team_name']); ?></td>
                                <td>
                                    <span class="badge badge-role-<?php echo $player['role']; ?>" title="<?php echo $roleMap[$player['role']]; ?>">
                                        <?php
                                        if ($player['role'] === 'P') echo '<i class="bi bi-shield-lock"></i>';
                                        elseif ($player['role'] === 'D') echo '<i class="bi bi-shield"></i>';
                                        elseif ($player['role'] === 'C') echo '<i class="bi bi-lightning-charge"></i>';
                                        elseif ($player['role'] === 'A') echo '<i class="bi bi-fire"></i>';
                                        ?>
                                        <?php echo $player['role']; ?>
                                    </span>
                                </td>
                                <td><?php echo number_format($player['rating'], 2); ?></td>
                                <td>
                                    <?php if (in_array($player['id'], $userPlayers)): ?>
                                        <button class="btn btn-secondary btn-acquistato" disabled title="Acquistato"><i class="bi bi-cart-check"></i><span>Acquistato</span></button>
                                    <?php else: ?>
                                        <form method="POST" class="d-inline">
                                            <input type="hidden" name="player_id" value="<?php echo $player['id']; ?>">
                                            <input type="hidden" name="league_id" value="<?php echo $leagueId; ?>">
                                            <button type="submit" name="buy_player" class="btn btn-success btn-acquista" title="Acquista" <?php if ($budget < $player['rating'] || $marketBlockStatus['blocked']) echo 'disabled'; ?>>
                                                <i class="bi bi-cart-plus"></i><span>Acquista</span>
                                            </button>
                                        </form>
                                    <?php endif; ?>
                                </td>
                            </tr>
                            <?php endwhile; ?>
                        <?php endif; ?>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</div>
<div class="modal fade" id="ruoloPienoModal" tabindex="-1" aria-labelledby="ruoloPienoModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-header bg-warning text-dark">
        <h5 class="modal-title" id="ruoloPienoModalLabel">
          <i class="bi bi-exclamation-triangle-fill"></i> Limite Ruolo Raggiunto
        </h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Chiudi"></button>
      </div>
      <div class="modal-body" id="ruoloPienoModalBody">
        <!-- Contenuto dinamico -->
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
          <i class="bi bi-x-circle"></i> Chiudi
        </button>
        <a href="rosa.php?league_id=<?php echo $leagueId; ?>" class="btn btn-primary">
          <i class="bi bi-people"></i> Gestisci Rosa
        </a>
      </div>
    </div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script>
// Ricerca live
const searchInput = document.getElementById('searchInput');
const table = document.getElementById('playersTable');
if (searchInput) {
    searchInput.addEventListener('keyup', function() {
        const filter = searchInput.value.toLowerCase();
        const rows = table.getElementsByTagName('tr');
        for (let i = 1; i < rows.length; i++) {
            let show = false;
            const cells = rows[i].getElementsByTagName('td');
            for (let j = 0; j < cells.length - 1; j++) {
                if (cells[j] && cells[j].textContent.toLowerCase().indexOf(filter) > -1) {
                    show = true;
                    break;
                }
            }
            rows[i].style.display = show ? '' : 'none';
        }
    });
}
// Ordinamento tabella
let sortDir = Array(5).fill(true);
function sortTable(n) {
    const tbody = table.tBodies[0];
    const rows = Array.from(tbody.rows);
    const dir = sortDir[n] ? 1 : -1;
    rows.sort((a, b) => {
        let x = a.cells[n].textContent.trim().toLowerCase();
        let y = b.cells[n].textContent.trim().toLowerCase();
        if (!isNaN(parseFloat(x)) && !isNaN(parseFloat(y))) {
            x = parseFloat(x); y = parseFloat(y);
        }
        if (x < y) return -1 * dir;
        if (x > y) return 1 * dir;
        return 0;
    });
    rows.forEach(row => tbody.appendChild(row));
    sortDir[n] = !sortDir[n];
    // Aggiorna icone
    document.querySelectorAll('.sort-icon').forEach((el, idx) => {
        el.textContent = idx === n ? (sortDir[n] ? '▲' : '▼') : '';
    });
}
// PHP: Passa conteggioRuolo e limitiRuolo al JS
const conteggioRuolo = <?php echo json_encode([ // recupero da rosa.php
    'P' => (int)($conn->query("SELECT COUNT(*) as c FROM user_players up JOIN players p ON up.player_id = p.id WHERE up.user_id = $userId AND up.league_id = $leagueId AND p.role = 'P'")->fetch_assoc()['c']),
    'D' => (int)($conn->query("SELECT COUNT(*) as c FROM user_players up JOIN players p ON up.player_id = p.id WHERE up.user_id = $userId AND up.league_id = $leagueId AND p.role = 'D'")->fetch_assoc()['c']),
    'C' => (int)($conn->query("SELECT COUNT(*) as c FROM user_players up JOIN players p ON up.player_id = p.id WHERE up.user_id = $userId AND up.league_id = $leagueId AND p.role = 'C'")->fetch_assoc()['c']),
    'A' => (int)($conn->query("SELECT COUNT(*) as c FROM user_players up JOIN players p ON up.player_id = p.id WHERE up.user_id = $userId AND up.league_id = $leagueId AND p.role = 'A'")->fetch_assoc()['c']),
]); ?>;
const limitiRuolo = <?php 
$stmt = $conn->prepare("SELECT max_portieri, max_difensori, max_centrocampisti, max_attaccanti FROM leagues WHERE id = ?");
$stmt->bind_param("i", $leagueId);
$stmt->execute();
$stmt->bind_result($maxP, $maxD, $maxC, $maxA);
$stmt->fetch();
$stmt->close();
echo json_encode([
    'P' => (int)$maxP,
    'D' => (int)$maxD,
    'C' => (int)$maxC,
    'A' => (int)$maxA,
]); ?>;
// Mappa ruoli JS per nome completo
const roleMap = { 'P': 'Portiere', 'D': 'Difensore', 'C': 'Centrocampista', 'A': 'Attaccante' };
setTimeout(() => {
  document.querySelectorAll('form.d-inline').forEach(form => {
    form.addEventListener('submit', function(e) {
      const playerRow = form.closest('tr');
      if (!playerRow) return;
      const ruoloCell = playerRow.querySelector('td:nth-child(4) .badge');
      if (!ruoloCell) return;
      const ruolo = ruoloCell.textContent.trim().charAt(0);
      if (conteggioRuolo[ruolo] >= limitiRuolo[ruolo]) {
        e.preventDefault();
        // Mostra modal Bootstrap
        const modalBody = document.getElementById('ruoloPienoModalBody');
        modalBody.innerHTML = 'Hai già raggiunto il limite per il ruolo <b>' + roleMap[ruolo] + '</b>.<br>Per acquistare questo giocatore devi prima rimuovere un giocatore di quel ruolo dalla tua rosa.';
        const modal = new bootstrap.Modal(document.getElementById('ruoloPienoModal'));
        modal.show();
        return false;
      }
    });
  });
}, 100);
</script>
</body>
</html> 

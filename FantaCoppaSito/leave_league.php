<?php
require_once 'functions.php';
startSession();
header('Content-Type: application/json');
if (!isLoggedIn()) {
    echo json_encode(['success' => false, 'error' => 'Non autenticato.']);
    exit;
}
$userId = getCurrentUserId();
$conn = getDbConnection();
if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($_GET['action'] ?? '') === 'info') {
    $leagueId = (int)($_GET['league_id'] ?? 0);
    // Quanti membri?
    $stmt = $conn->prepare("SELECT user_id, username, role FROM league_members JOIN users ON user_id = users.id WHERE league_id = ?");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $res = $stmt->get_result();
    $members = [];
    $adminCount = 0;
    $otherMembers = [];
    while ($row = $res->fetch_assoc()) {
        $members[] = $row;
        if ($row['role'] === 'admin' && $row['user_id'] != $userId) {
            $adminCount++;
        }
        if ($row['user_id'] != $userId) {
            $otherMembers[] = $row;
        }
    }
    $isAdmin = false;
    foreach ($members as $m) {
        if ($m['user_id'] == $userId && $m['role'] === 'admin') $isAdmin = true;
    }
    $onlyUser = count($members) === 1;
    $onlyAdmin = $isAdmin && !$adminCount && count($members) > 1;
    echo json_encode([
        'only_user' => $onlyUser,
        'only_admin' => $onlyAdmin,
        'other_members' => $otherMembers
    ]);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $leagueId = (int)($data['league_id'] ?? 0);
    $newAdminId = isset($data['new_admin_id']) ? (int)$data['new_admin_id'] : null;
    // Quanti membri e admin?
    $stmt = $conn->prepare("SELECT user_id, role FROM league_members WHERE league_id = ?");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $res = $stmt->get_result();
    $members = [];
    $adminCount = 0;
    $isAdmin = false;
    while ($row = $res->fetch_assoc()) {
        $members[] = $row;
        if ($row['role'] === 'admin' && $row['user_id'] != $userId) {
            $adminCount++;
        }
        if ($row['user_id'] == $userId && $row['role'] === 'admin') $isAdmin = true;
    }
    $onlyUser = count($members) === 1;
    $onlyAdmin = $isAdmin && !$adminCount && count($members) > 1;
    if ($onlyAdmin && !$newAdminId) {
        echo json_encode(['success' => false, 'error' => 'Devi nominare un nuovo admin prima di uscire.']);
        exit;
    }
    if ($onlyAdmin && $newAdminId) {
        // Promuovi nuovo admin
        $stmt = $conn->prepare("UPDATE league_members SET role = 'admin' WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $newAdminId);
        $stmt->execute();
    }
    if ($onlyUser) {
        // Elimina tutti i dati della lega
        $conn->query("DELETE FROM user_budget WHERE league_id = $leagueId");
        $conn->query("DELETE FROM user_players WHERE league_id = $leagueId");
        $conn->query("DELETE FROM user_lineups WHERE league_id = $leagueId");
        $conn->query("DELETE FROM league_join_requests WHERE league_id = $leagueId");
        $conn->query("DELETE FROM user_league_prefs WHERE league_id = $leagueId");
        $conn->query("DELETE FROM user_market_blocks WHERE league_id = $leagueId");
        $conn->query("DELETE FROM league_members WHERE league_id = $leagueId");
        $conn->query("DELETE FROM teams WHERE league_id = $leagueId");
        $conn->query("DELETE FROM leagues WHERE id = $leagueId");
        echo json_encode(['success' => true]);
        exit;
    }
    // Elimina tutti i dati dell'utente nella lega
    $conn->query("DELETE FROM user_budget WHERE user_id = $userId AND league_id = $leagueId");
    $conn->query("DELETE FROM user_players WHERE user_id = $userId AND league_id = $leagueId");
    $conn->query("DELETE FROM user_lineups WHERE user_id = $userId AND league_id = $leagueId");
    $conn->query("DELETE FROM league_members WHERE user_id = $userId AND league_id = $leagueId");
    $conn->query("DELETE FROM league_join_requests WHERE user_id = $userId AND league_id = $leagueId");
    $conn->query("DELETE FROM user_league_prefs WHERE user_id = $userId AND league_id = $leagueId");
    $conn->query("DELETE FROM user_market_blocks WHERE user_id = $userId AND league_id = $leagueId");
    echo json_encode(['success' => true]);
    exit;
}
echo json_encode(['success' => false, 'error' => 'Richiesta non valida.']); 
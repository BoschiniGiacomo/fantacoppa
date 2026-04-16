<?php
require_once 'functions.php';
header('Content-Type: application/json');
startSession();

if (!isLoggedIn()) {
    echo json_encode(['success' => false, 'error' => 'Non autenticato']);
    exit;
}

$leagueId = isset($_POST['league_id']) ? (int)$_POST['league_id'] : 0;
$userId = isset($_POST['user_id']) ? (int)$_POST['user_id'] : 0;
$blocked = isset($_POST['blocked']) ? (int)$_POST['blocked'] : 0;

if (!$leagueId || !$userId) {
    echo json_encode(['success' => false, 'error' => 'Parametri mancanti']);
    exit;
}

// Check if user is admin
$stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
$stmt->bind_param("ii", $leagueId, getCurrentUserId());
$stmt->execute();
$result = $stmt->get_result()->fetch_assoc();

if (!$result || $result['role'] !== 'admin') {
    echo json_encode(['success' => false, 'error' => 'Non autorizzato']);
    exit;
}

try {
    // Check if the target user is in the league
    $stmt = $conn->prepare("SELECT id FROM league_members WHERE league_id = ? AND user_id = ?");
    $stmt->bind_param("ii", $leagueId, $userId);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        echo json_encode(['success' => false, 'error' => 'Utente non trovato nella lega']);
        exit;
    }
    
    // Insert or update the market block status
    $stmt = $conn->prepare("
        INSERT INTO user_market_blocks (user_id, league_id, blocked) 
        VALUES (?, ?, ?) 
        ON DUPLICATE KEY UPDATE blocked = VALUES(blocked), blocked_at = CURRENT_TIMESTAMP
    ");
    $stmt->bind_param("iii", $userId, $leagueId, $blocked);
    
    if ($stmt->execute()) {
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Errore nell\'aggiornamento']);
    }
} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => 'Errore del server']);
}
?>
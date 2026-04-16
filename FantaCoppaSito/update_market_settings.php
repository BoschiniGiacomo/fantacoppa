<?php
require_once 'functions.php';
header('Content-Type: application/json');
startSession();

if (!isLoggedIn()) {
    echo json_encode(['success' => false, 'error' => 'Non autenticato']);
    exit;
}

$leagueId = isset($_POST['league_id']) ? (int)$_POST['league_id'] : 0;
$setting = $_POST['setting'] ?? '';
$value = isset($_POST['value']) ? (int)$_POST['value'] : 0;

if (!$leagueId || !$setting) {
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
    // Get current settings
    $currentSettings = getLeagueMarketSettings($leagueId);
    
    // Update the specific setting
    if ($setting === 'market_locked') {
        $result = updateLeagueMarketSettings($leagueId, $value, $currentSettings['require_approval']);
    } elseif ($setting === 'require_approval') {
        $result = updateLeagueMarketSettings($leagueId, $currentSettings['market_locked'], $value);
    } else {
        echo json_encode(['success' => false, 'error' => 'Impostazione non valida']);
        exit;
    }
    
    if ($result) {
        // Se è cambiato market_locked, resetta tutte le eccezioni individuali
        if ($setting === 'market_locked') {
            $resetStmt = $conn->prepare("DELETE FROM user_market_blocks WHERE league_id = ?");
            $resetStmt->bind_param("i", $leagueId);
            $resetStmt->execute();
            $resetStmt->close();
        }
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Errore nell\'aggiornamento']);
    }
} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => 'Errore del server']);
}
?>

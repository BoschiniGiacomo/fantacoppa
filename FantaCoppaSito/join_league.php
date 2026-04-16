<?php
require_once 'functions.php';
header('Content-Type: application/json');
startSession();
if (!isLoggedIn()) {
    echo json_encode(['success' => false, 'error' => 'Non autenticato.']);
    exit;
}
$data = json_decode(file_get_contents('php://input'), true);
$leagueId = isset($data['league_id']) ? (int)$data['league_id'] : 0;
$accessCode = isset($data['access_code']) ? $data['access_code'] : '';
if (!$leagueId) {
    echo json_encode(['success' => false, 'error' => 'ID lega mancante.']);
    exit;
}

// Check if league requires approval
$marketSettings = getLeagueMarketSettings($leagueId);
$requireApproval = $marketSettings['require_approval'] ?? 0;

if ($requireApproval) {
    // Create join request instead of joining directly
    $conn = getDbConnection();
    $stmt = $conn->prepare("INSERT INTO league_join_requests (league_id, user_id, team_name, coach_name, access_code) VALUES (?, ?, '', '', ?)");
    $stmt->bind_param("iis", $leagueId, getCurrentUserId(), $accessCode);
    
    if ($stmt->execute()) {
         // Recupero nome lega per mostrarlo nell’alert
         $stmt2 = $conn->prepare("SELECT name FROM leagues WHERE id = ?");
         $stmt2->bind_param("i", $leagueId);
         $stmt2->execute();
         $stmt2->bind_result($leagueName);
         $stmt2->fetch();
         $stmt2->close();
         echo json_encode([
            'success' => true,
            'requires_approval' => true,
            'league_name' => $leagueName,
            'requested_at' => date('d/m/Y H:i'),
            'message' => 'Richiesta di iscrizione inviata. In attesa di approvazione.'
        ]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Errore nell\'invio della richiesta.']);
    }
} else {
    // Direct join
    $result = joinLeague($leagueId, $accessCode, 'id');
    if ($result === true) {
        echo json_encode(['success' => true, 'redirect' => 'select_team.php?league_id=' . $leagueId]);
    } elseif ($result === 'already_joined') {
        echo json_encode(['success' => false, 'error' => 'Sei già iscritto a questa lega.']);
    } elseif ($result === 'not_found') {
        echo json_encode(['success' => false, 'error' => 'Lega non trovata.']);
    } else {
        echo json_encode(['success' => false, 'error' => 'Codice di accesso non valido.']);
    }
} 
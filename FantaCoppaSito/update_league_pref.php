<?php
require_once 'functions.php';
startSession();
header('Content-Type: application/json');
if (!isLoggedIn()) {
    echo json_encode(['success' => false, 'error' => 'Non autenticato.']);
    exit;
}
$userId = getCurrentUserId();
$data = json_decode(file_get_contents('php://input'), true);
$leagueId = isset($data['league_id']) ? (int)$data['league_id'] : 0;
$favorite = isset($data['favorite']) ? (int)$data['favorite'] : 0;
$archived = isset($data['archived']) ? (int)$data['archived'] : 0;
if (!$leagueId) {
    echo json_encode(['success' => false, 'error' => 'ID lega mancante.']);
    exit;
}
setUserLeaguePref($userId, $leagueId, $favorite, $archived);
echo json_encode(['success' => true]); 
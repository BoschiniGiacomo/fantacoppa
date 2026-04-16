<?php
require_once 'functions.php';
header('Content-Type: application/json');
startSession();

if (!isLoggedIn()) {
    echo json_encode(['error' => 'Non autenticato']);
    exit;
}

$leagueId = isset($_GET['league_id']) ? (int)$_GET['league_id'] : 0;
$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 5;

if (!$leagueId) {
    echo json_encode(['error' => 'ID lega mancante']);
    exit;
}

try {
    $standings = getLeagueStandings($leagueId, $limit);
    echo json_encode($standings);
} catch (Exception $e) {
    echo json_encode(['error' => 'Errore nel recupero dei dati']);
}
?>

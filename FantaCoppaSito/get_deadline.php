<?php
require_once 'db.php';
session_start();

if (!isset($_SESSION['user_id']) || !isset($_GET['league_id']) || !isset($_GET['giornata'])) {
    http_response_code(400);
    exit(json_encode(['error' => 'Parametri mancanti']));
}

$league_id = (int)$_GET['league_id'];
$giornata = (int)$_GET['giornata'];

// Verifica che l'utente sia l'amministratore della lega
$stmt = $conn->prepare("SELECT creator_id FROM leagues WHERE id = ?");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$league = $stmt->get_result()->fetch_assoc();

if (!$league || $league['creator_id'] != $_SESSION['user_id']) {
    http_response_code(403);
    exit(json_encode(['error' => 'Non autorizzato']));
}

// Recupera la scadenza
$stmt = $conn->prepare("SELECT deadline FROM matchdays WHERE league_id = ? AND giornata = ?");
$stmt->bind_param("ii", $league_id, $giornata);
$stmt->execute();
$result = $stmt->get_result()->fetch_assoc();

if ($result) {
    echo json_encode(['deadline' => $result['deadline']]);
} else {
    echo json_encode(['deadline' => null]);
} 
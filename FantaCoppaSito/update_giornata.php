<?php
require_once 'db.php';
session_start();

if (!isset($_SESSION['user_id']) || !isset($_POST['league_id']) || !isset($_POST['old_giornata']) || !isset($_POST['new_giornata'])) {
    http_response_code(400);
    exit('Parametri mancanti');
}

$league_id = (int)$_POST['league_id'];
$old_giornata = (int)$_POST['old_giornata'];
$new_giornata = (int)$_POST['new_giornata'];

// Verifica che l'utente sia l'amministratore della lega
$stmt = $conn->prepare("SELECT creator_id FROM leagues WHERE id = ?");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$league = $stmt->get_result()->fetch_assoc();

if (!$league || $league['creator_id'] != $_SESSION['user_id']) {
    http_response_code(403);
    exit('Non autorizzato');
}

// Aggiorna il numero della giornata
$stmt = $conn->prepare("UPDATE matchdays SET giornata = ? WHERE league_id = ? AND giornata = ?");
$stmt->bind_param("iii", $new_giornata, $league_id, $old_giornata);
$stmt->execute();

// Aggiorna anche le formazioni degli utenti
$stmt = $conn->prepare("UPDATE user_lineups SET giornata = ? WHERE league_id = ? AND giornata = ?");
$stmt->bind_param("iii", $new_giornata, $league_id, $old_giornata);
$stmt->execute();

echo json_encode(['success' => true]); 
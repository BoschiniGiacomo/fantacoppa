<?php
require_once 'db.php';

$league_id = isset($_GET['league_id']) ? (int)$_GET['league_id'] : 0;
if ($league_id <= 0) {
    http_response_code(400);
    echo 'league_id mancante o non valido';
    exit();
}

header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="squadre_lega_' . $league_id . '.csv"');

$output = fopen('php://output', 'w');

// Usa il punto e virgola per coerenza con i template
$delimiter = ';';

// Header
fputcsv($output, ['Squadra'], $delimiter);

$stmt = $conn->prepare("SELECT name FROM teams WHERE league_id = ? ORDER BY name");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
    fputcsv($output, [$row['name']], $delimiter);
}

fclose($output);
exit();
?>



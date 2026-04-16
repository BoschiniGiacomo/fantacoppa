<?php
require_once 'db.php';

$league_id = isset($_GET['league_id']) ? (int)$_GET['league_id'] : 0;
if ($league_id <= 0) {
    http_response_code(400);
    echo 'league_id mancante o non valido';
    exit();
}

header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="giocatori_lega_' . $league_id . '.csv"');

$output = fopen('php://output', 'w');
$delimiter = ';';

// Header coerente con il template
fputcsv($output, ['Nome', 'Cognome', 'Squadra', 'Ruolo', 'Valutazione'], $delimiter);

$stmt = $conn->prepare("SELECT p.first_name, p.last_name, t.name AS team_name, p.role, p.rating
                        FROM players p
                        JOIN teams t ON p.team_id = t.id
                        WHERE t.league_id = ?
                        ORDER BY t.name, p.last_name, p.first_name");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
    fputcsv($output, [
        $row['first_name'],
        $row['last_name'],
        $row['team_name'],
        $row['role'],
        number_format((float)$row['rating'], 1, '.', '')
    ], $delimiter);
}

fclose($output);
exit();
?>



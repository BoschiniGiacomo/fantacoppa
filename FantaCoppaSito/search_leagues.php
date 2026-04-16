<?php
require_once 'functions.php';
header('Content-Type: application/json');
startSession();
$q = isset($_GET['q']) ? trim($_GET['q']) : '';
$details = isset($_GET['details']) && $_GET['details'] == '1';
$userLeagues = [];
if (isLoggedIn()) {
    $userLeagues = array_map(function($l) { return $l['id']; }, getUserLeagues());
}
if ($q === '' || strlen($q) < 1) {
    echo json_encode([]);
    exit;
}
$leagues = searchLeaguesByName($q);
if (ctype_digit($q)) {
    $conn = getDbConnection();
    $stmt = $conn->prepare($details ? "SELECT id, name, access_code FROM leagues WHERE id = ?" : "SELECT id, name FROM leagues WHERE id = ?");
    $stmt->bind_param("i", $q);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($row = $res->fetch_assoc()) {
        // Evita doppioni
        $found = false;
        foreach ($leagues as $l) {
            if ($l['id'] == $row['id']) { $found = true; break; }
        }
        if (!$found) $leagues[] = $row;
    }
}
// Filtra leghe già iscritto
if ($userLeagues) {
    $leagues = array_filter($leagues, function($l) use ($userLeagues) {
        return !in_array($l['id'], $userLeagues);
    });
    $leagues = array_values($leagues);
}
if ($details) {
    $conn = getDbConnection();
    foreach ($leagues as &$l) {
        $stmt = $conn->prepare("SELECT access_code FROM leagues WHERE id = ?");
        $stmt->bind_param("i", $l['id']);
        $stmt->execute();
        $res = $stmt->get_result();
        if ($row = $res->fetch_assoc()) {
            $l['access_code'] = !empty($row['access_code']);
        } else {
            $l['access_code'] = false;
        }
    }
}
echo json_encode($leagues); 
<?php
require_once 'db.php';
require_once 'functions.php';
session_start();

// Check if user is logged in
if (!isset($_SESSION['user_id'])) {
    header('Location: index.php');
    exit();
}

// Check if user is superuser
$stmt = $conn->prepare("SELECT is_superuser FROM users WHERE id = ?");
$stmt->bind_param("i", $_SESSION['user_id']);
$stmt->execute();
$result = $stmt->get_result()->fetch_assoc();

if (!$result || !$result['is_superuser']) {
    header('Location: dashboard.php');
    exit();
}

// Update last activity
$stmt = $conn->prepare("UPDATE users SET last_activity = NOW() WHERE id = ?");
$stmt->bind_param("i", $_SESSION['user_id']);
$stmt->execute();

// Log page view
logPageView($_SESSION['user_id'], 'superuser');

// Handle AJAX requests
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    header('Content-Type: application/json');
    
    switch ($_POST['action']) {
        case 'reset_password':
            $target_user_id = (int)$_POST['user_id'];
            $new_password = !empty($_POST['new_password']) ? $_POST['new_password'] : generateRandomPassword();
            
            // Hash the new password
            $hashed_password = password_hash($new_password, PASSWORD_DEFAULT);
            
            // Update password in database
            $stmt = $conn->prepare("UPDATE users SET password = ? WHERE id = ?");
            $stmt->bind_param("si", $hashed_password, $target_user_id);
            
            if ($stmt->execute()) {
                // Log the action
                logSuperuserAction($_SESSION['user_id'], 'reset_password', $target_user_id, "Password reset for user ID: $target_user_id");
                
                echo json_encode(['success' => true, 'new_password' => $new_password]);
            } else {
                echo json_encode(['success' => false, 'error' => 'Failed to update password: ' . $conn->error]);
            }
            exit();
            
        case 'get_user_stats':
            $period = $_POST['period'] ?? 'day';
            $stats = getUserAccessStats($period);
            echo json_encode($stats);
            exit();
            
        case 'get_page_stats':
            $period = $_POST['period'] ?? 'day';
            $stats = getPageViewStats($period);
            echo json_encode($stats);
            exit();
            
        case 'get_detailed_stats':
            $period = $_POST['period'] ?? 'day';
            $stats = getDetailedStats($period);
            echo json_encode($stats);
            exit();
            
        case 'get_trend_data':
            $period = $_POST['period'] ?? 'week';
            $trendData = getTrendData($period);
            echo json_encode($trendData);
            exit();
            
        case 'get_user_status':
            $users = [];
            $stmt = $conn->prepare("SELECT id, username, last_activity FROM users ORDER BY created_at DESC");
            $stmt->execute();
            $result = $stmt->get_result();
            while ($row = $result->fetch_assoc()) {
                $users[] = [
                    'id' => $row['id'],
                    'username' => $row['username'],
                    'is_online' => isUserOnline($row['last_activity']),
                    'last_activity' => $row['last_activity']
                ];
            }
            echo json_encode($users);
            exit();
            
        case 'get_official_groups':
            $groups = [];
            $stmt = $conn->prepare("
                SELECT og.id, og.name, og.description, og.created_at,
                       COUNT(DISTINCT l.id) as league_count
                FROM official_league_groups og
                LEFT JOIN leagues l ON l.official_group_id = og.id
                GROUP BY og.id, og.name, og.description, og.created_at
                ORDER BY og.created_at DESC
            ");
            $stmt->execute();
            $result = $stmt->get_result();
            while ($row = $result->fetch_assoc()) {
                $groups[] = [
                    'id' => (int)$row['id'],
                    'name' => $row['name'],
                    'description' => $row['description'],
                    'created_at' => $row['created_at'],
                    'league_count' => (int)$row['league_count']
                ];
            }
            echo json_encode($groups);
            exit();
            
        case 'create_official_group':
            $name = $_POST['name'] ?? '';
            $description = $_POST['description'] ?? '';
            
            if (empty($name)) {
                echo json_encode(['success' => false, 'error' => 'Il nome è obbligatorio']);
                exit();
            }
            
            $stmt = $conn->prepare("SELECT id FROM official_league_groups WHERE name = ?");
            $stmt->bind_param("s", $name);
            $stmt->execute();
            if ($stmt->get_result()->num_rows > 0) {
                echo json_encode(['success' => false, 'error' => 'Un gruppo con questo nome esiste già']);
                exit();
            }
            
            $stmt = $conn->prepare("INSERT INTO official_league_groups (name, description, created_by) VALUES (?, ?, ?)");
            $stmt->bind_param("ssi", $name, $description, $_SESSION['user_id']);
            if ($stmt->execute()) {
                logSuperuserAction($_SESSION['user_id'], 'create_official_group', $conn->insert_id, "Gruppo ufficiale creato: $name");
                echo json_encode(['success' => true, 'message' => 'Gruppo creato con successo']);
            } else {
                echo json_encode(['success' => false, 'error' => 'Errore durante la creazione']);
            }
            exit();
            
        case 'delete_official_group':
            $groupId = (int)($_POST['group_id'] ?? 0);
            
            if (!$groupId) {
                echo json_encode(['success' => false, 'error' => 'ID gruppo non valido']);
                exit();
            }
            
            // Rimuovi le leghe dal gruppo
            $stmt = $conn->prepare("UPDATE leagues SET is_official = 0, official_group_id = NULL WHERE official_group_id = ?");
            $stmt->bind_param("i", $groupId);
            $stmt->execute();
            
            // Elimina il gruppo
            $stmt = $conn->prepare("DELETE FROM official_league_groups WHERE id = ?");
            $stmt->bind_param("i", $groupId);
            if ($stmt->execute()) {
                logSuperuserAction($_SESSION['user_id'], 'delete_official_group', $groupId, "Gruppo ufficiale eliminato");
                echo json_encode(['success' => true, 'message' => 'Gruppo eliminato con successo']);
            } else {
                echo json_encode(['success' => false, 'error' => 'Errore durante l\'eliminazione']);
            }
            exit();
            
        case 'get_group_leagues':
            $groupId = (int)($_POST['group_id'] ?? 0);
            
            $stmt = $conn->prepare("
                SELECT l.id, l.name, l.access_code, l.created_at,
                       COUNT(DISTINCT lm.user_id) as member_count
                FROM leagues l
                LEFT JOIN league_members lm ON l.id = lm.league_id
                WHERE l.official_group_id = ? AND l.is_official = 1
                GROUP BY l.id, l.name, l.access_code, l.created_at
                ORDER BY l.created_at DESC
            ");
            $stmt->bind_param("i", $groupId);
            $stmt->execute();
            $result = $stmt->get_result();
            $leagues = [];
            while ($row = $result->fetch_assoc()) {
                $leagues[] = [
                    'id' => (int)$row['id'],
                    'name' => $row['name'],
                    'access_code' => $row['access_code'],
                    'created_at' => $row['created_at'],
                    'member_count' => (int)$row['member_count']
                ];
            }
            echo json_encode($leagues);
            exit();
            
        case 'get_cluster_suggestions':
            $groupId = (int)($_POST['group_id'] ?? 0);
            
            // Ottieni tutte le leghe del gruppo
            $stmt = $conn->prepare("SELECT id FROM leagues WHERE official_group_id = ? AND is_official = 1");
            $stmt->bind_param("i", $groupId);
            $stmt->execute();
            $result = $stmt->get_result();
            $leagueIds = [];
            while ($row = $result->fetch_assoc()) {
                $leagueIds[] = (int)$row['id'];
            }
            
            if (count($leagueIds) < 2) {
                echo json_encode(['suggestions' => []]);
                exit();
            }
            
            // Trova giocatori con stesso nome in leghe diverse
            $placeholders = str_repeat('?,', count($leagueIds) - 1) . '?';
            $stmt = $conn->prepare("
                SELECT p1.id as player_id_1, p1.first_name, p1.last_name, t1.league_id as league_id_1, l1.name as league_name_1,
                       p2.id as player_id_2, t2.league_id as league_id_2, l2.name as league_name_2
                FROM players p1
                JOIN teams t1 ON p1.team_id = t1.id
                JOIN leagues l1 ON t1.league_id = l1.id
                JOIN players p2 ON p1.first_name = p2.first_name AND p1.last_name = p2.last_name AND p1.id < p2.id
                JOIN teams t2 ON p2.team_id = t2.id
                JOIN leagues l2 ON t2.league_id = l2.id
                WHERE t1.league_id IN ($placeholders) AND t2.league_id IN ($placeholders)
                AND t1.league_id != t2.league_id
                AND NOT EXISTS (
                    SELECT 1 FROM player_cluster_members pcm1
                    JOIN player_clusters pc ON pcm1.cluster_id = pc.id
                    WHERE (pcm1.player_id = p1.id OR pcm1.player_id = p2.id) AND pc.official_group_id = ?
                )
                GROUP BY p1.id, p2.id
                ORDER BY p1.last_name, p1.first_name
            ");
            $params = array_merge($leagueIds, $leagueIds, [$groupId]);
            $types = str_repeat('i', count($leagueIds) * 2) . 'i';
            $stmt->bind_param($types, ...$params);
            $stmt->execute();
            $result = $stmt->get_result();
            
            $suggestions = [];
            while ($row = $result->fetch_assoc()) {
                $suggestions[] = [
                    'player_1' => [
                        'id' => (int)$row['player_id_1'],
                        'name' => $row['first_name'] . ' ' . $row['last_name'],
                        'league_id' => (int)$row['league_id_1'],
                        'league_name' => $row['league_name_1']
                    ],
                    'player_2' => [
                        'id' => (int)$row['player_id_2'],
                        'name' => $row['first_name'] . ' ' . $row['last_name'],
                        'league_id' => (int)$row['league_id_2'],
                        'league_name' => $row['league_name_2']
                    ]
                ];
            }
            echo json_encode(['suggestions' => $suggestions]);
            exit();
            
        case 'create_cluster':
            $groupId = (int)($_POST['group_id'] ?? 0);
            $playerIds = json_decode($_POST['player_ids'] ?? '[]', true);
            
            if (!$groupId || count($playerIds) < 2) {
                echo json_encode(['success' => false, 'error' => 'Dati non validi']);
                exit();
            }
            
            // Verifica che tutti i giocatori appartengano a leghe del gruppo
            $placeholders = str_repeat('?,', count($playerIds) - 1) . '?';
            $stmt = $conn->prepare("
                SELECT p.id
                FROM players p
                JOIN teams t ON p.team_id = t.id
                JOIN leagues l ON t.league_id = l.id
                WHERE p.id IN ($placeholders) AND l.official_group_id = ? AND l.is_official = 1
            ");
            $params = array_merge($playerIds, [$groupId]);
            $types = str_repeat('i', count($playerIds)) . 'i';
            $stmt->bind_param($types, ...$params);
            $stmt->execute();
            $result = $stmt->get_result();
            $validPlayers = [];
            while ($row = $result->fetch_assoc()) {
                $validPlayers[] = (int)$row['id'];
            }
            
            if (count($validPlayers) !== count($playerIds)) {
                echo json_encode(['success' => false, 'error' => 'Alcuni giocatori non appartengono a leghe del gruppo']);
                exit();
            }
            
            // Crea cluster
            $stmt = $conn->prepare("INSERT INTO player_clusters (official_group_id, status, suggested_by_system, created_by) VALUES (?, 'pending', 0, ?)");
            $stmt->bind_param("ii", $groupId, $_SESSION['user_id']);
            $stmt->execute();
            $clusterId = $conn->insert_id;
            
            // Aggiungi giocatori al cluster
            $stmt = $conn->prepare("INSERT INTO player_cluster_members (cluster_id, player_id, added_by) VALUES (?, ?, ?)");
            foreach ($playerIds as $playerId) {
                $stmt->bind_param("iii", $clusterId, $playerId, $_SESSION['user_id']);
                $stmt->execute();
            }
            
            logSuperuserAction($_SESSION['user_id'], 'create_cluster', $clusterId, "Cluster creato per gruppo $groupId");
            echo json_encode(['success' => true, 'message' => 'Cluster creato con successo']);
            exit();
            
        case 'approve_cluster':
            $clusterId = (int)($_POST['cluster_id'] ?? 0);
            
            $stmt = $conn->prepare("UPDATE player_clusters SET status = 'approved' WHERE id = ?");
            $stmt->bind_param("i", $clusterId);
            if ($stmt->execute()) {
                logSuperuserAction($_SESSION['user_id'], 'approve_cluster', $clusterId, "Cluster approvato");
                echo json_encode(['success' => true, 'message' => 'Cluster approvato']);
            } else {
                echo json_encode(['success' => false, 'error' => 'Errore durante l\'approvazione']);
            }
            exit();
            
        case 'reject_cluster':
            $clusterId = (int)($_POST['cluster_id'] ?? 0);
            
            $stmt = $conn->prepare("UPDATE player_clusters SET status = 'rejected' WHERE id = ?");
            $stmt->bind_param("i", $clusterId);
            if ($stmt->execute()) {
                logSuperuserAction($_SESSION['user_id'], 'reject_cluster', $clusterId, "Cluster rifiutato");
                echo json_encode(['success' => true, 'message' => 'Cluster rifiutato']);
            } else {
                echo json_encode(['success' => false, 'error' => 'Errore durante il rifiuto']);
            }
            exit();
            
        case 'get_clusters':
            $groupId = (int)($_POST['group_id'] ?? 0);
            $status = $_POST['status'] ?? null;
            
            $query = "
                SELECT pc.id, pc.status, pc.created_at,
                       GROUP_CONCAT(DISTINCT CONCAT(p.first_name, ' ', p.last_name, ' (', l.name, ')') SEPARATOR ', ') as players
                FROM player_clusters pc
                JOIN player_cluster_members pcm ON pc.id = pcm.cluster_id
                JOIN players p ON pcm.player_id = p.id
                JOIN teams t ON p.team_id = t.id
                JOIN leagues l ON t.league_id = l.id
                WHERE pc.official_group_id = ?
            ";
            
            if ($status) {
                $query .= " AND pc.status = ?";
                $stmt = $conn->prepare($query);
                $stmt->bind_param("is", $groupId, $status);
            } else {
                $stmt = $conn->prepare($query);
                $stmt->bind_param("i", $groupId);
            }
            
            $stmt->execute();
            $result = $stmt->get_result();
            $clusters = [];
            while ($row = $result->fetch_assoc()) {
                $clusters[] = [
                    'id' => (int)$row['id'],
                    'status' => $row['status'],
                    'created_at' => $row['created_at'],
                    'players' => $row['players']
                ];
            }
            echo json_encode(['clusters' => $clusters]);
            exit();
            
        case 'search_players':
            $groupId = (int)($_POST['group_id'] ?? 0);
            $query = $_POST['query'] ?? '';
            
            if (!$groupId || empty($query)) {
                echo json_encode(['players' => []]);
                exit();
            }
            
            $searchTerm = "%$query%";
            $stmt = $conn->prepare("
                SELECT p.id, p.first_name, p.last_name, l.id as league_id, l.name as league_name
                FROM players p
                JOIN teams t ON p.team_id = t.id
                JOIN leagues l ON t.league_id = l.id
                WHERE l.official_group_id = ? AND l.is_official = 1
                AND (p.first_name LIKE ? OR p.last_name LIKE ?)
                ORDER BY p.last_name, p.first_name
                LIMIT 20
            ");
            $stmt->bind_param("iss", $groupId, $searchTerm, $searchTerm);
            $stmt->execute();
            $result = $stmt->get_result();
            $players = [];
            while ($row = $result->fetch_assoc()) {
                $players[] = [
                    'id' => (int)$row['id'],
                    'name' => $row['first_name'] . ' ' . $row['last_name'],
                    'league_id' => (int)$row['league_id'],
                    'league_name' => $row['league_name']
                ];
            }
            echo json_encode(['players' => $players]);
            exit();
    }
}

// Get all users for management
$stmt = $conn->prepare("
    SELECT id, username, email, last_login, last_activity, is_superuser, created_at
    FROM users 
    ORDER BY created_at DESC
");
$stmt->execute();
$users = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// Get access statistics
$access_stats = [
    'day' => getUserAccessStats('day'),
    'week' => getUserAccessStats('week'),
    'month' => getUserAccessStats('month'),
    'year' => getUserAccessStats('year')
];

// Get page view statistics
$page_stats = getPageViewStats('week');

// Get league popularity stats
$league_stats = getLeaguePopularityStats();

// Helper functions are now in functions.php

function getUserAccessStats($period) {
    global $conn;
    
    $where_clause = '';
    switch ($period) {
        case 'day':
            $where_clause = "WHERE DATE(last_login) = CURDATE()";
            break;
        case 'week':
            $where_clause = "WHERE last_login >= DATE_SUB(NOW(), INTERVAL 1 WEEK)";
            break;
        case 'month':
            $where_clause = "WHERE last_login >= DATE_SUB(NOW(), INTERVAL 1 MONTH) AND last_login < DATE_SUB(NOW(), INTERVAL 0 MONTH)";
            break;
        case 'year':
            $where_clause = "WHERE last_login >= DATE_SUB(NOW(), INTERVAL 1 YEAR)";
            break;
    }
    
    $stmt = $conn->prepare("SELECT COUNT(*) as count FROM users $where_clause");
    $stmt->execute();
    $result = $stmt->get_result()->fetch_assoc();
    
    return $result['count'];
}

function getDetailedStats($period) {
    global $conn;
    
    $where_clause = '';
    $page_where_clause = '';
    
    switch ($period) {
        case 'day':
            $where_clause = "WHERE DATE(last_login) = CURDATE()";
            $page_where_clause = "WHERE DATE(timestamp) = CURDATE()";
            break;
        case 'week':
            $where_clause = "WHERE last_login >= DATE_SUB(NOW(), INTERVAL 1 WEEK)";
            $page_where_clause = "WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 1 WEEK)";
            break;
        case 'month':
            $where_clause = "WHERE last_login >= DATE_SUB(NOW(), INTERVAL 1 MONTH) AND last_login < DATE_SUB(NOW(), INTERVAL 0 MONTH)";
            $page_where_clause = "WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 1 MONTH) AND timestamp < DATE_SUB(NOW(), INTERVAL 0 MONTH)";
            break;
        case 'year':
            $where_clause = "WHERE last_login >= DATE_SUB(NOW(), INTERVAL 1 YEAR)";
            $page_where_clause = "WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 1 YEAR)";
            break;
    }
    
    // Get unique visitors
    $stmt = $conn->prepare("SELECT COUNT(DISTINCT user_id) as visitors FROM page_views $page_where_clause");
    $stmt->execute();
    $visitors = $stmt->get_result()->fetch_assoc()['visitors'];
    
    // Get total page views
    $stmt = $conn->prepare("SELECT COUNT(*) as page_views FROM page_views $page_where_clause");
    $stmt->execute();
    $page_views = $stmt->get_result()->fetch_assoc()['page_views'];
    
    // Get average visitors per day
    $days = 1;
    switch ($period) {
        case 'week': $days = 7; break;
        case 'month': $days = 30; break;
        case 'year': $days = 365; break;
    }
    
    $avg_visitors = $days > 0 ? round($visitors / $days, 1) : $visitors;
    $avg_page_views = $days > 0 ? round($page_views / $days, 1) : $page_views;
    
    return [
        'visitors' => $visitors,
        'page_views' => $page_views,
        'avg_visitors' => $avg_visitors,
        'avg_page_views' => $avg_page_views
    ];
}

function getTrendData($period) {
    global $conn;
    
    $labels = [];
    $data = [];
    
    switch ($period) {
        case 'day':
            // Last 24 hours by hour
            for ($i = 23; $i >= 0; $i--) {
                $hour = date('H:i', strtotime("-$i hours"));
                $labels[] = $hour;
                
                $stmt = $conn->prepare("SELECT COUNT(DISTINCT user_id) as count FROM page_views WHERE timestamp >= DATE_SUB(NOW(), INTERVAL ? HOUR) AND timestamp < DATE_SUB(NOW(), INTERVAL ? HOUR)");
                $stmt->bind_param("ii", $i + 1, $i);
                $stmt->execute();
                $result = $stmt->get_result()->fetch_assoc();
                $data[] = $result['count'];
            }
            break;
            
        case 'week':
            // Last 7 days
            for ($i = 6; $i >= 0; $i--) {
                $day = date('d/m', strtotime("-$i days"));
                $labels[] = $day;
                
                $stmt = $conn->prepare("SELECT COUNT(DISTINCT user_id) as count FROM page_views WHERE DATE(timestamp) = DATE_SUB(CURDATE(), INTERVAL ? DAY)");
                $stmt->bind_param("i", $i);
                $stmt->execute();
                $result = $stmt->get_result()->fetch_assoc();
                $data[] = $result['count'];
            }
            break;
            
        case 'month':
            // Last 30 days
            for ($i = 29; $i >= 0; $i--) {
                $day = date('d/m', strtotime("-$i days"));
                $labels[] = $day;
                
                $stmt = $conn->prepare("SELECT COUNT(DISTINCT user_id) as count FROM page_views WHERE DATE(timestamp) = DATE_SUB(CURDATE(), INTERVAL ? DAY)");
                $stmt->bind_param("i", $i);
                $stmt->execute();
                $result = $stmt->get_result()->fetch_assoc();
                $data[] = $result['count'];
            }
            break;
            
        case 'year':
            // Last 12 months
            for ($i = 11; $i >= 0; $i--) {
                $month = date('M Y', strtotime("-$i months"));
                $labels[] = $month;
                
                $stmt = $conn->prepare("SELECT COUNT(DISTINCT user_id) as count FROM page_views WHERE YEAR(timestamp) = YEAR(DATE_SUB(NOW(), INTERVAL ? MONTH)) AND MONTH(timestamp) = MONTH(DATE_SUB(NOW(), INTERVAL ? MONTH))");
                $stmt->bind_param("ii", $i, $i);
                $stmt->execute();
                $result = $stmt->get_result()->fetch_assoc();
                $data[] = $result['count'];
            }
            break;
    }
    
    return [
        'labels' => $labels,
        'data' => $data
    ];
}

function getPageViewStats($period) {
    global $conn;
    
    $where_clause = '';
    switch ($period) {
        case 'day':
            $where_clause = "WHERE DATE(timestamp) = CURDATE()";
            break;
        case 'week':
            $where_clause = "WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 1 WEEK)";
            break;
        case 'month':
            $where_clause = "WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 1 MONTH)";
            break;
        case 'year':
            $where_clause = "WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 1 YEAR)";
            break;
    }
    
    // Get top 5 pages
    $stmt = $conn->prepare("
        SELECT page, COUNT(*) as views 
        FROM page_views 
        $where_clause
        GROUP BY page 
        ORDER BY views DESC 
        LIMIT 5
    ");
    $stmt->execute();
    $top_pages = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    
    // Get total page views
    $stmt = $conn->prepare("SELECT COUNT(*) as total FROM page_views $where_clause");
    $stmt->execute();
    $total = $stmt->get_result()->fetch_assoc()['total'];
    
    return [
        'top_pages' => $top_pages,
        'total_views' => $total
    ];
}

function getLeaguePopularityStats() {
    global $conn;
    
    $stmt = $conn->prepare("
        SELECT 
            l.id,
            l.name,
            COUNT(DISTINCT lm.user_id) as members,
            COUNT(DISTINCT ul.user_id) as active_users,
            COUNT(DISTINCT ul.giornata) as total_lineups,
            l.created_at
        FROM leagues l
        LEFT JOIN league_members lm ON l.id = lm.league_id
        LEFT JOIN user_lineups ul ON l.id = ul.league_id
        GROUP BY l.id, l.name, l.created_at
        ORDER BY members DESC, active_users DESC
        LIMIT 10
    ");
    $stmt->execute();
    return $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
}

function generateRandomPassword($length = 12) {
    $characters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*';
    $password = '';
    for ($i = 0; $i < $length; $i++) {
        $password .= $characters[rand(0, strlen($characters) - 1)];
    }
    return $password;
}

function isUserOnline($last_activity) {
    if (!$last_activity) return false;
    $last_activity_time = strtotime($last_activity);
    $current_time = time();
    return ($current_time - $last_activity_time) < 60; // 1 minute
}
?>

<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Super Admin - FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        .page-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem 0;
            margin-bottom: 2rem;
        }
        
        .admin-card {
            transition: transform 0.2s, box-shadow 0.2s;
            border: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-radius: 12px;
            margin-bottom: 1.5rem;
        }
        
        .admin-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        }
        
        .stat-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 12px;
            padding: 1.5rem;
            text-align: center;
        }
        
        .stat-number {
            font-size: 2.5rem;
            font-weight: bold;
            margin-bottom: 0.5rem;
        }
        
        .stat-label {
            font-size: 0.9rem;
            opacity: 0.9;
        }
        
        .user-table {
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .online-indicator {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            display: inline-block;
            margin-right: 0.5rem;
        }
        
        .online {
            background-color: #28a745;
        }
        
        .offline {
            background-color: #6c757d;
        }
        
        .superuser-badge {
            background: linear-gradient(135deg, #ffc107 0%, #ffed4e 100%);
            color: #212529;
            font-weight: bold;
        }
        
        .chart-container {
            position: relative;
            height: 300px;
            margin: 1rem 0;
        }
        
        #trendChart {
            max-height: 400px !important;
            min-height: 300px !important;
        }
        
        .nav-tabs .nav-link {
            border: none;
            color: white;
            font-weight: 500;
        }
        
        .nav-tabs .nav-link.active {
            color: #667eea;
            border-bottom: 2px solid #667eea;
        }
        
        .danger-zone {
            border-left: 4px solid #dc3545;
            background: #fff5f5;
        }
    </style>
</head>
<body>
<?php include 'navbar.php'; ?>

<div class="page-header">
    <div class="container">
        <div class="row align-items-center">
            <div class="col-md-8">
                <h1><i class="bi bi-shield-check me-2"></i>Super Admin Panel</h1>
                <p class="mb-0">Gestione avanzata del sistema FantaCoppa</p>
            </div>
            <div class="col-md-4 text-end">
                <div class="stat-card">
                    <div class="stat-number"><?php echo count($users); ?></div>
                    <div class="stat-label">Utenti Totali</div>
                </div>
            </div>
        </div>
    </div>
</div>

<div class="container py-4">
    <!-- Statistics Overview -->
    <div class="row mb-4">
        <div class="col-md-3">
            <div class="stat-card">
                <div class="stat-number"><?php echo $access_stats['day']; ?></div>
                <div class="stat-label">Accessi Oggi</div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="stat-card">
                <div class="stat-number"><?php echo $access_stats['week']; ?></div>
                <div class="stat-label">Accessi Settimana</div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="stat-card">
                <div class="stat-number"><?php echo $access_stats['month']; ?></div>
                <div class="stat-label">Accessi Mese</div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="stat-card">
                <div class="stat-number"><?php echo $access_stats['year']; ?></div>
                <div class="stat-label">Accessi Anno</div>
            </div>
        </div>
    </div>

    <!-- Main Content Tabs -->
    <div class="card admin-card">
        <div class="card-header" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
            <ul class="nav nav-tabs card-header-tabs" id="adminTabs" role="tablist">
                <li class="nav-item" role="presentation">
                    <button class="nav-link active" id="users-tab" data-bs-toggle="tab" data-bs-target="#users" type="button" role="tab">
                        <i class="bi bi-people me-1"></i>Gestione Utenti
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="access-tab" data-bs-toggle="tab" data-bs-target="#access" type="button" role="tab">
                        <i class="bi bi-graph-up me-1"></i>Statistiche Accessi
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="pages-tab" data-bs-toggle="tab" data-bs-target="#pages" type="button" role="tab">
                        <i class="bi bi-bar-chart me-1"></i>Pagine & Leghe
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="official-tab" data-bs-toggle="tab" data-bs-target="#official" type="button" role="tab">
                        <i class="bi bi-trophy me-1"></i>Ufficiali
                    </button>
                </li>
            </ul>
        </div>
        <div class="card-body">
            <div class="tab-content" id="adminTabsContent">
                <!-- Users Management Tab -->
                <div class="tab-pane fade show active" id="users" role="tabpanel">
                    <h5><i class="bi bi-people me-2"></i>Gestione Utenti</h5>
                    <div class="user-table">
                        <table class="table table-hover mb-0">
                            <thead class="table-dark">
                                <tr>
                                    <th>Username</th>
                                    <th>Email</th>
                                    <th>Ultimo Accesso</th>
                                    <th>Stato</th>
                                    <th>Ruolo</th>
                                    <th>Azioni</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php foreach ($users as $user): ?>
                                <tr data-user-id="<?php echo $user['id']; ?>">
                                    <td>
                                        <strong><?php echo htmlspecialchars($user['username']); ?></strong>
                                    </td>
                                    <td><?php echo htmlspecialchars($user['email']); ?></td>
                                    <td>
                                        <?php 
                                        if ($user['last_login']) {
                                            echo date('d/m/Y H:i', strtotime($user['last_login']));
                                        } else {
                                            echo '<span class="text-muted">Mai</span>';
                                        }
                                        ?>
                                    </td>
                                    <td>
                                        <span class="online-indicator <?php echo isUserOnline($user['last_activity']) ? 'online' : 'offline'; ?>"></span>
                                        <span class="status-text"><?php echo isUserOnline($user['last_activity']) ? 'Online' : 'Offline'; ?></span>
                                    </td>
                                    <td>
                                        <?php if ($user['is_superuser']): ?>
                                            <span class="badge superuser-badge">Super Admin</span>
                                        <?php else: ?>
                                            <span class="badge bg-secondary">Utente</span>
                                        <?php endif; ?>
                                    </td>
                                    <td>
                                        <button class="btn btn-sm btn-warning" onclick="resetPassword(<?php echo $user['id']; ?>, '<?php echo htmlspecialchars($user['username']); ?>')">
                                            <i class="bi bi-key"></i> Reset Password
                                        </button>
                                    </td>
                                </tr>
                                <?php endforeach; ?>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Access Statistics Tab -->
                <div class="tab-pane fade" id="access" role="tabpanel">
                    <h5><i class="bi bi-graph-up me-2"></i>Statistiche Accessi</h5>
                    
                    <!-- Trend Chart -->
                    <div class="row mb-4">
                        <div class="col-12">
                            <div class="card">
                                <div class="card-header d-flex justify-content-between align-items-center">
                                    <h6>Trend Accessi</h6>
                                    <select id="trendPeriod" class="form-select form-select-sm" style="width: auto;" onchange="updateTrendChart()">
                                        <option value="day">Giorno Corrente</option>
                                        <option value="week" selected>Settimana Corrente</option>
                                        <option value="month">Mese Corrente</option>
                                        <option value="year">Anno Corrente</option>
                                    </select>
                                </div>
                                <div class="card-body">
                                    <canvas id="trendChart"></canvas>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Detailed Statistics -->
                    <div class="row">
                        <div class="col-12">
                            <div class="card">
                                <div class="card-header">
                                    <h6 id="detailedStatsTitle">Statistiche Dettagliate - Settimana Corrente</h6>
                                </div>
                                <div class="card-body">
                                    <div class="row" id="detailedStats">
                                        <div class="col-md-3">
                                            <div class="stat-card">
                                                <div class="stat-number" id="visitorsCount">-</div>
                                                <div class="stat-label">Visitatori</div>
                                            </div>
                                        </div>
                                        <div class="col-md-3">
                                            <div class="stat-card">
                                                <div class="stat-number" id="pageViewsCount">-</div>
                                                <div class="stat-label">Pagine Viste</div>
                                            </div>
                                        </div>
                                        <div class="col-md-3">
                                            <div class="stat-card">
                                                <div class="stat-number" id="avgVisitorsCount">-</div>
                                                <div class="stat-label">Media Visitatori</div>
                                            </div>
                                        </div>
                                        <div class="col-md-3">
                                            <div class="stat-card">
                                                <div class="stat-number" id="avgPageViewsCount">-</div>
                                                <div class="stat-label">Media Pagine Viste</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Pages & Leagues Tab -->
                <div class="tab-pane fade" id="pages" role="tabpanel">
                    <h5><i class="bi bi-bar-chart me-2"></i>Pagine & Leghe</h5>
                    <div class="row">
                        <div class="col-md-6">
                            <div class="card">
                                <div class="card-header">
                                    <h6>Top 5 Pagine Più Visitate</h6>
                                </div>
                                <div class="card-body">
                                    <canvas id="pagesChart"></canvas>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="card">
                                <div class="card-header">
                                    <h6>Leghe Più Popolari</h6>
                                </div>
                                <div class="card-body">
                                    <div class="table-responsive">
                                        <table class="table table-sm">
                                            <thead>
                                                <tr>
                                                    <th>Lega</th>
                                                    <th>Membri</th>
                                                    <th>Attività</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <?php foreach ($league_stats as $league): ?>
                                                <tr>
                                                    <td><?php echo htmlspecialchars($league['name']); ?></td>
                                                    <td><?php echo $league['members']; ?></td>
                                                    <td><?php echo $league['total_lineups']; ?></td>
                                                </tr>
                                                <?php endforeach; ?>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Official Groups Tab -->
                <div class="tab-pane fade" id="official" role="tabpanel">
                    <h5><i class="bi bi-trophy me-2"></i>Gestione Gruppi Ufficiali</h5>
                    
                    <div class="mb-3">
                        <button class="btn btn-primary" onclick="showCreateGroupModal()">
                            <i class="bi bi-plus-circle me-1"></i>Nuovo Gruppo
                        </button>
                    </div>
                    
                    <div id="officialGroupsList">
                        <div class="text-center">
                            <div class="spinner-border text-primary" role="status">
                                <span class="visually-hidden">Caricamento...</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Reset Password Modal -->
<div class="modal fade" id="resetPasswordModal" tabindex="-1">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title">Reset Password</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
                <div class="alert alert-warning">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    Sei sicuro di voler resettare la password per l'utente <strong id="resetUsername"></strong>?
                </div>
                <div class="mb-3">
                    <label for="newPassword" class="form-label">Nuova Password (lascia vuoto per generare automaticamente)</label>
                    <input type="text" class="form-control" id="newPassword" placeholder="Lascia vuoto per password casuale">
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Annulla</button>
                <button type="button" class="btn btn-danger" onclick="confirmResetPassword()">Reset Password</button>
            </div>
        </div>
    </div>
</div>

<!-- Create Official Group Modal -->
<div class="modal fade" id="createGroupModal" tabindex="-1">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title">Nuovo Gruppo Ufficiale</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
                <div class="mb-3">
                    <label for="groupName" class="form-label">Nome Gruppo *</label>
                    <input type="text" class="form-control" id="groupName" required>
                </div>
                <div class="mb-3">
                    <label for="groupDescription" class="form-label">Descrizione</label>
                    <textarea class="form-control" id="groupDescription" rows="3"></textarea>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Annulla</button>
                <button type="button" class="btn btn-primary" onclick="createGroup()">Crea Gruppo</button>
            </div>
        </div>
    </div>
</div>

<!-- Group Detail Modal -->
<div class="modal fade" id="groupDetailModal" tabindex="-1">
    <div class="modal-dialog modal-lg">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="groupDetailTitle">Dettagli Gruppo</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
                <div id="groupDetailContent">
                    <div class="text-center">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">Caricamento...</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Cluster Management Modal -->
<div class="modal fade" id="clusterModal" tabindex="-1">
    <div class="modal-dialog modal-xl">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title">Gestisci Cluster Giocatori</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
                <ul class="nav nav-tabs mb-3" id="clusterTabs" role="tablist">
                    <li class="nav-item" role="presentation">
                        <button class="nav-link active" id="suggestions-tab" data-bs-toggle="tab" data-bs-target="#suggestions" type="button">Suggerimenti</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="clusters-tab" data-bs-toggle="tab" data-bs-target="#clusters" type="button">Cluster</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="manual-tab" data-bs-toggle="tab" data-bs-target="#manual" type="button">Crea Manuale</button>
                    </li>
                </ul>
                <div class="tab-content" id="clusterTabsContent">
                    <div class="tab-pane fade show active" id="suggestions" role="tabpanel">
                        <div id="suggestionsList">
                            <div class="text-center">
                                <div class="spinner-border text-primary" role="status">
                                    <span class="visually-hidden">Caricamento...</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="tab-pane fade" id="clusters" role="tabpanel">
                        <div class="mb-3">
                            <button class="btn btn-sm btn-outline-primary me-2" onclick="loadClusters(null)">Tutti</button>
                            <button class="btn btn-sm btn-outline-success me-2" onclick="loadClusters('approved')">Approvati</button>
                            <button class="btn btn-sm btn-outline-warning me-2" onclick="loadClusters('pending')">In Attesa</button>
                            <button class="btn btn-sm btn-outline-danger" onclick="loadClusters('rejected')">Rifiutati</button>
                        </div>
                        <div id="clustersList">
                            <div class="text-center">
                                <div class="spinner-border text-primary" role="status">
                                    <span class="visually-hidden">Caricamento...</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="tab-pane fade" id="manual" role="tabpanel">
                        <div class="mb-3">
                            <label for="playerSearch" class="form-label">Cerca Giocatori</label>
                            <input type="text" class="form-control" id="playerSearch" placeholder="Nome o cognome..." onkeyup="searchPlayers()">
                        </div>
                        <div id="searchedPlayers" class="mb-3" style="max-height: 200px; overflow-y: auto;"></div>
                        <div id="selectedPlayers" class="mb-3"></div>
                        <button class="btn btn-primary" onclick="createManualCluster()" id="createClusterBtn" disabled>Crea Cluster</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
<script>
let currentUserId = null;

function resetPassword(userId, username) {
    currentUserId = userId;
    document.getElementById('resetUsername').textContent = username;
    document.getElementById('newPassword').value = '';
    new bootstrap.Modal(document.getElementById('resetPasswordModal')).show();
}

function confirmResetPassword() {
    const newPassword = document.getElementById('newPassword').value;
    
    fetch('superuser.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `action=reset_password&user_id=${currentUserId}&new_password=${encodeURIComponent(newPassword)}`
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();
    })
    .then(data => {
        if (data.success) {
            alert(`Password resettata con successo!\nNuova password: ${data.new_password}`);
            bootstrap.Modal.getInstance(document.getElementById('resetPasswordModal')).hide();
        } else {
            alert('Errore nel reset della password: ' + (data.error || 'Errore sconosciuto'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
    });
}

let trendChart = null;

function updateTrendChart() {
    const period = document.getElementById('trendPeriod').value;
    const periodNames = {
        'day': 'Giorno Corrente',
        'week': 'Settimana Corrente', 
        'month': 'Mese Corrente',
        'year': 'Anno Corrente'
    };
    
    // Update title
    document.getElementById('detailedStatsTitle').textContent = `Statistiche Dettagliate - ${periodNames[period]}`;
    
    // Fetch detailed stats
    fetch('superuser.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `action=get_detailed_stats&period=${period}`
    })
    .then(response => response.json())
    .then(data => {
        document.getElementById('visitorsCount').textContent = data.visitors;
        document.getElementById('pageViewsCount').textContent = data.page_views;
        document.getElementById('avgVisitorsCount').textContent = data.avg_visitors;
        document.getElementById('avgPageViewsCount').textContent = data.avg_page_views;
    })
    .catch(error => {
        console.error('Error fetching detailed stats:', error);
    });
    
    // Fetch and update trend chart
    fetch('superuser.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `action=get_trend_data&period=${period}`
    })
    .then(response => response.json())
    .then(data => {
        if (trendChart) {
            trendChart.destroy();
        }
        
        const trendCtx = document.getElementById('trendChart').getContext('2d');
        trendChart = new Chart(trendCtx, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [{
                    label: 'Visitatori Unici',
                    data: data.data,
                    borderColor: '#dc3545',
                    backgroundColor: 'rgba(220, 53, 69, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    }
                }
            }
        });
    })
    .catch(error => {
        console.error('Error fetching trend data:', error);
    });
}

// Real-time updates
function updateUserStatus() {
    fetch('superuser.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'action=get_user_status'
    })
    .then(response => response.json())
    .then(users => {
        users.forEach(user => {
            const statusElement = document.querySelector(`tr[data-user-id="${user.id}"] .online-indicator`);
            const statusTextElement = document.querySelector(`tr[data-user-id="${user.id}"] .status-text`);
            
            if (statusElement && statusTextElement) {
                if (user.is_online) {
                    statusElement.className = 'online-indicator online';
                    statusTextElement.textContent = 'Online';
                } else {
                    statusElement.className = 'online-indicator offline';
                    statusTextElement.textContent = 'Offline';
                }
            }
        });
    })
    .catch(error => {
        console.error('Error updating user status:', error);
    });
}

// Initialize charts
document.addEventListener('DOMContentLoaded', function() {
    // Load initial detailed stats and trend chart
    updateTrendChart();

    // Pages Chart
    const pagesCtx = document.getElementById('pagesChart').getContext('2d');
    const pageData = <?php echo json_encode($page_stats['top_pages']); ?>;
    new Chart(pagesCtx, {
        type: 'bar',
        data: {
            labels: pageData.map(p => p.page),
            datasets: [{
                label: 'Visualizzazioni',
                data: pageData.map(p => p.views),
                backgroundColor: '#667eea'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
    
    // Start real-time updates every 30 seconds
    setInterval(updateUserStatus, 30000);
    
    // Initial update
    updateUserStatus();
    
    // Load official groups when tab is shown
    document.getElementById('official-tab').addEventListener('shown.bs.tab', function() {
        loadOfficialGroups();
    });
});

let currentGroupId = null;
let selectedPlayersForCluster = [];

// Official Groups Management
function loadOfficialGroups() {
    fetch('superuser.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'action=get_official_groups'
    })
    .then(response => response.json())
    .then(groups => {
        const container = document.getElementById('officialGroupsList');
        if (groups.length === 0) {
            container.innerHTML = '<div class="alert alert-info">Nessun gruppo ufficiale creato</div>';
            return;
        }
        
        container.innerHTML = groups.map(group => `
            <div class="card mb-3">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <h5 class="card-title">${escapeHtml(group.name)}</h5>
                            ${group.description ? `<p class="card-text text-muted">${escapeHtml(group.description)}</p>` : ''}
                            <small class="text-muted">${group.league_count} leghe • Creato il ${formatDate(group.created_at)}</small>
                        </div>
                        <div>
                            <button class="btn btn-sm btn-primary me-2" onclick="showGroupDetail(${group.id}, '${escapeHtml(group.name)}')">
                                <i class="bi bi-eye"></i> Dettagli
                            </button>
                            <button class="btn btn-sm btn-danger" onclick="deleteGroup(${group.id}, '${escapeHtml(group.name)}')">
                                <i class="bi bi-trash"></i> Elimina
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    })
    .catch(error => {
        console.error('Error loading groups:', error);
        document.getElementById('officialGroupsList').innerHTML = '<div class="alert alert-danger">Errore nel caricamento dei gruppi</div>';
    });
}

function showCreateGroupModal() {
    document.getElementById('groupName').value = '';
    document.getElementById('groupDescription').value = '';
    new bootstrap.Modal(document.getElementById('createGroupModal')).show();
}

function createGroup() {
    const name = document.getElementById('groupName').value.trim();
    const description = document.getElementById('groupDescription').value.trim();
    
    if (!name) {
        alert('Il nome è obbligatorio');
        return;
    }
    
    const formData = new FormData();
    formData.append('action', 'create_official_group');
    formData.append('name', name);
    formData.append('description', description);
    
    fetch('superuser.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            bootstrap.Modal.getInstance(document.getElementById('createGroupModal')).hide();
            loadOfficialGroups();
            alert('Gruppo creato con successo');
        } else {
            alert('Errore: ' + (data.error || 'Errore sconosciuto'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Errore durante la creazione del gruppo');
    });
}

function deleteGroup(groupId, groupName) {
    if (!confirm(`Sei sicuro di voler eliminare il gruppo "${groupName}"? Le leghe verranno rimosse dal gruppo.`)) {
        return;
    }
    
    const formData = new FormData();
    formData.append('action', 'delete_official_group');
    formData.append('group_id', groupId);
    
    fetch('superuser.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadOfficialGroups();
            alert('Gruppo eliminato con successo');
        } else {
            alert('Errore: ' + (data.error || 'Errore sconosciuto'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Errore durante l\'eliminazione del gruppo');
    });
}

function showGroupDetail(groupId, groupName) {
    currentGroupId = groupId;
    document.getElementById('groupDetailTitle').textContent = groupName;
    
    const formData = new FormData();
    formData.append('action', 'get_group_leagues');
    formData.append('group_id', groupId);
    
    fetch('superuser.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(leagues => {
        const content = document.getElementById('groupDetailContent');
        content.innerHTML = `
            <div class="mb-3">
                <h6>Leghe del Gruppo (${leagues.length})</h6>
                ${leagues.length > 0 ? `
                    <div class="list-group">
                        ${leagues.map(league => `
                            <div class="list-group-item">
                                <div class="d-flex justify-content-between">
                                    <div>
                                        <strong>${escapeHtml(league.name)}</strong>
                                        <small class="text-muted d-block">${league.member_count} membri • ${formatDate(league.created_at)}</small>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : '<p class="text-muted">Nessuna lega in questo gruppo</p>'}
            </div>
            <div class="d-grid">
                <button class="btn btn-primary" onclick="showClusterModal(${groupId})">
                    <i class="bi bi-people"></i> Gestisci Cluster Giocatori
                </button>
            </div>
        `;
        new bootstrap.Modal(document.getElementById('groupDetailModal')).show();
    })
    .catch(error => {
        console.error('Error:', error);
        document.getElementById('groupDetailContent').innerHTML = '<div class="alert alert-danger">Errore nel caricamento delle leghe</div>';
    });
}

function showClusterModal(groupId) {
    currentGroupId = groupId;
    bootstrap.Modal.getInstance(document.getElementById('groupDetailModal')).hide();
    
    // Reset tabs
    document.getElementById('suggestions-tab').click();
    loadClusterSuggestions();
    loadClusters(null);
    
    new bootstrap.Modal(document.getElementById('clusterModal')).show();
}

function loadClusterSuggestions() {
    const formData = new FormData();
    formData.append('action', 'get_cluster_suggestions');
    formData.append('group_id', currentGroupId);
    
    fetch('superuser.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        const container = document.getElementById('suggestionsList');
        if (data.suggestions.length === 0) {
            container.innerHTML = '<div class="alert alert-info">Nessun suggerimento disponibile</div>';
            return;
        }
        
        container.innerHTML = data.suggestions.map((suggestion, index) => `
            <div class="card mb-2">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <strong>${escapeHtml(suggestion.player_1.name)}</strong>
                            <small class="text-muted"> (${escapeHtml(suggestion.player_1.league_name)})</small>
                            <span class="mx-2">⇄</span>
                            <strong>${escapeHtml(suggestion.player_2.name)}</strong>
                            <small class="text-muted"> (${escapeHtml(suggestion.player_2.league_name)})</small>
                        </div>
                        <button class="btn btn-sm btn-success" onclick="createClusterFromSuggestion([${suggestion.player_1.id}, ${suggestion.player_2.id}])">
                            <i class="bi bi-check"></i> Approva
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    })
    .catch(error => {
        console.error('Error:', error);
        document.getElementById('suggestionsList').innerHTML = '<div class="alert alert-danger">Errore nel caricamento dei suggerimenti</div>';
    });
}

function loadClusters(status) {
    const formData = new FormData();
    formData.append('action', 'get_clusters');
    formData.append('group_id', currentGroupId);
    if (status) {
        formData.append('status', status);
    }
    
    fetch('superuser.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        const container = document.getElementById('clustersList');
        if (data.clusters.length === 0) {
            container.innerHTML = '<div class="alert alert-info">Nessun cluster trovato</div>';
            return;
        }
        
        container.innerHTML = data.clusters.map(cluster => {
            const statusBadge = {
                'approved': '<span class="badge bg-success">Approvato</span>',
                'pending': '<span class="badge bg-warning">In Attesa</span>',
                'rejected': '<span class="badge bg-danger">Rifiutato</span>'
            }[cluster.status] || '';
            
            const actions = cluster.status === 'pending' ? `
                <button class="btn btn-sm btn-success me-2" onclick="approveCluster(${cluster.id})">
                    <i class="bi bi-check"></i> Approva
                </button>
                <button class="btn btn-sm btn-danger" onclick="rejectCluster(${cluster.id})">
                    <i class="bi bi-x"></i> Rifiuta
                </button>
            ` : '';
            
            return `
                <div class="card mb-2">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                ${statusBadge}
                                <p class="mb-0 mt-2">${escapeHtml(cluster.players)}</p>
                                <small class="text-muted">${formatDate(cluster.created_at)}</small>
                            </div>
                            ${actions}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    })
    .catch(error => {
        console.error('Error:', error);
        document.getElementById('clustersList').innerHTML = '<div class="alert alert-danger">Errore nel caricamento dei cluster</div>';
    });
}

function createClusterFromSuggestion(playerIds) {
    createCluster(playerIds);
}

function createManualCluster() {
    if (selectedPlayersForCluster.length < 2) {
        alert('Seleziona almeno 2 giocatori');
        return;
    }
    
    const playerIds = selectedPlayersForCluster.map(p => p.id);
    createCluster(playerIds);
}

function createCluster(playerIds) {
    const formData = new FormData();
    formData.append('action', 'create_cluster');
    formData.append('group_id', currentGroupId);
    formData.append('player_ids', JSON.stringify(playerIds));
    
    fetch('superuser.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('Cluster creato con successo');
            loadClusterSuggestions();
            loadClusters(null);
            selectedPlayersForCluster = [];
            updateSelectedPlayers();
        } else {
            alert('Errore: ' + (data.error || 'Errore sconosciuto'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Errore durante la creazione del cluster');
    });
}

function approveCluster(clusterId) {
    const formData = new FormData();
    formData.append('action', 'approve_cluster');
    formData.append('cluster_id', clusterId);
    
    fetch('superuser.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadClusters(null);
            loadClusterSuggestions();
        } else {
            alert('Errore: ' + (data.error || 'Errore sconosciuto'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Errore durante l\'approvazione');
    });
}

function rejectCluster(clusterId) {
    const formData = new FormData();
    formData.append('action', 'reject_cluster');
    formData.append('cluster_id', clusterId);
    
    fetch('superuser.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadClusters(null);
        } else {
            alert('Errore: ' + (data.error || 'Errore sconosciuto'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Errore durante il rifiuto');
    });
}

function searchPlayers() {
    const query = document.getElementById('playerSearch').value.trim();
    
    if (!query || query.length < 2) {
        document.getElementById('searchedPlayers').innerHTML = '';
        return;
    }
    
    const formData = new FormData();
    formData.append('action', 'search_players');
    formData.append('group_id', currentGroupId);
    formData.append('query', query);
    
    fetch('superuser.php', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        const container = document.getElementById('searchedPlayers');
        if (data.players.length === 0) {
            container.innerHTML = '<div class="alert alert-info">Nessun giocatore trovato</div>';
            return;
        }
        
        container.innerHTML = data.players.map(player => {
            const isSelected = selectedPlayersForCluster.some(p => p.id === player.id);
            return `
                <div class="card mb-2">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <strong>${escapeHtml(player.name)}</strong>
                                <small class="text-muted d-block">${escapeHtml(player.league_name)}</small>
                            </div>
                            <button class="btn btn-sm ${isSelected ? 'btn-danger' : 'btn-primary'}" 
                                    onclick="${isSelected ? 'removePlayerFromCluster(' + player.id + ')' : 'addPlayerToCluster(' + JSON.stringify(player).replace(/"/g, '&quot;') + ')'}">
                                ${isSelected ? '<i class="bi bi-x"></i> Rimuovi' : '<i class="bi bi-plus"></i> Aggiungi'}
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    })
    .catch(error => {
        console.error('Error:', error);
    });
}

function addPlayerToCluster(player) {
    if (selectedPlayersForCluster.some(p => p.id === player.id)) {
        return;
    }
    selectedPlayersForCluster.push(player);
    updateSelectedPlayers();
    searchPlayers(); // Refresh to update button states
}

function removePlayerFromCluster(playerId) {
    selectedPlayersForCluster = selectedPlayersForCluster.filter(p => p.id !== playerId);
    updateSelectedPlayers();
    searchPlayers(); // Refresh to update button states
}

function updateSelectedPlayers() {
    const container = document.getElementById('selectedPlayers');
    const createBtn = document.getElementById('createClusterBtn');
    
    if (selectedPlayersForCluster.length === 0) {
        container.innerHTML = '';
        createBtn.disabled = true;
        return;
    }
    
    container.innerHTML = `
        <div class="alert alert-info">
            <strong>Giocatori selezionati (${selectedPlayersForCluster.length}):</strong>
            <ul class="mb-0 mt-2">
                ${selectedPlayersForCluster.map(p => `<li>${escapeHtml(p.name)} (${escapeHtml(p.league_name)})</li>`).join('')}
            </ul>
        </div>
    `;
    createBtn.disabled = selectedPlayersForCluster.length < 2;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
</script>
</body>
</html>

<?php
/**
 * API REST per FantaCoppa Mobile
 * Questo file funge da ponte tra l'app mobile e il database MySQL
 */

// Evita che notice/warning PHP finiscano nel body: corrompono il JSON e l'app va in errore pur avendo eseguito la logica (es. mail inviata).
@ini_set('display_errors', '0');

// Non impostare Content-Type per tutte le richieste (multipart/form-data non funziona con application/json)
if (!isset($_FILES) || empty($_FILES)) {
    header('Content-Type: application/json');
}
// CORS - Restringi alle origini consentite
require_once 'config.php';

$allowedOrigin = defined('CORS_ALLOWED_ORIGIN') ? CORS_ALLOWED_ORIGIN : '';
$requestOrigin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';

// Consenti anche le richieste dall'app mobile (senza origin) e dal dominio configurato
if (empty($requestOrigin) || $requestOrigin === $allowedOrigin) {
    header('Access-Control-Allow-Origin: ' . ($requestOrigin ?: '*'));
} else {
    // Per le app mobile React Native, l'origin potrebbe non essere impostato
    header('Access-Control-Allow-Origin: ' . $allowedOrigin);
}
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-App-Version-Code, X-App-Version');
header('Access-Control-Allow-Credentials: true');

// Gestisci preflight OPTIONS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

require_once 'db.php';
require_once 'functions.php';

// Includi PHPMailer per l'invio email
// Verifica se PHPMailer è già incluso da functions.php
if (!class_exists('PHPMailer\PHPMailer\PHPMailer')) {
    error_log("PHPMailer non trovato, tentativo di includere manualmente...");
    $phpmailerPath = __DIR__ . '/PHPMailer/';
    
    if (file_exists($phpmailerPath . 'Exception.php')) {
        require_once $phpmailerPath . 'Exception.php';
        error_log("PHPMailer Exception.php incluso");
    } else {
        error_log("ERROR: PHPMailer/Exception.php non trovato in: " . $phpmailerPath);
    }
    
    if (file_exists($phpmailerPath . 'PHPMailer.php')) {
        require_once $phpmailerPath . 'PHPMailer.php';
        error_log("PHPMailer PHPMailer.php incluso");
    } else {
        error_log("ERROR: PHPMailer/PHPMailer.php non trovato in: " . $phpmailerPath);
    }
    
    if (file_exists($phpmailerPath . 'SMTP.php')) {
        require_once $phpmailerPath . 'SMTP.php';
        error_log("PHPMailer SMTP.php incluso");
    } else {
        error_log("ERROR: PHPMailer/SMTP.php non trovato in: " . $phpmailerPath);
    }
    
    // Verifica se ora la classe esiste
    if (class_exists('PHPMailer\PHPMailer\PHPMailer')) {
        error_log("PHPMailer caricato con successo dopo include manuale");
    } else {
        error_log("ERROR: PHPMailer ancora non disponibile dopo include manuale");
    }
} else {
    error_log("PHPMailer già disponibile (incluso da functions.php)");
}

// JWT_SECRET è definito in config.php (già incluso sopra)

// Funzione per generare JWT
function generateJWT($userId, $username) {
    $header = json_encode(['typ' => 'JWT', 'alg' => 'HS256']);
    $payload = json_encode([
        'userId' => $userId,
        'username' => $username,
        'exp' => time() + (7 * 24 * 60 * 60) // 7 giorni
    ]);
    
    $base64Header = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($header));
    $base64Payload = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($payload));
    
    $signature = hash_hmac('sha256', $base64Header . "." . $base64Payload, JWT_SECRET, true);
    $base64Signature = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($signature));
    
    return $base64Header . "." . $base64Payload . "." . $base64Signature;
}

// Funzione per verificare JWT
function verifyJWT($token) {
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return false;
    }
    
    $header = $parts[0];
    $payload = $parts[1];
    $signature = $parts[2];
    
    $expectedSignature = str_replace(['+', '/', '='], ['-', '_', ''], 
        base64_encode(hash_hmac('sha256', $header . "." . $payload, JWT_SECRET, true)));
    
    if ($signature !== $expectedSignature) {
        return false;
    }
    
    $decoded = json_decode(base64_decode(str_replace(['-', '_'], ['+', '/'], $payload)), true);
    
    if (isset($decoded['exp']) && $decoded['exp'] < time()) {
        return false; // Token scaduto
    }
    
    return $decoded;
}

// Funzione per ottenere token dall'header
function getRequestHeader($name) {
    $target = strtolower($name);

    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        foreach ($headers as $key => $value) {
            if (strtolower($key) === $target) {
                return $value;
            }
        }
    }

    $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (isset($_SERVER[$serverKey])) {
        return $_SERVER[$serverKey];
    }

    return null;
}

function getAppVersionCodeFromRequest() {
    $versionRaw = getRequestHeader('X-App-Version-Code');
    if ($versionRaw === null || $versionRaw === '') {
        return 0;
    }

    if (!is_numeric($versionRaw)) {
        return 0;
    }

    return (int)$versionRaw;
}

function getAuthToken() {
    $authHeader = getRequestHeader('Authorization');
    if ($authHeader && preg_match('/Bearer\s+(.*)$/i', $authHeader, $matches)) {
        return $matches[1];
    }
    return null;
}

function dbTableExists($tableName) {
    $conn = getDbConnection();
    $stmt = $conn->prepare("SHOW TABLES LIKE ?");
    if (!$stmt) return false;
    $stmt->bind_param("s", $tableName);
    $stmt->execute();
    $res = $stmt->get_result();
    $exists = $res && $res->num_rows > 0;
    $stmt->close();
    return $exists;
}

function deleteUserAccountData($userId) {
    $conn = getDbConnection();
    $conn->begin_transaction();
    try {
        $tablesWithUserId = [
            'user_players',
            'user_lineups',
            'matchday_results',
            'user_budget',
            'league_members',
            'league_join_requests',
            'user_league_prefs',
            'user_market_blocks',
            'page_views',
        ];

        foreach ($tablesWithUserId as $t) {
            if (!dbTableExists($t)) continue;
            $stmt = $conn->prepare("DELETE FROM {$t} WHERE user_id = ?");
            if (!$stmt) continue;
            $stmt->bind_param("i", $userId);
            $stmt->execute();
            $stmt->close();
        }

        if (dbTableExists('superuser_actions')) {
            $stmt = $conn->prepare("DELETE FROM superuser_actions WHERE superuser_id = ? OR target_user_id = ?");
            if ($stmt) {
                $stmt->bind_param("ii", $userId, $userId);
                $stmt->execute();
                $stmt->close();
            }
        }

        if (dbTableExists('password_resets')) {
            // cancella per email dell'utente
            $stmt = $conn->prepare("SELECT email FROM users WHERE id = ?");
            $stmt->bind_param("i", $userId);
            $stmt->execute();
            $row = $stmt->get_result()->fetch_assoc();
            $stmt->close();
            if ($row && !empty($row['email'])) {
                $email = $row['email'];
                $del = $conn->prepare("DELETE FROM password_resets WHERE email = ?");
                if ($del) {
                    $del->bind_param("s", $email);
                    $del->execute();
                    $del->close();
                }
            }
        }

        // infine l'utente
        $stmt = $conn->prepare("DELETE FROM users WHERE id = ?");
        if (!$stmt) throw new Exception('Errore eliminazione utente');
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        if ($stmt->affected_rows < 1) {
            throw new Exception('Utente non trovato');
        }
        $stmt->close();

        $conn->commit();
        return true;
    } catch (Throwable $e) {
        $conn->rollback();
        error_log("deleteUserAccountData error: " . $e->getMessage());
        return false;
    }
}

function buildUpdateRequiredResponse() {
    $minSupportedVersionCode = defined('MIN_SUPPORTED_APP_VERSION_CODE') ? (int)MIN_SUPPORTED_APP_VERSION_CODE : 0;
    if ($minSupportedVersionCode <= 0) {
        return null;
    }

    $currentVersionCode = getAppVersionCodeFromRequest();
    if ($currentVersionCode >= $minSupportedVersionCode) {
        return null;
    }

    $updateUrl = defined('APP_FORCE_UPDATE_URL') ? APP_FORCE_UPDATE_URL : '';

    return [
        'code' => 'UPDATE_REQUIRED',
        'message' => 'Questa versione dell\'app non e piu supportata. Aggiorna per continuare.',
        'current_version_code' => $currentVersionCode,
        'min_supported_version_code' => $minSupportedVersionCode,
        'update_url' => $updateUrl,
    ];
}

function isForgotPasswordPath($path, $pathParts) {
    $pl = strtolower((string) $path);
    if (strpos($pl, '/auth/forgot-password') !== false || strpos($pl, '/auth/forgot_password') !== false) {
        return true;
    }
    if (!empty($pathParts[0]) && !empty($pathParts[1])
        && strtolower($pathParts[0]) === 'auth'
        && in_array(strtolower($pathParts[1]), ['forgot-password', 'forgot_password'], true)) {
        return true;
    }
    if (isset($pathParts[0]) && in_array(strtolower($pathParts[0]), ['forgot-password', 'forgot_password'], true)
        && count($pathParts) === 1) {
        return true;
    }
    return false;
}

function shouldSkipVersionCheck($path, $pathParts) {
    if ($path === '/health' || $path === '/api/health') {
        return true;
    }

    if (isset($pathParts[0]) && $pathParts[0] === 'health') {
        return true;
    }

    // Password dimenticata: deve funzionare anche con app vecchia (recupero account)
    if (isForgotPasswordPath($path, $pathParts)) {
        return true;
    }

    // Cron push (wget senza header versione app)
    if (strpos($path, '/cron/push-formation-reminders') !== false) {
        return true;
    }

    return false;
}

function enforceMinimumAppVersion($path, $pathParts) {
    if (shouldSkipVersionCheck($path, $pathParts)) {
        return null;
    }

    return buildUpdateRequiredResponse();
}

// Parsing della richiesta — compatibile Altervista (anche /membri/sito/api.php/...)
$method = $_SERVER['REQUEST_METHOD'];
$reqPath = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
if ($reqPath === false || $reqPath === null || $reqPath === '') {
    $reqPath = '/';
}

// Rewrite (Altervista / Apache): il path reale può stare solo in REDIRECT_URL
if (!preg_match('#/(?:api|index)\.php(/|$)#i', $reqPath) && !empty($_SERVER['REDIRECT_URL'])) {
    $altPath = parse_url($_SERVER['REDIRECT_URL'], PHP_URL_PATH);
    if ($altPath && preg_match('#/(?:api|index)\.php(/|$)#i', $altPath)) {
        $reqPath = $altPath;
    }
}

if (!empty($_SERVER['PATH_INFO'])) {
    $pi = $_SERVER['PATH_INFO'];
    if (strlen($pi) > 0 && substr($reqPath, -strlen($pi)) !== $pi && preg_match('#/(?:api|index)\.php$#i', $reqPath)) {
        $reqPath = rtrim($reqPath, '/') . $pi;
    }
}

// Tutto ciò che segue .../api.php o .../index.php (rewrite Altervista / hosting)
if (preg_match('#/(?:api|index)\.php(/.*)$#i', $reqPath, $m)) {
    $path = $m[1];
} elseif (preg_match('#/(?:api|index)\.php$#i', $reqPath)) {
    $path = '/';
} else {
    $path = preg_replace('#/api\.php#i', '', $reqPath);
    $path = preg_replace('#/index\.php#i', '', $path);
}

$path = '/' . ltrim((string) $path, '/');
$path = preg_replace('#/+#', '/', $path);
if ($path === '//') {
    $path = '/';
}

// Fallback ultra-robusto: se il routing non riesce a estrarre il path ma l'URI contiene forgot-password,
// forza l'endpoint corretto (alcune config Altervista/redirect possono perdere PATH_INFO).
$rawUri = (string)($_SERVER['REQUEST_URI'] ?? '');
if ($path === '/' && preg_match('#forgot[-_]password#i', $rawUri)) {
    $path = '/auth/forgot-password';
}

// Routing
$response = ['error' => 'Endpoint non trovato'];
$statusCode = 404;

$pathParts = $path === '/' || $path === '' ? [] : array_values(array_filter(explode('/', trim($path, '/')), static function ($s) {
    return $s !== '';
}));

error_log("API Request: Method=$method, Path=$path, PathParts=" . json_encode($pathParts));

// Helper: restituisce il league_id della lega ufficiale collegata (se presente), altrimenti il league_id stesso.
// Usato per leggere teams, players, votes e matchdays dalla lega sorgente.
// Protezione anti-ciclo: max 5 livelli di profondita.
function getEffectiveLeagueId($leagueId) {
    $conn = getDbConnection();
    $visited = [];
    $currentId = (int)$leagueId;
    $maxDepth = 5;
    
    for ($i = 0; $i < $maxDepth; $i++) {
        if (in_array($currentId, $visited)) {
            error_log("Circular league link detected! Chain: " . implode(' -> ', $visited) . " -> " . $currentId);
            return (int)$leagueId; // Ritorna l'originale in caso di ciclo
        }
        $visited[] = $currentId;
        
        $stmt = $conn->prepare("SELECT linked_to_league_id FROM leagues WHERE id = ?");
        $stmt->bind_param("i", $currentId);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if ($row && $row['linked_to_league_id']) {
            $currentId = (int)$row['linked_to_league_id'];
        } else {
            return $currentId;
        }
    }
    
    error_log("Max league link depth reached for league: " . $leagueId);
    return (int)$leagueId;
}

// Helper: verifica se una lega è collegata a una lega ufficiale
function isLinkedLeague($leagueId) {
    $conn = getDbConnection();
    $stmt = $conn->prepare("SELECT linked_to_league_id FROM leagues WHERE id = ?");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return $row && $row['linked_to_league_id'] ? true : false;
}

function ensurePushTokensTable() {
    $conn = getDbConnection();
    $sql = "
        CREATE TABLE IF NOT EXISTS user_push_tokens (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            expo_push_token VARCHAR(255) NOT NULL UNIQUE,
            platform VARCHAR(20) DEFAULT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_user_id (user_id),
            INDEX idx_is_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ";
    $conn->query($sql);
}

function ensureUserLeaguePrefsNotificationsColumn() {
    $conn = getDbConnection();
    $check = $conn->query("SHOW COLUMNS FROM user_league_prefs LIKE 'notifications_enabled'");
    if ($check && $check->num_rows > 0) {
        return;
    }
    $conn->query("ALTER TABLE user_league_prefs ADD COLUMN notifications_enabled TINYINT(1) NOT NULL DEFAULT 1");
}

function ensureOfficialCompetitionsTables() {
    $conn = getDbConnection();
    $sqlCompetitions = "
        CREATE TABLE IF NOT EXISTS official_competitions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(120) NOT NULL,
            official_league_id INT NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_comp_name_league (name, official_league_id),
            INDEX idx_official_league (official_league_id),
            INDEX idx_is_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ";
    $conn->query($sqlCompetitions);

    $sqlMatches = "
        CREATE TABLE IF NOT EXISTS official_matches (
            id INT AUTO_INCREMENT PRIMARY KEY,
            competition_id INT NOT NULL,
            home_team_id INT NOT NULL,
            away_team_id INT NOT NULL,
            kickoff_at DATETIME NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
            notes VARCHAR(255) DEFAULT NULL,
            created_by INT DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_competition (competition_id),
            INDEX idx_kickoff (kickoff_at),
            INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ";
    $conn->query($sqlMatches);
}

function ensureOfficialGroupsMatchVisibilityColumn() {
    $conn = getDbConnection();
    $check = $conn->query("SHOW COLUMNS FROM official_league_groups LIKE 'is_match_competition_enabled'");
    if ($check && $check->num_rows > 0) {
        return;
    }
    $conn->query("ALTER TABLE official_league_groups ADD COLUMN is_match_competition_enabled TINYINT(1) NOT NULL DEFAULT 1");
}

function ensureOfficialMatchDetailOptionsSchema() {
    $conn = getDbConnection();
    $tables = [
        'official_match_venues' => 'Luogo',
        'official_match_referees' => 'Arbitro',
        'official_match_stages' => 'Tipologia',
    ];
    foreach ($tables as $table => $label) {
        $sql = "
            CREATE TABLE IF NOT EXISTS $table (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(160) NOT NULL,
                created_by INT DEFAULT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_name (name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        ";
        $conn->query($sql);
    }
}

function ensureOfficialStandingsTieOverridesSchema() {
    $conn = getDbConnection();
    $sql = "
        CREATE TABLE IF NOT EXISTS official_standings_tie_overrides (
            id INT AUTO_INCREMENT PRIMARY KEY,
            league_id INT NOT NULL,
            points_value INT NOT NULL,
            team_id INT NOT NULL,
            rank_order INT NOT NULL,
            created_by INT DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_league_points_team (league_id, points_value, team_id),
            INDEX idx_league_points_order (league_id, points_value, rank_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ";
    $conn->query($sql);
}

function computeOfficialLeagueStandings($leagueId, $asOfDateTime = null, $competitionId = null) {
    $conn = getDbConnection();
    ensureTeamsLogoColumn();
    $asOf = $asOfDateTime ?: date('Y-m-d H:i:s');
    $competitionFilter = $competitionId !== null ? (int)$competitionId : 0;
    $stageGironi = 'Gironi';

    // PG: partite Gironi con kickoff già trascorso (risultato non obbligatorio).
    // Punti e DR: goal fatti − subiti = stessa logica della diretta (goal + autogol avversario a favore; autogol proprio a favore avversario).
    // Se per la partita esiste almeno una riga in official_match_events, si usano gli aggregati da lì; altrimenti le colonne su official_matches.
    $sql = "
        SELECT
            t.id AS team_id,
            t.name AS team_name,
            t.logo_path AS team_logo_path,
            COALESCE(SUM(CASE WHEN m.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS played,
            COALESCE(SUM(
                CASE
                    WHEN m.id IS NULL THEN 0
                    WHEN IF(evs.match_id IS NOT NULL, evs.ev_home, m.home_score) IS NULL
                        OR IF(evs.match_id IS NOT NULL, evs.ev_away, m.away_score) IS NULL THEN 0
                    WHEN m.home_team_id = t.id THEN IF(evs.match_id IS NOT NULL, evs.ev_home, m.home_score) - IF(evs.match_id IS NOT NULL, evs.ev_away, m.away_score)
                    WHEN m.away_team_id = t.id THEN IF(evs.match_id IS NOT NULL, evs.ev_away, m.away_score) - IF(evs.match_id IS NOT NULL, evs.ev_home, m.home_score)
                    ELSE 0
                END
            ), 0) AS goal_diff,
            COALESCE(SUM(
                CASE
                    WHEN m.id IS NULL THEN 0
                    WHEN IF(evs.match_id IS NOT NULL, evs.ev_home, m.home_score) IS NULL
                        OR IF(evs.match_id IS NOT NULL, evs.ev_away, m.away_score) IS NULL THEN 0
                    WHEN m.home_team_id = t.id AND IF(evs.match_id IS NOT NULL, evs.ev_home, m.home_score) > IF(evs.match_id IS NOT NULL, evs.ev_away, m.away_score) THEN 3
                    WHEN m.away_team_id = t.id AND IF(evs.match_id IS NOT NULL, evs.ev_away, m.away_score) > IF(evs.match_id IS NOT NULL, evs.ev_home, m.home_score) THEN 3
                    WHEN IF(evs.match_id IS NOT NULL, evs.ev_home, m.home_score) = IF(evs.match_id IS NOT NULL, evs.ev_away, m.away_score) THEN 1
                    ELSE 0
                END
            ), 0) AS points
        FROM teams t
        INNER JOIN leagues l ON l.id = t.league_id
        LEFT JOIN official_matches m
            ON (m.home_team_id = t.id OR m.away_team_id = t.id)
            AND m.match_stage = ?
            AND m.kickoff_at < ?
            AND (? = 0 OR m.competition_id = ?)
        LEFT JOIN (
            SELECT match_id,
                SUM(CASE
                    WHEN event_type = 'goal' AND team_side = 'home' THEN 1
                    WHEN event_type = 'own_goal' AND team_side = 'away' THEN 1
                    ELSE 0 END) AS ev_home,
                SUM(CASE
                    WHEN event_type = 'goal' AND team_side = 'away' THEN 1
                    WHEN event_type = 'own_goal' AND team_side = 'home' THEN 1
                    ELSE 0 END) AS ev_away
            FROM official_match_events
            GROUP BY match_id
        ) evs ON evs.match_id = m.id
        WHERE t.league_id = ? AND l.is_official = 1
        GROUP BY t.id, t.name, t.logo_path
    ";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param("ssiii", $stageGironi, $asOf, $competitionFilter, $competitionFilter, $leagueId);
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    ensureOfficialStandingsTieOverridesSchema();
    $stmt = $conn->prepare("
        SELECT league_id, points_value, team_id, rank_order
        FROM official_standings_tie_overrides
        WHERE league_id = ?
    ");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $overrideRows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    $overridesByPoints = [];
    foreach ($overrideRows as $orow) {
        $p = (int)$orow['points_value'];
        if (!isset($overridesByPoints[$p])) $overridesByPoints[$p] = [];
        $overridesByPoints[$p][] = [
            'team_id' => (int)$orow['team_id'],
            'rank_order' => (int)$orow['rank_order'],
        ];
    }

    $grouped = [];
    foreach ($rows as $r) {
        $p = (int)$r['points'];
        if (!isset($grouped[$p])) $grouped[$p] = [];
        $grouped[$p][] = $r;
    }
    krsort($grouped, SORT_NUMERIC);

    $sorted = [];
    foreach ($grouped as $points => $teamsAtPoints) {
        usort($teamsAtPoints, function($a, $b) {
            $g = (int)$b['goal_diff'] <=> (int)$a['goal_diff'];
            if ($g !== 0) return $g;
            return strcmp((string)$a['team_name'], (string)$b['team_name']);
        });

        if (count($teamsAtPoints) > 1 && isset($overridesByPoints[(int)$points])) {
            $ov = $overridesByPoints[(int)$points];
            $currentIds = array_map(function($x) { return (int)$x['team_id']; }, $teamsAtPoints);
            sort($currentIds);
            $ovIds = array_map(function($x) { return (int)$x['team_id']; }, $ov);
            sort($ovIds);
            // Override valido solo quando combacia esattamente lo stesso gruppo in pari punti.
            if ($currentIds === $ovIds) {
                $rankMap = [];
                foreach ($ov as $x) $rankMap[(int)$x['team_id']] = (int)$x['rank_order'];
                usort($teamsAtPoints, function($a, $b) use ($rankMap) {
                    $ra = $rankMap[(int)$a['team_id']] ?? 9999;
                    $rb = $rankMap[(int)$b['team_id']] ?? 9999;
                    if ($ra !== $rb) return $ra <=> $rb;
                    $g = (int)$b['goal_diff'] <=> (int)$a['goal_diff'];
                    if ($g !== 0) return $g;
                    return strcmp((string)$a['team_name'], (string)$b['team_name']);
                });
            }
        }

        foreach ($teamsAtPoints as $t) $sorted[] = $t;
    }

    $pos = 1;
    $out = [];
    foreach ($sorted as $r) {
        $tlpRaw = normalizeTeamLogoPathForApi($r['team_logo_path'] ?? '');
        $tlpPath = null;
        $tlpUrl = null;
        if ($tlpRaw !== null) {
            if (preg_match('#^https?://#i', $tlpRaw)) {
                $tlpUrl = $tlpRaw;
            } else {
                $tlpPath = $tlpRaw;
                $tlpUrl = publicUrlForStoragePath($tlpRaw);
            }
        }
        $out[] = [
            'position' => $pos++,
            'team_id' => (int)$r['team_id'],
            'team_name_display' => $r['team_name'],
            'team_logo_path' => $tlpPath,
            'team_logo_url' => $tlpUrl,
            'played' => (int)$r['played'],
            'goal_diff' => (int)$r['goal_diff'],
            'points' => (int)$r['points'],
        ];
    }
    return $out;
}

function normalizeTeamNameForFavorite($name) {
    $s = trim((string)$name);
    $s = preg_replace('/\s+/', ' ', $s);
    $s = mb_strtolower($s, 'UTF-8');
    return $s;
}

function ensureOfficialFavoritesTables() {
    $conn = getDbConnection();
    $sqlTeamFav = "
        CREATE TABLE IF NOT EXISTS user_official_team_favorites (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            official_group_id INT NOT NULL,
            team_name_norm VARCHAR(180) NOT NULL,
            team_name_display VARCHAR(180) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_user_group_team (user_id, official_group_id, team_name_norm),
            INDEX idx_user_group (user_id, official_group_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ";
    $conn->query($sqlTeamFav);

    $sqlMatchFav = "
        CREATE TABLE IF NOT EXISTS user_official_match_favorites (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            match_id INT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_user_match (user_id, match_id),
            INDEX idx_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ";
    $conn->query($sqlMatchFav);

    // is_heart = stellina preferiti (stesso concetto ovunque). notifications_enabled = solo push partite di quella squadra.
    foreach ([
        'is_heart' => 'TINYINT(1) NOT NULL DEFAULT 0',
        'notifications_enabled' => 'TINYINT(1) NOT NULL DEFAULT 0',
    ] as $colName => $colDef) {
        $chk = $conn->query("SHOW COLUMNS FROM user_official_team_favorites LIKE '$colName'");
        if ($chk && $chk->num_rows === 0) {
            $conn->query("ALTER TABLE user_official_team_favorites ADD COLUMN $colName $colDef");
            if ($colName === 'notifications_enabled') {
                // Righe pre-esistenti erano "squadra preferita" unica: equivalgono a stellina + notifiche attive
                $conn->query('UPDATE user_official_team_favorites SET notifications_enabled = 1, is_heart = 1');
            }
        }
    }
}

function ensureOfficialMatchDetailSchema() {
    $conn = getDbConnection();

    // Estensioni tabella partite ufficiali
    $columns = [
        "venue VARCHAR(160) NULL",
        "referee VARCHAR(120) NULL",
        "match_stage VARCHAR(40) NULL",
        "home_score TINYINT NULL",
        "away_score TINYINT NULL",
    ];
    foreach ($columns as $col) {
        $name = explode(' ', $col)[0];
        $check = $conn->query("SHOW COLUMNS FROM official_matches LIKE '$name'");
        if ($check && $check->num_rows === 0) {
            $conn->query("ALTER TABLE official_matches ADD COLUMN $col");
        }
    }

    $sqlStandings = "
        CREATE TABLE IF NOT EXISTS official_group_standings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            official_group_id INT NOT NULL,
            team_name_norm VARCHAR(180) NOT NULL,
            team_name_display VARCHAR(180) NOT NULL,
            position INT NOT NULL,
            played INT NOT NULL DEFAULT 0,
            goal_diff INT NOT NULL DEFAULT 0,
            points INT NOT NULL DEFAULT 0,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_group_team (official_group_id, team_name_norm),
            INDEX idx_group_position (official_group_id, position)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ";
    $conn->query($sqlStandings);

    $sqlEvents = "
        CREATE TABLE IF NOT EXISTS official_match_events (
            id INT AUTO_INCREMENT PRIMARY KEY,
            match_id INT NOT NULL,
            event_type VARCHAR(40) NOT NULL,
            minute INT DEFAULT NULL,
            team_side VARCHAR(10) DEFAULT NULL,
            title VARCHAR(180) NOT NULL,
            payload_json TEXT DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_event_match (match_id),
            INDEX idx_event_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ";
    $conn->query($sqlEvents);

    $sqlNotif = "
        CREATE TABLE IF NOT EXISTS user_official_match_notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            match_id INT NOT NULL,
            enabled TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_user_match_notif (user_id, match_id),
            INDEX idx_match_notif (match_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ";
    $conn->query($sqlNotif);

    $sqlSent = "
        CREATE TABLE IF NOT EXISTS user_official_match_event_sent (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            match_event_id INT NOT NULL,
            sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_user_event_sent (user_id, match_event_id),
            INDEX idx_event_sent (match_event_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ";
    $conn->query($sqlSent);

    ensureOfficialMatchTimingColumns();
}

/** Durata tempi regolamentari, supplementari e rigori (partite ufficiali + preset per tipologia). */
function ensureOfficialMatchTimingColumns() {
    $conn = getDbConnection();
    $matchCols = [
        'regulation_half_minutes' => 'INT NOT NULL DEFAULT 30',
        'extra_time_enabled' => 'TINYINT(1) NOT NULL DEFAULT 0',
        'extra_first_half_minutes' => 'INT NOT NULL DEFAULT 0',
        'extra_second_half_minutes' => 'INT NOT NULL DEFAULT 0',
        'penalties_enabled' => 'TINYINT(1) NOT NULL DEFAULT 0',
    ];
    foreach ($matchCols as $name => $def) {
        $check = $conn->query("SHOW COLUMNS FROM official_matches LIKE '$name'");
        if ($check && $check->num_rows === 0) {
            $conn->query("ALTER TABLE official_matches ADD COLUMN $name $def");
        }
    }
    $stageCols = [
        'default_regulation_half_minutes' => 'INT NOT NULL DEFAULT 30',
        'default_extra_time_enabled' => 'TINYINT(1) NOT NULL DEFAULT 0',
        'default_extra_first_half_minutes' => 'INT NOT NULL DEFAULT 0',
        'default_extra_second_half_minutes' => 'INT NOT NULL DEFAULT 0',
        'default_penalties_enabled' => 'TINYINT(1) NOT NULL DEFAULT 0',
    ];
    foreach ($stageCols as $name => $def) {
        $check = $conn->query("SHOW COLUMNS FROM official_match_stages LIKE '$name'");
        if ($check && $check->num_rows === 0) {
            $conn->query("ALTER TABLE official_match_stages ADD COLUMN $name $def");
        }
    }
}

/**
 * @return array{0:int,1:int,2:int,3:int,4:int} half_min, et_on, ex1, ex2, pen_on
 */
function parseOfficialMatchTimingFromPayload($data) {
    $half = isset($data['regulation_half_minutes']) ? (int)$data['regulation_half_minutes'] : 30;
    if ($half < 15 || $half > 60) {
        $half = 30;
    }
    $et = isset($data['extra_time_enabled']) && (int)$data['extra_time_enabled'] ? 1 : 0;
    $ex1 = 0;
    $ex2 = 0;
    if ($et) {
        $ex1 = isset($data['extra_first_half_minutes']) ? (int)$data['extra_first_half_minutes'] : 15;
        $ex2 = isset($data['extra_second_half_minutes']) ? (int)$data['extra_second_half_minutes'] : 15;
        if ($ex1 < 1 || $ex1 > 45) {
            $ex1 = 15;
        }
        if ($ex2 < 1 || $ex2 > 45) {
            $ex2 = 15;
        }
    }
    $pen = isset($data['penalties_enabled']) && (int)$data['penalties_enabled'] ? 1 : 0;
    return [$half, $et, $ex1, $ex2, $pen];
}

function officialMatchTimingRowForApi($row) {
    $et = isset($row['extra_time_enabled']) ? (int)$row['extra_time_enabled'] : 0;
    return [
        'regulation_half_minutes' => isset($row['regulation_half_minutes']) ? (int)$row['regulation_half_minutes'] : 30,
        'extra_time_enabled' => $et,
        'extra_first_half_minutes' => $et ? (int)($row['extra_first_half_minutes'] ?? 0) : null,
        'extra_second_half_minutes' => $et ? (int)($row['extra_second_half_minutes'] ?? 0) : null,
        'penalties_enabled' => isset($row['penalties_enabled']) ? (int)$row['penalties_enabled'] : 0,
    ];
}

function parseOfficialStageDefaultsFromPayload($data) {
    $half = isset($data['default_regulation_half_minutes']) ? (int)$data['default_regulation_half_minutes'] : 30;
    if ($half < 15 || $half > 60) {
        $half = 30;
    }
    $et = isset($data['default_extra_time_enabled']) && (int)$data['default_extra_time_enabled'] ? 1 : 0;
    $ex1 = 0;
    $ex2 = 0;
    if ($et) {
        $ex1 = isset($data['default_extra_first_half_minutes']) ? (int)$data['default_extra_first_half_minutes'] : 15;
        $ex2 = isset($data['default_extra_second_half_minutes']) ? (int)$data['default_extra_second_half_minutes'] : 15;
        if ($ex1 < 1 || $ex1 > 45) {
            $ex1 = 15;
        }
        if ($ex2 < 1 || $ex2 > 45) {
            $ex2 = 15;
        }
    }
    $pen = isset($data['default_penalties_enabled']) && (int)$data['default_penalties_enabled'] ? 1 : 0;
    return [$half, $et, $ex1, $ex2, $pen];
}

function officialStageDefaultsForApi($row) {
    $et = isset($row['default_extra_time_enabled']) ? (int)$row['default_extra_time_enabled'] : 0;
    return [
        'default_regulation_half_minutes' => isset($row['default_regulation_half_minutes']) ? (int)$row['default_regulation_half_minutes'] : 30,
        'default_extra_time_enabled' => $et,
        'default_extra_first_half_minutes' => $et ? (int)($row['default_extra_first_half_minutes'] ?? 0) : null,
        'default_extra_second_half_minutes' => $et ? (int)($row['default_extra_second_half_minutes'] ?? 0) : null,
        'default_penalties_enabled' => isset($row['default_penalties_enabled']) ? (int)$row['default_penalties_enabled'] : 0,
    ];
}

function ensurePlayersShirtNumberColumn() {
    $conn = getDbConnection();
    $check = $conn->query("SHOW COLUMNS FROM players LIKE 'shirt_number'");
    if ($check && $check->num_rows > 0) {
        return;
    }
    $conn->query("ALTER TABLE players ADD COLUMN shirt_number INT NULL");
}

function ensureTeamsLogoColumn() {
    $conn = getDbConnection();
    $check = $conn->query("SHOW COLUMNS FROM teams LIKE 'logo_path'");
    if ($check && $check->num_rows > 0) {
        return;
    }
    $conn->query("ALTER TABLE teams ADD COLUMN logo_path VARCHAR(255) NULL");
}

function ensureTeamsJerseyColorColumn() {
    $conn = getDbConnection();
    $check = $conn->query("SHOW COLUMNS FROM teams LIKE 'jersey_color'");
    if ($check && $check->num_rows > 0) {
        return;
    }
    $conn->query("ALTER TABLE teams ADD COLUMN jersey_color VARCHAR(16) NULL");
}

/**
 * Normalizza colore maglia (#RGB / #RRGGBB). Ritorna null se vuoto o non valido.
 */
function normalizeJerseyColorForApi($raw) {
    $s = strtoupper(trim((string)$raw));
    if ($s === '') {
        return null;
    }
    if ($s[0] !== '#') {
        $s = '#' . $s;
    }
    if (preg_match('/^#([0-9A-F]{3})$/', $s, $m)) {
        $h = $m[1];
        $s = '#' . $h[0] . $h[0] . $h[1] . $h[1] . $h[2] . $h[2];
    }
    if (preg_match('/^#([0-9A-F]{6})$/', $s, $m)) {
        return '#' . strtolower($m[1]);
    }
    return null;
}

/**
 * Fallback colore maglia su altra riga teams stesso nome / stesso gruppo ufficiale (come logo).
 */
function sqlExprOfficialTeamJerseyColorCoalesced($teamTableAlias, $groupAlias = 'og') {
    $t = preg_replace('/[^a-z0-9_]/i', '', (string)$teamTableAlias);
    $g = preg_replace('/[^a-z0-9_]/i', '', (string)$groupAlias);
    if ($t === '') {
        $t = 'ht';
    }
    if ($g === '') {
        $g = 'og';
    }
    return "COALESCE(NULLIF(TRIM({$t}.jersey_color), ''), (SELECT t2.jersey_color FROM teams t2 INNER JOIN leagues l2 ON l2.id = t2.league_id WHERE l2.official_group_id = {$g}.id AND l2.is_official = 1 AND t2.name <=> {$t}.name AND NULLIF(TRIM(t2.jersey_color), '') IS NOT NULL ORDER BY (t2.id = {$t}.id) DESC, t2.id DESC LIMIT 1))";
}

/**
 * Espressione SQL: logo del team della partita (ht/at) con fallback su altra riga teams
 * con lo stesso nome in leghe ufficiali dello stesso official_league_groups.
 * Così Partite mostrano uploads/official_team_logos/… anche se home_team_id punta a una
 * lega senza logo e il file è stato caricato sulla lega sorgente collegata (gestione squadre).
 */
function sqlExprOfficialTeamLogoPathCoalesced($teamTableAlias, $groupAlias = 'og') {
    $t = preg_replace('/[^a-z0-9_]/i', '', (string)$teamTableAlias);
    $g = preg_replace('/[^a-z0-9_]/i', '', (string)$groupAlias);
    if ($t === '') {
        $t = 'ht';
    }
    if ($g === '') {
        $g = 'og';
    }
    return "COALESCE(NULLIF(TRIM({$t}.logo_path), ''), (SELECT t2.logo_path FROM teams t2 INNER JOIN leagues l2 ON l2.id = t2.league_id WHERE l2.official_group_id = {$g}.id AND l2.is_official = 1 AND t2.name <=> {$t}.name AND NULLIF(TRIM(t2.logo_path), '') IS NOT NULL ORDER BY (t2.id = {$t}.id) DESC, t2.id DESC LIMIT 1))";
}

/** Path DB utilizzabile per logo squadra (esclude placeholder tipo default_1) */
function normalizeTeamLogoPathForApi($raw) {
    $p = trim((string)$raw);
    if ($p === '') {
        return null;
    }
    if (preg_match('/^default_/i', $p)) {
        return null;
    }
    return $p;
}

/** URL pubblico per file salvati sotto __DIR__ (es. uploads/…), stesso parent dell’URL di api.php */
function publicUrlForStoragePath($relativePath) {
    if ($relativePath === null) {
        return null;
    }
    $relativePath = trim((string)$relativePath);
    if ($relativePath === '') {
        return null;
    }
    if (preg_match('#^https?://#i', $relativePath)) {
        return $relativePath;
    }
    $relativePath = ltrim($relativePath, '/');
    $origin = defined('CORS_ALLOWED_ORIGIN') ? rtrim((string)CORS_ALLOWED_ORIGIN, '/') : '';
    if ($origin === '') {
        $origin = 'https://fantacoppa.altervista.org';
    }
    $base = $origin;
    if (defined('PUBLIC_SITE_BASE_PATH') && trim((string)PUBLIC_SITE_BASE_PATH, '/') !== '') {
        $seg = trim((string)PUBLIC_SITE_BASE_PATH, '/');
        $base = $origin . '/' . $seg;
    } else {
        $script = isset($_SERVER['SCRIPT_NAME']) ? (string)$_SERVER['SCRIPT_NAME'] : '';
        $parent = str_replace('\\', '/', dirname($script));
        if ($parent !== '/' && $parent !== '' && $parent !== '.') {
            $base = $origin . rtrim($parent, '/');
        }
    }
    return $base . '/' . $relativePath;
}

function getSuperuserLevel($userId) {
    $conn = getDbConnection();
    $stmt = $conn->prepare("SELECT is_superuser FROM users WHERE id = ? LIMIT 1");
    $stmt->bind_param("i", $userId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return $row ? (int)$row['is_superuser'] : 0;
}

function registerUserPushToken($userId, $expoPushToken, $platform = null) {
    ensurePushTokensTable();
    $conn = getDbConnection();
    $platformDb = ($platform !== null && $platform !== '') ? $platform : '';
    $stmt = $conn->prepare("
        INSERT INTO user_push_tokens (user_id, expo_push_token, platform, is_active, last_seen_at)
        VALUES (?, ?, ?, 1, NOW())
        ON DUPLICATE KEY UPDATE
            user_id = VALUES(user_id),
            platform = VALUES(platform),
            is_active = 1,
            last_seen_at = NOW(),
            updated_at = NOW()
    ");
    $stmt->bind_param("iss", $userId, $expoPushToken, $platformDb);
    $stmt->execute();
    $stmt->close();
}

function logPushDebug($message) {
    $line = '[' . date('c') . '] ' . $message . PHP_EOL;
    $path = __DIR__ . '/push_debug.log';
    @file_put_contents($path, $line, FILE_APPEND | LOCK_EX);
}

function getCronRequestKey($pathParts = []) {
    // Primary source: query string (?key=...)
    $key = isset($_GET['key']) ? trim((string)$_GET['key']) : '';
    if ($key !== '') {
        return $key;
    }

    // Some cron providers can pass custom headers.
    $headerKey = getRequestHeader('X-Cron-Key');
    if ($headerKey !== null && trim((string)$headerKey) !== '') {
        return trim((string)$headerKey);
    }

    // Fallback: /cron/endpoint/<key>
    if (isset($pathParts[2]) && trim((string)$pathParts[2]) !== '') {
        return trim((string)$pathParts[2]);
    }

    return '';
}

function postJsonViaStream($url, $payload) {
    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\nAccept: application/json\r\nAccept-Encoding: gzip, deflate\r\n",
            'content' => $payload,
            'timeout' => 3,
            'ignore_errors' => true,
        ],
    ]);
    $result = @file_get_contents($url, false, $context);
    $headers = isset($http_response_header) ? $http_response_header : [];
    return [$result, $headers];
}

function sendExpoPushMessages($messages) {
    if (empty($messages)) return;

    $chunks = array_chunk($messages, 100);
    foreach ($chunks as $chunk) {
        $payload = json_encode($chunk);
        $ch = curl_init('https://exp.host/--/api/v2/push/send');
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Accept: application/json',
            'Accept-Encoding: gzip, deflate',
            'Content-Type: application/json',
        ]);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        // Keep request under shared-hosting cron limits.
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);
        curl_setopt($ch, CURLOPT_TIMEOUT, 3);
        $res = curl_exec($ch);
        $curlErr = curl_error($ch);

        if ($curlErr) {
            error_log("Expo push curl error: " . $curlErr);
            logPushDebug("Expo push curl error: " . $curlErr);
            // Alcuni hosting shared bloccano CONNECT su cURL (403 tunnel).
            // Fallback via stream HTTP nativo PHP.
            list($streamRes, $streamHeaders) = postJsonViaStream('https://exp.host/--/api/v2/push/send', $payload);
            if ($streamRes !== false && $streamRes !== null && $streamRes !== '') {
                error_log("Expo push response (stream fallback): " . $streamRes);
                logPushDebug("Expo push response (stream fallback): " . $streamRes);
            } else {
                $hdr = !empty($streamHeaders) ? implode(' | ', $streamHeaders) : 'no-response-headers';
                error_log("Expo push stream fallback failed");
                logPushDebug("Expo push stream fallback failed headers=" . $hdr);
            }
            continue;
        }
        if ($res) {
            error_log("Expo push response: " . $res);
            logPushDebug("Expo push response: " . $res);
        }
    }
}

function notifyLeagueMatchdayCalculated($leagueId, $giornata, $leagueName) {
    ensurePushTokensTable();
    ensureUserLeaguePrefsNotificationsColumn();
    $conn = getDbConnection();
    $stmt = $conn->prepare("
        SELECT DISTINCT upt.expo_push_token
        FROM user_push_tokens upt
        JOIN league_members lm ON lm.user_id = upt.user_id
        LEFT JOIN user_league_prefs ulp ON ulp.user_id = lm.user_id AND ulp.league_id = lm.league_id
        WHERE lm.league_id = ?
          AND upt.is_active = 1
          AND COALESCE(ulp.notifications_enabled, 1) = 1
          AND (upt.expo_push_token LIKE 'ExponentPushToken%' OR upt.expo_push_token LIKE 'ExpoPushToken%')
    ");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $res = $stmt->get_result();
    $tokens = [];
    while ($row = $res->fetch_assoc()) {
        $tokens[] = $row['expo_push_token'];
    }
    $stmt->close();

    if (empty($tokens)) {
        logPushDebug("notifyLeagueMatchdayCalculated: nessun token per league_id=$leagueId giornata=$giornata");
        return;
    }
    logPushDebug("notifyLeagueMatchdayCalculated: league_id=$leagueId giornata=$giornata tokens=" . count($tokens));

    $messages = [];
    foreach ($tokens as $token) {
        $messages[] = [
            'to' => $token,
            'title' => 'Giornata calcolata',
            'body' => 'La ' . (int)$giornata . 'ª giornata di ' . $leagueName . ' è stata calcolata.',
            'data' => [
                'type' => 'matchday_calculated',
                'leagueId' => (int)$leagueId,
                'giornata' => (int)$giornata,
            ],
            'sound' => 'default',
            'priority' => 'high',
            'channelId' => 'fantacoppa-reminders',
        ];
    }

    sendExpoPushMessages($messages);
}

function ensureFormationReminderPushSentTable() {
    $conn = getDbConnection();
    $sql = "
        CREATE TABLE IF NOT EXISTS push_formation_reminder_sent (
            user_id INT NOT NULL,
            league_id INT NOT NULL,
            giornata INT NOT NULL,
            sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, league_id, giornata),
            INDEX idx_league_giornata (league_id, giornata)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ";
    $conn->query($sql);
}

/**
 * Invia push Expo "1h prima scadenza formazione" a tutti i membri con token.
 * Chiamare da cron (es. ogni 5–10 min) con GET .../cron/push-formation-reminders?key=SECRET
 * Logica robusta: invia quando il reminder è "dovuto" (deadline-60min <= NOW) e non è stato ancora inviato,
 * purché la deadline non sia ancora passata (niente storico).
 */
function runFormationDeadlinePushReminders() {
    ensurePushTokensTable();
    ensureFormationReminderPushSentTable();
    ensureUserLeaguePrefsNotificationsColumn();
    $conn = getDbConnection();

    $stmt = $conn->query('SELECT DISTINCT league_id FROM league_members');
    if (!$stmt) {
        return 0;
    }
    $leagueRows = $stmt->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    $messages = [];

    $totalWindowMatchdays = 0;
    $skippedAlreadyCalculated = 0;
    $skippedNoTokens = 0;
    $skippedAlreadySent = 0;

    foreach ($leagueRows as $lr) {
        $memberLeagueId = (int)($lr['league_id'] ?? 0);
        if ($memberLeagueId <= 0) {
            continue;
        }

        $effectiveId = getEffectiveLeagueId($memberLeagueId);

        $mdStmt = $conn->prepare("
            SELECT m.giornata, m.deadline
            FROM matchdays m
            WHERE m.league_id = ?
              -- Non storiche: la deadline non deve essere passata.
              AND m.deadline > NOW()
              -- Promemoria dovuto: siamo a 1h dalla deadline (o in ritardo per cron saltato).
              AND DATE_SUB(m.deadline, INTERVAL 60 MINUTE) <= NOW()
        ");
        $mdStmt->bind_param('i', $effectiveId);
        $mdStmt->execute();
        $mdRes = $mdStmt->get_result();
        $matchdays = $mdRes->fetch_all(MYSQLI_ASSOC);
        $mdStmt->close();

        $totalWindowMatchdays += count($matchdays);
        if (empty($matchdays)) {
            continue;
        }

        $lnStmt = $conn->prepare('SELECT name FROM leagues WHERE id = ? LIMIT 1');
        $lnStmt->bind_param('i', $memberLeagueId);
        $lnStmt->execute();
        $lnRow = $lnStmt->get_result()->fetch_assoc();
        $lnStmt->close();
        $leagueName = ($lnRow && !empty($lnRow['name'])) ? $lnRow['name'] : 'la tua lega';

        foreach ($matchdays as $md) {
            $giornata = (int)$md['giornata'];

            $calcStmt = $conn->prepare('SELECT 1 FROM matchday_results WHERE league_id = ? AND giornata = ? LIMIT 1');
            $calcStmt->bind_param('ii', $memberLeagueId, $giornata);
            $calcStmt->execute();
            $alreadyCalc = $calcStmt->get_result()->fetch_row();
            $calcStmt->close();
            if ($alreadyCalc) {
                $skippedAlreadyCalculated++;
                continue;
            }

            $tokStmt = $conn->prepare("
                SELECT DISTINCT upt.expo_push_token, upt.user_id
                FROM user_push_tokens upt
                INNER JOIN league_members lm ON lm.user_id = upt.user_id AND lm.league_id = ?
                LEFT JOIN user_league_prefs ulp ON ulp.user_id = lm.user_id AND ulp.league_id = lm.league_id
                WHERE upt.is_active = 1
                  AND COALESCE(ulp.notifications_enabled, 1) = 1
                  AND (upt.expo_push_token LIKE 'ExponentPushToken%' OR upt.expo_push_token LIKE 'ExpoPushToken%')
            ");
            $tokStmt->bind_param('i', $memberLeagueId);
            $tokStmt->execute();
            $tokRes = $tokStmt->get_result();
            $tokenCountForMatchday = 0;
            while ($trow = $tokRes->fetch_assoc()) {
                $tokenCountForMatchday++;
                $uid = (int)$trow['user_id'];
                $expoTok = $trow['expo_push_token'];

                $ins = $conn->prepare('INSERT IGNORE INTO push_formation_reminder_sent (user_id, league_id, giornata) VALUES (?, ?, ?)');
                $ins->bind_param('iii', $uid, $memberLeagueId, $giornata);
                $ins->execute();
                if ($ins->affected_rows < 1) {
                    $skippedAlreadySent++;
                    $ins->close();
                    continue;
                }
                $ins->close();

                $messages[] = [
                    'to' => $expoTok,
                    'title' => 'Promemoria formazione',
                    'body' => 'Manca 1 ora alla scadenza della ' . $giornata . 'ª giornata in ' . $leagueName . '.',
                    'data' => [
                        'type' => 'formation_deadline',
                        'leagueId' => $memberLeagueId,
                        'giornata' => $giornata,
                    ],
                    'sound' => 'default',
                    'priority' => 'high',
                    'channelId' => 'fantacoppa-reminders',
                ];
            }
            $tokStmt->close();
            if ($tokenCountForMatchday < 1) {
                $skippedNoTokens++;
            }
        }
    }

    if (!empty($messages)) {
        sendExpoPushMessages($messages);
        logPushDebug('runFormationDeadlinePushReminders: messages=' . count($messages));
    } else {
        logPushDebug(
            'runFormationDeadlinePushReminders: nessun reminder da inviare'
            . ' window_matchdays=' . $totalWindowMatchdays
            . ' skipped_already_calculated=' . $skippedAlreadyCalculated
            . ' skipped_no_tokens=' . $skippedNoTokens
            . ' skipped_already_sent=' . $skippedAlreadySent
        );
    }

    return count($messages);
}

function runMatchEventPushes() {
    ensureOfficialMatchDetailSchema();
    ensureOfficialFavoritesTables();
    ensurePushTokensTable();
    $conn = getDbConnection();

    $events = $conn->query("
        SELECT e.id
        FROM official_match_events e
        WHERE e.event_type IN ('match_start','goal','own_goal','match_end')
        ORDER BY e.id ASC
        LIMIT 200
    ");
    if (!$events) {
        return 0;
    }

    $total = 0;
    while ($row = $events->fetch_assoc()) {
        $total += notifyOfficialMatchSingleEventPush($conn, (int)$row['id']);
    }
    return $total;
}

/** Punteggio da eventi live (goal + autogol), escluso match_end */
function computeOfficialMatchLiveScoreFromDb(mysqli $conn, int $matchId) {
    $home = 0;
    $away = 0;
    $stmt = $conn->prepare("SELECT event_type, team_side FROM official_match_events WHERE match_id = ? AND event_type != 'match_end' ORDER BY minute ASC, id ASC");
    if (!$stmt) {
        return [$home, $away];
    }
    $stmt->bind_param("i", $matchId);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($row = $res->fetch_assoc()) {
        $t = $row['event_type'] ?? '';
        $s = $row['team_side'] ?? '';
        if ($t === 'goal') {
            if ($s === 'home') {
                $home++;
            } elseif ($s === 'away') {
                $away++;
            }
        } elseif ($t === 'own_goal') {
            if ($s === 'home') {
                $away++;
            } elseif ($s === 'away') {
                $home++;
            }
        }
    }
    $stmt->close();
    return [$home, $away];
}

/** Utenti con notifica per singola partita o per squadra (casa/trasferta) con campanella attiva. */
function collectOfficialMatchEventPushTargets(mysqli $conn, int $matchId, int $competitionId, string $homeNorm, string $awayNorm): array {
    $targetsByUser = [];

    $stmt = $conn->prepare("
        SELECT umn.user_id, upt.expo_push_token
        FROM user_official_match_notifications umn
        INNER JOIN user_push_tokens upt ON upt.user_id = umn.user_id AND upt.is_active = 1
        WHERE umn.match_id = ? AND umn.enabled = 1
    ");
    $stmt->bind_param('i', $matchId);
    $stmt->execute();
    $targets = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();
    foreach ($targets as $t) {
        $targetsByUser[(int)$t['user_id']] = $t['expo_push_token'];
    }

    $stmt2 = $conn->prepare("
        SELECT DISTINCT utf.user_id, upt.expo_push_token
        FROM user_official_team_favorites utf
        INNER JOIN user_push_tokens upt ON upt.user_id = utf.user_id AND upt.is_active = 1
        WHERE utf.official_group_id = ? AND utf.notifications_enabled = 1
          AND utf.team_name_norm IN (?, ?)
    ");
    $stmt2->bind_param('iss', $competitionId, $homeNorm, $awayNorm);
    $stmt2->execute();
    $teamTargets = $stmt2->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt2->close();
    foreach ($teamTargets as $t) {
        $u = (int)$t['user_id'];
        if (!isset($targetsByUser[$u])) {
            $targetsByUser[$u] = $t['expo_push_token'];
        }
    }

    return $targetsByUser;
}

/**
 * Titolo e testo push per eventi ufficiali (inizio, gol, autogol, fine).
 * @param array $ev Riga evento + home_team_name, away_team_name, competition_id
 * @return array{title:string,body:string}|null
 */
function buildOfficialMatchEventPushTitleBody(array $ev, mysqli $conn): ?array {
    $type = (string)($ev['event_type'] ?? '');
    $home = (string)($ev['home_team_name'] ?? '');
    $away = (string)($ev['away_team_name'] ?? '');
    $matchId = (int)($ev['match_id'] ?? 0);
    if ($matchId <= 0) {
        return null;
    }

    list($hs, $as) = computeOfficialMatchLiveScoreFromDb($conn, $matchId);
    if ($hs < 0) {
        $hs = 0;
    }
    if ($as < 0) {
        $as = 0;
    }
    $scoreStr = $hs . '-' . $as;

    if ($type === 'match_start') {
        return [
            'title' => 'Inizio partita',
            'body' => $home . ' - ' . $away,
        ];
    }
    if ($type === 'match_end') {
        return [
            'title' => 'Fine partita',
            'body' => $home . ' - ' . $away . ' ' . $scoreStr,
        ];
    }
    if ($type === 'goal' || $type === 'own_goal') {
        $side = (string)($ev['team_side'] ?? '');
        $teamLabel = $side === 'home' ? $home : ($side === 'away' ? $away : '');
        $payload = [];
        if (!empty($ev['payload_json'])) {
            $decoded = json_decode($ev['payload_json'], true);
            if (is_array($decoded)) {
                $payload = $decoded;
            }
        }
        $player = isset($payload['player_name']) ? trim((string)$payload['player_name']) : '';
        if ($player === '' && !empty($ev['title'])) {
            $t = (string)$ev['title'];
            if (preg_match('/^(?:Gol|Autogol)\s*-\s*(.+)$/u', $t, $m)) {
                $player = trim($m[1]);
            }
        }
        $title = $type === 'own_goal' ? 'Autogol' : 'Gol';
        if ($player !== '') {
            $body = $title . ' ' . $teamLabel . ': ' . $player . ' — ' . $scoreStr;
        } else {
            $body = $title . ' ' . $teamLabel . ' — ' . $scoreStr;
        }
        return ['title' => $title, 'body' => $body];
    }

    return null;
}

/**
 * Invia push Expo per un evento (dedup su user_official_match_event_sent).
 * Tipi gestiti: match_start, goal, own_goal, match_end.
 * Chiamare da cron e subito dopo INSERT da superuser 1/2.
 */
function notifyOfficialMatchSingleEventPush(mysqli $conn, int $eventId): int {
    if ($eventId <= 0) {
        return 0;
    }
    ensureOfficialMatchDetailSchema();
    ensureOfficialFavoritesTables();
    ensurePushTokensTable();

    static $allowed = ['match_start' => 1, 'goal' => 1, 'own_goal' => 1, 'match_end' => 1];

    $stmt = $conn->prepare("
        SELECT e.id, e.match_id, m.competition_id, e.event_type, e.minute, e.team_side, e.title, e.payload_json,
               ht.name AS home_team_name, at.name AS away_team_name
        FROM official_match_events e
        INNER JOIN official_matches m ON m.id = e.match_id
        INNER JOIN teams ht ON ht.id = m.home_team_id
        INNER JOIN teams at ON at.id = m.away_team_id
        WHERE e.id = ?
        LIMIT 1
    ");
    $stmt->bind_param('i', $eventId);
    $stmt->execute();
    $ev = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$ev) {
        return 0;
    }
    $type = (string)($ev['event_type'] ?? '');
    if (!isset($allowed[$type])) {
        return 0;
    }

    $tb = buildOfficialMatchEventPushTitleBody($ev, $conn);
    if ($tb === null) {
        return 0;
    }

    $matchId = (int)$ev['match_id'];
    $competitionId = (int)$ev['competition_id'];
    $homeNorm = normalizeTeamNameForFavorite($ev['home_team_name']);
    $awayNorm = normalizeTeamNameForFavorite($ev['away_team_name']);
    $targetsByUser = collectOfficialMatchEventPushTargets($conn, $matchId, $competitionId, $homeNorm, $awayNorm);

    if (empty($targetsByUser)) {
        logPushDebug('notifyOfficialMatchSingleEventPush: nessun destinatario event_id=' . $eventId);
        return 0;
    }

    $messages = [];
    foreach ($targetsByUser as $uid => $pushToken) {
        $ins = $conn->prepare('INSERT IGNORE INTO user_official_match_event_sent (user_id, match_event_id) VALUES (?, ?)');
        $ins->bind_param('ii', $uid, $eventId);
        $ins->execute();
        $inserted = $ins->affected_rows > 0;
        $ins->close();
        if (!$inserted) {
            continue;
        }

        $messages[] = [
            'to' => $pushToken,
            'sound' => 'default',
            'title' => $tb['title'],
            'body' => $tb['body'],
            'channelId' => 'fantacoppa-reminders',
            'priority' => 'high',
            'data' => [
                'type' => 'match_event',
                'match_id' => $matchId,
                'event_id' => $eventId,
            ],
        ];
    }

    if (!empty($messages)) {
        sendExpoPushMessages($messages);
        logPushDebug('notifyOfficialMatchSingleEventPush: event_id=' . $eventId . ' type=' . $type . ' sent=' . count($messages));
    }
    return count($messages);
}

/** Allinea `official_matches.home_score` / `away_score` a goal + autogol negli eventi (come la diretta). */
function syncOfficialMatchRowScoresFromLiveEvents(mysqli $conn, int $matchId) {
    list($hs, $as) = computeOfficialMatchLiveScoreFromDb($conn, $matchId);
    if ($hs < 0) {
        $hs = 0;
    }
    if ($as < 0) {
        $as = 0;
    }
    $stmt = $conn->prepare('UPDATE official_matches SET home_score = ?, away_score = ? WHERE id = ?');
    if (!$stmt) {
        return;
    }
    $stmt->bind_param('iii', $hs, $as, $matchId);
    $stmt->execute();
    $stmt->close();
}

function officialMatchNextEventSortMinute(mysqli $conn, int $matchId) {
    $stmt = $conn->prepare("SELECT MAX(minute) AS mx FROM official_match_events WHERE match_id = ?");
    if (!$stmt) {
        return 1;
    }
    $stmt->bind_param("i", $matchId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    $mx = isset($row['mx']) && $row['mx'] !== null ? (int)$row['mx'] : -1;
    return $mx + 1;
}

/** Ultima fase cronometrata (ordine id), inclusi supplementari, rigori e match_end */
function officialMatchLastPhaseEventType(mysqli $conn, int $matchId): ?string {
    $stmt = $conn->prepare("
        SELECT event_type FROM official_match_events
        WHERE match_id = ? AND event_type IN (
            'match_start','half_time','second_half_start','second_half_end',
            'extra_first_half_start','extra_half_time','extra_second_half_start','extra_second_half_end',
            'penalties_start','match_end'
        )
        ORDER BY id DESC LIMIT 1
    ");
    if (!$stmt) {
        return null;
    }
    $stmt->bind_param("i", $matchId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$row || empty($row['event_type'])) {
        return null;
    }
    return (string)$row['event_type'];
}

/** Minuto di ordinamento per la riga fine partita: dopo tutti gli altri eventi della partita */
function officialMatchEndSortMinuteAfterOthers(mysqli $conn, int $matchId, int $matchEndEventId) {
    $stmt = $conn->prepare("SELECT COALESCE(MAX(minute), -1) AS mx FROM official_match_events WHERE match_id = ? AND id <> ?");
    if (!$stmt) {
        return 0;
    }
    $stmt->bind_param("ii", $matchId, $matchEndEventId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    $mx = isset($row['mx']) && $row['mx'] !== null ? (int)$row['mx'] : -1;
    return $mx + 1;
}

/**
 * Aggiorna l'unica riga match_end (se esiste): punteggio da goal/autogol, titolo, minuto in coda.
 * Elimina eventuali match_end duplicati mantenendo il più vecchio per id.
 */
function refreshOfficialMatchEndScores(mysqli $conn, int $matchId) {
    $stmt = $conn->prepare("SELECT id, payload_json FROM official_match_events WHERE match_id = ? AND event_type = 'match_end' ORDER BY id ASC");
    if (!$stmt) {
        return;
    }
    $stmt->bind_param("i", $matchId);
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();
    if (empty($rows)) {
        return;
    }
    $keepId = (int)$rows[0]['id'];
    if (count($rows) > 1) {
        $del = $conn->prepare("DELETE FROM official_match_events WHERE match_id = ? AND event_type = 'match_end' AND id != ?");
        $del->bind_param("ii", $matchId, $keepId);
        $del->execute();
        $del->close();
    }
    list($hs, $as) = computeOfficialMatchLiveScoreFromDb($conn, $matchId);
    if ($hs < 0) {
        $hs = 0;
    }
    if ($as < 0) {
        $as = 0;
    }
    $payload = [];
    if (!empty($rows[0]['payload_json'])) {
        $decoded = json_decode($rows[0]['payload_json'], true);
        if (is_array($decoded)) {
            $payload = $decoded;
        }
    }
    $payload['home_score'] = $hs;
    $payload['away_score'] = $as;
    $title = 'Fine partita ' . $hs . ' - ' . $as;
    $newMinute = officialMatchEndSortMinuteAfterOthers($conn, $matchId, $keepId);
    $pj = json_encode($payload, JSON_UNESCAPED_UNICODE);
    $up = $conn->prepare("UPDATE official_match_events SET minute = ?, title = ?, payload_json = ? WHERE id = ?");
    $up->bind_param("issi", $newMinute, $title, $pj, $keepId);
    $up->execute();
    $up->close();
    syncOfficialMatchRowScoresFromLiveEvents($conn, $matchId);
}

try {
    $updateRequiredResponse = enforceMinimumAppVersion($path, $pathParts);
    if ($updateRequiredResponse !== null) {
        $response = $updateRequiredResponse;
        $statusCode = 426;
    }
    // Health check
    elseif ($path === '/health' || $path === '/api/health' || (isset($pathParts[0]) && $pathParts[0] === 'health')) {
        $response = [
            'status' => 'OK',
            'message' => 'FantaCoppa API is running',
            'timestamp' => date('c')
        ];
        $statusCode = 200;
    }
    // GET /matches/{id}/detail - Dettaglio partita con tabs (panoramica/formazione/classifica)
    elseif ($method === 'GET' && isset($pathParts[0]) && $pathParts[0] === 'matches' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'detail') {
        ensureOfficialMatchDetailSchema();
        ensureOfficialFavoritesTables();
        ensurePlayersShirtNumberColumn();
        ensureTeamsLogoColumn();
        ensureTeamsJerseyColorColumn();
        $matchId = (int)$pathParts[1];
        $conn = getDbConnection();

        $sqlHomeLogo = sqlExprOfficialTeamLogoPathCoalesced('ht', 'og');
        $sqlAwayLogo = sqlExprOfficialTeamLogoPathCoalesced('at', 'og');
        $sqlHomeJersey = sqlExprOfficialTeamJerseyColorCoalesced('ht', 'og');
        $sqlAwayJersey = sqlExprOfficialTeamJerseyColorCoalesced('at', 'og');
        $stmt = $conn->prepare("
            SELECT m.id, m.competition_id, m.home_team_id, m.away_team_id, m.kickoff_at, m.status,
                   m.venue, m.referee, m.match_stage, m.home_score, m.away_score,
                   m.regulation_half_minutes, m.extra_time_enabled, m.extra_first_half_minutes,
                   m.extra_second_half_minutes, m.penalties_enabled,
                   og.name AS competition_name, ht.name AS home_team_name, at.name AS away_team_name,
                   {$sqlHomeLogo} AS home_team_logo_path, {$sqlAwayLogo} AS away_team_logo_path,
                   {$sqlHomeJersey} AS home_jersey_color_raw, {$sqlAwayJersey} AS away_jersey_color_raw,
                   ht.league_id AS home_league_id, at.league_id AS away_league_id
            FROM official_matches m
            INNER JOIN official_league_groups og ON og.id = m.competition_id
            INNER JOIN teams ht ON ht.id = m.home_team_id
            INNER JOIN teams at ON at.id = m.away_team_id
            WHERE m.id = ?
            LIMIT 1
        ");
        $stmt->bind_param("i", $matchId);
        $stmt->execute();
        $match = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if (!$match) throw new Exception('Partita non trovata');

        $match['home_jersey_color'] = normalizeJerseyColorForApi($match['home_jersey_color_raw'] ?? '');
        $match['away_jersey_color'] = normalizeJerseyColorForApi($match['away_jersey_color_raw'] ?? '');
        unset($match['home_jersey_color_raw'], $match['away_jersey_color_raw']);

        $timingApi = officialMatchTimingRowForApi($match);
        foreach ($timingApi as $k => $v) {
            $match[$k] = $v;
        }

        $hp = normalizeTeamLogoPathForApi($match['home_team_logo_path'] ?? '');
        $ap = normalizeTeamLogoPathForApi($match['away_team_logo_path'] ?? '');
        if ($hp !== null && preg_match('#^https?://#i', $hp)) {
            $match['home_team_logo_path'] = null;
            $match['home_team_logo_url'] = $hp;
        } elseif ($hp !== null) {
            $match['home_team_logo_path'] = $hp;
            $match['home_team_logo_url'] = publicUrlForStoragePath($hp);
        } else {
            $match['home_team_logo_path'] = null;
            $match['home_team_logo_url'] = null;
        }
        if ($ap !== null && preg_match('#^https?://#i', $ap)) {
            $match['away_team_logo_path'] = null;
            $match['away_team_logo_url'] = $ap;
        } elseif ($ap !== null) {
            $match['away_team_logo_path'] = $ap;
            $match['away_team_logo_url'] = publicUrlForStoragePath($ap);
        } else {
            $match['away_team_logo_path'] = null;
            $match['away_team_logo_url'] = null;
        }

        $homeLineup = [];
        $awayLineup = [];
        $stmt = $conn->prepare("
            SELECT id, first_name, last_name, role, shirt_number, rating
            FROM players
            WHERE team_id = ?
            ORDER BY COALESCE(shirt_number, 999), role ASC, last_name ASC, first_name ASC
        ");
        $homeTeamId = (int)$match['home_team_id'];
        $stmt->bind_param("i", $homeTeamId);
        $stmt->execute();
        $homePlayers = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $order = 1;
        foreach ($homePlayers as $p) {
            $displayName = trim(($p['first_name'] ?? '') . ' ' . ($p['last_name'] ?? ''));
            if ($displayName === '') continue;
            $homeLineup[] = [
                'id' => (int)$p['id'],
                'order' => $order++,
                'name' => $displayName,
                'first_name' => isset($p['first_name']) ? trim((string)$p['first_name']) : '',
                'last_name' => isset($p['last_name']) ? trim((string)$p['last_name']) : '',
                'role' => $p['role'] ?? null,
                'shirt_number' => isset($p['shirt_number']) ? (int)$p['shirt_number'] : null,
                'rating' => isset($p['rating']) ? (float)$p['rating'] : null,
            ];
        }
        $stmt->close();

        $stmt = $conn->prepare("
            SELECT id, first_name, last_name, role, shirt_number, rating
            FROM players
            WHERE team_id = ?
            ORDER BY COALESCE(shirt_number, 999), role ASC, last_name ASC, first_name ASC
        ");
        $awayTeamId = (int)$match['away_team_id'];
        $stmt->bind_param("i", $awayTeamId);
        $stmt->execute();
        $awayPlayers = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $order = 1;
        foreach ($awayPlayers as $p) {
            $displayName = trim(($p['first_name'] ?? '') . ' ' . ($p['last_name'] ?? ''));
            if ($displayName === '') continue;
            $awayLineup[] = [
                'id' => (int)$p['id'],
                'order' => $order++,
                'name' => $displayName,
                'first_name' => isset($p['first_name']) ? trim((string)$p['first_name']) : '',
                'last_name' => isset($p['last_name']) ? trim((string)$p['last_name']) : '',
                'role' => $p['role'] ?? null,
                'shirt_number' => isset($p['shirt_number']) ? (int)$p['shirt_number'] : null,
                'rating' => isset($p['rating']) ? (float)$p['rating'] : null,
            ];
        }
        $stmt->close();

        refreshOfficialMatchEndScores($conn, $matchId);
        syncOfficialMatchRowScoresFromLiveEvents($conn, $matchId);

        $stmt = $conn->prepare("
            SELECT id, event_type, minute, team_side, title, payload_json, created_at
            FROM official_match_events
            WHERE match_id = ?
            ORDER BY minute ASC, id ASC
        ");
        $stmt->bind_param("i", $matchId);
        $stmt->execute();
        $eventRows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmt->close();
        $events = [];
        foreach ($eventRows as $er) {
            $payload = null;
            if (!empty($er['payload_json'])) {
                $decodedPayload = json_decode($er['payload_json'], true);
                if (is_array($decodedPayload)) $payload = $decodedPayload;
            }
            $events[] = [
                'id' => (int)$er['id'],
                'event_type' => $er['event_type'],
                'minute' => isset($er['minute']) ? (int)$er['minute'] : null,
                'team_side' => $er['team_side'],
                'title' => $er['title'],
                'payload' => $payload,
                'created_at' => $er['created_at'],
            ];
        }

        $groupId = (int)$match['competition_id'];
        $leagueId = (int)$match['home_league_id'];
        if ($leagueId <= 0 || $leagueId !== (int)$match['away_league_id']) {
            $standings = [];
        } else {
            $standings = computeOfficialLeagueStandings($leagueId, date('Y-m-d H:i:s'), $groupId > 0 ? $groupId : null);
        }

        $isFavoriteMatch = 0;
        $homeTeamFavorite = 0;
        $awayTeamFavorite = 0;
        $notificationsEnabled = 0;
        $token = getAuthToken();
        if ($token) {
            $decoded = verifyJWT($token);
            if ($decoded && isset($decoded['userId'])) {
                $userId = (int)$decoded['userId'];
                $stmt = $conn->prepare("SELECT 1 FROM user_official_match_favorites WHERE user_id = ? AND match_id = ? LIMIT 1");
                $stmt->bind_param("ii", $userId, $matchId);
                $stmt->execute();
                $isFavoriteMatch = $stmt->get_result()->fetch_assoc() ? 1 : 0;
                $stmt->close();

                $homeNorm = normalizeTeamNameForFavorite($match['home_team_name']);
                $awayNorm = normalizeTeamNameForFavorite($match['away_team_name']);
                $stmt = $conn->prepare("SELECT team_name_norm, is_heart, notifications_enabled FROM user_official_team_favorites WHERE user_id = ? AND official_group_id = ? AND team_name_norm IN (?, ?)");
                $stmt->bind_param("iiss", $userId, $groupId, $homeNorm, $awayNorm);
                $stmt->execute();
                $favNames = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
                $stmt->close();
                foreach ($favNames as $fn) {
                    // is_heart = stellina preferiti (stesso significato ovunque); notifiche squadra sono solo notifications_enabled
                    $h = (int)($fn['is_heart'] ?? 0) === 1;
                    if ($fn['team_name_norm'] === $homeNorm && $h) {
                        $homeTeamFavorite = 1;
                    }
                    if ($fn['team_name_norm'] === $awayNorm && $h) {
                        $awayTeamFavorite = 1;
                    }
                }

                $stmt = $conn->prepare("SELECT enabled FROM user_official_match_notifications WHERE user_id = ? AND match_id = ? LIMIT 1");
                $stmt->bind_param("ii", $userId, $matchId);
                $stmt->execute();
                $notifRow = $stmt->get_result()->fetch_assoc();
                $stmt->close();
                $notificationsEnabled = $notifRow ? ((int)$notifRow['enabled'] ? 1 : 0) : 0;
            }
        }

        $response = [
            'match' => $match,
            'lineups' => ['home' => $homeLineup, 'away' => $awayLineup],
            'team_players' => ['home' => $homeLineup, 'away' => $awayLineup],
            'events' => $events,
            'standings' => $standings,
            'favorites' => [
                'match' => $isFavoriteMatch,
                'home_team' => $homeTeamFavorite,
                'away_team' => $awayTeamFavorite
            ],
            'notifications' => ['enabled' => $notificationsEnabled]
        ];
        $statusCode = 200;
    }
    // POST /matches/notifications/toggle - campanella per singola partita
    elseif ($method === 'POST' && isset($pathParts[0]) && $pathParts[0] === 'matches' && isset($pathParts[1]) && $pathParts[1] === 'notifications' && isset($pathParts[2]) && $pathParts[2] === 'toggle') {
        ensureOfficialMatchDetailSchema();
        $token = getAuthToken();
        if (!$token) throw new Exception('Token di autenticazione mancante');
        $decoded = verifyJWT($token);
        if (!$decoded) throw new Exception('Token non valido o scaduto');
        $userId = (int)$decoded['userId'];
        $data = json_decode(file_get_contents('php://input'), true);
        $matchId = isset($data['match_id']) ? (int)$data['match_id'] : 0;
        $enabled = isset($data['enabled']) && (int)$data['enabled'] ? 1 : 0;
        if ($matchId <= 0) throw new Exception('match_id non valido');

        $conn = getDbConnection();
        $stmt = $conn->prepare("
            INSERT INTO user_official_match_notifications (user_id, match_id, enabled)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_at = NOW()
        ");
        $stmt->bind_param("iii", $userId, $matchId, $enabled);
        $stmt->execute();
        $stmt->close();
        $response = ['ok' => true, 'match_id' => $matchId, 'enabled' => $enabled];
        $statusCode = 200;
    }
    // GET /matches/follow-setup — competizioni visibili, elenco squadre e preferenze utente (stellina / notifiche)
    elseif ($method === 'GET' && isset($pathParts[0]) && $pathParts[0] === 'matches' && isset($pathParts[1]) && $pathParts[1] === 'follow-setup') {
        ensureOfficialCompetitionsTables();
        ensureOfficialGroupsMatchVisibilityColumn();
        ensureOfficialFavoritesTables();
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded || !isset($decoded['userId'])) {
            throw new Exception('Token non valido o scaduto');
        }
        $userId = (int)$decoded['userId'];
        $conn = getDbConnection();
        $stmt = $conn->prepare("
            SELECT og.id, og.name
            FROM official_league_groups og
            WHERE og.is_match_competition_enabled = 1
            ORDER BY og.name ASC
        ");
        $stmt->execute();
        $comps = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmt->close();
        $groupIds = [];
        foreach ($comps as $c) {
            $groupIds[] = (int)$c['id'];
        }
        $prefsByGroup = [];
        if (count($groupIds) > 0) {
            $ph = implode(',', array_fill(0, count($groupIds), '?'));
            $types = 'i' . str_repeat('i', count($groupIds));
            $params = array_merge([$userId], $groupIds);
            $stmt = $conn->prepare("
                SELECT official_group_id, team_name_display, team_name_norm, is_heart, notifications_enabled
                FROM user_official_team_favorites
                WHERE user_id = ? AND official_group_id IN ($ph)
            ");
            $stmt->bind_param($types, ...$params);
            $stmt->execute();
            $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
            $stmt->close();
            foreach ($rows as $row) {
                $gid = (int)$row['official_group_id'];
                if (!isset($prefsByGroup[$gid])) {
                    $prefsByGroup[$gid] = [];
                }
                $prefsByGroup[$gid][] = [
                    'team_name' => $row['team_name_display'],
                    'is_heart' => (int)($row['is_heart'] ?? 0) === 1,
                    'notifications_enabled' => (int)($row['notifications_enabled'] ?? 0) === 1,
                ];
            }
        }
        $out = [];
        foreach ($comps as $c) {
            $gid = (int)$c['id'];
            $stmtT = $conn->prepare("
                SELECT DISTINCT t.name AS team_name
                FROM teams t
                INNER JOIN leagues l ON l.id = t.league_id
                WHERE l.official_group_id = ? AND l.is_official = 1
                ORDER BY t.name ASC
            ");
            $stmtT->bind_param('i', $gid);
            $stmtT->execute();
            $trows = $stmtT->get_result()->fetch_all(MYSQLI_ASSOC);
            $stmtT->close();
            $teamNames = [];
            foreach ($trows as $tr) {
                $teamNames[] = $tr['team_name'];
            }
            $heart = [];
            $notify = [];
            foreach ($prefsByGroup[$gid] ?? [] as $p) {
                if (!empty($p['is_heart'])) {
                    $heart[] = $p['team_name'];
                }
                if (!empty($p['notifications_enabled'])) {
                    $notify[] = $p['team_name'];
                }
            }
            $out[] = [
                'id' => $gid,
                'name' => $c['name'],
                'teams' => $teamNames,
                'heart_team_names' => $heart,
                'notify_team_names' => $notify,
            ];
        }
        $response = ['competitions' => $out];
        $statusCode = 200;
    }
    // PUT /matches/follow-preferences — salva stelline preferiti e notifiche per squadra (per competizione)
    elseif ($method === 'PUT' && isset($pathParts[0]) && $pathParts[0] === 'matches' && isset($pathParts[1]) && $pathParts[1] === 'follow-preferences') {
        ensureOfficialCompetitionsTables();
        ensureOfficialGroupsMatchVisibilityColumn();
        ensureOfficialFavoritesTables();
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded || !isset($decoded['userId'])) {
            throw new Exception('Token non valido o scaduto');
        }
        $userId = (int)$decoded['userId'];
        $data = json_decode(file_get_contents('php://input'), true);
        if (!is_array($data) || !isset($data['competitions']) || !is_array($data['competitions'])) {
            throw new Exception('Payload non valido');
        }
        $conn = getDbConnection();
        foreach ($data['competitions'] as $block) {
            $gid = isset($block['official_group_id']) ? (int)$block['official_group_id'] : 0;
            if ($gid <= 0) {
                continue;
            }
            $stmt = $conn->prepare('SELECT id FROM official_league_groups WHERE id = ? AND is_match_competition_enabled = 1 LIMIT 1');
            $stmt->bind_param('i', $gid);
            $stmt->execute();
            if (!$stmt->get_result()->fetch_assoc()) {
                $stmt->close();
                continue;
            }
            $stmt->close();
            $hearts = isset($block['heart_team_names']) && is_array($block['heart_team_names']) ? $block['heart_team_names'] : [];
            $notifies = isset($block['notify_team_names']) && is_array($block['notify_team_names']) ? $block['notify_team_names'] : [];
            $heartSet = [];
            foreach ($hearts as $n) {
                $t = trim((string)$n);
                if ($t !== '') {
                    $heartSet[normalizeTeamNameForFavorite($t)] = $t;
                }
            }
            $notifySet = [];
            foreach ($notifies as $n) {
                $t = trim((string)$n);
                if ($t !== '') {
                    $notifySet[normalizeTeamNameForFavorite($t)] = $t;
                }
            }
            $allNorms = array_unique(array_merge(array_keys($heartSet), array_keys($notifySet)));
            $del = $conn->prepare('DELETE FROM user_official_team_favorites WHERE user_id = ? AND official_group_id = ?');
            $del->bind_param('ii', $userId, $gid);
            $del->execute();
            $del->close();
            $ins = $conn->prepare('
                INSERT INTO user_official_team_favorites (user_id, official_group_id, team_name_norm, team_name_display, is_heart, notifications_enabled)
                VALUES (?, ?, ?, ?, ?, ?)
            ');
            foreach ($allNorms as $norm) {
                $display = $heartSet[$norm] ?? $notifySet[$norm];
                $ih = isset($heartSet[$norm]) ? 1 : 0;
                $ne = isset($notifySet[$norm]) ? 1 : 0;
                $ins->bind_param('iissii', $userId, $gid, $norm, $display, $ih, $ne);
                $ins->execute();
            }
            $ins->close();
        }
        $response = ['ok' => true, 'message' => 'Preferenze salvate'];
        $statusCode = 200;
    }
    // GET /matches?date=YYYY-MM-DD - Partite globali pubbliche
    elseif ($method === 'GET' && (isset($pathParts[0]) && $pathParts[0] === 'matches')) {
        ensureOfficialCompetitionsTables();
        ensureOfficialFavoritesTables();
        ensureTeamsLogoColumn();
        $date = isset($_GET['date']) ? trim((string)$_GET['date']) : date('Y-m-d');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            throw new Exception('Data non valida (usa YYYY-MM-DD)');
        }

        $conn = getDbConnection();
        $sqlHomeLogoList = sqlExprOfficialTeamLogoPathCoalesced('ht', 'og');
        $sqlAwayLogoList = sqlExprOfficialTeamLogoPathCoalesced('at', 'og');
        $stmt = $conn->prepare("
            SELECT
                m.id,
                m.competition_id,
                og.name AS competition_name,
                m.home_team_id,
                ht.name AS home_team_name,
                {$sqlHomeLogoList} AS home_team_logo_path,
                m.away_team_id,
                at.name AS away_team_name,
                {$sqlAwayLogoList} AS away_team_logo_path,
                m.kickoff_at,
                m.status,
                m.notes,
                m.home_score,
                m.away_score,
                m.regulation_half_minutes,
                m.extra_time_enabled,
                m.extra_first_half_minutes,
                m.extra_second_half_minutes,
                m.penalties_enabled
            FROM official_matches m
            INNER JOIN official_league_groups og ON og.id = m.competition_id
            INNER JOIN teams ht ON ht.id = m.home_team_id
            INNER JOIN teams at ON at.id = m.away_team_id
            WHERE DATE(m.kickoff_at) = ?
            ORDER BY og.name ASC, m.kickoff_at ASC
        ");
        $stmt->bind_param("s", $date);
        $stmt->execute();
        $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmt->close();

        foreach ($rows as &$r) {
            $hp = normalizeTeamLogoPathForApi($r['home_team_logo_path'] ?? '');
            $ap = normalizeTeamLogoPathForApi($r['away_team_logo_path'] ?? '');
            if ($hp !== null && preg_match('#^https?://#i', $hp)) {
                $r['home_team_logo_path'] = null;
                $r['home_team_logo_url'] = $hp;
            } elseif ($hp !== null) {
                $r['home_team_logo_path'] = $hp;
                $r['home_team_logo_url'] = publicUrlForStoragePath($hp);
            } else {
                $r['home_team_logo_path'] = null;
                $r['home_team_logo_url'] = null;
            }
            if ($ap !== null && preg_match('#^https?://#i', $ap)) {
                $r['away_team_logo_path'] = null;
                $r['away_team_logo_url'] = $ap;
            } elseif ($ap !== null) {
                $r['away_team_logo_path'] = $ap;
                $r['away_team_logo_url'] = publicUrlForStoragePath($ap);
            } else {
                $r['away_team_logo_path'] = null;
                $r['away_team_logo_url'] = null;
            }
        }
        unset($r);

        $matchIdsForEvents = [];
        foreach ($rows as $r) {
            $matchIdsForEvents[] = (int)$r['id'];
        }
        $matchIdsForEvents = array_values(array_unique(array_filter($matchIdsForEvents)));
        $eventsByMatch = [];
        if (count($matchIdsForEvents) > 0) {
            $phEv = implode(',', array_fill(0, count($matchIdsForEvents), '?'));
            $typesEv = str_repeat('i', count($matchIdsForEvents));
            $evStmt = $conn->prepare("
                SELECT match_id, id, event_type, created_at
                FROM official_match_events
                WHERE match_id IN ($phEv)
                  AND event_type IN (
                    'match_start','half_time','second_half_start','second_half_end',
                    'extra_first_half_start','extra_half_time','extra_second_half_start','extra_second_half_end',
                    'penalties_start','match_end'
                  )
                ORDER BY id ASC
            ");
            $evStmt->bind_param($typesEv, ...$matchIdsForEvents);
            $evStmt->execute();
            $evRows = $evStmt->get_result()->fetch_all(MYSQLI_ASSOC);
            $evStmt->close();
            foreach ($evRows as $er) {
                $midEv = (int)$er['match_id'];
                if (!isset($eventsByMatch[$midEv])) {
                    $eventsByMatch[$midEv] = [];
                }
                $eventsByMatch[$midEv][] = [
                    'id' => (int)$er['id'],
                    'event_type' => $er['event_type'],
                    'created_at' => $er['created_at'],
                ];
            }
        }

        $scoresByMatch = [];
        if (count($matchIdsForEvents) > 0) {
            $phG = implode(',', array_fill(0, count($matchIdsForEvents), '?'));
            $typesG = str_repeat('i', count($matchIdsForEvents));
            $gStmt = $conn->prepare("
                SELECT match_id,
                    SUM(CASE
                        WHEN event_type = 'goal' AND team_side = 'home' THEN 1
                        WHEN event_type = 'own_goal' AND team_side = 'away' THEN 1
                        ELSE 0 END) AS gh,
                    SUM(CASE
                        WHEN event_type = 'goal' AND team_side = 'away' THEN 1
                        WHEN event_type = 'own_goal' AND team_side = 'home' THEN 1
                        ELSE 0 END) AS ga
                FROM official_match_events
                WHERE match_id IN ($phG) AND event_type IN ('goal','own_goal')
                GROUP BY match_id
            ");
            $gStmt->bind_param($typesG, ...$matchIdsForEvents);
            $gStmt->execute();
            $gRows = $gStmt->get_result()->fetch_all(MYSQLI_ASSOC);
            $gStmt->close();
            foreach ($gRows as $gr) {
                $midG = (int)$gr['match_id'];
                $scoresByMatch[$midG] = [
                    (int)$gr['gh'],
                    (int)$gr['ga'],
                ];
            }
        }

        foreach ($rows as &$r) {
            $midEv = (int)$r['id'];
            $r['live_phase_events'] = $eventsByMatch[$midEv] ?? [];
            $r['regulation_half_minutes'] = isset($r['regulation_half_minutes']) ? (int)$r['regulation_half_minutes'] : 30;
            $r['extra_time_enabled'] = isset($r['extra_time_enabled']) ? (int)$r['extra_time_enabled'] : 0;
            $r['extra_first_half_minutes'] = isset($r['extra_first_half_minutes']) ? (int)$r['extra_first_half_minutes'] : 15;
            $r['extra_second_half_minutes'] = isset($r['extra_second_half_minutes']) ? (int)$r['extra_second_half_minutes'] : 15;
            $r['penalties_enabled'] = isset($r['penalties_enabled']) ? (int)$r['penalties_enabled'] : 0;
            if (isset($scoresByMatch[$midEv])) {
                $r['live_home_score'] = $scoresByMatch[$midEv][0];
                $r['live_away_score'] = $scoresByMatch[$midEv][1];
            } else {
                // Stesso criterio del dettaglio/classifica: senza eventi gol in tabella, usa le colonne su official_matches.
                $r['live_home_score'] = isset($r['home_score']) && $r['home_score'] !== null && $r['home_score'] !== '' ? (int)$r['home_score'] : 0;
                $r['live_away_score'] = isset($r['away_score']) && $r['away_score'] !== null && $r['away_score'] !== '' ? (int)$r['away_score'] : 0;
            }
            unset($r['home_score'], $r['away_score']);
        }
        unset($r);

        $userId = 0;
        $token = getAuthToken();
        if ($token) {
            $decoded = verifyJWT($token);
            if ($decoded && isset($decoded['userId'])) {
                $userId = (int)$decoded['userId'];
            }
        }

        if ($userId > 0 && count($rows) > 0) {
            $matchIds = [];
            $groupIds = [];
            foreach ($rows as $r) {
                $matchIds[] = (int)$r['id'];
                $groupIds[] = (int)$r['competition_id'];
            }
            $matchIds = array_values(array_unique($matchIds));
            $groupIds = array_values(array_unique($groupIds));

            $favoriteMatchIds = [];
            if (count($matchIds) > 0) {
                $ph = implode(',', array_fill(0, count($matchIds), '?'));
                $types = "i" . str_repeat("i", count($matchIds));
                $params = [$userId];
                foreach ($matchIds as $mid) $params[] = $mid;
                $sqlFavMatches = "SELECT match_id FROM user_official_match_favorites WHERE user_id = ? AND match_id IN ($ph)";
                $stmt = $conn->prepare($sqlFavMatches);
                $stmt->bind_param($types, ...$params);
                $stmt->execute();
                $favRows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
                $stmt->close();
                foreach ($favRows as $fr) $favoriteMatchIds[(int)$fr['match_id']] = true;
            }

            $favoriteTeamsByGroup = [];
            if (count($groupIds) > 0) {
                $ph2 = implode(',', array_fill(0, count($groupIds), '?'));
                $types2 = "i" . str_repeat("i", count($groupIds));
                $params2 = [$userId];
                foreach ($groupIds as $gid) $params2[] = $gid;
                $sqlFavTeams = "SELECT official_group_id, team_name_norm, is_heart, notifications_enabled FROM user_official_team_favorites WHERE user_id = ? AND official_group_id IN ($ph2)";
                $stmt = $conn->prepare($sqlFavTeams);
                $stmt->bind_param($types2, ...$params2);
                $stmt->execute();
                $favTeamRows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
                $stmt->close();
                foreach ($favTeamRows as $tr) {
                    $gid = (int)$tr['official_group_id'];
                    if (!isset($favoriteTeamsByGroup[$gid])) {
                        $favoriteTeamsByGroup[$gid] = [];
                    }
                    // heart = is_heart (stellina preferiti); notify usato solo per push, non per sezione Preferite
                    $favoriteTeamsByGroup[$gid][$tr['team_name_norm']] = [
                        'heart' => (int)($tr['is_heart'] ?? 0) === 1,
                        'notify' => (int)($tr['notifications_enabled'] ?? 0) === 1,
                    ];
                }
            }

            foreach ($rows as &$r) {
                $mid = (int)$r['id'];
                $gid = (int)$r['competition_id'];
                $homeNorm = normalizeTeamNameForFavorite($r['home_team_name']);
                $awayNorm = normalizeTeamNameForFavorite($r['away_team_name']);
                $homeMeta = ($favoriteTeamsByGroup[$gid] ?? [])[$homeNorm] ?? null;
                $awayMeta = ($favoriteTeamsByGroup[$gid] ?? [])[$awayNorm] ?? null;
                $homeFav = is_array($homeMeta) && ($homeMeta['heart'] ?? false);
                $awayFav = is_array($awayMeta) && ($awayMeta['heart'] ?? false);
                $matchFav = isset($favoriteMatchIds[$mid]);
                $r['is_favorite_match'] = $matchFav ? 1 : 0;
                $r['home_team_favorite'] = $homeFav ? 1 : 0;
                $r['away_team_favorite'] = $awayFav ? 1 : 0;
                $r['is_favorite'] = ($matchFav || $homeFav || $awayFav) ? 1 : 0;
            }
            unset($r);

            usort($rows, function ($a, $b) {
                $fa = (int)$a['is_favorite'];
                $fb = (int)$b['is_favorite'];
                if ($fa !== $fb) return $fb <=> $fa;
                return strcmp((string)$a['kickoff_at'], (string)$b['kickoff_at']);
            });
        }

        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        $response = ['date' => $date, 'matches' => $rows];
        $statusCode = 200;
    }
    // POST /matches/favorites/match - Preferito singolo match
    elseif ($method === 'POST' && isset($pathParts[0]) && $pathParts[0] === 'matches' && isset($pathParts[1]) && $pathParts[1] === 'favorites' && isset($pathParts[2]) && $pathParts[2] === 'match') {
        ensureOfficialFavoritesTables();
        $token = getAuthToken();
        if (!$token) throw new Exception('Token di autenticazione mancante');
        $decoded = verifyJWT($token);
        if (!$decoded) throw new Exception('Token non valido o scaduto');
        $userId = (int)$decoded['userId'];

        $data = json_decode(file_get_contents('php://input'), true);
        $matchId = isset($data['match_id']) ? (int)$data['match_id'] : 0;
        $isFavorite = isset($data['is_favorite']) && (int)$data['is_favorite'] ? 1 : 0;
        if ($matchId <= 0) throw new Exception('match_id non valido');

        $conn = getDbConnection();
        if ($isFavorite) {
            $stmt = $conn->prepare("INSERT INTO user_official_match_favorites (user_id, match_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE match_id = VALUES(match_id)");
            $stmt->bind_param("ii", $userId, $matchId);
            $stmt->execute();
            $stmt->close();
        } else {
            $stmt = $conn->prepare("DELETE FROM user_official_match_favorites WHERE user_id = ? AND match_id = ?");
            $stmt->bind_param("ii", $userId, $matchId);
            $stmt->execute();
            $stmt->close();
        }
        $response = ['ok' => true, 'match_id' => $matchId, 'is_favorite' => $isFavorite];
        $statusCode = 200;
    }
    // POST /matches/favorites/team - Preferito squadra per nome nel gruppo ufficiale
    elseif ($method === 'POST' && isset($pathParts[0]) && $pathParts[0] === 'matches' && isset($pathParts[1]) && $pathParts[1] === 'favorites' && isset($pathParts[2]) && $pathParts[2] === 'team') {
        ensureOfficialFavoritesTables();
        $token = getAuthToken();
        if (!$token) throw new Exception('Token di autenticazione mancante');
        $decoded = verifyJWT($token);
        if (!$decoded) throw new Exception('Token non valido o scaduto');
        $userId = (int)$decoded['userId'];

        $data = json_decode(file_get_contents('php://input'), true);
        $groupId = isset($data['official_group_id']) ? (int)$data['official_group_id'] : 0;
        $teamName = isset($data['team_name']) ? trim((string)$data['team_name']) : '';
        $isFavorite = isset($data['is_favorite']) && (int)$data['is_favorite'] ? 1 : 0;
        if ($groupId <= 0 || $teamName === '') throw new Exception('Dati preferito squadra non validi');

        $teamNameNorm = normalizeTeamNameForFavorite($teamName);
        $conn = getDbConnection();
        if ($isFavorite) {
            ensureOfficialFavoritesTables();
            $stmt = $conn->prepare("
                INSERT INTO user_official_team_favorites (user_id, official_group_id, team_name_norm, team_name_display, is_heart, notifications_enabled)
                VALUES (?, ?, ?, ?, 1, 1)
                ON DUPLICATE KEY UPDATE
                    team_name_display = VALUES(team_name_display),
                    is_heart = 1,
                    notifications_enabled = 1,
                    updated_at = NOW()
            ");
            $stmt->bind_param("iiss", $userId, $groupId, $teamNameNorm, $teamName);
            $stmt->execute();
            $stmt->close();
        } else {
            $stmt = $conn->prepare("DELETE FROM user_official_team_favorites WHERE user_id = ? AND official_group_id = ? AND team_name_norm = ?");
            $stmt->bind_param("iis", $userId, $groupId, $teamNameNorm);
            $stmt->execute();
            $stmt->close();
        }
        $response = ['ok' => true, 'official_group_id' => $groupId, 'team_name' => $teamName, 'is_favorite' => $isFavorite];
        $statusCode = 200;
    }
    // GET /competitions - Competizioni globali (gruppi leghe ufficiali)
    elseif ($method === 'GET' && (isset($pathParts[0]) && $pathParts[0] === 'competitions')) {
        ensureOfficialCompetitionsTables();
        ensureOfficialGroupsMatchVisibilityColumn();
        $conn = getDbConnection();
        $stmt = $conn->prepare("
            SELECT og.id, og.name
            FROM official_league_groups og
            WHERE og.is_match_competition_enabled = 1
            ORDER BY og.name ASC
        ");
        $stmt->execute();
        $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmt->close();
        $response = $rows;
        $statusCode = 200;
    }
    // Admin competitions / matches
    elseif (isset($pathParts[0]) && $pathParts[0] === 'admin' && isset($pathParts[1]) && ($pathParts[1] === 'competitions' || $pathParts[1] === 'matches' || $pathParts[1] === 'match-details')) {
        ensureOfficialCompetitionsTables();
        $token = getAuthToken();
        if (!$token) throw new Exception('Token di autenticazione mancante');
        $decoded = verifyJWT($token);
        if (!$decoded) throw new Exception('Token non valido o scaduto');
        $userId = (int)$decoded['userId'];
        $suLevel = getSuperuserLevel($userId);

        if ($pathParts[1] === 'competitions') {
            if (!in_array($suLevel, [1, 2], true)) {
                throw new Exception('Operazione riservata ai superuser');
            }
            ensureOfficialGroupsMatchVisibilityColumn();
            $conn = getDbConnection();

            if ($method === 'GET') {
                $stmt = $conn->prepare("
                    SELECT
                        og.id,
                        og.name,
                        og.description,
                        og.is_match_competition_enabled,
                        COUNT(l.id) AS official_leagues_count
                    FROM official_league_groups og
                    LEFT JOIN leagues l ON l.official_group_id = og.id AND l.is_official = 1
                    GROUP BY og.id, og.name, og.description, og.is_match_competition_enabled
                    ORDER BY og.name ASC
                ");
                $stmt->execute();
                $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
                $stmt->close();
                $response = $rows;
                $statusCode = 200;
            } elseif ($method === 'PUT' && isset($pathParts[2]) && is_numeric($pathParts[2])) {
                if ($suLevel !== 1) {
                    throw new Exception('Operazione riservata a superuser livello 1');
                }
                $groupId = (int)$pathParts[2];
                $data = json_decode(file_get_contents('php://input'), true);
                $enabled = isset($data['is_match_competition_enabled']) && (int)$data['is_match_competition_enabled'] ? 1 : 0;

                $stmt = $conn->prepare("UPDATE official_league_groups SET is_match_competition_enabled = ? WHERE id = ?");
                $stmt->bind_param("ii", $enabled, $groupId);
                $stmt->execute();
                $stmt->close();

                $response = ['message' => 'Visibilità competizione aggiornata', 'id' => $groupId, 'is_match_competition_enabled' => $enabled];
                $statusCode = 200;
            } else {
                $response = ['error' => 'Metodo non consentito'];
                $statusCode = 405;
            }
        } elseif ($pathParts[1] === 'match-details') {
            if ($suLevel !== 1) {
                throw new Exception('Operazione riservata a superuser livello 1');
            }
            ensureOfficialMatchDetailOptionsSchema();
            ensureOfficialMatchTimingColumns();
            $conn = getDbConnection();

            $allowedMap = [
                'venues' => ['table' => 'official_match_venues', 'label' => 'Luogo'],
                'referees' => ['table' => 'official_match_referees', 'label' => 'Arbitro'],
                'stages' => ['table' => 'official_match_stages', 'label' => 'Tipologia'],
            ];

            if ($method === 'GET') {
                $readAll = function($table) use ($conn) {
                    $stmt = $conn->prepare("SELECT id, name FROM $table ORDER BY name ASC");
                    $stmt->execute();
                    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
                    $stmt->close();
                    return $rows;
                };
                $stmtSt = $conn->prepare("
                    SELECT id, name, default_regulation_half_minutes, default_extra_time_enabled,
                           default_extra_first_half_minutes, default_extra_second_half_minutes, default_penalties_enabled
                    FROM official_match_stages ORDER BY name ASC
                ");
                $stmtSt->execute();
                $stageRows = $stmtSt->get_result()->fetch_all(MYSQLI_ASSOC);
                $stmtSt->close();
                $stagesOut = [];
                foreach ($stageRows as $sr) {
                    $stagesOut[] = array_merge(
                        ['id' => (int)$sr['id'], 'name' => $sr['name']],
                        officialStageDefaultsForApi($sr)
                    );
                }
                $response = [
                    'venues' => $readAll('official_match_venues'),
                    'referees' => $readAll('official_match_referees'),
                    'stages' => $stagesOut,
                ];
                $statusCode = 200;
            } elseif ($method === 'PUT' && isset($pathParts[2]) && $pathParts[2] === 'stages' && isset($pathParts[3]) && is_numeric($pathParts[3])) {
                $stageId = (int)$pathParts[3];
                $data = json_decode(file_get_contents('php://input'), true);
                if (!is_array($data)) {
                    throw new Exception('Payload non valido');
                }
                $stmtName = $conn->prepare("SELECT name FROM official_match_stages WHERE id = ? LIMIT 1");
                $stmtName->bind_param("i", $stageId);
                $stmtName->execute();
                $stageRow = $stmtName->get_result()->fetch_assoc();
                $stmtName->close();
                if (!$stageRow || !isset($stageRow['name'])) {
                    throw new Exception('Tipologia non trovata');
                }
                $stageName = (string)$stageRow['name'];
                list($dh, $det, $dex1, $dex2, $dpen) = parseOfficialStageDefaultsFromPayload($data);
                $stmt = $conn->prepare("
                    UPDATE official_match_stages SET
                        default_regulation_half_minutes = ?,
                        default_extra_time_enabled = ?,
                        default_extra_first_half_minutes = ?,
                        default_extra_second_half_minutes = ?,
                        default_penalties_enabled = ?
                    WHERE id = ?
                ");
                $stmt->bind_param("iiiiii", $dh, $det, $dex1, $dex2, $dpen, $stageId);
                $stmt->execute();
                $stmt->close();
                ensureOfficialMatchTimingColumns();
                $stmtCnt = $conn->prepare("SELECT COUNT(*) AS c FROM official_matches WHERE match_stage = ?");
                $stmtCnt->bind_param("s", $stageName);
                $stmtCnt->execute();
                $cntRow = $stmtCnt->get_result()->fetch_assoc();
                $stmtCnt->close();
                $matchesWithStage = (int)($cntRow['c'] ?? 0);
                $stmtSync = $conn->prepare("
                    UPDATE official_matches SET
                        regulation_half_minutes = ?,
                        extra_time_enabled = ?,
                        extra_first_half_minutes = ?,
                        extra_second_half_minutes = ?,
                        penalties_enabled = ?
                    WHERE match_stage = ?
                ");
                $stmtSync->bind_param("iiiiss", $dh, $det, $dex1, $dex2, $dpen, $stageName);
                $stmtSync->execute();
                $stmtSync->close();
                $response = [
                    'message' => 'Preset tipologia aggiornato; durate allineate sulle partite con questa tipologia',
                    'id' => $stageId,
                    'matches_with_stage' => $matchesWithStage,
                ];
                $statusCode = 200;
            } elseif ($method === 'POST' && isset($pathParts[2]) && isset($allowedMap[$pathParts[2]])) {
                $key = $pathParts[2];
                $table = $allowedMap[$key]['table'];
                $label = $allowedMap[$key]['label'];
                $data = json_decode(file_get_contents('php://input'), true);
                $name = isset($data['name']) ? trim((string)$data['name']) : '';
                if ($name === '') throw new Exception($label . ' non valido');
                if ($key === 'stages') {
                    list($dh, $det, $dex1, $dex2, $dpen) = parseOfficialStageDefaultsFromPayload(is_array($data) ? $data : []);
                    $stmt = $conn->prepare("
                        INSERT INTO official_match_stages (name, created_by, default_regulation_half_minutes, default_extra_time_enabled, default_extra_first_half_minutes, default_extra_second_half_minutes, default_penalties_enabled)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    ");
                    $stmt->bind_param("siiiiii", $name, $userId, $dh, $det, $dex1, $dex2, $dpen);
                } else {
                    $stmt = $conn->prepare("INSERT INTO $table (name, created_by) VALUES (?, ?)");
                    $stmt->bind_param("si", $name, $userId);
                }
                $stmt->execute();
                $newId = $stmt->insert_id;
                $stmt->close();
                $response = ['message' => $label . ' creato', 'id' => $newId, 'name' => $name];
                $statusCode = 201;
            } elseif ($method === 'DELETE' && isset($pathParts[2]) && isset($allowedMap[$pathParts[2]]) && isset($pathParts[3]) && is_numeric($pathParts[3])) {
                $key = $pathParts[2];
                $table = $allowedMap[$key]['table'];
                $label = $allowedMap[$key]['label'];
                $id = (int)$pathParts[3];
                $stmt = $conn->prepare("DELETE FROM $table WHERE id = ?");
                $stmt->bind_param("i", $id);
                $stmt->execute();
                $stmt->close();
                $response = ['message' => $label . ' eliminato'];
                $statusCode = 200;
            } else {
                $response = ['error' => 'Metodo non consentito'];
                $statusCode = 405;
            }
        } elseif ($pathParts[1] === 'matches') {
            if (!in_array($suLevel, [1, 2], true)) {
                throw new Exception('Operazione riservata ai superuser');
            }
            ensureOfficialMatchDetailSchema();
            ensureOfficialMatchDetailOptionsSchema();
            $conn = getDbConnection();

            if ($method === 'PUT' && isset($pathParts[2]) && is_numeric($pathParts[2]) && isset($pathParts[3]) && $pathParts[3] === 'meta') {
                $matchId = (int)$pathParts[2];
                $data = json_decode(file_get_contents('php://input'), true);
                $venue = isset($data['venue']) ? trim((string)$data['venue']) : null;
                $referee = isset($data['referee']) ? trim((string)$data['referee']) : null;
                $stage = isset($data['match_stage']) ? trim((string)$data['match_stage']) : null;
                if ($venue === '') $venue = null;
                if ($referee === '') $referee = null;
                if ($stage === '') $stage = null;
                if ($venue !== null) {
                    $stmt = $conn->prepare("SELECT id FROM official_match_venues WHERE name = ? LIMIT 1");
                    $stmt->bind_param("s", $venue);
                    $stmt->execute();
                    $vrow = $stmt->get_result()->fetch_assoc();
                    $stmt->close();
                    if (!$vrow) throw new Exception('Luogo non presente in elenco');
                }
                if ($referee !== null) {
                    $stmt = $conn->prepare("SELECT id FROM official_match_referees WHERE name = ? LIMIT 1");
                    $stmt->bind_param("s", $referee);
                    $stmt->execute();
                    $rrow = $stmt->get_result()->fetch_assoc();
                    $stmt->close();
                    if (!$rrow) throw new Exception('Arbitro non presente in elenco');
                }
                if ($stage !== null) {
                    $stmt = $conn->prepare("SELECT id FROM official_match_stages WHERE name = ? LIMIT 1");
                    $stmt->bind_param("s", $stage);
                    $stmt->execute();
                    $srow = $stmt->get_result()->fetch_assoc();
                    $stmt->close();
                    if (!$srow) throw new Exception('Tipologia non presente in elenco');
                }
                $homeScore = isset($data['home_score']) && $data['home_score'] !== '' ? (int)$data['home_score'] : null;
                $awayScore = isset($data['away_score']) && $data['away_score'] !== '' ? (int)$data['away_score'] : null;
                $stmt = $conn->prepare("UPDATE official_matches SET venue = ?, referee = ?, match_stage = ?, home_score = ?, away_score = ? WHERE id = ?");
                $stmt->bind_param("sssiii", $venue, $referee, $stage, $homeScore, $awayScore, $matchId);
                $stmt->execute();
                $stmt->close();
                $timingKeys = ['regulation_half_minutes', 'extra_time_enabled', 'extra_first_half_minutes', 'extra_second_half_minutes', 'penalties_enabled'];
                $hasTiming = false;
                foreach ($timingKeys as $tk) {
                    if (array_key_exists($tk, $data)) {
                        $hasTiming = true;
                        break;
                    }
                }
                if ($hasTiming) {
                    list($th, $te, $tx1, $tx2, $tp) = parseOfficialMatchTimingFromPayload($data);
                    $stmtT = $conn->prepare("UPDATE official_matches SET regulation_half_minutes = ?, extra_time_enabled = ?, extra_first_half_minutes = ?, extra_second_half_minutes = ?, penalties_enabled = ? WHERE id = ?");
                    $stmtT->bind_param("iiiiii", $th, $te, $tx1, $tx2, $tp, $matchId);
                    $stmtT->execute();
                    $stmtT->close();
                }
                $response = ['message' => 'Metadati partita aggiornati'];
                $statusCode = 200;
            } elseif ($method === 'POST' && isset($pathParts[2]) && is_numeric($pathParts[2]) && isset($pathParts[3]) && $pathParts[3] === 'events') {
                $matchId = (int)$pathParts[2];
                $data = json_decode(file_get_contents('php://input'), true);
                $eventType = isset($data['event_type']) ? trim((string)$data['event_type']) : '';
                $teamSide = isset($data['team_side']) ? trim((string)$data['team_side']) : '';
                $minute = isset($data['minute']) ? (int)$data['minute'] : null;
                $playerName = isset($data['player_name']) ? trim((string)$data['player_name']) : '';
                $allowed = ['goal', 'yellow_card', 'red_card', 'penalty_missed', 'own_goal', 'match_end',
                    'match_start', 'half_time', 'second_half_start', 'second_half_end',
                    'extra_first_half_start', 'extra_half_time', 'extra_second_half_start', 'extra_second_half_end',
                    'penalties_start'];
                if (!in_array($eventType, $allowed, true)) {
                    throw new Exception('Tipo evento non valido');
                }

                $phaseFlowTypes = ['match_start', 'half_time', 'second_half_start', 'second_half_end',
                    'extra_first_half_start', 'extra_half_time', 'extra_second_half_start', 'extra_second_half_end', 'penalties_start'];
                if (in_array($eventType, $phaseFlowTypes, true)) {
                    $minute = isset($data['minute']) ? (int)$data['minute'] : -1;
                    if ($minute < 0) {
                        throw new Exception('Minuto non valido');
                    }
                    $mstmt = $conn->prepare("SELECT extra_time_enabled, penalties_enabled FROM official_matches WHERE id = ? LIMIT 1");
                    $mstmt->bind_param("i", $matchId);
                    $mstmt->execute();
                    $mrow = $mstmt->get_result()->fetch_assoc();
                    $mstmt->close();
                    if (!$mrow) {
                        throw new Exception('Partita non trovata');
                    }
                    $etOn = isset($mrow['extra_time_enabled']) && (int)$mrow['extra_time_enabled'] === 1;
                    $pensOn = isset($mrow['penalties_enabled']) && (int)$mrow['penalties_enabled'] === 1;
                    $lastPhase = officialMatchLastPhaseEventType($conn, $matchId);
                    if ($lastPhase === 'match_end') {
                        throw new Exception('La partita risulta già chiusa');
                    }

                    $phaseTitles = [
                        'match_start' => 'Inizio partita',
                        'half_time' => 'Fine primo tempo',
                        'second_half_start' => 'Inizio secondo tempo',
                        'second_half_end' => 'Fine secondo tempo',
                        'extra_first_half_start' => 'Inizio supplementari',
                        'extra_half_time' => 'Fine primo tempo supplementari',
                        'extra_second_half_start' => 'Inizio secondo tempo supplementari',
                        'extra_second_half_end' => 'Fine secondo tempo supplementari',
                        'penalties_start' => 'Rigori',
                    ];
                    $title = $phaseTitles[$eventType];

                    if ($eventType === 'match_start') {
                        $chk = $conn->prepare("SELECT id FROM official_match_events WHERE match_id = ? AND event_type = 'match_start' LIMIT 1");
                        $chk->bind_param("i", $matchId);
                        $chk->execute();
                        if ($chk->get_result()->fetch_assoc()) {
                            $chk->close();
                            throw new Exception('Inizio partita già registrato');
                        }
                        $chk->close();
                    } elseif ($eventType === 'half_time') {
                        if ($lastPhase !== 'match_start') {
                            throw new Exception('Registra prima l\'inizio partita');
                        }
                    } elseif ($eventType === 'second_half_start') {
                        if ($lastPhase !== 'half_time') {
                            throw new Exception('Registra prima la fine del primo tempo');
                        }
                    } elseif ($eventType === 'second_half_end') {
                        if ($lastPhase !== 'second_half_start') {
                            throw new Exception('Registra prima l\'inizio del secondo tempo');
                        }
                    } elseif ($eventType === 'extra_first_half_start') {
                        if (!$etOn) {
                            throw new Exception('Supplementari non previsti per questa partita');
                        }
                        if ($lastPhase !== 'second_half_end') {
                            throw new Exception('Registra prima la fine del secondo tempo');
                        }
                    } elseif ($eventType === 'extra_half_time') {
                        if ($lastPhase !== 'extra_first_half_start') {
                            throw new Exception('Fase supplementare non coerente');
                        }
                    } elseif ($eventType === 'extra_second_half_start') {
                        if ($lastPhase !== 'extra_half_time') {
                            throw new Exception('Fase supplementare non coerente');
                        }
                    } elseif ($eventType === 'extra_second_half_end') {
                        if ($lastPhase !== 'extra_second_half_start') {
                            throw new Exception('Fase supplementare non coerente');
                        }
                    } elseif ($eventType === 'penalties_start') {
                        if (!$pensOn) {
                            throw new Exception('Rigori non previsti per questa partita');
                        }
                        $okPrev = ($lastPhase === 'second_half_end') || ($lastPhase === 'extra_second_half_end');
                        if (!$okPrev) {
                            throw new Exception('Registra prima la fine dei tempi regolamentari o supplementari');
                        }
                        $chk = $conn->prepare("SELECT id FROM official_match_events WHERE match_id = ? AND event_type = 'penalties_start' LIMIT 1");
                        $chk->bind_param("i", $matchId);
                        $chk->execute();
                        if ($chk->get_result()->fetch_assoc()) {
                            $chk->close();
                            throw new Exception('Rigori già registrati');
                        }
                        $chk->close();
                    }

                    $payload = json_encode(['phase' => true], JSON_UNESCAPED_UNICODE);
                    $stmt = $conn->prepare("INSERT INTO official_match_events (match_id, event_type, minute, team_side, title, payload_json) VALUES (?, ?, ?, NULL, ?, ?)");
                    $stmt->bind_param("isiss", $matchId, $eventType, $minute, $title, $payload);
                    $stmt->execute();
                    $newId = $stmt->insert_id;
                    $stmt->close();
                    syncOfficialMatchRowScoresFromLiveEvents($conn, $matchId);
                    if ($eventType === 'match_start') {
                        notifyOfficialMatchSingleEventPush($conn, (int)$newId);
                    }
                    $response = ['message' => 'Evento inserito', 'id' => $newId];
                    $statusCode = 201;
                } elseif ($eventType === 'match_end') {
                    $clockTime = isset($data['clock_time']) ? trim((string)$data['clock_time']) : '';
                    if ($clockTime === '') {
                        $clockTime = date('H:i');
                    } else {
                        $cp = explode(':', $clockTime);
                        if (count($cp) !== 2) {
                            $clockTime = date('H:i');
                        } else {
                            $ch = (int)$cp[0];
                            $cm = (int)$cp[1];
                            if ($ch < 0 || $ch > 23 || $cm < 0 || $cm > 59) {
                                $clockTime = date('H:i');
                            } else {
                                $clockTime = sprintf('%02d:%02d', $ch, $cm);
                            }
                        }
                    }
                    list($hs, $as) = computeOfficialMatchLiveScoreFromDb($conn, $matchId);
                    if ($hs < 0) {
                        $hs = 0;
                    }
                    if ($as < 0) {
                        $as = 0;
                    }
                    $title = 'Fine partita ' . $hs . ' - ' . $as;
                    $sel = $conn->prepare("SELECT id, payload_json FROM official_match_events WHERE match_id = ? AND event_type = 'match_end' ORDER BY id ASC");
                    $sel->bind_param("i", $matchId);
                    $sel->execute();
                    $existingRows = $sel->get_result()->fetch_all(MYSQLI_ASSOC);
                    $sel->close();

                    $newMatchEndEventIdForPush = null;
                    if (!empty($existingRows)) {
                        $keepId = (int)$existingRows[0]['id'];
                        if (count($existingRows) > 1) {
                            $del = $conn->prepare("DELETE FROM official_match_events WHERE match_id = ? AND event_type = 'match_end' AND id != ?");
                            $del->bind_param("ii", $matchId, $keepId);
                            $del->execute();
                            $del->close();
                        }
                        $payloadArr = [];
                        if (!empty($existingRows[0]['payload_json'])) {
                            $decoded = json_decode($existingRows[0]['payload_json'], true);
                            if (is_array($decoded)) {
                                $payloadArr = $decoded;
                            }
                        }
                        $payloadArr['clock_time'] = $clockTime;
                        $payloadArr['home_score'] = $hs;
                        $payloadArr['away_score'] = $as;
                        $payload = json_encode($payloadArr, JSON_UNESCAPED_UNICODE);
                        $minuteSort = officialMatchEndSortMinuteAfterOthers($conn, $matchId, $keepId);
                        $stmt = $conn->prepare("UPDATE official_match_events SET minute = ?, title = ?, payload_json = ? WHERE id = ?");
                        $stmt->bind_param("issi", $minuteSort, $title, $payload, $keepId);
                        $stmt->execute();
                        $stmt->close();
                        $response = ['message' => 'Fine partita aggiornata', 'id' => $keepId];
                        $statusCode = 200;
                    } else {
                        $minuteSort = officialMatchNextEventSortMinute($conn, $matchId);
                        $payload = json_encode([
                            'clock_time' => $clockTime,
                            'home_score' => $hs,
                            'away_score' => $as,
                        ], JSON_UNESCAPED_UNICODE);
                        $stmt = $conn->prepare("INSERT INTO official_match_events (match_id, event_type, minute, team_side, title, payload_json) VALUES (?, ?, ?, NULL, ?, ?)");
                        $stmt->bind_param("isiss", $matchId, $eventType, $minuteSort, $title, $payload);
                        $stmt->execute();
                        $newId = $stmt->insert_id;
                        $stmt->close();
                        $response = ['message' => 'Evento inserito', 'id' => $newId];
                        $statusCode = 201;
                        $newMatchEndEventIdForPush = (int)$newId;
                    }
                    syncOfficialMatchRowScoresFromLiveEvents($conn, $matchId);
                    if ($newMatchEndEventIdForPush !== null) {
                        notifyOfficialMatchSingleEventPush($conn, $newMatchEndEventIdForPush);
                    }
                } else {
                    if ($eventType === '' || !in_array($teamSide, ['home', 'away'], true) || $minute === null || $minute < 0) {
                        throw new Exception('Dati evento non validi');
                    }

                    $eventTitles = [
                        'goal' => 'Gol',
                        'yellow_card' => 'Cartellino giallo',
                        'red_card' => 'Cartellino rosso',
                        'penalty_missed' => 'Rigore sbagliato',
                        'own_goal' => 'Autogol',
                    ];
                    $title = $eventTitles[$eventType];
                    if ($playerName !== '') {
                        $title .= ' - ' . $playerName;
                    }
                    $payload = json_encode(['player_name' => $playerName !== '' ? $playerName : null], JSON_UNESCAPED_UNICODE);
                    $stmt = $conn->prepare("INSERT INTO official_match_events (match_id, event_type, minute, team_side, title, payload_json) VALUES (?, ?, ?, ?, ?, ?)");
                    $stmt->bind_param("isisss", $matchId, $eventType, $minute, $teamSide, $title, $payload);
                    $stmt->execute();
                    $newId = $stmt->insert_id;
                    $stmt->close();
                    refreshOfficialMatchEndScores($conn, $matchId);
                    if ($eventType === 'goal' || $eventType === 'own_goal') {
                        notifyOfficialMatchSingleEventPush($conn, (int)$newId);
                    }
                    $response = ['message' => 'Evento inserito', 'id' => $newId];
                    $statusCode = 201;
                }
            } elseif ($method === 'PUT' && isset($pathParts[2]) && is_numeric($pathParts[2]) && isset($pathParts[3]) && $pathParts[3] === 'stats') {
                $matchId = (int)$pathParts[2];
                $data = json_decode(file_get_contents('php://input'), true);
                $rows = (isset($data['standings']) && is_array($data['standings'])) ? $data['standings'] : [];

                $stmt = $conn->prepare("SELECT competition_id FROM official_matches WHERE id = ? LIMIT 1");
                $stmt->bind_param("i", $matchId);
                $stmt->execute();
                $mrow = $stmt->get_result()->fetch_assoc();
                $stmt->close();
                if (!$mrow) throw new Exception('Partita non trovata');
                $groupId = (int)$mrow['competition_id'];

                $del = $conn->prepare("DELETE FROM official_group_standings WHERE official_group_id = ?");
                $del->bind_param("i", $groupId);
                $del->execute();
                $del->close();

                $ins = $conn->prepare("INSERT INTO official_group_standings (official_group_id, team_name_norm, team_name_display, position, played, goal_diff, points) VALUES (?, ?, ?, ?, ?, ?, ?)");
                foreach ($rows as $r) {
                    $name = isset($r['team_name']) ? trim((string)$r['team_name']) : '';
                    if ($name === '') continue;
                    $norm = normalizeTeamNameForFavorite($name);
                    $pos = isset($r['position']) ? (int)$r['position'] : 0;
                    $pg = isset($r['played']) ? (int)$r['played'] : 0;
                    $dr = isset($r['goal_diff']) ? (int)$r['goal_diff'] : 0;
                    $pt = isset($r['points']) ? (int)$r['points'] : 0;
                    $ins->bind_param("issiiii", $groupId, $norm, $name, $pos, $pg, $dr, $pt);
                    $ins->execute();
                }
                $ins->close();
                $response = ['message' => 'Classifica aggiornata'];
                $statusCode = 200;
            } elseif ($method === 'GET' && isset($pathParts[2]) && $pathParts[2] === 'standings' && isset($pathParts[3]) && $pathParts[3] === 'ties') {
                if ($suLevel !== 1) {
                    throw new Exception('Operazione riservata a superuser livello 1');
                }
                ensureOfficialStandingsTieOverridesSchema();
                $competitionId = isset($_GET['competition_id']) ? (int)$_GET['competition_id'] : 0;
                if ($competitionId <= 0) throw new Exception('competition_id non valido');
                ensureOfficialGroupsMatchVisibilityColumn();

                $stmt = $conn->prepare("SELECT id, name FROM leagues WHERE official_group_id = ? AND is_official = 1 ORDER BY name ASC");
                $stmt->bind_param("i", $competitionId);
                $stmt->execute();
                $leagues = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
                $stmt->close();

                $result = [];
                foreach ($leagues as $lg) {
                    $leagueId = (int)$lg['id'];
                    $standingsNow = computeOfficialLeagueStandings($leagueId, date('Y-m-d H:i:s'), $competitionId);
                    $byPoints = [];
                    foreach ($standingsNow as $row) {
                        $p = (int)$row['points'];
                        if (!isset($byPoints[$p])) $byPoints[$p] = [];
                        $byPoints[$p][] = $row;
                    }
                    foreach ($byPoints as $pointsValue => $rowsAtPoints) {
                        if (count($rowsAtPoints) <= 1) continue;
                        $result[] = [
                            'league_id' => $leagueId,
                            'league_name' => $lg['name'],
                            'points' => (int)$pointsValue,
                            'teams' => array_map(function($r) {
                                return [
                                    'team_id' => (int)$r['team_id'],
                                    'team_name' => $r['team_name_display'],
                                    'goal_diff' => (int)$r['goal_diff'],
                                ];
                            }, $rowsAtPoints),
                        ];
                    }
                }
                $response = ['competition_id' => $competitionId, 'ties' => $result];
                $statusCode = 200;
            } elseif ($method === 'POST' && isset($pathParts[2]) && $pathParts[2] === 'standings' && isset($pathParts[3]) && $pathParts[3] === 'ties' && isset($pathParts[4]) && $pathParts[4] === 'resolve') {
                if ($suLevel !== 1) {
                    throw new Exception('Operazione riservata a superuser livello 1');
                }
                ensureOfficialStandingsTieOverridesSchema();
                $data = json_decode(file_get_contents('php://input'), true);
                $leagueId = isset($data['league_id']) ? (int)$data['league_id'] : 0;
                $pointsValue = isset($data['points']) ? (int)$data['points'] : -1;
                $orderedTeamIds = (isset($data['ordered_team_ids']) && is_array($data['ordered_team_ids'])) ? $data['ordered_team_ids'] : [];
                if ($leagueId <= 0 || $pointsValue < 0 || count($orderedTeamIds) < 2) {
                    throw new Exception('Dati risoluzione parimerito non validi');
                }
                $ordered = [];
                foreach ($orderedTeamIds as $tid) {
                    $v = (int)$tid;
                    if ($v > 0) $ordered[] = $v;
                }
                $ordered = array_values(array_unique($ordered));
                if (count($ordered) < 2) throw new Exception('Servono almeno due squadre');

                $resolveCompetitionId = 0;
                $stmtOg = $conn->prepare("SELECT official_group_id FROM leagues WHERE id = ? LIMIT 1");
                $stmtOg->bind_param("i", $leagueId);
                $stmtOg->execute();
                $ogRow = $stmtOg->get_result()->fetch_assoc();
                $stmtOg->close();
                if ($ogRow && isset($ogRow['official_group_id'])) {
                    $resolveCompetitionId = (int)$ogRow['official_group_id'];
                }

                $currentStandings = computeOfficialLeagueStandings(
                    $leagueId,
                    date('Y-m-d H:i:s'),
                    $resolveCompetitionId > 0 ? $resolveCompetitionId : null
                );
                $currentTieIds = [];
                foreach ($currentStandings as $r) {
                    if ((int)$r['points'] === $pointsValue) $currentTieIds[] = (int)$r['team_id'];
                }
                sort($currentTieIds);
                $orderedCheck = $ordered;
                sort($orderedCheck);
                if (count($currentTieIds) < 2 || $currentTieIds !== $orderedCheck) {
                    throw new Exception('Il parimerito attuale non coincide con le squadre inviate');
                }

                $del = $conn->prepare("DELETE FROM official_standings_tie_overrides WHERE league_id = ? AND points_value = ?");
                $del->bind_param("ii", $leagueId, $pointsValue);
                $del->execute();
                $del->close();

                $ins = $conn->prepare("
                    INSERT INTO official_standings_tie_overrides (league_id, points_value, team_id, rank_order, created_by)
                    VALUES (?, ?, ?, ?, ?)
                ");
                $orderPos = 1;
                foreach ($ordered as $teamId) {
                    $ins->bind_param("iiiii", $leagueId, $pointsValue, $teamId, $orderPos, $userId);
                    $ins->execute();
                    $orderPos++;
                }
                $ins->close();
                $response = ['message' => 'Ordine parimerito salvato'];
                $statusCode = 200;
            } elseif ($method === 'GET' && isset($pathParts[2]) && $pathParts[2] === 'competition' && isset($pathParts[3]) && is_numeric($pathParts[3]) && isset($pathParts[4]) && $pathParts[4] === 'teams') {
                $competitionId = (int)$pathParts[3];
                ensureOfficialGroupsMatchVisibilityColumn();
                $stmt = $conn->prepare("SELECT id FROM official_league_groups WHERE id = ? AND is_match_competition_enabled = 1 LIMIT 1");
                $stmt->bind_param("i", $competitionId);
                $stmt->execute();
                $groupRow = $stmt->get_result()->fetch_assoc();
                $stmt->close();
                if (!$groupRow) throw new Exception('Competizione non trovata');

                $stmt = $conn->prepare("
                    SELECT l.id, l.name
                    FROM leagues l
                    WHERE l.official_group_id = ? AND l.is_official = 1
                    ORDER BY l.name ASC
                ");
                $stmt->bind_param("i", $competitionId);
                $stmt->execute();
                $officialLeagues = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
                $stmt->close();

                $onlyLeagues = isset($_GET['only_leagues']) && (int)$_GET['only_leagues'] === 1;
                $leagueIdsCsv = isset($_GET['league_ids']) ? trim((string)$_GET['league_ids']) : '';
                $leagueIds = [];
                if ($leagueIdsCsv !== '') {
                    $parts = explode(',', $leagueIdsCsv);
                    foreach ($parts as $p) {
                        $v = (int)trim($p);
                        if ($v > 0) {
                            $leagueIds[] = $v;
                        }
                    }
                    $leagueIds = array_values(array_unique($leagueIds));
                }

                $teams = [];
                if (!$onlyLeagues && count($leagueIds) > 0) {
                    $sql = "
                        SELECT t.id, t.name, t.league_id
                        FROM teams t
                        INNER JOIN leagues l ON l.id = t.league_id
                        WHERE l.official_group_id = ? AND l.is_official = 1
                    ";
                    $types = "i";
                    $params = [$competitionId];
                    $placeholders = implode(',', array_fill(0, count($leagueIds), '?'));
                    $sql .= " AND l.id IN ($placeholders)";
                    $types .= str_repeat("i", count($leagueIds));
                    foreach ($leagueIds as $lid) {
                        $params[] = $lid;
                    }
                    $sql .= " ORDER BY t.name ASC";
                    $stmt = $conn->prepare($sql);
                    $stmt->bind_param($types, ...$params);
                    $stmt->execute();
                    $teams = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
                    $stmt->close();
                }

                $response = ['competition_id' => $competitionId, 'teams' => $teams, 'official_leagues' => $officialLeagues];
                $statusCode = 200;
            } elseif ($method === 'GET') {
                $date = isset($_GET['date']) ? trim((string)$_GET['date']) : date('Y-m-d');
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) throw new Exception('Data non valida (usa YYYY-MM-DD)');

                $stmt = $conn->prepare("
                    SELECT
                        m.id,
                        m.competition_id,
                        og.name AS competition_name,
                        m.home_team_id,
                        ht.name AS home_team_name,
                        ht.league_id AS home_league_id,
                        m.away_team_id,
                        at.name AS away_team_name,
                        at.league_id AS away_league_id,
                        m.kickoff_at,
                        m.status,
                        m.notes,
                        m.venue,
                        m.referee,
                        m.match_stage,
                        m.home_score,
                        m.away_score,
                        m.regulation_half_minutes,
                        m.extra_time_enabled,
                        m.extra_first_half_minutes,
                        m.extra_second_half_minutes,
                        m.penalties_enabled
                    FROM official_matches m
                    INNER JOIN official_league_groups og ON og.id = m.competition_id
                    INNER JOIN teams ht ON ht.id = m.home_team_id
                    INNER JOIN teams at ON at.id = m.away_team_id
                    WHERE DATE(m.kickoff_at) = ?
                    ORDER BY og.name ASC, m.kickoff_at ASC
                ");
                $stmt->bind_param("s", $date);
                $stmt->execute();
                $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
                $stmt->close();
                foreach ($rows as &$mr) {
                    $t = officialMatchTimingRowForApi($mr);
                    foreach ($t as $k => $v) {
                        $mr[$k] = $v;
                    }
                }
                unset($mr);
                $response = ['date' => $date, 'matches' => $rows];
                $statusCode = 200;
            } elseif ($method === 'POST') {
                $data = json_decode(file_get_contents('php://input'), true);
                $competitionId = isset($data['competition_id']) ? (int)$data['competition_id'] : 0;
                $homeTeamId = isset($data['home_team_id']) ? (int)$data['home_team_id'] : 0;
                $awayTeamId = isset($data['away_team_id']) ? (int)$data['away_team_id'] : 0;
                $kickoffAt = isset($data['kickoff_at']) ? trim((string)$data['kickoff_at']) : '';
                $status = isset($data['status']) ? trim((string)$data['status']) : 'scheduled';
                $notes = isset($data['notes']) ? trim((string)$data['notes']) : null;
                $venue = isset($data['venue']) ? trim((string)$data['venue']) : null;
                $referee = isset($data['referee']) ? trim((string)$data['referee']) : null;
                $stage = isset($data['match_stage']) ? trim((string)$data['match_stage']) : null;
                if ($venue === '') $venue = null;
                if ($referee === '') $referee = null;
                if ($stage === '') $stage = null;

                if ($competitionId <= 0 || $homeTeamId <= 0 || $awayTeamId <= 0 || $kickoffAt === '') throw new Exception('Dati partita incompleti');
                if ($homeTeamId === $awayTeamId) throw new Exception('Le squadre devono essere diverse');
                $validStatuses = ['scheduled', 'live', 'finished', 'postponed', 'cancelled'];
                if (!in_array($status, $validStatuses, true)) throw new Exception('Stato partita non valido');

                ensureOfficialGroupsMatchVisibilityColumn();
                $stmt = $conn->prepare("SELECT id FROM official_league_groups WHERE id = ? AND is_match_competition_enabled = 1 LIMIT 1");
                $stmt->bind_param("i", $competitionId);
                $stmt->execute();
                $compRow = $stmt->get_result()->fetch_assoc();
                $stmt->close();
                if (!$compRow) throw new Exception('Competizione non trovata');

                $stmt = $conn->prepare("
                    SELECT COUNT(*) AS c, COUNT(DISTINCT l.id) AS leagues_count
                    FROM teams t
                    INNER JOIN leagues l ON l.id = t.league_id
                    WHERE t.id IN (?, ?)
                      AND l.official_group_id = ?
                      AND l.is_official = 1
                ");
                $stmt->bind_param("iii", $homeTeamId, $awayTeamId, $competitionId);
                $stmt->execute();
                $cntRow = $stmt->get_result()->fetch_assoc();
                $stmt->close();
                if ((int)$cntRow['c'] !== 2) throw new Exception('Le squadre non appartengono alla competizione selezionata');
                if ((int)$cntRow['leagues_count'] !== 1) throw new Exception('Le squadre devono appartenere alla stessa lega ufficiale');

                if ($venue !== null) {
                    $stmt = $conn->prepare("SELECT id FROM official_match_venues WHERE name = ? LIMIT 1");
                    $stmt->bind_param("s", $venue);
                    $stmt->execute();
                    $vrow = $stmt->get_result()->fetch_assoc();
                    $stmt->close();
                    if (!$vrow) throw new Exception('Luogo non presente in elenco');
                }
                if ($referee !== null) {
                    $stmt = $conn->prepare("SELECT id FROM official_match_referees WHERE name = ? LIMIT 1");
                    $stmt->bind_param("s", $referee);
                    $stmt->execute();
                    $rrow = $stmt->get_result()->fetch_assoc();
                    $stmt->close();
                    if (!$rrow) throw new Exception('Arbitro non presente in elenco');
                }
                if ($stage !== null) {
                    $stmt = $conn->prepare("SELECT id FROM official_match_stages WHERE name = ? LIMIT 1");
                    $stmt->bind_param("s", $stage);
                    $stmt->execute();
                    $srow = $stmt->get_result()->fetch_assoc();
                    $stmt->close();
                    if (!$srow) throw new Exception('Tipologia non presente in elenco');
                }

                list($tmH, $tmE, $tmX1, $tmX2, $tmP) = parseOfficialMatchTimingFromPayload(is_array($data) ? $data : []);
                $stmt = $conn->prepare("
                    INSERT INTO official_matches (
                        competition_id, home_team_id, away_team_id, kickoff_at, status, notes, created_by, venue, referee, match_stage,
                        regulation_half_minutes, extra_time_enabled, extra_first_half_minutes, extra_second_half_minutes, penalties_enabled
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                $stmt->bind_param("iiisssisssiiiii", $competitionId, $homeTeamId, $awayTeamId, $kickoffAt, $status, $notes, $userId, $venue, $referee, $stage, $tmH, $tmE, $tmX1, $tmX2, $tmP);
                $stmt->execute();
                $newId = $stmt->insert_id;
                $stmt->close();
                $response = ['message' => 'Partita creata', 'id' => $newId];
                $statusCode = 201;
            } elseif ($method === 'PUT' && isset($pathParts[2]) && is_numeric($pathParts[2])) {
                $matchId = (int)$pathParts[2];
                $data = json_decode(file_get_contents('php://input'), true);
                $competitionId = isset($data['competition_id']) ? (int)$data['competition_id'] : 0;
                $homeTeamId = isset($data['home_team_id']) ? (int)$data['home_team_id'] : 0;
                $awayTeamId = isset($data['away_team_id']) ? (int)$data['away_team_id'] : 0;
                $kickoffAt = isset($data['kickoff_at']) ? trim((string)$data['kickoff_at']) : '';
                $status = isset($data['status']) ? trim((string)$data['status']) : 'scheduled';
                $notes = isset($data['notes']) ? trim((string)$data['notes']) : null;
                $venue = isset($data['venue']) ? trim((string)$data['venue']) : null;
                $referee = isset($data['referee']) ? trim((string)$data['referee']) : null;
                $stage = isset($data['match_stage']) ? trim((string)$data['match_stage']) : null;
                if ($venue === '') $venue = null;
                if ($referee === '') $referee = null;
                if ($stage === '') $stage = null;
                if ($competitionId <= 0 || $homeTeamId <= 0 || $awayTeamId <= 0 || $kickoffAt === '') throw new Exception('Dati partita incompleti');
                if ($homeTeamId === $awayTeamId) throw new Exception('Le squadre devono essere diverse');
                $validStatuses = ['scheduled', 'live', 'finished', 'postponed', 'cancelled'];
                if (!in_array($status, $validStatuses, true)) throw new Exception('Stato partita non valido');

                ensureOfficialGroupsMatchVisibilityColumn();
                $stmt = $conn->prepare("SELECT id FROM official_league_groups WHERE id = ? AND is_match_competition_enabled = 1 LIMIT 1");
                $stmt->bind_param("i", $competitionId);
                $stmt->execute();
                $compRow = $stmt->get_result()->fetch_assoc();
                $stmt->close();
                if (!$compRow) throw new Exception('Competizione non trovata');

                $stmt = $conn->prepare("
                    SELECT COUNT(*) AS c, COUNT(DISTINCT l.id) AS leagues_count
                    FROM teams t
                    INNER JOIN leagues l ON l.id = t.league_id
                    WHERE t.id IN (?, ?)
                      AND l.official_group_id = ?
                      AND l.is_official = 1
                ");
                $stmt->bind_param("iii", $homeTeamId, $awayTeamId, $competitionId);
                $stmt->execute();
                $cntRow = $stmt->get_result()->fetch_assoc();
                $stmt->close();
                if ((int)$cntRow['c'] !== 2) throw new Exception('Le squadre non appartengono alla competizione selezionata');
                if ((int)$cntRow['leagues_count'] !== 1) throw new Exception('Le squadre devono appartenere alla stessa lega ufficiale');

                if ($venue !== null) {
                    $stmt = $conn->prepare("SELECT id FROM official_match_venues WHERE name = ? LIMIT 1");
                    $stmt->bind_param("s", $venue);
                    $stmt->execute();
                    $vrow = $stmt->get_result()->fetch_assoc();
                    $stmt->close();
                    if (!$vrow) throw new Exception('Luogo non presente in elenco');
                }
                if ($referee !== null) {
                    $stmt = $conn->prepare("SELECT id FROM official_match_referees WHERE name = ? LIMIT 1");
                    $stmt->bind_param("s", $referee);
                    $stmt->execute();
                    $rrow = $stmt->get_result()->fetch_assoc();
                    $stmt->close();
                    if (!$rrow) throw new Exception('Arbitro non presente in elenco');
                }
                if ($stage !== null) {
                    $stmt = $conn->prepare("SELECT id FROM official_match_stages WHERE name = ? LIMIT 1");
                    $stmt->bind_param("s", $stage);
                    $stmt->execute();
                    $srow = $stmt->get_result()->fetch_assoc();
                    $stmt->close();
                    if (!$srow) throw new Exception('Tipologia non presente in elenco');
                }

                list($tmH, $tmE, $tmX1, $tmX2, $tmP) = parseOfficialMatchTimingFromPayload(is_array($data) ? $data : []);
                $stmt = $conn->prepare("
                    UPDATE official_matches SET
                        competition_id = ?, home_team_id = ?, away_team_id = ?, kickoff_at = ?, status = ?, notes = ?,
                        venue = ?, referee = ?, match_stage = ?,
                        regulation_half_minutes = ?, extra_time_enabled = ?, extra_first_half_minutes = ?, extra_second_half_minutes = ?, penalties_enabled = ?
                    WHERE id = ?
                ");
                $stmt->bind_param("iiisssssssiiiiii", $competitionId, $homeTeamId, $awayTeamId, $kickoffAt, $status, $notes, $venue, $referee, $stage, $tmH, $tmE, $tmX1, $tmX2, $tmP, $matchId);
                $stmt->execute();
                $stmt->close();
                $response = ['message' => 'Partita aggiornata'];
                $statusCode = 200;
            } elseif ($method === 'DELETE' && isset($pathParts[2]) && is_numeric($pathParts[2])) {
                $matchId = (int)$pathParts[2];
                $stmt = $conn->prepare("DELETE FROM official_matches WHERE id = ?");
                $stmt->bind_param("i", $matchId);
                $stmt->execute();
                $stmt->close();
                $response = ['message' => 'Partita eliminata'];
                $statusCode = 200;
            }
        }
    }
    // GET /cron/push-formation-reminders?key=... — cron Altervista: push promemoria formazione (~1h prima deadline)
    elseif ($method === 'GET' && (strpos($path, '/cron/push-formation-reminders') !== false
        || (isset($pathParts[0]) && $pathParts[0] === 'cron' && isset($pathParts[1]) && $pathParts[1] === 'push-formation-reminders'))) {
        $cronSecret = (defined('CRON_PUSH_FORMATION_SECRET') && CRON_PUSH_FORMATION_SECRET !== '')
            ? (string)CRON_PUSH_FORMATION_SECRET
            : '';
        $key = getCronRequestKey($pathParts);
        if ($cronSecret === '' || $key === '' || !hash_equals($cronSecret, $key)) {
            $response = ['error' => 'Forbidden'];
            $statusCode = 403;
        } else {
            try {
                $n = runFormationDeadlinePushReminders();
                $response = ['ok' => true, 'pushes_scheduled' => $n];
                $statusCode = 200;
                logPushDebug("cron/push-formation-reminders: ok pushes_scheduled=$n");
            } catch (Throwable $cronEx) {
                error_log('Cron push formation reminders: ' . $cronEx->getMessage());
                logPushDebug('Cron push formation reminders: ' . $cronEx->getMessage());
                $response = ['ok' => false, 'error' => 'Cron failed'];
                $statusCode = 500;
            }
        }
    }
    // GET /cron/push-match-events?key=... — invia push eventi live partita
    elseif ($method === 'GET' && (strpos($path, '/cron/push-match-events') !== false
        || (isset($pathParts[0]) && $pathParts[0] === 'cron' && isset($pathParts[1]) && $pathParts[1] === 'push-match-events'))) {
        $cronSecret = (defined('CRON_PUSH_FORMATION_SECRET') && CRON_PUSH_FORMATION_SECRET !== '')
            ? (string)CRON_PUSH_FORMATION_SECRET
            : '';
        $key = getCronRequestKey($pathParts);
        if ($cronSecret === '' || $key === '' || !hash_equals($cronSecret, $key)) {
            $response = ['error' => 'Forbidden'];
            $statusCode = 403;
        } else {
            try {
                $n = runMatchEventPushes();
                $response = ['ok' => true, 'pushes_scheduled' => $n];
                $statusCode = 200;
                logPushDebug("cron/push-match-events: ok pushes_scheduled=$n");
            } catch (Throwable $ex) {
                logPushDebug('cron/push-match-events: ' . $ex->getMessage());
                $response = ['ok' => false, 'error' => 'Cron failed'];
                $statusCode = 500;
            }
        }
    }
    // POST /notifications/register-token - Registra Expo push token dispositivo
    elseif ($method === 'POST' && (strpos($path, '/notifications/register-token') !== false
        || (isset($pathParts[0]) && $pathParts[0] === 'notifications' && isset($pathParts[1]) && $pathParts[1] === 'register-token'))) {
        $token = getAuthToken();
        if (!$token) throw new Exception('Token di autenticazione mancante');
        $decoded = verifyJWT($token);
        if (!$decoded) throw new Exception('Token non valido o scaduto');

        $input = json_decode(file_get_contents('php://input'), true);
        $expoToken = isset($input['token']) ? trim((string)$input['token']) : '';
        $platform = isset($input['platform']) ? trim((string)$input['platform']) : '';

        $validPrefix = (strpos($expoToken, 'ExponentPushToken') === 0 || strpos($expoToken, 'ExpoPushToken') === 0);
        if ($expoToken === '' || !$validPrefix) {
            throw new Exception('Token push non valido');
        }

        registerUserPushToken((int)$decoded['userId'], $expoToken, $platform !== '' ? $platform : null);
        $response = ['message' => 'Token push registrato'];
        $statusCode = 200;
    }
    // Registrazione
    elseif ($method === 'POST' && (strpos($path, '/auth/register') !== false || (isset($pathParts[1]) && $pathParts[1] === 'register'))) {
        $data = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($data['username']) || !isset($data['email']) || !isset($data['password'])) {
            throw new Exception('Compila tutti i campi');
        }
        
        $minPwLen = defined('PASSWORD_MIN_LENGTH') ? PASSWORD_MIN_LENGTH : 8;
        if (strlen($data['password']) < $minPwLen) {
            throw new Exception('La password deve essere di almeno ' . $minPwLen . ' caratteri');
        }
        
        // Verifica se username esiste
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT id FROM users WHERE username = ?");
        $stmt->bind_param("s", $data['username']);
        $stmt->execute();
        if ($stmt->get_result()->num_rows > 0) {
            throw new Exception('Username già esistente');
        }
        $stmt->close();
        
        // Verifica se email esiste
        $stmt = $conn->prepare("SELECT id FROM users WHERE email = ?");
        $stmt->bind_param("s", $data['email']);
        $stmt->execute();
        if ($stmt->get_result()->num_rows > 0) {
            throw new Exception('Email già registrata');
        }
        $stmt->close();
        
        // Registra utente (registerUser ritorna l'id sulla stessa connessione dell'INSERT; NON usare $conn->insert_id qui: getDbConnection() apre connessioni diverse)
        $userId = registerUser($data['username'], $data['email'], $data['password']);
        if ($userId) {
            $token = generateJWT($userId, $data['username']);
            
            $response = [
                'message' => 'Registrazione completata con successo',
                'token' => $token,
                'user' => [
                    'id' => $userId,
                    'username' => $data['username'],
                    'email' => $data['email']
                ]
            ];
            $statusCode = 201;
        } else {
            throw new Exception('Errore durante la registrazione');
        }
    }
    // Login
    elseif ($method === 'POST' && (strpos($path, '/auth/login') !== false || (isset($pathParts[1]) && $pathParts[1] === 'login'))) {
        $data = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($data['username']) || !isset($data['password'])) {
            throw new Exception('Inserisci username e password');
        }
        
        // Rate limiting per login
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        $maxAttempts = defined('RATE_LIMIT_MAX_ATTEMPTS') ? RATE_LIMIT_MAX_ATTEMPTS : 10;
        $windowSeconds = defined('RATE_LIMIT_WINDOW_SECONDS') ? RATE_LIMIT_WINDOW_SECONDS : 900;
        try {
            $conn = getDbConnection();
            $rlStmt = $conn->prepare("SELECT COUNT(*) as cnt FROM rate_limits WHERE ip_address = ? AND action = 'login' AND created_at > DATE_SUB(NOW(), INTERVAL ? SECOND)");
            $rlStmt->bind_param("si", $ip, $windowSeconds);
            $rlStmt->execute();
            $rlResult = $rlStmt->get_result()->fetch_assoc();
            $rlStmt->close();
            if ($rlResult['cnt'] >= $maxAttempts) {
                throw new Exception('Troppi tentativi di login. Riprova tra qualche minuto.');
            }
        } catch (Exception $rlEx) {
            if (strpos($rlEx->getMessage(), 'Troppi tentativi') !== false) throw $rlEx;
            // Tabella non esiste, continua senza rate limiting
        }
        
        if (loginUser($data['username'], $data['password'])) {
            $conn = getDbConnection();
            $stmt = $conn->prepare("SELECT id, username, email, is_superuser FROM users WHERE username = ?");
            $stmt->bind_param("s", $data['username']);
            $stmt->execute();
            $result = $stmt->get_result();
            $user = $result->fetch_assoc();
            $stmt->close();
            
            $token = generateJWT($user['id'], $user['username']);
            
            $response = [
                'message' => 'Login effettuato con successo',
                'token' => $token,
                'user' => [
                    'id' => $user['id'],
                    'username' => $user['username'],
                    'email' => $user['email'],
                    'is_superuser' => (bool)($user['is_superuser'] ?? 0)
                ]
            ];
            $statusCode = 200;
        } else {
            // Registra tentativo fallito per rate limiting
            try {
                $conn = getDbConnection();
                $rlInsert = $conn->prepare("INSERT INTO rate_limits (ip_address, action, created_at) VALUES (?, 'login', NOW())");
                $rlInsert->bind_param("s", $ip);
                $rlInsert->execute();
                $rlInsert->close();
            } catch (Exception $rlEx) {
                // Ignora se tabella non esiste
            }
            throw new Exception('Credenziali non valide');
        }
    }
    // Logout
    elseif ($method === 'POST' && (strpos($path, '/auth/logout') !== false || (isset($pathParts[1]) && $pathParts[1] === 'logout'))) {
        $response = ['message' => 'Logout effettuato con successo'];
        $statusCode = 200;
    }
    // POST /auth/delete-account - Elimina account (richiede password)
    elseif ($method === 'POST' && (strpos($path, '/auth/delete-account') !== false || (isset($pathParts[1]) && $pathParts[1] === 'delete-account'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }

        $data = json_decode(file_get_contents('php://input'), true);
        $password = $data['password'] ?? '';
        if (!is_string($password) || trim($password) === '') {
            throw new Exception('Password obbligatoria');
        }

        $userId = (int)$decoded['userId'];
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT password FROM users WHERE id = ?");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if (!$row || empty($row['password']) || !password_verify($password, $row['password'])) {
            throw new Exception('Password errata');
        }

        $ok = deleteUserAccountData($userId);
        if (!$ok) {
            throw new Exception('Errore durante eliminazione account');
        }

        $response = ['message' => 'Account eliminato con successo'];
        $statusCode = 200;
    }
    // Verifica token
    elseif ($method === 'GET' && (strpos($path, '/auth/verify') !== false || (isset($pathParts[1]) && $pathParts[1] === 'verify'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $response = [
            'valid' => true,
            'user' => $decoded
        ];
        $statusCode = 200;
    }
    // Password dimenticata - Genera password automatica e invia via email
    elseif ($method === 'POST' && isForgotPasswordPath($path, $pathParts)) {
        error_log("=== FORGOT PASSWORD REQUEST ===");
        
        $data = json_decode(file_get_contents('php://input'), true);      
        
        if (!isset($data['email']) || empty($data['email'])) {
            throw new Exception('Inserisci la tua email');
        }
        
        $email = trim($data['email']);
        
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new Exception('Inserisci un indirizzo email valido');
        }
        
        // Risposta generica per non rivelare se l'email esiste
        $genericMessage = 'Se l\'email è registrata nel nostro sistema, riceverai una nuova password via email.';
        
        $conn = getDbConnection();
        
        // Rate limiting per forgot-password
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        $maxAttempts = defined('RATE_LIMIT_MAX_ATTEMPTS') ? RATE_LIMIT_MAX_ATTEMPTS : 10;
        $windowSeconds = defined('RATE_LIMIT_WINDOW_SECONDS') ? RATE_LIMIT_WINDOW_SECONDS : 900;
        
        // Controlla tentativi recenti (usa tabella rate_limits se esiste)
        try {
            $rlStmt = $conn->prepare("SELECT COUNT(*) as cnt FROM rate_limits WHERE ip_address = ? AND action = 'forgot_password' AND created_at > DATE_SUB(NOW(), INTERVAL ? SECOND)");
            $rlStmt->bind_param("si", $ip, $windowSeconds);
            $rlStmt->execute();
            $rlResult = $rlStmt->get_result()->fetch_assoc();
            $rlStmt->close();
            
            if ($rlResult['cnt'] >= $maxAttempts) {
                error_log("Rate limit exceeded for IP: " . $ip);
                $response = ['message' => 'Troppi tentativi. Riprova tra qualche minuto.'];
                $statusCode = 429;
                // Skip everything else
                goto forgot_password_end;
            }
            
            // Registra il tentativo
            $rlInsert = $conn->prepare("INSERT INTO rate_limits (ip_address, action, created_at) VALUES (?, 'forgot_password', NOW())");
            $rlInsert->bind_param("s", $ip);
            $rlInsert->execute();
            $rlInsert->close();
        } catch (Exception $rlEx) {
            // Se la tabella non esiste ancora, continua senza rate limiting
            error_log("Rate limiting non disponibile: " . $rlEx->getMessage());
        }
        
        // Verifica se l'email esiste
        $stmt = $conn->prepare("SELECT id, username, email FROM users WHERE email = ?");
        $stmt->bind_param("s", $email);
        $stmt->execute();
        $result = $stmt->get_result();
        $user = $result->fetch_assoc();
        $stmt->close();
        
        if ($user) {
            // Genera password casuale sicura
            $pwBytes = defined('GENERATED_PASSWORD_BYTES') ? GENERATED_PASSWORD_BYTES : 8;
            $newPassword = bin2hex(random_bytes($pwBytes));
            $hashedPassword = password_hash($newPassword, PASSWORD_DEFAULT);
            
            // Aggiorna la password nel database
            $stmt = $conn->prepare("UPDATE users SET password = ? WHERE email = ?");
            $stmt->bind_param("ss", $hashedPassword, $email);
            
            if ($stmt->execute()) {
                $stmt->close();
                
                // Prepara il corpo email
                $emailBody = "
                <html>
                <head><title>Recupero Password FantaCoppa</title></head>
                <body>
                    <h2>Recupero Password FantaCoppa</h2>
                    <p>Ciao " . htmlspecialchars($user['username']) . ",</p>
                    <p>Hai richiesto il recupero della password per il tuo account FantaCoppa.</p>
                    <p>La tua nuova password è:</p>
                    <p style='font-size: 18px; font-weight: bold; color: #667eea; padding: 10px; background-color: #f0f0f0; border-radius: 5px;'>" . htmlspecialchars($newPassword) . "</p>
                    <p>Ti consigliamo di cambiare questa password dopo il login per motivi di sicurezza.</p>
                    <p>Se non hai richiesto tu questo recupero, contatta immediatamente il supporto.</p>
                    <br>
                    <p>Cordiali saluti,<br>Team FantaCoppa</p>
                </body>
                </html>";
                
                $mailSent = false;
                
                // Tentativo 1: mail() nativa
                if (function_exists('mail')) {
                    $headers = "MIME-Version: 1.0\r\n";
                    $headers .= "Content-type:text/html;charset=UTF-8\r\n";
                    $headers .= "From: " . SMTP_FROM_NAME . " <noreply@fantacoppa.com>\r\n";
                    $headers .= "Reply-To: noreply@fantacoppa.com\r\n";
                    $headers .= "X-Mailer: PHP/" . phpversion();
                    
                    $mailSent = @mail($email, 'Recupero Password - FantaCoppa', $emailBody, $headers);
                }
                
                // Tentativo 2: PHPMailer SMTP (fallback)
                if (!$mailSent && class_exists('PHPMailer\PHPMailer\PHPMailer')) {
                    try {
                        $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
                        $mail->isSMTP();
                        $mail->Host = SMTP_HOST;
                        $mail->SMTPAuth = true;
                        $mail->Username = SMTP_USERNAME;
                        $mail->Password = SMTP_PASSWORD;
                        $mail->SMTPSecure = \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
                        $mail->Port = SMTP_PORT;
                        $mail->SMTPDebug = 0; // Nessun debug in produzione
                        $mail->Timeout = 30;
                        $mail->SMTPOptions = array(
                            'ssl' => array(
                                'verify_peer' => false,
                                'verify_peer_name' => false,
                                'allow_self_signed' => true
                            )
                        );
                        
                        $mail->setFrom(SMTP_USERNAME, SMTP_FROM_NAME);
                        $mail->addAddress($email);
                        $mail->isHTML(true);
                        $mail->Subject = 'Recupero Password - FantaCoppa';
                        $mail->Body = $emailBody;
                        
                        try {
                            $mailSent = $mail->send();
                        } catch (Exception $sendEx) {
                            error_log("SMTP STARTTLS failed, trying SSL...");
                            $mail->SMTPSecure = \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS;
                            $mail->Port = 465;
                            try {
                                $mailSent = $mail->send();
                            } catch (Exception $sslEx) {
                                error_log("SMTP SSL also failed: " . $sslEx->getMessage());
                            }
                        }
                    } catch (Exception $mailEx) {
                        error_log("PHPMailer error: " . $mailEx->getMessage());
                    }
                }
                
                if ($mailSent) {
                    error_log("Password reset email sent to: " . $email);
                } else {
                    error_log("Failed to send password reset email to: " . $email);
                }
            } else {
                $stmt->close();
                error_log("Failed to update password in database");
            }
        } else {
            error_log("Forgot password: email not found (not revealed to user)");
        }
        
        forgot_password_end:
        // Rispondi SEMPRE con lo stesso messaggio generico (non rivelare se l'email esiste)
        if (!isset($response)) {
            $response = ['message' => $genericMessage];
            $statusCode = 200;
        }
        
        error_log("=== FORGOT PASSWORD REQUEST END ===");
    }
    // POST /auth/change-password - Cambia password utente
    elseif ($method === 'POST' && (strpos($path, '/auth/change-password') !== false || (isset($pathParts[0]) && $pathParts[0] === 'auth' && isset($pathParts[1]) && $pathParts[1] === 'change-password'))) {
        error_log("=== CHANGE PASSWORD REQUEST ===");
        error_log("Path: " . $path);
        error_log("PathParts: " . json_encode($pathParts));
        
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        $data = json_decode(file_get_contents('php://input'), true);
        
        $currentPassword = $data['current_password'] ?? '';
        $newPassword = $data['new_password'] ?? '';
        $confirmPassword = $data['confirm_password'] ?? '';
        
        if (empty($currentPassword) || empty($newPassword) || empty($confirmPassword)) {
            throw new Exception('Compila tutti i campi');
        }
        
        if ($newPassword !== $confirmPassword) {
            throw new Exception('Le nuove password non coincidono');
        }
        
        $minPwLen = defined('PASSWORD_MIN_LENGTH') ? PASSWORD_MIN_LENGTH : 8;
        if (strlen($newPassword) < $minPwLen) {
            throw new Exception('La nuova password deve essere di almeno ' . $minPwLen . ' caratteri');
        }
        
        $conn = getDbConnection();
        
        // Verifica password attuale
        $stmt = $conn->prepare("SELECT password FROM users WHERE id = ?");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $res = $stmt->get_result();
        
        if ($row = $res->fetch_assoc()) {
            if (!password_verify($currentPassword, $row['password'])) {
                $stmt->close();
                throw new Exception('Password attuale errata');
            }
            
            // Aggiorna password
            $hashed = password_hash($newPassword, PASSWORD_DEFAULT);
            $stmt->close();
            
            $stmt = $conn->prepare("UPDATE users SET password = ? WHERE id = ?");
            $stmt->bind_param("si", $hashed, $userId);
            
            if ($stmt->execute()) {
                $stmt->close();
                $response = ['message' => 'Password aggiornata con successo'];
                $statusCode = 200;
            } else {
                $stmt->close();
                throw new Exception('Errore durante l\'aggiornamento');
            }
        } else {
            $stmt->close();
            throw new Exception('Utente non trovato');
        }
    }
    // ========== LEGHE ==========
    // GET /leagues/all - Ottieni tutte le leghe in cui l'utente NON è iscritto (DEVE essere prima di GET /leagues)
    elseif ($method === 'GET' && (strpos($path, '/leagues/all') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && $pathParts[1] === 'all'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Ottieni tutte le leghe escludendo quelle a cui l'utente è già iscritto
        $stmt = $conn->prepare("
            SELECT l.id, l.name, l.access_code, l.initial_budget, l.creator_id, l.auto_lineup_mode
            FROM leagues l
            LEFT JOIN league_members lm ON l.id = lm.league_id AND lm.user_id = ?
            WHERE lm.user_id IS NULL
            ORDER BY l.name ASC
        ");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $result = $stmt->get_result();
        
        $leagues = [];
        while ($row = $result->fetch_assoc()) {
            // Recupera l'ultima giornata con voti inseriti
            $matchdayStmt = $conn->prepare("
                SELECT MAX(giornata) as current_matchday 
                FROM player_ratings 
                WHERE league_id = ? AND rating IS NOT NULL
            ");
            $matchdayStmt->bind_param("i", $row['id']);
            $matchdayStmt->execute();
            $matchdayResult = $matchdayStmt->get_result();
            $matchdayRow = $matchdayResult->fetch_assoc();
            $currentMatchday = $matchdayRow && $matchdayRow['current_matchday'] ? (int)$matchdayRow['current_matchday'] : null;
            $matchdayStmt->close();
            
            // Recupera le impostazioni del mercato
            $marketStmt = $conn->prepare("SELECT market_locked FROM league_market_settings WHERE league_id = ?");
            $marketStmt->bind_param("i", $row['id']);
            $marketStmt->execute();
            $marketResult = $marketStmt->get_result();
            $marketRow = $marketResult->fetch_assoc();
            $marketLocked = $marketRow ? (int)$marketRow['market_locked'] : 0;
            $marketStmt->close();
            
            // Conta il numero di utenti nella lega
            $usersStmt = $conn->prepare("SELECT COUNT(*) as user_count FROM league_members WHERE league_id = ?");
            $usersStmt->bind_param("i", $row['id']);
            $usersStmt->execute();
            $usersResult = $usersStmt->get_result();
            $usersRow = $usersResult->fetch_assoc();
            $userCount = $usersRow ? (int)$usersRow['user_count'] : 0;
            $usersStmt->close();
            
            $leagues[] = [
                'id' => (int)$row['id'],
                'name' => $row['name'],
                'access_code' => $row['access_code'],
                'initial_budget' => (int)$row['initial_budget'],
                'current_matchday' => $currentMatchday,
                'auto_lineup_mode' => isset($row['auto_lineup_mode']) ? (int)$row['auto_lineup_mode'] : 0,
                'market_locked' => $marketLocked,
                'user_count' => $userCount,
            ];
        }
        $stmt->close();
        
        $response = $leagues;
        $statusCode = 200;
    }
    // GET /official-leagues/available - Ottieni leghe ufficiali disponibili per il collegamento
    elseif ($method === 'GET' && isset($pathParts[0]) && $pathParts[0] === 'official-leagues' && isset($pathParts[1]) && $pathParts[1] === 'available') {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $conn = getDbConnection();
        
        // Recupera le leghe ufficiali visibili per il collegamento
        $stmt = $conn->prepare("
            SELECT l.id, l.name, l.created_at,
                   olg.name as official_group_name,
                   (SELECT COUNT(*) FROM teams t WHERE t.league_id = l.id) as team_count,
                   (SELECT COUNT(*) FROM players p JOIN teams t ON p.team_id = t.id WHERE t.league_id = l.id) as player_count,
                   (SELECT COUNT(*) FROM matchdays m WHERE m.league_id = l.id) as matchday_count
            FROM leagues l
            LEFT JOIN official_league_groups olg ON l.official_group_id = olg.id
            WHERE l.is_official = 1 AND l.is_visible_for_linking = 1
            ORDER BY l.name
        ");
        $stmt->execute();
        $result = $stmt->get_result();
        
        $officialLeagues = [];
        while ($row = $result->fetch_assoc()) {
            $officialLeagues[] = [
                'id' => (int)$row['id'],
                'name' => $row['name'],
                'official_group_name' => $row['official_group_name'],
                'team_count' => (int)$row['team_count'],
                'player_count' => (int)$row['player_count'],
                'matchday_count' => (int)$row['matchday_count'],
                'created_at' => $row['created_at']
            ];
        }
        $stmt->close();
        
        $response = $officialLeagues;
        $statusCode = 200;
    }
    // GET /leagues - Ottieni tutte le leghe dell'utente (DEVE essere dopo GET /leagues/:id per evitare match errati)
    // Match solo se pathParts[0] === 'leagues' E pathParts[1] non esiste (cioè esattamente /leagues senza ID)
    elseif ($method === 'GET' && isset($pathParts[0]) && $pathParts[0] === 'leagues' && !isset($pathParts[1])) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Recupera leghe direttamente (senza usare getUserLeagues che usa sessioni)
        $stmt = $conn->prepare("
            SELECT l.*, lm.role 
            FROM leagues l 
            JOIN league_members lm ON l.id = lm.league_id 
            WHERE lm.user_id = ?
        ");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $result = $stmt->get_result();
        
        // Recupera preferenze utente
        ensureUserLeaguePrefsNotificationsColumn();
        $conn = getDbConnection();
        $prefsStmt = $conn->prepare("SELECT league_id, favorite, archived, notifications_enabled FROM user_league_prefs WHERE user_id = ?");
        $prefsStmt->bind_param("i", $userId);
        $prefsStmt->execute();
        $prefsResult = $prefsStmt->get_result();
        $prefs = [];
        while ($prefRow = $prefsResult->fetch_assoc()) {
            $prefs[$prefRow['league_id']] = [
                'favorite' => (bool)$prefRow['favorite'],
                'archived' => (bool)$prefRow['archived'],
                'notifications_enabled' => !isset($prefRow['notifications_enabled']) ? true : (bool)$prefRow['notifications_enabled']
            ];
        }
        $prefsStmt->close();
        
        // Raccolta ID delle leghe per query batch
        $leagueRows = [];
        while ($row = $result->fetch_assoc()) {
            $leagueRows[$row['id']] = $row;
        }
        $stmt->close();
        
        if (!empty($leagueRows)) {
            $leagueIds = array_keys($leagueRows);
            $placeholders = implode(',', array_fill(0, count($leagueIds), '?'));
            $types = str_repeat('i', count($leagueIds));
            
            // Budget utente - batch
            $budgetStmt = $conn->prepare("SELECT league_id, budget, team_name, coach_name FROM user_budget WHERE user_id = ? AND league_id IN ($placeholders)");
            $budgetStmt->bind_param("i" . $types, $userId, ...$leagueIds);
            $budgetStmt->execute();
            $budgetResults = $budgetStmt->get_result();
            $budgets = [];
            while ($bRow = $budgetResults->fetch_assoc()) {
                $budgets[$bRow['league_id']] = $bRow;
            }
            $budgetStmt->close();
            
            // Matchday corrente - batch
            $matchdayStmt = $conn->prepare("SELECT league_id, MAX(giornata) as current_matchday FROM player_ratings WHERE league_id IN ($placeholders) AND rating IS NOT NULL GROUP BY league_id");
            $matchdayStmt->bind_param($types, ...$leagueIds);
            $matchdayStmt->execute();
            $matchdayResults = $matchdayStmt->get_result();
            $matchdays = [];
            while ($mRow = $matchdayResults->fetch_assoc()) {
                $matchdays[$mRow['league_id']] = (int)$mRow['current_matchday'];
            }
            $matchdayStmt->close();
            
            // Market settings - batch
            $marketStmt = $conn->prepare("SELECT league_id, market_locked FROM league_market_settings WHERE league_id IN ($placeholders)");
            $marketStmt->bind_param($types, ...$leagueIds);
            $marketStmt->execute();
            $marketResults = $marketStmt->get_result();
            $markets = [];
            while ($mkRow = $marketResults->fetch_assoc()) {
                $markets[$mkRow['league_id']] = (int)$mkRow['market_locked'];
            }
            $marketStmt->close();
            
            // User count - batch
            $usersStmt = $conn->prepare("SELECT league_id, COUNT(*) as user_count FROM league_members WHERE league_id IN ($placeholders) GROUP BY league_id");
            $usersStmt->bind_param($types, ...$leagueIds);
            $usersStmt->execute();
            $usersResults = $usersStmt->get_result();
            $userCounts = [];
            while ($uRow = $usersResults->fetch_assoc()) {
                $userCounts[$uRow['league_id']] = (int)$uRow['user_count'];
            }
            $usersStmt->close();
            
            // Live matchday - batch (giornate con voti non calcolate)
            $liveStmt = $conn->prepare("
                SELECT pr.league_id, MAX(pr.giornata) as live_giornata
                FROM player_ratings pr
                WHERE pr.league_id IN ($placeholders) AND pr.rating > 0
                  AND pr.giornata NOT IN (SELECT DISTINCT mr.giornata FROM matchday_results mr WHERE mr.league_id = pr.league_id)
                GROUP BY pr.league_id
            ");
            $liveStmt->bind_param($types, ...$leagueIds);
            $liveStmt->execute();
            $liveResults = $liveStmt->get_result();
            $liveDays = [];
            while ($lRow = $liveResults->fetch_assoc()) {
                $liveDays[$lRow['league_id']] = (int)$lRow['live_giornata'];
            }
            $liveStmt->close();
        }
        
        // Assembla risultati
        $leagues = [];
        foreach ($leagueRows as $lid => $row) {
            $budgetRow = isset($budgets[$lid]) ? $budgets[$lid] : null;
            $row['budget'] = $budgetRow ? $budgetRow['budget'] : $row['initial_budget'];
            $row['team_name'] = $budgetRow ? $budgetRow['team_name'] : '';
            $row['coach_name'] = $budgetRow ? $budgetRow['coach_name'] : '';
            $row['current_matchday'] = isset($matchdays[$lid]) ? $matchdays[$lid] : null;
            $row['market_locked'] = isset($markets[$lid]) ? $markets[$lid] : 0;
            $row['user_count'] = isset($userCounts[$lid]) ? $userCounts[$lid] : 0;
            $row['favorite'] = isset($prefs[$lid]) ? $prefs[$lid]['favorite'] : false;
            $row['archived'] = isset($prefs[$lid]) ? $prefs[$lid]['archived'] : false;
            $row['notifications_enabled'] = isset($prefs[$lid]) ? $prefs[$lid]['notifications_enabled'] : true;
            $row['auto_lineup_mode'] = isset($row['auto_lineup_mode']) ? (int)$row['auto_lineup_mode'] : 0;
            $row['has_live_matchday'] = isset($liveDays[$lid]);
            $row['live_matchday'] = isset($liveDays[$lid]) ? $liveDays[$lid] : null;
            $leagues[] = $row;
        }
        
        $response = $leagues;
        $statusCode = 200;
    }
    // GET /leagues/:id/user-stats - Ottieni statistiche utente nella lega (DEVE essere prima di GET /leagues/:id)
    elseif ($method === 'GET' && (strpos($path, '/user-stats') !== false || (isset($pathParts[2]) && $pathParts[2] === 'user-stats'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Ottieni tutte le standings per trovare posizione utente
        $allStandings = getLeagueStandings($leagueId, 1000);
        if (!is_array($allStandings)) {
            $allStandings = [];
        }
        
        // Trova posizione utente
        $userPosition = null;
        $userTotalPoints = 0;
        foreach ($allStandings as $index => $team) {
            if ($team['id'] == $userId) {
                $userPosition = $index + 1;
                $userTotalPoints = floatval($team['punteggio']);
                break;
            }
        }
        
        // Punteggi per giornata: leggi SOLO da matchday_results (giornate calcolate)
        $userScores = [];
        $stmt = $conn->prepare("SELECT giornata, punteggio FROM matchday_results WHERE league_id = ? AND user_id = ? ORDER BY giornata ASC");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $userScores[] = [
                'giornata' => (int)$row['giornata'],
                'punteggio' => round(floatval($row['punteggio']), 1),
            ];
        }
        $stmt->close();

        // Prendi solo gli ultimi 5 punteggi (più recenti)
        $last5Scores = array_slice($userScores, -5);

        // Conta totale giornate calcolate
        $giornateConVoti = count($userScores);

        // Calcola media punti per partita
        $avgPoints = $giornateConVoti > 0 ? ($userTotalPoints / $giornateConVoti) : 0;
        
        error_log("GET /leagues/:id/user-stats - User ID: $userId, League ID: $leagueId");
        error_log("GET /leagues/:id/user-stats - User scores count: " . count($userScores) . ", Last 5: " . count($last5Scores));
        error_log("GET /leagues/:id/user-stats - Last 5 scores: " . json_encode($last5Scores));
        
        $response = [
            'position' => $userPosition,
            'totalPoints' => round($userTotalPoints, 1),
            'avgPoints' => round($avgPoints, 2),
            'scores' => $last5Scores
        ];
        $statusCode = 200;
    }
    // GET /leagues/:id/members - Ottieni lista membri della lega (DEVE essere prima di GET /leagues/:id)
    elseif ($method === 'GET' && (strpos($path, '/members') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'members'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Estrai leagueId dal path
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else if (preg_match('/\/leagues\/(\d+)\/members/', $path, $matches)) {
            $leagueId = (int)$matches[1];
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia membro della lega
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $userMember = $stmt->get_result()->fetch_assoc();
        if (!$userMember) {
            throw new Exception('Non sei membro di questa lega');
        }
        
        // Ottieni tutti i membri con username e team_name, coach_name
        $stmt = $conn->prepare("
            SELECT lm.id, lm.user_id, lm.role, u.username, ub.team_name, ub.coach_name
            FROM league_members lm
            JOIN users u ON lm.user_id = u.id
            LEFT JOIN user_budget ub ON lm.user_id = ub.user_id AND lm.league_id = ub.league_id
            WHERE lm.league_id = ?
            ORDER BY lm.role DESC, u.username ASC
        ");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        $members = [];
        while ($row = $res->fetch_assoc()) {
            $members[] = [
                'id' => (int)$row['id'],
                'user_id' => (int)$row['user_id'],
                'username' => $row['username'],
                'role' => $row['role'],
                'team_name' => $row['team_name'] ?? null,
                'coach_name' => $row['coach_name'] ?? null,
                'is_current_user' => $row['user_id'] == $userId
            ];
        }
        $stmt->close();
        
        $response = $members;
        $statusCode = 200;
    }
    // GET /leagues/:id/bonus-settings - Ottieni solo impostazioni bonus/malus (admin/pagellatore only) - DEVE essere prima di GET /leagues/:id/settings
    elseif ($method === 'GET' && (strpos($path, '/bonus-settings') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'bonus-settings'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'bonus-settings') {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/bonus-settings/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin o pagellatore
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || !in_array($member['role'], ['admin', 'pagellatore'])) {
            throw new Exception('Solo amministratori e pagellatori possono vedere le impostazioni bonus/malus');
        }
        
        // Recupera impostazioni bonus/malus
        $bonus_defaults = [
            'enable_bonus_malus' => 1,
            'enable_goal' => 1,
            'bonus_goal' => 3.0,
            'enable_assist' => 1,
            'bonus_assist' => 1.0,
            'enable_yellow_card' => 1,
            'malus_yellow_card' => -0.5,
            'enable_red_card' => 1,
            'malus_red_card' => -1.0,
            'enable_goals_conceded' => 1,
            'malus_goals_conceded' => -1.0,
            'enable_own_goal' => 1,
            'malus_own_goal' => -2.0,
            'enable_penalty_missed' => 1,
            'malus_penalty_missed' => -3.0,
            'enable_penalty_saved' => 1,
            'bonus_penalty_saved' => 3.0,
            'enable_clean_sheet' => 1,
            'bonus_clean_sheet' => 1.0
        ];
        $bonus_settings = $bonus_defaults;
        $stmt = $conn->prepare("SELECT * FROM league_bonus_settings WHERE league_id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        if ($row = $res->fetch_assoc()) {
            $bonus_settings = array_merge($bonus_defaults, $row);
        }
        $stmt->close();
        
        $response = $bonus_settings;
        $statusCode = 200;
    }
    // GET /leagues/:id/votes/matchdays - Ottieni giornate disponibili per inserimento voti (admin/pagellatore only) - DEVE essere prima di GET /leagues/:id
    elseif ($method === 'GET' && (strpos($path, '/leagues/') !== false && strpos($path, '/votes/matchdays') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'votes' && isset($pathParts[3]) && $pathParts[3] === 'matchdays'))) {
        error_log("=== GET /leagues/:id/votes/matchdays - START ===");
        error_log("Path: $path");
        error_log("PathParts: " . json_encode($pathParts));
        
        $token = getAuthToken();
        if (!$token) {
            error_log("GET /leagues/:id/votes/matchdays - Token mancante");
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            error_log("GET /leagues/:id/votes/matchdays - Token non valido");
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'votes' && isset($pathParts[3]) && $pathParts[3] === 'matchdays') {
            $leagueId = (int)$pathParts[1];
            error_log("GET /leagues/:id/votes/matchdays - LeagueId from pathParts: $leagueId");
        } else {
            if (preg_match('/\/leagues\/(\d+)\/votes\/matchdays/', $path, $matches)) {
                $leagueId = (int)$matches[1];
                error_log("GET /leagues/:id/votes/matchdays - LeagueId from regex: $leagueId");
            }
        }
        
        if (!$leagueId) {
            error_log("GET /leagues/:id/votes/matchdays - LeagueId non trovato");
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        error_log("GET /leagues/:id/votes/matchdays - UserId: $userId, LeagueId: $leagueId");
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin o pagellatore
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        error_log("GET /leagues/:id/votes/matchdays - Member role: " . ($member ? $member['role'] : 'null'));
        
        if (!$member || !in_array($member['role'], ['admin', 'pagellatore'])) {
            error_log("GET /leagues/:id/votes/matchdays - Accesso negato (non admin/pagellatore)");
            throw new Exception('Solo amministratori e pagellatori possono inserire voti');
        }
        
        // Se la lega è collegata, leggi giornate e voti dalla lega sorgente
        $effectiveLeagueId = getEffectiveLeagueId($leagueId);
        
        // Recupera le giornate disponibili
        error_log("GET /leagues/:id/votes/matchdays - Querying matchdays for league $effectiveLeagueId (effective)");
        $stmt = $conn->prepare("SELECT giornata FROM matchdays WHERE league_id = ? ORDER BY giornata");
        $stmt->bind_param("i", $effectiveLeagueId);
        $stmt->execute();
        $result = $stmt->get_result();
        
        $matchdays = [];
        $rowCount = 0;
        while ($row = $result->fetch_assoc()) {
            $matchdays[] = ['giornata' => (int)$row['giornata']];
            $rowCount++;
        }
        $stmt->close();
        error_log("GET /leagues/:id/votes/matchdays - Found $rowCount matchdays: " . json_encode($matchdays));
        
        // Trova l'ultima giornata con almeno un voto
        $ultima_giornata_con_voti = null;
        if (!empty($matchdays)) {
            $stmt = $conn->prepare("SELECT MAX(giornata) as ultima_giornata FROM player_ratings WHERE league_id = ? AND rating > 0");
            $stmt->bind_param("i", $effectiveLeagueId);
            $stmt->execute();
            $result = $stmt->get_result()->fetch_assoc();
            if ($result && $result['ultima_giornata']) {
                $ultima_giornata_con_voti = (int)$result['ultima_giornata'];
                error_log("GET /leagues/:id/votes/matchdays - Last matchday with votes: $ultima_giornata_con_voti");
            } else {
                error_log("GET /leagues/:id/votes/matchdays - No matchdays with votes found");
            }
            $stmt->close();
        } else {
            error_log("GET /leagues/:id/votes/matchdays - WARNING: No matchdays found in database for league $leagueId");
        }
        
        $response = [
            'matchdays' => $matchdays,
            'last_matchday_with_votes' => $ultima_giornata_con_voti
        ];
        $statusCode = 200;
        error_log("GET /leagues/:id/votes/matchdays - Response: " . json_encode($response));
        error_log("=== GET /leagues/:id/votes/matchdays - END ===");
    }
    // GET /leagues/:id/votes/players - Ottieni giocatori organizzati per squadra (admin/pagellatore only)
    elseif ($method === 'GET' && (strpos($path, '/leagues/') !== false && strpos($path, '/votes/players') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'votes' && isset($pathParts[3]) && $pathParts[3] === 'players'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'votes' && isset($pathParts[3]) && $pathParts[3] === 'players') {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/votes\/players/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin o pagellatore
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || !in_array($member['role'], ['admin', 'pagellatore'])) {
            throw new Exception('Solo amministratori e pagellatori possono inserire voti');
        }
        
        // Se la lega è collegata, leggi i giocatori dalla lega sorgente
        $effectiveLeagueId = getEffectiveLeagueId($leagueId);
        
        // Recupera le squadre e i giocatori della lega
        $stmt = $conn->prepare("SELECT t.id as team_id, t.name as team_name, p.id as player_id, p.first_name, p.last_name, p.role FROM teams t JOIN players p ON t.id = p.team_id WHERE t.league_id = ? ORDER BY t.name, p.role, p.last_name, p.first_name");
        $stmt->bind_param("i", $effectiveLeagueId);
        $stmt->execute();
        $result = $stmt->get_result();
        
        $squadre = [];
        while ($row = $result->fetch_assoc()) {
            $teamId = (int)$row['team_id'];
            if (!isset($squadre[$teamId])) {
                $squadre[$teamId] = [
                    'id' => $teamId,
                    'name' => $row['team_name'],
                    'players' => []
                ];
            }
            $squadre[$teamId]['players'][] = [
                'id' => (int)$row['player_id'],
                'first_name' => $row['first_name'],
                'last_name' => $row['last_name'],
                'role' => $row['role']
            ];
        }
        $stmt->close();
        
        // Converti in array numerico
        $response = array_values($squadre);
        $statusCode = 200;
    }
    // GET /leagues/:id/votes/:giornata - Ottieni voti già inseriti per una giornata (admin/pagellatore only)
    elseif ($method === 'GET' && strpos($path, '/leagues/') !== false && strpos($path, '/votes/') !== false && strpos($path, '/votes/matchdays') === false && strpos($path, '/votes/players') === false && preg_match('/\/leagues\/(\d+)\/votes\/(\d+)$/', $path)) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        $giornata = null;
        if (preg_match('/\/leagues\/(\d+)\/votes\/(\d+)$/', $path, $matches)) {
            $leagueId = (int)$matches[1];
            $giornata = (int)$matches[2];
        }
        
        if (!$leagueId || !$giornata) {
            throw new Exception('ID lega e giornata obbligatori');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin o pagellatore
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || !in_array($member['role'], ['admin', 'pagellatore'])) {
            throw new Exception('Solo amministratori e pagellatori possono inserire voti');
        }
        
        // Se la lega è collegata, leggi i voti dalla lega sorgente
        $effectiveLeagueId = getEffectiveLeagueId($leagueId);
        
        // Recupera i voti già inseriti per la giornata
        $stmt = $conn->prepare("SELECT player_id, rating, goals, assists, yellow_cards, red_cards, goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet FROM player_ratings WHERE league_id = ? AND giornata = ?");
        $stmt->bind_param("ii", $effectiveLeagueId, $giornata);
        $stmt->execute();
        $result = $stmt->get_result();
        
        $voti = [];
        while ($row = $result->fetch_assoc()) {
            $voti[(int)$row['player_id']] = [
                'rating' => floatval($row['rating']),
                'goals' => (int)$row['goals'],
                'assists' => (int)$row['assists'],
                'yellow_cards' => (int)$row['yellow_cards'],
                'red_cards' => (int)$row['red_cards'],
                'goals_conceded' => (int)($row['goals_conceded'] ?? 0),
                'own_goals' => (int)($row['own_goals'] ?? 0),
                'penalty_missed' => (int)($row['penalty_missed'] ?? 0),
                'penalty_saved' => (int)($row['penalty_saved'] ?? 0),
                'clean_sheet' => (int)($row['clean_sheet'] ?? 0)
            ];
        }
        $stmt->close();
        
        $response = $voti;
        $statusCode = 200;
    }
    // POST /leagues/:id/votes/:giornata - Salva voti per una giornata (admin/pagellatore only)
    elseif ($method === 'POST' && strpos($path, '/leagues/') !== false && strpos($path, '/votes/') !== false && preg_match('/\/leagues\/(\d+)\/votes\/(\d+)$/', $path)) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        $giornata = null;
        if (preg_match('/\/leagues\/(\d+)\/votes\/(\d+)$/', $path, $matches)) {
            $leagueId = (int)$matches[1];
            $giornata = (int)$matches[2];
        }
        
        if (!$leagueId || !$giornata) {
            throw new Exception('ID lega e giornata obbligatori');
        }
        
        // Blocca inserimento voti per leghe collegate
        if (isLinkedLeague($leagueId)) {
            throw new Exception('Non puoi inserire voti in una lega collegata a una lega ufficiale. I voti vengono gestiti dalla lega ufficiale.');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin o pagellatore
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || !in_array($member['role'], ['admin', 'pagellatore'])) {
            throw new Exception('Solo amministratori e pagellatori possono inserire voti');
        }
        
        $input = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($input['ratings']) || !is_array($input['ratings'])) {
            throw new Exception('Dati voti non validi');
        }
        
        $saveTeamOnly = isset($input['save_team_only']) ? (int)$input['save_team_only'] : null;
        $savedCount = 0;
        
        error_log("=== SAVE VOTES START === league=$leagueId giornata=$giornata saveTeamOnly=$saveTeamOnly totalRatings=" . count($input['ratings']));
        
        foreach ($input['ratings'] as $playerId => $ratingData) {
            $playerId = (int)$playerId;
            $rating = isset($ratingData['rating']) ? $ratingData['rating'] : null;
            
            error_log("SAVE_VOTE player=$playerId raw_rating=" . var_export($rating, true));
            
            if ($rating === null || $rating === '') {
                error_log("SAVE_VOTE player=$playerId SKIPPED (null or empty)");
                continue;
            }
            
            // Se stiamo salvando solo una squadra, controlla che il giocatore appartenga a quella squadra
            if ($saveTeamOnly) {
                $stmtTeam = $conn->prepare("SELECT t.id FROM players p JOIN teams t ON p.team_id = t.id WHERE p.id = ? AND t.id = ?");
                $stmtTeam->bind_param("ii", $playerId, $saveTeamOnly);
                $stmtTeam->execute();
                $teamCheckResult = $stmtTeam->get_result()->num_rows;
                $stmtTeam->close();
                if (!$teamCheckResult) {
                    error_log("SAVE_VOTE player=$playerId SKIPPED (not in team $saveTeamOnly)");
                    continue; // Salta questo giocatore se non appartiene alla squadra
                }
            }
            
            // Se S.V. (rating = 0), azzera bonus/malus
            if ($rating == 0 || $rating === '0') {
                $goals = 0;
                $assists = 0;
                $yellow = 0;
                $red = 0;
                $goals_conceded = 0;
                $own_goals = 0;
                $penalty_missed = 0;
                $penalty_saved = 0;
                $clean_sheet = 0;
            } else {
                $goals = isset($ratingData['goals']) ? (int)$ratingData['goals'] : 0;
                $assists = isset($ratingData['assists']) ? (int)$ratingData['assists'] : 0;
                $yellow = isset($ratingData['yellow_cards']) ? ((int)$ratingData['yellow_cards'] ? 1 : 0) : 0;
                $red = isset($ratingData['red_cards']) ? ((int)$ratingData['red_cards'] ? 1 : 0) : 0;
                $goals_conceded = isset($ratingData['goals_conceded']) ? (int)$ratingData['goals_conceded'] : 0;
                $own_goals = isset($ratingData['own_goals']) ? (int)$ratingData['own_goals'] : 0;
                $penalty_missed = isset($ratingData['penalty_missed']) ? (int)$ratingData['penalty_missed'] : 0;
                $penalty_saved = isset($ratingData['penalty_saved']) ? (int)$ratingData['penalty_saved'] : 0;
                $clean_sheet = isset($ratingData['clean_sheet']) ? ((int)$ratingData['clean_sheet'] ? 1 : 0) : 0;
            }
            
            $rating = floatval($rating);
            
            // Elimina eventuale voto precedente (evita duplicati se manca UNIQUE KEY)
            $stmt = $conn->prepare("DELETE FROM player_ratings WHERE player_id = ? AND giornata = ? AND league_id = ?");
            $stmt->bind_param("iii", $playerId, $giornata, $leagueId);
            $stmt->execute();
            $deletedRows = $stmt->affected_rows;
            $stmt->close();
            
            error_log("SAVE_VOTE player=$playerId DELETE old rows: $deletedRows deleted, now INSERT rating=$rating");
            
            // Inserisci il nuovo voto
            $stmt = $conn->prepare("INSERT INTO player_ratings (player_id, giornata, league_id, rating, goals, assists, yellow_cards, red_cards, goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->bind_param("iiidiiiiiiiii", $playerId, $giornata, $leagueId, $rating, $goals, $assists, $yellow, $red, $goals_conceded, $own_goals, $penalty_missed, $penalty_saved, $clean_sheet);
            
            if ($stmt->execute()) {
                $savedCount++;
                error_log("SAVE_VOTE player=$playerId INSERT OK");
            } else {
                error_log("SAVE_VOTE player=$playerId INSERT FAILED: " . $stmt->error);
            }
            $stmt->close();
        }
        
        error_log("=== SAVE VOTES END === savedCount=$savedCount");
        
        // Verifica: rileggi i voti appena salvati per confermare
        $stmt = $conn->prepare("SELECT player_id, rating FROM player_ratings WHERE league_id = ? AND giornata = ?");
        $stmt->bind_param("ii", $leagueId, $giornata);
        $stmt->execute();
        $verifyRes = $stmt->get_result();
        $verifyCount = 0;
        $duplicates = [];
        $playerCheck = [];
        while ($vr = $verifyRes->fetch_assoc()) {
            $pid = $vr['player_id'];
            if (isset($playerCheck[$pid])) {
                $duplicates[] = "player=$pid ratings=[{$playerCheck[$pid]}, {$vr['rating']}]";
            }
            $playerCheck[$pid] = $vr['rating'];
            $verifyCount++;
        }
        $stmt->close();
        error_log("SAVE_VOTES VERIFY: $verifyCount rows in player_ratings for league=$leagueId giornata=$giornata");
        if (!empty($duplicates)) {
            error_log("SAVE_VOTES WARNING DUPLICATES FOUND: " . implode(', ', $duplicates));
        }
        
        $response = ['message' => "Voti salvati con successo ($savedCount giocatori)", 'saved_count' => $savedCount];
        $statusCode = 200;
    }
    // GET /leagues/:id/settings - Ottieni impostazioni generali e bonus/malus (DEVE essere prima di GET /leagues/:id)
    elseif ($method === 'GET' && (strpos($path, '/settings') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'settings'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/settings/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono accedere alle impostazioni');
        }
        
        // Ottieni dati lega
        $league = getLeagueById($leagueId);
        if (!$league) {
            throw new Exception('Lega non trovata');
        }
        
        // Ottieni impostazioni bonus/malus
        $bonus_defaults = [
            'enable_bonus_malus' => 1,
            'enable_goal' => 1, 'bonus_goal' => 3.0,
            'enable_assist' => 1, 'bonus_assist' => 1.0,
            'enable_yellow_card' => 1, 'malus_yellow_card' => -0.5,
            'enable_red_card' => 1, 'malus_red_card' => -1.0,
            'enable_goals_conceded' => 1, 'malus_goals_conceded' => -1.0,
            'enable_own_goal' => 1, 'malus_own_goal' => -2.0,
            'enable_penalty_missed' => 1, 'malus_penalty_missed' => -3.0,
            'enable_penalty_saved' => 1, 'bonus_penalty_saved' => 3.0,
            'enable_clean_sheet' => 1, 'bonus_clean_sheet' => 1.0
        ];
        $bonus_settings = $bonus_defaults;
        $stmt = $conn->prepare("SELECT * FROM league_bonus_settings WHERE league_id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        if ($row = $res->fetch_assoc()) {
            $bonus_settings = array_merge($bonus_defaults, $row);
        }
        
        $response = [
            'default_deadline_time' => $league['default_deadline_time'] ?? '20:00',
            'access_code' => $league['access_code'] ?? null,
            'numero_titolari' => $league['numero_titolari'] ?? 11,
            'max_portieri' => $league['max_portieri'] ?? 3,
            'max_difensori' => $league['max_difensori'] ?? 8,
            'max_centrocampisti' => $league['max_centrocampisti'] ?? 8,
            'max_attaccanti' => $league['max_attaccanti'] ?? 6,
            'bonus_settings' => $bonus_settings,
            'auto_lineup_mode' => isset($league['auto_lineup_mode']) ? (int)$league['auto_lineup_mode'] : 0,
            'linked_to_league_id' => $league['linked_to_league_id'] ? (int)$league['linked_to_league_id'] : null
        ];
        
        // Aggiungi nome lega ufficiale collegata
        if ($league['linked_to_league_id']) {
            $linkedStmt = $conn->prepare("SELECT name FROM leagues WHERE id = ?");
            $linkedStmt->bind_param("i", $league['linked_to_league_id']);
            $linkedStmt->execute();
            $linkedLeague = $linkedStmt->get_result()->fetch_assoc();
            $linkedStmt->close();
            if ($linkedLeague) {
                $response['linked_league_name'] = $linkedLeague['name'];
            }
        }
        
        $statusCode = 200;
    }
    // PUT /leagues/:id/settings - Aggiorna impostazioni generali (DEVE essere prima di GET /leagues/:id)
    elseif ($method === 'PUT' && (strpos($path, '/settings') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'settings'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/settings/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono modificare le impostazioni');
        }
        
        $input = json_decode(file_get_contents('php://input'), true);
        
        $default_time = $input['default_deadline_time'] ?? '20:00';
        $max_portieri = isset($input['max_portieri']) ? (int)$input['max_portieri'] : 3;
        $max_difensori = isset($input['max_difensori']) ? (int)$input['max_difensori'] : 8;
        $max_centrocampisti = isset($input['max_centrocampisti']) ? (int)$input['max_centrocampisti'] : 8;
        $max_attaccanti = isset($input['max_attaccanti']) ? (int)$input['max_attaccanti'] : 6;
        $numero_titolari = isset($input['numero_titolari']) ? (int)$input['numero_titolari'] : 11;
        $access_code = isset($input['access_code']) ? trim($input['access_code']) : null;
        if ($access_code === '') $access_code = null;
        
        // Validazione
        if ($numero_titolari < 4 || $numero_titolari > 11) {
            throw new Exception('Numero titolari deve essere tra 4 e 11');
        }
        
        $stmt = $conn->prepare("UPDATE leagues SET default_deadline_time = ?, max_portieri = ?, max_difensori = ?, max_centrocampisti = ?, max_attaccanti = ?, access_code = ?, numero_titolari = ? WHERE id = ?");
        $stmt->bind_param("siiiisii", $default_time, $max_portieri, $max_difensori, $max_centrocampisti, $max_attaccanti, $access_code, $numero_titolari, $leagueId);
        
        if (!$stmt->execute()) {
            throw new Exception('Errore durante l\'aggiornamento delle impostazioni');
        }
        
        $response = ['message' => 'Impostazioni aggiornate con successo'];
        $statusCode = 200;
    }
    // PUT /leagues/:id/bonus-settings - Aggiorna impostazioni bonus/malus (DEVE essere prima di GET /leagues/:id)
    elseif ($method === 'PUT' && (strpos($path, '/bonus-settings') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'bonus-settings'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/bonus-settings/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono modificare le impostazioni');
        }
        
        $input = json_decode(file_get_contents('php://input'), true);
        
        // Funzione per parse decimali (1 cifra dopo la virgola)
        function parse_decimal($val, $default) {
            if (!isset($val) || $val === '') return $default;
            $val = str_replace(',', '.', trim($val));
            if (!is_numeric($val)) return $default;
            return round(floatval($val), 1);
        }
        
        $bonus_settings = [
            'enable_bonus_malus' => isset($input['enable_bonus_malus']) ? ($input['enable_bonus_malus'] ? 1 : 0) : 1,
            'enable_goal' => isset($input['enable_goal']) ? ($input['enable_goal'] ? 1 : 0) : 1,
            'bonus_goal' => parse_decimal($input['bonus_goal'] ?? null, 3.0),
            'enable_assist' => isset($input['enable_assist']) ? ($input['enable_assist'] ? 1 : 0) : 1,
            'bonus_assist' => parse_decimal($input['bonus_assist'] ?? null, 1.0),
            'enable_yellow_card' => isset($input['enable_yellow_card']) ? ($input['enable_yellow_card'] ? 1 : 0) : 1,
            'malus_yellow_card' => parse_decimal($input['malus_yellow_card'] ?? null, -0.5),
            'enable_red_card' => isset($input['enable_red_card']) ? ($input['enable_red_card'] ? 1 : 0) : 1,
            'malus_red_card' => parse_decimal($input['malus_red_card'] ?? null, -1.0),
            'enable_goals_conceded' => isset($input['enable_goals_conceded']) ? ($input['enable_goals_conceded'] ? 1 : 0) : 1,
            'malus_goals_conceded' => parse_decimal($input['malus_goals_conceded'] ?? null, -1.0),
            'enable_own_goal' => isset($input['enable_own_goal']) ? ($input['enable_own_goal'] ? 1 : 0) : 1,
            'malus_own_goal' => parse_decimal($input['malus_own_goal'] ?? null, -2.0),
            'enable_penalty_missed' => isset($input['enable_penalty_missed']) ? ($input['enable_penalty_missed'] ? 1 : 0) : 1,
            'malus_penalty_missed' => parse_decimal($input['malus_penalty_missed'] ?? null, -3.0),
            'enable_penalty_saved' => isset($input['enable_penalty_saved']) ? ($input['enable_penalty_saved'] ? 1 : 0) : 1,
            'bonus_penalty_saved' => parse_decimal($input['bonus_penalty_saved'] ?? null, 3.0),
            'enable_clean_sheet' => isset($input['enable_clean_sheet']) ? ($input['enable_clean_sheet'] ? 1 : 0) : 1,
            'bonus_clean_sheet' => parse_decimal($input['bonus_clean_sheet'] ?? null, 1.0)
        ];
        
        $stmt = $conn->prepare("REPLACE INTO league_bonus_settings (league_id, enable_bonus_malus, enable_goal, bonus_goal, enable_assist, bonus_assist, enable_yellow_card, malus_yellow_card, enable_red_card, malus_red_card, enable_goals_conceded, malus_goals_conceded, enable_own_goal, malus_own_goal, enable_penalty_missed, malus_penalty_missed, enable_penalty_saved, bonus_penalty_saved, enable_clean_sheet, bonus_clean_sheet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->bind_param(
            "iiididididididididid",
            $leagueId,
            $bonus_settings['enable_bonus_malus'],
            $bonus_settings['enable_goal'],
            $bonus_settings['bonus_goal'],
            $bonus_settings['enable_assist'],
            $bonus_settings['bonus_assist'],
            $bonus_settings['enable_yellow_card'],
            $bonus_settings['malus_yellow_card'],
            $bonus_settings['enable_red_card'],
            $bonus_settings['malus_red_card'],
            $bonus_settings['enable_goals_conceded'],
            $bonus_settings['malus_goals_conceded'],
            $bonus_settings['enable_own_goal'],
            $bonus_settings['malus_own_goal'],
            $bonus_settings['enable_penalty_missed'],
            $bonus_settings['malus_penalty_missed'],
            $bonus_settings['enable_penalty_saved'],
            $bonus_settings['bonus_penalty_saved'],
            $bonus_settings['enable_clean_sheet'],
            $bonus_settings['bonus_clean_sheet']
        );
        
        if (!$stmt->execute()) {
            throw new Exception('Errore durante il salvataggio delle impostazioni bonus/malus');
        }
        
        $response = ['message' => 'Impostazioni bonus/malus salvate con successo'];
        $statusCode = 200;
    }
    // GET /leagues/:id/teams - Ottieni lista squadre reali della lega con conteggio giocatori (admin only) - DEVE essere prima di GET /leagues/:id
    elseif ($method === 'GET' && (strpos($path, '/leagues/') !== false && strpos($path, '/teams') !== false && strpos($path, '/teams/') === false && strpos($path, '/csv') === false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && !isset($pathParts[3])))) {
        ensureTeamsLogoColumn();
        ensureTeamsJerseyColorColumn();
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/teams/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono accedere alle squadre');
        }
        
        // Se la lega è collegata a una ufficiale, leggi i teams dalla lega sorgente
        $effectiveLeagueId = getEffectiveLeagueId($leagueId);
        
        // Recupera le squadre con conteggio giocatori
        $stmt = $conn->prepare("
            SELECT t.id, t.name, t.logo_path, t.jersey_color, COUNT(p.id) as player_count 
            FROM teams t 
            LEFT JOIN players p ON t.id = p.team_id 
            WHERE t.league_id = ?
            GROUP BY t.id, t.name, t.logo_path, t.jersey_color
            ORDER BY t.name
        ");
        $stmt->bind_param("i", $effectiveLeagueId);
        $stmt->execute();
        $result = $stmt->get_result();
        
        $teams = [];
        while ($row = $result->fetch_assoc()) {
            $lpRaw = normalizeTeamLogoPathForApi($row['logo_path'] ?? '');
            $lpPath = null;
            $lpUrl = null;
            if ($lpRaw !== null) {
                if (preg_match('#^https?://#i', $lpRaw)) {
                    $lpUrl = $lpRaw;
                } else {
                    $lpPath = $lpRaw;
                    $lpUrl = publicUrlForStoragePath($lpRaw);
                }
            }
            $jc = normalizeJerseyColorForApi($row['jersey_color'] ?? '');
            $teams[] = [
                'id' => (int)$row['id'],
                'name' => $row['name'],
                'logo_path' => $lpPath,
                'logo_url' => $lpUrl,
                'jersey_color' => $jc,
                'player_count' => (int)$row['player_count']
            ];
        }
        $stmt->close();
        
        // Assicurati che la risposta sia sempre un array
        if (!is_array($teams)) {
            $teams = [];
        }
        $response = $teams;
        $statusCode = 200;
    }
    // GET /leagues/:id/matchdays - Ottieni lista giornate della lega (admin only) - DEVE essere prima di GET /leagues/:id
    // NOTA: Deve escludere /votes/matchdays per non intercettare l'endpoint dei voti
    elseif ($method === 'GET' && (strpos($path, '/leagues/') !== false && strpos($path, '/matchdays') !== false && strpos($path, '/votes/matchdays') === false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'matchdays' && (!isset($pathParts[3]) || $pathParts[3] !== 'votes')))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/matchdays/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono accedere al calendario');
        }
        
        // Se la lega è collegata, leggi le giornate dalla lega sorgente
        $effectiveLeagueId = getEffectiveLeagueId($leagueId);
        
        // Recupera le giornate ordinate per deadline
        $stmt = $conn->prepare("SELECT id, giornata, deadline FROM matchdays WHERE league_id = ? ORDER BY deadline ASC");
        $stmt->bind_param("i", $effectiveLeagueId);
        $stmt->execute();
        $result = $stmt->get_result();
        
        $matchdays = [];
        while ($row = $result->fetch_assoc()) {
            $deadline = new DateTime($row['deadline']);
            $matchdays[] = [
                'id' => (int)$row['id'],
                'giornata' => (int)$row['giornata'],
                'deadline' => $row['deadline'],
                'deadline_date' => $deadline->format('Y-m-d'),
                'deadline_time' => $deadline->format('H:i')
            ];
        }
        $stmt->close();
        
        $response = $matchdays;
        $statusCode = 200;
    }
    // GET /leagues/:id/team-info/check - Verifica se l'utente ha bisogno di inserire team_name e coach_name (DEVE essere prima di GET /leagues/:id)
    elseif ($method === 'GET' && (strpos($path, '/team-info/check') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'team-info' && isset($pathParts[3]) && $pathParts[3] === 'check'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Estrai leagueId dal path: /leagues/:id/team-info/check
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            // Prova a estrarre dall'URL completo
            if (preg_match('/\/leagues\/(\d+)\/team-info\/check/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        
        error_log("GET /leagues/:id/team-info/check - UserId: $userId, LeagueId: $leagueId");
        
        $needsInfo = needsTeamInfo($userId, $leagueId);
        
        error_log("GET /leagues/:id/team-info/check - needsInfo result: " . ($needsInfo ? 'true' : 'false'));
        
        if ($needsInfo) {
            // Calcola i valori di default
            $defaultTeamNumber = getNextDefaultTeamNumber($leagueId);
            $defaultCoachNumber = getNextDefaultCoachNumber($leagueId);
            
            error_log("GET /leagues/:id/team-info/check - Default team: Squadra $defaultTeamNumber, Default coach: Allenatore $defaultCoachNumber");
            
            $response = [
                'needs_info' => true,
                'default_team_name' => "Squadra $defaultTeamNumber",
                'default_coach_name' => "Allenatore $defaultCoachNumber"
            ];
        } else {
            $response = [
                'needs_info' => false
            ];
        }
        
        $statusCode = 200;
    }
    // GET /leagues/:id - Ottieni dettagli lega
    elseif ($method === 'GET' && (strpos($path, '/leagues/') !== false && strpos($path, '/user-stats') === false && strpos($path, '/standings/full') === false && strpos($path, '/standings/matchday/') === false && strpos($path, '/standings') === false && strpos($path, '/team-info') === false && strpos($path, '/members') === false && strpos($path, '/leave') === false && strpos($path, '/settings') === false && strpos($path, '/teams') === false && strpos($path, '/matchdays') === false && strpos($path, '/votes') === false && strpos($path, '/csv') === false && strpos($path, '/join-requests') === false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && $pathParts[1] !== 'search' && $pathParts[1] !== 'standings' && $pathParts[1] !== 'user-stats' && is_numeric($pathParts[1]) && (!isset($pathParts[2]) || ($pathParts[2] !== 'standings' && $pathParts[2] !== 'team-info' && $pathParts[2] !== 'members' && $pathParts[2] !== 'leave' && $pathParts[2] !== 'settings' && $pathParts[2] !== 'bonus-settings' && $pathParts[2] !== 'teams' && $pathParts[2] !== 'matchdays' && $pathParts[2] !== 'csv' && $pathParts[2] !== 'join-requests'))))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Estrai leagueId dal path: /leagues/:id
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            // Prova a estrarre dall'URL completo
            if (preg_match('/\/leagues\/(\d+)/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            error_log("GET /leagues/:id - Path: $path, PathParts: " . json_encode($pathParts));
            throw new Exception('ID lega non valido');
        }
        
        error_log("GET /leagues/:id - LeagueId: $leagueId");
        $conn = getDbConnection();
        $league = getLeagueById($leagueId);
        
        error_log("GET /leagues/:id - League data: " . json_encode($league));
        
        if (!$league) {
            error_log("GET /leagues/:id - League not found for ID: $leagueId");
            throw new Exception('Lega non trovata');
        }
        
        // Verifica se l'utente è membro (opzionale, per mostrare il ruolo)
        $userId = $decoded['userId'];
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        error_log("GET /leagues/:id - User $userId is member: " . ($member ? 'yes (role: ' . $member['role'] . ')' : 'no'));
        
        if ($member) {
            $league['role'] = $member['role'];
        }
        
        // Recupera team_name, coach_name e team_logo dell'utente per questa lega
        $budgetStmt = $conn->prepare("SELECT team_name, coach_name, team_logo FROM user_budget WHERE user_id = ? AND league_id = ?");
        $budgetStmt->bind_param("ii", $userId, $leagueId);
        $budgetStmt->execute();
        $budgetRow = $budgetStmt->get_result()->fetch_assoc();
        $budgetStmt->close();
        
        error_log("GET /leagues/:id - User budget row: " . json_encode($budgetRow));
        
        $league['team_name'] = $budgetRow ? ($budgetRow['team_name'] ?? '') : '';
        $league['coach_name'] = $budgetRow ? ($budgetRow['coach_name'] ?? '') : '';
        
        // Se team_logo è null o vuoto, imposta default_1
        // IMPORTANTE: Non sovrascrivere se esiste già un logo (personalizzato o default)
        $teamLogo = $budgetRow ? ($budgetRow['team_logo'] ?? null) : null;
        if ($teamLogo === null || $teamLogo === '' || trim($teamLogo) === '') {
            // Solo se è veramente null/vuoto, imposta default_1
            $teamLogo = 'default_1';
            // Aggiorna il database se il logo era null
            $updateLogoStmt = $conn->prepare("UPDATE user_budget SET team_logo = ? WHERE user_id = ? AND league_id = ?");
            $updateLogoStmt->bind_param("sii", $teamLogo, $userId, $leagueId);
            $updateLogoStmt->execute();
            $updateLogoStmt->close();
        }
        // Restituisci sempre il logo (personalizzato o default) - NON sovrascrivere se esiste già
        $league['team_logo'] = $teamLogo;
        error_log("GET /leagues/:id - team_logo: " . $teamLogo . " (from DB: " . ($budgetRow ? ($budgetRow['team_logo'] ?? 'NULL') : 'NULL') . ")");
        
        // Assicurati che il nome sia presente nella risposta
        if (!isset($league['name']) || empty($league['name'])) {
            error_log("WARNING: League ID $leagueId has no name! League data: " . json_encode($league));
        }
        
        // Aggiungi info sulla lega ufficiale collegata
        if (isset($league['linked_to_league_id']) && $league['linked_to_league_id']) {
            $linkedStmt = $conn->prepare("SELECT id, name FROM leagues WHERE id = ?");
            $linkedStmt->bind_param("i", $league['linked_to_league_id']);
            $linkedStmt->execute();
            $linkedLeague = $linkedStmt->get_result()->fetch_assoc();
            $linkedStmt->close();
            if ($linkedLeague) {
                $league['linked_league_name'] = $linkedLeague['name'];
            }
        }
        
        // Restituisci sempre i dati della lega, anche se l'utente non è membro
        $response = $league;
        $statusCode = 200;
    }
    // PUT /leagues/:id/team-info - Aggiorna nome squadra e allenatore (DEVE essere prima di POST /leagues/:id/prefs)
    elseif ($method === 'PUT' && (strpos($path, '/team-info') !== false || (isset($pathParts[2]) && $pathParts[2] === 'team-info'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Estrai leagueId dal path: /leagues/:id/team-info
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            // Prova a estrarre dall'URL completo
            if (preg_match('/\/leagues\/(\d+)\/team-info/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) {
            throw new Exception('Dati non validi');
        }
        
        $teamName = isset($data['team_name']) ? trim($data['team_name']) : '';
        $coachName = isset($data['coach_name']) ? trim($data['coach_name']) : '';
        
        if (empty($teamName) || empty($coachName)) {
            throw new Exception('Nome squadra e nome allenatore sono obbligatori');
        }
        
        $userId = $decoded['userId'];
        
        error_log("PUT /leagues/:id/team-info - UserId: $userId, LeagueId: $leagueId");
        error_log("PUT /leagues/:id/team-info - TeamName: $teamName, CoachName: $coachName");
        
        $result = updateTeamInfo($userId, $leagueId, $teamName, $coachName);
        
        error_log("PUT /leagues/:id/team-info - Update result: " . ($result === true ? 'success' : ($result === 'name_exists' ? 'name_exists' : 'error')));
        
        if ($result === true) {
            // Verifica che i dati siano stati salvati correttamente
            $conn = getDbConnection();
            $verifyStmt = $conn->prepare("SELECT team_name, coach_name FROM user_budget WHERE user_id = ? AND league_id = ?");
            $verifyStmt->bind_param("ii", $userId, $leagueId);
            $verifyStmt->execute();
            $verifyRow = $verifyStmt->get_result()->fetch_assoc();
            $verifyStmt->close();
            
            error_log("PUT /leagues/:id/team-info - Verified saved data - team_name: " . ($verifyRow['team_name'] ?? 'NULL') . ", coach_name: " . ($verifyRow['coach_name'] ?? 'NULL'));
            
            $response = ['message' => 'Informazioni squadra aggiornate con successo', 'leagueId' => $leagueId];
            $statusCode = 200;
        } elseif ($result === 'name_exists') {
            throw new Exception('Nome squadra o nome allenatore già utilizzato in questa lega');
        } else {
            throw new Exception('Errore nell\'aggiornamento delle informazioni');
        }
    }
    // POST /leagues/:id/team-info/logo/default - Seleziona logo di default (DEVE essere PRIMA di POST /team-info/logo)
    // Controllo esplicito e prioritario per /default
    elseif ($method === 'POST' && (
            strpos($path, '/team-info/logo/default') !== false || 
            (isset($pathParts[2]) && $pathParts[2] === 'team-info' && 
             isset($pathParts[3]) && $pathParts[3] === 'logo' && 
             isset($pathParts[4]) && $pathParts[4] === 'default')
        )) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Estrai leagueId dal path: /leagues/:id/team-info/logo/default
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/team-info\/logo\/default/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data || !isset($data['logo_id'])) {
            throw new Exception('Logo ID obbligatorio');
        }
        
        $logoId = trim($data['logo_id']);
        // Valida che sia un logo di default (default_1, default_2, ecc.)
        if (!preg_match('/^default_\d+$/', $logoId)) {
            throw new Exception('Logo ID non valido');
        }
        
        $userId = $decoded['userId'];
        
        // Recupera vecchio logo personalizzato se esiste per eliminarlo
        $conn = getDbConnection();
        $oldLogoStmt = $conn->prepare("SELECT team_logo FROM user_budget WHERE user_id = ? AND league_id = ?");
        $oldLogoStmt->bind_param("ii", $userId, $leagueId);
        $oldLogoStmt->execute();
        $oldLogoResult = $oldLogoStmt->get_result()->fetch_assoc();
        $oldLogoPath = $oldLogoResult ? ($oldLogoResult['team_logo'] ?? null) : null;
        $oldLogoStmt->close();
        
        // Elimina vecchio logo personalizzato se esiste (non i default)
        if ($oldLogoPath && strpos($oldLogoPath, 'default_') !== 0 && file_exists(__DIR__ . '/' . $oldLogoPath)) {
            @unlink(__DIR__ . '/' . $oldLogoPath);
        }
        
        // Aggiorna database con il nuovo logo di default
        $updateStmt = $conn->prepare("UPDATE user_budget SET team_logo = ? WHERE user_id = ? AND league_id = ?");
        $updateStmt->bind_param("sii", $logoId, $userId, $leagueId);
        $updateStmt->execute();
        $updateStmt->close();
        
        $response = ['message' => 'Logo selezionato con successo', 'logo_path' => $logoId];
        $statusCode = 200;
    }
    // POST /leagues/:id/team-info/logo - Upload logo squadra
    // IMPORTANTE: Escludere esplicitamente /default per evitare che intercetti la selezione logo default
    elseif ($method === 'POST' && 
            strpos($path, '/team-info/logo/default') === false && // Escludi /default
            (strpos($path, '/team-info/logo') !== false || (isset($pathParts[2]) && $pathParts[2] === 'team-info' && isset($pathParts[3]) && $pathParts[3] === 'logo' && (!isset($pathParts[4]) || $pathParts[4] !== 'default')))) {
        
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Estrai leagueId dal path: /leagues/:id/team-info/logo
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/team-info\/logo/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        
        // Verifica se è multipart/form-data
        if (empty($_FILES) || !isset($_FILES['logo'])) {
            throw new Exception('Nessun file caricato');
        }
        
        $file = $_FILES['logo'];
        
        // Validazione file
        if ($file['error'] !== UPLOAD_ERR_OK) {
            throw new Exception('Errore nel caricamento del file');
        }
        
        // Validazione tipo file (solo JPG e PNG)
        $allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mimeType = finfo_file($finfo, $file['tmp_name']);
        // finfo_close() non è più necessario in PHP 8.1+ - la risorsa viene chiusa automaticamente
        
        if (!in_array($mimeType, $allowedTypes)) {
            throw new Exception('Formato file non supportato. Usa JPG o PNG');
        }
        
        // Validazione dimensione (max 2MB)
        if ($file['size'] > 2 * 1024 * 1024) {
            throw new Exception('File troppo grande. Massimo 2MB');
        }
        
        // Crea directory uploads/team_logos se non esiste
        $uploadDir = __DIR__ . '/uploads/team_logos/';
        if (!file_exists($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }
        
        // Recupera vecchio logo se esiste per eliminarlo dopo
        $conn = getDbConnection();
        $oldLogoStmt = $conn->prepare("SELECT team_logo FROM user_budget WHERE user_id = ? AND league_id = ?");
        $oldLogoStmt->bind_param("ii", $userId, $leagueId);
        $oldLogoStmt->execute();
        $oldLogoResult = $oldLogoStmt->get_result()->fetch_assoc();
        $oldLogoPath = $oldLogoResult ? ($oldLogoResult['team_logo'] ?? null) : null;
        $oldLogoStmt->close();
        
        // Genera nome file unico
        $extension = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if ($extension === 'jpg') $extension = 'jpeg';
        $filename = 'logo_' . $userId . '_' . $leagueId . '_' . time() . '.' . $extension;
        $filepath = $uploadDir . $filename;
        $relativePath = 'uploads/team_logos/' . $filename;
        
        // Carica immagine e ridimensiona a 200x200px
        if ($mimeType === 'image/png') {
            $sourceImage = imagecreatefrompng($file['tmp_name']);
        } else {
            $sourceImage = imagecreatefromjpeg($file['tmp_name']);
        }
        
        if (!$sourceImage) {
            throw new Exception('Errore nella lettura dell\'immagine');
        }
        
        $originalWidth = imagesx($sourceImage);
        $originalHeight = imagesy($sourceImage);
        
        // Crea immagine ridimensionata 200x200px (mantenendo proporzioni, con crop centrato)
        $targetSize = 200;
        $targetImage = imagecreatetruecolor($targetSize, $targetSize);
        
        // Calcola crop per mantenere proporzioni
        $ratio = min($targetSize / $originalWidth, $targetSize / $originalHeight);
        $newWidth = $originalWidth * $ratio;
        $newHeight = $originalHeight * $ratio;
        $x = ($targetSize - $newWidth) / 2;
        $y = ($targetSize - $newHeight) / 2;
        
        // Riempie sfondo bianco
        $white = imagecolorallocate($targetImage, 255, 255, 255);
        imagefill($targetImage, 0, 0, $white);
        
        // Ridimensiona con mantenimento proporzioni
        imagecopyresampled($targetImage, $sourceImage, $x, $y, 0, 0, $newWidth, $newHeight, $originalWidth, $originalHeight);
        
        // Salva immagine ridimensionata
        if ($mimeType === 'image/png') {
            imagepng($targetImage, $filepath);
        } else {
            imagejpeg($targetImage, $filepath, 90);
        }
        
        // imagedestroy() non è più necessario in PHP 8.1+ - le risorse vengono liberate automaticamente
        
        // Aggiorna database
        $updateStmt = $conn->prepare("UPDATE user_budget SET team_logo = ? WHERE user_id = ? AND league_id = ?");
        $updateStmt->bind_param("sii", $relativePath, $userId, $leagueId);
        $updateStmt->execute();
        $updateStmt->close();
        
        // Elimina vecchio logo se esiste (solo se non è un logo di default)
        if ($oldLogoPath && strpos($oldLogoPath, 'default_') !== 0 && file_exists(__DIR__ . '/' . $oldLogoPath)) {
            @unlink(__DIR__ . '/' . $oldLogoPath);
        }
        
        $response = ['message' => 'Logo caricato con successo', 'logo_path' => $relativePath];
        $statusCode = 200;
    }
    // DELETE /leagues/:id/team-info/logo - Rimuovi logo squadra
    elseif ($method === 'DELETE' && (strpos($path, '/team-info/logo') !== false || (isset($pathParts[2]) && $pathParts[2] === 'team-info' && isset($pathParts[3]) && $pathParts[3] === 'logo'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Estrai leagueId dal path: /leagues/:id/team-info/logo
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/team-info\/logo/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        
        // Recupera path del logo attuale
        $conn = getDbConnection();
        $logoStmt = $conn->prepare("SELECT team_logo FROM user_budget WHERE user_id = ? AND league_id = ?");
        $logoStmt->bind_param("ii", $userId, $leagueId);
        $logoStmt->execute();
        $logoResult = $logoStmt->get_result()->fetch_assoc();
        $logoPath = $logoResult ? ($logoResult['team_logo'] ?? null) : null;
        $logoStmt->close();
        
        // Elimina file se esiste (solo se non è un logo di default)
        if ($logoPath && strpos($logoPath, 'default_') !== 0 && file_exists(__DIR__ . '/' . $logoPath)) {
            @unlink(__DIR__ . '/' . $logoPath);
        }
        
        // Aggiorna database - se era un logo personalizzato, imposta il primo default
        if ($logoPath && strpos($logoPath, 'default_') !== 0) {
            // Era un logo personalizzato: imposta il primo logo di default
            $defaultLogo = 'default_1';
            $updateStmt = $conn->prepare("UPDATE user_budget SET team_logo = ? WHERE user_id = ? AND league_id = ?");
            $updateStmt->bind_param("sii", $defaultLogo, $userId, $leagueId);
        } else {
            // Era già un default o null: imposta default_1
            $defaultLogo = 'default_1';
            $updateStmt = $conn->prepare("UPDATE user_budget SET team_logo = ? WHERE user_id = ? AND league_id = ?");
            $updateStmt->bind_param("sii", $defaultLogo, $userId, $leagueId);
        }
        $updateStmt->execute();
        $updateStmt->close();
        
        $response = ['message' => 'Logo rimosso con successo', 'logo_path' => 'default_1'];
        $statusCode = 200;
    }
    // POST /leagues/:id/prefs - Aggiorna preferenze lega (DEVE essere prima di POST /leagues)
    elseif ($method === 'POST' && (strpos($path, '/prefs') !== false || (isset($pathParts[2]) && $pathParts[2] === 'prefs'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Estrai leagueId dal path: /leagues/:id/prefs
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            // Prova a estrarre dall'URL completo
            if (preg_match('/\/leagues\/(\d+)\/prefs/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) {
            throw new Exception('Dati non validi');
        }
        
        $favorite = isset($data['favorite']) ? (int)$data['favorite'] : 0;
        $archived = isset($data['archived']) ? (int)$data['archived'] : 0;
        $userId = $decoded['userId'];

        ensureUserLeaguePrefsNotificationsColumn();
        $conn = getDbConnection();
        $notifEnabled = null;
        if (isset($data['notifications_enabled'])) {
            $notifEnabled = (int)$data['notifications_enabled'] ? 1 : 0;
        } else {
            $prefStmt = $conn->prepare("SELECT notifications_enabled FROM user_league_prefs WHERE user_id = ? AND league_id = ? LIMIT 1");
            $prefStmt->bind_param("ii", $userId, $leagueId);
            $prefStmt->execute();
            $prefRow = $prefStmt->get_result()->fetch_assoc();
            $prefStmt->close();
            $notifEnabled = ($prefRow && isset($prefRow['notifications_enabled'])) ? (int)$prefRow['notifications_enabled'] : 1;
        }

        setUserLeaguePref($userId, $leagueId, $favorite, $archived, $notifEnabled);
        
        $response = ['message' => 'Preferenze aggiornate'];
        $statusCode = 200;
    }
    // POST /leagues - Crea nuova lega
    elseif ($method === 'POST' && 
            strpos($path, '/leagues') !== false && 
            strpos($path, '/prefs') === false && 
            strpos($path, '/join') === false && 
            strpos($path, '/leave') === false &&
            (isset($pathParts[0]) && $pathParts[0] === 'leagues' && !isset($pathParts[1]))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        if (!isset($data['name']) || trim($data['name']) === '') {
            throw new Exception('Nome lega obbligatorio');
        }
        
        // Verifica se esiste già una lega con lo stesso nome
        $conn = getDbConnection();
        $checkStmt = $conn->prepare("SELECT id FROM leagues WHERE name = ?");
        $checkStmt->bind_param("s", $data['name']);
        $checkStmt->execute();
        if ($checkStmt->get_result()->num_rows > 0) {
            $checkStmt->close();
            throw new Exception('Esiste già una lega con questo nome');
        }
        $checkStmt->close();
        
        // Verifica se esiste già una lega con lo stesso codice di accesso
        if (isset($data['accessCode']) && $data['accessCode'] !== '' && $data['accessCode'] !== null) {
            $checkCodeStmt = $conn->prepare("SELECT id FROM leagues WHERE access_code = ?");
            $checkCodeStmt->bind_param("s", $data['accessCode']);
            $checkCodeStmt->execute();
            if ($checkCodeStmt->get_result()->num_rows > 0) {
                $checkCodeStmt->close();
                throw new Exception('Esiste già una lega con questo codice di accesso');
            }
            $checkCodeStmt->close();
        }
        
        $name = trim($data['name']);
        $accessCode = isset($data['accessCode']) && $data['accessCode'] !== '' ? trim($data['accessCode']) : null;
        $initialBudget = isset($data['initialBudget']) ? (int)$data['initialBudget'] : 100;
        $defaultTime = isset($data['defaultTime']) ? $data['defaultTime'] : '20:00';
        $maxPortieri = isset($data['maxPortieri']) ? (int)$data['maxPortieri'] : 3;
        $maxDifensori = isset($data['maxDifensori']) ? (int)$data['maxDifensori'] : 8;
        $maxCentrocampisti = isset($data['maxCentrocampisti']) ? (int)$data['maxCentrocampisti'] : 8;
        $maxAttaccanti = isset($data['maxAttaccanti']) ? (int)$data['maxAttaccanti'] : 6;
        $numeroTitolari = isset($data['numeroTitolari']) ? (int)$data['numeroTitolari'] : 11;
        $autoLineupMode = isset($data['autoLineupMode']) ? (int)$data['autoLineupMode'] : 0;
        
        // Gestione bonus/malus settings
        $bonusSettings = null;
        if (isset($data['bonusSettings']) && $data['bonusSettings'] !== null) {
            $incomingBonus = is_array($data['bonusSettings']) ? $data['bonusSettings'] : [];
            $bonusDefaults = [
                'enable_bonus_malus' => 1,
                'enable_goal' => 1,
                'bonus_goal' => 3.0,
                'enable_assist' => 1,
                'bonus_assist' => 1.0,
                'enable_yellow_card' => 1,
                'malus_yellow_card' => -0.5,
                'enable_red_card' => 1,
                'malus_red_card' => -1.0,
                'enable_goals_conceded' => 1,
                'malus_goals_conceded' => -1.0,
                'enable_own_goal' => 1,
                'malus_own_goal' => -2.0,
                'enable_penalty_missed' => 1,
                'malus_penalty_missed' => -3.0,
                'enable_penalty_saved' => 1,
                'bonus_penalty_saved' => 3.0,
                'enable_clean_sheet' => 1,
                'bonus_clean_sheet' => 1.0,
            ];
            $bonusSettings = array_merge($bonusDefaults, $incomingBonus);

            // Normalizza tipi per evitare salvataggi errati a 0 su host legacy.
            $intKeys = [
                'enable_bonus_malus', 'enable_goal', 'enable_assist', 'enable_yellow_card', 'enable_red_card',
                'enable_goals_conceded', 'enable_own_goal', 'enable_penalty_missed', 'enable_penalty_saved', 'enable_clean_sheet'
            ];
            $floatKeys = [
                'bonus_goal', 'bonus_assist', 'malus_yellow_card', 'malus_red_card',
                'malus_goals_conceded', 'malus_own_goal', 'malus_penalty_missed', 'bonus_penalty_saved', 'bonus_clean_sheet'
            ];
            foreach ($intKeys as $k) {
                $bonusSettings[$k] = (int)$bonusSettings[$k];
            }
            foreach ($floatKeys as $k) {
                $bonusSettings[$k] = (float)$bonusSettings[$k];
            }
        }
        
        // Gestione collegamento a lega ufficiale
        $linkedToLeagueId = null;
        if (isset($data['linked_to_league_id']) && $data['linked_to_league_id'] !== null) {
            $linkedToLeagueId = (int)$data['linked_to_league_id'];
            
            // Validare che la lega referenziata esista e sia ufficiale e visibile per il collegamento
            $checkLinkedStmt = $conn->prepare("SELECT id FROM leagues WHERE id = ? AND is_official = 1 AND is_visible_for_linking = 1");
            $checkLinkedStmt->bind_param("i", $linkedToLeagueId);
            $checkLinkedStmt->execute();
            if (!$checkLinkedStmt->get_result()->num_rows) {
                $checkLinkedStmt->close();
                throw new Exception('La lega ufficiale selezionata non è disponibile per il collegamento');
            }
            $checkLinkedStmt->close();
        }
        
        // Usa la funzione PHP esistente
        startSession();
        $_SESSION['user_id'] = $decoded['userId'];
        $_SESSION['username'] = $decoded['username'];
        
        $leagueId = createLeague(
            $name,
            $accessCode,
            $initialBudget,
            $defaultTime,
            $maxPortieri,
            $maxDifensori,
            $maxCentrocampisti,
            $maxAttaccanti,
            $numeroTitolari,
            $bonusSettings,
            $autoLineupMode
        );
        
        if ($leagueId) {
            // Se è collegata a una lega ufficiale, aggiorna il campo linked_to_league_id
            if ($linkedToLeagueId) {
                try {
                    $linkStmt = $conn->prepare("UPDATE leagues SET linked_to_league_id = ? WHERE id = ?");
                    if ($linkStmt) {
                        $linkStmt->bind_param("ii", $linkedToLeagueId, $leagueId);
                        $linkStmt->execute();
                        $linkStmt->close();
                    }
                } catch (Throwable $e) {
                    // Non bloccare la creazione lega per un errore accessorio di collegamento
                    error_log("POST /leagues - link official warning: " . $e->getMessage());
                }
            }
            
            // Crea sempre il record league_market_settings con il valore di require_approval
            try {
                $requireApproval = isset($data['requireApproval']) ? (int)$data['requireApproval'] : 0;
                $msConn = getDbConnection();
                $msStmt = $msConn->prepare("INSERT INTO league_market_settings (league_id, market_locked, require_approval) VALUES (?, 0, ?) ON DUPLICATE KEY UPDATE require_approval = VALUES(require_approval)");
                if ($msStmt) {
                    $msStmt->bind_param("ii", $leagueId, $requireApproval);
                    $msStmt->execute();
                    $msStmt->close();
                }
            } catch (Throwable $e) {
                // Compatibilità con DB che non hanno ancora require_approval/league_market_settings
                error_log("POST /leagues - market settings warning: " . $e->getMessage());
            }
            
            $response = [
                'message' => 'Lega creata con successo',
                'id' => $leagueId,
                'leagueId' => $leagueId
            ];
            $statusCode = 201;
        } else {
            throw new Exception('Errore durante la creazione della lega');
        }
    }
    // POST /leagues/:id/join - Unisciti a una lega
    elseif ($method === 'POST' && ((isset($pathParts[2]) && $pathParts[2] === 'join' && !isset($pathParts[3])) || (strpos($path, '/join') !== false && strpos($path, '/join-requests') === false && strpos($path, '/join-as-admin') === false))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        
        // Estrai leagueId dal path: /leagues/:id/join
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            // Prova a estrarre dall'URL completo
            if (preg_match('/\/leagues\/(\d+)\/join/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            } else if (isset($data['leagueId'])) {
                $leagueId = (int)$data['leagueId'];
            }
        }
        
        $accessCode = isset($data['accessCode']) ? $data['accessCode'] : null;
        
        if (!$leagueId) {
            error_log("POST /leagues/:id/join - Path: $path, PathParts: " . json_encode($pathParts));
            throw new Exception('ID lega obbligatorio');
        }
        
        error_log("POST /leagues/:id/join - LeagueId: $leagueId, UserId: " . $decoded['userId']);
        
        startSession();
        $_SESSION['user_id'] = $decoded['userId'];
        $_SESSION['username'] = $decoded['username'];
        
        // Controlla se la lega richiede approvazione
        $marketSettings = getLeagueMarketSettings($leagueId);
        $requireApproval = (int)($marketSettings['require_approval'] ?? 0);
        
        if ($requireApproval) {
            // Verifica lega esistente
            $conn = getDbConnection();
            $stmt = $conn->prepare("SELECT id FROM leagues WHERE id = ?");
            $stmt->bind_param("i", $leagueId);
            $stmt->execute();
            if ($stmt->get_result()->num_rows === 0) {
                $stmt->close();
                $response = ['message' => 'Lega non trovata'];
                $statusCode = 404;
            } else {
                $stmt->close();
                
                // Verifica codice accesso
                $stmt = $conn->prepare("SELECT access_code FROM leagues WHERE id = ?");
                $stmt->bind_param("i", $leagueId);
                $stmt->execute();
                $leagueRow = $stmt->get_result()->fetch_assoc();
                $stmt->close();
                $dbAccessCode = $leagueRow['access_code'] ?? null;
                
                if ($dbAccessCode && $dbAccessCode !== $accessCode) {
                    $response = ['message' => 'Codice di accesso errato'];
                    $statusCode = 400;
                } else {
                    // Controlla se già membro
                    $userId = $decoded['userId'];
                    $stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
                    $stmt->bind_param("ii", $leagueId, $userId);
                    $stmt->execute();
                    if ($stmt->get_result()->num_rows > 0) {
                        $stmt->close();
                        $response = ['message' => 'Sei già membro di questa lega'];
                        $statusCode = 400;
                    } else {
                        $stmt->close();
                        
                        // Controlla se c'è già una richiesta pendente
                        $stmt = $conn->prepare("SELECT id FROM league_join_requests WHERE league_id = ? AND user_id = ? AND status = 'pending'");
                        $stmt->bind_param("ii", $leagueId, $userId);
                        $stmt->execute();
                        if ($stmt->get_result()->num_rows > 0) {
                            $stmt->close();
                            $response = ['message' => 'Hai già una richiesta di iscrizione in attesa di approvazione', 'requires_approval' => true, 'already_requested' => true];
                            $statusCode = 400;
                        } else {
                            $stmt->close();
                            
                            // Crea richiesta di iscrizione
                            $stmt = $conn->prepare("INSERT INTO league_join_requests (league_id, user_id, team_name, coach_name, access_code) VALUES (?, ?, '', '', ?)");
                            $stmt->bind_param("iis", $leagueId, $userId, $accessCode);
                            
                            if ($stmt->execute()) {
                                $stmt->close();
                                $response = [
                                    'message' => 'Richiesta di iscrizione inviata. In attesa di approvazione.',
                                    'requires_approval' => true,
                                    'leagueId' => $leagueId
                                ];
                                $statusCode = 200;
                            } else {
                                $stmt->close();
                                $response = ['message' => 'Errore durante l\'invio della richiesta'];
                                $statusCode = 500;
                            }
                        }
                    }
                }
            }
        } else {
            $result = joinLeague($leagueId, $accessCode);
            
            error_log("POST /leagues/:id/join - Join result: " . ($result === true ? 'success' : ($result === 'not_found' ? 'not_found' : ($result === 'already_joined' ? 'already_joined' : ($result === false ? 'wrong_code' : 'error')))));
            
            if ($result === true) {
                $response = ['message' => 'Ti sei unito alla lega con successo', 'leagueId' => $leagueId];
                $statusCode = 200;
            } elseif ($result === 'not_found') {
                $response = ['message' => 'Lega non trovata'];
                $statusCode = 404;
            } elseif ($result === 'already_joined') {
                $response = ['message' => 'Sei già membro di questa lega'];
                $statusCode = 400;
            } elseif ($result === false) {
                // Codice di accesso errato
                $response = ['message' => 'Codice di accesso errato'];
                $statusCode = 400;
            } else {
                $response = ['message' => 'Errore durante l\'unione alla lega'];
                $statusCode = 400;
            }
        }
    }
    // GET /leagues/:id/join-requests - Lista richieste di iscrizione pendenti (admin only)
    elseif ($method === 'GET' && (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'join-requests' && !isset($pathParts[3]))) {
        $token = getAuthToken();
        if (!$token) throw new Exception('Token di autenticazione mancante');
        $decoded = verifyJWT($token);
        if (!$decoded) throw new Exception('Token non valido o scaduto');
        
        $leagueId = (int)$pathParts[1];
        $userId = $decoded['userId'];
        
        // Verifica che l'utente sia admin della lega
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli admin possono vedere le richieste di iscrizione');
        }
        
        $requests = getLeagueJoinRequests($leagueId);
        $response = ['requests' => $requests];
        $statusCode = 200;
    }
    // POST /leagues/:id/join-requests/:requestId/approve - Approva richiesta (admin only)
    elseif ($method === 'POST' && (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'join-requests' && isset($pathParts[3]) && is_numeric($pathParts[3]) && isset($pathParts[4]) && $pathParts[4] === 'approve')) {
        $token = getAuthToken();
        if (!$token) throw new Exception('Token di autenticazione mancante');
        $decoded = verifyJWT($token);
        if (!$decoded) throw new Exception('Token non valido o scaduto');
        
        $leagueId = (int)$pathParts[1];
        $requestId = (int)$pathParts[3];
        $userId = $decoded['userId'];
        
        // Verifica che l'utente sia admin della lega
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli admin possono approvare le richieste');
        }
        
        $result = approveJoinRequest($requestId);
        if ($result) {
            $response = ['message' => 'Richiesta approvata con successo'];
            $statusCode = 200;
        } else {
            $response = ['message' => 'Richiesta non trovata o già gestita'];
            $statusCode = 400;
        }
    }
    // POST /leagues/:id/join-requests/:requestId/reject - Rifiuta richiesta (admin only)
    elseif ($method === 'POST' && (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'join-requests' && isset($pathParts[3]) && is_numeric($pathParts[3]) && isset($pathParts[4]) && $pathParts[4] === 'reject')) {
        $token = getAuthToken();
        if (!$token) throw new Exception('Token di autenticazione mancante');
        $decoded = verifyJWT($token);
        if (!$decoded) throw new Exception('Token non valido o scaduto');
        
        $leagueId = (int)$pathParts[1];
        $requestId = (int)$pathParts[3];
        $userId = $decoded['userId'];
        
        // Verifica che l'utente sia admin della lega
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli admin possono rifiutare le richieste');
        }
        
        $result = rejectJoinRequest($requestId);
        if ($result) {
            $response = ['message' => 'Richiesta rifiutata'];
            $statusCode = 200;
        } else {
            $response = ['message' => 'Richiesta non trovata o già gestita'];
            $statusCode = 400;
        }
    }
    // POST /leagues/:id/change-role - Cambia ruolo di un utente (admin only)
    elseif ($method === 'POST' && (strpos($path, '/change-role') !== false || (isset($pathParts[2]) && $pathParts[2] === 'change-role'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Estrai leagueId dal path
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else if (preg_match('/\/leagues\/(\d+)\/change-role/', $path, $matches)) {
            $leagueId = (int)$matches[1];
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $userMember = $stmt->get_result()->fetch_assoc();
        if (!$userMember || $userMember['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono cambiare i ruoli');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        $memberId = isset($data['member_id']) ? (int)$data['member_id'] : null;
        $newRole = isset($data['new_role']) ? $data['new_role'] : null;
        
        if (!$memberId || !$newRole) {
            throw new Exception('member_id e new_role sono obbligatori');
        }
        
        if (!in_array($newRole, ['admin', 'pagellatore', 'user'])) {
            throw new Exception('Ruolo non valido');
        }
        
        // Recupera l'user_id e ruolo attuale del membro
        $stmt = $conn->prepare("SELECT user_id, role FROM league_members WHERE id = ? AND league_id = ?");
        $stmt->bind_param("ii", $memberId, $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        $member = $res->fetch_assoc();
        
        if (!$member) {
            throw new Exception('Membro non trovato');
        }
        
        $isChangingAdmin = ($member['role'] === 'admin' && $newRole !== 'admin');
        if ($isChangingAdmin) {
            // Conta quanti admin ci sono nella lega
            $stmt = $conn->prepare("SELECT COUNT(*) as admin_count FROM league_members WHERE league_id = ? AND role = 'admin'");
            $stmt->bind_param("i", $leagueId);
            $stmt->execute();
            $res = $stmt->get_result();
            $row = $res->fetch_assoc();
            if ($row && $row['admin_count'] <= 1) {
                $response = ['success' => false, 'error' => 'Devi nominare almeno un altro admin prima di poter cambiare ruolo all\'ultimo admin della lega.'];
                $statusCode = 400;
            } else {
                $stmt = $conn->prepare("UPDATE league_members SET role = ? WHERE id = ? AND league_id = ?");
                $stmt->bind_param("sii", $newRole, $memberId, $leagueId);
                if ($stmt->execute()) {
                    $response = ['success' => true, 'message' => 'Ruolo aggiornato con successo!'];
                    $statusCode = 200;
                } else {
                    throw new Exception('Errore nell\'aggiornamento del ruolo.');
                }
            }
        } else {
            $stmt = $conn->prepare("UPDATE league_members SET role = ? WHERE id = ? AND league_id = ?");
            $stmt->bind_param("sii", $newRole, $memberId, $leagueId);
            if ($stmt->execute()) {
                $response = ['success' => true, 'message' => 'Ruolo aggiornato con successo!'];
                $statusCode = 200;
            } else {
                throw new Exception('Errore nell\'aggiornamento del ruolo.');
            }
        }
    }
    // POST /leagues/:id/remove-user - Rimuovi un utente dalla lega (admin only)
    elseif ($method === 'POST' && (strpos($path, '/remove-user') !== false || (isset($pathParts[2]) && $pathParts[2] === 'remove-user'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Estrai leagueId dal path
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else if (preg_match('/\/leagues\/(\d+)\/remove-user/', $path, $matches)) {
            $leagueId = (int)$matches[1];
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $userMember = $stmt->get_result()->fetch_assoc();
        if (!$userMember || $userMember['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono rimuovere utenti');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        $removeUserId = isset($data['user_id']) ? (int)$data['user_id'] : null;
        
        if (!$removeUserId) {
            throw new Exception('user_id obbligatorio');
        }
        
        if ($removeUserId === $userId) {
            throw new Exception('Non puoi rimuovere te stesso');
        }
        
        // Rimuovi tutti i dati dell'utente nella lega
        // 1) league_members
        $stmt = $conn->prepare("DELETE FROM league_members WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("ii", $removeUserId, $leagueId);
        $stmt->execute();
        
        // 2) user_players (tutti i giocatori nella lega)
        $stmt = $conn->prepare("
            DELETE up
            FROM user_players up
            JOIN players p ON up.player_id = p.id
            JOIN teams t ON p.team_id = t.id
            WHERE up.user_id = ? AND t.league_id = ?
        ");
        $stmt->bind_param("ii", $removeUserId, $leagueId);
        $stmt->execute();
        
        // 3) user_budget
        $stmt = $conn->prepare("DELETE FROM user_budget WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("ii", $removeUserId, $leagueId);
        $stmt->execute();
        
        // 4) user_lineups
        $stmt = $conn->prepare("DELETE FROM user_lineups WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("ii", $removeUserId, $leagueId);
        $stmt->execute();
        
        // 5) league_join_requests
        $stmt = $conn->prepare("DELETE FROM league_join_requests WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("ii", $removeUserId, $leagueId);
        $stmt->execute();
        
        // 6) user_league_prefs
        $stmt = $conn->prepare("DELETE FROM user_league_prefs WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("ii", $removeUserId, $leagueId);
        $stmt->execute();
        
        // 7) user_market_blocks
        $stmt = $conn->prepare("DELETE FROM user_market_blocks WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("ii", $removeUserId, $leagueId);
        $stmt->execute();
        
        $response = ['success' => true, 'message' => 'Utente rimosso dalla lega con tutti i dati.'];
        $statusCode = 200;
    }
    // GET /leagues/:id/leave/info - Ottieni info per lasciare la lega
    elseif ($method === 'GET' && (strpos($path, '/leave/info') !== false || (isset($pathParts[2]) && $pathParts[2] === 'leave' && isset($pathParts[3]) && $pathParts[3] === 'info'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Estrai leagueId dal path
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else if (preg_match('/\/leagues\/(\d+)\/leave\/info/', $path, $matches)) {
            $leagueId = (int)$matches[1];
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Quanti membri e admin?
        $stmt = $conn->prepare("SELECT user_id, role FROM league_members WHERE league_id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        $members = [];
        $adminCount = 0;
        $isAdmin = false;
        $otherMembers = [];
        while ($row = $res->fetch_assoc()) {
            $members[] = $row;
            if ($row['role'] === 'admin' && $row['user_id'] != $userId) {
                $adminCount++;
            }
            if ($row['user_id'] == $userId && $row['role'] === 'admin') {
                $isAdmin = true;
            }
            if ($row['user_id'] != $userId) {
                $otherMembers[] = $row;
            }
        }
        $onlyUser = count($members) === 1;
        $onlyAdmin = $isAdmin && !$adminCount && count($members) > 1;
        
        // Ottieni username degli altri membri
        $otherMembersWithUsername = [];
        if (!empty($otherMembers)) {
            $userIds = array_map(function($m) { return $m['user_id']; }, $otherMembers);
            $placeholders = implode(',', array_fill(0, count($userIds), '?'));
            $stmt = $conn->prepare("SELECT id, username FROM users WHERE id IN ($placeholders)");
            $stmt->bind_param(str_repeat('i', count($userIds)), ...$userIds);
            $stmt->execute();
            $res = $stmt->get_result();
            $usersById = [];
            while ($row = $res->fetch_assoc()) {
                $usersById[$row['id']] = $row['username'];
            }
            foreach ($otherMembers as $member) {
                $otherMembersWithUsername[] = [
                    'user_id' => $member['user_id'],
                    'username' => $usersById[$member['user_id']] ?? 'Unknown',
                    'role' => $member['role']
                ];
            }
        }
        
        $response = [
            'only_user' => $onlyUser,
            'only_admin' => $onlyAdmin,
            'other_members' => $otherMembersWithUsername
        ];
        $statusCode = 200;
    }
    // POST /leagues/:id/leave - Lascia una lega
    elseif ($method === 'POST' && (strpos($path, '/leave') !== false || (isset($pathParts[1]) && $pathParts[1] === 'leave'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Estrai leagueId dal path
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else if (preg_match('/\/leagues\/(\d+)\/leave/', $path, $matches)) {
            $leagueId = (int)$matches[1];
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        $newAdminId = isset($data['new_admin_id']) ? (int)$data['new_admin_id'] : null;
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Quanti membri e admin?
        $stmt = $conn->prepare("SELECT user_id, role FROM league_members WHERE league_id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        $members = [];
        $adminCount = 0;
        $isAdmin = false;
        while ($row = $res->fetch_assoc()) {
            $members[] = $row;
            if ($row['role'] === 'admin' && $row['user_id'] != $userId) {
                $adminCount++;
            }
            if ($row['user_id'] == $userId && $row['role'] === 'admin') {
                $isAdmin = true;
            }
        }
        $onlyUser = count($members) === 1;
        $onlyAdmin = $isAdmin && !$adminCount && count($members) > 1;
        
        if ($onlyAdmin && !$newAdminId) {
            $response = ['success' => false, 'error' => 'Devi nominare un nuovo admin prima di uscire.'];
            $statusCode = 400;
        } else {
            if ($onlyAdmin && $newAdminId) {
                // Promuovi nuovo admin
                $stmt = $conn->prepare("UPDATE league_members SET role = 'admin' WHERE league_id = ? AND user_id = ?");
                $stmt->bind_param("ii", $leagueId, $newAdminId);
                $stmt->execute();
            }
            if ($onlyUser) {
                // Elimina tutti i dati della lega (prepared statements per sicurezza)
                $tables = ['user_budget', 'user_players', 'user_lineups', 'league_join_requests', 'user_league_prefs', 'user_market_blocks', 'league_members', 'teams'];
                foreach ($tables as $table) {
                    $delStmt = $conn->prepare("DELETE FROM $table WHERE league_id = ?");
                    $delStmt->bind_param("i", $leagueId);
                    $delStmt->execute();
                    $delStmt->close();
                }
                $delStmt = $conn->prepare("DELETE FROM leagues WHERE id = ?");
                $delStmt->bind_param("i", $leagueId);
                $delStmt->execute();
                $delStmt->close();
                $response = ['success' => true, 'message' => 'Lega eliminata con successo'];
            } else {
                // Elimina tutti i dati dell'utente nella lega (prepared statements per sicurezza)
                $tables = ['user_budget', 'user_players', 'user_lineups', 'league_members', 'league_join_requests', 'user_league_prefs', 'user_market_blocks'];
                foreach ($tables as $table) {
                    $delStmt = $conn->prepare("DELETE FROM $table WHERE user_id = ? AND league_id = ?");
                    $delStmt->bind_param("ii", $userId, $leagueId);
                    $delStmt->execute();
                    $delStmt->close();
                }
                $response = ['success' => true, 'message' => 'Hai lasciato la lega con successo'];
            }
            $statusCode = 200;
        }
    }
    // GET /leagues/search?q=query - Cerca leghe
    elseif ($method === 'GET' && (strpos($path, '/leagues/search') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && $pathParts[1] === 'search'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $query = isset($_GET['q']) ? $_GET['q'] : '';
        if (strlen($query) < 2) {
            throw new Exception('Query di ricerca troppo corta');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Cerca leghe per nome, escludendo quelle a cui l'utente è già iscritto
        $searchQuery = "%" . $conn->real_escape_string($query) . "%";
        $stmt = $conn->prepare("
            SELECT l.id, l.name, l.access_code, l.initial_budget, l.creator_id
            FROM leagues l
            LEFT JOIN league_members lm ON l.id = lm.league_id AND lm.user_id = ?
            WHERE l.name LIKE ? AND lm.user_id IS NULL
            ORDER BY l.name ASC
            LIMIT 20
        ");
        $stmt->bind_param("is", $userId, $searchQuery);
        $stmt->execute();
        $result = $stmt->get_result();
        
        $leagues = [];
        while ($row = $result->fetch_assoc()) {
            $leagues[] = [
                'id' => (int)$row['id'],
                'name' => $row['name'],
                'access_code' => $row['access_code'],
                'initial_budget' => (int)$row['initial_budget'],
            ];
        }
        $stmt->close();
        
        $response = $leagues;
        $statusCode = 200;
    }
    // GET /leagues/:id/standings/full - Classifica completa con media punti (DEVE essere prima di GET /leagues/:id/standings)
    elseif ($method === 'GET' && (strpos($path, '/standings/full') !== false || (isset($pathParts[2]) && $pathParts[2] === 'standings' && isset($pathParts[3]) && $pathParts[3] === 'full'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Usa la stessa logica di risultati_giornata.php per calcolare la classifica completa
        $league = getLeagueById($leagueId);
        if (!$league) {
            throw new Exception('Lega non trovata');
        }
        
        // Recupera utenti
        $stmt = $conn->prepare("SELECT u.id, u.username, ub.team_name, ub.coach_name, COALESCE(NULLIF(ub.team_logo, ''), 'default_1') as team_logo FROM users u JOIN user_budget ub ON u.id = ub.user_id WHERE ub.league_id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $utenti = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmt->close();
        
        // Recupera rose
        $rose = [];
        $stmt = $conn->prepare("SELECT up.user_id, up.player_id FROM user_players up WHERE up.league_id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $rose[$row['user_id']][] = $row['player_id'];
        }
        $stmt->close();
        
        // Classifica basata SOLO su giornate calcolate (matchday_results)
        $stmt = $conn->prepare("SELECT user_id, SUM(punteggio) as totale, COUNT(*) as giornate_calc FROM matchday_results WHERE league_id = ? GROUP BY user_id");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $calcResults = [];
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $calcResults[$row['user_id']] = [
                'punteggio' => round(floatval($row['totale']), 1),
                'giornate_con_voti' => (int)$row['giornate_calc'],
            ];
        }
        $stmt->close();

        $classifica_generale = [];
        foreach ($utenti as $utente) {
            $uid = $utente['id'];
            $cr = $calcResults[$uid] ?? ['punteggio' => 0, 'giornate_con_voti' => 0];
            $classifica_generale[] = [
                'id' => $utente['id'],
                'username' => $utente['username'],
                'team_name' => $utente['team_name'],
                'coach_name' => $utente['coach_name'] ?? '',
                'team_logo' => (!empty($utente['team_logo']) && $utente['team_logo'] !== '') ? $utente['team_logo'] : 'default_1',
                'punteggio' => $cr['punteggio'],
                'giornate_con_voti' => $cr['giornate_con_voti'],
                'media_punti' => $cr['giornate_con_voti'] > 0 ? round($cr['punteggio'] / $cr['giornate_con_voti'], 1) : 0,
            ];
        }

        usort($classifica_generale, function($a, $b) {
            return $b['punteggio'] <=> $a['punteggio'];
        });

        if (!is_array($classifica_generale)) {
            $classifica_generale = [];
        }

        error_log("GET /leagues/:id/standings/full - Returning " . count($classifica_generale) . " standings (from matchday_results)");

        $response = $classifica_generale;
        $statusCode = 200;
    }
    // GET /leagues/:id/standings/matchday/:giornata/formation/:userId - Formazione utente per giornata (DEVE essere prima di GET /leagues/:id/standings/matchday/:giornata)
    elseif ($method === 'GET' && strpos($path, '/standings/matchday/') !== false && strpos($path, '/formation/') !== false) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Path: /leagues/:id/standings/matchday/:giornata/formation/:userId
        // pathParts[0] = 'leagues', pathParts[1] = id, pathParts[2] = 'standings', pathParts[3] = 'matchday', pathParts[4] = giornata, pathParts[5] = 'formation', pathParts[6] = userId
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        $giornata = isset($pathParts[4]) ? (int)$pathParts[4] : null;
        $targetUserId = isset($pathParts[6]) ? (int)$pathParts[6] : null;
        
        if (!$leagueId || !$giornata || !$targetUserId) {
            throw new Exception('ID lega, giornata e ID utente obbligatori');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia membro della lega
        $stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        if (!$stmt->get_result()->num_rows) {
            throw new Exception('Non sei membro di questa lega');
        }
        $stmt->close();
        
        $league = getLeagueById($leagueId);
        if (!$league) {
            throw new Exception('Lega non trovata');
        }
        
        // Recupera rosa dell'utente
        $rose = [];
        $stmt = $conn->prepare("SELECT player_id FROM user_players WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("ii", $targetUserId, $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $rose[] = $row['player_id'];
        }
        $stmt->close();
        
        // Recupera voti e bonus per questa giornata
        $voti = [];
        $bonus_giornata = [];
        if (!empty($rose)) {
            $in = implode(',', array_fill(0, count($rose), '?'));
            $types = str_repeat('i', count($rose));
            $stmt = $conn->prepare("SELECT player_id, rating, goals, assists, yellow_cards, red_cards, goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet FROM player_ratings WHERE league_id = ? AND giornata = ? AND player_id IN ($in)");
            $params = array_merge([$leagueId, $giornata], $rose);
            $stmt->bind_param("ii" . $types, ...$params);
            $stmt->execute();
            $res = $stmt->get_result();
            while ($row = $res->fetch_assoc()) {
                $voti[$row['player_id']] = $row['rating'];
                $bonus_giornata[$row['player_id']] = [
                    'goals' => (int)$row['goals'],
                    'assists' => (int)$row['assists'],
                    'yellow_cards' => (int)$row['yellow_cards'],
                    'red_cards' => (int)$row['red_cards']
                ];
            }
            $stmt->close();
        }
        
        // Recupera bonus settings
        $bonus_settings = getLeagueBonusSettings($leagueId);
        $bonus_enabled = (bool)$bonus_settings['enable_bonus_malus'];
        
        // Recupera titolari
        $titolari = [];
        if ($league['auto_lineup_mode']) {
            $rose_map = [$targetUserId => $rose];
            $titolari = build_auto_lineup($targetUserId, $league, $rose_map, $voti, $conn);
        } else {
            $stmt = $conn->prepare("SELECT titolari FROM user_lineups WHERE user_id = ? AND league_id = ? AND giornata = ?");
            $stmt->bind_param("iii", $targetUserId, $leagueId, $giornata);
            $stmt->execute();
            $res = $stmt->get_result();
            if ($row = $res->fetch_assoc()) {
                $titolari_str = $row['titolari'];
                if ($titolari_str && $titolari_str[0] === '[') {
                    $titolari = json_decode($titolari_str, true);
                } else if ($titolari_str) {
                    $titolari = explode(',', $titolari_str);
                }
            }
            $stmt->close();
        }
        
        // Recupera dettagli giocatori
        $formazione = [];
        if (!empty($titolari)) {
            $playerIds = array_filter($titolari, function($pid) { return $pid !== null; });
            if (!empty($playerIds)) {
                $in = implode(',', array_fill(0, count($playerIds), '?'));
                $types = str_repeat('i', count($playerIds));
                $stmt = $conn->prepare("SELECT id, first_name, last_name, role FROM players WHERE id IN ($in)");
                $stmt->bind_param($types, ...$playerIds);
                $stmt->execute();
                $res = $stmt->get_result();
                $giocatori = [];
                while ($row = $res->fetch_assoc()) {
                    $giocatori[$row['id']] = [
                        'first_name' => $row['first_name'],
                        'last_name' => $row['last_name'],
                        'role' => $row['role']
                    ];
                }
                $stmt->close();
                
                // Costruisci array formazione con voti e bonus
                foreach ($titolari as $pid) {
                    if ($pid === null) {
                        $formazione[] = null;
                        continue;
                    }
                    
                    $player = [
                        'id' => $pid,
                        'first_name' => $giocatori[$pid]['first_name'] ?? '',
                        'last_name' => $giocatori[$pid]['last_name'] ?? '',
                        'role' => $giocatori[$pid]['role'] ?? '',
                        'rating' => isset($voti[$pid]) ? (float)$voti[$pid] : null,
                        'goals' => isset($bonus_giornata[$pid]) ? $bonus_giornata[$pid]['goals'] : 0,
                        'assists' => isset($bonus_giornata[$pid]) ? $bonus_giornata[$pid]['assists'] : 0,
                        'yellow_cards' => isset($bonus_giornata[$pid]) ? $bonus_giornata[$pid]['yellow_cards'] : 0,
                        'red_cards' => isset($bonus_giornata[$pid]) ? $bonus_giornata[$pid]['red_cards'] : 0,
                        'final_rating' => null
                    ];
                    
                    // Calcola voto finale
                    if ($player['rating'] !== null) {
                        $base = $player['rating'];
                        $bonus = 0;
                        if ($bonus_enabled) {
                            if ($bonus_settings['enable_goal']) $bonus += ($player['goals'] ?? 0) * $bonus_settings['bonus_goal'];
                            if ($bonus_settings['enable_assist']) $bonus += ($player['assists'] ?? 0) * $bonus_settings['bonus_assist'];
                            if ($bonus_settings['enable_yellow_card']) $bonus += ($player['yellow_cards'] ?? 0) * $bonus_settings['malus_yellow_card'];
                            if ($bonus_settings['enable_red_card']) $bonus += ($player['red_cards'] ?? 0) * $bonus_settings['malus_red_card'];
                            if ($bonus_settings['enable_goals_conceded']) $bonus += ($player['goals_conceded'] ?? 0) * $bonus_settings['malus_goals_conceded'];
                            if ($bonus_settings['enable_own_goal']) $bonus += ($player['own_goals'] ?? 0) * $bonus_settings['malus_own_goal'];
                            if ($bonus_settings['enable_penalty_missed']) $bonus += ($player['penalty_missed'] ?? 0) * $bonus_settings['malus_penalty_missed'];
                            if ($bonus_settings['enable_penalty_saved']) $bonus += ($player['penalty_saved'] ?? 0) * $bonus_settings['bonus_penalty_saved'];
                            if ($bonus_settings['enable_clean_sheet']) $bonus += ($player['clean_sheet'] ?? 0) * $bonus_settings['bonus_clean_sheet'];
                        }
                        $player['final_rating'] = max(0, $base + $bonus);
                    }
                    
                    $formazione[] = $player;
                }
            }
        }
        
        $response = [
            'formation' => $formazione,
            'bonus_settings' => $bonus_settings,
            'bonus_enabled' => $bonus_enabled
        ];
        $statusCode = 200;
    }
    // GET /leagues/:id/standings/matchday/:giornata - Risultati giornata specifica (DEVE essere prima di GET /leagues/:id/standings)
    elseif ($method === 'GET' && (strpos($path, '/standings/matchday/') !== false || (isset($pathParts[2]) && $pathParts[2] === 'standings' && isset($pathParts[3]) && $pathParts[3] === 'matchday'))) {
        $token = getAuthToken();
        if (!$token) throw new Exception('Token di autenticazione mancante');
        $decoded = verifyJWT($token);
        if (!$decoded) throw new Exception('Token non valido o scaduto');

        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        $giornata = isset($pathParts[4]) ? (int)$pathParts[4] : null;
        if (!$leagueId || !$giornata) throw new Exception('ID lega e giornata obbligatori');

        $conn = getDbConnection();

        // Controlla se la giornata è stata calcolata
        $stmt = $conn->prepare("SELECT mr.user_id, mr.punteggio, u.username, ub.team_name FROM matchday_results mr JOIN users u ON mr.user_id = u.id JOIN user_budget ub ON mr.user_id = ub.user_id AND ub.league_id = mr.league_id WHERE mr.league_id = ? AND mr.giornata = ? ORDER BY mr.punteggio DESC");
        $stmt->bind_param("ii", $leagueId, $giornata);
        $stmt->execute();
        $calcResults = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmt->close();

        if (count($calcResults) > 0) {
            // Giornata calcolata: restituisci da matchday_results
            $classifica = [];
            foreach ($calcResults as $cr) {
                $classifica[] = [
                    'id' => (int)$cr['user_id'],
                    'username' => $cr['username'],
                    'team_name' => $cr['team_name'],
                    'punteggio' => round(floatval($cr['punteggio']), 1),
                    'calculated' => true,
                ];
            }
            $response = $classifica;
        } else {
            // Non calcolata: restituisci array vuoto con flag
            $response = [];
        }
        $statusCode = 200;
    }
    // GET /leagues/:id/standings - Classifica lega
    elseif ($method === 'GET' && strpos($path, '/standings') !== false && strpos($path, '/standings/full') === false && strpos($path, '/standings/matchday/') === false && (isset($pathParts[1]) && $pathParts[1] === 'standings' && !isset($pathParts[2]))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 5;
        $standings = getLeagueStandings($leagueId, $limit);
        
        // Assicurati che la risposta sia sempre un array
        if (!is_array($standings)) {
            $standings = [];
        }
        
        $response = $standings;
        $statusCode = 200;
    }
    // GET /leagues/:id/user-stats - Ottieni statistiche utente nella lega
    elseif ($method === 'GET' && (strpos($path, '/user-stats') !== false || (isset($pathParts[2]) && $pathParts[2] === 'user-stats'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Ottieni tutte le standings per trovare posizione utente
        $allStandings = getLeagueStandings($leagueId, 1000);
        if (!is_array($allStandings)) {
            $allStandings = [];
        }
        
        // Trova posizione utente
        $userPosition = null;
        $userTotalPoints = 0;
        foreach ($allStandings as $index => $team) {
            if ($team['id'] == $userId) {
                $userPosition = $index + 1;
                $userTotalPoints = floatval($team['punteggio']);
                break;
            }
        }
        
        // Ottieni punteggi ultime 5 giornate
        $stmt = $conn->prepare("
            SELECT md.giornata, COALESCE(SUM(pr.rating), 0) as punteggio
            FROM matchdays md
            LEFT JOIN user_lineups ul ON md.league_id = ul.league_id AND md.giornata = ul.giornata AND ul.user_id = ?
            LEFT JOIN user_players up ON ul.user_id = up.user_id AND ul.league_id = up.league_id
            LEFT JOIN player_ratings pr ON up.player_id = pr.player_id AND pr.giornata = md.giornata AND pr.league_id = md.league_id
            WHERE md.league_id = ?
            GROUP BY md.giornata
            ORDER BY md.giornata DESC
            LIMIT 5
        ");
        $stmt->bind_param("ii", $userId, $leagueId);
        $stmt->execute();
        $result = $stmt->get_result();
        
        $userScores = [];
        while ($row = $result->fetch_assoc()) {
            $userScores[] = [
                'giornata' => (int)$row['giornata'],
                'punteggio' => floatval($row['punteggio'])
            ];
        }
        $stmt->close();
        
        // Ordina per giornata crescente
        usort($userScores, function($a, $b) {
            return $a['giornata'] - $b['giornata'];
        });
        
        // Calcola media punti per partita
        $matchdaysCount = count($userScores);
        $avgPoints = $matchdaysCount > 0 ? ($userTotalPoints / $matchdaysCount) : 0;
        
        $response = [
            'position' => $userPosition,
            'totalPoints' => $userTotalPoints,
            'avgPoints' => round($avgPoints, 2),
            'scores' => $userScores
        ];
        $statusCode = 200;
    }
    // POST /leagues/:id/prefs - Aggiorna preferenze lega
    elseif ($method === 'POST' && (strpos($path, '/prefs') !== false || (isset($pathParts[2]) && $pathParts[2] === 'prefs'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Estrai leagueId dal path: /leagues/:id/prefs
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            // Prova a estrarre dall'URL completo
            if (preg_match('/\/leagues\/(\d+)\/prefs/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) {
            throw new Exception('Dati non validi');
        }
        
        $favorite = isset($data['favorite']) ? (int)$data['favorite'] : 0;
        $archived = isset($data['archived']) ? (int)$data['archived'] : 0;
        $userId = $decoded['userId'];

        ensureUserLeaguePrefsNotificationsColumn();
        $notifEnabled = null;
        if (isset($data['notifications_enabled'])) {
            $notifEnabled = (int)$data['notifications_enabled'] ? 1 : 0;
        } else {
            $prefStmt = $conn->prepare("SELECT notifications_enabled FROM user_league_prefs WHERE user_id = ? AND league_id = ? LIMIT 1");
            $prefStmt->bind_param("ii", $userId, $leagueId);
            $prefStmt->execute();
            $prefRow = $prefStmt->get_result()->fetch_assoc();
            $prefStmt->close();
            $notifEnabled = ($prefRow && isset($prefRow['notifications_enabled'])) ? (int)$prefRow['notifications_enabled'] : 1;
        }

        setUserLeaguePref($userId, $leagueId, $favorite, $archived, $notifEnabled);
        
        $response = ['message' => 'Preferenze aggiornate'];
        $statusCode = 200;
    }
    // ========== MERCATO ==========
    // GET /market/:leagueId/players - Ottieni giocatori disponibili
    elseif ($method === 'GET' && (strpos($path, '/market/') !== false && strpos($path, '/players') !== false)) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica membro lega
        $stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        if (!$stmt->get_result()->num_rows) {
            throw new Exception('Non sei membro di questa lega');
        }
        
        // Filtri
        $role = isset($_GET['role']) ? $_GET['role'] : null;
        $search = isset($_GET['search']) ? trim($_GET['search']) : '';
        
        // Se la lega è collegata, leggi i giocatori dalla lega sorgente
        $effectiveLeagueId = getEffectiveLeagueId($leagueId);
        
        // Query giocatori
        $query = "SELECT p.*, t.name as team_name FROM players p JOIN teams t ON p.team_id = t.id WHERE t.league_id = ?";
        $params = [$effectiveLeagueId];
        $types = "i";
        
        if ($role && in_array($role, ['P','D','C','A'])) {
            $query .= " AND p.role = ?";
            $params[] = $role;
            $types .= "s";
        }
        
        if ($search !== '') {
            $query .= " AND (p.first_name LIKE ? OR p.last_name LIKE ? OR t.name LIKE ?)";
            $searchTerm = "%$search%";
            $params[] = $searchTerm;
            $params[] = $searchTerm;
            $params[] = $searchTerm;
            $types .= "sss";
        }
        
        $query .= " ORDER BY p.rating DESC, t.name, p.last_name";
        
        $stmt = $conn->prepare($query);
        if (count($params) > 1) {
            $stmt->bind_param($types, ...$params);
        } else {
            $stmt->bind_param($types, $params[0]);
        }
        $stmt->execute();
        $players = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        
        // Giocatori già acquistati dall'utente
        $stmt = $conn->prepare("SELECT player_id FROM user_players WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("ii", $userId, $leagueId);
        $stmt->execute();
        $userPlayerIds = [];
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $userPlayerIds[] = $row['player_id'];
        }
        
        // Aggiungi flag "owned"
        foreach ($players as &$player) {
            $player['owned'] = in_array($player['id'], $userPlayerIds);
        }
        
        $response = $players;
        $statusCode = 200;
    }
    // POST /market/:leagueId/buy - Acquista giocatore
    elseif ($method === 'POST' && (strpos($path, '/market/') !== false && strpos($path, '/buy') !== false)) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        $playerId = isset($data['playerId']) ? (int)$data['playerId'] : null;
        if (!$playerId) {
            throw new Exception('ID giocatore obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica membro lega
        $stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        if (!$stmt->get_result()->num_rows) {
            throw new Exception('Non sei membro di questa lega');
        }
        
        // Verifica blocco mercato
        $marketBlockStatus = isMarketBlocked($userId, $leagueId);
        if ($marketBlockStatus['blocked']) {
            throw new Exception('Il mercato è bloccato');
        }
        
        // Recupera giocatore
        $stmt = $conn->prepare("SELECT rating, role FROM players WHERE id = ?");
        $stmt->bind_param("i", $playerId);
        $stmt->execute();
        $player = $stmt->get_result()->fetch_assoc();
        if (!$player) {
            throw new Exception('Giocatore non trovato');
        }
        
        // Transazione atomica per evitare race condition sul budget
        $conn->begin_transaction();
        try {
            // Verifica già acquistato
            $stmt = $conn->prepare("SELECT 1 FROM user_players WHERE user_id = ? AND league_id = ? AND player_id = ?");
            $stmt->bind_param("iii", $userId, $leagueId, $playerId);
            $stmt->execute();
            if ($stmt->get_result()->num_rows > 0) {
                throw new Exception('Hai già acquistato questo giocatore');
            }
            
            // Verifica budget con lock per evitare acquisti concorrenti
            $stmt = $conn->prepare("SELECT budget FROM user_budget WHERE user_id = ? AND league_id = ? FOR UPDATE");
            $stmt->bind_param("ii", $userId, $leagueId);
            $stmt->execute();
            $budgetRow = $stmt->get_result()->fetch_assoc();
            $budget = $budgetRow ? $budgetRow['budget'] : 0;
            
            if ($budget < $player['rating']) {
                throw new Exception('Budget insufficiente');
            }
            
            // Verifica limiti ruolo
            $stmt = $conn->prepare("SELECT max_portieri, max_difensori, max_centrocampisti, max_attaccanti FROM leagues WHERE id = ?");
            $stmt->bind_param("i", $leagueId);
            $stmt->execute();
            $limits = $stmt->get_result()->fetch_assoc();
            
            $roleLimits = [
                'P' => $limits['max_portieri'],
                'D' => $limits['max_difensori'],
                'C' => $limits['max_centrocampisti'],
                'A' => $limits['max_attaccanti']
            ];
            
            $stmt = $conn->prepare("SELECT COUNT(*) as count FROM user_players up JOIN players p ON up.player_id = p.id WHERE up.user_id = ? AND up.league_id = ? AND p.role = ?");
            $stmt->bind_param("iis", $userId, $leagueId, $player['role']);
            $stmt->execute();
            $currentCount = $stmt->get_result()->fetch_assoc()['count'];
            
            if ($currentCount >= $roleLimits[$player['role']]) {
                throw new Exception('Limite giocatori per questo ruolo raggiunto');
            }
            
            // Acquista giocatore
            $stmt = $conn->prepare("INSERT INTO user_players (user_id, league_id, player_id) VALUES (?, ?, ?)");
            $stmt->bind_param("iii", $userId, $leagueId, $playerId);
            $stmt->execute();
            
            // Aggiorna budget
            $newBudget = $budget - $player['rating'];
            $stmt = $conn->prepare("UPDATE user_budget SET budget = ? WHERE user_id = ? AND league_id = ?");
            $stmt->bind_param("dii", $newBudget, $userId, $leagueId);
            $stmt->execute();
            
            $conn->commit();
            
            $response = [
                'message' => 'Giocatore acquistato con successo',
                'newBudget' => $newBudget
            ];
            $statusCode = 200;
        } catch (Exception $buyEx) {
            $conn->rollback();
            throw $buyEx;
        }
    }
    // GET /market/:leagueId/budget - Ottieni budget
    elseif ($method === 'GET' && (strpos($path, '/market/') !== false && strpos($path, '/budget') !== false)) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        $stmt = $conn->prepare("SELECT budget FROM user_budget WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("ii", $userId, $leagueId);
        $stmt->execute();
        $budgetRow = $stmt->get_result()->fetch_assoc();
        
        $response = [
            'budget' => $budgetRow ? $budgetRow['budget'] : 0
        ];
        $statusCode = 200;
    }
    // GET /market/:leagueId/blocked - Verifica se mercato è bloccato
    elseif ($method === 'GET' && (strpos($path, '/market/') !== false && strpos($path, '/blocked') !== false)) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $marketBlockStatus = isMarketBlocked($userId, $leagueId);
        
        $response = $marketBlockStatus;
        $statusCode = 200;
    }
    // GET /market/:leagueId/manage - Ottieni impostazioni mercato e lista utenti con blocchi
    elseif ($method === 'GET' && (strpos($path, '/market/') !== false && strpos($path, '/manage') !== false)) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        foreach ($pathParts as $i => $part) {
            if ($part === 'market' && isset($pathParts[$i + 1])) {
                $leagueId = (int)$pathParts[$i + 1];
                break;
            }
        }
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $memberResult = $stmt->get_result()->fetch_assoc();
        if (!$memberResult || $memberResult['role'] !== 'admin') {
            throw new Exception('Non autorizzato');
        }
        
        // Ottieni impostazioni mercato (inline)
        $msStmt = $conn->prepare("SELECT * FROM league_market_settings WHERE league_id = ?");
        $msStmt->bind_param("i", $leagueId);
        $msStmt->execute();
        $marketSettings = $msStmt->get_result()->fetch_assoc();
        $msStmt->close();
        
        if (!$marketSettings) {
            // Crea impostazioni di default
            $msInsert = $conn->prepare("INSERT INTO league_market_settings (league_id, market_locked, require_approval) VALUES (?, 0, 0)");
            $msInsert->bind_param("i", $leagueId);
            $msInsert->execute();
            $msInsert->close();
            $marketSettings = ['league_id' => $leagueId, 'market_locked' => 0, 'require_approval' => 0];
        }
        
        // Ottieni tutti i membri della lega con info mercato (inline)
        $mbStmt = $conn->prepare("
            SELECT 
                lm.user_id,
                u.username,
                COALESCE(ub.team_name, '') as team_name,
                COALESCE(ub.coach_name, '') as coach_name,
                COALESCE(umb.blocked, 0) as blocked
            FROM league_members lm
            JOIN users u ON lm.user_id = u.id
            LEFT JOIN user_budget ub ON lm.user_id = ub.user_id AND lm.league_id = ub.league_id
            LEFT JOIN user_market_blocks umb ON lm.user_id = umb.user_id AND lm.league_id = umb.league_id
            WHERE lm.league_id = ?
            ORDER BY COALESCE(ub.team_name, u.username), u.username
        ");
        $mbStmt->bind_param("i", $leagueId);
        $mbStmt->execute();
        $members = $mbStmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $mbStmt->close();
        
        // Cast blocked a int per ogni membro
        foreach ($members as &$m) {
            $m['blocked'] = (int)$m['blocked'];
        }
        unset($m);
        
        $response = [
            'market_locked' => (int)$marketSettings['market_locked'],
            'require_approval' => (int)$marketSettings['require_approval'],
            'members' => $members,
        ];
        $statusCode = 200;
    }
    // POST /market/:leagueId/manage - Aggiorna impostazioni globali mercato
    elseif ($method === 'POST' && (strpos($path, '/market/') !== false && strpos($path, '/manage') !== false)) {
        $data = json_decode(file_get_contents('php://input'), true);
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        foreach ($pathParts as $i => $part) {
            if ($part === 'market' && isset($pathParts[$i + 1])) {
                $leagueId = (int)$pathParts[$i + 1];
                break;
            }
        }
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $memberResult = $stmt->get_result()->fetch_assoc();
        if (!$memberResult || $memberResult['role'] !== 'admin') {
            throw new Exception('Non autorizzato');
        }
        
        $setting = $data['setting'] ?? null;
        $value = isset($data['value']) ? (int)$data['value'] : 0;
        
        if (!$setting) {
            throw new Exception('Parametro setting obbligatorio');
        }
        
        // Ottieni impostazioni correnti (inline)
        $msStmt = $conn->prepare("SELECT * FROM league_market_settings WHERE league_id = ?");
        $msStmt->bind_param("i", $leagueId);
        $msStmt->execute();
        $currentSettings = $msStmt->get_result()->fetch_assoc();
        $msStmt->close();
        
        if (!$currentSettings) {
            $msInsert = $conn->prepare("INSERT INTO league_market_settings (league_id, market_locked, require_approval) VALUES (?, 0, 0)");
            $msInsert->bind_param("i", $leagueId);
            $msInsert->execute();
            $msInsert->close();
            $currentSettings = ['market_locked' => 0, 'require_approval' => 0];
        }
        
        if ($setting === 'market_locked') {
            $newMarketLocked = $value;
            $newRequireApproval = (int)$currentSettings['require_approval'];
        } elseif ($setting === 'require_approval') {
            $newMarketLocked = (int)$currentSettings['market_locked'];
            $newRequireApproval = $value;
        } else {
            throw new Exception('Impostazione non valida');
        }
        
        $upStmt = $conn->prepare("REPLACE INTO league_market_settings (league_id, market_locked, require_approval) VALUES (?, ?, ?)");
        $upStmt->bind_param("iii", $leagueId, $newMarketLocked, $newRequireApproval);
        $upStmt->execute();
        $upStmt->close();
        
        // Se è cambiato market_locked, resetta tutte le eccezioni individuali
        if ($setting === 'market_locked') {
            $resetStmt = $conn->prepare("DELETE FROM user_market_blocks WHERE league_id = ?");
            $resetStmt->bind_param("i", $leagueId);
            $resetStmt->execute();
            $resetStmt->close();
        }
        
        $response = ['success' => true];
        $statusCode = 200;
    }
    // POST /market/:leagueId/user-block - Aggiorna blocco mercato per singolo utente
    elseif ($method === 'POST' && (strpos($path, '/market/') !== false && strpos($path, '/user-block') !== false)) {
        $data = json_decode(file_get_contents('php://input'), true);
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        foreach ($pathParts as $i => $part) {
            if ($part === 'market' && isset($pathParts[$i + 1])) {
                $leagueId = (int)$pathParts[$i + 1];
                break;
            }
        }
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $adminId = $decoded['userId'];
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $adminId);
        $stmt->execute();
        $memberResult = $stmt->get_result()->fetch_assoc();
        if (!$memberResult || $memberResult['role'] !== 'admin') {
            throw new Exception('Non autorizzato');
        }
        
        $targetUserId = isset($data['user_id']) ? (int)$data['user_id'] : 0;
        $blocked = isset($data['blocked']) ? (int)$data['blocked'] : 0;
        
        if (!$targetUserId) {
            throw new Exception('ID utente obbligatorio');
        }
        
        // Verifica che l'utente target sia nella lega
        $stmt = $conn->prepare("SELECT id FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $targetUserId);
        $stmt->execute();
        if (!$stmt->get_result()->fetch_assoc()) {
            throw new Exception('Utente non trovato nella lega');
        }
        
        // Aggiorna blocco utente (inline)
        $ubStmt = $conn->prepare("
            INSERT INTO user_market_blocks (user_id, league_id, blocked) 
            VALUES (?, ?, ?) 
            ON DUPLICATE KEY UPDATE blocked = VALUES(blocked), blocked_at = CURRENT_TIMESTAMP
        ");
        $ubStmt->bind_param("iii", $targetUserId, $leagueId, $blocked);
        $ubStmt->execute();
        $ubStmt->close();
        
        $response = ['success' => true];
        $statusCode = 200;
    }
    // ========== ROSA ==========
    // GET /squad/:leagueId/limits - Ottieni limiti ruolo (DEVE essere prima di GET /squad/:leagueId)
    elseif ($method === 'GET' && (strpos($path, '/squad/') !== false && strpos($path, '/limits') !== false) || (isset($pathParts[0]) && $pathParts[0] === 'squad' && isset($pathParts[2]) && $pathParts[2] === 'limits')) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT max_portieri, max_difensori, max_centrocampisti, max_attaccanti FROM leagues WHERE id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $limits = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        $response = [
            'P' => (int)$limits['max_portieri'],
            'D' => (int)$limits['max_difensori'],
            'C' => (int)$limits['max_centrocampisti'],
            'A' => (int)$limits['max_attaccanti']
        ];
        $statusCode = 200;
    }
    // GET /squad/:leagueId - Ottieni rosa utente
    elseif ($method === 'GET' && (strpos($path, '/squad/') !== false && strpos($path, '/limits') === false && strpos($path, '/players/') === false) || (isset($pathParts[0]) && $pathParts[0] === 'squad' && !isset($pathParts[2]))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica membro lega
        $stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        if (!$stmt->get_result()->num_rows) {
            throw new Exception('Non sei membro di questa lega');
        }
        $stmt->close();
        
        // Recupera la rosa del giocatore (query diretta come in team_detail.php e rosa.php)
        $stmt = $conn->prepare("
            SELECT p.id, p.first_name, p.last_name, p.role, p.rating, t.name as team_name
            FROM user_players up
            JOIN players p ON up.player_id = p.id
            JOIN teams t ON p.team_id = t.id
            WHERE up.user_id = ? AND up.league_id = ?
            ORDER BY p.role, p.last_name, p.first_name
        ");
        $stmt->bind_param("ii", $userId, $leagueId);
        $stmt->execute();
        $squad = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmt->close();
        
        // Budget
        $stmt = $conn->prepare("SELECT budget FROM user_budget WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("ii", $userId, $leagueId);
        $stmt->execute();
        $budgetRow = $stmt->get_result()->fetch_assoc();
        $budget = $budgetRow ? floatval($budgetRow['budget']) : 0;
        $stmt->close();
        
        // Valutazione totale
        $totalValue = 0;
        foreach ($squad as $player) {
            $totalValue += floatval($player['rating']);
        }
        
        $response = [
            'players' => $squad,
            'budget' => $budget,
            'totalValue' => floatval($totalValue)
        ];
        $statusCode = 200;
    }
    // DELETE /squad/:leagueId/players/:playerId - Rimuovi giocatore
    elseif ($method === 'DELETE' && (strpos($path, '/squad/') !== false && strpos($path, '/players/') !== false)) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        $playerId = isset($pathParts[3]) ? (int)$pathParts[3] : null;
        if (!$leagueId || !$playerId) {
            throw new Exception('ID lega e giocatore obbligatori');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica membro lega
        $stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        if (!$stmt->get_result()->num_rows) {
            throw new Exception('Non sei membro di questa lega');
        }
        
        // Verifica blocco mercato
        $marketBlockStatus = isMarketBlocked($userId, $leagueId);
        if ($marketBlockStatus['blocked']) {
            throw new Exception('Il mercato è bloccato');
        }
        
        // Recupera rating giocatore
        $stmt = $conn->prepare("SELECT rating FROM players WHERE id = ?");
        $stmt->bind_param("i", $playerId);
        $stmt->execute();
        $player = $stmt->get_result()->fetch_assoc();
        if (!$player) {
            throw new Exception('Giocatore non trovato');
        }
        
        // Verifica che appartenga all'utente
        $stmt = $conn->prepare("SELECT 1 FROM user_players WHERE user_id = ? AND league_id = ? AND player_id = ?");
        $stmt->bind_param("iii", $userId, $leagueId, $playerId);
        $stmt->execute();
        if (!$stmt->get_result()->num_rows) {
            throw new Exception('Giocatore non nella tua rosa');
        }
        
        // Transazione atomica per vendita
        $conn->begin_transaction();
        try {
        // 1. Rimuovi giocatore da user_players
        $stmt = $conn->prepare("DELETE FROM user_players WHERE user_id = ? AND league_id = ? AND player_id = ?");
        $stmt->bind_param("iii", $userId, $leagueId, $playerId);
        $stmt->execute();
        $stmt->close();
        
        // 2. Riaccredita budget con lock
        $stmt = $conn->prepare("SELECT budget FROM user_budget WHERE user_id = ? AND league_id = ? FOR UPDATE");
        $stmt->bind_param("ii", $userId, $leagueId);
        $stmt->execute();
        $stmt->get_result();
        $stmt->close();
        
        $stmt = $conn->prepare("UPDATE user_budget SET budget = budget + ? WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("dii", $player['rating'], $userId, $leagueId);
        $stmt->execute();
        $stmt->close();
        
        // 3. Rimuovi giocatore da tutte le formazioni (titolari e panchina)
        $stmt = $conn->prepare("SELECT giornata, titolari, panchina FROM user_lineups WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("ii", $userId, $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $titolari = $row['titolari'];
            $panchina = $row['panchina'];
            $giornata = $row['giornata'];
            
            // Gestisci titolari (può essere JSON o CSV)
            $titolariArr = [];
            if ($titolari) {
                if ($titolari[0] === '[') {
                    $titolariArr = json_decode($titolari, true) ?: [];
                } else {
                    $titolariArr = explode(',', $titolari);
                }
            }
            $titolariArr = array_filter($titolariArr, function($pid) use ($playerId) { 
                return (string)$pid !== (string)$playerId && $pid !== ''; 
            });
            
            // Gestisci panchina (può essere JSON o CSV)
            $panchinaArr = [];
            if ($panchina) {
                if ($panchina[0] === '[') {
                    $panchinaArr = json_decode($panchina, true) ?: [];
                } else {
                    $panchinaArr = explode(',', $panchina);
                }
            }
            $panchinaArr = array_filter($panchinaArr, function($pid) use ($playerId) { 
                return (string)$pid !== (string)$playerId && $pid !== ''; 
            });
            
            // Salva formazioni aggiornate
            $titolariStr = json_encode(array_values($titolariArr));
            $panchinaStr = json_encode(array_values($panchinaArr));
            $stmt2 = $conn->prepare("UPDATE user_lineups SET titolari = ?, panchina = ? WHERE user_id = ? AND league_id = ? AND giornata = ?");
            $stmt2->bind_param("ssiii", $titolariStr, $panchinaStr, $userId, $leagueId, $giornata);
            $stmt2->execute();
            $stmt2->close();
        }
        $stmt->close();
        
        // Recupera nuovo budget per la risposta
        $stmt = $conn->prepare("SELECT budget FROM user_budget WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("ii", $userId, $leagueId);
        $stmt->execute();
        $budgetRow = $stmt->get_result()->fetch_assoc();
        $newBudget = $budgetRow ? $budgetRow['budget'] : 0;
        $stmt->close();
        
        $conn->commit();
        
        $response = [
            'message' => 'Giocatore rimosso con successo',
            'newBudget' => floatval($newBudget)
        ];
        $statusCode = 200;
        } catch (Exception $sellEx) {
            $conn->rollback();
            throw $sellEx;
        }
    }
    // ========== FORMAZIONI ==========
    // GET /formation/:leagueId/matchdays - Ottieni giornate (DEVE essere prima di GET /formation/:leagueId/:giornata)
    elseif ($method === 'GET' && (strpos($path, '/formation/') !== false && strpos($path, '/matchdays') !== false) || (isset($pathParts[0]) && $pathParts[0] === 'formation' && isset($pathParts[2]) && $pathParts[2] === 'matchdays')) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $conn = getDbConnection();
        
        // Se la lega è collegata, leggi le giornate dalla lega sorgente
        $effectiveLeagueId = getEffectiveLeagueId($leagueId);
        
        $stmt = $conn->prepare("SELECT id, giornata, deadline FROM matchdays WHERE league_id = ? ORDER BY giornata ASC");
        $stmt->bind_param("i", $effectiveLeagueId);
        $stmt->execute();
        $matchdays = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmt->close();
        
        $response = $matchdays;
        $statusCode = 200;
    }
    // GET /formation/:leagueId/:giornata/deadline - Ottieni deadline (DEVE essere prima di GET /formation/:leagueId/:giornata)
    elseif ($method === 'GET' && (strpos($path, '/formation/') !== false && strpos($path, '/deadline') !== false && !strpos($path, '/matchdays')) || (isset($pathParts[0]) && $pathParts[0] === 'formation' && isset($pathParts[3]) && $pathParts[3] === 'deadline')) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        $giornata = isset($pathParts[2]) ? (int)$pathParts[2] : null;
        if (!$leagueId || !$giornata) {
            throw new Exception('ID lega e giornata obbligatori');
        }
        
        // Se la lega è collegata, leggi la deadline dalla lega sorgente
        $effectiveLeagueId = getEffectiveLeagueId($leagueId);
        
        $deadline = getMatchdayDeadline($effectiveLeagueId, $giornata);
        $isExpired = isMatchdayExpired($effectiveLeagueId, $giornata);
        
        $response = ['deadline' => $deadline, 'isExpired' => $isExpired];
        $statusCode = 200;
    }
    // GET /formation/:leagueId/:giornata - Ottieni formazione
    elseif ($method === 'GET' && (strpos($path, '/formation/') !== false && strpos($path, '/matchdays') === false && strpos($path, '/deadline') === false)) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        $giornata = isset($pathParts[2]) ? (int)$pathParts[2] : null;
        if (!$leagueId || !$giornata) {
            throw new Exception('ID lega e giornata obbligatori');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica membro lega
        $stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        if (!$stmt->get_result()->num_rows) {
            throw new Exception('Non sei membro di questa lega');
        }
        
        // Recupera formazione
        $stmt = $conn->prepare("SELECT modulo, titolari, panchina FROM user_lineups WHERE user_id = ? AND league_id = ? AND giornata = ?");
        $stmt->bind_param("iii", $userId, $leagueId, $giornata);
        $stmt->execute();
        $formation = $stmt->get_result()->fetch_assoc();
        
        // Recupera deadline
        $deadline = getMatchdayDeadline($leagueId, $giornata);
        $isExpired = isMatchdayExpired($leagueId, $giornata);
        
        $response = [
            'formation' => $formation,
            'deadline' => $deadline,
            'isExpired' => $isExpired
        ];
        $statusCode = 200;
    }
    // POST /formation/:leagueId/:giornata - Salva formazione
    elseif ($method === 'POST' && (strpos($path, '/formation/') !== false && !strpos($path, '/matchdays') && !strpos($path, '/deadline'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        $giornata = isset($pathParts[2]) ? (int)$pathParts[2] : null;
        if (!$leagueId || !$giornata) {
            throw new Exception('ID lega e giornata obbligatori');
        }
        
        // Verifica scadenza
        if (isMatchdayExpired($leagueId, $giornata)) {
            throw new Exception('La scadenza per questa giornata è passata');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        $modulo = isset($data['modulo']) ? $data['modulo'] : '';
        $titolari = isset($data['titolari']) ? (is_array($data['titolari']) ? implode(',', $data['titolari']) : $data['titolari']) : '';
        $panchina = isset($data['panchina']) ? (is_array($data['panchina']) ? implode(',', $data['panchina']) : $data['panchina']) : '';
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica membro lega
        $stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        if (!$stmt->get_result()->num_rows) {
            throw new Exception('Non sei membro di questa lega');
        }
        
        // Salva o aggiorna formazione
        $stmt = $conn->prepare("REPLACE INTO user_lineups (user_id, league_id, giornata, modulo, titolari, panchina) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->bind_param("iiisss", $userId, $leagueId, $giornata, $modulo, $titolari, $panchina);
        $stmt->execute();
        
        $response = ['message' => 'Formazione salvata con successo'];
        $statusCode = 200;
    }
    // ========== PROFILO ==========
    // GET /profile - Ottieni profilo utente
    elseif ($method === 'GET' && (strpos($path, '/profile') !== false || (isset($pathParts[0]) && $pathParts[0] === 'profile' && !isset($pathParts[1])))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        $stmt = $conn->prepare("SELECT id, username, email FROM users WHERE id = ?");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $user = $stmt->get_result()->fetch_assoc();
        
        $response = $user;
        $statusCode = 200;
    }
    // PUT /profile - Aggiorna profilo
    elseif ($method === 'PUT' && (strpos($path, '/profile') !== false || (isset($pathParts[0]) && $pathParts[0] === 'profile' && !isset($pathParts[1])))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Aggiorna username se fornito
        if (isset($data['username'])) {
            $newUsername = trim($data['username']);
            if ($newUsername !== '') {
                // Verifica se username esiste già
                $stmt = $conn->prepare("SELECT id FROM users WHERE username = ? AND id != ?");
                $stmt->bind_param("si", $newUsername, $userId);
                $stmt->execute();
                if ($stmt->get_result()->num_rows > 0) {
                    throw new Exception('Username già esistente');
                }
                
                $stmt = $conn->prepare("UPDATE users SET username = ? WHERE id = ?");
                $stmt->bind_param("si", $newUsername, $userId);
                $stmt->execute();
            }
        }
        
        // Aggiorna email se fornita
        if (isset($data['email'])) {
            $newEmail = trim($data['email']);
            if ($newEmail !== '') {
                // Verifica se email esiste già
                $stmt = $conn->prepare("SELECT id FROM users WHERE email = ? AND id != ?");
                $stmt->bind_param("si", $newEmail, $userId);
                $stmt->execute();
                if ($stmt->get_result()->num_rows > 0) {
                    throw new Exception('Email già registrata');
                }
                
                $stmt = $conn->prepare("UPDATE users SET email = ? WHERE id = ?");
                $stmt->bind_param("si", $newEmail, $userId);
                $stmt->execute();
            }
        }
        
        $response = ['message' => 'Profilo aggiornato con successo'];
        $statusCode = 200;
    }
    // ========== TEAMS ==========
    // GET /teams/:leagueId/:userId - Ottieni dettagli squadra (DEVE essere prima di GET /teams/:leagueId)
    elseif ($method === 'GET' && strpos($path, '/teams/') !== false && isset($pathParts[0]) && $pathParts[0] === 'teams' && isset($pathParts[1]) && isset($pathParts[2]) && is_numeric($pathParts[2])) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        $targetUserId = isset($pathParts[2]) ? (int)$pathParts[2] : null;
        if (!$leagueId || !$targetUserId) {
            throw new Exception('ID lega e ID utente obbligatori');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica membro lega
        $stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        if (!$stmt->get_result()->num_rows) {
            throw new Exception('Non sei membro di questa lega');
        }
        $stmt->close();
        
        // Recupera dati squadra
        $stmt = $conn->prepare("
            SELECT u.id, u.username, ub.team_name, ub.coach_name, ub.budget,
                   COALESCE(NULLIF(ub.team_logo, ''), 'default_1') as team_logo
            FROM users u 
            JOIN user_budget ub ON u.id = ub.user_id 
            WHERE ub.league_id = ? AND u.id = ?
        ");
        $stmt->bind_param("ii", $leagueId, $targetUserId);
        $stmt->execute();
        $teamData = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$teamData) {
            throw new Exception('Squadra non trovata');
        }
        
        // Recupera rosa
        $stmt = $conn->prepare("
            SELECT p.id, p.first_name, p.last_name, p.role, p.rating, t.name as team_name
            FROM user_players up
            JOIN players p ON up.player_id = p.id
            JOIN teams t ON p.team_id = t.id
            WHERE up.user_id = ? AND up.league_id = ?
            ORDER BY p.role, p.last_name, p.first_name
        ");
        $stmt->bind_param("ii", $targetUserId, $leagueId);
        $stmt->execute();
        $result = $stmt->get_result();
        
        $squad = [];
        while ($row = $result->fetch_assoc()) {
            $squad[] = [
                'id' => (int)$row['id'],
                'first_name' => $row['first_name'],
                'last_name' => $row['last_name'],
                'role' => $row['role'],
                'rating' => floatval($row['rating']),
                'team_name' => $row['team_name']
            ];
        }
        $stmt->close();
        
        // Recupera risultati per giornata (calcola punteggio come nel sito)
        $league = getLeagueById($leagueId);
        if (!$league) {
            throw new Exception('Lega non trovata');
        }
        
        // Recupera giornate
        $stmt = $conn->prepare("SELECT giornata, deadline FROM matchdays WHERE league_id = ? ORDER BY giornata");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $giornate = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmt->close();
        
        // Recupera rose
        $rose = [];
        $stmt = $conn->prepare("SELECT up.user_id, up.player_id FROM user_players up WHERE up.league_id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $rose[$row['user_id']][] = $row['player_id'];
        }
        $stmt->close();
        
        // Recupera bonus settings
        $bonus_settings = getLeagueBonusSettings($leagueId);
        $bonus_enabled = (bool)$bonus_settings['enable_bonus_malus'];
        
        // Calcola risultati per ogni giornata
        $results = [];
        foreach ($giornate as $g) {
            $giornata_calc = $g['giornata'];
            $punteggio_giornata = 0;
            
            // Recupera voti e bonus per questa giornata
            $voti_giornata = [];
            $player_ratings_giornata = [];
            $stmt = $conn->prepare("SELECT player_id, rating, goals, assists, yellow_cards, red_cards, goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet FROM player_ratings WHERE league_id = ? AND giornata = ?");
            $stmt->bind_param("ii", $leagueId, $giornata_calc);
            $stmt->execute();
            $res = $stmt->get_result();
            $has_voti = false;
            while ($row = $res->fetch_assoc()) {
                $voti_giornata[$row['player_id']] = $row['rating'];
                $player_ratings_giornata[$row['player_id']] = $row;
                $has_voti = true;
            }
            $stmt->close();
            
            if ($has_voti) {
                // Recupera titolari per questa giornata
                $titolari = [];
                if ($league['auto_lineup_mode']) {
                    $titolari = build_auto_lineup($targetUserId, $league, $rose, $voti_giornata, $conn);
                } else {
                    $stmt = $conn->prepare("SELECT titolari FROM user_lineups WHERE user_id = ? AND league_id = ? AND giornata = ?");
                    $stmt->bind_param("iii", $targetUserId, $leagueId, $giornata_calc);
                    $stmt->execute();
                    $res = $stmt->get_result();
                    if ($row = $res->fetch_assoc()) {
                        $titolari_str = $row['titolari'];
                        if ($titolari_str && $titolari_str[0] === '[') {
                            $titolari = json_decode($titolari_str, true);
                        } else if ($titolari_str) {
                            $titolari = explode(',', $titolari_str);
                        }
                    }
                    $stmt->close();
                }
                
                // Calcola punteggio
                if (!empty($titolari)) {
                    foreach ($titolari as $pid) {
                        if ($pid && isset($player_ratings_giornata[$pid])) {
                            $playerRating = $player_ratings_giornata[$pid];
                            $punteggio_giornata += calculatePlayerScore($playerRating, $bonus_settings);
                        }
                    }
                }
            }
            
            $results[] = [
                'giornata' => (int)$giornata_calc,
                'deadline' => $g['deadline'],
                'punteggio_giornata' => round($punteggio_giornata, 1)
            ];
        }
        
        $response = [
            'team' => [
                'id' => (int)$teamData['id'],
                'username' => $teamData['username'],
                'team_name' => $teamData['team_name'],
                'coach_name' => $teamData['coach_name'],
                'budget' => floatval($teamData['budget']),
                'team_logo' => (!empty($teamData['team_logo']) && $teamData['team_logo'] !== '') ? $teamData['team_logo'] : 'default_1'
            ],
            'squad' => $squad,
            'results' => $results
        ];
        $statusCode = 200;
    }
    // GET /teams/:leagueId - Ottieni lista squadre della lega
    elseif ($method === 'GET' && strpos($path, '/teams/') !== false && isset($pathParts[0]) && $pathParts[0] === 'teams' && isset($pathParts[1]) && !isset($pathParts[2])) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica membro lega
        $stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        if (!$stmt->get_result()->num_rows) {
            throw new Exception('Non sei membro di questa lega');
        }
        $stmt->close();
        
        // Recupera le squadre della lega
        $stmt = $conn->prepare("
            SELECT u.id, u.username, ub.team_name, ub.coach_name, ub.budget, 
                   COALESCE(NULLIF(ub.team_logo, ''), 'default_1') as team_logo
            FROM users u 
            JOIN user_budget ub ON u.id = ub.user_id 
            WHERE ub.league_id = ?
            ORDER BY ub.team_name
        ");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $result = $stmt->get_result();
        
        $teams = [];
        while ($row = $result->fetch_assoc()) {
            $teams[] = [
                'id' => (int)$row['id'],
                'username' => $row['username'],
                'team_name' => $row['team_name'],
                'coach_name' => $row['coach_name'],
                'budget' => floatval($row['budget']),
                'team_logo' => (!empty($row['team_logo']) && $row['team_logo'] !== '') ? $row['team_logo'] : 'default_1'
            ];
        }
        $stmt->close();
        
        $response = $teams;
        $statusCode = 200;
    }
    // POST /leagues/:id/teams/:teamId/players - Aggiungi nuovo giocatore (admin only) - DEVE essere PRIMA di POST /leagues/:id/teams
    elseif ($method === 'POST' && ((strpos($path, '/leagues/') !== false && strpos($path, '/teams/') !== false && strpos($path, '/players') !== false && strpos($path, '/players/') === false) || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3]) && isset($pathParts[4]) && $pathParts[4] === 'players' && !isset($pathParts[5])))) {
        ensurePlayersShirtNumberColumn();
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Blocca per leghe collegate
        $checkLeagueIdForLink = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if ($checkLeagueIdForLink && isLinkedLeague($checkLeagueIdForLink)) {
            throw new Exception('Non puoi aggiungere giocatori in una lega collegata a una lega ufficiale.');
        }
        
        $leagueId = null;
        $teamId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3]) && isset($pathParts[4]) && $pathParts[4] === 'players' && !isset($pathParts[5])) {
            $leagueId = (int)$pathParts[1];
            $teamId = (int)$pathParts[3];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/teams\/(\d+)\/players$/', $path, $matches)) {
                $leagueId = (int)$matches[1];
                $teamId = (int)$matches[2];
            }
        }
        
        if (!$leagueId || !$teamId) {
            throw new Exception('ID lega e ID squadra obbligatori');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono aggiungere giocatori');
        }
        
        // Verifica che la squadra appartenga alla lega
        $stmt = $conn->prepare("SELECT id FROM teams WHERE id = ? AND league_id = ?");
        $stmt->bind_param("ii", $teamId, $leagueId);
        $stmt->execute();
        $team = $stmt->get_result()->fetch_assoc();
        
        if (!$team) {
            throw new Exception('Squadra non trovata');
        }
        
        $input = json_decode(file_get_contents('php://input'), true);
        
        // Validazione
        if (empty($input['first_name']) || empty($input['last_name'])) {
            throw new Exception('Nome e cognome sono obbligatori');
        }
        if (!in_array($input['role'], ['P', 'D', 'C', 'A'])) {
            throw new Exception('Ruolo non valido');
        }
        if (!isset($input['rating']) || !is_numeric($input['rating'])) {
            throw new Exception('Valutazione non valida');
        }
        
        $rating = floatval($input['rating']);
        $role = $input['role'];
        
        // Inserisci il nuovo giocatore
        $shirtNumber = (isset($input['shirt_number']) && $input['shirt_number'] !== '') ? (int)$input['shirt_number'] : null;
        $stmt = $conn->prepare("INSERT INTO players (first_name, last_name, team_id, role, rating, shirt_number) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->bind_param("ssisdi", $input['first_name'], $input['last_name'], $teamId, $role, $rating, $shirtNumber);
        
        if (!$stmt->execute()) {
            error_log("POST /leagues/:id/teams/:teamId/players - SQL Error: " . $stmt->error);
            throw new Exception('Errore durante l\'inserimento del giocatore: ' . $stmt->error);
        }
        
        $newPlayerId = $conn->insert_id;
        $stmt->close();
        
        $response = ['message' => 'Giocatore aggiunto con successo', 'player_id' => $newPlayerId];
        $statusCode = 200;
    }
    // POST /leagues/:id/teams/:teamId/logo - Upload logo squadra ufficiale (admin only)
    elseif ($method === 'POST' && ((strpos($path, '/leagues/') !== false && strpos($path, '/teams/') !== false && strpos($path, '/logo') !== false && strpos($path, '/players') === false) || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3]) && isset($pathParts[4]) && $pathParts[4] === 'logo'))) {
        ensureTeamsLogoColumn();
        $token = getAuthToken();
        if (!$token) throw new Exception('Token di autenticazione mancante');
        $decoded = verifyJWT($token);
        if (!$decoded) throw new Exception('Token non valido o scaduto');

        $leagueId = null;
        $teamId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3])) {
            $leagueId = (int)$pathParts[1];
            $teamId = (int)$pathParts[3];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/teams\/(\d+)\/logo/', $path, $matches)) {
                $leagueId = (int)$matches[1];
                $teamId = (int)$matches[2];
            }
        }
        if (!$leagueId || !$teamId) throw new Exception('ID lega e ID squadra obbligatori');

        $userId = (int)$decoded['userId'];
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if (!$member || $member['role'] !== 'admin') throw new Exception('Solo gli amministratori possono caricare logo squadra');

        $effectiveLeagueId = getEffectiveLeagueId($leagueId);
        $stmt = $conn->prepare("SELECT id, logo_path FROM teams WHERE id = ? AND league_id = ? LIMIT 1");
        $stmt->bind_param("ii", $teamId, $effectiveLeagueId);
        $stmt->execute();
        $teamRow = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if (!$teamRow) throw new Exception('Squadra non trovata');

        if (empty($_FILES) || !isset($_FILES['logo'])) throw new Exception('Nessun file logo ricevuto');
        $file = $_FILES['logo'];
        if (!isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) throw new Exception('Upload non valido');
        if (!empty($file['error']) && (int)$file['error'] !== UPLOAD_ERR_OK) throw new Exception('Errore upload file');
        if ((int)$file['size'] > 2 * 1024 * 1024) throw new Exception('Il file è troppo grande (max 2MB)');

        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($file['tmp_name']);
        $allowedMimes = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
        if (!isset($allowedMimes[$mime])) throw new Exception('Formato non supportato. Usa JPG, PNG o WEBP');
        $extension = $allowedMimes[$mime];

        $uploadDir = __DIR__ . '/uploads/official_team_logos/';
        if (!file_exists($uploadDir)) mkdir($uploadDir, 0755, true);
        $filename = 'official_team_' . $teamId . '_' . time() . '.' . $extension;
        $filepath = $uploadDir . $filename;
        $relativePath = 'uploads/official_team_logos/' . $filename;
        if (!move_uploaded_file($file['tmp_name'], $filepath)) throw new Exception('Impossibile salvare il file');

        $stmt = $conn->prepare("UPDATE teams SET logo_path = ? WHERE id = ?");
        $stmt->bind_param("si", $relativePath, $teamId);
        $stmt->execute();
        $stmt->close();

        $oldLogo = $teamRow['logo_path'] ?? null;
        if ($oldLogo && file_exists(__DIR__ . '/' . $oldLogo)) {
            @unlink(__DIR__ . '/' . $oldLogo);
        }

        $response = ['message' => 'Logo squadra caricato con successo', 'logo_path' => $relativePath];
        $statusCode = 200;
    }
    // POST /leagues/:id/teams - Aggiungi squadra (admin only)
    elseif ($method === 'POST' && (strpos($path, '/leagues/') !== false && strpos($path, '/teams') !== false && strpos($path, '/teams/') === false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/teams/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        // Blocca per leghe collegate
        if (isLinkedLeague($leagueId)) {
            throw new Exception('Non puoi aggiungere squadre in una lega collegata a una lega ufficiale.');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono aggiungere squadre');
        }
        
        $input = json_decode(file_get_contents('php://input'), true);
        $teamName = isset($input['name']) ? trim($input['name']) : '';
        
        if (empty($teamName)) {
            throw new Exception('Nome squadra obbligatorio');
        }
        
        // Verifica duplicati nella stessa lega
        $stmt = $conn->prepare("SELECT id FROM teams WHERE league_id = ? AND name = ?");
        $stmt->bind_param("is", $leagueId, $teamName);
        $stmt->execute();
        $existing = $stmt->get_result()->fetch_assoc();
        
        if ($existing) {
            throw new Exception("La squadra '$teamName' esiste già in questa lega");
        }
        
        // Inserisci squadra
        $stmt = $conn->prepare("INSERT INTO teams (name, league_id) VALUES (?, ?)");
        $stmt->bind_param("si", $teamName, $leagueId);
        
        if (!$stmt->execute()) {
            throw new Exception('Errore durante l\'inserimento della squadra');
        }
        
        $response = ['message' => 'Squadra aggiunta con successo', 'id' => $conn->insert_id];
        $statusCode = 200;
    }
    // GET /leagues/:id/teams/:teamId/players - Ottieni giocatori di una squadra (admin only)
    elseif ($method === 'GET' && (strpos($path, '/leagues/') !== false && strpos($path, '/teams/') !== false && strpos($path, '/players') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3]) && isset($pathParts[4]) && $pathParts[4] === 'players'))) {
        ensurePlayersShirtNumberColumn();
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        $teamId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3])) {
            $leagueId = (int)$pathParts[1];
            $teamId = (int)$pathParts[3];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/teams\/(\d+)\/players/', $path, $matches)) {
                $leagueId = (int)$matches[1];
                $teamId = (int)$matches[2];
            }
        }
        
        if (!$leagueId || !$teamId) {
            throw new Exception('ID lega e ID squadra obbligatori');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono accedere ai giocatori');
        }
        
        // Verifica che la squadra appartenga alla lega
        $stmt = $conn->prepare("SELECT id FROM teams WHERE id = ? AND league_id = ?");
        $stmt->bind_param("ii", $teamId, $leagueId);
        $stmt->execute();
        $team = $stmt->get_result()->fetch_assoc();
        
        if (!$team) {
            throw new Exception('Squadra non trovata');
        }
        
        // Recupera i giocatori della squadra
        $stmt = $conn->prepare("
            SELECT id, first_name, last_name, role, rating, shirt_number
            FROM players 
            WHERE team_id = ? 
            ORDER BY role, COALESCE(shirt_number, 999), last_name, first_name
        ");
        $stmt->bind_param("i", $teamId);
        $stmt->execute();
        $result = $stmt->get_result();
        
        $players = [];
        while ($row = $result->fetch_assoc()) {
            $players[] = [
                'id' => (int)$row['id'],
                'first_name' => $row['first_name'],
                'last_name' => $row['last_name'],
                'role' => $row['role'],
                'rating' => floatval($row['rating']),
                'shirt_number' => isset($row['shirt_number']) ? (int)$row['shirt_number'] : null
            ];
        }
        $stmt->close();
        
        // Assicurati che la risposta sia sempre un array
        if (!is_array($players)) {
            $players = [];
        }
        $response = $players;
        $statusCode = 200;
    }
    // PUT /leagues/:id/teams/:teamId - Colore maglia in formazioni ufficiali (admin only)
    elseif ($method === 'PUT' && isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3]) && !isset($pathParts[4])) {
        ensureTeamsJerseyColorColumn();
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        $leagueId = (int)$pathParts[1];
        $teamId = (int)$pathParts[3];
        $userId = (int)$decoded['userId'];
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono modificare il colore maglia');
        }
        $data = json_decode(file_get_contents('php://input'), true);
        if (!is_array($data) || !array_key_exists('jersey_color', $data)) {
            throw new Exception('Campo jersey_color richiesto (stringa #RRGGBB o null/vuoto per predefinito)');
        }
        $rawIn = $data['jersey_color'];
        $trimIn = is_string($rawIn) ? trim($rawIn) : '';
        if ($rawIn === null || $rawIn === '' || $trimIn === '') {
            $norm = null;
        } else {
            $norm = normalizeJerseyColorForApi(is_string($rawIn) ? $rawIn : (string)$rawIn);
            if ($norm === null) {
                throw new Exception('Colore non valido. Usa formato #RRGGBB o #RGB');
            }
        }
        $effectiveLeagueId = getEffectiveLeagueId($leagueId);
        $stmt = $conn->prepare("SELECT id FROM teams WHERE id = ? AND league_id = ? LIMIT 1");
        $stmt->bind_param("ii", $teamId, $effectiveLeagueId);
        $stmt->execute();
        $teamRow = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if (!$teamRow) {
            throw new Exception('Squadra non trovata');
        }
        if ($norm === null) {
            $stmt = $conn->prepare("UPDATE teams SET jersey_color = NULL WHERE id = ?");
            $stmt->bind_param("i", $teamId);
        } else {
            $stmt = $conn->prepare("UPDATE teams SET jersey_color = ? WHERE id = ?");
            $stmt->bind_param("si", $norm, $teamId);
        }
        $stmt->execute();
        $stmt->close();
        $response = ['message' => 'Colore maglia aggiornato', 'jersey_color' => $norm];
        $statusCode = 200;
    }
    // PUT /leagues/:id/teams/:teamId/players/:playerId - Modifica giocatore (admin only)
    elseif ($method === 'PUT' && (strpos($path, '/leagues/') !== false && strpos($path, '/teams/') !== false && strpos($path, '/players/') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3]) && isset($pathParts[4]) && $pathParts[4] === 'players' && isset($pathParts[5]) && is_numeric($pathParts[5])))) {
        ensurePlayersShirtNumberColumn();
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Blocca per leghe collegate
        $checkLeagueIdForLink = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if ($checkLeagueIdForLink && isLinkedLeague($checkLeagueIdForLink)) {
            throw new Exception('Non puoi modificare giocatori in una lega collegata a una lega ufficiale.');
        }
        
        $leagueId = null;
        $teamId = null;
        $playerId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3]) && isset($pathParts[4]) && $pathParts[4] === 'players' && isset($pathParts[5]) && is_numeric($pathParts[5])) {
            $leagueId = (int)$pathParts[1];
            $teamId = (int)$pathParts[3];
            $playerId = (int)$pathParts[5];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/teams\/(\d+)\/players\/(\d+)/', $path, $matches)) {
                $leagueId = (int)$matches[1];
                $teamId = (int)$matches[2];
                $playerId = (int)$matches[3];
            }
        }
        
        if (!$leagueId || !$teamId || !$playerId) {
            throw new Exception('ID lega, ID squadra e ID giocatore obbligatori');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono modificare i giocatori');
        }
        
        // Verifica che la squadra appartenga alla lega
        $stmt = $conn->prepare("SELECT id FROM teams WHERE id = ? AND league_id = ?");
        $stmt->bind_param("ii", $teamId, $leagueId);
        $stmt->execute();
        $team = $stmt->get_result()->fetch_assoc();
        
        if (!$team) {
            throw new Exception('Squadra non trovata');
        }
        
        // Verifica che il giocatore esista (non verifichiamo più che appartenga alla squadra corrente, perché potrebbe essere spostato)
        $stmt = $conn->prepare("SELECT id, team_id FROM players WHERE id = ?");
        $stmt->bind_param("i", $playerId);
        $stmt->execute();
        $player = $stmt->get_result()->fetch_assoc();
        
        if (!$player) {
            throw new Exception('Giocatore non trovato');
        }
        
        $currentTeamId = (int)$player['team_id'];
        
        $input = json_decode(file_get_contents('php://input'), true);
        
        // Validazione base
        if (empty($input['first_name']) || empty($input['last_name'])) {
            throw new Exception('Nome e cognome sono obbligatori');
        }
        
        // Se viene passato un nuovo team_id, verifica che appartenga alla lega
        $newTeamId = isset($input['team_id']) ? (int)$input['team_id'] : $currentTeamId;
        if ($newTeamId !== $currentTeamId) {
            $stmt = $conn->prepare("SELECT id FROM teams WHERE id = ? AND league_id = ?");
            $stmt->bind_param("ii", $newTeamId, $leagueId);
            $stmt->execute();
            $newTeam = $stmt->get_result()->fetch_assoc();
            
            if (!$newTeam) {
                throw new Exception('Squadra di destinazione non trovata o non appartiene alla lega');
            }
        }
        
        // Controlla se il giocatore è già stato acquistato da qualche utente nella lega
        $checkPurchased = $conn->prepare("
            SELECT COUNT(*) as count 
            FROM user_players up 
            JOIN players p ON up.player_id = p.id 
            JOIN teams t ON p.team_id = t.id 
            WHERE up.player_id = ? AND t.league_id = ?
        ");
        $checkPurchased->bind_param("ii", $playerId, $leagueId);
        $checkPurchased->execute();
        $purchasedResult = $checkPurchased->get_result()->fetch_assoc();
        $purchasedCount = (int)$purchasedResult['count'];
        $checkPurchased->close();
        
        error_log("PUT /leagues/:id/teams/:teamId/players/:playerId - Player $playerId purchased count: $purchasedCount");
        
        if ($purchasedCount > 0) {
            // Se è stato acquistato, permette solo la modifica di nome, cognome e squadra (non rating e ruolo)
            error_log("PUT /leagues/:id/teams/:teamId/players/:playerId - Player already purchased, updating first_name, last_name and team_id");
            
            $shirtNumber = (isset($input['shirt_number']) && $input['shirt_number'] !== '') ? (int)$input['shirt_number'] : null;
            $stmt = $conn->prepare("UPDATE players SET first_name = ?, last_name = ?, team_id = ?, shirt_number = ? WHERE id = ?");
            $stmt->bind_param("ssiii", $input['first_name'], $input['last_name'], $newTeamId, $shirtNumber, $playerId);
            
            if (!$stmt->execute()) {
                error_log("PUT /leagues/:id/teams/:teamId/players/:playerId - SQL Error: " . $stmt->error);
                throw new Exception('Errore durante l\'aggiornamento del giocatore: ' . $stmt->error);
            }
            
            if ($stmt->affected_rows === 0) {
                error_log("PUT /leagues/:id/teams/:teamId/players/:playerId - No rows affected (data unchanged)");
                // Non è un errore se i dati sono identici, semplicemente non c'è nulla da aggiornare
                $response = ['message' => 'Nessuna modifica necessaria'];
                $statusCode = 200;
            } else {
                $response = ['message' => 'Giocatore aggiornato con successo (Rating e ruolo non modificabili - giocatore già acquistato)'];
                $statusCode = 200;
            }
            
            $stmt->close();
        } else {
            // Se non è stato acquistato, permette la modifica di tutti i campi incluso team_id
            if (!in_array($input['role'], ['P', 'D', 'C', 'A'])) {
                throw new Exception('Ruolo non valido');
            }
            if (!isset($input['rating']) || !is_numeric($input['rating'])) {
                throw new Exception('Valutazione non valida');
            }
            
            error_log("PUT /leagues/:id/teams/:teamId/players/:playerId - Player not purchased, updating all fields including team_id");
            error_log("PUT /leagues/:id/teams/:teamId/players/:playerId - Updating player $playerId with data: " . json_encode($input));
            
            $rating = floatval($input['rating']);
            $role = $input['role'];
            
            error_log("PUT /leagues/:id/teams/:teamId/players/:playerId - Role value: '$role', type: " . gettype($role));
            error_log("PUT /leagues/:id/teams/:teamId/players/:playerId - Rating value: $rating, type: " . gettype($rating));
            error_log("PUT /leagues/:id/teams/:teamId/players/:playerId - Team ID: current=$currentTeamId, new=$newTeamId");
            
            // Aggiorna tutti i campi incluso team_id
            $shirtNumber = (isset($input['shirt_number']) && $input['shirt_number'] !== '') ? (int)$input['shirt_number'] : null;
            $stmt = $conn->prepare("UPDATE players SET first_name = ?, last_name = ?, role = ?, rating = ?, team_id = ?, shirt_number = ? WHERE id = ?");
            $stmt->bind_param("sssdiii", $input['first_name'], $input['last_name'], $role, $rating, $newTeamId, $shirtNumber, $playerId);
            
            if (!$stmt->execute()) {
                error_log("PUT /leagues/:id/teams/:teamId/players/:playerId - SQL Error: " . $stmt->error);
                throw new Exception('Errore durante l\'aggiornamento del giocatore: ' . $stmt->error);
            }
            
            if ($stmt->affected_rows === 0) {
                error_log("PUT /leagues/:id/teams/:teamId/players/:playerId - No rows affected (data unchanged)");
                // Non è un errore se i dati sono identici, semplicemente non c'è nulla da aggiornare
                $response = ['message' => 'Nessuna modifica necessaria'];
                $statusCode = 200;
            } else {
                $response = ['message' => 'Giocatore aggiornato con successo'];
                $statusCode = 200;
            }
            
            $stmt->close();
        }
        
        error_log("PUT /leagues/:id/teams/:teamId/players/:playerId - Player updated successfully");
    }
    // DELETE /leagues/:id/teams/:teamId/players/:playerId - Elimina giocatore (admin only)
    elseif ($method === 'DELETE' && (strpos($path, '/leagues/') !== false && strpos($path, '/teams/') !== false && strpos($path, '/players/') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3]) && isset($pathParts[4]) && $pathParts[4] === 'players' && isset($pathParts[5]) && is_numeric($pathParts[5])))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Blocca per leghe collegate
        $checkLeagueIdForLink = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if ($checkLeagueIdForLink && isLinkedLeague($checkLeagueIdForLink)) {
            throw new Exception('Non puoi eliminare giocatori in una lega collegata a una lega ufficiale.');
        }
        
        $leagueId = null;
        $teamId = null;
        $playerId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3]) && isset($pathParts[4]) && $pathParts[4] === 'players' && isset($pathParts[5]) && is_numeric($pathParts[5])) {
            $leagueId = (int)$pathParts[1];
            $teamId = (int)$pathParts[3];
            $playerId = (int)$pathParts[5];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/teams\/(\d+)\/players\/(\d+)/', $path, $matches)) {
                $leagueId = (int)$matches[1];
                $teamId = (int)$matches[2];
                $playerId = (int)$matches[3];
            }
        }
        
        if (!$leagueId || !$teamId || !$playerId) {
            throw new Exception('ID lega, ID squadra e ID giocatore obbligatori');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono eliminare i giocatori');
        }
        
        // Verifica che la squadra appartenga alla lega
        $stmt = $conn->prepare("SELECT id FROM teams WHERE id = ? AND league_id = ?");
        $stmt->bind_param("ii", $teamId, $leagueId);
        $stmt->execute();
        $team = $stmt->get_result()->fetch_assoc();
        
        if (!$team) {
            throw new Exception('Squadra non trovata');
        }
        
        // Verifica che il giocatore appartenga alla squadra
        $stmt = $conn->prepare("SELECT id FROM players WHERE id = ? AND team_id = ?");
        $stmt->bind_param("ii", $playerId, $teamId);
        $stmt->execute();
        $player = $stmt->get_result()->fetch_assoc();
        
        if (!$player) {
            throw new Exception('Giocatore non trovato');
        }
        
        // Elimina il giocatore
        $stmt = $conn->prepare("DELETE FROM players WHERE id = ? AND team_id = ?");
        $stmt->bind_param("ii", $playerId, $teamId);
        
        if (!$stmt->execute()) {
            throw new Exception('Errore durante l\'eliminazione del giocatore');
        }
        $stmt->close();
        
        $response = ['message' => 'Giocatore eliminato con successo'];
        $statusCode = 200;
    }
    // DELETE /leagues/:id/teams/:teamId/logo - Rimuovi logo squadra ufficiale (admin only)
    elseif ($method === 'DELETE' && ((strpos($path, '/leagues/') !== false && strpos($path, '/teams/') !== false && strpos($path, '/logo') !== false && strpos($path, '/players') === false) || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3]) && isset($pathParts[4]) && $pathParts[4] === 'logo'))) {
        ensureTeamsLogoColumn();
        $token = getAuthToken();
        if (!$token) throw new Exception('Token di autenticazione mancante');
        $decoded = verifyJWT($token);
        if (!$decoded) throw new Exception('Token non valido o scaduto');

        $leagueId = null;
        $teamId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3])) {
            $leagueId = (int)$pathParts[1];
            $teamId = (int)$pathParts[3];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/teams\/(\d+)\/logo/', $path, $matches)) {
                $leagueId = (int)$matches[1];
                $teamId = (int)$matches[2];
            }
        }
        if (!$leagueId || !$teamId) throw new Exception('ID lega e ID squadra obbligatori');

        $userId = (int)$decoded['userId'];
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if (!$member || $member['role'] !== 'admin') throw new Exception('Solo gli amministratori possono rimuovere logo squadra');

        $effectiveLeagueId = getEffectiveLeagueId($leagueId);
        $stmt = $conn->prepare("SELECT logo_path FROM teams WHERE id = ? AND league_id = ? LIMIT 1");
        $stmt->bind_param("ii", $teamId, $effectiveLeagueId);
        $stmt->execute();
        $teamRow = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if (!$teamRow) throw new Exception('Squadra non trovata');

        $oldLogo = $teamRow['logo_path'] ?? null;
        $stmt = $conn->prepare("UPDATE teams SET logo_path = NULL WHERE id = ?");
        $stmt->bind_param("i", $teamId);
        $stmt->execute();
        $stmt->close();

        if ($oldLogo && file_exists(__DIR__ . '/' . $oldLogo)) {
            @unlink(__DIR__ . '/' . $oldLogo);
        }

        $response = ['message' => 'Logo squadra rimosso con successo'];
        $statusCode = 200;
    }
    // DELETE /leagues/:id/teams/:teamId - Elimina squadra (admin only)
    elseif ($method === 'DELETE' && (strpos($path, '/leagues/') !== false && strpos($path, '/teams/') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3])))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Blocca per leghe collegate
        $checkLeagueIdForLink = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if ($checkLeagueIdForLink && isLinkedLeague($checkLeagueIdForLink)) {
            throw new Exception('Non puoi eliminare squadre in una lega collegata a una lega ufficiale.');
        }
        
        $leagueId = null;
        $teamId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'teams' && isset($pathParts[3]) && is_numeric($pathParts[3])) {
            $leagueId = (int)$pathParts[1];
            $teamId = (int)$pathParts[3];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/teams\/(\d+)/', $path, $matches)) {
                $leagueId = (int)$matches[1];
                $teamId = (int)$matches[2];
            }
        }
        
        if (!$leagueId || !$teamId) {
            throw new Exception('ID lega e ID squadra obbligatori');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono eliminare squadre');
        }
        
        // Verifica che la squadra appartenga alla lega
        $stmt = $conn->prepare("SELECT id FROM teams WHERE id = ? AND league_id = ?");
        $stmt->bind_param("ii", $teamId, $leagueId);
        $stmt->execute();
        $team = $stmt->get_result()->fetch_assoc();
        
        if (!$team) {
            throw new Exception('Squadra non trovata');
        }
        
        // Elimina squadra (i giocatori verranno eliminati in cascata se c'è ON DELETE CASCADE)
        $stmt = $conn->prepare("DELETE FROM teams WHERE id = ? AND league_id = ?");
        $stmt->bind_param("ii", $teamId, $leagueId);
        
        if (!$stmt->execute()) {
            throw new Exception('Errore durante l\'eliminazione della squadra');
        }
        
        $response = ['message' => 'Squadra eliminata con successo'];
        $statusCode = 200;
    }
    // GET /leagues/:id/matchdays - Ottieni lista giornate della lega (admin only)
    // NOTA: Deve escludere /votes/matchdays per non intercettare l'endpoint dei voti
    elseif ($method === 'GET' && (strpos($path, '/leagues/') !== false && strpos($path, '/matchdays') !== false && strpos($path, '/votes/matchdays') === false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'matchdays' && (!isset($pathParts[3]) || $pathParts[3] !== 'votes')))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/matchdays/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono accedere al calendario');
        }
        
        // Se la lega è collegata, leggi le giornate dalla lega sorgente
        $effectiveLeagueId2 = getEffectiveLeagueId($leagueId);
        
        // Recupera le giornate ordinate per deadline
        $stmt = $conn->prepare("SELECT id, giornata, deadline FROM matchdays WHERE league_id = ? ORDER BY deadline ASC");
        $stmt->bind_param("i", $effectiveLeagueId2);
        $stmt->execute();
        $result = $stmt->get_result();
        
        $matchdays = [];
        while ($row = $result->fetch_assoc()) {
            $deadline = new DateTime($row['deadline']);
            $matchdays[] = [
                'id' => (int)$row['id'],
                'giornata' => (int)$row['giornata'],
                'deadline' => $row['deadline'],
                'deadline_date' => $deadline->format('Y-m-d'),
                'deadline_time' => $deadline->format('H:i')
            ];
        }
        $stmt->close();
        
        $response = $matchdays;
        $statusCode = 200;
    }
    // POST /leagues/:id/matchdays - Aggiungi o modifica giornata (admin only)
    elseif ($method === 'POST' && (strpos($path, '/leagues/') !== false && strpos($path, '/matchdays') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'matchdays'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Blocca per leghe collegate
        $checkLeagueIdForLink = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if ($checkLeagueIdForLink && isLinkedLeague($checkLeagueIdForLink)) {
            throw new Exception('Non puoi modificare le giornate in una lega collegata a una lega ufficiale. Le giornate vengono gestite dalla lega ufficiale.');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/matchdays/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono gestire il calendario');
        }
        
        $input = json_decode(file_get_contents('php://input'), true);
        $deadlineDate = isset($input['deadline_date']) ? trim($input['deadline_date']) : '';
        $deadlineTime = isset($input['deadline_time']) ? trim($input['deadline_time']) : '';
        $matchdayId = isset($input['matchday_id']) ? (int)$input['matchday_id'] : null;
        
        if (empty($deadlineDate) || empty($deadlineTime)) {
            throw new Exception('Data e orario obbligatori');
        }
        
        $deadline = $deadlineDate . ' ' . $deadlineTime . ':00';
        
        if ($matchdayId) {
            // Modifica giornata esistente
            $stmt = $conn->prepare("UPDATE matchdays SET deadline = ? WHERE id = ? AND league_id = ?");
            $stmt->bind_param("sii", $deadline, $matchdayId, $leagueId);
        } else {
            // Nuova giornata - trova il numero più alto e aggiungi 1
            $stmt = $conn->prepare("SELECT MAX(giornata) as max_giornata FROM matchdays WHERE league_id = ?");
            $stmt->bind_param("i", $leagueId);
            $stmt->execute();
            $result = $stmt->get_result();
            $row = $result->fetch_assoc();
            $giornata = ($row['max_giornata'] ?? 0) + 1;
            $stmt->close();
            
            $stmt = $conn->prepare("INSERT INTO matchdays (league_id, giornata, deadline) VALUES (?, ?, ?)");
            $stmt->bind_param("iis", $leagueId, $giornata, $deadline);
        }
        
        if (!$stmt->execute()) {
            throw new Exception('Errore durante il salvataggio della giornata');
        }
        
        // Riorganizza i numeri delle giornate per mantenere l'ordine cronologico
        $stmt = $conn->prepare("SET @temp_count = 1000");
        $stmt->execute();
        $stmt = $conn->prepare("UPDATE matchdays SET giornata = @temp_count:= @temp_count + 1 WHERE league_id = ? ORDER BY deadline ASC");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        
        $stmt = $conn->prepare("SET @final_count = 0");
        $stmt->execute();
        $stmt = $conn->prepare("UPDATE matchdays SET giornata = @final_count:= @final_count + 1 WHERE league_id = ? ORDER BY deadline ASC");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        
        $response = ['message' => 'Giornata salvata con successo'];
        $statusCode = 200;
    }
    // DELETE /leagues/:id/matchdays/:matchdayId - Elimina giornata (admin only)
    elseif ($method === 'DELETE' && (strpos($path, '/leagues/') !== false && strpos($path, '/matchdays/') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'matchdays' && isset($pathParts[3]) && is_numeric($pathParts[3])))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Blocca per leghe collegate
        $checkLeagueIdForLink = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if ($checkLeagueIdForLink && isLinkedLeague($checkLeagueIdForLink)) {
            throw new Exception('Non puoi eliminare giornate in una lega collegata a una lega ufficiale. Le giornate vengono gestite dalla lega ufficiale.');
        }
        
        $leagueId = null;
        $matchdayId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'matchdays' && isset($pathParts[3]) && is_numeric($pathParts[3])) {
            $leagueId = (int)$pathParts[1];
            $matchdayId = (int)$pathParts[3];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/matchdays\/(\d+)/', $path, $matches)) {
                $leagueId = (int)$matches[1];
                $matchdayId = (int)$matches[2];
            }
        }
        
        if (!$leagueId || !$matchdayId) {
            throw new Exception('ID lega e ID giornata obbligatori');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono eliminare giornate');
        }
        
        // Elimina giornata
        $stmt = $conn->prepare("DELETE FROM matchdays WHERE id = ? AND league_id = ?");
        $stmt->bind_param("ii", $matchdayId, $leagueId);
        
        if (!$stmt->execute()) {
            throw new Exception('Errore durante l\'eliminazione della giornata');
        }
        
        // Riorganizza i numeri delle giornate
        $stmt = $conn->prepare("SET @temp_count = 1000");
        $stmt->execute();
        $stmt = $conn->prepare("UPDATE matchdays SET giornata = @temp_count:= @temp_count + 1 WHERE league_id = ? ORDER BY deadline ASC");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        
        $stmt = $conn->prepare("SET @final_count = 0");
        $stmt->execute();
        $stmt = $conn->prepare("UPDATE matchdays SET giornata = @final_count:= @final_count + 1 WHERE league_id = ? ORDER BY deadline ASC");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        
        $response = ['message' => 'Giornata eliminata con successo'];
        $statusCode = 200;
    }
    // GET /leagues/:id/csv/template/teams - Download template CSV squadre
    elseif ($method === 'GET' && (strpos($path, '/csv/template/teams') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'csv' && isset($pathParts[3]) && $pathParts[3] === 'template' && isset($pathParts[4]) && $pathParts[4] === 'teams'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/csv\/template\/teams/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono scaricare i template');
        }
        
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="template_squadre.csv"');
        
        $output = fopen('php://output', 'w');
        $delimiter = ';';
        fputcsv($output, ['Squadra'], $delimiter);
        fclose($output);
        exit();
    }
    // GET /leagues/:id/csv/template/players - Download template CSV giocatori
    elseif ($method === 'GET' && (strpos($path, '/csv/template/players') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'csv' && isset($pathParts[3]) && $pathParts[3] === 'template' && isset($pathParts[4]) && $pathParts[4] === 'players'))) {
        ensurePlayersShirtNumberColumn();
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/csv\/template\/players/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono scaricare i template');
        }
        
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="template_giocatori.csv"');
        
        $output = fopen('php://output', 'w');
        $delimiter = ';';
        fputcsv($output, ['Nome', 'Cognome', 'Squadra', 'Ruolo', 'Valutazione', 'Numero'], $delimiter);
        fclose($output);
        exit();
    }
    // GET /leagues/:id/csv/export/teams - Export squadre della lega
    elseif ($method === 'GET' && (strpos($path, '/csv/export/teams') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'csv' && isset($pathParts[3]) && $pathParts[3] === 'export' && isset($pathParts[4]) && $pathParts[4] === 'teams'))) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/csv\/export\/teams/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono esportare i dati');
        }
        
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="squadre_lega_' . $leagueId . '.csv"');
        
        $output = fopen('php://output', 'w');
        $delimiter = ';';
        fputcsv($output, ['Squadra'], $delimiter);
        
        $stmt = $conn->prepare("SELECT name FROM teams WHERE league_id = ? ORDER BY name");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            fputcsv($output, [$row['name']], $delimiter);
        }
        $stmt->close();
        
        fclose($output);
        exit();
    }
    // GET /leagues/:id/csv/export/players - Export giocatori della lega
    elseif ($method === 'GET' && (strpos($path, '/csv/export/players') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'csv' && isset($pathParts[3]) && $pathParts[3] === 'export' && isset($pathParts[4]) && $pathParts[4] === 'players'))) {
        ensurePlayersShirtNumberColumn();
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/csv\/export\/players/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono esportare i dati');
        }
        
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="giocatori_lega_' . $leagueId . '.csv"');
        
        $output = fopen('php://output', 'w');
        $delimiter = ';';
        fputcsv($output, ['Nome', 'Cognome', 'Squadra', 'Ruolo', 'Valutazione', 'Numero'], $delimiter);
        
        $stmt = $conn->prepare("SELECT p.first_name, p.last_name, t.name AS team_name, p.role, p.rating, p.shirt_number
                                FROM players p
                                JOIN teams t ON p.team_id = t.id
                                WHERE t.league_id = ?
                                ORDER BY t.name, p.last_name, p.first_name");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            fputcsv($output, [
                $row['first_name'],
                $row['last_name'],
                $row['team_name'],
                $row['role'],
                number_format((float)$row['rating'], 1, '.', ''),
                ($row['shirt_number'] === null ? '' : (string)$row['shirt_number'])
            ], $delimiter);
        }
        $stmt->close();
        
        fclose($output);
        exit();
    }
    // POST /leagues/:id/csv/import - Import CSV (squadre o giocatori)
    elseif ($method === 'POST' && (strpos($path, '/csv/import') !== false || (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1]) && isset($pathParts[2]) && $pathParts[2] === 'csv' && isset($pathParts[3]) && $pathParts[3] === 'import'))) {
        ensurePlayersShirtNumberColumn();
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        // Blocca per leghe collegate
        $checkLeagueIdForLink = isset($pathParts[1]) ? (int)$pathParts[1] : null;
        if ($checkLeagueIdForLink && isLinkedLeague($checkLeagueIdForLink)) {
            throw new Exception('Non puoi importare dati in una lega collegata a una lega ufficiale.');
        }
        
        $leagueId = null;
        if (isset($pathParts[0]) && $pathParts[0] === 'leagues' && isset($pathParts[1]) && is_numeric($pathParts[1])) {
            $leagueId = (int)$pathParts[1];
        } else {
            if (preg_match('/\/leagues\/(\d+)\/csv\/import/', $path, $matches)) {
                $leagueId = (int)$matches[1];
            }
        }
        
        if (!$leagueId) {
            throw new Exception('ID lega obbligatorio');
        }
        
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        
        // Verifica che l'utente sia admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono importare CSV');
        }
        
        // Gestisci upload file (multipart/form-data)
        if (!isset($_FILES['csv_file']) || $_FILES['csv_file']['error'] !== UPLOAD_ERR_OK) {
            throw new Exception('File CSV non valido o mancante');
        }
        
        $file = $_FILES['csv_file']['tmp_name'];
        $rows = [];
        $header = [];
        $type = '';
        
        // Auto-detect delimitatore: prova prima ';' poi ','
        $delimiter = ';';
        $handle = fopen($file, 'r');
        if (!$handle) {
            throw new Exception('Impossibile leggere il file CSV');
        }
        $firstLine = fgets($handle);
        fclose($handle);
        if ($firstLine !== false) {
            $semicolonCount = substr_count($firstLine, ';');
            $commaCount = substr_count($firstLine, ',');
            if ($commaCount > $semicolonCount) {
                $delimiter = ',';
            }
        }
        
        $handle = fopen($file, 'r');
        if (!$handle) {
            throw new Exception('Impossibile leggere il file CSV');
        }
        
        while (($data = fgetcsv($handle, 1000, $delimiter)) !== false) {
            if (empty($header)) {
                $header = $data;
                continue;
            }
            // PHP < 7.4: niente fn() — compatibile Altervista / hosting con PHP 7.3
            if (count(array_filter($data, function ($v) { return trim($v) !== ''; })) === 0) continue; // skip empty
            $rows[] = $data;
        }
        fclose($handle);
        
        // Riconoscimento tipo file
        if (count($header) === 1 && stripos($header[0], 'Squadra') !== false) {
            $type = 'teams';
        } elseif (count($header) >= 5 && stripos($header[2], 'Squadra') !== false && stripos($header[3], 'Ruolo') !== false) {
            $type = 'players';
        } else {
            throw new Exception('Formato CSV non riconosciuto. Header trovato: ' . implode($delimiter, $header) . '. Usa i template scaricabili.');
        }
        
        $imported = 0;
        $skipped = 0;
        $errors = [];
        
        if ($type === 'teams') {
            foreach ($rows as $row) {
                $teamName = trim($row[0] ?? '');
                if ($teamName === '') {
                    $skipped++;
                    continue;
                }
                // Check if team exists
                $stmt = $conn->prepare("SELECT id FROM teams WHERE league_id = ? AND name = ?");
                $stmt->bind_param("is", $leagueId, $teamName);
                $stmt->execute();
                $res = $stmt->get_result();
                if ($res->fetch_assoc()) {
                    $skipped++;
                    $errors[] = "Squadra già esistente: $teamName";
                    continue;
                }
                $stmt = $conn->prepare("INSERT INTO teams (name, league_id) VALUES (?, ?)");
                $stmt->bind_param("si", $teamName, $leagueId);
                if ($stmt->execute()) {
                    $imported++;
                } else {
                    $skipped++;
                    $errors[] = "Errore su $teamName";
                }
            }
        } elseif ($type === 'players') {
            foreach ($rows as $row) {
                $first = trim($row[0] ?? '');
                $last = trim($row[1] ?? '');
                $teamName = trim($row[2] ?? '');
                $role = strtoupper(trim($row[3] ?? ''));
                $rating = str_replace(',', '.', trim($row[4] ?? ''));
                $shirtNumberRaw = trim($row[5] ?? '');
                $shirtNumber = ($shirtNumberRaw === '' ? null : (int)$shirtNumberRaw);
                
                if ($first === '' || $last === '' || $teamName === '' || !in_array($role, ['P','D','C','A']) || !is_numeric($rating)) {
                    $skipped++;
                    $errors[] = "Riga non valida: " . implode(';', $row);
                    continue;
                }
                
                // Trova o crea squadra
                $stmt = $conn->prepare("SELECT id FROM teams WHERE league_id = ? AND name = ?");
                $stmt->bind_param("is", $leagueId, $teamName);
                $stmt->execute();
                $res = $stmt->get_result();
                $team = $res->fetch_assoc();
                if (!$team) {
                    $stmt = $conn->prepare("INSERT INTO teams (name, league_id) VALUES (?, ?)");
                    $stmt->bind_param("si", $teamName, $leagueId);
                    $stmt->execute();
                    $teamId = $conn->insert_id;
                } else {
                    $teamId = $team['id'];
                }
                
                // Check doppione
                $stmt = $conn->prepare("SELECT id FROM players WHERE team_id = ? AND first_name = ? AND last_name = ? AND role = ?");
                $stmt->bind_param("isss", $teamId, $first, $last, $role);
                $stmt->execute();
                $res = $stmt->get_result();
                if ($res->fetch_assoc()) {
                    $skipped++;
                    $errors[] = "Giocatore già esistente: $first $last ($teamName)";
                    continue;
                }
                
                $stmt = $conn->prepare("INSERT INTO players (first_name, last_name, team_id, role, rating, shirt_number) VALUES (?, ?, ?, ?, ?, ?)");
                $stmt->bind_param("ssisdi", $first, $last, $teamId, $role, $rating, $shirtNumber);
                if ($stmt->execute()) {
                    $imported++;
                } else {
                    $skipped++;
                    $errors[] = "Errore su $first $last ($teamName)";
                }
            }
        }
        
        $response = [
            'message' => "Import completato: $imported importati, $skipped saltati",
            'imported' => $imported,
            'skipped' => $skipped,
            'errors' => array_slice($errors, 0, 10) // Limita a 10 errori
        ];
        $statusCode = 200;
    }
    
    // ========== SUPERUSER ENDPOINTS ==========
    // Helper function per verificare se l'utente è superuser
    $checkSuperuser = function($userId) use ($conn) {
        $stmt = $conn->prepare("SELECT is_superuser FROM users WHERE id = ?");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $result = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        return $result && $result['is_superuser'];
    };
    
    // Helper function per verificare se un utente è online (attività < 5 minuti)
    $isUserOnline = function($lastActivity) {
        if (!$lastActivity) return false;
        $lastActivityTime = strtotime($lastActivity);
        $now = time();
        return ($now - $lastActivityTime) < 300; // 5 minuti
    };
    
    // GET /superuser/users - Lista utenti con stato online/offline e ultimo accesso
    if ($method === 'GET' && strpos($path, '/superuser/users') !== false && isset($pathParts[0]) && $pathParts[0] === 'superuser' && isset($pathParts[1]) && $pathParts[1] === 'users' && !isset($pathParts[2])) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        if (!$checkSuperuser($userId)) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        $conn = getDbConnection();
        $stmt = $conn->prepare("
            SELECT id, username, email, last_login, last_activity, is_superuser, created_at
            FROM users 
            ORDER BY created_at DESC
        ");
        $stmt->execute();
        $result = $stmt->get_result();
        
        $users = [];
        while ($row = $result->fetch_assoc()) {
            $users[] = [
                'id' => (int)$row['id'],
                'username' => $row['username'],
                'email' => $row['email'],
                'last_login' => $row['last_login'],
                'last_activity' => $row['last_activity'],
                'is_superuser' => (bool)($row['is_superuser'] ?? 0),
                'is_online' => $isUserOnline($row['last_activity']),
                'created_at' => $row['created_at']
            ];
        }
        $stmt->close();
        
        $response = $users;
        $statusCode = 200;
    }
    // POST /superuser/users/:id/toggle-superuser - Rendi un utente superuser o rimuovilo
    else if ($method === 'POST' && strpos($path, '/superuser/users/') !== false && strpos($path, '/toggle-superuser') !== false) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        if (!$checkSuperuser($userId)) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        // Estrai user ID dal path
        if (preg_match('/\/superuser\/users\/(\d+)\/toggle-superuser/', $path, $matches)) {
            $targetUserId = (int)$matches[1];
        } else {
            throw new Exception('ID utente non valido');
        }
        
        $conn = getDbConnection();
        
        // Ottieni stato attuale
        $stmt = $conn->prepare("SELECT is_superuser FROM users WHERE id = ?");
        $stmt->bind_param("i", $targetUserId);
        $stmt->execute();
        $result = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$result) {
            throw new Exception('Utente non trovato');
        }
        
        $newStatus = $result['is_superuser'] ? 0 : 1;
        
        // Aggiorna stato
        $stmt = $conn->prepare("UPDATE users SET is_superuser = ? WHERE id = ?");
        $stmt->bind_param("ii", $newStatus, $targetUserId);
        $stmt->execute();
        $stmt->close();
        
        // Log azione
        if (function_exists('logSuperuserAction')) {
            logSuperuserAction($userId, 'toggle_superuser', $targetUserId, "Superuser status changed to: $newStatus");
        }
        
        $response = [
            'message' => $newStatus ? 'Utente reso superuser' : 'Superuser rimosso',
            'is_superuser' => (bool)$newStatus
        ];
        $statusCode = 200;
    }
    // GET /superuser/leagues - Lista tutte le leghe
    else if ($method === 'GET' && strpos($path, '/superuser/leagues') !== false && isset($pathParts[0]) && $pathParts[0] === 'superuser' && isset($pathParts[1]) && $pathParts[1] === 'leagues' && !isset($pathParts[2])) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        if (!$checkSuperuser($userId)) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        $conn = getDbConnection();
        $stmt = $conn->prepare("
            SELECT l.id, l.name, l.access_code, l.created_at, l.is_official, l.official_group_id,
                   l.is_visible_for_linking,
                   og.name as official_group_name,
                   COUNT(DISTINCT lm.user_id) as member_count
            FROM leagues l
            LEFT JOIN league_members lm ON l.id = lm.league_id
            LEFT JOIN official_league_groups og ON l.official_group_id = og.id
            GROUP BY l.id
            ORDER BY l.created_at DESC
        ");
        $stmt->execute();
        $result = $stmt->get_result();
        
        $leagues = [];
        while ($row = $result->fetch_assoc()) {
            $leagues[] = [
                'id' => (int)$row['id'],
                'name' => $row['name'],
                'access_code' => $row['access_code'],
                'member_count' => (int)$row['member_count'],
                'created_at' => $row['created_at'],
                'is_official' => (bool)($row['is_official'] ?? 0),
                'official_group_id' => $row['official_group_id'] ? (int)$row['official_group_id'] : null,
                'official_group_name' => $row['official_group_name'],
                'is_visible_for_linking' => (bool)($row['is_visible_for_linking'] ?? 0)
            ];
        }
        $stmt->close();
        
        $response = $leagues;
        $statusCode = 200;
    }
    // DELETE /superuser/leagues/:id - Elimina una lega
    else if ($method === 'DELETE' && strpos($path, '/superuser/leagues/') !== false) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        if (!$checkSuperuser($userId)) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        // Estrai league ID dal path
        if (preg_match('/\/superuser\/leagues\/(\d+)/', $path, $matches)) {
            $leagueId = (int)$matches[1];
        } else {
            throw new Exception('ID lega non valido');
        }
        
        $conn = getDbConnection();
        
        // Verifica che la lega esista
        $stmt = $conn->prepare("SELECT name FROM leagues WHERE id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $result = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$result) {
            throw new Exception('Lega non trovata');
        }
        
        // Elimina la lega (le foreign key dovrebbero gestire le dipendenze)
        $stmt = $conn->prepare("DELETE FROM leagues WHERE id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $stmt->close();
        
        // Log azione
        if (function_exists('logSuperuserAction')) {
            logSuperuserAction($userId, 'delete_league', null, "League deleted: ID $leagueId, Name: " . $result['name']);
        }
        
        $response = ['message' => 'Lega eliminata con successo'];
        $statusCode = 200;
    }
    // POST /superuser/leagues/:id/join-as-admin - Entra in una lega come admin
    else if ($method === 'POST' && strpos($path, '/superuser/leagues/') !== false && strpos($path, '/join-as-admin') !== false) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        if (!$checkSuperuser($userId)) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        // Estrai league ID dal path
        if (preg_match('/\/superuser\/leagues\/(\d+)\/join-as-admin/', $path, $matches)) {
            $leagueId = (int)$matches[1];
        } else {
            throw new Exception('ID lega non valido');
        }
        
        $conn = getDbConnection();
        
        // Verifica che la lega esista
        $stmt = $conn->prepare("SELECT name FROM leagues WHERE id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $result = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$result) {
            throw new Exception('Lega non trovata');
        }
        
        // Verifica se l'utente è già membro
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if ($member) {
            // Se è già membro, aggiorna il ruolo ad admin
            $stmt = $conn->prepare("UPDATE league_members SET role = 'admin' WHERE league_id = ? AND user_id = ?");
            $stmt->bind_param("ii", $leagueId, $userId);
            $stmt->execute();
            $stmt->close();
        } else {
            // Se non è membro, aggiungilo come admin
            $stmt = $conn->prepare("INSERT INTO league_members (league_id, user_id, role) VALUES (?, ?, 'admin')");
            $stmt->bind_param("ii", $leagueId, $userId);
            $stmt->execute();
            $stmt->close();
            
            // Crea user_budget se non esiste
            $stmt = $conn->prepare("INSERT IGNORE INTO user_budget (user_id, league_id, budget) VALUES (?, ?, 100)");
            $stmt->bind_param("ii", $userId, $leagueId);
            $stmt->execute();
            $stmt->close();
        }
        
        // Log azione
        if (function_exists('logSuperuserAction')) {
            logSuperuserAction($userId, 'join_league_as_admin', null, "Joined league as admin: ID $leagueId, Name: " . $result['name']);
        }
        
        $response = ['message' => 'Aggiunto come admin alla lega con successo', 'leagueId' => $leagueId];
        $statusCode = 200;
    }
    // GET /superuser/official-groups - Lista tutti i gruppi ufficiali
    else if ($method === 'GET' && strpos($path, '/superuser/official-groups') !== false && isset($pathParts[0]) && $pathParts[0] === 'superuser' && isset($pathParts[1]) && $pathParts[1] === 'official-groups' && !isset($pathParts[2])) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        if (!$checkSuperuser($userId)) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        $conn = getDbConnection();
        $stmt = $conn->prepare("
            SELECT og.id, og.name, og.description, og.created_at, og.created_by,
                   u.username as created_by_username,
                   COUNT(l.id) as league_count
            FROM official_league_groups og
            LEFT JOIN leagues l ON l.official_group_id = og.id
            LEFT JOIN users u ON og.created_by = u.id
            GROUP BY og.id
            ORDER BY og.created_at DESC
        ");
        $stmt->execute();
        $result = $stmt->get_result();
        
        $groups = [];
        while ($row = $result->fetch_assoc()) {
            $groups[] = [
                'id' => (int)$row['id'],
                'name' => $row['name'],
                'description' => $row['description'],
                'created_at' => $row['created_at'],
                'created_by' => (int)$row['created_by'],
                'created_by_username' => $row['created_by_username'],
                'league_count' => (int)$row['league_count']
            ];
        }
        $stmt->close();
        
        $response = $groups;
        $statusCode = 200;
    }
    // POST /superuser/official-groups - Crea un nuovo gruppo ufficiale
    else if ($method === 'POST' && strpos($path, '/superuser/official-groups') !== false && isset($pathParts[0]) && $pathParts[0] === 'superuser' && isset($pathParts[1]) && $pathParts[1] === 'official-groups' && !isset($pathParts[2])) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        if (!$checkSuperuser($userId)) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($data['name']) || empty(trim($data['name']))) {
            throw new Exception('Il nome del gruppo è obbligatorio');
        }
        
        $conn = getDbConnection();
        $name = trim($data['name']);
        $description = isset($data['description']) ? trim($data['description']) : null;
        
        // Verifica se esiste già un gruppo con lo stesso nome
        $stmt = $conn->prepare("SELECT id FROM official_league_groups WHERE name = ?");
        $stmt->bind_param("s", $name);
        $stmt->execute();
        $existing = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if ($existing) {
            throw new Exception('Esiste già un gruppo con questo nome');
        }
        
        $stmt = $conn->prepare("INSERT INTO official_league_groups (name, description, created_by) VALUES (?, ?, ?)");
        $stmt->bind_param("ssi", $name, $description, $userId);
        $stmt->execute();
        $groupId = $conn->insert_id;
        $stmt->close();
        
        $response = [
            'message' => 'Gruppo ufficiale creato con successo',
            'id' => $groupId,
            'name' => $name,
            'description' => $description
        ];
        $statusCode = 201;
    }
    // PUT /superuser/official-groups/:id - Modifica un gruppo ufficiale
    else if ($method === 'PUT' && strpos($path, '/superuser/official-groups/') !== false) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        if (!$checkSuperuser($userId)) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        if (preg_match('/\/superuser\/official-groups\/(\d+)/', $path, $matches)) {
            $groupId = (int)$matches[1];
        } else {
            throw new Exception('ID gruppo non valido');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($data['name']) || empty(trim($data['name']))) {
            throw new Exception('Il nome del gruppo è obbligatorio');
        }
        
        $conn = getDbConnection();
        $name = trim($data['name']);
        $description = isset($data['description']) ? trim($data['description']) : null;
        
        // Verifica che il gruppo esista
        $stmt = $conn->prepare("SELECT id FROM official_league_groups WHERE id = ?");
        $stmt->bind_param("i", $groupId);
        $stmt->execute();
        $group = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$group) {
            throw new Exception('Gruppo non trovato');
        }
        
        // Verifica se esiste già un altro gruppo con lo stesso nome
        $stmt = $conn->prepare("SELECT id FROM official_league_groups WHERE name = ? AND id != ?");
        $stmt->bind_param("si", $name, $groupId);
        $stmt->execute();
        $existing = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if ($existing) {
            throw new Exception('Esiste già un gruppo con questo nome');
        }
        
        $stmt = $conn->prepare("UPDATE official_league_groups SET name = ?, description = ? WHERE id = ?");
        $stmt->bind_param("ssi", $name, $description, $groupId);
        $stmt->execute();
        $stmt->close();
        
        $response = ['message' => 'Gruppo ufficiale modificato con successo'];
        $statusCode = 200;
    }
    // DELETE /superuser/official-groups/:id - Elimina un gruppo ufficiale
    else if ($method === 'DELETE' && strpos($path, '/superuser/official-groups/') !== false) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        if (!$checkSuperuser($userId)) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        if (preg_match('/\/superuser\/official-groups\/(\d+)/', $path, $matches)) {
            $groupId = (int)$matches[1];
        } else {
            throw new Exception('ID gruppo non valido');
        }
        
        $conn = getDbConnection();
        
        // Verifica che il gruppo esista
        $stmt = $conn->prepare("SELECT name FROM official_league_groups WHERE id = ?");
        $stmt->bind_param("i", $groupId);
        $stmt->execute();
        $group = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$group) {
            throw new Exception('Gruppo non trovato');
        }
        
        // Rimuovi le leghe dal gruppo (imposta is_official = 0 e official_group_id = NULL)
        $stmt = $conn->prepare("UPDATE leagues SET is_official = 0, official_group_id = NULL WHERE official_group_id = ?");
        $stmt->bind_param("i", $groupId);
        $stmt->execute();
        $stmt->close();
        
        // Elimina il gruppo
        $stmt = $conn->prepare("DELETE FROM official_league_groups WHERE id = ?");
        $stmt->bind_param("i", $groupId);
        $stmt->execute();
        $stmt->close();
        
        $response = ['message' => 'Gruppo ufficiale eliminato con successo. Le leghe sono state rimosse dal gruppo.'];
        $statusCode = 200;
    }
    // PUT /superuser/leagues/:id/official - Imposta/modifica stato ufficiale di una lega
    else if ($method === 'PUT' && strpos($path, '/superuser/leagues/') !== false && strpos($path, '/official') !== false) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        if (!$checkSuperuser($userId)) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        if (preg_match('/\/superuser\/leagues\/(\d+)\/official/', $path, $matches)) {
            $leagueId = (int)$matches[1];
        } else {
            throw new Exception('ID lega non valido');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        
        $conn = getDbConnection();
        
        // Verifica che la lega esista
        $stmt = $conn->prepare("SELECT id FROM leagues WHERE id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $league = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$league) {
            throw new Exception('Lega non trovata');
        }
        
        if (isset($data['is_official']) && $data['is_official']) {
            // Imposta come ufficiale - richiede un gruppo
            if (!isset($data['official_group_id']) || !$data['official_group_id']) {
                throw new Exception('Devi selezionare un gruppo per rendere la lega ufficiale');
            }
            
            $officialGroupId = (int)$data['official_group_id'];
            
            // Verifica che il gruppo esista
            $stmt = $conn->prepare("SELECT id FROM official_league_groups WHERE id = ?");
            $stmt->bind_param("i", $officialGroupId);
            $stmt->execute();
            $group = $stmt->get_result()->fetch_assoc();
            $stmt->close();
            
            if (!$group) {
                throw new Exception('Gruppo non trovato');
            }
            
            $stmt = $conn->prepare("UPDATE leagues SET is_official = 1, official_group_id = ? WHERE id = ?");
            $stmt->bind_param("ii", $officialGroupId, $leagueId);
            $stmt->execute();
            $stmt->close();
            
            $response = ['message' => 'Lega impostata come ufficiale con successo'];
        } else {
            // Rimuovi dallo stato ufficiale
            $stmt = $conn->prepare("UPDATE leagues SET is_official = 0, official_group_id = NULL WHERE id = ?");
            $stmt->bind_param("i", $leagueId);
            $stmt->execute();
            $stmt->close();
            
            $response = ['message' => 'Lega rimossa dallo stato ufficiale con successo'];
        }
        
        $statusCode = 200;
    }
    // PUT /superuser/leagues/:id/visible-for-linking - Toggle visibilità per collegamento
    else if ($method === 'PUT' && strpos($path, '/superuser/leagues/') !== false && strpos($path, '/visible-for-linking') !== false) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        if (!$checkSuperuser($userId)) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        if (preg_match('/\/superuser\/leagues\/(\d+)\/visible-for-linking/', $path, $matches)) {
            $leagueId = (int)$matches[1];
        } else {
            throw new Exception('ID lega non valido');
        }
        
        $conn = getDbConnection();
        
        // Verifica che la lega esista e sia ufficiale
        $stmt = $conn->prepare("SELECT id, is_official, is_visible_for_linking FROM leagues WHERE id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $league = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$league) {
            throw new Exception('Lega non trovata');
        }
        
        if (!$league['is_official']) {
            throw new Exception('Solo le leghe ufficiali possono essere rese visibili per il collegamento');
        }
        
        // Toggle
        $newValue = $league['is_visible_for_linking'] ? 0 : 1;
        $stmt = $conn->prepare("UPDATE leagues SET is_visible_for_linking = ? WHERE id = ?");
        $stmt->bind_param("ii", $newValue, $leagueId);
        $stmt->execute();
        $stmt->close();
        
        $response = [
            'message' => $newValue ? 'Lega ora visibile per il collegamento' : 'Lega non più visibile per il collegamento',
            'is_visible_for_linking' => (bool)$newValue
        ];
        $statusCode = 200;
    }
    // GET /superuser/official-groups/:id/leagues - Ottieni le leghe di un gruppo ufficiale
    else if ($method === 'GET' && strpos($path, '/superuser/official-groups/') !== false && strpos($path, '/leagues') !== false) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido o scaduto');
        }
        
        $userId = $decoded['userId'];
        if (!$checkSuperuser($userId)) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        if (preg_match('/\/superuser\/official-groups\/(\d+)\/leagues/', $path, $matches)) {
            $groupId = (int)$matches[1];
        } else {
            throw new Exception('ID gruppo non valido');
        }
        
        $conn = getDbConnection();
        
        // Verifica che il gruppo esista
        $stmt = $conn->prepare("SELECT id, name FROM official_league_groups WHERE id = ?");
        $stmt->bind_param("i", $groupId);
        $stmt->execute();
        $group = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$group) {
            throw new Exception('Gruppo non trovato');
        }
        
        // Ottieni le leghe del gruppo
        $stmt = $conn->prepare("
            SELECT l.id, l.name, l.access_code, l.created_at,
                   COUNT(DISTINCT lm.user_id) as member_count
            FROM leagues l
            LEFT JOIN league_members lm ON l.id = lm.league_id
            WHERE l.official_group_id = ?
            GROUP BY l.id
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
                'member_count' => (int)$row['member_count'],
                'created_at' => $row['created_at']
            ];
        }
        $stmt->close();
        
        $response = [
            'group' => [
                'id' => (int)$group['id'],
                'name' => $group['name']
            ],
            'leagues' => $leagues
        ];
        $statusCode = 200;
    }
    // GET /players/:playerId/stats/:leagueId - Statistiche giocatore in una lega
    else if ($method === 'GET' && preg_match('#^/players/(\d+)/stats/(\d+)$#', $path, $matches)) {
        $playerId = (int)$matches[1];
        $leagueId = (int)$matches[2];
        
        $conn = getDbConnection();
        
        // Verifica che il giocatore esista
        $stmt = $conn->prepare("
            SELECT p.id, p.first_name, p.last_name, p.role, p.rating
            FROM players p
            WHERE p.id = ?
        ");
        $stmt->bind_param("i", $playerId);
        $stmt->execute();
        $player = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$player) {
            throw new Exception('Giocatore non trovato');
        }
        
        // Calcola statistiche dalla lega corrente
        $stmt = $conn->prepare("
            SELECT 
                COUNT(DISTINCT giornata) as games_played,
                AVG(rating) as avg_rating,
                SUM(goals) as total_goals,
                SUM(assists) as total_assists,
                SUM(yellow_cards) as total_yellow_cards,
                SUM(red_cards) as total_red_cards,
                SUM(goals_conceded) as total_goals_conceded,
                SUM(own_goals) as total_own_goals,
                SUM(penalty_missed) as total_penalty_missed,
                SUM(penalty_saved) as total_penalty_saved,
                SUM(clean_sheet) as total_clean_sheets,
                COUNT(CASE WHEN rating > 0 THEN 1 END) as games_with_rating
            FROM player_ratings
            WHERE player_id = ? AND league_id = ? AND rating > 0
        ");
        $stmt->bind_param("ii", $playerId, $leagueId);
        $stmt->execute();
        $stats = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        // Calcola media voto con bonus/malus
        $stmt = $conn->prepare("
            SELECT 
                AVG(rating + 
                    COALESCE((SELECT bonus_goal FROM league_bonus_settings WHERE league_id = ? AND enable_goal = 1), 0) * goals +
                    COALESCE((SELECT bonus_assist FROM league_bonus_settings WHERE league_id = ? AND enable_assist = 1), 0) * assists +
                    COALESCE((SELECT malus_yellow_card FROM league_bonus_settings WHERE league_id = ? AND enable_yellow_card = 1), 0) * yellow_cards +
                    COALESCE((SELECT malus_red_card FROM league_bonus_settings WHERE league_id = ? AND enable_red_card = 1), 0) * red_cards +
                    COALESCE((SELECT malus_goals_conceded FROM league_bonus_settings WHERE league_id = ? AND enable_goals_conceded = 1), 0) * goals_conceded +
                    COALESCE((SELECT malus_own_goal FROM league_bonus_settings WHERE league_id = ? AND enable_own_goal = 1), 0) * own_goals +
                    COALESCE((SELECT malus_penalty_missed FROM league_bonus_settings WHERE league_id = ? AND enable_penalty_missed = 1), 0) * penalty_missed +
                    COALESCE((SELECT bonus_penalty_saved FROM league_bonus_settings WHERE league_id = ? AND enable_penalty_saved = 1), 0) * penalty_saved +
                    COALESCE((SELECT bonus_clean_sheet FROM league_bonus_settings WHERE league_id = ? AND enable_clean_sheet = 1), 0) * clean_sheet
                ) as avg_rating_with_bonus
            FROM player_ratings
            WHERE player_id = ? AND league_id = ? AND rating > 0
        ");
        $stmt->bind_param("iiiiiiiiiii", $leagueId, $leagueId, $leagueId, $leagueId, $leagueId, $leagueId, $leagueId, $leagueId, $leagueId, $playerId, $leagueId);
        $stmt->execute();
        $bonusStats = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        $response = [
            'player' => [
                'id' => (int)$player['id'],
                'first_name' => $player['first_name'],
                'last_name' => $player['last_name'],
                'role' => $player['role'],
                'rating' => (float)$player['rating']
            ],
            'stats' => [
                'games_played' => (int)$stats['games_played'],
                'games_with_rating' => (int)$stats['games_with_rating'],
                'avg_rating' => $stats['avg_rating'] ? round((float)$stats['avg_rating'], 2) : 0,
                'avg_rating_with_bonus' => $bonusStats['avg_rating_with_bonus'] ? round((float)$bonusStats['avg_rating_with_bonus'], 2) : 0,
                'total_goals' => (int)$stats['total_goals'],
                'total_assists' => (int)$stats['total_assists'],
                'total_yellow_cards' => (int)$stats['total_yellow_cards'],
                'total_red_cards' => (int)$stats['total_red_cards'],
                'total_goals_conceded' => (int)$stats['total_goals_conceded'],
                'total_own_goals' => (int)$stats['total_own_goals'],
                'total_penalty_missed' => (int)$stats['total_penalty_missed'],
                'total_penalty_saved' => (int)$stats['total_penalty_saved'],
                'total_clean_sheets' => (int)$stats['total_clean_sheets']
            ]
        ];
        $statusCode = 200;
    }
    // GET /players/:playerId/stats/aggregated/:leagueId - Statistiche aggregate del giocatore (cluster)
    else if ($method === 'GET' && preg_match('#^/players/(\d+)/stats/aggregated/(\d+)$#', $path, $matches)) {
        $playerId = (int)$matches[1];
        $leagueId = (int)$matches[2];
        
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido');
        }
        
        $conn = getDbConnection();
        
        // Verifica che la lega sia ufficiale e appartenga a un gruppo
        $stmt = $conn->prepare("
            SELECT l.official_group_id, l.is_official
            FROM leagues l
            WHERE l.id = ?
        ");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $league = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$league || !$league['is_official'] || !$league['official_group_id']) {
            throw new Exception('Lega non ufficiale o senza gruppo');
        }
        
        $groupId = $league['official_group_id'];
        
        // Trova il cluster approvato del giocatore
        $stmt = $conn->prepare("
            SELECT pc.id
            FROM player_clusters pc
            JOIN player_cluster_members pcm ON pc.id = pcm.cluster_id
            WHERE pcm.player_id = ? AND pc.official_group_id = ? AND pc.status = 'approved'
            LIMIT 1
        ");
        $stmt->bind_param("ii", $playerId, $groupId);
        $stmt->execute();
        $cluster = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$cluster) {
            throw new Exception('Nessun cluster approvato trovato per questo giocatore');
        }
        
        // Ottieni tutti i player_id del cluster
        $stmt = $conn->prepare("
            SELECT player_id
            FROM player_cluster_members
            WHERE cluster_id = ?
        ");
        $stmt->bind_param("i", $cluster['id']);
        $stmt->execute();
        $result = $stmt->get_result();
        $playerIds = [];
        while ($row = $result->fetch_assoc()) {
            $playerIds[] = (int)$row['player_id'];
        }
        $stmt->close();
        
        if (empty($playerIds)) {
            throw new Exception('Cluster vuoto');
        }
        
        // Ottieni tutte le leghe del gruppo ufficiale
        $stmt = $conn->prepare("
            SELECT id FROM leagues
            WHERE official_group_id = ? AND is_official = 1
        ");
        $stmt->bind_param("i", $groupId);
        $stmt->execute();
        $result = $stmt->get_result();
        $leagueIds = [];
        while ($row = $result->fetch_assoc()) {
            $leagueIds[] = (int)$row['id'];
        }
        $stmt->close();
        
        if (empty($leagueIds)) {
            throw new Exception('Nessuna lega trovata nel gruppo');
        }
        
        // Calcola statistiche aggregate da tutte le leghe del gruppo
        $placeholders = str_repeat('?,', count($playerIds) - 1) . '?';
        $placeholdersLeagues = str_repeat('?,', count($leagueIds) - 1) . '?';
        
        $stmt = $conn->prepare("
            SELECT 
                COUNT(DISTINCT CONCAT(giornata, '-', league_id)) as games_played,
                AVG(rating) as avg_rating,
                SUM(goals) as total_goals,
                SUM(assists) as total_assists,
                SUM(yellow_cards) as total_yellow_cards,
                SUM(red_cards) as total_red_cards,
                SUM(goals_conceded) as total_goals_conceded,
                SUM(own_goals) as total_own_goals,
                SUM(penalty_missed) as total_penalty_missed,
                SUM(penalty_saved) as total_penalty_saved,
                SUM(clean_sheet) as total_clean_sheets,
                COUNT(CASE WHEN rating > 0 THEN 1 END) as games_with_rating
            FROM player_ratings
            WHERE player_id IN ($placeholders) AND league_id IN ($placeholdersLeagues) AND rating > 0
        ");
        $params = array_merge($playerIds, $leagueIds);
        $types = str_repeat('i', count($params));
        $stmt->bind_param($types, ...$params);
        $stmt->execute();
        $stats = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        // Calcola media voto con bonus/malus (approssimativa, usando la prima lega trovata)
        $firstLeagueId = $leagueIds[0];
        $stmt = $conn->prepare("
            SELECT 
                AVG(pr.rating + 
                    COALESCE(bs.bonus_goal, 0) * pr.goals +
                    COALESCE(bs.bonus_assist, 0) * pr.assists +
                    COALESCE(bs.malus_yellow_card, 0) * pr.yellow_cards +
                    COALESCE(bs.malus_red_card, 0) * pr.red_cards +
                    COALESCE(bs.malus_goals_conceded, 0) * pr.goals_conceded +
                    COALESCE(bs.malus_own_goal, 0) * pr.own_goals +
                    COALESCE(bs.malus_penalty_missed, 0) * pr.penalty_missed +
                    COALESCE(bs.bonus_penalty_saved, 0) * pr.penalty_saved +
                    COALESCE(bs.bonus_clean_sheet, 0) * pr.clean_sheet
                ) as avg_rating_with_bonus
            FROM player_ratings pr
            LEFT JOIN league_bonus_settings bs ON pr.league_id = bs.league_id
            WHERE pr.player_id IN ($placeholders) AND pr.league_id IN ($placeholdersLeagues) AND pr.rating > 0
        ");
        $stmt->bind_param($types, ...$params);
        $stmt->execute();
        $bonusStats = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        $response = [
            'stats' => [
                'games_played' => (int)$stats['games_played'],
                'games_with_rating' => (int)$stats['games_with_rating'],
                'avg_rating' => $stats['avg_rating'] ? round((float)$stats['avg_rating'], 2) : 0,
                'avg_rating_with_bonus' => $bonusStats['avg_rating_with_bonus'] ? round((float)$bonusStats['avg_rating_with_bonus'], 2) : 0,
                'total_goals' => (int)$stats['total_goals'],
                'total_assists' => (int)$stats['total_assists'],
                'total_yellow_cards' => (int)$stats['total_yellow_cards'],
                'total_red_cards' => (int)$stats['total_red_cards'],
                'total_goals_conceded' => (int)$stats['total_goals_conceded'],
                'total_own_goals' => (int)$stats['total_own_goals'],
                'total_penalty_missed' => (int)$stats['total_penalty_missed'],
                'total_penalty_saved' => (int)$stats['total_penalty_saved'],
                'total_clean_sheets' => (int)$stats['total_clean_sheets']
            ],
            'cluster_id' => (int)$cluster['id'],
            'players_count' => count($playerIds),
            'leagues_count' => count($leagueIds)
        ];
        $statusCode = 200;
    }
    // GET /superuser/player-clusters/suggestions/:groupId - Suggerimenti automatici cluster
    else if ($method === 'GET' && preg_match('#^/superuser/player-clusters/suggestions/(\d+)$#', $path, $matches)) {
        error_log("[CLUSTER SUGGESTIONS API] ========== ENDPOINT REACHED ==========");
        error_log("[CLUSTER SUGGESTIONS API] Method: $method, Path: $path");
        error_log("[CLUSTER SUGGESTIONS API] Matches: " . json_encode($matches));
        
        $token = getAuthToken();
        if (!$token) {
            error_log("[CLUSTER SUGGESTIONS API] ERROR: Token mancante");
            throw new Exception('Token di autenticazione mancante');
        }
        error_log("[CLUSTER SUGGESTIONS API] Token found");
        
        $decoded = verifyJWT($token);
        if (!$decoded) {
            error_log("[CLUSTER SUGGESTIONS API] ERROR: Token non valido");
            throw new Exception('Token non valido');
        }
        error_log("[CLUSTER SUGGESTIONS API] Token validated, userId: " . $decoded['userId']);
        
        // Verifica superuser
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT is_superuser FROM users WHERE id = ?");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $user = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$user || !$user['is_superuser']) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        $groupId = (int)$matches[1];
        error_log("[CLUSTER SUGGESTIONS] Group ID: $groupId");
        
        // Ottieni tutte le leghe del gruppo ufficiale
        $stmt = $conn->prepare("SELECT id, name FROM leagues WHERE official_group_id = ? AND is_official = 1");
        $stmt->bind_param("i", $groupId);
        $stmt->execute();
        $result = $stmt->get_result();
        $leagueIds = [];
        $leagueNames = [];
        while ($row = $result->fetch_assoc()) {
            $leagueIds[] = (int)$row['id'];
            $leagueNames[] = $row['name'];
        }
        $stmt->close();
        
        error_log("[CLUSTER SUGGESTIONS] Found " . count($leagueIds) . " leagues: " . implode(', ', $leagueNames) . " (IDs: " . implode(', ', $leagueIds) . ")");
        
        if (count($leagueIds) < 2) {
            error_log("[CLUSTER SUGGESTIONS] Not enough leagues (need at least 2)");
            $response = ['suggestions' => []];
            $statusCode = 200;
        } else {
            // Trova giocatori con stesso nome e cognome in leghe diverse
            // NOTA: players ha team_id, non league_id, quindi dobbiamo fare JOIN con teams per ottenere league_id
            $placeholders = str_repeat('?,', count($leagueIds) - 1) . '?';
            
            // LOG: Conta quanti giocatori ci sono nelle leghe del gruppo
            $countStmt = $conn->prepare("
                SELECT COUNT(*) as total_players
                FROM players p
                JOIN teams t ON p.team_id = t.id
                WHERE t.league_id IN ($placeholders)
            ");
            $countTypes = str_repeat('i', count($leagueIds));
            $countStmt->bind_param($countTypes, ...$leagueIds);
            $countStmt->execute();
            $countResult = $countStmt->get_result();
            $countRow = $countResult->fetch_assoc();
            error_log("[CLUSTER SUGGESTIONS] Total players in group leagues: " . ($countRow['total_players'] ?? 0));
            $countStmt->close();
            
            // LOG: Verifica se ci sono giocatori con stesso nome in leghe diverse (senza filtri cluster)
            $testStmt = $conn->prepare("
                SELECT COUNT(*) as matching_players
                FROM players p1
                JOIN teams t1 ON p1.team_id = t1.id
                JOIN players p2 ON p1.first_name = p2.first_name AND p1.last_name = p2.last_name AND p1.id < p2.id
                JOIN teams t2 ON p2.team_id = t2.id
                WHERE t1.league_id IN ($placeholders) AND t2.league_id IN ($placeholders)
                AND t1.league_id != t2.league_id
            ");
            $testTypes = str_repeat('i', count($leagueIds) * 2);
            $testParams = array_merge($leagueIds, $leagueIds);
            $testStmt->bind_param($testTypes, ...$testParams);
            $testStmt->execute();
            $testResult = $testStmt->get_result();
            $testRow = $testResult->fetch_assoc();
            error_log("[CLUSTER SUGGESTIONS] Players with same name in different leagues (before cluster filter): " . ($testRow['matching_players'] ?? 0));
            $testStmt->close();
            
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
            error_log("[CLUSTER SUGGESTIONS] Executing query with params: leagueIds=" . implode(',', $leagueIds) . ", groupId=$groupId");
            $stmt->bind_param($types, ...$params);
            $stmt->execute();
            $result = $stmt->get_result();
            
            $suggestions = [];
            $rowCount = 0;
            while ($row = $result->fetch_assoc()) {
                $rowCount++;
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
                error_log("[CLUSTER SUGGESTIONS] Found match: " . $row['first_name'] . " " . $row['last_name'] . 
                         " (ID: {$row['player_id_1']} in {$row['league_name_1']} <-> ID: {$row['player_id_2']} in {$row['league_name_2']})");
            }
            $stmt->close();
            
            error_log("[CLUSTER SUGGESTIONS] Total suggestions found: $rowCount");
            
            $response = ['suggestions' => $suggestions];
            $statusCode = 200;
        }
    }
    // POST /superuser/player-clusters - Crea un nuovo cluster
    else if ($method === 'POST' && $path === '/superuser/player-clusters') {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido');
        }
        
        // Verifica superuser
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT is_superuser FROM users WHERE id = ?");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $user = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$user || !$user['is_superuser']) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($data['official_group_id']) || !isset($data['player_ids']) || !is_array($data['player_ids']) || count($data['player_ids']) < 2) {
            throw new Exception('Dati non validi: occorrono almeno 2 giocatori');
        }
        
        $groupId = (int)$data['official_group_id'];
        $playerIds = array_map('intval', $data['player_ids']);
        
        // Verifica che tutti i giocatori appartengano a leghe del gruppo ufficiale
        $placeholders = str_repeat('?,', count($playerIds) - 1) . '?';
        $stmt = $conn->prepare("
            SELECT p.id, t.league_id
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
        $stmt->close();
        
        if (count($validPlayers) !== count($playerIds)) {
            throw new Exception('Alcuni giocatori non appartengono a leghe del gruppo ufficiale');
        }
        
        // Verifica che nessun giocatore sia già in un cluster approvato del gruppo
        $stmt = $conn->prepare("
            SELECT pcm.player_id
            FROM player_cluster_members pcm
            JOIN player_clusters pc ON pcm.cluster_id = pc.id
            WHERE pcm.player_id IN ($placeholders) AND pc.official_group_id = ? AND pc.status = 'approved'
            LIMIT 1
        ");
        $types = str_repeat('i', count($playerIds)) . 'i';
        $stmt->bind_param($types, ...array_merge($playerIds, [$groupId]));
        $stmt->execute();
        if ($stmt->get_result()->num_rows > 0) {
            $stmt->close();
            throw new Exception('Uno o più giocatori appartengono già a un cluster approvato');
        }
        $stmt->close();
        
        // Crea cluster
        $status = isset($data['status']) ? $data['status'] : 'pending';
        $suggestedBySystem = isset($data['suggested_by_system']) ? (int)$data['suggested_by_system'] : 0;
        
        $stmt = $conn->prepare("
            INSERT INTO player_clusters (official_group_id, status, suggested_by_system, created_by)
            VALUES (?, ?, ?, ?)
        ");
        $stmt->bind_param("isii", $groupId, $status, $suggestedBySystem, $userId);
        $stmt->execute();
        $clusterId = $conn->insert_id;
        $stmt->close();
        
        // Aggiungi giocatori al cluster
        $stmt = $conn->prepare("INSERT INTO player_cluster_members (cluster_id, player_id, added_by) VALUES (?, ?, ?)");
        foreach ($playerIds as $pid) {
            $stmt->bind_param("iii", $clusterId, $pid, $userId);
            $stmt->execute();
        }
        $stmt->close();
        
        $response = ['message' => 'Cluster creato con successo', 'cluster_id' => $clusterId];
        $statusCode = 200;
    }
    // PUT /superuser/player-clusters/:id/approve - Approva un cluster
    else if ($method === 'PUT' && preg_match('#^/superuser/player-clusters/(\d+)/approve$#', $path, $matches)) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido');
        }
        
        // Verifica superuser
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT is_superuser FROM users WHERE id = ?");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $user = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$user || !$user['is_superuser']) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        $clusterId = (int)$matches[1];
        
        // Verifica che il cluster esista
        $stmt = $conn->prepare("SELECT id, official_group_id, status FROM player_clusters WHERE id = ?");
        $stmt->bind_param("i", $clusterId);
        $stmt->execute();
        $cluster = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$cluster) {
            throw new Exception('Cluster non trovato');
        }
        
        // Verifica che nessun giocatore del cluster sia già in un altro cluster approvato
        $stmt = $conn->prepare("
            SELECT pcm.player_id
            FROM player_cluster_members pcm
            JOIN player_clusters pc ON pcm.cluster_id = pc.id
            WHERE pcm.player_id IN (
                SELECT player_id FROM player_cluster_members WHERE cluster_id = ?
            ) AND pc.id != ? AND pc.official_group_id = ? AND pc.status = 'approved'
            LIMIT 1
        ");
        $groupId = $cluster['official_group_id'];
        $stmt->bind_param("iii", $clusterId, $clusterId, $groupId);
        $stmt->execute();
        if ($stmt->get_result()->num_rows > 0) {
            $stmt->close();
            throw new Exception('Uno o più giocatori appartengono già a un altro cluster approvato');
        }
        $stmt->close();
        
        // Approva cluster
        $stmt = $conn->prepare("
            UPDATE player_clusters 
            SET status = 'approved', approved_by = ?, approved_at = NOW()
            WHERE id = ?
        ");
        $stmt->bind_param("ii", $userId, $clusterId);
        $stmt->execute();
        $stmt->close();
        
        $response = ['message' => 'Cluster approvato con successo'];
        $statusCode = 200;
    }
    // PUT /superuser/player-clusters/:id/reject - Rifiuta un cluster
    else if ($method === 'PUT' && preg_match('#^/superuser/player-clusters/(\d+)/reject$#', $path, $matches)) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido');
        }
        
        // Verifica superuser
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT is_superuser FROM users WHERE id = ?");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $user = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$user || !$user['is_superuser']) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        $clusterId = (int)$matches[1];
        
        // Rifiuta cluster (status = rejected)
        $stmt = $conn->prepare("
            UPDATE player_clusters 
            SET status = 'rejected', approved_by = ?, approved_at = NOW()
            WHERE id = ?
        ");
        $stmt->bind_param("ii", $userId, $clusterId);
        $stmt->execute();
        $stmt->close();
        
        $response = ['message' => 'Cluster rifiutato'];
        $statusCode = 200;
    }
    // POST /superuser/player-clusters/:id/players - Aggiungi giocatore a cluster esistente
    else if ($method === 'POST' && preg_match('#^/superuser/player-clusters/(\d+)/players$#', $path, $matches)) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido');
        }
        
        // Verifica superuser
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT is_superuser FROM users WHERE id = ?");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $user = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$user || !$user['is_superuser']) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        $clusterId = (int)$matches[1];
        $data = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($data['player_id'])) {
            throw new Exception('player_id mancante');
        }
        
        $playerId = (int)$data['player_id'];
        
        // Verifica che il cluster esista
        $stmt = $conn->prepare("SELECT id, official_group_id, status FROM player_clusters WHERE id = ?");
        $stmt->bind_param("i", $clusterId);
        $stmt->execute();
        $cluster = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$cluster) {
            throw new Exception('Cluster non trovato');
        }
        
        $groupId = $cluster['official_group_id'];
        
        // Verifica che il giocatore appartenga a una lega del gruppo
        $stmt = $conn->prepare("
            SELECT p.id
            FROM players p
            JOIN teams t ON p.team_id = t.id
            JOIN leagues l ON t.league_id = l.id
            WHERE p.id = ? AND l.official_group_id = ? AND l.is_official = 1
        ");
        $stmt->bind_param("ii", $playerId, $groupId);
        $stmt->execute();
        if (!$stmt->get_result()->num_rows) {
            $stmt->close();
            throw new Exception('Il giocatore non appartiene a una lega del gruppo ufficiale');
        }
        $stmt->close();
        
        // Verifica che il giocatore non sia già in un cluster approvato del gruppo
        if ($cluster['status'] === 'approved') {
            $stmt = $conn->prepare("
                SELECT pcm.player_id
                FROM player_cluster_members pcm
                JOIN player_clusters pc ON pcm.cluster_id = pc.id
                WHERE pcm.player_id = ? AND pc.id != ? AND pc.official_group_id = ? AND pc.status = 'approved'
                LIMIT 1
            ");
            $stmt->bind_param("iii", $playerId, $clusterId, $groupId);
            $stmt->execute();
            if ($stmt->get_result()->num_rows > 0) {
                $stmt->close();
                throw new Exception('Il giocatore appartiene già a un altro cluster approvato');
            }
            $stmt->close();
        }
        
        // Verifica che il giocatore non sia già nel cluster
        $stmt = $conn->prepare("SELECT player_id FROM player_cluster_members WHERE cluster_id = ? AND player_id = ?");
        $stmt->bind_param("ii", $clusterId, $playerId);
        $stmt->execute();
        if ($stmt->get_result()->num_rows > 0) {
            $stmt->close();
            throw new Exception('Il giocatore è già nel cluster');
        }
        $stmt->close();
        
        // Aggiungi giocatore al cluster
        $stmt = $conn->prepare("INSERT INTO player_cluster_members (cluster_id, player_id, added_by) VALUES (?, ?, ?)");
        $stmt->bind_param("iii", $clusterId, $playerId, $userId);
        $stmt->execute();
        $stmt->close();
        
        $response = ['message' => 'Giocatore aggiunto al cluster con successo'];
        $statusCode = 200;
    }
    // GET /superuser/player-clusters/:groupId - Lista cluster di un gruppo
    else if ($method === 'GET' && preg_match('#^/superuser/player-clusters/(\d+)$#', $path, $matches)) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido');
        }
        
        // Verifica superuser
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT is_superuser FROM users WHERE id = ?");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $user = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$user || !$user['is_superuser']) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        $groupId = (int)$matches[1];
        $status = isset($_GET['status']) ? $_GET['status'] : null;
        
        $query = "
            SELECT pc.id, pc.status, pc.suggested_by_system, pc.created_at, pc.approved_at,
                   COUNT(pcm.player_id) as players_count
            FROM player_clusters pc
            LEFT JOIN player_cluster_members pcm ON pc.id = pcm.cluster_id
            WHERE pc.official_group_id = ?
        ";
        
        if ($status) {
            $query .= " AND pc.status = ?";
        }
        
        $query .= " GROUP BY pc.id ORDER BY pc.created_at DESC";
        
        $stmt = $conn->prepare($query);
        if ($status) {
            $stmt->bind_param("is", $groupId, $status);
        } else {
            $stmt->bind_param("i", $groupId);
        }
        $stmt->execute();
        $result = $stmt->get_result();
        
        $clusters = [];
        while ($row = $result->fetch_assoc()) {
            // Ottieni dettagli giocatori
            $stmt2 = $conn->prepare("
                SELECT p.id, p.first_name, p.last_name, p.role, t.league_id, l.name as league_name
                FROM player_cluster_members pcm
                JOIN players p ON pcm.player_id = p.id
                JOIN teams t ON p.team_id = t.id
                JOIN leagues l ON t.league_id = l.id
                WHERE pcm.cluster_id = ?
                ORDER BY l.name, p.last_name, p.first_name
            ");
            $stmt2->bind_param("i", $row['id']);
            $stmt2->execute();
            $playersResult = $stmt2->get_result();
            $players = [];
            while ($playerRow = $playersResult->fetch_assoc()) {
                $players[] = [
                    'id' => (int)$playerRow['id'],
                    'first_name' => $playerRow['first_name'],
                    'last_name' => $playerRow['last_name'],
                    'full_name' => $playerRow['first_name'] . ' ' . $playerRow['last_name'],
                    'role' => $playerRow['role'],
                    'league_id' => (int)$playerRow['league_id'],
                    'league_name' => $playerRow['league_name']
                ];
            }
            $stmt2->close();
            
            $clusters[] = [
                'id' => (int)$row['id'],
                'status' => $row['status'],
                'suggested_by_system' => (bool)$row['suggested_by_system'],
                'created_at' => $row['created_at'],
                'approved_at' => $row['approved_at'],
                'players_count' => (int)$row['players_count'],
                'players' => $players
            ];
        }
        $stmt->close();
        
        $response = ['clusters' => $clusters];
        $statusCode = 200;
    }
    // GET /superuser/players/search/:groupId - Cerca giocatori per nome o lega
    else if ($method === 'GET' && preg_match('#^/superuser/players/search/(\d+)$#', $path, $matches)) {
        $token = getAuthToken();
        if (!$token) {
            throw new Exception('Token di autenticazione mancante');
        }
        $decoded = verifyJWT($token);
        if (!$decoded) {
            throw new Exception('Token non valido');
        }
        
        // Verifica superuser
        $userId = $decoded['userId'];
        $conn = getDbConnection();
        $stmt = $conn->prepare("SELECT is_superuser FROM users WHERE id = ?");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $user = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        
        if (!$user || !$user['is_superuser']) {
            throw new Exception('Accesso negato: solo superuser');
        }
        
        $groupId = (int)$matches[1];
        $query = isset($_GET['q']) ? trim($_GET['q']) : '';
        $leagueId = isset($_GET['league_id']) ? (int)$_GET['league_id'] : null;
        
        $sql = "
            SELECT p.id, p.first_name, p.last_name, p.role, p.rating, t.league_id, l.name as league_name
            FROM players p
            JOIN teams t ON p.team_id = t.id
            JOIN leagues l ON t.league_id = l.id
            WHERE l.official_group_id = ? AND l.is_official = 1
        ";
        
        $params = [$groupId];
        $types = 'i';
        
        if ($query) {
            $sql .= " AND (p.first_name LIKE ? OR p.last_name LIKE ? OR CONCAT(p.first_name, ' ', p.last_name) LIKE ?)";
            $searchTerm = '%' . $query . '%';
            $params[] = $searchTerm;
            $params[] = $searchTerm;
            $params[] = $searchTerm;
            $types .= 'sss';
        }
        
        if ($leagueId) {
            $sql .= " AND l.id = ?";
            $params[] = $leagueId;
            $types .= 'i';
        }
        
        $sql .= " ORDER BY l.name, p.last_name, p.first_name LIMIT 50";
        
        $stmt = $conn->prepare($sql);
        $stmt->bind_param($types, ...$params);
        $stmt->execute();
        $result = $stmt->get_result();
        
        $players = [];
        while ($row = $result->fetch_assoc()) {
            $players[] = [
                'id' => (int)$row['id'],
                'first_name' => $row['first_name'],
                'last_name' => $row['last_name'],
                'full_name' => $row['first_name'] . ' ' . $row['last_name'],
                'role' => $row['role'],
                'rating' => (float)$row['rating'],
                'league_id' => (int)$row['league_id'],
                'league_name' => $row['league_name']
            ];
        }
        $stmt->close();
        
        $response = ['players' => $players];
        $statusCode = 200;
    }

    // ============================================================
    // MATCHDAY CALCULATION ENDPOINTS
    // ============================================================

    // POST /leagues/:id/calculate/:giornata - Calcola giornata (solo admin)
    elseif ($method === 'POST' && preg_match('/\/leagues\/(\d+)\/calculate\/(\d+)$/', $path, $calcMatches)) {
        $token = getAuthToken();
        if (!$token) throw new Exception('Token di autenticazione mancante');
        $decoded = verifyJWT($token);
        if (!$decoded) throw new Exception('Token non valido o scaduto');

        $leagueId = (int)$calcMatches[1];
        $giornata = (int)$calcMatches[2];
        $userId = $decoded['userId'];
        $conn = getDbConnection();

        // Verifica admin
        $stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $member = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if (!$member || $member['role'] !== 'admin') {
            throw new Exception('Solo gli amministratori possono calcolare la giornata');
        }

        $input = json_decode(file_get_contents('php://input'), true);
        $use6Politico = isset($input['use_6_politico']) ? (bool)$input['use_6_politico'] : false;
        $force = isset($input['force']) ? (bool)$input['force'] : false;

        // Controlla se già calcolata
        $stmt = $conn->prepare("SELECT calculated_at FROM matchday_results WHERE league_id = ? AND giornata = ? LIMIT 1");
        $stmt->bind_param("ii", $leagueId, $giornata);
        $stmt->execute();
        $existing = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        if ($existing && !$force) {
            $response = [
                'already_calculated' => true,
                'calculated_at' => $existing['calculated_at'],
                'message' => 'Giornata già calcolata. Invia force=true per ricalcolare.'
            ];
            $statusCode = 200;
        } else {
            // Procedi con il calcolo
            $league = getLeagueById($leagueId);
            if (!$league) throw new Exception('Lega non trovata');

            // Se la lega è collegata, leggi voti e giocatori dalla lega sorgente
            $effectiveLeagueIdCalc = getEffectiveLeagueId($leagueId);

            // Recupera utenti (dalla lega utente)
            $stmt = $conn->prepare("SELECT u.id, u.username, ub.team_name FROM users u JOIN user_budget ub ON u.id = ub.user_id WHERE ub.league_id = ?");
            $stmt->bind_param("i", $leagueId);
            $stmt->execute();
            $utenti = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
            $stmt->close();

            // Recupera rose (dalla lega utente)
            $rose = [];
            $stmt = $conn->prepare("SELECT up.user_id, up.player_id FROM user_players up WHERE up.league_id = ?");
            $stmt->bind_param("i", $leagueId);
            $stmt->execute();
            $res = $stmt->get_result();
            while ($row = $res->fetch_assoc()) {
                $rose[$row['user_id']][] = $row['player_id'];
            }
            $stmt->close();

            // Recupera voti per questa giornata (dalla lega sorgente se collegata)
            $voti = [];
            $player_ratings_data = [];
            $stmt = $conn->prepare("SELECT player_id, rating, goals, assists, yellow_cards, red_cards, goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet FROM player_ratings WHERE league_id = ? AND giornata = ?");
            $stmt->bind_param("ii", $effectiveLeagueIdCalc, $giornata);
            $stmt->execute();
            $res = $stmt->get_result();
            $calcRowCount = 0;
            $calcDuplicates = [];
            while ($row = $res->fetch_assoc()) {
                $pid = $row['player_id'];
                if (isset($voti[$pid])) {
                    $calcDuplicates[] = "player=$pid old_rating={$voti[$pid]} new_rating={$row['rating']}";
                }
                $voti[$pid] = floatval($row['rating']);
                $player_ratings_data[$pid] = $row;
                $calcRowCount++;
            }
            $stmt->close();
            
            error_log("=== CALCULATE MATCHDAY === league=$leagueId effectiveLeague=$effectiveLeagueIdCalc giornata=$giornata force=" . ($force ? 'true' : 'false'));
            error_log("CALC_VOTES: $calcRowCount rows loaded from player_ratings");
            if (!empty($calcDuplicates)) {
                error_log("CALC_VOTES WARNING DUPLICATES: " . implode(', ', $calcDuplicates));
            }
            // Log tutti i voti con rating=0 (S.V.) e quelli > 0
            $svPlayers = [];
            $ratedPlayers = [];
            foreach ($voti as $pid => $r) {
                if ($r == 0) $svPlayers[] = $pid;
                else $ratedPlayers[] = "$pid=$r";
            }
            error_log("CALC_VOTES SV players (" . count($svPlayers) . "): " . implode(',', $svPlayers));
            error_log("CALC_VOTES Rated players (" . count($ratedPlayers) . "): " . implode(', ', $ratedPlayers));

            // Recupera info giocatori (dalla lega sorgente se collegata)
            $playersInfo = [];
            $stmtP = $conn->prepare("SELECT id, first_name, last_name, role FROM players WHERE team_id IN (SELECT id FROM teams WHERE league_id = ?)");
            $stmtP->bind_param("i", $effectiveLeagueIdCalc);
            $stmtP->execute();
            $resP = $stmtP->get_result();
            while ($rowP = $resP->fetch_assoc()) {
                $playersInfo[$rowP['id']] = $rowP;
            }
            $stmtP->close();

            // Recupera bonus settings
            $bonus_settings = getLeagueBonusSettings($leagueId);
            $bonus_enabled = (bool)$bonus_settings['enable_bonus_malus'];

            // Se ricalcolo, elimina dati precedenti
            if ($existing && $force) {
                $stmt = $conn->prepare("DELETE FROM matchday_results WHERE league_id = ? AND giornata = ?");
                $stmt->bind_param("ii", $leagueId, $giornata);
                $stmt->execute();
                $stmt->close();
                $stmt = $conn->prepare("DELETE FROM matchday_player_scores WHERE league_id = ? AND giornata = ?");
                $stmt->bind_param("ii", $leagueId, $giornata);
                $stmt->execute();
                $stmt->close();
            }

            $risultati = [];
            $users_with_6_politico = [];

            foreach ($utenti as $utente) {
                $uid = $utente['id'];
                $somma = 0;
                $titolari = [];

                if ($league['auto_lineup_mode']) {
                    // 6 politico: se nessun giocatore della rosa ha voto, crea voti fittizi a 6.0
                    $userHasVotes = false;
                    if (isset($rose[$uid])) {
                        foreach ($rose[$uid] as $pid) {
                            if (isset($voti[$pid]) && $voti[$pid] > 0) {
                                $userHasVotes = true;
                                break;
                            }
                        }
                    }

                    if (!$userHasVotes && $use6Politico && isset($rose[$uid])) {
                        // Applica 6 politico: simula voti a 6.0 per tutti i giocatori della rosa
                        $users_with_6_politico[] = $utente['username'];
                        $voti_fake = $voti; // copia
                        foreach ($rose[$uid] as $pid) {
                            $voti_fake[$pid] = 6.0;
                            if (!isset($player_ratings_data[$pid])) {
                                $player_ratings_data[$pid] = [
                                    'player_id' => $pid, 'rating' => 6.0,
                                    'goals' => 0, 'assists' => 0, 'yellow_cards' => 0, 'red_cards' => 0, 'goals_conceded' => 0, 'own_goals' => 0, 'penalty_missed' => 0, 'penalty_saved' => 0, 'clean_sheet' => 0
                                ];
                            }
                        }
                        $titolari = build_auto_lineup($uid, $league, $rose, $voti_fake, $conn);
                    } else {
                        $titolari = build_auto_lineup($uid, $league, $rose, $voti, $conn);
                    }
                } else {
                    $stmt = $conn->prepare("SELECT titolari FROM user_lineups WHERE user_id = ? AND league_id = ? AND giornata = ?");
                    $stmt->bind_param("iii", $uid, $leagueId, $giornata);
                    $stmt->execute();
                    $res = $stmt->get_result();
                    if ($row = $res->fetch_assoc()) {
                        $titolari_str = $row['titolari'];
                        if ($titolari_str && $titolari_str[0] === '[') {
                            $titolari = json_decode($titolari_str, true);
                        } else if ($titolari_str) {
                            $titolari = explode(',', $titolari_str);
                        }
                    }
                    $stmt->close();

                    // 6 politico per formazione manuale
                    if ($use6Politico && !empty($titolari)) {
                        $userHasVotes = false;
                        foreach ($titolari as $pid) {
                            if ($pid && isset($voti[$pid]) && $voti[$pid] > 0) {
                                $userHasVotes = true;
                                break;
                            }
                        }
                        if (!$userHasVotes) {
                            $users_with_6_politico[] = $utente['username'];
                            foreach ($titolari as $pid) {
                                if ($pid && !isset($voti[$pid])) {
                                    $voti[$pid] = 6.0;
                                    $player_ratings_data[$pid] = [
                                        'player_id' => $pid, 'rating' => 6.0,
                                        'goals' => 0, 'assists' => 0, 'yellow_cards' => 0, 'red_cards' => 0, 'goals_conceded' => 0, 'own_goals' => 0, 'penalty_missed' => 0, 'penalty_saved' => 0, 'clean_sheet' => 0
                                    ];
                                }
                            }
                        }
                    }
                }

                // Calcola punteggio
                error_log("CALC user={$utente['username']} (id=$uid) titolari=" . json_encode($titolari));
                $playerScores = [];
                if (!empty($titolari)) {
                    foreach ($titolari as $pid) {
                        if ($pid && isset($player_ratings_data[$pid])) {
                            $pr = $player_ratings_data[$pid];
                            // Usa 6.0 per 6 politico se il rating è 0 e l'utente è nella lista 6 politico
                            $effectiveRating = floatval($pr['rating']);
                            if ($effectiveRating == 0 && in_array($utente['username'], $users_with_6_politico)) {
                                $effectiveRating = 6.0;
                                $pr['rating'] = 6.0;
                            }

                            $score = calculatePlayerScore($pr, $bonus_settings);
                            $somma += $score;
                            $bonusTotal = $score - floatval($pr['rating']);
                            
                            error_log("CALC_PLAYER pid=$pid rating={$pr['rating']} effectiveRating=$effectiveRating score=$score bonusTotal=$bonusTotal");

                            $pInfo = isset($playersInfo[$pid]) ? $playersInfo[$pid] : null;
                            $playerScores[] = [
                                'player_id' => (int)$pid,
                                'player_name' => $pInfo ? ($pInfo['first_name'] . ' ' . $pInfo['last_name']) : 'Sconosciuto',
                                'player_role' => $pInfo ? $pInfo['role'] : '',
                                'rating' => floatval($pr['rating']),
                                'goals' => (int)($pr['goals'] ?? 0),
                                'assists' => (int)($pr['assists'] ?? 0),
                                'yellow_cards' => (int)($pr['yellow_cards'] ?? 0),
                                'red_cards' => (int)($pr['red_cards'] ?? 0),
                                'goals_conceded' => (int)($pr['goals_conceded'] ?? 0),
                                'own_goals' => (int)($pr['own_goals'] ?? 0),
                                'penalty_missed' => (int)($pr['penalty_missed'] ?? 0),
                                'penalty_saved' => (int)($pr['penalty_saved'] ?? 0),
                                'clean_sheet' => (int)($pr['clean_sheet'] ?? 0),
                                'bonus_total' => round($bonusTotal, 2),
                                'total_score' => round($score, 2),
                            ];
                        } else if ($pid) {
                            error_log("CALC_PLAYER pid=$pid NO RATING DATA (not in player_ratings) - skipped");
                        }
                    }
                }

                $somma = round($somma, 2);
                error_log("CALC user={$utente['username']} TOTAL=$somma playerScoresCount=" . count($playerScores));

                // Salva risultato squadra
                $stmt = $conn->prepare("REPLACE INTO matchday_results (league_id, giornata, user_id, punteggio, calculated_at, calculated_by) VALUES (?, ?, ?, ?, NOW(), ?)");
                $stmt->bind_param("iiidi", $leagueId, $giornata, $uid, $somma, $userId);
                $stmt->execute();
                $stmt->close();

                // Salva dettaglio giocatori
                foreach ($playerScores as $ps) {
                    $stmt = $conn->prepare("REPLACE INTO matchday_player_scores (league_id, giornata, user_id, player_id, player_name, player_role, rating, goals, assists, yellow_cards, red_cards, goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet, bonus_total, total_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                    $stmt->bind_param("iiiissdiiiiiiiiidd",
                        $leagueId, $giornata, $uid, $ps['player_id'],
                        $ps['player_name'], $ps['player_role'], $ps['rating'],
                        $ps['goals'], $ps['assists'], $ps['yellow_cards'], $ps['red_cards'],
                        $ps['goals_conceded'], $ps['own_goals'], $ps['penalty_missed'], $ps['penalty_saved'], $ps['clean_sheet'],
                        $ps['bonus_total'], $ps['total_score']
                    );
                    $stmt->execute();
                    $stmt->close();
                }

                $risultati[] = [
                    'user_id' => $uid,
                    'username' => $utente['username'],
                    'team_name' => $utente['team_name'],
                    'punteggio' => $somma,
                    'players' => $playerScores,
                ];
            }

            usort($risultati, function($a, $b) {
                return $b['punteggio'] <=> $a['punteggio'];
            });

            $response = [
                'message' => 'Giornata calcolata con successo',
                'giornata' => $giornata,
                'recalculated' => ($existing && $force),
                'use_6_politico' => $use6Politico,
                'users_with_6_politico' => $users_with_6_politico,
                'results' => $risultati,
            ];
            $statusCode = 200;

            try {
                $leagueName = isset($league['name']) && $league['name'] ? $league['name'] : 'la tua lega';
                notifyLeagueMatchdayCalculated($leagueId, $giornata, $leagueName);
            } catch (Throwable $pushEx) {
                error_log("Push notify error (calculate): " . $pushEx->getMessage());
                logPushDebug("Push notify error (calculate): " . $pushEx->getMessage());
            }
        }
    }

    // GET /leagues/:id/live/:giornata - Punteggi live (non calcolati, on-the-fly)
    elseif ($method === 'GET' && preg_match('/\/leagues\/(\d+)\/live\/(\d+)$/', $path, $liveMatches)) {
        $token = getAuthToken();
        if (!$token) throw new Exception('Token di autenticazione mancante');
        $decoded = verifyJWT($token);
        if (!$decoded) throw new Exception('Token non valido o scaduto');

        $leagueId = (int)$liveMatches[1];
        $giornata = (int)$liveMatches[2];
        $conn = getDbConnection();

        $league = getLeagueById($leagueId);
        if (!$league) throw new Exception('Lega non trovata');

        // Se la lega è collegata, leggi voti e giocatori dalla lega sorgente
        $effectiveLeagueIdLive = getEffectiveLeagueId($leagueId);

        // Recupera utenti
        $stmt = $conn->prepare("SELECT u.id, u.username, ub.team_name, COALESCE(NULLIF(ub.team_logo, ''), 'default_1') as team_logo FROM users u JOIN user_budget ub ON u.id = ub.user_id WHERE ub.league_id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $utenti = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmt->close();

        // Recupera rose
        $rose = [];
        $stmt = $conn->prepare("SELECT up.user_id, up.player_id FROM user_players up WHERE up.league_id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $rose[$row['user_id']][] = $row['player_id'];
        }
        $stmt->close();

        // Recupera voti (dalla lega sorgente se collegata)
        $voti = [];
        $player_ratings_data = [];
        $stmt = $conn->prepare("SELECT player_id, rating, goals, assists, yellow_cards, red_cards, goals_conceded, own_goals, penalty_missed, penalty_saved, clean_sheet FROM player_ratings WHERE league_id = ? AND giornata = ?");
        $stmt->bind_param("ii", $effectiveLeagueIdLive, $giornata);
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $voti[$row['player_id']] = floatval($row['rating']);
            $player_ratings_data[$row['player_id']] = $row;
        }
        $stmt->close();

        // Info giocatori (dalla lega sorgente se collegata)
        $playersInfo = [];
        $stmtP = $conn->prepare("SELECT id, first_name, last_name, role FROM players WHERE team_id IN (SELECT id FROM teams WHERE league_id = ?)");
        $stmtP->bind_param("i", $effectiveLeagueIdLive);
        $stmtP->execute();
        $resP = $stmtP->get_result();
        while ($rowP = $resP->fetch_assoc()) {
            $playersInfo[$rowP['id']] = $rowP;
        }
        $stmtP->close();

        // Bonus settings
        $bonus_settings = getLeagueBonusSettings($leagueId);

        // Controlla se calcolata
        $stmt = $conn->prepare("SELECT calculated_at FROM matchday_results WHERE league_id = ? AND giornata = ? LIMIT 1");
        $stmt->bind_param("ii", $leagueId, $giornata);
        $stmt->execute();
        $calcCheck = $stmt->get_result()->fetch_assoc();
        $stmt->close();

        $risultati = [];
        foreach ($utenti as $utente) {
            $uid = $utente['id'];
            $somma = 0;
            $titolari = [];

            if ($league['auto_lineup_mode']) {
                $titolari = build_auto_lineup($uid, $league, $rose, $voti, $conn);
            } else {
                $stmt = $conn->prepare("SELECT titolari FROM user_lineups WHERE user_id = ? AND league_id = ? AND giornata = ?");
                $stmt->bind_param("iii", $uid, $leagueId, $giornata);
                $stmt->execute();
                $res = $stmt->get_result();
                if ($row = $res->fetch_assoc()) {
                    $titolari_str = $row['titolari'];
                    if ($titolari_str && $titolari_str[0] === '[') {
                        $titolari = json_decode($titolari_str, true);
                    } else if ($titolari_str) {
                        $titolari = explode(',', $titolari_str);
                    }
                }
                $stmt->close();
            }

            $playerScores = [];
            if (!empty($titolari)) {
                foreach ($titolari as $pid) {
                    if ($pid && isset($player_ratings_data[$pid])) {
                        $pr = $player_ratings_data[$pid];
                        $score = calculatePlayerScore($pr, $bonus_settings);
                        $somma += $score;
                        $bonusTotal = $score - floatval($pr['rating']);
                        $pInfo = isset($playersInfo[$pid]) ? $playersInfo[$pid] : null;
                        $playerScores[] = [
                            'player_id' => (int)$pid,
                            'player_name' => $pInfo ? ($pInfo['first_name'] . ' ' . $pInfo['last_name']) : 'Sconosciuto',
                            'player_role' => $pInfo ? $pInfo['role'] : '',
                            'rating' => floatval($pr['rating']),
                            'goals' => (int)($pr['goals'] ?? 0),
                            'assists' => (int)($pr['assists'] ?? 0),
                            'yellow_cards' => (int)($pr['yellow_cards'] ?? 0),
                            'red_cards' => (int)($pr['red_cards'] ?? 0),
                            'goals_conceded' => (int)($pr['goals_conceded'] ?? 0),
                            'own_goals' => (int)($pr['own_goals'] ?? 0),
                            'penalty_missed' => (int)($pr['penalty_missed'] ?? 0),
                            'penalty_saved' => (int)($pr['penalty_saved'] ?? 0),
                            'clean_sheet' => (int)($pr['clean_sheet'] ?? 0),
                            'bonus_total' => round($score - floatval($pr['rating']), 2),
                            'total_score' => round($score, 2),
                        ];
                    }
                }
            }

            $risultati[] = [
                'user_id' => $uid,
                'username' => $utente['username'],
                'team_name' => $utente['team_name'],
                'team_logo' => $utente['team_logo'] ?? 'default_1',
                'punteggio' => round($somma, 2),
                'players' => $playerScores,
            ];
        }

        usort($risultati, function($a, $b) {
            return $b['punteggio'] <=> $a['punteggio'];
        });

        $response = [
            'giornata' => $giornata,
            'is_calculated' => !!$calcCheck,
            'calculated_at' => $calcCheck ? $calcCheck['calculated_at'] : null,
            'results' => $risultati,
        ];
        $statusCode = 200;
    }

    // GET /leagues/:id/matchday-status - Stato di tutte le giornate
    elseif ($method === 'GET' && preg_match('/\/leagues\/(\d+)\/matchday-status$/', $path, $statusMatches)) {
        $token = getAuthToken();
        if (!$token) throw new Exception('Token di autenticazione mancante');
        $decoded = verifyJWT($token);
        if (!$decoded) throw new Exception('Token non valido o scaduto');

        $leagueId = (int)$statusMatches[1];
        $conn = getDbConnection();

        // Se la lega è collegata, leggi giornate e voti dalla lega sorgente
        $effectiveLeagueIdStatus = getEffectiveLeagueId($leagueId);

        // Recupera tutte le giornate (dalla lega sorgente se collegata)
        $stmt = $conn->prepare("SELECT giornata, deadline FROM matchdays WHERE league_id = ? ORDER BY giornata");
        $stmt->bind_param("i", $effectiveLeagueIdStatus);
        $stmt->execute();
        $giornate = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        $stmt->close();

        // Recupera giornate calcolate (dalla lega utente, non dalla sorgente)
        $stmt = $conn->prepare("SELECT giornata, calculated_at FROM matchday_results WHERE league_id = ? GROUP BY giornata");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $calcMap = [];
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $calcMap[$row['giornata']] = $row['calculated_at'];
        }
        $stmt->close();

        // Recupera giornate con voti (dalla lega sorgente se collegata)
        $stmt = $conn->prepare("SELECT giornata, COUNT(*) as cnt FROM player_ratings WHERE league_id = ? AND rating > 0 GROUP BY giornata");
        $stmt->bind_param("i", $effectiveLeagueIdStatus);
        $stmt->execute();
        $votesMap = [];
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $votesMap[$row['giornata']] = (int)$row['cnt'];
        }
        $stmt->close();

        $result = [];
        foreach ($giornate as $g) {
            $gn = (int)$g['giornata'];
            $result[] = [
                'giornata' => $gn,
                'deadline' => $g['deadline'],
                'has_votes' => isset($votesMap[$gn]) && $votesMap[$gn] > 0,
                'votes_count' => $votesMap[$gn] ?? 0,
                'is_calculated' => isset($calcMap[$gn]),
                'calculated_at' => $calcMap[$gn] ?? null,
            ];
        }

        $response = $result;
        $statusCode = 200;
    }
    
} catch (Exception $e) {
    // Log completo per debug lato server
    error_log("API Error: " . $e->getMessage() . " at " . $e->getFile() . ":" . $e->getLine());
    
    // Messaggi sicuri da mostrare all'utente (errori di business logic)
    $safeMessages = [
        'Compila tutti i campi', 'Inserisci username e password', 'Credenziali non valide',
        'Token di autenticazione mancante', 'Token non valido o scaduto',
        'Username già esistente', 'Email già registrata', 'Inserisci la tua email',
        'Inserisci un indirizzo email valido', 'Le nuove password non coincidono',
        'Password attuale errata', 'Utente non trovato', 'ID lega obbligatorio',
        'Non sei membro di questa lega', 'Il mercato è bloccato', 'Budget insufficiente',
        'Giocatore non trovato', 'Giocatore non nella tua rosa',
        'Limite giocatori per questo ruolo raggiunto', 'Hai già acquistato questo giocatore',
        'Non hai i permessi per questa operazione', 'Troppi tentativi di login. Riprova tra qualche minuto.',
        'Troppi tentativi. Riprova tra qualche minuto.', 'Token push non valido',
        'Inizio partita già registrato', 'Registra prima l\'inizio partita',
        'Registra prima la fine del primo tempo', 'Minuto non valido',
        'La partita risulta già chiusa', 'Registra prima l\'inizio del secondo tempo',
        'Supplementari non previsti per questa partita', 'Registra prima la fine del secondo tempo',
        'Fase supplementare non coerente', 'Rigori non previsti per questa partita',
        'Registra prima la fine dei tempi regolamentari o supplementari', 'Rigori già registrati',
    ];
    
    $errorMessage = $e->getMessage();
    
    // Se il messaggio non e nella lista safe, mostra messaggio generico
    $isSafe = false;
    foreach ($safeMessages as $safe) {
        if (strpos($errorMessage, $safe) !== false) {
            $isSafe = true;
            break;
        }
    }
    
    $response = ['message' => $isSafe ? $errorMessage : 'Si è verificato un errore. Riprova più tardi.'];
    $statusCode = $isSafe ? 400 : 500;
}

http_response_code($statusCode);
echo json_encode($response);

